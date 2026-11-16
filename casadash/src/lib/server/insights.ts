import { and, desc, gte, lt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transactions } from '$lib/server/db/schema';
import { notTransfer } from '$lib/server/transfers';
import { expenseSum, incomeSum } from '$lib/server/stats';
import { localDateString } from '$lib/dates';
import { categoryAnomalies, largeExpenses, savingInsights, savingsRate, type Insight } from '$lib/insights';

const monthKey = sql<string>`substr(${transactions.date}, 1, 7)`;
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Savings rate and spending anomalies of the running month, compared with the 3 months before it. */
export async function monthInsights(now = new Date()): Promise<{ savingsRate: number | null; items: Insight[] }> {
	const current = ym(now);
	const start = ym(new Date(now.getFullYear(), now.getMonth() - 3, 1));
	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const progress = now.getDate() / daysInMonth;

	const months = await db
		.select({ month: monthKey, income: incomeSum, expense: expenseSum })
		.from(transactions)
		.where(and(notTransfer, gte(transactions.date, `${start}-01`)))
		.groupBy(monthKey);
	const cur = months.find((m) => m.month === current) ?? { month: current, income: 0, expense: 0 };
	const previous = months.filter((m) => m.month < current);

	const catRows = await db
		.select({ category: transactions.category, month: monthKey, expense: expenseSum })
		.from(transactions)
		.where(and(notTransfer, gte(transactions.date, `${start}-01`)))
		.groupBy(transactions.category, monthKey);
	const currentCats = catRows.filter((r) => r.month === current && r.expense > 0);
	const history = catRows.filter((r) => r.month < current);

	const items: Insight[] = [
		...savingInsights(cur, previous, progress),
		...categoryAnomalies(currentCats, history, previous.length, progress)
	];

	// Single unusual expenses of the last 30 days against the previous year of the same category
	const recentFrom = localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
	const yearAgo = localDateString(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
	const recent = await db
		.select({ description: transactions.description, amount: transactions.amount, date: transactions.date, category: transactions.category })
		.from(transactions)
		.where(and(notTransfer, sql`${transactions.type} = 'expense'`, gte(transactions.date, recentFrom)))
		.orderBy(desc(transactions.amount))
		.limit(30);
	if (recent.length) {
		// Mean and deviation per category computed by SQLite: no thousands of rows copied into JavaScript
		const mean = sql<number>`avg(${transactions.amount})`;
		const stats = await db
			.select({
				category: transactions.category,
				n: sql<number>`count(*)`,
				mean,
				sd: sql<number>`sqrt(max(avg(${transactions.amount} * ${transactions.amount}) - avg(${transactions.amount}) * avg(${transactions.amount}), 0))`
			})
			.from(transactions)
			.where(and(notTransfer, sql`${transactions.type} = 'expense'`, gte(transactions.date, yearAgo), lt(transactions.date, recentFrom)))
			.groupBy(transactions.category);
		items.push(...largeExpenses(recent, stats));
	}

	return { savingsRate: current ? savingsRate(cur.income, cur.expense) : null, items };
}
