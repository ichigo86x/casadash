// Reads what an OCR engine produced from a receipt photo and guesses total, date and shop.
// Pure functions, tested without the OCR engine.

export type ReceiptGuess = { amount: number | null; date: string | null; merchant: string | null };

const TOTAL_WORDS = /(totale|importo|da pagare|pagato|pagamento|total|amount|saldo)/i;
const EXCLUDE_WORDS = /(subtotale|iva|imponibile|resto|contanti|sconto|punti|prezzo\s*unit)/i;

/** "1.234,56" / "1,234.56" / "12,50" / "12.5" -> number */
function toNumber(raw: string): number | null {
	let s = raw.replace(/\s/g, '');
	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');
	if (lastComma >= 0 && lastDot >= 0) {
		s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
	} else if (lastComma >= 0) {
		s = s.replace(',', '.');
	}
	const n = parseFloat(s);
	return Number.isFinite(n) ? n : null;
}

const AMOUNT = /(?:€|eur)?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})\s*(?:€|eur)?/gi;

function amountsIn(line: string): number[] {
	const out: number[] = [];
	for (const m of line.matchAll(AMOUNT)) {
		const n = toNumber(m[1]);
		if (n !== null && n > 0 && n < 100000) out.push(n);
	}
	return out;
}

export function parseReceiptText(text: string): ReceiptGuess {
	const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

	// Amount: prefer a figure on a "TOTALE"-like line (excluding subtotals/VAT), else the largest figure
	let amount: number | null = null;
	for (const line of lines) {
		if (TOTAL_WORDS.test(line) && !EXCLUDE_WORDS.test(line)) {
			const found = amountsIn(line);
			if (found.length) amount = Math.max(amount ?? 0, found[found.length - 1]);
		}
	}
	if (amount === null) {
		const all = lines.filter((l) => !EXCLUDE_WORDS.test(l)).flatMap(amountsIn);
		if (all.length) amount = Math.max(...all);
	}

	// Date: dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy or yyyy-mm-dd
	let date: string | null = null;
	for (const line of lines) {
		let m = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
		if (m) {
			const d = +m[1], mo = +m[2];
			const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
			if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100) {
				date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
				break;
			}
		}
		m = line.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
		if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
			date = m[0];
			break;
		}
	}

	// Merchant: first line with at least 3 letters that is not an address/number line
	const merchant =
		lines
			.slice(0, 6)
			.find((l) => (l.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 3 && !/^(via|viale|piazza|p\.?\s*iva|c\.?f\.?|tel|www|scontrino|documento)/i.test(l) && !/\d{5,}/.test(l)) ?? null;

	return { amount, date, merchant: merchant ? merchant.replace(/\s{2,}/g, ' ').slice(0, 80) : null };
}
