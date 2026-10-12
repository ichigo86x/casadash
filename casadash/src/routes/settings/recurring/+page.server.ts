import { db } from '$lib/server/db';
import { recurringTransactions, categories } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) return { jobs: [], categories: [], summary: {} };

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

    return { jobs, categories: dbCategories, summary };
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

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Importo non valido' });

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

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Importo non valido' });

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
                tags: JSON.stringify(tagsArr)
            }).where(eq(recurringTransactions.id, id));
            return { success: true };
        } catch (e) {
            return fail(500, { error: 'Errore durante l\'aggiornamento' });
        }
    }
};
