import { and, eq, like, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { budgets, goalContributions, goals, recurringTransactions, transactions } from '$lib/server/db/schema';
import { assetTotals } from '$lib/server/assets';
import { hasTag, notTransfer } from '$lib/server/transfers';
import { localDateString, nextOccurrence } from '$lib/dates';

// Shared by the dashboard and the Home Assistant sensors.

// Sums of income/expense; callers add `notTransfer` so moves between own accounts never count
// Rounded to cents in SQL: amounts are floats, and thousands of additions would otherwise leave 0.0000001 residues
export const incomeSum = sql<number>`round(coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} end), 0), 2)`;
export const expenseSum = sql<number>`round(coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} end), 0), 2)`;

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

/**
 * Balance of each account tag as of today. Transfers count here: they move money between accounts.
 * Movements dated in the future are not on the account yet, so they are left out.
 */
export async function accountBalances(tags: string[]) {
	const accounts: { tag: string; balance: number }[] = [];
	const today = localDateString();
	for (const tag of tags) {
		const [r] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions).where(and(hasTag(tag), lte(transactions.date, today)));
		accounts.push({ tag, balance: Math.round((r.income - r.expense) * 100) / 100 });
	}
	return accounts;
}

/** Credit card spending not yet settled (overall, no date filter). */
export async function creditCardUnsettled() {
	const [cc] = await db.select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)`, count: sql<number>`count(*)` })
		.from(transactions).where(and(eq(transactions.paymentMethod, 'credit_card'), eq(transactions.settled, 0)));
	return cc;
}

/**
 * Snapshot of the family's current finances.
 *
 * - `bank`: money physically on the accounts. Card expenses still unsettled have not left the bank yet,
 *   so when they carry an account tag (and are already subtracted from that balance) they are added back.
 * - `available`: what is really free today = bank minus the card bill still to be paid.
 * - `free`: available minus what is set aside for active savings goals.
 * - `endOfMonth`: available adjusted by the recurring income and expenses still due this month.
 * With no accounts defined, the overall balance of all movements is used instead.
 */
export async function financialPosition(
	accountTags: string[],
	accounts: { tag: string; balance: number }[],
	upcoming: { date: string; type: 'income' | 'expense'; amount: number }[],
	now = new Date()
) {
	const unsettled = await db.select({ amount: transactions.amount, tags: transactions.tags }).from(transactions)
		.where(and(eq(transactions.paymentMethod, 'credit_card'), eq(transactions.settled, 0)));
	let cardTotal = 0;
	let cardOnAccounts = 0; // already subtracted from an account balance
	for (const t of unsettled) {
		cardTotal += t.amount;
		let tags: string[] = [];
		try { tags = JSON.parse(t.tags || '[]'); } catch {}
		if (tags.some((tag) => accountTags.includes(tag))) cardOnAccounts += t.amount;
	}

	let ledger: number; // sum of balances as recorded
	if (accountTags.length > 0) {
		ledger = accounts.reduce((s, a) => s + a.balance, 0);
	} else {
		const [all] = await db.select({ income: incomeSum, expense: expenseSum }).from(transactions).where(lte(transactions.date, localDateString(now)));
		ledger = all.income - all.expense;
		cardOnAccounts = cardTotal; // every expense is already in the overall balance
	}
	const bank = ledger + cardOnAccounts;
	const available = bank - cardTotal;

	const [saved] = await db.select({ total: sql<number>`coalesce(sum(${goalContributions.amount}), 0)` })
		.from(goalContributions).innerJoin(goals, eq(goals.id, goalContributions.goalId))
		.where(eq(goals.archived, 0));
	const goalsSaved = Math.max(0, saved.total);

	const monthEnd = localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0));
	const due = upcoming.filter((u) => u.date <= monthEnd);
	const pendingExpense = due.filter((u) => u.type === 'expense').reduce((s, u) => s + u.amount, 0);
	const pendingIncome = due.filter((u) => u.type === 'income').reduce((s, u) => s + u.amount, 0);

	const owned = await assetTotals();

	return {
		bank,
		cardTotal,
		// Beyond the accounts: houses, investments, loans (see /wealth)
		assets: owned.assets,
		liabilities: owned.liabilities,
		hasAssets: owned.count > 0,
		netWorth: Math.round((available + owned.assets - owned.liabilities) * 100) / 100,
		available,
		goalsSaved,
		free: available - goalsSaved,
		pendingExpense,
		pendingIncome,
		endOfMonth: available + pendingIncome - pendingExpense,
		hasAccounts: accountTags.length > 0
	};
}
