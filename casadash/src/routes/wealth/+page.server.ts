import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { assetHistory, assets } from '$lib/server/db/schema';
import { getSetting } from '$lib/server/settings';
import { localDateString } from '$lib/dates';
import { accountBalances } from '$lib/server/stats';
import { wealthHistory } from '$lib/server/wealth';
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES, assetHistoryByMonth, assetTotals, recordValue } from '$lib/server/assets';
import { round2 } from '$lib/validate';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const accountTags = await getSetting<string[]>('account_tags', []);
	const accounts = await accountBalances(accountTags);
	const liquid = round2(accounts.reduce((s, a) => s + a.balance, 0));
	const list = await db.select().from(assets).orderBy(assets.kind, assets.name);
	const totals = await assetTotals();

	// Net worth over the last 24 months: bank accounts + assets - liabilities
	const history = await wealthHistory(accountTags, 24);
	const byMonth = await assetHistoryByMonth(history.labels);
	const net = history.labels.map((_, i) => round2(history.total[i] + byMonth.assets[i] - byMonth.liabilities[i]));

	return {
		today: localDateString(),
		assets: list,
		assetCategories: ASSET_CATEGORIES,
		liabilityCategories: LIABILITY_CATEGORIES,
		liquid,
		accounts,
		totals,
		netWorth: round2(liquid + totals.assets - totals.liabilities),
		history: { labels: history.labels, accounts: history.total, assets: byMonth.assets, liabilities: byMonth.liabilities, net }
	};
};

function read(data: FormData) {
	const name = data.get('name')?.toString().trim().slice(0, 80);
	const kind = data.get('kind')?.toString() === 'liability' ? 'liability' : 'asset';
	const allowed = kind === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES;
	const category = allowed.includes(data.get('category')?.toString() || '') ? data.get('category')!.toString() : 'Altro';
	const value = parseFloat((data.get('value')?.toString() || '').replace(',', '.'));
	const note = data.get('note')?.toString().trim().slice(0, 200) || null;
	if (!name) return { error: 'Inserisci un nome' } as const;
	if (!Number.isFinite(value) || value < 0 || value > 1e10) return { error: 'Valore non valido' } as const;
	return { value: { name, kind, category, value: round2(value), note } } as const;
}

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const parsed = read(await request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });
		const today = localDateString();
		const [row] = await db.insert(assets).values({ ...parsed.value, updatedAt: today, createdBy: locals.user!.id }).returning({ id: assets.id });
		await recordValue(row.id, today, parsed.value.value);
		return { success: true };
	},
	edit: async ({ request }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		const parsed = read(data);
		if (!id) return fail(400, { error: 'Voce non valida' });
		if ('error' in parsed) return fail(400, { error: parsed.error });
		const today = localDateString();
		await db.update(assets).set({ ...parsed.value, updatedAt: today }).where(eq(assets.id, id));
		await recordValue(id, today, parsed.value.value);
		return { success: true };
	},
	delete: async ({ request }) => {
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'Voce non valida' });
		await db.delete(assetHistory).where(eq(assetHistory.assetId, id));
		await db.delete(assets).where(eq(assets.id, id));
		return { success: true };
	}
};
