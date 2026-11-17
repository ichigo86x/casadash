// Finds movements that may be the same payment seen twice: from two imports, from a bank link and a
// file, or typed by hand after being imported. The same money often shows up in two places
// (a PayPal payment funded by a bank account, a card expense and its monthly charge), with a different
// date, a different description and a different reference. Pure functions, used on the server and tested.
import { descriptionKey } from '$lib/import';

export type Known = {
	id: number;
	date: string; // YYYY-MM-DD
	amount: number; // positive
	type: string; // income | expense
	description: string;
	category?: string;
	paymentMethod?: string;
	tags?: string[];
	externalId?: string | null;
};

export type Candidate = {
	date: string;
	amount: number; // positive
	type: string;
	description: string;
	paymentMethod?: string;
	tags?: string[]; // the account tag among them
	externalId?: string | null;
};

/** exact: same day, amount and description. strong: same amount and a shared reference or merchant. probable: same amount, same day or a few days apart from another source. */
export type Level = 'exact' | 'strong' | 'probable';

export type Match = { known: Known; level: Level; reason: string };

const DAY = 24 * 60 * 60 * 1000;
const NEAR_DAYS = 3;
export const SEARCH_DAYS = NEAR_DAYS;

const dayDiff = (a: string, b: string) => Math.round(Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / DAY);

// Words that say how a payment was made, not what or where: they match almost everything
const FILLER = new Set([
	'pagamento', 'pagamenti', 'carta', 'pos', 'addebito', 'accredito', 'bonifico', 'acquisto', 'operazione', 'transazione',
	'visa', 'mastercard', 'debit', 'credit', 'europe', 'sarl', 'spa', 'srl', 'italia', 'italy', 'sepa', 'cro', 'trn', 'del', 'della',
	'per', 'con', 'ordine', 'riferimento', 'online', 'web', 'contactless', 'prelievo', 'commissione', 'commissioni', 'data', 'valuta'
]);

const words = (description: string) => descriptionKey(description).split(' ').filter((w) => w.length >= 4 && !FILLER.has(w) && !/^\d+$/.test(w));

/** Long alphanumeric codes that contain a digit: transaction ids, CRO/TRN references, order numbers. */
export function references(description: string): string[] {
	const found = description.toUpperCase().match(/[A-Z0-9]{9,}/g) ?? [];
	return found.filter((t) => /\d/.test(t) && !/^\d{9,}$/.test(t) || /^\d{11,}$/.test(t));
}

const ACCOUNT_LESS = new Set(['importato', 'banca', 'ricorrente', 'trasferimento']);
const sources = (tags: string[] = [], paymentMethod = '') => ({ pay: paymentMethod, tags: new Set(tags.map((t) => t.toLowerCase()).filter((t) => !ACCOUNT_LESS.has(t))) });

/** True when the two movements clearly come from different places (another account, or card vs account). */
function differentSource(c: Candidate, k: Known): boolean {
	const a = sources(c.tags, c.paymentMethod), b = sources(k.tags, k.paymentMethod);
	if (a.pay && b.pay && a.pay !== b.pay) return true;
	if (a.tags.size && b.tags.size) return ![...a.tags].some((t) => b.tags.has(t));
	return false;
}

/**
 * Compares one incoming movement with what is already registered. Returns the likely duplicates, most
 * certain first. Rows with the same bank id are always an exact match.
 */
export function findSimilar(c: Candidate, known: Known[]): Match[] {
	const out: Match[] = [];
	const key = descriptionKey(c.description);
	const cWords = new Set(words(c.description));
	const cRefs = new Set(references(c.description));

	for (const k of known) {
		if (k.type !== c.type || Math.abs(k.amount - c.amount) >= 0.005) continue;
		if (c.externalId && k.externalId && c.externalId === k.externalId) {
			out.push({ known: k, level: 'exact', reason: 'stesso identificativo della banca' });
			continue;
		}
		const gap = dayDiff(c.date, k.date);
		if (gap > NEAR_DAYS) continue;

		const sameDescription = descriptionKey(k.description) === key;
		if (gap === 0 && sameDescription) {
			out.push({ known: k, level: 'exact', reason: 'stessa data, importo e descrizione' });
			continue;
		}

		const sharedRef = references(k.description).find((r) => cRefs.has(r));
		if (sharedRef) {
			out.push({ known: k, level: 'strong', reason: `stesso riferimento ${sharedRef}` });
			continue;
		}

		const shared = words(k.description).find((w) => cWords.has(w));
		if (shared && (gap <= 1 || sameDescription || differentSource(c, k))) {
			out.push({ known: k, level: 'strong', reason: `stesso importo e «${shared}»${gap ? `, ${gap} giorno/i di differenza` : ''}` });
			continue;
		}
		if (gap === 0) {
			out.push({ known: k, level: 'probable', reason: 'stessa data e importo' });
			continue;
		}
		// A few days apart: only when the money comes from another place (a PayPal payment and its bank charge)
		if (differentSource(c, k) || shared) {
			out.push({ known: k, level: 'probable', reason: `stesso importo, ${gap} giorno/i di differenza${differentSource(c, k) ? ' su un altro conto o metodo' : ''}` });
		}
	}
	const rank = { exact: 0, strong: 1, probable: 2 } as const;
	return out.sort((a, b) => rank[a.level] - rank[b.level] || dayDiff(c.date, a.known.date) - dayDiff(c.date, b.known.date));
}

export function worst(matches: Match[]): Level | null {
	if (matches.some((m) => m.level === 'exact')) return 'exact';
	if (matches.some((m) => m.level === 'strong')) return 'strong';
	return matches.length ? 'probable' : null;
}

/** Groups known movements by type and amount in cents, so a long list is not scanned for every row. */
export function indexKnown(known: Known[]): Map<string, Known[]> {
	const index = new Map<string, Known[]>();
	for (const k of known) {
		const key = `${k.type}|${Math.round(k.amount * 100)}`;
		(index.get(key) ?? index.set(key, []).get(key)!).push(k);
	}
	return index;
}

export function findSimilarIndexed(c: Candidate, index: Map<string, Known[]>): Match[] {
	return findSimilar(c, index.get(`${c.type}|${Math.round(c.amount * 100)}`) ?? []);
}
