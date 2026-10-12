import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, client } from '$lib/server/db';
import { categories, rules, transactions } from '$lib/server/db/schema';
import { matchRule, ruleTags } from '$lib/rules';
import { TRANSFER_TAG } from '$lib/transfers';
import { getSetting } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const all = await db.select().from(rules);
	all.sort((a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern));
	const dbCategories = await db.select().from(categories).orderBy(categories.name);
	return {
		rules: all,
		expenseCategories: dbCategories.filter((c) => c.type === 'expense').map((c) => c.name),
		incomeCategories: dbCategories.filter((c) => c.type === 'income').map((c) => c.name),
		accounts: await getSetting<string[]>('account_tags', [])
	};
};

function readRule(data: FormData) {
	const pattern = data.get('pattern')?.toString().trim();
	if (!pattern) return { error: 'Inserisci il testo da cercare nella descrizione' } as const;
	const type = (['expense', 'income'].includes(String(data.get('type'))) ? data.get('type') : 'any') as 'any' | 'expense' | 'income';
	const category = data.get('category')?.toString() || null;
	const tags = (data.get('add_tags')?.toString() || '')
		.split(',')
		.map((t) => t.trim())
		.filter((t, i, a) => t && a.indexOf(t) === i);
	const markTransfer = data.get('mark_transfer') === 'on' ? 1 : 0;
	if (!category && tags.length === 0 && !markTransfer) {
		return { error: 'La regola deve impostare una categoria, dei tag o il trasferimento' } as const;
	}
	return {
		value: {
			pattern: pattern.slice(0, 200),
			type,
			category,
			addTags: JSON.stringify(tags),
			markTransfer,
			priority: parseInt(data.get('priority')?.toString() || '0') || 0
		}
	} as const;
}

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const parsed = readRule(await request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });
		await db.insert(rules).values({ ...parsed.value, createdBy: locals.user!.id });
		return { saved: true };
	},
	edit: async ({ request }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		const parsed = readRule(data);
		if (!id) return fail(400, { error: 'ID mancante' });
		if ('error' in parsed) return fail(400, { error: parsed.error });
		await db.update(rules).set(parsed.value).where(eq(rules.id, id));
		return { saved: true };
	},
	toggle: async ({ request }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'ID mancante' });
		await db.update(rules).set({ isActive: data.get('active') === '1' ? 0 : 1 }).where(eq(rules.id, id));
		return { saved: true };
	},
	delete: async ({ request }) => {
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'ID mancante' });
		await db.delete(rules).where(eq(rules.id, id));
		return { saved: true };
	},
	// Applies the active rules to movements already registered.
	// scope "uncategorized": only rows still in "Altro"; "all": every row (categories are overwritten).
	apply: async ({ request }) => {
		const scope = (await request.formData()).get('scope') === 'all' ? 'all' : 'uncategorized';
		const active = (await db.select().from(rules)).filter((r) => r.isActive);
		if (active.length === 0) return fail(400, { error: 'Nessuna regola attiva' });

		const rows = await db.select().from(transactions);
		let changed = 0;
		const update = client.prepare('UPDATE transactions SET category = ?, tags = ? WHERE id = ?');
		client.transaction(() => {
			for (const t of rows) {
				if (scope === 'uncategorized' && t.category !== 'Altro') continue;
				const rule = matchRule(active, t.description, t.type === 'income' ? 'income' : 'expense');
				if (!rule) continue;
				let tags: string[] = [];
				try { tags = JSON.parse(t.tags || '[]'); } catch {}
				const before = JSON.stringify(tags);
				for (const tag of ruleTags(rule)) if (!tags.includes(tag)) tags.push(tag);
				if (rule.markTransfer && !tags.some((x) => x.toLowerCase() === TRANSFER_TAG.toLowerCase())) tags.push(TRANSFER_TAG);
				const category = rule.category || t.category;
				if (category !== t.category || JSON.stringify(tags) !== before) {
					update.run(category, JSON.stringify(tags), t.id);
					changed++;
				}
			}
		})();
		return { applied: changed };
	}
};
