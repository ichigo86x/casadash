import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { SESSION_COOKIE, deleteUserSessions, listUserSessions, lockedFor, passwordLimits, registerFailure, revokeSession } from '$lib/server/auth';
import { hashPassword, verifyPassword } from '$lib/server/passwords';
import { passwordProblem } from '$lib/passwordPolicy';
import { audit } from '$lib/server/audit';

export const load: PageServerLoad = async ({ locals, cookies }) => {
    const [me] = locals.user ? await db.select({ haUserId: users.haUserId }).from(users).where(eq(users.id, locals.user.id)) : [];
    return {
        user: locals.user,
        // Present only when the page is opened from the Home Assistant sidebar (trusted Ingress request)
        haUser: locals.haUser,
        haLinked: !!me?.haUserId,
        haLinkedToThis: !!me?.haUserId && me.haUserId === locals.haUser?.id,
        sessions: locals.user ? await listUserSessions(locals.user.id, cookies.get(SESSION_COOKIE)) : []
    };
};

export const actions: Actions = {
    updatePassword: async ({ request, locals, cookies, getClientAddress }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        const data = await request.formData();
        const currentPassword = data.get('current_password')?.toString();
        const newPassword = data.get('new_password')?.toString();
        const confirmPassword = data.get('confirm_password')?.toString();

        if (!currentPassword || !newPassword || !confirmPassword) {
            return fail(400, { error: 'Compila tutti i campi' });
        }
        if (newPassword !== confirmPassword) {
            return fail(400, { error: 'Le nuove password non corrispondono' });
        }
        const problem = passwordProblem(newPassword, locals.user.username);
        if (problem) return fail(400, { error: problem });
        if (newPassword === currentPassword) {
            return fail(400, { error: 'La nuova password deve essere diversa da quella attuale' });
        }

        // The current password is re-checked: a stolen session alone cannot change it. Same throttling as the login.
        const ip = getClientAddress();
        const limits = passwordLimits(ip, locals.user.username);
        const locked = await lockedFor(limits);
        if (locked) return fail(429, { error: `Troppi tentativi. Riprova tra ${Math.ceil(locked / 60000)} minuti.` });

        const [record] = await db.select().from(users).where(eq(users.id, locals.user.id)).limit(1);
        if (!record) return fail(400, { error: 'Utente non trovato' });
        if (!(await verifyPassword(currentPassword, record.passwordHash))) {
            await registerFailure(limits);
            return fail(400, { error: 'La password attuale è errata' });
        }

        await db.update(users).set({ passwordHash: await hashPassword(newPassword), mustChangePassword: 0 }).where(eq(users.id, locals.user.id));
        // Sign out every other device that knew the old password
        await deleteUserSessions(locals.user.id, cookies.get(SESSION_COOKIE));
        await audit(locals.user, 'password.changed', undefined, ip);

        return { success: true };
    },
    revokeSession: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const handle = (await request.formData()).get('handle')?.toString() || '';
        await revokeSession(locals.user.id, handle);
        return { sessionsSaved: true };
    },
    revokeOthers: async ({ locals, cookies, getClientAddress }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        await deleteUserSessions(locals.user.id, cookies.get(SESSION_COOKIE));
        await audit(locals.user, 'sessions.revoked_all', undefined, getClientAddress());
        return { sessionsSaved: true };
    },
    linkHa: async ({ locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        if (!locals.haUser) return fail(400, { error: 'Apri CasaDash dalla barra laterale di Home Assistant per collegare il tuo utente.' });
        // One CasaDash account per Home Assistant user
        await db.update(users).set({ haUserId: null }).where(eq(users.haUserId, locals.haUser.id));
        await db.update(users).set({ haUserId: locals.haUser.id }).where(eq(users.id, locals.user.id));
        return { haSaved: true };
    },
    unlinkHa: async ({ locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        await db.update(users).set({ haUserId: null }).where(eq(users.id, locals.user.id));
        return { haSaved: true };
    },
    updateName: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        const data = await request.formData();
        const displayName = data.get('display_name')?.toString().trim().slice(0, 60);

        if (!displayName) return fail(400, { error: 'Il nome non può essere vuoto' });

        await db.update(users).set({ displayName }).where(eq(users.id, locals.user.id));

        return { profileSuccess: true };
    }
};
