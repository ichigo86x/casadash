import { db, client } from '$lib/server/db';
import { localDateString } from '$lib/dates';
import { transactions, categories, users } from '$lib/server/db/schema';
import { desc, eq, and, sql, gte, lte, like, inArray, type SQL } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { InvalidReceiptError, saveReceipt } from '$lib/server/receipts';
import { validateTransaction, isValidDate } from '$lib/validate';
import { restoreBatch, trashRows } from '$lib/server/trash';
import { audit } from '$lib/server/audit';
import { matchView, replaceMovement, similarInDb } from '$lib/server/duplicates';
import { monthInsights } from '$lib/server/insights';
import { dueSoon } from '$lib/server/deadlines';
import { conflictCount } from '$lib/server/conflicts';
import { hasTag, isTransfer, notTransfer } from '$lib/server/transfers';
import { getSetting } from '$lib/server/settings';
import { loadActiveRules } from '$lib/server/rules';
import { upcomingRecurring } from '$lib/server/wealth';
import { accountBalances, creditCardUnsettled, expenseSum, financialPosition, incomeSum, monthOverview } from '$lib/server/stats';

const PAGE_SIZES = [10, 15, 25, 50, 100];


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
		batch: (p.get('batch') || '').slice(0, 60),
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
	// The three summary cards follow the chosen period (default: this month); charts below keep their own ranges
	const period = ['all', 'year', 'month'].includes(url.searchParams.get('p') || '') ? (url.searchParams.get('p') as 'all' | 'year' | 'month') : 'month';
	const periodFilter = period === 'month' ? and(notTransfer, like(transactions.date, `${monthPrefix}%`))
		: period === 'year' ? and(notTransfer, like(transactions.date, `${yearPrefix}%`))
		: notTransfer;
	const [totals] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions).where(periodFilter);
	const [yearTotals] = await db.select({ expense: expenseSum }).from(transactions)
		.where(and(notTransfer, like(transactions.date, `${yearPrefix}%`)));
	const month = await monthOverview(now);

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

	// 5. Credit card still to be settled
	const cc = await creditCardUnsettled();
	// The card expenses still to settle, oldest first (the order they will be charged)
	const ccUnsettled = await db.select().from(transactions)
		.where(and(eq(transactions.paymentMethod, 'credit_card'), eq(transactions.settled, 0)))
		.orderBy(transactions.date, transactions.id)
		.limit(500);
	const [lastSettled] = await db.select({ date: sql<string | null>`max(${transactions.date})` })
		.from(transactions).where(and(eq(transactions.paymentMethod, 'credit_card'), eq(transactions.settled, 1)));

	// 6. Account balances from the account tags
	const accountTags = await getSetting<string[]>('account_tags', []);
	const accounts = await accountBalances(accountTags);
	const upcoming = await upcomingRecurring(accountTags);
	const position = await financialPosition(accountTags, accounts, upcoming, now);

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
	if (f.batch) conditions.push(eq(transactions.importBatch, f.batch));
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
		period,
		summary: {
			totalIncome: totals.income,
			totalExpenses: totals.expense,
			balance: Math.round((totals.income - totals.expense) * 100) / 100,
			monthIncome: month.income,
			monthExpenses: month.expense,
			yearExpenses: yearTotals.expense
		},
		budget: month.budget,
		forecast: month.forecast,
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
		position,
		insights: await monthInsights(now),
		deadlines: await dueSoon(today),
		conflictCount: await conflictCount(),
		allCategories: dbCategories,
		incomeCategories: dbCategories.filter((c) => c.type === 'income'),
		expenseCategories: dbCategories.filter((c) => c.type === 'expense'),
		uniqueDescriptions: descriptionRows.map((r) => r.description),
		uniqueTags: tagRows.map((r) => String(r.tag)),
		ccUnsettledTotal: cc.total,
		ccUnsettledCount: cc.count,
		ccUnsettled,
		lastSettledDate: lastSettled?.date || null,
		allUsers: dbUsers,
		rules: await loadActiveRules(),
		upcoming
	};
};

export const actions: Actions = {
	addTransaction: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const data = await request.formData();
		const parsed = validateTransaction(data, await db.select({ name: categories.name, type: categories.type }).from(categories));
		if ('error' in parsed) return fail(400, { error: parsed.error });
		const v = parsed.value;

		// The same payment may already be there (typed twice, or imported from the bank or PayPal).
		// Not blocking: the user decides to keep both, replace the existing one or drop the new one.
		const dup = data.get('dup')?.toString() || '';
		if (!dup) {
			const similar = await similarInDb({ date: v.date, amount: v.amount, type: v.type, description: v.description, paymentMethod: v.paymentMethod, tags: v.tags });
			if (similar.length) return fail(409, { conflict: similar.slice(0, 5).map(matchView) });
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

		if (dup.startsWith('replace:')) {
			const targetId = parseInt(dup.slice(8));
			const ok = targetId > 0 && (await replaceMovement(targetId, { description: v.description, amount: v.amount, date: v.date, category: v.category, tags: v.tags, paymentMethod: v.paymentMethod, settled: v.settled }));
			if (!ok) return fail(404, { error: 'Il movimento da sostituire non esiste più' });
			if (receiptPath) await db.update(transactions).set({ receiptPath }).where(eq(transactions.id, targetId));
			await audit(locals.user, 'transaction.replaced', `#${targetId} ${v.description} ${v.amount}`);
			return { success: true, replaced: targetId };
		}

		try {
			await db.insert(transactions).values({
				type: v.type,
				description: v.description,
				amount: v.amount,
				date: v.date,
				category: v.category,
				paymentMethod: v.paymentMethod,
				tags: JSON.stringify(v.tags),
				receiptPath,
				settled: v.settled,
				origAmount: v.origAmount,
				origCurrency: v.origCurrency,
				fxRate: v.fxRate,
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
		if (!id) return fail(400, { error: 'Movimento non valido' });
		const parsed = validateTransaction(data, await db.select({ name: categories.name, type: categories.type }).from(categories));
		if ('error' in parsed) return fail(400, { error: parsed.error });
		const v = parsed.value;

		const [existing] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id)).limit(1);
		if (!existing) return fail(404, { error: 'Movimento non trovato' });

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
			const updateData: Partial<typeof transactions.$inferInsert> = {
				type: v.type,
				description: v.description,
				amount: v.amount,
				date: v.date,
				category: v.category,
				paymentMethod: v.paymentMethod,
				tags: JSON.stringify(v.tags),
				settled: v.settled,
				origAmount: v.origAmount,
				origCurrency: v.origCurrency,
				fxRate: v.fxRate
			};
			// Only touch receiptPath if we have a new upload OR an explicit delete
			if (receiptPath !== undefined) updateData.receiptPath = receiptPath;

			await db.update(transactions).set(updateData).where(eq(transactions.id, id));
			return { success: true };
		} catch (error) {
			return fail(500, { error: 'Errore durante la modifica' });
		}
	},
	// Deleting keeps a copy for 30 days: the page offers "Annulla"
	deleteTransaction: async ({ request, locals, getClientAddress }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'ID errato' });
		const rows = await db.select().from(transactions).where(eq(transactions.id, id));
		const batch = await trashRows(rows);
		await db.delete(transactions).where(eq(transactions.id, id));
		if (rows[0]) await audit(locals.user, 'transaction.deleted', `${rows[0].description} ${rows[0].amount}`, getClientAddress());
		return { success: true, deleted: batch, bulk: rows.length ? 'Movimento eliminato' : undefined };
	},
	restoreDeleted: async ({ request, locals, getClientAddress }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const batch = (await request.formData()).get('batch')?.toString() || '';
		const n = await restoreBatch(batch);
		if (!n) return fail(404, { error: 'Nulla da ripristinare (già ripristinato o scaduto)' });
		await audit(locals.user, 'transaction.restored', `${n} movimenti`, getClientAddress());
		return { bulk: n === 1 ? 'Movimento ripristinato' : `${n} movimenti ripristinati` };
	},
	// Bulk changes from the list selection: category, add/remove a tag, delete
	bulkEdit: async ({ request, locals, getClientAddress }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const data = await request.formData();
		const op = data.get('op')?.toString();
		const value = data.get('value')?.toString().trim().slice(0, 40) || '';
		let ids: number[] = [];
		try {
			ids = (JSON.parse(data.get('ids')?.toString() || '[]') as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
		} catch {
			return fail(400, { error: 'Selezione non valida' });
		}
		if (ids.length === 0) return fail(400, { error: 'Nessun movimento selezionato' });
		const rows = await db.select().from(transactions).where(inArray(transactions.id, ids));

		if (op === 'delete') {
			const batch = await trashRows(rows);
			await db.delete(transactions).where(inArray(transactions.id, ids));
			await audit(locals.user, 'transaction.bulk_deleted', `${rows.length} movimenti`, getClientAddress());
			return { bulk: `${rows.length} movimenti eliminati`, deleted: batch };
		}
		if (op === 'category') {
			const [cat] = await db.select().from(categories).where(eq(categories.name, value)).limit(1);
			if (!cat) return fail(400, { error: 'Categoria non valida' });
			// A category belongs to income or expense: rows of the other type are left alone
			const matching = rows.filter((r) => r.type === cat.type).map((r) => r.id);
			if (matching.length) await db.update(transactions).set({ category: value }).where(inArray(transactions.id, matching));
			const skipped = rows.length - matching.length;
			return { bulk: `Categoria «${value}» assegnata a ${matching.length} movimenti${skipped ? ` (${skipped} ${cat.type === 'expense' ? 'entrate' : 'uscite'} lasciate invariate)` : ''}` };
		}
		if (op === 'addTag' || op === 'removeTag') {
			if (!value) return fail(400, { error: 'Inserisci un tag' });
			let changed = 0;
			db.transaction((tx) => {
				for (const r of rows) {
					let tags: string[] = [];
					try { tags = JSON.parse(r.tags || '[]'); } catch {}
					const next = op === 'addTag'
						? (tags.includes(value) ? tags : [...tags, value])
						: tags.filter((t) => t.toLowerCase() !== value.toLowerCase());
					if (next.length !== tags.length) {
						tx.update(transactions).set({ tags: JSON.stringify(next) }).where(eq(transactions.id, r.id)).run();
						changed++;
					}
				}
			});
			return { bulk: op === 'addTag' ? `Tag «${value}» aggiunto a ${changed} movimenti` : `Tag «${value}» rimosso da ${changed} movimenti` };
		}
		return fail(400, { error: 'Operazione non valida' });
	},
	// Settles (or un-settles) the selected credit card expenses
	settleSelected: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const data = await request.formData();
		let ids: number[] = [];
		try {
			ids = (JSON.parse(data.get('ids')?.toString() || '[]') as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
		} catch {
			return fail(400, { error: 'Selezione non valida' });
		}
		if (ids.length === 0) return fail(400, { error: 'Nessuna spesa selezionata' });
		await db.update(transactions).set({ settled: 1 })
			.where(and(inArray(transactions.id, ids), eq(transactions.paymentMethod, 'credit_card')));
		return { success: true, action: 'settleSelected', settled: ids.length };
	},
	settleCC: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { error: 'Non autorizzato' });
		const data = await request.formData();
		const fromDate = data.get('from_date')?.toString();
		const toDate = data.get('to_date')?.toString();
		if (!fromDate || !toDate) return fail(400, { error: 'Date di inizio e fine richieste' });
		if (!isValidDate(fromDate) || !isValidDate(toDate)) return fail(400, { error: 'Date non valide' });

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
