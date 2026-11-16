// Spending insights from monthly figures. Pure functions, so they are easy to test.

export type MonthTotals = { month: string; income: number; expense: number };
export type CategoryMonth = { category: string; month: string; expense: number };

export type Insight = {
	kind: 'saving' | 'category' | 'large';
	level: 'good' | 'info' | 'warn';
	text: string;
};

const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/** Share of income kept: (income - expense) / income, as a percentage; null without income. */
export function savingsRate(income: number, expense: number): number | null {
	return income > 0 ? Math.round(((income - expense) / income) * 1000) / 10 : null;
}

/**
 * @param current     the running month (partial)
 * @param previous    up to 3 completed months before it
 * @param progress    fraction of the current month already elapsed (0..1]
 */
export function savingInsights(current: MonthTotals, previous: MonthTotals[], progress: number): Insight[] {
	const out: Insight[] = [];
	const done = previous.filter((m) => m.income > 0);
	const avgRate = done.length ? mean(done.map((m) => savingsRate(m.income, m.expense) ?? 0)) : null;
	const rate = savingsRate(current.income, current.expense);

	if (rate !== null && current.income > 0 && progress > 0.2) {
		const text = `Tasso di risparmio del mese: ${rate.toFixed(0)}%${avgRate !== null ? ` (media dei mesi scorsi ${avgRate.toFixed(0)}%)` : ''}.`;
		out.push({ kind: 'saving', level: rate >= 20 ? 'good' : rate < 0 ? 'warn' : 'info', text });
	} else if (avgRate !== null) {
		out.push({ kind: 'saving', level: avgRate >= 20 ? 'good' : 'info', text: `Nei mesi scorsi hai risparmiato in media il ${avgRate.toFixed(0)}% delle entrate.` });
	}

	const avgExpense = mean(previous.map((m) => m.expense));
	if (avgExpense > 0 && progress > 0.25) {
		const projected = current.expense / progress;
		if (projected > avgExpense * 1.2 && projected - avgExpense > 100) {
			out.push({ kind: 'saving', level: 'warn', text: `Al ritmo attuale le uscite del mese arrivano a ${eur(projected)}, il ${Math.round((projected / avgExpense - 1) * 100)}% in più della media (${eur(avgExpense)}).` });
		}
	}
	return out;
}

/** Categories whose projected monthly spending is well above their recent average. */
export function categoryAnomalies(current: CategoryMonth[], history: CategoryMonth[], monthsInHistory: number, progress: number): Insight[] {
	if (monthsInHistory < 2 || progress < 0.25) return [];
	const avg = new Map<string, number>();
	for (const h of history) avg.set(h.category, (avg.get(h.category) || 0) + h.expense / monthsInHistory);

	const out: (Insight & { gap: number })[] = [];
	for (const c of current) {
		const base = avg.get(c.category) || 0;
		const projected = c.expense / progress;
		const gap = projected - base;
		if (base >= 30 && projected > base * 1.4 && gap > 40) {
			out.push({ kind: 'category', level: 'warn', gap, text: `${c.category}: ${eur(c.expense)} finora, al ritmo attuale ${eur(projected)} a fine mese contro una media di ${eur(base)}.` });
		} else if (base === 0 && c.expense > 100) {
			out.push({ kind: 'category', level: 'info', gap: c.expense, text: `${c.category}: nuova spesa di ${eur(c.expense)} questo mese, nessuna spesa simile nei mesi scorsi.` });
		}
	}
	return out.sort((a, b) => b.gap - a.gap).slice(0, 3).map(({ gap, ...i }) => i);
}

export type RecentExpense = { description: string; amount: number; date: string; category: string };

/** Single expenses far above what is usual for their category (mean + 3 standard deviations, at least 50 euro). */
export type CategoryStats = { category: string; n: number; mean: number; sd: number };

/** Mean and standard deviation per category from raw amounts (the server computes them in SQL instead). */
export function categoryStats(baseline: { category: string; amount: number }[]): CategoryStats[] {
	const byCat = new Map<string, number[]>();
	for (const b of baseline) (byCat.get(b.category) ?? byCat.set(b.category, []).get(b.category)!).push(b.amount);
	return [...byCat].map(([category, v]) => {
		const m = mean(v);
		return { category, n: v.length, mean: m, sd: Math.sqrt(mean(v.map((x) => (x - m) ** 2))) };
	});
}

export function largeExpenses(recent: RecentExpense[], stats: CategoryStats[]): Insight[] {
	const byCat = new Map(stats.map((s) => [s.category, s]));

	const out: (Insight & { amount: number })[] = [];
	for (const r of recent) {
		const s = byCat.get(r.category);
		if (!s || s.n < 8 || r.amount < 50) continue;
		const m = s.mean;
		if (r.amount > m + 3 * s.sd && r.amount > m * 2) {
			out.push({ kind: 'large', level: 'info', amount: r.amount, text: `Spesa insolita: «${r.description}» ${eur(r.amount)} (${r.category}), contro una spesa tipica di ${eur(m)}.` });
		}
	}
	return out.sort((a, b) => b.amount - a.amount).slice(0, 3).map(({ amount, ...i }) => i);
}
