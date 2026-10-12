// Parsing of bank account exports (CSV). Pure functions, used in the browser for the preview.
// Bank files differ a lot: delimiter (; , tab), a preamble before the header row, Italian or
// English number formats, dd/mm/yyyy dates, one signed amount column or separate debit/credit.

export type Mapping = {
	headerRow: number; // index of the header row; data starts on the next row
	date: number;
	description: number[]; // one or more columns joined with " - "
	amountMode: 'single' | 'split';
	amount: number; // single signed column
	debit: number; // split mode: money out
	credit: number; // split mode: money in
	invert: boolean; // single mode: bank shows expenses as positive numbers
};

export type ParsedRow = {
	line: number; // 1-based line in the file, to help the user find problems
	date: string; // YYYY-MM-DD
	description: string;
	amount: number; // signed: negative = expense, positive = income
};

export function detectDelimiter(text: string): string {
	const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
	const counts = [';', ',', '\t', '|'].map((d) => [d, sample.split(d).length - 1] as const);
	counts.sort((a, b) => b[1] - a[1]);
	return counts[0][1] > 0 ? counts[0][0] : ';';
}

/** RFC 4180-style CSV parser (quoted fields, doubled quotes, newlines inside quotes). */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	const src = text.replace(/^﻿/, '');
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quoted) {
			if (c === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
		} else if (c === '"' && field.trim() === '') {
			quoted = true;
			field = '';
		} else if (c === delimiter) {
			row.push(field.trim());
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && src[i + 1] === '\n') i++;
			row.push(field.trim());
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field !== '' || row.length) {
		row.push(field.trim());
		rows.push(row);
	}
	return rows.filter((r) => r.some((f) => f !== ''));
}

/** "1.234,56" / "-1,234.56" / "€ 12,50" / "12,50-" -> number, or null when not a number. */
export function parseAmount(raw: string): number | null {
	if (!raw) return null;
	let s = raw.replace(/[€\s ]|EUR/gi, '');
	let negative = false;
	if (/^\(.*\)$/.test(s)) {
		negative = true;
		s = s.slice(1, -1);
	}
	if (s.endsWith('-')) {
		negative = true;
		s = s.slice(0, -1);
	}
	if (s.startsWith('-')) {
		negative = !negative;
		s = s.slice(1);
	} else if (s.startsWith('+')) s = s.slice(1);
	if (!/^[\d.,']+$/.test(s)) return null;

	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');
	let normalized: string;
	if (lastComma > lastDot) {
		// Italian: "." thousands, "," decimals
		normalized = s.replace(/[.']/g, '').replace(',', '.');
	} else if (lastDot > lastComma && lastComma >= 0) {
		// English: "," thousands, "." decimals
		normalized = s.replace(/[,']/g, '');
	} else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
		// "1.234" / "1.234.567": dots as thousands separators, no decimals
		normalized = s.replace(/\./g, '');
	} else {
		// "12.50", or "12,50" (comma only: Italian decimal separator)
		normalized = s.replace(/'/g, '').replace(',', '.');
	}
	const n = parseFloat(normalized);
	if (isNaN(n)) return null;
	return negative ? -n : n;
}

/** dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, yyyy-mm-dd (optionally followed by a time) -> YYYY-MM-DD. */
export function parseDate(raw: string): string | null {
	const s = raw.trim();
	let y: number, m: number, d: number;
	let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
	if (match) {
		[y, m, d] = [+match[1], +match[2], +match[3]];
	} else {
		match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
		if (!match) return null;
		// Italian banks: day first
		[d, m, y] = [+match[1], +match[2], +match[3]];
		if (y < 100) y += 2000;
	}
	if (m < 1 || m > 12 || d < 1 || d > 31) return null;
	const date = new Date(y, m - 1, d);
	if (date.getMonth() !== m - 1) return null;
	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The header is the last row before the first run of rows that start with a date-like value. */
export function guessHeaderRow(rows: string[][]): number {
	for (let i = 0; i < Math.min(rows.length - 1, 60); i++) {
		const next = rows.slice(i + 1, i + 4);
		const hasDates = next.length > 0 && next.every((r) => r.some((f) => parseDate(f)));
		const looksLikeHeader = rows[i].length >= 2 && !rows[i].some((f) => parseDate(f) || parseAmount(f) !== null);
		if (hasDates && looksLikeHeader) return i;
	}
	return 0;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function findColumn(header: string[], patterns: RegExp[], exclude: number[] = []): number {
	for (const p of patterns) {
		const i = header.findIndex((h, idx) => !exclude.includes(idx) && p.test(norm(h)));
		if (i >= 0) return i;
	}
	return -1;
}

/** Best guess of the column mapping from the header names (Italian and English banks). */
export function guessMapping(rows: string[][]): Mapping {
	const headerRow = guessHeaderRow(rows);
	const header = rows[headerRow] || [];
	const date = Math.max(0, findColumn(header, [/^data( |$)contab/, /^data$/, /data operazione/, /^data/, /date/]));
	const debit = findColumn(header, [/addebit/, /\bdare\b/, /uscit/, /debit/, /prelev/]);
	const credit = findColumn(header, [/accredit/, /\bavere\b/, /entrat/, /credit/, /versam/]);
	const amount = findColumn(header, [/^importo/, /importo/, /amount/, /^euro$/, /valore/]);
	let description = [findColumn(header, [/descrizione operazione/, /descrizione/, /causale/, /description/, /dettagl/, /movimento/, /beneficiar/], [date])];
	description = description.filter((i) => i >= 0);
	if (description.length === 0) {
		// Fall back to the widest text column
		const widths = header.map((_, c) =>
			rows.slice(headerRow + 1, headerRow + 20).reduce((a, r) => a + (r[c] && parseAmount(r[c]) === null && !parseDate(r[c]) ? r[c].length : 0), 0)
		);
		description = [widths.indexOf(Math.max(...widths))];
	}
	const split = debit >= 0 && credit >= 0 && debit !== credit;
	return {
		headerRow,
		date,
		description,
		amountMode: split ? 'split' : 'single',
		amount: amount >= 0 ? amount : Math.max(0, header.length - 1),
		debit: Math.max(0, debit),
		credit: Math.max(0, credit),
		invert: false
	};
}

/** Applies a mapping; rows without a valid date or amount are returned in `skipped`. */
export function applyMapping(rows: string[][], m: Mapping) {
	const parsed: ParsedRow[] = [];
	const skipped: { line: number; reason: string; raw: string }[] = [];
	for (let i = m.headerRow + 1; i < rows.length; i++) {
		const r = rows[i];
		const line = i + 1;
		const date = parseDate(r[m.date] || '');
		let amount: number | null;
		if (m.amountMode === 'split') {
			const out = parseAmount(r[m.debit] || '');
			const inn = parseAmount(r[m.credit] || '');
			// Debit columns may hold positive or negative numbers: money out is always negative
			amount = out ? -Math.abs(out) : inn ? Math.abs(inn) : null;
		} else {
			const a = parseAmount(r[m.amount] || '');
			amount = a === null ? null : m.invert ? -a : a;
		}
		const description = m.description.map((c) => r[c] || '').filter(Boolean).join(' - ').replace(/\s+/g, ' ').trim();
		if (!date) skipped.push({ line, reason: 'data non riconosciuta', raw: r.join(' | ') });
		else if (!amount) skipped.push({ line, reason: 'importo mancante', raw: r.join(' | ') });
		else parsed.push({ line, date, description: description || '(senza descrizione)', amount });
	}
	return { parsed, skipped };
}

/** Normalised description used for category suggestions and duplicate checks. */
export function descriptionKey(description: string): string {
	return norm(description)
		.replace(/\d{2}[/.-]\d{2}([/.-]\d{2,4})?/g, ' ') // dates inside card descriptions
		.replace(/\b\d{4,}\b/g, ' ') // card numbers, references
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
