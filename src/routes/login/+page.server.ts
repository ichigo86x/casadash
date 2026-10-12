import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import bcrypt from 'bcryptjs';

export const load: PageServerLoad = async ({ locals }) => {
	// If already logged in, go to home
	if (locals.user) {
		throw redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
	login: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = data.get('username')?.toString();
		const password = data.get('password')?.toString();

        console.log(`[AUTH] Login attempt triggered for username: ${username}`);

		if (!username || !password) {
			console.log(`[AUTH] Missing fields!`);
			return fail(400, { error: 'Inserisci nome utente e password.' });
		}

		try {
			const userRecord = await db.select().from(users).where(eq(users.username, username)).limit(1);
			if (userRecord.length === 0) {
                console.log(`[AUTH] User record not found for: ${username}`);
				return fail(401, { error: 'Credenziali non valide.' });
			}

            console.log(`[AUTH] Found user on DB. Calculating bcrypt hash match...`);
			// Node's bcrypt prefers $2a$ or $2b$, PHP uses $2y$
			const compatHash = userRecord[0].passwordHash.replace(/^\$2y\$/, '$2a$');
			const isValid = bcrypt.compareSync(password, compatHash);
            
			if (!isValid) {
                console.log(`[AUTH] Password mismatch for: ${username}`);
				return fail(401, { error: 'Credenziali non valide.' });
			}

			if (userRecord[0].totpSecret) {
                console.log(`[AUTH] Password OK. Escalate to MFA step.`);
				return { mfaRequired: true, tempUserId: userRecord[0].id };
			}

			cookies.set('auth_user', userRecord[0].id.toString(), {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
                secure: import.meta.env.PROD,
				maxAge: 60 * 60 * 24 * 30 // 30 days
			});

		} catch (err) {
			console.error("Login error:", err);
			return fail(500, { error: 'Errore interno del server.' });
		}

        throw redirect(303, '/');
	},
	mfaVerify: async ({ request, cookies }) => {
		const data = await request.formData();
		let code = data.get('code')?.toString();
		const tempUserId = parseInt(data.get('tempUserId')?.toString() || '0');
        
		console.log(`[MFA-VERIFY] Code submitted for User ID: ${tempUserId}`);

		if (!code || !tempUserId) return fail(400, { error: 'Dati mancanti per MFA' });

		code = code.replace(/\s+/g, '');

		const uResult = await db.select().from(users).where(eq(users.id, tempUserId)).limit(1);
		if (uResult.length === 0 || !uResult[0].totpSecret) return fail(400, { error: 'Utente non valido' });

		const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(uResult[0].totpSecret) });
		const isValid = totp.validate({ token: code, window: 1 }) !== null;
		
		if (!isValid) {
            console.log(`[MFA-VERIFY] Verification FAILED.`);
            return fail(400, { error: 'Codice errato.', mfaRequired: true, tempUserId });
        }

        console.log(`[MFA-VERIFY] OK. Setting session wrapper cookies...`);
		cookies.set('auth_user', tempUserId.toString(), {
			path: '/', httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD, maxAge: 60 * 60 * 24 * 30
		});

        throw redirect(303, '/');
	},
	logout: async ({ cookies }) => {
		cookies.delete('auth_user', { path: '/' });
		throw redirect(303, '/login');
	}
};
