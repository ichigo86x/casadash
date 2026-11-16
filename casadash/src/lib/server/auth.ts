import crypto from 'crypto';
import type { Cookies } from '@sveltejs/kit';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { loginFailures, sessions, users } from '$lib/server/db/schema';

export const SESSION_COOKIE = 'casadash_session';
export const MFA_COOKIE = 'casadash_mfa';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = 30 * DAY;
export const MFA_TTL = 5 * 60 * 1000;
const SEEN_EVERY = 5 * 60 * 1000;

type SessionKind = 'session' | 'mfa';

// Only the SHA-256 of the token is stored, so a leaked database does not leak live sessions.
function hashToken(token: string): string {
	return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: number, kind: SessionKind, meta: { ip?: string; userAgent?: string | null } = {}): Promise<string> {
	const token = crypto.randomBytes(32).toString('base64url');
	const now = Date.now();
	await db.insert(sessions).values({
		id: hashToken(token),
		userId,
		kind,
		createdAt: now,
		expiresAt: now + (kind === 'mfa' ? MFA_TTL : SESSION_TTL),
		ip: meta.ip ?? null,
		userAgent: meta.userAgent?.slice(0, 200) ?? null,
		lastSeen: now
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
	if (kind === 'session') {
		const patch: { expiresAt?: number; lastSeen?: number } = {};
		// Sliding expiry: extend long-lived sessions once they pass half their lifetime.
		if (row.session.expiresAt - now < SESSION_TTL / 2) patch.expiresAt = now + SESSION_TTL;
		if (!row.session.lastSeen || now - row.session.lastSeen > SEEN_EVERY) patch.lastSeen = now;
		if (patch.expiresAt || patch.lastSeen) await db.update(sessions).set(patch).where(eq(sessions.id, id));
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

/** Active sign-ins of a user, for the profile page. `handle` identifies a session in revokeSession. */
export async function listUserSessions(userId: number, currentToken: string | undefined) {
	const current = currentToken ? hashToken(currentToken) : '';
	const rows = await db
		.select()
		.from(sessions)
		.where(and(eq(sessions.userId, userId), eq(sessions.kind, 'session')))
		.orderBy(desc(sessions.lastSeen));
	return rows
		.filter((s) => s.expiresAt > Date.now())
		.map((s) => ({
			handle: s.id.slice(0, 16),
			ip: s.ip,
			userAgent: s.userAgent,
			createdAt: s.createdAt,
			lastSeen: s.lastSeen ?? s.createdAt,
			current: s.id === current
		}));
}

export async function revokeSession(userId: number, handle: string) {
	if (!/^[0-9a-f]{16}$/.test(handle)) return false;
	const rows = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), eq(sessions.kind, 'session')));
	const match = rows.find((r) => r.id.startsWith(handle));
	if (!match) return false;
	await db.delete(sessions).where(eq(sessions.id, match.id));
	return true;
}

export async function purgeExpiredSessions() {
	await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
	await db.delete(loginFailures).where(lt(loginFailures.until, Date.now()));
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

// --- Login throttling, kept in the database so a restart does not reset it ---
//
// Each attempt is counted under several keys: one for this client + this account (strict) and
// broader ones for the account alone and for the client alone, which stop a slow attack that
// rotates addresses or usernames. Behind a reverse proxy set ADDRESS_HEADER / XFF_DEPTH so the
// client address is the real one (see README).

export type Limit = { key: string; max: number };

const LOCK_MS = 15 * 60 * 1000;

/** Limits for a password attempt on `username` from `ip`. */
export const passwordLimits = (ip: string, username: string): Limit[] => [
	{ key: `pw|${ip}|${username.toLowerCase()}`, max: 5 },
	{ key: `pw-user|${username.toLowerCase()}`, max: 20 },
	{ key: `pw-ip|${ip}`, max: 40 }
];

/** Limits for a second-factor attempt of a user. */
export const mfaLimits = (ip: string, userId: number): Limit[] => [
	{ key: `mfa|${ip}|${userId}`, max: 5 },
	{ key: `mfa-user|${userId}`, max: 15 }
];

/** Milliseconds left on the longest active lock, or 0. */
export async function lockedFor(limits: Limit[]): Promise<number> {
	const now = Date.now();
	let left = 0;
	for (const l of limits) {
		const [row] = await db.select().from(loginFailures).where(eq(loginFailures.key, l.key)).limit(1);
		if (row && row.until > now && row.count >= l.max) left = Math.max(left, row.until - now);
	}
	return left;
}

export async function registerFailure(limits: Limit[]) {
	const now = Date.now();
	for (const l of limits) {
		const [row] = await db.select().from(loginFailures).where(eq(loginFailures.key, l.key)).limit(1);
		const count = row && row.until > now ? row.count + 1 : 1;
		await db
			.insert(loginFailures)
			.values({ key: l.key, count, until: now + LOCK_MS })
			.onConflictDoUpdate({ target: loginFailures.key, set: { count, until: now + LOCK_MS } });
	}
}

/** A successful attempt clears only the strict (client + account) counter. */
export async function clearFailures(limits: Limit[]) {
	if (limits[0]) await db.delete(loginFailures).where(eq(loginFailures.key, limits[0].key));
}
