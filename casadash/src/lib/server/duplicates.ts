import { and, between, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transactions } from '$lib/server/db/schema';
import { localDateString } from '$lib/dates';
import { SEARCH_DAYS, findSimilar, type Candidate, type Known, type Match } from '$lib/duplicates';

type Row = typeof transactions.$inferSelect;

const parseTags = (raw: string | null): string[] => {
	try {
		const t = JSON.parse(raw || '[]');
		return Array.isArray(t) ? t.map(String) : [];
	} catch {
		return [];
	}
};

export const toKnown = (r: Row): Known => ({
	id: r.id, date: r.date, amount: r.amount, type: r.type, description: r.description, category: r.category,
	paymentMethod: r.paymentMethod, tags: parseTags(r.tags), externalId: r.externalId,
	altDates: [r.bookingDate, r.valueDate].filter((d): d is string => !!d && d !== r.date)
});

export function shiftDate(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return localDateString(new Date(y, m - 1, d + days));
}

/** Movements registered in [from, to], widened by the search window, to compare many rows at once. */
export async function knownBetween(from: string, to: string): Promise<Known[]> {
	const rows = await db.select().from(transactions).where(between(transactions.date, shiftDate(from, -SEARCH_DAYS), shiftDate(to, SEARCH_DAYS)));
	return rows.map(toKnown);
}

/** Possible duplicates of a single movement (same type and amount, a few days around its date). */
export async function similarInDb(c: Candidate): Promise<Match[]> {
	const rows = await db.select().from(transactions).where(
		and(
			eq(transactions.type, c.type),
			sql`abs(${transactions.amount} - ${c.amount}) < 0.005`,
			between(transactions.date, shiftDate(c.date, -SEARCH_DAYS), shiftDate(c.date, SEARCH_DAYS))
		)
	);
	return findSimilar(c, rows.map(toKnown));
}

/** What the browser needs to show a match and let the user choose. */
export function matchView(m: Match) {
	const k = m.known;
	return { id: k.id, date: k.date, description: k.description, amount: k.amount, category: k.category ?? '', paymentMethod: k.paymentMethod ?? '', tags: k.tags ?? [], level: m.level, reason: m.reason };
}

/** Overwrites an existing movement with the new data. Tags are merged, so nothing the user added is lost. */
export async function replaceMovement(id: number, data: { description: string; amount: number; date: string; category?: string; tags: string[]; externalId?: string | null; paymentMethod?: string; settled?: number }) {
	const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
	if (!row) return false;
	const merged = [...parseTags(row.tags)];
	for (const t of data.tags) if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) merged.push(t);
	await db.update(transactions).set({
		description: data.description,
		amount: data.amount,
		date: data.date,
		...(data.category && data.category !== 'Altro' ? { category: data.category } : {}),
		...(data.paymentMethod ? { paymentMethod: data.paymentMethod, settled: data.settled ?? row.settled } : {}),
		tags: JSON.stringify(merged),
		...(data.externalId ? { externalId: data.externalId } : {})
	}).where(eq(transactions.id, id));
	return true;
}
