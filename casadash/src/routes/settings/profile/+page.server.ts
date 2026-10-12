import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import type { PageServerLoad, Actions } from './$types';
import { SESSION_COOKIE, deleteUserSessions } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
    return { user: locals.user };
};

export const actions: Actions = {
    updatePassword: async ({ request, locals, cookies }) => {
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
        
        if (newPassword.length < 6) {
            return fail(400, { error: 'La nuova password deve contenere almeno 6 caratteri' });
        }

        if (newPassword === currentPassword) {
            return fail(400, { error: 'La nuova password deve essere diversa da quella attuale' });
        }

        const userRecord = await db.select().from(users).where(eq(users.id, locals.user.id)).limit(1);
        if (userRecord.length === 0) return fail(400, { error: 'Utente non trovato' });

        const isValid = bcrypt.compareSync(currentPassword, userRecord[0].passwordHash.replace(/^\$2y\$/, '$2a$'));
        if (!isValid) return fail(400, { error: 'La password attuale è errata' });

        const newHash = bcrypt.hashSync(newPassword, 10);
        await db.update(users).set({ passwordHash: newHash, mustChangePassword: 0 }).where(eq(users.id, locals.user.id));
        // Sign out every other device that knew the old password
        await deleteUserSessions(locals.user.id, cookies.get(SESSION_COOKIE));

        return { success: true };
    },
    updateName: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        const data = await request.formData();
        const displayName = data.get('display_name')?.toString().trim();

        if (!displayName) return fail(400, { error: 'Il nome non può essere vuoto' });

        await db.update(users).set({ displayName }).where(eq(users.id, locals.user.id));

        return { profileSuccess: true };
    }
};
