// A movement tagged "Trasferimento" moves money between the family's own accounts
// (e.g. Poste -> Libretto). It changes account balances but is neither income nor expense.
export const TRANSFER_TAG = 'Trasferimento';

export function isTransferTags(tags: string | null | undefined): boolean {
	try {
		const parsed = JSON.parse(tags || '[]');
		return Array.isArray(parsed) && parsed.some((t) => String(t).toLowerCase() === TRANSFER_TAG.toLowerCase());
	} catch {
		return false;
	}
}
