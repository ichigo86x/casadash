import { db } from '$lib/server/db';
import { transactions, budgets, categories, users } from '$lib/server/db/schema';
import { desc, eq, and, sql, isNull } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { InvalidReceiptError, saveReceipt } from '$lib/server/receipts';

export const load: PageServerLoad = async ({ locals }) => {
	const now = new Date();
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth() + 1;
	const currentYearStr = String(currentYear).padStart(4, '0');
	const currentMonthStr = String(currentMonth).padStart(2, '0');

	// 1. All Transactions for global totals (ordered for client-side pagination)
	const allT = await db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.id));
	
	let totalIncome = 0; let totalExpenses = 0;
	let monthExpenses = 0; let yearExpenses = 0;
	const monthCategoryExpenses: Record<string, number> = {};

	// Chart Data specific
	const categoryTotals: Record<string, { income: number, expense: number }> = {};
	
	// Trend Data (Last 30 days)
	const trendData: Record<string, { income: number, expense: number }> = {};
	const today = new Date();
	for (let i = 29; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		trendData[d.toISOString().split('T')[0]] = { income: 0, expense: 0 };
	}

	const uniqueDescriptions = new Set<string>();
	const uniqueTags = new Set<string>();

	for (const t of allT) {
		uniqueDescriptions.add(t.description);
		try {
			const parsedTags = JSON.parse(t.tags || '[]');
			if (Array.isArray(parsedTags)) {
				parsedTags.forEach(tag => uniqueTags.add(tag));
			}
		} catch(e) {}

		const tYear = t.date.substring(0, 4);
		const tMonth = t.date.substring(5, 7);

		if (t.type === 'income') totalIncome += t.amount;
		if (t.type === 'expense') {
			totalExpenses += t.amount;
			if (tYear === currentYearStr) yearExpenses += t.amount;
			if (tYear === currentYearStr && tMonth === currentMonthStr) {
				monthExpenses += t.amount;
				monthCategoryExpenses[t.category] = (monthCategoryExpenses[t.category] || 0) + t.amount;
			}
		}

		// Category aggregation
		if (!categoryTotals[t.category]) categoryTotals[t.category] = { income: 0, expense: 0 };
		if (t.type === 'income') categoryTotals[t.category].income += t.amount;
		else categoryTotals[t.category].expense += t.amount;

		// Trend aggregation
		if (trendData[t.date]) {
			if (t.type === 'income') trendData[t.date].income += t.amount;
			else trendData[t.date].expense += t.amount;
		}
	}

	// 2. Budgets
	const mbResult = await db.select().from(budgets).where(
		and(eq(budgets.periodType, 'monthly'), eq(budgets.year, currentYear), eq(budgets.month, currentMonth))
	);
	const abResult = await db.select().from(budgets).where(
		and(eq(budgets.periodType, 'annual'), eq(budgets.year, currentYear))
	).limit(1);

	let monthlyBudget = 0;
	let monthlyId = null;
	const budgetWarnings: { category: string, spent: number, limit: number, pct: number }[] = [];

	for (const b of mbResult) {
		if (b.category === 'Totale' || !b.category) {
			monthlyBudget = b.amount;
			monthlyId = b.id;
		} else {
			const spent = monthCategoryExpenses[b.category] || 0;
			const pct = (spent / b.amount) * 100;
			if (pct > 80) { // Notice user if nearing or exceeding limit
				budgetWarnings.push({ category: b.category, spent, limit: b.amount, pct });
			}
		}
	}
	budgetWarnings.sort((a, b) => b.pct - a.pct);

	const annualBudget = abResult[0]?.amount || 0;

	// 3. Recent Transactions (limit 15)
	const recentT = await db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.id)).limit(15);

	// 4. Monthly Chart Data (for current year)
	const monthlyChart = { income: Array(12).fill(0), expense: Array(12).fill(0) };
	for (const t of allT) {
		if (t.date.substring(0, 4) === currentYearStr) {
			const mIdx = parseInt(t.date.substring(5, 7)) - 1;
			if (t.type === 'income') monthlyChart.income[mIdx] += t.amount;
			else monthlyChart.expense[mIdx] += t.amount;
		}
	}

	// Format category data for chart
	const chartCategoryLabels = Object.keys(categoryTotals);
	const chartCategoryExpenses = chartCategoryLabels.map(c => categoryTotals[c].expense);
	const chartCategoryIncomes = chartCategoryLabels.map(c => categoryTotals[c].income);

	// Format trend data
	const trendLabels = Object.keys(trendData);
	const trendIncome = trendLabels.map(d => trendData[d].income);
	const trendExpense = trendLabels.map(d => trendData[d].expense);

	// Load dynamic categories
	const dbCategories = await db.select().from(categories);
	const incomeCats = dbCategories.filter(c => c.type === 'income');
	const expenseCats = dbCategories.filter(c => c.type === 'expense');

	const dbUsers = await db.select({ id: users.id, displayName: users.displayName }).from(users);

	// 5. CC unsettled transactions (settled = 0, NO date filter – overall outstanding)
	const ccUnsettled = allT.filter(t => t.paymentMethod === 'credit_card' && t.settled === 0);
	const ccUnsettledTotal = ccUnsettled.reduce((s, t) => s + t.amount, 0);

	// Find the date of the last settled CC transaction (to pre-fill the bulk-settle from-date)
	const settledCC = allT
		.filter(t => t.paymentMethod === 'credit_card' && t.settled === 1)
		.sort((a, b) => b.date.localeCompare(a.date));
	const lastSettledDate = settledCC[0]?.date || null;

	return {
		currentYear,
		currentMonth,
		summary: {
			totalIncome,
			totalExpenses,
			balance: totalIncome - totalExpenses,
			monthExpenses,
			yearExpenses
		},
		budget: {
			monthlyId: mbResult[0]?.id || null,
			annualId: abResult[0]?.id || null,
			monthly: monthlyBudget,
			annual: annualBudget,
			monthlyPct: monthlyBudget > 0 ? Math.min((monthExpenses / monthlyBudget) * 100, 100).toFixed(1) : 0,
			annualPct: annualBudget > 0 ? Math.min((yearExpenses / annualBudget) * 100, 100).toFixed(1) : 0
		},
		allTransactions: allT,
		chartData: {
			category: {
				labels: chartCategoryLabels,
				expenses: chartCategoryExpenses,
				incomes: chartCategoryIncomes
			},
			trend: {
				labels: trendLabels,
				income: trendIncome,
				expense: trendExpense
			},
			monthly: monthlyChart
		},
		allCategories: dbCategories,
		incomeCategories: incomeCats,
		expenseCategories: expenseCats,
		uniqueDescriptions: Array.from(uniqueDescriptions),
		uniqueTags: Array.from(uniqueTags),
		ccUnsettledTotal,
		ccUnsettledCount: ccUnsettled.length,
		lastSettledDate,
		allUsers: dbUsers
	};
};

export const actions: Actions = {
	addTransaction: async ({ request, locals }) => {
		const data = await request.formData();
		const type = data.get('type')?.toString();
		const description = data.get('description')?.toString();
        const amountStr = data.get('amount')?.toString();
        const date = data.get('date')?.toString();
        const category = data.get('category')?.toString() || 'Altro';
        const paymentMethod = data.get('payment_method')?.toString() || 'bancomat';
        const tags = data.get('tags')?.toString() || '[]';
        const settled = paymentMethod === 'credit_card' ? (data.get('settled') === '1' ? 1 : 0) : 1;

		if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        if (!type || !description || !amountStr || !date) {
            return fail(400, { error: 'Compila tutti i campi obbligatori' });
        }

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
            return fail(400, { error: 'Importo non valido' });
        }

		let receiptPath = null;
		const receipt = data.get('receipt') as File | null;
		if (receipt && receipt.size > 0 && receipt.name && receipt.name !== 'undefined') {
			try {
				receiptPath = await saveReceipt(receipt);
			} catch (e) {
				if (e instanceof InvalidReceiptError) return fail(400, { error: e.message });
				throw e;
			}
		}

		try {
            await db.insert(transactions).values({
                type,
                description,
                amount,
                date,
                category,
                paymentMethod,
                tags,
                receiptPath,
                settled,
                createdBy: locals.user.id
            });
            return { success: true };
		} catch (error) {
			return fail(500, { error: 'Errore salvataggio' });
		}
	},
    editTransaction: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        
        const data = await request.formData();
        const id = parseInt(data.get('id')?.toString() || '0');
        const type = data.get('type')?.toString();
        const description = data.get('description')?.toString();
        const amountStr = data.get('amount')?.toString();
        const date = data.get('date')?.toString();
        const category = data.get('category')?.toString() || 'Altro';
        const paymentMethod = data.get('payment_method')?.toString() || 'bancomat';
        const tags = data.get('tags')?.toString() || '[]';
        const settled = paymentMethod === 'credit_card' ? (data.get('settled') === '1' ? 1 : 0) : 1;

        if (!id || !type || !description || !amountStr || !date) {
            return fail(400, { error: 'Compila tutti i campi obbligatori' });
        }

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Importo non valido' });

        let receiptPath: string | null | undefined = undefined;
        const receipt = data.get('receipt') as File | null;
        const deleteReceipt = data.get('delete_receipt') === 'true';

        if (receipt && receipt.size > 0 && receipt.name && receipt.name !== 'undefined') {
			try {
				receiptPath = await saveReceipt(receipt);
			} catch (e) {
				if (e instanceof InvalidReceiptError) return fail(400, { error: e.message });
				throw e;
			}
        } else if (deleteReceipt) {
            // Explicit null -> clears the column
            receiptPath = null;
        }

        try {
            const updateData: any = { type, description, amount, date, category, paymentMethod, tags, settled };
            // Only touch receiptPath if we have a new upload OR an explicit delete
            if (receiptPath !== undefined) updateData.receiptPath = receiptPath;

            await db.update(transactions).set(updateData).where(eq(transactions.id, id));
            return { success: true };
        } catch (error) {
            return fail(500, { error: 'Errore durante la modifica' });
        }
    },
	deleteTransaction: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'ID errato' });
		await db.delete(transactions).where(eq(transactions.id, id));
		return { success: true };
	},
	settleCC: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const data = await request.formData();
		const fromDate = data.get('from_date')?.toString();
		const toDate = data.get('to_date')?.toString();
		if (!fromDate || !toDate) return fail(400, { error: 'Date di inizio e fine richieste' });

		try {
			await db.update(transactions)
				.set({ settled: 1 })
				.where(
					and(
						eq(transactions.paymentMethod, 'credit_card'),
						eq(transactions.settled, 0),
						sql`${transactions.date} >= ${fromDate}`,
						sql`${transactions.date} <= ${toDate}`
					)
				);
			return { success: true, action: 'settleCC' };
		} catch (error) {
			return fail(500, { error: 'Errore durante il saldo' });
		}
	}
};
