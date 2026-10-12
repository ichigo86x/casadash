import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import bcrypt from 'bcryptjs';
import {
	MFA_COOKIE,
	SESSION_COOKIE,
	clearLoginFailures,
	createSession,
	deleteSession,
	loginLockedFor,
	registerLoginFailure,
	setAuthCookie,
	validateSession
} from '$lib/server/auth';
import { cookieSecure } from '$lib/server/config';
import { appUrl } from '$lib/server/ingress';

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
		const username = data.get('username')?.toString().trim();
		const password = data.get('password')?.toString();

        console.log(`[AUTH] Login attempt triggered for username: ${username}`);

		if (!username || !password) {
			console.log(`[AUTH] Missing fields!`);
			return fail(400, { error: 'Inserisci nome utente e password.' });
		}

		const throttleKey = `${getClientAddress()}|${username.toLowerCase()}`;
		const locked = loginLockedFor(throttleKey);
		if (locked) return fail(429, { error: lockedMessage(locked) });

		try {
			const userRecord = await db.select().from(users).where(eq(users.username, username)).limit(1);
			// Node's bcrypt prefers $2a$ or $2b$, PHP uses $2y$
			const isValid =
				userRecord.length > 0 &&
				bcrypt.compareSync(password, userRecord[0].passwordHash.replace(/^\$2y\$/, '$2a$'));

			if (!isValid) {
                console.log(`[AUTH] Invalid credentials for: ${username}`);
				registerLoginFailure(throttleKey);
				return fail(401, { error: 'Credenziali non valide.' });
			}
			clearLoginFailures(throttleKey);

			const secure = cookieSecure(url, request.headers);
			if (userRecord[0].totpSecret) {
                console.log(`[AUTH] Password OK. Escalate to MFA step.`);
				// The second step is bound to a short-lived server-side token, not to a client-supplied user id
				setAuthCookie(cookies, MFA_COOKIE, await createSession(userRecord[0].id, 'mfa'), secure);
				return { mfaRequired: true };
			}

			setAuthCookie(cookies, SESSION_COOKIE, await createSession(userRecord[0].id, 'session'), secure);
		} catch (err) {
			console.error("Login error:", err);
			return fail(500, { error: 'Errore interno del server.' });
		}

        throw redirect(303, appUrl(locals, '/'));
	},
	mfaVerify: async ({ request, cookies, url, locals, getClientAddress }) => {
		const data = await request.formData();
		const code = data.get('code')?.toString().replace(/\s+/g, '');
		const mfaToken = cookies.get(MFA_COOKIE);
		const user = await validateSession(mfaToken, 'mfa');

		if (!user || !user.totpSecret) {
			return fail(400, { error: 'Sessione di verifica scaduta, ripeti l\'accesso.' });
		}
		console.log(`[MFA-VERIFY] Code submitted for User ID: ${user.id}`);
		if (!code) return fail(400, { error: 'Inserisci il codice.', mfaRequired: true });

		const throttleKey = `${getClientAddress()}|mfa|${user.id}`;
		const locked = loginLockedFor(throttleKey);
		if (locked) return fail(429, { error: lockedMessage(locked), mfaRequired: true });

		const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totpSecret) });
		const isValid = totp.validate({ token: code, window: 1 }) !== null;

		if (!isValid) {
            console.log(`[MFA-VERIFY] Verification FAILED.`);
			registerLoginFailure(throttleKey);
            return fail(400, { error: 'Codice errato.', mfaRequired: true });
        }
		clearLoginFailures(throttleKey);

        console.log(`[MFA-VERIFY] OK. Creating session.`);
		await deleteSession(mfaToken);
		cookies.delete(MFA_COOKIE, { path: '/' });
		setAuthCookie(cookies, SESSION_COOKIE, await createSession(user.id, 'session'), cookieSecure(url, request.headers));

        throw redirect(303, appUrl(locals, '/'));
	},
	logout: async ({ cookies, locals }) => {
		await deleteSession(cookies.get(SESSION_COOKIE));
		cookies.delete(SESSION_COOKIE, { path: '/' });
		throw redirect(303, appUrl(locals, '/login'));
	}
};
