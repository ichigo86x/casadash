import { db } from '$lib/server/db';
import { categories, transactions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getSetting, setSetting } from '$lib/server/settings';
import { TRANSFER_TAG } from '$lib/transfers';

export const load: PageServerLoad = async () => {
    const list = await db.select().from(categories).orderBy(categories.type, categories.name);
    const accountTags = await getSetting<string[]>('account_tags', []);
    return { categories: list, accountTags };
};

export const actions: Actions = {
    setAccounts: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        // Comma-separated list of the tags that name an account (e.g. "BNL, Poste, Libretto")
        const tags = (data.get('accounts')?.toString() || '')
            .split(',')
            .map((t) => t.trim())
            .filter((t, i, all) => t && all.indexOf(t) === i && t.toLowerCase() !== TRANSFER_TAG.toLowerCase());
        await setSetting('account_tags', tags);
        return { accountsSaved: true };
    },
    addCategory: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const name = data.get('name')?.toString();
        const type = data.get('type')?.toString() as 'income' | 'expense';
        const color = data.get('color')?.toString();
        const icon = data.get('icon')?.toString() || 'fa-tag';

        if (!name || !type || !color) return fail(400, { error: 'Dati mancanti' });

        try {
            await db.insert(categories).values({ name, type, color, icon, createdBy: locals.user.id });
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore nel salvataggio' });
        }
    },
    deleteCategory: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        if (!id) return fail(400, { error: 'ID mancante' });
        try {
            await db.delete(categories).where(eq(categories.id, id));
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore nella cancellazione' });
        }
    },
    editCategory: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        const name = data.get('name')?.toString();
        const color = data.get('color')?.toString();
        const icon = data.get('icon')?.toString() || 'fa-tag';

        if (!id || !name || !color) return fail(400, { error: 'Dati mancanti' });

        try {
            const oldCat = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
            if (oldCat.length === 0) return fail(404, { error: 'Categoria non trovata' });
            
            const oldName = oldCat[0].name;

            await db.update(categories).set({ name, color, icon }).where(eq(categories.id, id));

            if (oldName !== name) {
                await db.update(transactions).set({ category: name }).where(eq(transactions.category, oldName));
            }

            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore nella modifica' });
        }
    }
};
