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
