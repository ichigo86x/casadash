import crypto from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import { and, eq, lt, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';

export const SESSION_COOKIE = 'casadash_session';
export const MFA_COOKIE = 'casadash_mfa';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = 30 * DAY;
export const MFA_TTL = 5 * 60 * 1000;

type SessionKind = 'session' | 'mfa';

// Only the SHA-256 of the token is stored, so a leaked database does not leak live sessions.
function hashToken(token: string): string {
	return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: number, kind: SessionKind): Promise<string> {
	const token = crypto.randomBytes(32).toString('base64url');
	const now = Date.now();
	await db.insert(sessions).values({
		id: hashToken(token),
		userId,
		kind,
		createdAt: now,
		expiresAt: now + (kind === 'mfa' ? MFA_TTL : SESSION_TTL)
	});
	return token;
}

/** Returns the user owning a valid session of the given kind, or null. */
export async function validateSession(token: string | undefined, kind: SessionKind) {
	if (!token) return null;
	const id = hashToken(token);
	const rows = await db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.id, id), eq(sessions.kind, kind)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;

	const now = Date.now();
	if (row.session.expiresAt <= now) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}
	// Sliding expiry: extend long-lived sessions once they pass half their lifetime.
	if (kind === 'session' && row.session.expiresAt - now < SESSION_TTL / 2) {
		await db.update(sessions).set({ expiresAt: now + SESSION_TTL }).where(eq(sessions.id, id));
	}
	return row.user;
}

export async function deleteSession(token: string | undefined) {
	if (!token) return;
	await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Logs a user out everywhere, optionally keeping the current session. */
export async function deleteUserSessions(userId: number, keepToken?: string) {
	await db
		.delete(sessions)
		.where(
			keepToken
				? and(eq(sessions.userId, userId), ne(sessions.id, hashToken(keepToken)))
				: eq(sessions.userId, userId)
		);
}

export async function purgeExpiredSessions() {
	await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
}

export function setAuthCookie(cookies: Cookies, name: string, token: string, secure: boolean) {
	cookies.set(name, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: (name === MFA_COOKIE ? MFA_TTL : SESSION_TTL) / 1000
	});
}

// --- Login throttling (in memory, per client address + username) ---

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; until: number }>();

export function loginLockedFor(key: string): number {
	const entry = failures.get(key);
	if (!entry) return 0;
	const left = entry.until - Date.now();
	if (left <= 0) {
		if (entry.count >= MAX_FAILURES) failures.delete(key);
		return 0;
	}
	return entry.count >= MAX_FAILURES ? left : 0;
}

export function registerLoginFailure(key: string) {
	const now = Date.now();
	const entry = failures.get(key);
	if (!entry || entry.until <= now) {
		failures.set(key, { count: 1, until: now + LOCK_MS });
	} else {
		entry.count++;
		entry.until = now + LOCK_MS;
	}
}

export function clearLoginFailures(key: string) {
	failures.delete(key);
}
