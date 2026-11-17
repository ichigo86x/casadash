// Mapping of Open Banking (PSD2) transactions to CasaDash movements. Pure, so it is tested without a bank.

export type BankTransaction = {
	transactionId?: string;
	internalTransactionId?: string;
	bookingDate?: string;
	valueDate?: string;
	transactionAmount?: { amount?: string; currency?: string };
	creditorName?: string;
	debtorName?: string;
	remittanceInformationUnstructured?: string;
	remittanceInformationUnstructuredArray?: string[];
	additionalInformation?: string;
	proprietaryBankTransactionCode?: string;
};

export type MappedMovement = {
	externalId: string;
	/** Day of the operation: the date written in the description when there is one, else the bank's own date. */
	date: string;
	/** Day the bank booked it and day the money moved (value date): often later than the operation. */
	bookingDate?: string;
	valueDate?: string;
	/** Every other date known for this movement, used to recognise it when another source dates it differently. */
	altDates?: string[];
	description: string;
	amount: number; // negative = expense
	currency: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const validDate = (y: number, m: number, d: number) => {
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const isoDay = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '');

/**
 * A card or POS payment is often booked days after it was made, and the description says when:
 * "PAGAMENTO POS 13/11/2026 ...". Returns that day if it is plausible for a booking on `booking`
 * (up to a day after it, up to 31 days before), else null.
 */
export function dateInDescription(text: string, booking: string): string | null {
	const b = Date.parse(booking + 'T12:00:00Z');
	if (Number.isNaN(b)) return null;
	const DAY = 24 * 60 * 60 * 1000;
	for (const m of text.matchAll(/(?<![\d/.,-])(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?!\d)/g)) {
		const day = +m[1], month = +m[3];
		// "12.05" alone is more likely an amount than a date: with a dot, the year must be there
		if (m[2] === '.' && !m[4]) continue;
		let year = m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : +booking.slice(0, 4);
		if (!validDate(year, month, day)) continue;
		let t = Date.UTC(year, month - 1, day, 12);
		if (!m[4] && t > b + DAY) {
			year -= 1;
			if (!validDate(year, month, day)) continue;
			t = Date.UTC(year, month - 1, day, 12);
		}
		if (t <= b + DAY && t >= b - 31 * DAY) return `${year}-${pad(month)}-${pad(day)}`;
	}
	return null;
}

/** Picks the operation day and keeps the other dates (booking, value, operation, from the description). */
export function resolveDates(parts: { booking?: string | null; value?: string | null; transaction?: string | null; description: string }) {
	const booking = isoDay(parts.booking), value = isoDay(parts.value), transaction = isoDay(parts.transaction);
	const anchor = booking || value || transaction;
	if (!anchor) return null;
	const fromText = dateInDescription(parts.description, anchor);
	const date = fromText || transaction || booking || value;
	const alt = [...new Set([booking, value, transaction, fromText].filter((d): d is string => !!d && d !== date))];
	return { date, bookingDate: booking || undefined, valueDate: value || undefined, altDates: alt };
}

const clean = (s: string | undefined) => (s || '').replace(/\s+/g, ' ').trim();

/** One booked transaction -> movement, or null when it has no usable date or amount. */
export function mapBankTransaction(t: BankTransaction): MappedMovement | null {
	const amount = parseFloat(t.transactionAmount?.amount ?? '');
	if (!Number.isFinite(amount) || amount === 0) return null;

	const text = clean(t.remittanceInformationUnstructured) || clean(t.remittanceInformationUnstructuredArray?.join(' '));
	const party = clean(amount < 0 ? t.creditorName : t.debtorName) || clean(t.creditorName) || clean(t.debtorName);
	// Most banks give either the counterparty or the reason; both read better together
	const description = (party && text && !text.toLowerCase().includes(party.toLowerCase()) ? `${party} - ${text}` : text || party || clean(t.additionalInformation) || 'Movimento bancario').slice(0, 200);

	const dates = resolveDates({ booking: t.bookingDate, value: t.valueDate, description });
	if (!dates) return null;
	const externalId = t.transactionId || t.internalTransactionId || `${t.bookingDate || t.valueDate}|${amount}|${description}`;
	return { externalId, ...dates, description, amount: Math.round(amount * 100) / 100, currency: t.transactionAmount?.currency || 'EUR' };
}

// --- Enable Banking ---

export type EnableBankingTransaction = {
	entry_reference?: string | null;
	transaction_id?: string | null;
	booking_date?: string | null;
	value_date?: string | null;
	transaction_date?: string | null;
	transaction_amount?: { amount?: string; currency?: string };
	credit_debit_indicator?: 'CRDT' | 'DBIT' | string;
	status?: string;
	creditor?: { name?: string | null } | null;
	debtor?: { name?: string | null } | null;
	remittance_information?: string[] | string | null;
	note?: string | null;
};

/** One Enable Banking transaction -> movement (amount is positive there, the sign comes from CRDT/DBIT). */
export function mapEnableBankingTransaction(t: EnableBankingTransaction): MappedMovement | null {
	const raw = parseFloat(t.transaction_amount?.amount ?? '');
	if (!Number.isFinite(raw) || raw === 0) return null;
	const debit = t.credit_debit_indicator === 'DBIT';
	const amount = Math.round((debit ? -Math.abs(raw) : Math.abs(raw)) * 100) / 100;

	const party = clean((debit ? t.creditor?.name : t.debtor?.name) ?? '');
	const reasonRaw = t.remittance_information;
	const reason = clean(Array.isArray(reasonRaw) ? reasonRaw.join(' ') : reasonRaw ?? '') || clean(t.note ?? '');
	const description = (party && reason && !reason.toLowerCase().includes(party.toLowerCase()) ? `${party} - ${reason}` : reason || party || 'Movimento bancario').slice(0, 200);

	const dates = resolveDates({ booking: t.booking_date, value: t.value_date, transaction: t.transaction_date, description });
	if (!dates) return null;
	const externalId = t.entry_reference || t.transaction_id || `${t.booking_date || t.value_date || t.transaction_date}|${amount}|${description}`;
	return { externalId, ...dates, description, amount, currency: t.transaction_amount?.currency || 'EUR' };
}

/**
 * After the bank consent the browser lands on the registered redirect page with `?code=...&state=...`.
 * Accepts the whole address or just the code.
 */
export function extractAuthCode(input: string): string | null {
	const text = input.trim();
	if (!text) return null;
	const m = text.match(/[?&]code=([^&#\s]+)/);
	if (m) {
		try { return decodeURIComponent(m[1]); } catch { return m[1]; }
	}
	return /^[\w.~-]{8,}$/.test(text) ? text : null;
}

/** Account uids and a readable label from a session, whichever of the two payload shapes the API used. */
export function sessionAccounts(session: { accounts?: unknown; accounts_data?: unknown }): { uid: string; label: string }[] {
	const list = Array.isArray(session.accounts) ? session.accounts : [];
	const data = Array.isArray(session.accounts_data) ? (session.accounts_data as Record<string, any>[]) : [];
	const out: { uid: string; label: string }[] = [];
	for (const item of list) {
		const meta: Record<string, any> = typeof item === 'string' ? data.find((d) => d.uid === item) ?? {} : (item as Record<string, any>);
		const uid = typeof item === 'string' ? item : meta.uid;
		if (typeof uid !== 'string' || !uid) continue;
		const iban: string = meta.account_id?.iban || meta.iban || '';
		out.push({ uid, label: iban ? `…${iban.slice(-4)}` : String(meta.name || '').slice(0, 30) });
	}
	return out;
}

/**
 * Start dates to try, widest first. Banks may refuse a history window they do not allow ("Wrong transactions
 * period"): PSD2 limits unattended reads to the last 90 days, and some banks reject exactly 90 or less than that.
 */
export function periodLadder(from: string, today: Date = new Date()): string[] {
	const days = [80, 60, 30, 14, 7];
	const out = [from];
	for (const d of days) {
		const t = new Date(today);
		t.setDate(t.getDate() - d);
		const iso = t.toISOString().slice(0, 10);
		if (iso > out[out.length - 1]) out.push(iso);
	}
	return out;
}

/** True for the error banks return when the requested history window is not allowed. */
export function isPeriodError(message: string): boolean {
	return /HTTP 422/.test(message) && /period/i.test(message);
}

/** Dates sent to the bank API: first sync goes back 90 days, later ones overlap by 3 days (late bookings). */
export function syncFrom(lastSync: string | null, today: Date = new Date()): string {
	const d = new Date(today);
	if (lastSync) {
		const last = new Date(lastSync);
		if (!isNaN(last.getTime())) {
			last.setDate(last.getDate() - 3);
			return last.toISOString().slice(0, 10);
		}
	}
	d.setDate(d.getDate() - 90);
	return d.toISOString().slice(0, 10);
}
