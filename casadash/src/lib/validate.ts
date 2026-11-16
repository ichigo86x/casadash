// Input checks shared by every form that writes money data. Pure functions: easy to test.

export const MAX_AMOUNT = 1_000_000_000;
export const PAYMENT_METHODS = ['bancomat', 'cash', 'credit_card'] as const;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Accepts "12.5" and "12,5". Returns a positive amount rounded to cents, or null. */
export function parseAmount(raw: unknown): number | null {
	const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').trim().replace(',', '.'));
	if (!Number.isFinite(n) || n <= 0 || n >= MAX_AMOUNT) return null;
	const r = round2(n);
	return r > 0 ? r : null;
}

/** "YYYY-MM-DD" that is a real calendar date. */
export function isValidDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number);
	if (y < 1990 || y > 2200) return false;
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Cleans a JSON list of tags: strings, trimmed, unique (case-insensitive), at most 30 of 40 chars. */
export function parseTags(raw: unknown): string[] | null {
	let list: unknown;
	try {
		list = JSON.parse(String(raw || '[]'));
	} catch {
		return null;
	}
	if (!Array.isArray(list)) return null;
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of list) {
		if (typeof t !== 'string') return null;
		const tag = t.trim().slice(0, 40);
		if (!tag || seen.has(tag.toLowerCase())) continue;
		seen.add(tag.toLowerCase());
		out.push(tag);
	}
	return out.length <= 30 ? out : null;
}

export type TransactionInput = {
	type: 'income' | 'expense';
	description: string;
	amount: number;
	date: string;
	category: string;
	paymentMethod: (typeof PAYMENT_METHODS)[number];
	tags: string[];
	settled: 0 | 1;
	// Foreign currency originally paid. The amount above is always in euro: orig / rate.
	origAmount: number | null;
	origCurrency: string | null;
	fxRate: number | null;
};

/**
 * Validates the movement form. `categories` is the list of {name, type}: an unknown category or one of
 * the wrong type falls back to "Altro" instead of being stored as typed.
 */
export function validateTransaction(
	form: { get(name: string): FormDataEntryValue | null },
	categories: { name: string; type: string }[]
): { error: string } | { value: TransactionInput } {
	const str = (k: string) => form.get(k)?.toString().trim() ?? '';
	const type = str('type');
	if (type !== 'income' && type !== 'expense') return { error: 'Tipo di movimento non valido' };

	const description = str('description');
	if (!description) return { error: 'Compila tutti i campi obbligatori' };
	if (description.length > 200) return { error: 'Descrizione troppo lunga (massimo 200 caratteri)' };

	let amount = parseAmount(str('amount'));
	let origAmount: number | null = null;
	let origCurrency: string | null = null;
	let fxRate: number | null = null;
	const currency = str('orig_currency').toUpperCase();
	if (currency && currency !== 'EUR') {
		const foreign = parseAmount(str('orig_amount'));
		const rate = parseFloat(str('fx_rate').replace(',', '.'));
		if (!/^[A-Z]{3}$/.test(currency) || foreign === null || !Number.isFinite(rate) || rate <= 0 || rate > 1e6) {
			return { error: 'Valuta estera non valida: servono valuta, importo e cambio' };
		}
		origAmount = foreign;
		origCurrency = currency;
		fxRate = rate;
		amount = parseAmount(foreign / rate);
	}
	if (amount === null) return { error: 'Importo non valido' };

	const date = str('date');
	if (!isValidDate(date)) return { error: 'Data non valida' };

	const requested = str('category');
	const category = categories.some((c) => c.name === requested && c.type === type) ? requested : 'Altro';

	const paymentMethod = (PAYMENT_METHODS as readonly string[]).includes(str('payment_method'))
		? (str('payment_method') as TransactionInput['paymentMethod'])
		: 'bancomat';

	const tags = parseTags(form.get('tags'));
	if (!tags) return { error: 'Tag non validi' };

	const settled = paymentMethod === 'credit_card' ? (str('settled') === '1' ? 1 : 0) : 1;
	return { value: { type, description, amount, date, category, paymentMethod, tags, settled, origAmount, origCurrency, fxRate } };
}
