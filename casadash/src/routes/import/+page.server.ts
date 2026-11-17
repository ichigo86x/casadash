import { fail } from '@sveltejs/kit';
import crypto from 'crypto';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { client, db } from '$lib/server/db';
import { categories, transactions } from '$lib/server/db/schema';
import { getSetting, setSetting } from '$lib/server/settings';
import { descriptionKey, parseDate, type Mapping } from '$lib/import';
import { TRANSFER_TAG } from '$lib/transfers';
import { matchRule, ruleTags } from '$lib/rules';
import { loadActiveRules } from '$lib/server/rules';
import { audit } from '$lib/server/audit';
import { requireAdmin } from '$lib/server/roles';
import { readRange } from '$lib/server/openbanking';
import { isValidDate } from '$lib/validate';
import { bankConnections } from '$lib/server/db/schema';
import { findSimilarIndexed, indexKnown, worst } from '$lib/duplicates';
import { knownBetween, matchView, replaceMovement } from '$lib/server/duplicates';
import type { Actions, PageServerLoad } from './$types';

// Tag added to every imported movement, so an import can be found (and undone) from the search
const IMPORT_TAG = 'Importato';
const MAX_ROWS = 5000;

// Rows read from the bank also carry its id and the other dates of the movement
type IncomingRow = { date: string; description: string; amount: number; externalId?: string; altDates?: string[]; bookingDate?: string; valueDate?: string };
// replaceId: the user chose to overwrite that existing movement instead of adding a new one
type ImportRow = IncomingRow & { category: string; transfer?: boolean; tags?: string[]; replaceId?: number };

const cleanDate = (d: unknown) => (typeof d === 'string' && parseDate(d) === d ? d : null);
const cleanDates = (v: unknown) => (Array.isArray(v) ? v.map(cleanDate).filter((d): d is string => !!d).slice(0, 6) : []);
type ImportRecord = { batch: string; at: string; count: number; account: string; user: string; file: string; undone?: boolean };
const HISTORY_SIZE = 20;

export const load: PageServerLoad = async ({ locals, url }) => {
	// Linked bank accounts: only administrators manage the bank link, so only they can read from it
	const bankAccounts = locals.user?.role === 'admin'
		? (await db.select().from(bankConnections)).filter((c) => c.status === 'linked' && c.accountId).map((c) => ({ id: c.id, name: c.institutionName, tag: c.accountTag || '' }))
		: [];
	const dbCategories = await db.select().from(categories).orderBy(categories.name);
	return {
		bankAccounts,
		bankPreselect: parseInt(url.searchParams.get('bank') || '0') || 0,
		accounts: await getSetting<string[]>('account_tags', []),
		// Column mappings remembered per file layout (keyed by the header row)
		profiles: await getSetting<Record<string, Mapping>>('import_profiles', {}),
		expenseCategories: dbCategories.filter((c) => c.type === 'expense').map((c) => c.name),
		incomeCategories: dbCategories.filter((c) => c.type === 'income').map((c) => c.name),
		history: await importHistory(),
		// Tags already in use, to suggest while editing an import
		knownTags: (client.prepare('SELECT DISTINCT j.value AS tag FROM transactions t, json_each(t.tags) j WHERE json_valid(t.tags) ORDER BY 1').all() as { tag: string }[]).map((r) => String(r.tag))
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
		const form = await request.formData();
		const rows = readRows<IncomingRow>(form.get('rows'));
		const previewAccount = form.get('account')?.toString().trim() || '';
		const previewPayment = form.get('payment_method')?.toString() || '';
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

		const dates = rows.flatMap((r) => [r.date, ...cleanDates(r.altDates)]).sort();
		// What is already registered around these dates, from any source: other imports, the bank link, manual entries
		const index = indexKnown(await knownBetween(dates[0], dates[dates.length - 1]));

		const suggestions = rows.map((r) => {
			const type = r.amount < 0 ? 'expense' : 'income';
			const key = descriptionKey(r.description);
			const amount = Math.abs(r.amount);
			const found = findSimilarIndexed({ date: r.date, amount, type, description: r.description, paymentMethod: previewPayment || undefined, tags: previewAccount ? [previewAccount] : [], externalId: typeof r.externalId === 'string' ? r.externalId : undefined, altDates: cleanDates(r.altDates) }, index);
			// A matching rule wins over the history of similar descriptions
			const rule = matchRule(activeRules, r.description, type);
			const fromHistory = byKey.get(`${type}|${key}`) || byShortKey.get(`${type}|${shortKey(key)}`) || null;
			return {
				category: rule?.category || fromHistory,
				source: rule?.category ? 'rule' : fromHistory ? 'history' : null,
				rule: rule ? rule.pattern : null,
				tags: rule ? ruleTags(rule) : [],
				transfer: !!rule?.markTransfer,
				// exact / strong (same reference or merchant) / probable (same amount, near date): see lib/duplicates.ts
				duplicate: worst(found),
				// The already registered movements, shown to the user to decide
				matches: found.slice(0, 5).map(matchView)
			};
		});
		return { suggestions };
	},

	// Reads a period of a linked account (nothing is stored): the rows go through the same preview as a file
	bankFetch: async ({ request, locals }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		const from = data.get('from')?.toString() || '';
		const to = data.get('to')?.toString() || '';
		if (!id) return fail(400, { error: 'Scegli un conto' });
		if (!isValidDate(from) || !isValidDate(to) || from > to) return fail(400, { error: 'Periodo non valido' });
		if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400) return fail(400, { error: 'Periodo troppo lungo (massimo 400 giorni)' });
		try {
			const { connection, movements, from: effectiveFrom } = await readRange(id, from, to);
			const rows = movements
				.sort((a, b) => b.date.localeCompare(a.date))
				.map((m, i) => ({ line: i + 1, date: m.date, description: m.description, amount: m.amount, externalId: m.externalId, bookingDate: m.bookingDate, valueDate: m.valueDate, altDates: m.altDates ?? [] }));
			return { bank: { rows, institution: connection.institutionName, account: connection.accountTag || '', from: effectiveFrom, requestedFrom: from } };
		} catch (e) {
			return fail(502, { error: (e as Error).message });
		}
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

		// Rows the user chose to merge into an existing movement are updated, not inserted
		const replacing = rows.filter((r) => Number.isInteger(r.replaceId) && (r.replaceId as number) > 0);
		let replaced = 0;
		for (const r of replacing) {
			const tags = [IMPORT_TAG, ...(account ? [account] : []), ...(Array.isArray(r.tags) ? r.tags.map((t) => String(t).trim().slice(0, 50)).filter(Boolean) : [])];
			if (r.transfer) tags.push(TRANSFER_TAG);
			if (await replaceMovement(r.replaceId as number, { description: String(r.description).slice(0, 500), amount: Math.round(Math.abs(r.amount) * 100) / 100, date: r.date, category: validCategories.has(r.category) ? r.category : undefined, tags })) replaced++;
		}
		const insertRows = rows.filter((r) => !replacing.includes(r));
		const fromBank = data.get('source')?.toString() === 'bank';

		const values = insertRows.map((r) => {
			const tags = [IMPORT_TAG];
			if (fromBank) tags.push('Banca');
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
				// Bank rows keep the bank's id (so the same movement is never imported twice) and its other dates
				externalId: fromBank && typeof r.externalId === 'string' ? r.externalId.slice(0, 200) : null,
				bookingDate: fromBank ? cleanDate(r.bookingDate) : null,
				valueDate: fromBank ? cleanDate(r.valueDate) : null,
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

		if (replaced) await audit(locals.user, 'import.replaced', `${replaced} movimenti sostituiti da ${(data.get('file')?.toString() || '').slice(0, 80)}`);
		console.log(`[IMPORT] ${values.length} movimenti importati da ${locals.user!.username}${account ? ` (conto ${account})` : ''}`);
		return { imported: values.length, replaced, batch };
	},

	// Fixes a whole import after the fact: add or remove a tag, change category, account or payment method
	editBatch: async ({ request, locals }) => {
		const data = await request.formData();
		const batch = data.get('batch')?.toString() || '';
		const op = data.get('op')?.toString();
		const value = data.get('value')?.toString().trim().slice(0, 50) || '';
		if (!batch) return fail(400, { error: 'Importazione non valida' });
		const rows = await db.select().from(transactions).where(eq(transactions.importBatch, batch));
		if (rows.length === 0) return fail(404, { error: 'Nessun movimento di questa importazione è rimasto' });
		const tagsOf = (raw: string | null): string[] => { try { const t = JSON.parse(raw || '[]'); return Array.isArray(t) ? t.map(String) : []; } catch { return []; } };
		const accounts = await getSetting<string[]>('account_tags', []);
		let message = '';

		if (op === 'addTag' || op === 'removeTag' || op === 'account') {
			if (!value) return fail(400, { error: op === 'account' ? 'Scegli un conto' : 'Inserisci un tag' });
			if (op === 'account' && !accounts.includes(value)) return fail(400, { error: 'Il conto non è tra quelli definiti in Categorie → Conti' });
			let changed = 0;
			db.transaction((tx) => {
				for (const r of rows) {
					const tags = tagsOf(r.tags);
					let next: string[];
					if (op === 'addTag') next = tags.some((t) => t.toLowerCase() === value.toLowerCase()) ? tags : [...tags, value];
					else if (op === 'removeTag') next = tags.filter((t) => t.toLowerCase() !== value.toLowerCase());
					// A movement belongs to one account: the previous account tags are replaced
					else next = [value, ...tags.filter((t) => !accounts.includes(t))];
					if (JSON.stringify(next) !== JSON.stringify(tags)) {
						tx.update(transactions).set({ tags: JSON.stringify(next) }).where(eq(transactions.id, r.id)).run();
						changed++;
					}
				}
			});
			message = op === 'addTag' ? `Tag «${value}» aggiunto a ${changed} movimenti` : op === 'removeTag' ? `Tag «${value}» tolto da ${changed} movimenti` : `Conto «${value}» assegnato a ${changed} movimenti`;
		} else if (op === 'category') {
			const [cat] = await db.select().from(categories).where(eq(categories.name, value)).limit(1);
			if (!cat) return fail(400, { error: 'Categoria non valida' });
			const ids = rows.filter((r) => r.type === cat.type).map((r) => r.id);
			if (ids.length) await db.update(transactions).set({ category: value }).where(inArray(transactions.id, ids));
			message = `Categoria «${value}» assegnata a ${ids.length} movimenti${rows.length - ids.length ? ` (${rows.length - ids.length} di tipo diverso lasciati invariati)` : ''}`;
		} else if (op === 'payment') {
			if (!['bancomat', 'credit_card', 'cash'].includes(value)) return fail(400, { error: 'Metodo di pagamento non valido' });
			// Only money already charged: card expenses keep their "to settle" flag untouched unless the method becomes the card
			await db.update(transactions).set({ paymentMethod: value, settled: value === 'credit_card' ? 0 : 1 }).where(eq(transactions.importBatch, batch));
			message = `Metodo di pagamento aggiornato su ${rows.length} movimenti`;
		} else {
			return fail(400, { error: 'Operazione non valida' });
		}
		await audit(locals.user, 'import.edited', `${batch}: ${op} ${value}`);
		return { edited: message, batch };
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
