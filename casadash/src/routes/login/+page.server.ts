import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	MFA_COOKIE,
	SESSION_COOKIE,
	clearFailures,
	createSession,
	deleteSession,
	lockedFor,
	mfaLimits,
	passwordLimits,
	registerFailure,
	setAuthCookie,
	validateSession
} from '$lib/server/auth';
import { cookieSecure } from '$lib/server/config';
import { appUrl } from '$lib/server/ingress';
import { verifyPassword } from '$lib/server/passwords';
import { verifySecondFactor } from '$lib/server/mfa';
import { audit } from '$lib/server/audit';

export const load: PageServerLoad = async ({ locals }) => {
	// If already logged in, go to home
	if (locals.user) {
		throw redirect(303, appUrl(locals, '/'));
	}
	return {};
};

function lockedMessage(ms: number) {
	return `Troppi tentativi falliti. Riprova tra ${Math.ceil(ms / 60000)} minuti.`;
}

export const actions: Actions = {
	login: async ({ request, cookies, url, locals, getClientAddress }) => {
		const data = await request.formData();
		const username = data.get('username')?.toString().trim().toLowerCase();
		const password = data.get('password')?.toString();

		if (!username || !password) return fail(400, { error: 'Inserisci nome utente e password.' });

		const ip = getClientAddress();
		const limits = passwordLimits(ip, username);
		const locked = await lockedFor(limits);
		if (locked) return fail(429, { error: lockedMessage(locked) });

		try {
			const [record] = await db.select().from(users).where(eq(users.username, username)).limit(1);
			// Always runs bcrypt, even for an unknown user, so response times do not reveal which accounts exist
			const isValid = await verifyPassword(password, record?.passwordHash);

			if (!record || !isValid) {
				await registerFailure(limits);
				await audit(record ? { id: record.id, username: record.username } : null, 'login.failed', record ? undefined : `utente inesistente: ${username.slice(0, 40)}`, ip);
				return fail(401, { error: 'Credenziali non valide.' });
			}
			await clearFailures(limits);

			const secure = cookieSecure(url, request.headers);
			if (record.totpSecret) {
				// The second step is bound to a short-lived server-side token, not to a client-supplied user id
				setAuthCookie(cookies, MFA_COOKIE, await createSession(record.id, 'mfa', { ip }), secure);
				return { mfaRequired: true };
			}

			setAuthCookie(cookies, SESSION_COOKIE, await createSession(record.id, 'session', { ip, userAgent: request.headers.get('user-agent') }), secure);
			await audit({ id: record.id, username: record.username }, 'login.ok', undefined, ip);
		} catch (err) {
			console.error('Login error:', err);
			return fail(500, { error: 'Errore interno del server.' });
		}

		throw redirect(303, appUrl(locals, '/'));
	},
	mfaVerify: async ({ request, cookies, url, locals, getClientAddress }) => {
		const data = await request.formData();
		const code = data.get('code')?.toString().trim();
		const mfaToken = cookies.get(MFA_COOKIE);
		const user = await validateSession(mfaToken, 'mfa');

		if (!user || !user.totpSecret) {
			return fail(400, { error: "Sessione di verifica scaduta, ripeti l'accesso." });
		}
		if (!code) return fail(400, { error: 'Inserisci il codice.', mfaRequired: true });

		const ip = getClientAddress();
		const limits = mfaLimits(ip, user.id);
		const locked = await lockedFor(limits);
		if (locked) return fail(429, { error: lockedMessage(locked), mfaRequired: true });

		if (!(await verifySecondFactor(user, code))) {
			await registerFailure(limits);
			await audit({ id: user.id, username: user.username }, 'mfa.failed', undefined, ip);
			return fail(400, { error: 'Codice errato.', mfaRequired: true });
		}
		await clearFailures(limits);

		await deleteSession(mfaToken);
		cookies.delete(MFA_COOKIE, { path: '/' });
		setAuthCookie(cookies, SESSION_COOKIE, await createSession(user.id, 'session', { ip, userAgent: request.headers.get('user-agent') }), cookieSecure(url, request.headers));
		await audit({ id: user.id, username: user.username }, 'login.ok', 'con MFA', ip);

		throw redirect(303, appUrl(locals, '/'));
	},
	logout: async ({ cookies, locals }) => {
		await deleteSession(cookies.get(SESSION_COOKIE));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		throw redirect(303, appUrl(locals, '/login'));
	}
};
