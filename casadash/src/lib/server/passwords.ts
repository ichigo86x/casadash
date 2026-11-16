import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const COST = 12;
// Verified when the user does not exist, so a wrong username takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync('casadash-dummy-password', COST);

export const hashPassword = (password: string) => bcrypt.hash(password, COST);

/** Accepts the `$2y$` hashes produced by the old PHP version. Pass null hash to burn the same time. */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
	if (!hash) {
		await bcrypt.compare(password, DUMMY_HASH);
		return false;
	}
	return bcrypt.compare(password, hash.replace(/^\$2y\$/, '$2a$'));
}

/** Random password for admin resets: readable, without ambiguous characters. */
export function generatePassword(length = 14): string {
	const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let out = '';
	for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
	return out;
}
