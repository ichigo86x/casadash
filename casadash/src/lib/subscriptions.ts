// Finds subscriptions and fixed expenses hiding in the history: the same payee, about the same
// amount, at a regular interval. Pure functions, used by the recurring page and the tests.
import { descriptionKey } from '$lib/import';
import { nextOccurrence } from '$lib/dates';

export type HistoryRow = {
	description: string;
	amount: number;
	date: string; // YYYY-MM-DD
	type: string;
	category: string;
	tags: string[];
};

export type Detected = {
	key: string;
	description: string;
	amount: number;
	frequency: 'weekly' | 'monthly' | 'yearly';
	category: string;
	tags: string[];
	count: number;
	lastDate: string;
	nextDate: string;
};

const DAY = 24 * 60 * 60 * 1000;
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
const median = (v: number[]) => {
	const s = [...v].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const PERIODS = [
	{ frequency: 'weekly', days: 7, tolerance: 1, minCount: 4, maxSilence: 21 },
	{ frequency: 'monthly', days: 30.5, tolerance: 4, minCount: 3, maxSilence: 50 },
	{ frequency: 'yearly', days: 365, tolerance: 12, minCount: 2, maxSilence: 400 }
] as const;

/**
 * @param rows        past expenses
 * @param knownKeys   description keys already covered by a recurring transaction
 * @param today       "YYYY-MM-DD", to judge whether a pattern is still alive
 */
export function detectSubscriptions(rows: HistoryRow[], knownKeys: Set<string>, today: string): Detected[] {
	const groups = new Map<string, HistoryRow[]>();
	for (const r of rows) {
		if (r.type !== 'expense') continue;
		if (r.tags.some((t) => ['ricorrente', 'trasferimento'].includes(t.toLowerCase()))) continue;
		const key = descriptionKey(r.description);
		if (!key || knownKeys.has(key)) continue;
		(groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
	}

	const found: Detected[] = [];
	for (const [key, list] of groups) {
		if (list.length < 2) continue;
		list.sort((a, b) => a.date.localeCompare(b.date));
		// Two charges on the same day are one event for the interval maths
		const dates = [...new Set(list.map((r) => r.date))];
		if (dates.length < 2) continue;
		const gaps = dates.slice(1).map((d, i) => days(dates[i], d));
		const typical = median(gaps);

		const period = PERIODS.find((p) => Math.abs(typical - p.days) <= p.tolerance + (p.frequency === 'yearly' ? 5 : 1.5));
		if (!period || dates.length < period.minCount) continue;
		const regular = gaps.filter((g) => Math.abs(g - period.days) <= period.tolerance + (period.frequency === 'monthly' ? 1 : 0)).length / gaps.length;
		if (regular < 0.7) continue;

		// Same amount, give or take 10% (a utility bill varies, a subscription does not)
		const amount = median(list.map((r) => r.amount));
		const steady = list.filter((r) => Math.abs(r.amount - amount) <= amount * 0.1).length / list.length;
		if (steady < 0.7) continue;

		const last = list[list.length - 1];
		if (days(last.date, today) > period.maxSilence) continue; // it stopped

		const categories = new Map<string, number>();
		for (const r of list) categories.set(r.category, (categories.get(r.category) || 0) + 1);
		const category = [...categories.entries()].sort((a, b) => b[1] - a[1])[0][0];
		const tags = [...new Set(last.tags.filter((t) => !['importato'].includes(t.toLowerCase())))];

		let next = nextOccurrence(last.date, period.frequency, parseInt(last.date.slice(8, 10)));
		for (let i = 0; i < 60 && next < today; i++) next = nextOccurrence(next, period.frequency, parseInt(last.date.slice(8, 10)));

		found.push({
			key,
			description: last.description,
			amount: Math.round(amount * 100) / 100,
			frequency: period.frequency,
			category,
			tags,
			count: dates.length,
			lastDate: last.date,
			nextDate: next
		});
	}
	return found.sort((a, b) => b.amount - a.amount);
}
