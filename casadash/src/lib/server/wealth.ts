import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { recurringTransactions, transactions } from '$lib/server/db/schema';
import { hasTag } from '$lib/server/transfers';
import { localDateString, nextOccurrence } from '$lib/dates';
import { ruleTags } from '$lib/rules';

const signed = sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0)`;
const monthKey = sql<string>`substr(${transactions.date}, 1, 7)`;

/**
 * Balance of every account tag at the end of each of the last `months` months
 * (transfers included: they move money between accounts), plus their total.
 */
export async function wealthHistory(accountTags: string[], months = 24) {
	const now = new Date();
	const labels: string[] = [];
	for (let i = months - 1; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}

	const series: { tag: string; values: number[] }[] = [];
	for (const tag of accountTags) {
		const rows = await db.select({ month: monthKey, net: signed }).from(transactions).where(hasTag(tag)).groupBy(monthKey);
		const byMonth = new Map(rows.map((r) => [r.month, r.net]));
		// Everything before the window is the opening balance
		let balance = rows.filter((r) => r.month < labels[0]).reduce((a, r) => a + r.net, 0);
		const values = labels.map((m) => (balance += byMonth.get(m) || 0));
		series.push({ tag, values: values.map((v) => Math.round(v * 100) / 100) });
	}
	const total = labels.map((_, i) => Math.round(series.reduce((a, s) => a + s.values[i], 0) * 100) / 100);
	return { labels, series, total };
}

export type Upcoming = {
	date: string;
	description: string;
	amount: number;
	type: 'income' | 'expense';
	category: string;
	account: string | null;
	frequency: string;
};

/** Occurrences of the active recurring transactions in the next `days` days, by date. */
export async function upcomingRecurring(accountTags: string[], days = 30): Promise<Upcoming[]> {
	const today = localDateString();
	const now = new Date();
	const end = localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
	const jobs = (await db.select().from(recurringTransactions)).filter((j) => j.isActive);
	const out: Upcoming[] = [];
	for (const job of jobs) {
		const account = ruleTags({ addTags: job.tags }).find((t) => accountTags.includes(t)) || null;
		let d = job.nextDate;
		for (let i = 0; i < 400 && d <= end; i++) {
			if (d >= today) {
				out.push({ date: d, description: job.description, amount: job.amount, type: job.type, category: job.category, account, frequency: job.frequency });
			}
			d = nextOccurrence(d, job.frequency, job.anchorDay);
		}
	}
	return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}
