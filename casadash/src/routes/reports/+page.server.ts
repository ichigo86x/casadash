import { db } from '$lib/server/db';
import { localDateString } from '$lib/dates';
import { transactions, budgets, categories, users } from '$lib/server/db/schema';
import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	// The auth guard in hooks.server.ts already redirects anonymous requests
	if (!locals.user) throw error(401, 'Non autorizzato');

	const filterType = url.searchParams.get('type') || 'range'; // 'range', 'monthly', 'annual'
	
	const now = new Date();
	const from = url.searchParams.get('from') || localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
	const to = url.searchParams.get('to') || localDateString(now);
	const year = parseInt(url.searchParams.get('year') || now.getFullYear().toString());
	const month = parseInt(url.searchParams.get('month') || (now.getMonth() + 1).toString());
	const paymentMethod = url.searchParams.get('payment_method') || 'all';
	const filterTagsStr = url.searchParams.get('tags') || '';
	const filterTags = filterTagsStr ? filterTagsStr.split(',') : [];
	const filterCategory = url.searchParams.get('category') || '';
	const excludeCC = url.searchParams.get('exclude_cc') === '1';
	const filterAttachment = url.searchParams.get('attachment') || '';

	const conditions = [];

	if (filterType === 'range') {
		conditions.push(gte(transactions.date, from), lte(transactions.date, to));
	} else if (filterType === 'monthly') {
		conditions.push(sql`strftime('%Y', ${transactions.date}) = ${String(year).padStart(4, '0')}`);
		conditions.push(sql`strftime('%m', ${transactions.date}) = ${String(month).padStart(2, '0')}`);
	} else if (filterType === 'annual') {
		conditions.push(sql`strftime('%Y', ${transactions.date}) = ${String(year).padStart(4, '0')}`);
	}

	if (paymentMethod !== 'all') {
		conditions.push(eq(transactions.paymentMethod, paymentMethod));
	}

	if (filterCategory) {
		conditions.push(eq(transactions.category, filterCategory));
	}

	if (excludeCC) {
		conditions.push(sql`NOT (${transactions.paymentMethod} = 'credit_card' AND ${transactions.settled} = 0)`);
	}

	if (filterAttachment === 'with') {
		conditions.push(sql`${transactions.receiptPath} IS NOT NULL`);
	} else if (filterAttachment === 'without') {
		conditions.push(sql`${transactions.receiptPath} IS NULL`);
	}

	for (const tag of filterTags) {
		conditions.push(sql`(json_valid(${transactions.tags}) AND json_extract(${transactions.tags}, '$') LIKE '%"' || ${tag} || '"%')`);
	}

	// Rimossa la restrizione per Utente per permettere la visibilità Famiglia su base globale!
	// conditions.push(eq(transactions.createdBy, locals.user.id));

	const allT = await db.select().from(transactions)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(transactions.date), desc(transactions.id));

	let totalIncome = 0; let totalExpense = 0;
	const categoryBreakdown: Record<string, { total: number; count: number; type: string }> = {};
	const dailyData: Record<string, { income: number; expense: number }> = {};
	const uniqueTagsSet = new Set<string>();

	for (const t of allT) {
		if (t.type === 'income') totalIncome += t.amount;
		if (t.type === 'expense') totalExpense += t.amount;

		if (!categoryBreakdown[t.category]) {
			categoryBreakdown[t.category] = { total: 0, count: 0, type: t.type };
		}
		categoryBreakdown[t.category].total += t.amount;
		categoryBreakdown[t.category].count++;

		if (!dailyData[t.date]) {
			dailyData[t.date] = { income: 0, expense: 0 };
		}
		if (t.type === 'income') dailyData[t.date].income += t.amount;
		if (t.type === 'expense') dailyData[t.date].expense += t.amount;

		try {
			const parsedTags = JSON.parse(t.tags || '[]');
			if (Array.isArray(parsedTags)) {
				parsedTags.forEach(tag => uniqueTagsSet.add(tag));
			}
		} catch(e) {}
	}

	const breakdownArray = Object.entries(categoryBreakdown).map(([category, data]) => ({
		category, total: data.total, count: data.count, type: data.type
	})).sort((a, b) => b.total - a.total);

	const expenseBreakdown = breakdownArray.filter(b => b.type === 'expense');

	const dailyBreakdown = Object.entries(dailyData)
		.map(([date, data]) => ({ date, ...data }))
		.sort((a, b) => a.date.localeCompare(b.date));

	// Budget Info
	let budgetAmount = 0;
	let categoryBudgets: Record<string, number> = {};

	if (filterType === 'monthly') {
		const bResult = await db.select().from(budgets).where(and(eq(budgets.periodType, 'monthly'), eq(budgets.year, year), eq(budgets.month, month)));
		for (const b of bResult) {
			if (b.category === 'Totale' || !b.category) budgetAmount = b.amount;
			else categoryBudgets[b.category] = b.amount;
		}
	} else if (filterType === 'annual') {
		const bResult = await db.select().from(budgets).where(and(eq(budgets.periodType, 'annual'), eq(budgets.year, year)));
		for (const b of bResult) {
			if (b.category === 'Totale' || !b.category) budgetAmount = b.amount;
			else categoryBudgets[b.category] = b.amount;
		}
	}

	// Available years for filter
    let availableYears: number[] = [];
    try {
        const tAll = await db.select({ date: transactions.date }).from(transactions);
        availableYears = Array.from(new Set(tAll.map(t => parseInt(t.date.substring(0, 4))))).filter(y => !isNaN(y)).sort((a, b) => b - a);
    } catch(e) {}

	if (availableYears.length === 0) availableYears = [now.getFullYear()];
	if (!availableYears.includes(now.getFullYear())) availableYears.unshift(now.getFullYear());

	// Load dynamic categories
	const dbCategories = await db.select().from(categories);

	const dbUsers = await db.select({ id: users.id, displayName: users.displayName }).from(users);

	return {
		transactions: allT,
		summary: { income: totalIncome, expense: totalExpense, balance: totalIncome - totalExpense },
		breakdown: breakdownArray,
		expenseBreakdown,
		dailyBreakdown,
		budget: budgetAmount,
		categoryBudgets,
		filters: { type: filterType, from, to, year, month, availableYears, paymentMethod, tags: filterTags, category: filterCategory, attachment: filterAttachment },
		availableTags: Array.from(uniqueTagsSet).sort(),
		allCategories: dbCategories,
		allUsers: dbUsers
	};
};
