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
	date: string;
	description: string;
	amount: number; // negative = expense
	currency: string;
};

const clean = (s: string | undefined) => (s || '').replace(/\s+/g, ' ').trim();

/** One booked transaction -> movement, or null when it has no usable date or amount. */
export function mapBankTransaction(t: BankTransaction): MappedMovement | null {
	const date = (t.bookingDate || t.valueDate || '').slice(0, 10);
	const amount = parseFloat(t.transactionAmount?.amount ?? '');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount === 0) return null;

	const text = clean(t.remittanceInformationUnstructured) || clean(t.remittanceInformationUnstructuredArray?.join(' '));
	const party = clean(amount < 0 ? t.creditorName : t.debtorName) || clean(t.creditorName) || clean(t.debtorName);
	// Most banks give either the counterparty or the reason; both read better together
	const description = (party && text && !text.toLowerCase().includes(party.toLowerCase()) ? `${party} - ${text}` : text || party || clean(t.additionalInformation) || 'Movimento bancario').slice(0, 200);

	const externalId = t.transactionId || t.internalTransactionId || `${date}|${amount}|${description}`;
	return { externalId, date, description, amount: Math.round(amount * 100) / 100, currency: t.transactionAmount?.currency || 'EUR' };
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
	const date = (t.booking_date || t.value_date || t.transaction_date || '').slice(0, 10);
	const raw = parseFloat(t.transaction_amount?.amount ?? '');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(raw) || raw === 0) return null;
	const debit = t.credit_debit_indicator === 'DBIT';
	const amount = Math.round((debit ? -Math.abs(raw) : Math.abs(raw)) * 100) / 100;

	const party = clean((debit ? t.creditor?.name : t.debtor?.name) ?? '');
	const reasonRaw = t.remittance_information;
	const reason = clean(Array.isArray(reasonRaw) ? reasonRaw.join(' ') : reasonRaw ?? '') || clean(t.note ?? '');
	const description = (party && reason && !reason.toLowerCase().includes(party.toLowerCase()) ? `${party} - ${reason}` : reason || party || 'Movimento bancario').slice(0, 200);

	const externalId = t.entry_reference || t.transaction_id || `${date}|${amount}|${description}`;
	return { externalId, date, description, amount, currency: t.transaction_amount?.currency || 'EUR' };
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
