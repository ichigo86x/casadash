import { db } from '$lib/server/db';
import { users, categories, transactions, budgets, recurringTransactions, sessions, goals, goalContributions, assets, deadlines, bankConnections } from '$lib/server/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/roles';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { generatePassword, hashPassword } from '$lib/server/passwords';
import { passwordProblem } from '$lib/passwordPolicy';
import { deleteUserSessions } from '$lib/server/auth';
import { audit } from '$lib/server/audit';

export const load: PageServerLoad = async () => {
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
    addUser: async ({ request, locals, getClientAddress }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;

        const data = await request.formData();
        const username = data.get('username')?.toString().toLowerCase().trim();
        const displayName = data.get('display_name')?.toString().trim().slice(0, 60);
        const password = data.get('password')?.toString();
        const role = data.get('role')?.toString() === 'admin' ? 'admin' : 'member';

        if (!username || !displayName || !password) return fail(400, { error: 'Dati mancanti' });
        if (!/^[a-z0-9_-]{2,32}$/.test(username)) return fail(400, { error: 'Username: 2-32 caratteri tra lettere, numeri, trattini' });
        const problem = passwordProblem(password, username);
        if (problem) return fail(400, { error: problem });

        const exists = await db.select().from(users).where(eq(users.username, username)).limit(1);
        if (exists.length > 0) return fail(400, { error: 'Username già in uso' });

        try {
            await db.insert(users).values({
                username,
                displayName,
                passwordHash: await hashPassword(password),
                // The admin chose this password: the new member must replace it at first login
                mustChangePassword: 1,
                role,
                createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
            });
            await audit(locals.user, 'user.created', `${username} (${role})`, getClientAddress());
            return { success: true };
        } catch (e) {
            return fail(500, { error: 'Errore interno' });
        }
    },
    setRole: async ({ request, locals, getClientAddress }) => {
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
        await audit(locals.user, 'user.role', `#${id} → ${role}`, getClientAddress());
        return { success: true };
    },
    // Lost password: a random temporary one, shown once; the user must change it at the next login
    resetPassword: async ({ request, locals, getClientAddress }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const id = parseInt((await request.formData()).get('id')?.toString() || '0');
        const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!target) return fail(404, { error: 'Utente non trovato' });
        const temp = generatePassword();
        await db.update(users).set({ passwordHash: await hashPassword(temp), mustChangePassword: 1 }).where(eq(users.id, id));
        await deleteUserSessions(id);
        await audit(locals.user, 'user.password_reset', target.username, getClientAddress());
        return { tempPassword: temp, tempFor: target.displayName };
    },
    // Lost phone and recovery codes: turn off the second factor of that user
    resetMfa: async ({ request, locals, getClientAddress }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const id = parseInt((await request.formData()).get('id')?.toString() || '0');
        const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!target) return fail(404, { error: 'Utente non trovato' });
        await db.update(users).set({ totpSecret: null, totpLastStep: null, recoveryCodes: null }).where(eq(users.id, id));
        await deleteUserSessions(id);
        await audit(locals.user, 'user.mfa_reset', target.username, getClientAddress());
        return { success: true };
    },
    deleteUser: async ({ request, locals, getClientAddress }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');

        if (!id) return fail(400, { error: 'ID mancante' });
        if (id === locals.user!.id) return fail(400, { error: 'Non puoi eliminare te stesso!' });

        try {
            const me = locals.user!.id;
            // Transfer items to the deleting user to avoid foreign key violations
            await db.update(categories).set({ createdBy: me }).where(eq(categories.createdBy, id));
            await db.update(transactions).set({ createdBy: me }).where(eq(transactions.createdBy, id));
            await db.update(budgets).set({ createdBy: me }).where(eq(budgets.createdBy, id));
            await db.update(recurringTransactions).set({ createdBy: me }).where(eq(recurringTransactions.createdBy, id));
            await db.update(goals).set({ createdBy: me }).where(eq(goals.createdBy, id));
            await db.update(goalContributions).set({ createdBy: me }).where(eq(goalContributions.createdBy, id));
            await db.update(assets).set({ createdBy: me }).where(eq(assets.createdBy, id));
            await db.update(deadlines).set({ createdBy: me }).where(eq(deadlines.createdBy, id));
            await db.update(bankConnections).set({ createdBy: me }).where(eq(bankConnections.createdBy, id));
            await db.delete(sessions).where(eq(sessions.userId, id));

            const [target] = await db.select({ username: users.username }).from(users).where(eq(users.id, id));
            await db.delete(users).where(eq(users.id, id));
            await audit(locals.user, 'user.deleted', target?.username, getClientAddress());
            return { success: true };
        } catch (e) {
            return fail(500, { error: "Impossibile eliminare l'utente (potrebbe avere dati associati)." });
        }
    }
};
