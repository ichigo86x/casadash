import { db } from '$lib/server/db';
import { recurringTransactions, categories } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { upcomingRecurring } from '$lib/server/wealth';
import { getSetting } from '$lib/server/settings';
import { isValidDate, parseAmount } from '$lib/validate';
import { detectSubscriptions } from '$lib/subscriptions';
import { descriptionKey } from '$lib/import';
import { transactions } from '$lib/server/db/schema';
import { and, gte, sql } from 'drizzle-orm';
import { localDateString } from '$lib/dates';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) return { jobs: [], categories: [], summary: {}, upcoming: [], detected: [] };

    const jobs = await db.select().from(recurringTransactions).where(eq(recurringTransactions.createdBy, locals.user.id));
    const dbCategories = await db.select().from(categories);

    // Build summary per frequency for active jobs
    const activeJobs = jobs.filter(j => j.isActive === 1);
    const freqLabels: Record<string, string> = { daily: 'Giornaliero', weekly: 'Settimanale', monthly: 'Mensile', yearly: 'Annuale' };
    const freqToMonthlyFactor: Record<string, number> = { daily: 30, weekly: 4.33, monthly: 1, yearly: 1/12 };
    
    const summary: Record<string, { label: string; income: number; expense: number; annualIncome: number; annualExpense: number }> = {};
    for (const freq of ['daily', 'weekly', 'monthly', 'yearly']) {
        const freqJobs = activeJobs.filter(j => j.frequency === freq);
        const income = freqJobs.filter(j => j.type === 'income').reduce((s, j) => s + j.amount, 0);
        const expense = freqJobs.filter(j => j.type === 'expense').reduce((s, j) => s + j.amount, 0);
        const factor = freqToMonthlyFactor[freq];
        summary[freq] = {
            label: freqLabels[freq],
            income,
            expense,
            annualIncome: income * factor * 12,
            annualExpense: expense * factor * 12
        };
    }

    // Family calendar: everyone's active schedules, not only the current user's
    const upcoming = await upcomingRecurring(await getSetting<string[]>('account_tags', []));

    // Subscriptions hiding in the last two years of spending that are not automated yet
    const today = localDateString();
    const since = localDateString(new Date(new Date().getFullYear() - 2, new Date().getMonth(), 1));
    const history = await db.select({ description: transactions.description, amount: transactions.amount, date: transactions.date, type: transactions.type, category: transactions.category, tags: transactions.tags })
        .from(transactions).where(and(sql`${transactions.type} = 'expense'`, gte(transactions.date, since))).limit(30000);
    const allJobs = await db.select({ description: recurringTransactions.description }).from(recurringTransactions);
    const detected = detectSubscriptions(
        history.map((h) => ({ ...h, tags: (() => { try { return JSON.parse(h.tags || '[]'); } catch { return []; } })() })),
        new Set(allJobs.map((j) => descriptionKey(j.description))),
        today
    ).slice(0, 12);
    return { jobs, categories: dbCategories, summary, upcoming, detected };
};

export const actions: Actions = {
    addJob: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        const data = await request.formData();
        const description = data.get('description')?.toString();
        const type = data.get('type')?.toString();
        const amountStr = data.get('amount')?.toString();
        const category = data.get('category')?.toString() || 'Altro';
        const paymentMethod = data.get('payment_method')?.toString() || 'bancomat';
        const frequency = data.get('frequency')?.toString();
        const nextDate = data.get('next_date')?.toString();

        if (!description || !type || !amountStr || !frequency || !nextDate) {
            return fail(400, { error: 'Dati mancanti' });
        }

        const amount = parseAmount(amountStr);
        if (amount === null) return fail(400, { error: 'Importo non valido' });
        if (!isValidDate(nextDate) || !['daily', 'weekly', 'monthly', 'yearly'].includes(frequency) || !['income', 'expense'].includes(type)) {
            return fail(400, { error: 'Dati non validi' });
        }

        const tagsJson = data.get('tags')?.toString() || '[]';
        let tagsArr = [];
        try { tagsArr = JSON.parse(tagsJson); } catch (e) {}
        if (!tagsArr.includes('Ricorrente')) tagsArr.push('Ricorrente');

        try {
            await db.insert(recurringTransactions).values({
                description,
                type: type as 'income'|'expense',
                amount,
                category,
                paymentMethod,
                frequency: frequency as any,
                nextDate,
                anchorDay: parseInt(nextDate.slice(8, 10)),
                tags: JSON.stringify(tagsArr),
                createdBy: locals.user.id
            });
            return { success: true };
        } catch (e) {
            return fail(500, { error: 'Errore durante il salvataggio' });
        }
    },
    deleteJob: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        
        if (!id) return fail(400, { error: 'ID Mancante' });

        try {
            await db.delete(recurringTransactions).where(eq(recurringTransactions.id, id));
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore eliminazione' });
        }
    },
    toggleJob: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        const currentState = parseInt(data.get('current_state')?.toString() || '1');
        
        if (!id) return fail(400, { error: 'ID Mancante' });

        try {
            await db.update(recurringTransactions).set({ isActive: currentState === 1 ? 0 : 1 }).where(eq(recurringTransactions.id, id));
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore modifica stato' });
        }
    },
    editJob: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        if (!id) return fail(400, { error: 'ID Mancante' });

        const description = data.get('description')?.toString();
        const type = data.get('type')?.toString();
        const amountStr = data.get('amount')?.toString();
        const category = data.get('category')?.toString() || 'Altro';
        const paymentMethod = data.get('payment_method')?.toString() || 'bancomat';
        const frequency = data.get('frequency')?.toString();
        const nextDate = data.get('next_date')?.toString();
        const tagsJson = data.get('tags')?.toString() || '[]';

        if (!description || !type || !amountStr || !frequency || !nextDate) {
            return fail(400, { error: 'Dati mancanti' });
        }

        const amount = parseAmount(amountStr);
        if (amount === null) return fail(400, { error: 'Importo non valido' });
        if (!isValidDate(nextDate) || !['daily', 'weekly', 'monthly', 'yearly'].includes(frequency) || !['income', 'expense'].includes(type)) {
            return fail(400, { error: 'Dati non validi' });
        }

        let tagsArr = [];
        try { tagsArr = JSON.parse(tagsJson); } catch (e) {}
        if (!tagsArr.includes('Ricorrente')) tagsArr.push('Ricorrente');

        try {
            await db.update(recurringTransactions).set({
                description,
                type: type as 'income'|'expense',
                amount,
                category,
                paymentMethod,
                frequency: frequency as any,
                nextDate,
                // Editing the date re-anchors the schedule on the chosen day
                anchorDay: parseInt(nextDate.slice(8, 10)),
                tags: JSON.stringify(tagsArr)
            }).where(eq(recurringTransactions.id, id));
            return { success: true };
        } catch (e) {
            return fail(500, { error: 'Errore durante l\'aggiornamento' });
        }
    }
};
