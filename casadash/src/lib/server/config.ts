import path from 'path';
import { env } from '$env/dynamic/private';

// Single source for on-disk locations, shared by every deployment target:
// - Home Assistant add-on / Docker: DATA_DIR=/data (set by run.sh)
// - Bare metal: DATA_DIR defaults to ./data relative to the working directory
export const DATA_DIR = path.resolve(env.DATA_DIR || (env.DATABASE_URL ? path.dirname(env.DATABASE_URL) : 'data'));
export const DATABASE_PATH = path.resolve(env.DATABASE_URL || path.join(DATA_DIR, 'cdash.db'));
export const UPLOADS_DIR = path.resolve(env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads'));
export const RECEIPTS_DIR = path.join(UPLOADS_DIR, 'receipts');
// Scheduled backups. The Home Assistant add-on points this to /share/casadash/backups (see run.sh).
export const BACKUP_DIR = path.resolve(env.BACKUP_DIR || path.join(DATA_DIR, 'backups'));

// Exit code the launcher (start.mjs) treats as "restart me", used after a backup restore.
export const RESTART_EXIT_CODE = 75;

/**
 * COOKIE_SECURE: "auto" (default) marks the session cookie Secure only when the
 * request reached us over HTTPS, so plain-HTTP LAN access keeps working.
 * "true"/"false" force the flag.
 */
export function cookieSecure(_url: URL, headers: Headers): boolean {
	const mode = (env.COOKIE_SECURE || 'auto').toLowerCase();
	if (mode === 'true') return true;
	if (mode === 'false') return false;
	return requestIsHttps(headers);
}

/**
 * Whether the browser reached us over HTTPS. The Node server itself only speaks plain HTTP, and adapter-node
 * reports every request as "https" when ORIGIN is not set, so event.url.protocol cannot be trusted here:
 * the answer comes from the proxy's X-Forwarded-Proto, or from ORIGIN.
 */
export function requestIsHttps(headers: Headers): boolean {
	const forwarded = headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
	if (forwarded) return forwarded === 'https';
	return (env.ORIGIN || '').toLowerCase().startsWith('https:');
}
