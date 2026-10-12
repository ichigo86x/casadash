import { db, client } from '$lib/server/db';
import { localDateString, nextOccurrence } from '$lib/dates';
import { transactions, budgets, categories, users, recurringTransactions } from '$lib/server/db/schema';
import { desc, eq, and, sql, gte, lte, like, type SQL } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { InvalidReceiptError, saveReceipt } from '$lib/server/receipts';
import { hasTag, isTransfer, notTransfer } from '$lib/server/transfers';
import { getSetting } from '$lib/server/settings';

const PAGE_SIZES = [10, 15, 25, 50, 100];

// Sums of income/expense; callers add `notTransfer` so moves between own accounts never count
const incomeSum = sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} end), 0)`;
const expenseSum = sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} end), 0)`;

/** Transaction list filters, read from the URL so the list survives reloads and back/forward. */
function listFilters(url: URL) {
	const p = url.searchParams;
	const num = (k: string) => {
		const v = parseFloat(p.get(k) || '');
		return isNaN(v) ? null : v;
	};
	const size = parseInt(p.get('size') || '15');
	return {
		q: p.get('q') || '',
		category: p.get('cat') || '',
		type: p.get('type') || '',
		paymentMethod: p.get('pay') || '',
		account: p.get('account') || '',
		min: num('min'),
		max: num('max'),
		from: p.get('from') || '',
		to: p.get('to') || '',
		attachment: p.get('att') || '',
		page: Math.max(1, parseInt(p.get('page') || '1') || 1),
		size: PAGE_SIZES.includes(size) ? size : 15
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const now = new Date();
	const today = localDateString(now);
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth() + 1;
	const yearPrefix = `${currentYear}-`;
	const monthPrefix = today.slice(0, 8); // "YYYY-MM-"

	// 1. Totals (all time, current year, current month)
	const [totals] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions).where(notTransfer);
	const [yearTotals] = await db.select({ expense: expenseSum }).from(transactions)
		.where(and(notTransfer, like(transactions.date, `${yearPrefix}%`)));
	const [monthTotals] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions)
		.where(and(notTransfer, like(transactions.date, `${monthPrefix}%`)));
	// Recurring spending already booked this month, kept out of the daily pace used by the forecast
	const [monthRecurring] = await db.select({ expense: expenseSum }).from(transactions)
		.where(and(notTransfer, like(transactions.date, `${monthPrefix}%`), hasTag('Ricorrente')));

	// 2. Chart data
	const categoryRows = await db.select({ category: transactions.category, income: incomeSum, expense: expenseSum })
		.from(transactions).where(notTransfer).groupBy(transactions.category);

	const trendStart = localDateString(new Date(currentYear, currentMonth - 1, now.getDate() - 29));
	const trendRows = await db.select({ date: transactions.date, income: incomeSum, expense: expenseSum })
		.from(transactions)
		.where(and(notTransfer, gte(transactions.date, trendStart), lte(transactions.date, today)))
		.groupBy(transactions.date);
	const trendData: Record<string, { income: number; expense: number }> = {};
	for (let i = 29; i >= 0; i--) {
		trendData[localDateString(new Date(currentYear, currentMonth - 1, now.getDate() - i))] = { income: 0, expense: 0 };
	}
	for (const r of trendRows) if (trendData[r.date]) trendData[r.date] = { income: r.income, expense: r.expense };

	const monthKey = sql<string>`substr(${transactions.date}, 6, 2)`;
	const monthlyRows = await db.select({ month: monthKey, income: incomeSum, expense: expenseSum })
		.from(transactions).where(and(notTransfer, like(transactions.date, `${yearPrefix}%`))).groupBy(monthKey);
	const monthlyChart = { income: Array(12).fill(0), expense: Array(12).fill(0) };
	for (const r of monthlyRows) {
		const idx = parseInt(r.month) - 1;
		if (idx >= 0 && idx < 12) {
			monthlyChart.income[idx] = r.income;
			monthlyChart.expense[idx] = r.expense;
		}
	}

	// 3. Budgets for the current month and year
	const monthBudgets = await db.select().from(budgets).where(
		and(eq(budgets.periodType, 'monthly'), eq(budgets.year, currentYear), eq(budgets.month, currentMonth))
	);
	const [annualBudgetRow] = await db.select().from(budgets).where(
		and(eq(budgets.periodType, 'annual'), eq(budgets.year, currentYear))
	).limit(1);
	const monthCategoryRows = await db.select({ category: transactions.category, expense: expenseSum })
		.from(transactions).where(and(notTransfer, like(transactions.date, `${monthPrefix}%`))).groupBy(transactions.category);
	const monthCategoryExpenses: Record<string, number> = Object.fromEntries(monthCategoryRows.map((r) => [r.category, r.expense]));

	let monthlyBudget = 0;
	const budgetWarnings: { category: string; spent: number; limit: number; pct: number }[] = [];
	for (const b of monthBudgets) {
		if (b.category === 'Totale' || !b.category) {
			monthlyBudget = b.amount;
		} else if (b.amount > 0) {
			const spent = monthCategoryExpenses[b.category] || 0;
			const pct = (spent / b.amount) * 100;
			if (pct > 80) budgetWarnings.push({ category: b.category, spent, limit: b.amount, pct });
		}
	}
	budgetWarnings.sort((a, b) => b.pct - a.pct);
	const annualBudget = annualBudgetRow?.amount || 0;

	// 4. End-of-month forecast: spending so far, the same daily pace for the remaining days,
	//    plus recurring expenses still due this month
	const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
	const dayOfMonth = now.getDate();
	const monthEnd = `${monthPrefix}${String(daysInMonth).padStart(2, '0')}`;
	const activeRecurring = await db.select().from(recurringTransactions).where(
		and(eq(recurringTransactions.isActive, 1), eq(recurringTransactions.type, 'expense'), lte(recurringTransactions.nextDate, monthEnd))
	);
	let pendingRecurring = 0;
	for (const job of activeRecurring) {
		let d = job.nextDate;
		for (let i = 0; i < 400 && d <= monthEnd; i++) {
			if (d > today) pendingRecurring += job.amount;
			d = nextOccurrence(d, job.frequency, job.anchorDay);
		}
	}
	const variableSpent = monthTotals.expense - monthRecurring.expense;
	const forecast = monthTotals.expense + (variableSpent / dayOfMonth) * (daysInMonth - dayOfMonth) + pendingRecurring;

	// 5. Credit card still to be settled (overall, no date filter)
	const [cc] = await db.select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)`, count: sql<number>`count(*)` })
		.from(transactions).where(and(eq(transactions.paymentMethod, 'credit_card'), eq(transactions.settled, 0)));
	const [lastSettled] = await db.select({ date: sql<string | null>`max(${transactions.date})` })
		.from(transactions).where(and(eq(transactions.paymentMethod, 'credit_card'), eq(transactions.settled, 1)));

	// 6. Account balances from the account tags. Transfers count here: they move money between accounts.
	const accountTags = await getSetting<string[]>('account_tags', []);
	const accounts: { tag: string; balance: number }[] = [];
	for (const tag of accountTags) {
		const [r] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions).where(hasTag(tag));
		accounts.push({ tag, balance: r.income - r.expense });
	}

	// 7. Paginated, filtered transaction list
	const f = listFilters(url);
	const conditions: SQL[] = [];
	if (f.q) conditions.push(sql`lower(${transactions.description}) LIKE ${'%' + f.q.toLowerCase() + '%'}`);
	if (f.category) conditions.push(eq(transactions.category, f.category));
	if (f.type === 'transfer') conditions.push(isTransfer);
	else if (f.type === 'income' || f.type === 'expense') conditions.push(eq(transactions.type, f.type), notTransfer);
	if (f.paymentMethod) conditions.push(eq(transactions.paymentMethod, f.paymentMethod));
	if (f.account) conditions.push(hasTag(f.account));
	if (f.min !== null) conditions.push(gte(transactions.amount, f.min));
	if (f.max !== null) conditions.push(lte(transactions.amount, f.max));
	if (f.from) conditions.push(gte(transactions.date, f.from));
	if (f.to) conditions.push(lte(transactions.date, f.to));
	if (f.attachment === 'with') conditions.push(sql`${transactions.receiptPath} IS NOT NULL`);
	if (f.attachment === 'without') conditions.push(sql`${transactions.receiptPath} IS NULL`);
	const where = conditions.length ? and(...conditions) : undefined;

	const [{ count: filteredCount }] = await db.select({ count: sql<number>`count(*)` }).from(transactions).where(where);
	const totalPages = Math.max(1, Math.ceil(filteredCount / f.size));
	const page = Math.min(f.page, totalPages);
	const list = await db.select().from(transactions).where(where)
		.orderBy(desc(transactions.date), desc(transactions.id))
		.limit(f.size).offset((page - 1) * f.size);
	const [{ count: transactionCount }] = await db.select({ count: sql<number>`count(*)` }).from(transactions);

	// 8. Autocomplete sources and lookups
	const descriptionRows = await db.select({ description: transactions.description }).from(transactions)
		.groupBy(transactions.description).orderBy(desc(sql`max(${transactions.date})`)).limit(500);
	const tagRows = client.prepare(
		'SELECT DISTINCT j.value AS tag FROM transactions t, json_each(t.tags) j WHERE json_valid(t.tags) ORDER BY 1'
	).all() as { tag: string }[];

	const dbCategories = await db.select().from(categories);
	const dbUsers = await db.select({ id: users.id, displayName: users.displayName }).from(users);

	return {
		currentYear,
		currentMonth,
		summary: {
			totalIncome: totals.income,
			totalExpenses: totals.expense,
			balance: totals.income - totals.expense,
			monthIncome: monthTotals.income,
			monthExpenses: monthTotals.expense,
			yearExpenses: yearTotals.expense
		},
		budget: {
			monthly: monthlyBudget,
			annual: annualBudget,
			warnings: budgetWarnings
		},
		forecast: {
			expense: forecast,
			pendingRecurring,
			dayOfMonth,
			daysInMonth
		},
		chartData: {
			category: {
				labels: categoryRows.map((r) => r.category),
				expenses: categoryRows.map((r) => r.expense),
				incomes: categoryRows.map((r) => r.income)
			},
			trend: {
				labels: Object.keys(trendData),
				income: Object.values(trendData).map((t) => t.income),
				expense: Object.values(trendData).map((t) => t.expense)
			},
			monthly: monthlyChart
		},
		transactions: list,
		transactionCount,
		list: { ...f, page, totalPages, total: filteredCount },
		accounts,
		allCategories: dbCategories,
		incomeCategories: dbCategories.filter((c) => c.type === 'income'),
		expenseCategories: dbCategories.filter((c) => c.type === 'expense'),
		uniqueDescriptions: descriptionRows.map((r) => r.description),
		uniqueTags: tagRows.map((r) => String(r.tag)),
		ccUnsettledTotal: cc.total,
		ccUnsettledCount: cc.count,
		lastSettledDate: lastSettled?.date || null,
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
