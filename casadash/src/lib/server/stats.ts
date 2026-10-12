import { and, eq, like, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { budgets, recurringTransactions, transactions } from '$lib/server/db/schema';
import { hasTag, notTransfer } from '$lib/server/transfers';
import { localDateString, nextOccurrence } from '$lib/dates';

// Shared by the dashboard and the Home Assistant sensors.

// Sums of income/expense; callers add `notTransfer` so moves between own accounts never count
export const incomeSum = sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} end), 0)`;
export const expenseSum = sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} end), 0)`;

/** Current month: totals, budget usage with category warnings, and the end-of-month forecast. */
export async function monthOverview(now = new Date()) {
	const today = localDateString(now);
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const monthPrefix = today.slice(0, 8); // "YYYY-MM-"
	const inMonth = and(notTransfer, like(transactions.date, `${monthPrefix}%`));

	const [totals] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions).where(inMonth);
	// Recurring spending already booked this month, kept out of the daily pace used by the forecast
	const [recurring] = await db.select({ expense: expenseSum }).from(transactions).where(and(inMonth, hasTag('Ricorrente')));

	// Budgets
	const monthBudgets = await db.select().from(budgets).where(
		and(eq(budgets.periodType, 'monthly'), eq(budgets.year, year), eq(budgets.month, month))
	);
	const [annualBudgetRow] = await db.select().from(budgets).where(
		and(eq(budgets.periodType, 'annual'), eq(budgets.year, year))
	).limit(1);
	const categoryRows = await db.select({ category: transactions.category, expense: expenseSum })
		.from(transactions).where(inMonth).groupBy(transactions.category);
	const categoryExpenses: Record<string, number> = Object.fromEntries(categoryRows.map((r) => [r.category, r.expense]));

	let monthlyBudget = 0;
	const warnings: { category: string; spent: number; limit: number; pct: number }[] = [];
	for (const b of monthBudgets) {
		if (b.category === 'Totale' || !b.category) {
			monthlyBudget = b.amount;
		} else if (b.amount > 0) {
			const spent = categoryExpenses[b.category] || 0;
			const pct = (spent / b.amount) * 100;
			if (pct > 80) warnings.push({ category: b.category, spent, limit: b.amount, pct });
		}
	}
	warnings.sort((a, b) => b.pct - a.pct);

	// Forecast: spending so far, the same daily pace for the remaining days,
	// plus recurring expenses still due this month
	const daysInMonth = new Date(year, month, 0).getDate();
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
	const variableSpent = totals.expense - recurring.expense;
	const forecast = totals.expense + (variableSpent / dayOfMonth) * (daysInMonth - dayOfMonth) + pendingRecurring;

	return {
		income: totals.income,
		expense: totals.expense,
		budget: { monthly: monthlyBudget, annual: annualBudgetRow?.amount || 0, warnings },
		forecast: { expense: forecast, pendingRecurring, dayOfMonth, daysInMonth }
	};
}

/** Balance of each account tag. Transfers count here: they move money between accounts. */
export async function accountBalances(tags: string[]) {
	const accounts: { tag: string; balance: number }[] = [];
	for (const tag of tags) {
		const [r] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions).where(hasTag(tag));
		accounts.push({ tag, balance: r.income - r.expense });
	}
	return accounts;
}

/** Credit card spending not yet settled (overall, no date filter). */
export async function creditCardUnsettled() {
	const [cc] = await db.select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)`, count: sql<number>`count(*)` })
		.from(transactions).where(and(eq(transactions.paymentMethod, 'credit_card'), eq(transactions.settled, 0)));
	return cc;
}
