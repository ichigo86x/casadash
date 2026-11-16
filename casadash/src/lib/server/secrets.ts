import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { env } from '$env/dynamic/private';
import { DATA_DIR } from '$lib/server/config';

// Encrypts sensitive values stored in the database (TOTP secrets, bank credentials) with AES-256-GCM.
// The key comes from CASADASH_SECRET_KEY, or from DATA_DIR/secret.key (generated on first use).
// The key file is part of the backup archive, so a restore on another machine keeps MFA working.

export const KEY_FILE = path.join(DATA_DIR, 'secret.key');
const PREFIX = 'enc:v1:';

let cached: Buffer | null = null;

function masterKey(): Buffer {
	if (cached) return cached;
	if (env.CASADASH_SECRET_KEY) {
		cached = crypto.createHash('sha256').update(env.CASADASH_SECRET_KEY).digest();
	} else {
		if (!fs.existsSync(KEY_FILE)) {
			fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
			fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
		}
		cached = crypto.createHash('sha256').update(fs.readFileSync(KEY_FILE, 'utf8').trim()).digest();
	}
	return cached;
}

export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
	const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** Decrypts a stored value. Values saved before encryption existed (no prefix) are returned as they are. */
export function decryptSecret(stored: string): string {
	if (!isEncrypted(stored)) return stored;
	const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
	const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), raw.subarray(0, 12));
	decipher.setAuthTag(raw.subarray(12, 28));
	return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
