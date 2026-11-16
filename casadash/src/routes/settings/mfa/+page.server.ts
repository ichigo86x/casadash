import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import * as QRCodeRaw from 'qrcode';
import type { PageServerLoad, Actions } from './$types';
import * as OTPAuth from 'otpauth';
import { encryptSecret } from '$lib/server/secrets';
import { generateRecoveryCodes, recoveryCodesLeft, verifySecondFactor } from '$lib/server/mfa';
import { verifyPassword } from '$lib/server/passwords';
import { audit } from '$lib/server/audit';
import { lockedFor, mfaLimits, registerFailure } from '$lib/server/auth';

// Guessing codes here is as good as guessing them at login: same throttling
async function secondFactorOk(user: Awaited<ReturnType<typeof currentUser>>, input: string, ip: string): Promise<string | null> {
    const limits = mfaLimits(ip, user.id);
    const locked = await lockedFor(limits);
    if (locked) return `Troppi tentativi. Riprova tra ${Math.ceil(locked / 60000)} minuti.`;
    if (await verifySecondFactor(user, input)) return null;
    await registerFailure(limits);
    return 'Codice errato.';
}

async function currentUser(id: number) {
    const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return u;
}

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) return { requireLogin: true };

    const user = await currentUser(locals.user.id);
    const hasMfa = !!user?.totpSecret;

    let secret = '';
    let qrCodeUrl = '';

    if (!hasMfa) {
        const secretObj = new OTPAuth.Secret({ size: 20 });
        secret = secretObj.base32;

        const totp = new OTPAuth.TOTP({
            issuer: 'CasaDash',
            label: user.username,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: secretObj
        });

        try {
            const QRCode = ((QRCodeRaw as any).default || QRCodeRaw) as typeof QRCodeRaw;
            qrCodeUrl = await QRCode.toDataURL(totp.toString());
        } catch (e) {
            console.error('MFA QR Generation Failed:', e);
        }
    }

    return { hasMfa, qrCodeUrl, secret, recoveryLeft: hasMfa ? recoveryCodesLeft(user) : 0 };
};

export const actions: Actions = {
    enable: async ({ request, locals, getClientAddress }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        const data = await request.formData();
        const secret = data.get('secret')?.toString();
        const code = data.get('code')?.toString().replace(/\s+/g, '');

        if (!secret || !code) return fail(400, { error: 'Dati mancanti' });

        let totp: OTPAuth.TOTP;
        try {
            totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
        } catch {
            return fail(400, { error: 'Segreto non valido, ricarica la pagina.' });
        }
        const delta = totp.validate({ token: code, window: 1 });
        if (delta === null) return fail(400, { error: 'Codice errato. Riprova.' });

        // The secret is stored encrypted; the step just used cannot be replayed at the next login
        const step = Math.floor(Date.now() / 30000) + delta;
        await db.update(users).set({ totpSecret: encryptSecret(secret), totpLastStep: step }).where(eq(users.id, locals.user.id));
        const recoveryCodes = await generateRecoveryCodes(locals.user.id);
        await audit(locals.user, 'mfa.enabled', undefined, getClientAddress());
        return { success: true, recoveryCodes };
    },
    // Turning MFA off needs the password and a current code (or recovery code): a stolen session is not enough
    disable: async ({ request, locals, getClientAddress }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const user = await currentUser(locals.user.id);
        const password = data.get('password')?.toString() || '';
        const code = data.get('code')?.toString() || '';
        if (!(await verifyPassword(password, user.passwordHash))) return fail(400, { error: 'Password errata.' });
        const problem = await secondFactorOk(user, code, getClientAddress());
        if (problem) return fail(400, { error: problem });

        await db.update(users).set({ totpSecret: null, totpLastStep: null, recoveryCodes: null }).where(eq(users.id, user.id));
        await audit(locals.user, 'mfa.disabled', undefined, getClientAddress());
        return { success: true };
    },
    regenerate: async ({ request, locals, getClientAddress }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const user = await currentUser(locals.user.id);
        if (!user.totpSecret) return fail(400, { error: 'MFA non attiva.' });
        const problem = await secondFactorOk(user, data.get('code')?.toString() || '', getClientAddress());
        if (problem) return fail(400, { error: problem });
        const recoveryCodes = await generateRecoveryCodes(user.id);
        await audit(locals.user, 'mfa.recovery_regenerated', undefined, getClientAddress());
        return { success: true, recoveryCodes };
    }
};
