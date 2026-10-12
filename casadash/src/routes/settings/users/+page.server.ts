import { db } from '$lib/server/db';
import { users, categories, transactions, budgets, recurringTransactions, sessions, goals, goalContributions } from '$lib/server/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/roles';
import { fail } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    // Expose only whether MFA is on, never the TOTP secret itself
    const allUsers = await db.select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
        hasMfa: sql<number>`${users.totpSecret} IS NOT NULL`
    }).from(users);
    
    return { users: allUsers };
};

export const actions: Actions = {
    addUser: async ({ request, locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        
        const data = await request.formData();
        const username = data.get('username')?.toString().toLowerCase().trim();
        const displayName = data.get('display_name')?.toString().trim();
        const password = data.get('password')?.toString();
        const role = data.get('role')?.toString() === 'admin' ? 'admin' : 'member';

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
                // The admin chose this password: the new member must replace it at first login
                mustChangePassword: 1,
                role,
                createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
            });
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore interno' });
        }
    },
    setRole: async ({ request, locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        const role = data.get('role')?.toString() === 'admin' ? 'admin' : 'member';
        if (!id) return fail(400, { error: 'ID mancante' });

        if (role === 'member') {
            const otherAdmins = await db.select({ id: users.id }).from(users)
                .where(and(eq(users.role, 'admin'), ne(users.id, id)));
            if (otherAdmins.length === 0) return fail(400, { error: 'Deve restare almeno un amministratore.' });
        }
        await db.update(users).set({ role }).where(eq(users.id, id));
        return { success: true };
    },
    deleteUser: async ({ request, locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        
        if (!id) return fail(400, { error: 'ID mancante' });
        if (id === locals.user!.id) return fail(400, { error: 'Non puoi eliminare te stesso!' });

        try {
            // Transfer items to the deleting user to avoid foreign key violations
            await db.update(categories).set({ createdBy: locals.user!.id }).where(eq(categories.createdBy, id));
            await db.update(transactions).set({ createdBy: locals.user!.id }).where(eq(transactions.createdBy, id));
            await db.update(budgets).set({ createdBy: locals.user!.id }).where(eq(budgets.createdBy, id));
            await db.update(recurringTransactions).set({ createdBy: locals.user!.id }).where(eq(recurringTransactions.createdBy, id));
            await db.update(goals).set({ createdBy: locals.user!.id }).where(eq(goals.createdBy, id));
            await db.update(goalContributions).set({ createdBy: locals.user!.id }).where(eq(goalContributions.createdBy, id));
            await db.delete(sessions).where(eq(sessions.userId, id));

            await db.delete(users).where(eq(users.id, id));
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Impossibile eliminare l\'utente (potrebbe avere transazioni associate).' });
        }
    }
};
