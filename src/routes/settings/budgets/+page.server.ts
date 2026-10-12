import { db } from '$lib/server/db';
import { budgets, categories } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
    if (!locals.user) return { budgets: [], annualCategoryBudgets: [], categories: [], annualBudget: 0, currentYear: new Date().getFullYear(), currentMonth: new Date().getMonth() + 1 };
    
    let year = parseInt(url.searchParams.get('year') || new Date().getFullYear().toString());
    let monthRaw = url.searchParams.get('month');
    let month = monthRaw ? parseInt(monthRaw) : (new Date().getMonth() + 1);

    // Monthly TOTAL budget (category='Totale')
    const monthBudgets = await db.select().from(budgets).where(
        and(
            eq(budgets.periodType, 'monthly'),
            eq(budgets.year, year),
            eq(budgets.month, month)
        )
    );

    // Annual TOTAL budget (category='Totale')
    const annualBudgets = await db.select().from(budgets).where(
        and(
            eq(budgets.periodType, 'annual'),
            eq(budgets.year, year),
            eq(budgets.category, 'Totale')
        )
    ).limit(1);

    // Annual PER-CATEGORY budgets (periodType = 'annual-category')
    const annualCategoryBudgets = await db.select().from(budgets).where(
        and(
            eq(budgets.periodType, 'annual-category'),
            eq(budgets.year, year)
        )
    );

    const dbCategories = await db.select().from(categories).where(eq(categories.type, 'expense'));
    return {
        budgets: monthBudgets,
        annualCategoryBudgets,
        annualBudget: annualBudgets[0]?.amount || 0,
        categories: dbCategories,
        currentYear: year,
        currentMonth: month
    };
};

export const actions: Actions = {
    setCategoryBudget: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const year = parseInt(data.get('year')?.toString() || '0');
        const month = parseInt(data.get('month')?.toString() || '0');
        const category = data.get('category')?.toString() || 'Totale';
        const amount = parseFloat(data.get('amount')?.toString() || '0');

        if (!year || !month) return fail(400, { error: 'Dati mancanti' });

        try {
            const existing = await db.select().from(budgets).where(
                and(
                    eq(budgets.periodType, 'monthly'),
                    eq(budgets.year, year),
                    eq(budgets.month, month),
                    eq(budgets.category, category)
                )
            ).limit(1);

            if (amount <= 0) {
                if (existing.length > 0) await db.delete(budgets).where(eq(budgets.id, existing[0].id));
            } else {
                if (existing.length > 0) {
                    await db.update(budgets).set({ amount, updatedAt: new Date().toISOString() }).where(eq(budgets.id, existing[0].id));
                } else {
                    await db.insert(budgets).values({ periodType: 'monthly', year, month, category, amount, createdBy: locals.user.id, updatedAt: new Date().toISOString() });
                }
            }
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore salvataggio' });
        }
    },
    setAnnualBudget: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const year = parseInt(data.get('year')?.toString() || '0');
        const amount = parseFloat(data.get('amount')?.toString() || '0');

        if (!year) return fail(400, { error: 'Dati mancanti' });

        try {
            const existing = await db.select().from(budgets).where(
                and(eq(budgets.periodType, 'annual'), eq(budgets.year, year), eq(budgets.category, 'Totale'))
            ).limit(1);

            if (amount <= 0) {
                if (existing.length > 0) await db.delete(budgets).where(eq(budgets.id, existing[0].id));
            } else {
                if (existing.length > 0) {
                    await db.update(budgets).set({ amount, updatedAt: new Date().toISOString() }).where(eq(budgets.id, existing[0].id));
                } else {
                    await db.insert(budgets).values({ periodType: 'annual', year, month: 0, category: 'Totale', amount, createdBy: locals.user.id, updatedAt: new Date().toISOString() });
                }
            }
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore salvataggio' });
        }
    },
    setAnnualCategoryBudget: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const year = parseInt(data.get('year')?.toString() || '0');
        const category = data.get('category')?.toString() || '';
        const amount = parseFloat(data.get('amount')?.toString() || '0');

        if (!year || !category) return fail(400, { error: 'Dati mancanti' });

        try {
            const existing = await db.select().from(budgets).where(
                and(eq(budgets.periodType, 'annual-category'), eq(budgets.year, year), eq(budgets.category, category))
            ).limit(1);

            if (amount <= 0) {
                if (existing.length > 0) await db.delete(budgets).where(eq(budgets.id, existing[0].id));
            } else {
                if (existing.length > 0) {
                    await db.update(budgets).set({ amount, updatedAt: new Date().toISOString() }).where(eq(budgets.id, existing[0].id));
                } else {
                    await db.insert(budgets).values({ periodType: 'annual-category', year, month: 0, category, amount, createdBy: locals.user.id, updatedAt: new Date().toISOString() });
                }
            }
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore salvataggio' });
        }
    }
}
