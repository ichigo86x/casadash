import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { decryptSecret, encryptSecret, isEncrypted } from '$lib/server/secrets';

const PERIOD = 30;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

type MfaUser = { id: number; totpSecret: string | null; totpLastStep: number | null; recoveryCodes: string | null };

/**
 * Checks a 6-digit code. A time step is accepted only once: replaying the code just used
 * (or an older one) is refused even inside the tolerance window.
 */
export async function verifyTotp(user: MfaUser, code: string): Promise<boolean> {
	if (!user.totpSecret || !/^\d{6}$/.test(code)) return false;
	const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(decryptSecret(user.totpSecret)), period: PERIOD });
	const delta = totp.validate({ token: code, window: 1 });
	if (delta === null) return false;
	const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
	if (user.totpLastStep !== null && step <= user.totpLastStep) return false;
	await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
	return true;
}

/** Ten single-use codes for a lost phone. Returns the readable codes (shown once) and stores only hashes. */
export async function generateRecoveryCodes(userId: number): Promise<string[]> {
	const codes = Array.from({ length: 10 }, () => {
		const raw = crypto.randomBytes(5).toString('hex'); // 10 hex chars
		return `${raw.slice(0, 5)}-${raw.slice(5)}`;
	});
	await db.update(users).set({ recoveryCodes: JSON.stringify(codes.map((c) => sha(normalizeRecovery(c)))) }).where(eq(users.id, userId));
	return codes;
}

/** Consumes a recovery code if it is valid. */
export async function useRecoveryCode(user: MfaUser, code: string): Promise<boolean> {
	const normalized = normalizeRecovery(code);
	if (normalized.length !== 10) return false;
	let hashes: string[] = [];
	try { hashes = JSON.parse(user.recoveryCodes || '[]'); } catch {}
	const hash = sha(normalized);
	if (!hashes.includes(hash)) return false;
	await db.update(users).set({ recoveryCodes: JSON.stringify(hashes.filter((h) => h !== hash)) }).where(eq(users.id, user.id));
	return true;
}

export function recoveryCodesLeft(user: { recoveryCodes: string | null }): number {
	try { return (JSON.parse(user.recoveryCodes || '[]') as string[]).length; } catch { return 0; }
}

/** Accepts either a TOTP code or a recovery code. */
export async function verifySecondFactor(user: MfaUser, input: string): Promise<boolean> {
	const code = input.replace(/\s+/g, '');
	if (/^\d{6}$/.test(code)) return verifyTotp(user, code);
	return useRecoveryCode(user, code);
}

export const encryptTotpSecret = encryptSecret;

/** One-off at start-up: TOTP secrets saved in clear text by older versions get encrypted. */
export async function encryptLegacyTotpSecrets() {
	const rows = await db.select({ id: users.id, secret: users.totpSecret }).from(users);
	for (const r of rows) {
		if (r.secret && !isEncrypted(r.secret)) {
			await db.update(users).set({ totpSecret: encryptSecret(r.secret) }).where(eq(users.id, r.id));
		}
	}
}
