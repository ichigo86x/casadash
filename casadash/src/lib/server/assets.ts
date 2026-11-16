import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { assetHistory, assets } from '$lib/server/db/schema';

export const ASSET_CATEGORIES = ['Immobile', 'Veicolo', 'Investimenti', 'Pensione / TFR', 'Crediti', 'Altro'];
export const LIABILITY_CATEGORIES = ['Mutuo', 'Prestito', 'Finanziamento', 'Debito carta', 'Altro'];

/** Sum of what the family owns and owes outside the bank accounts. */
export async function assetTotals() {
	const rows = await db.select({ kind: assets.kind, value: assets.value }).from(assets);
	const sum = (kind: string) => Math.round(rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.value, 0) * 100) / 100;
	return { assets: sum('asset'), liabilities: sum('liability'), count: rows.length };
}

/** Records the value of an asset at a date (one point per day: a second update the same day replaces it). */
export async function recordValue(assetId: number, date: string, value: number) {
	const existing = await db.select().from(assetHistory).where(eq(assetHistory.assetId, assetId));
	const sameDay = existing.find((h) => h.date === date);
	if (sameDay) await db.update(assetHistory).set({ value }).where(eq(assetHistory.id, sameDay.id));
	else await db.insert(assetHistory).values({ assetId, date, value });
}

/**
 * Month-end totals of assets and liabilities for the given "YYYY-MM" labels. An asset counts from its
 * first recorded value on, and keeps its last known value between updates.
 */
export async function assetHistoryByMonth(labels: string[]) {
	const list = await db.select().from(assets);
	const points = await db.select().from(assetHistory).orderBy(asc(assetHistory.date));
	const byAsset = new Map<number, { date: string; value: number }[]>();
	for (const p of points) (byAsset.get(p.assetId) ?? byAsset.set(p.assetId, []).get(p.assetId)!).push(p);

	const assetsSeries: number[] = [];
	const liabilitiesSeries: number[] = [];
	for (const label of labels) {
		const monthEnd = `${label}-31`;
		let a = 0, l = 0;
		for (const asset of list) {
			const history = byAsset.get(asset.id) ?? [];
			let value = 0;
			for (const h of history) if (h.date <= monthEnd) value = h.value;
			if (asset.kind === 'liability') l += value;
			else a += value;
		}
		assetsSeries.push(Math.round(a * 100) / 100);
		liabilitiesSeries.push(Math.round(l * 100) / 100);
	}
	return { assets: assetsSeries, liabilities: liabilitiesSeries };
}
