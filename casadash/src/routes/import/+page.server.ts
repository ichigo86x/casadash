import { fail } from '@sveltejs/kit';
import crypto from 'crypto';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { categories, transactions } from '$lib/server/db/schema';
import { getSetting, setSetting } from '$lib/server/settings';
import { descriptionKey, parseDate, type Mapping } from '$lib/import';
import { TRANSFER_TAG } from '$lib/transfers';
import { matchRule, ruleTags } from '$lib/rules';
import { loadActiveRules } from '$lib/server/rules';
import type { Actions, PageServerLoad } from './$types';

// Tag added to every imported movement, so an import can be found (and undone) from the search
const IMPORT_TAG = 'Importato';
const MAX_ROWS = 5000;

type IncomingRow = { date: string; description: string; amount: number };
type ImportRow = IncomingRow & { category: string; transfer?: boolean; tags?: string[] };
type ImportRecord = { batch: string; at: string; count: number; account: string; user: string; file: string; undone?: boolean };
const HISTORY_SIZE = 20;

export const load: PageServerLoad = async () => {
	const dbCategories = await db.select().from(categories).orderBy(categories.name);
	return {
		accounts: await getSetting<string[]>('account_tags', []),
		// Column mappings remembered per file layout (keyed by the header row)
		profiles: await getSetting<Record<string, Mapping>>('import_profiles', {}),
		expenseCategories: dbCategories.filter((c) => c.type === 'expense').map((c) => c.name),
		incomeCategories: dbCategories.filter((c) => c.type === 'income').map((c) => c.name),
		history: await importHistory()
	};
};

/** Recent imports with the number of their movements still present (some may have been deleted by hand). */
async function importHistory() {
	const history = await getSetting<ImportRecord[]>('import_history', []);
	const counts = await db
		.select({ batch: transactions.importBatch, count: sql<number>`count(*)` })
		.from(transactions)
		.where(sql`${transactions.importBatch} IS NOT NULL`)
		.groupBy(transactions.importBatch);
	const remaining = new Map(counts.map((c) => [c.batch, c.count]));
	return history.map((h) => ({ ...h, remaining: remaining.get(h.batch) || 0 }));
}

function readRows<T extends IncomingRow>(raw: FormDataEntryValue | null): T[] | null {
	try {
		const rows = JSON.parse(String(raw || '[]'));
		if (!Array.isArray(rows) || rows.length > MAX_ROWS) return null;
		return rows.filter(
			(r) => r && parseDate(String(r.date)) === r.date && typeof r.amount === 'number' && isFinite(r.amount) && r.amount !== 0
		);
	} catch {
		return null;
	}
}

/** First words of the normalised description: "pagamento pos esselunga milano" -> "pagamento pos esselunga". */
const shortKey = (key: string) => key.split(' ').slice(0, 3).join(' ');

export const actions: Actions = {
	// Suggests a category for each row (from past transactions with the same description)
	// and flags rows that already exist in CasaDash.
	preview: async ({ request }) => {
		const rows = readRows<IncomingRow>((await request.formData()).get('rows'));
		if (!rows) return fail(400, { error: `File non valido o troppo grande (massimo ${MAX_ROWS} righe).` });
		if (rows.length === 0) return fail(400, { error: 'Nessuna riga con data e importo validi.' });

		const history = await db
			.select({ description: transactions.description, category: transactions.category, type: transactions.type })
			.from(transactions)
			.orderBy(desc(transactions.date), desc(transactions.id))
			.limit(20000);
		const byKey = new Map<string, string>();
		const byShortKey = new Map<string, string>();
		for (const h of history) {
			const key = `${h.type}|${descriptionKey(h.description)}`;
			if (!byKey.has(key)) byKey.set(key, h.category);
			const sk = `${h.type}|${shortKey(descriptionKey(h.description))}`;
			if (!byShortKey.has(sk)) byShortKey.set(sk, h.category);
		}

		const activeRules = await loadActiveRules();

		const dates = rows.map((r) => r.date).sort();
		const existing = await db
			.select({
				date: transactions.date,
				amount: transactions.amount,
				type: transactions.type,
				description: transactions.description,
				category: transactions.category,
				paymentMethod: transactions.paymentMethod,
				tags: transactions.tags
			})
			.from(transactions)
			.where(and(gte(transactions.date, dates[0]), lte(transactions.date, dates[dates.length - 1])));

		const suggestions = rows.map((r) => {
			const type = r.amount < 0 ? 'expense' : 'income';
			const key = descriptionKey(r.description);
			const amount = Math.abs(r.amount);
			const sameDay = existing.filter((e) => e.date === r.date && e.type === type && Math.abs(e.amount - amount) < 0.005);
			// A matching rule wins over the history of similar descriptions
			const rule = matchRule(activeRules, r.description, type);
			const fromHistory = byKey.get(`${type}|${key}`) || byShortKey.get(`${type}|${shortKey(key)}`) || null;
			return {
				category: rule?.category || fromHistory,
				source: rule?.category ? 'rule' : fromHistory ? 'history' : null,
				rule: rule ? rule.pattern : null,
				tags: rule ? ruleTags(rule) : [],
				transfer: !!rule?.markTransfer,
				// exact: same date, amount and description; probable: same date and amount only
				duplicate: sameDay.some((e) => descriptionKey(e.description) === key) ? 'exact' : sameDay.length ? 'probable' : null,
				// The already registered movements, shown to the user to decide
				matches: sameDay.slice(0, 5).map((e) => {
					let tags: string[] = [];
					try { tags = JSON.parse(e.tags || '[]'); } catch {}
					return { description: e.description, amount: e.amount, category: e.category, paymentMethod: e.paymentMethod, tags };
				})
			};
		});
		return { suggestions };
	},

	import: async ({ request, locals }) => {
		const data = await request.formData();
		const rows = readRows<ImportRow>(data.get('rows'));
		if (!rows) return fail(400, { error: 'Dati di importazione non validi.' });
		if (rows.length === 0) return fail(400, { error: 'Nessuna riga selezionata.' });

		const account = data.get('account')?.toString().trim() || '';
		const paymentMethod = ['bancomat', 'credit_card', 'cash'].includes(String(data.get('payment_method')))
			? String(data.get('payment_method'))
			: 'bancomat';
		// Statement lines are already charged, so card expenses are normally settled
		const settled = paymentMethod === 'credit_card' ? (data.get('settled') === 'on' ? 1 : 0) : 1;
		const validCategories = new Set((await db.select({ name: categories.name }).from(categories)).map((c) => c.name));
		const batch = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

		const values = rows.map((r) => {
			const tags = [IMPORT_TAG];
			if (account) tags.unshift(account);
			for (const t of Array.isArray(r.tags) ? r.tags : []) {
				const tag = String(t).trim().slice(0, 50);
				if (tag && !tags.includes(tag)) tags.push(tag);
			}
			if (r.transfer && !tags.some((t) => t.toLowerCase() === TRANSFER_TAG.toLowerCase())) tags.push(TRANSFER_TAG);
			return {
				type: r.amount < 0 ? 'expense' : 'income',
				description: String(r.description).slice(0, 500),
				amount: Math.round(Math.abs(r.amount) * 100) / 100,
				date: r.date,
				category: validCategories.has(r.category) ? r.category : 'Altro',
				paymentMethod,
				tags: JSON.stringify(tags),
				settled,
				importBatch: batch,
				createdBy: locals.user!.id
			};
		});

		db.transaction((tx) => {
			for (let i = 0; i < values.length; i += 200) {
				tx.insert(transactions).values(values.slice(i, i + 200)).run();
			}
		});

		// Remember the column mapping for the next file with the same layout
		const signature = data.get('signature')?.toString();
		const mapping = data.get('mapping')?.toString();
		if (signature && mapping) {
			try {
				const profiles = await getSetting<Record<string, Mapping>>('import_profiles', {});
				profiles[signature.slice(0, 500)] = JSON.parse(mapping);
				await setSetting('import_profiles', profiles);
			} catch {
				/* the mapping is a convenience: ignore a malformed one */
			}
		}

		const history = await getSetting<ImportRecord[]>('import_history', []);
		history.unshift({
			batch,
			at: new Date().toISOString(),
			count: values.length,
			account,
			user: locals.user!.displayName,
			file: (data.get('file')?.toString() || '').slice(0, 120)
		});
		await setSetting('import_history', history.slice(0, HISTORY_SIZE));

		console.log(`[IMPORT] ${values.length} movimenti importati da ${locals.user!.username}${account ? ` (conto ${account})` : ''}`);
		return { imported: values.length, batch };
	},

	// Deletes every movement created by one import (movements already deleted by hand are simply gone)
	undo: async ({ request, locals }) => {
		const batch = (await request.formData()).get('batch')?.toString() || '';
		const history = await getSetting<ImportRecord[]>('import_history', []);
		const record = history.find((h) => h.batch === batch);
		if (!record) return fail(404, { error: 'Importazione non trovata' });
		const removed = await db.delete(transactions).where(eq(transactions.importBatch, batch)).returning({ id: transactions.id });
		record.undone = true;
		await setSetting('import_history', history);
		console.log(`[IMPORT] Importazione ${batch} annullata da ${locals.user!.username}: ${removed.length} movimenti eliminati`);
		return { undone: removed.length };
	}
};
