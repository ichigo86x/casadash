import { inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transactions } from '$lib/server/db/schema';
import { getSetting, setSetting } from '$lib/server/settings';
import { receiptName } from '$lib/server/receipts';

// Deleted movements are kept for a while so a mistaken delete can be undone.
// Their receipt files stay on disk too (the orphan cleanup treats them as referenced).

type Row = typeof transactions.$inferSelect;
type Batch = { batch: string; at: string; rows: Row[] };

const KEEP_DAYS = 30;
const MAX_BATCHES = 30;

async function load(): Promise<Batch[]> {
	const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
	return (await getSetting<Batch[]>('trash', [])).filter((b) => new Date(b.at).getTime() > cutoff);
}

/** Saves the rows (before they are deleted) and returns the batch id used to undo. */
export async function trashRows(rows: Row[]): Promise<string | null> {
	if (rows.length === 0) return null;
	const batch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	const all = await load();
	all.unshift({ batch, at: new Date().toISOString(), rows });
	await setSetting('trash', all.slice(0, MAX_BATCHES));
	return batch;
}

/** Puts a deleted batch back. Returns how many movements came back. */
export async function restoreBatch(batch: string): Promise<number> {
	const all = await load();
	const found = all.find((b) => b.batch === batch);
	if (!found) return 0;
	const ids = found.rows.map((r) => r.id);
	const taken = new Set((await db.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, ids))).map((r) => r.id));
	const toInsert = found.rows.filter((r) => !taken.has(r.id));
	for (let i = 0; i < toInsert.length; i += 200) await db.insert(transactions).values(toInsert.slice(i, i + 200));
	await setSetting('trash', all.filter((b) => b.batch !== batch));
	return toInsert.length;
}

/** Receipt file names still needed by deleted movements. */
export async function trashedReceipts(): Promise<Set<string>> {
	const names = new Set<string>();
	for (const b of await load()) for (const r of b.rows) {
		const n = receiptName(r.receiptPath);
		if (n) names.add(n);
	}
	return names;
}
