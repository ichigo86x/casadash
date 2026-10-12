import { db } from '$lib/server/db';
import { users, categories, transactions, budgets } from '$lib/server/db/schema';
import { eq, ne } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    // For security, only see other users if logged in
    const allUsers = await db.select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        createdAt: users.createdAt,
        hasMfa: users.totpSecret
    }).from(users);
    
    return { users: allUsers };
};

export const actions: Actions = {
    addUser: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        
        const data = await request.formData();
        const username = data.get('username')?.toString().toLowerCase().trim();
        const displayName = data.get('display_name')?.toString().trim();
        const password = data.get('password')?.toString();

        if (!username || !displayName || !password) return fail(400, { error: 'Dati mancanti' });

        if (password.length < 6) return fail(400, { error: 'Password troppo corta (minimo 6)' });

        // Check if exists
        const exists = await db.select().from(users).where(eq(users.username, username)).limit(1);
        if (exists.length > 0) return fail(400, { error: 'Username già in uso' });

        try {
            const passwordHash = bcrypt.hashSync(password, 10);
            await db.insert(users).values({
                username,
                displayName,
                passwordHash,
                createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
            });
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore interno' });
        }
    },
    deleteUser: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        
        if (!id) return fail(400, { error: 'ID mancante' });
        if (id === locals.user.id) return fail(400, { error: 'Non puoi eliminare te stesso!' });

        try {
            // Transfer items to the deleting user to avoid foreign key violations
            await db.update(categories).set({ createdBy: locals.user.id }).where(eq(categories.createdBy, id));
            await db.update(transactions).set({ createdBy: locals.user.id }).where(eq(transactions.createdBy, id));
            await db.update(budgets).set({ createdBy: locals.user.id }).where(eq(budgets.createdBy, id));

            await db.delete(users).where(eq(users.id, id));
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Impossibile eliminare l\'utente (potrebbe avere transazioni associate).' });
        }
    }
};
