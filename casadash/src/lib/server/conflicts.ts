import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transactions } from '$lib/server/db/schema';
import { getSetting, setSetting } from '$lib/server/settings';
import { loadActiveRules } from '$lib/server/rules';
import { matchView, replaceMovement } from '$lib/server/duplicates';
import type { MappedMovement } from '$lib/openbanking';

// Bank movements that look like something already registered (a PayPal payment and its bank charge, a card
// expense and the monthly debit...) wait here until a person decides. Unattended syncs cannot ask.

export type Conflict = {
	id: string;
	at: string;
	connectionId: number;
	institution: string;
	accountTag: string;
	createdBy: number | null;
	movement: MappedMovement;
	matches: ReturnType<typeof matchView>[];
};

const MAX_QUEUE = 200;
const MAX_SKIPPED = 3000;

export const listConflicts = () => getSetting<Conflict[]>('bank_conflicts', []);

/** Bank ids already handled: stored, or waiting in the queue, or skipped by the user. */
export async function isKnownOrQueued(externalId: string): Promise<boolean> {
	const [row] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.externalId, externalId)).limit(1);
	if (row) return true;
	if ((await listConflicts()).some((c) => c.movement.externalId === externalId)) return true;
	return (await getSetting<string[]>('bank_skipped', [])).includes(externalId);
}

export async function queueConflict(c: Omit<Conflict, 'id' | 'at'>) {
	const queue = await listConflicts();
	queue.push({ ...c, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() });
	await setSetting('bank_conflicts', queue.slice(-MAX_QUEUE));
}

export async function conflictCount(): Promise<number> {
	return (await listConflicts()).length;
}

export type Decision = 'keep' | 'replace' | 'skip';

/** Applies the user's choice to one waiting movement. */
export async function resolveConflict(id: string, decision: Decision, replaceId?: number): Promise<string> {
	const queue = await listConflicts();
	const item = queue.find((c) => c.id === id);
	if (!item) throw new Error('Conflitto già risolto');
	const m = item.movement;

	let message: string;
	if (decision === 'keep') {
		const { movementValues } = await import('$lib/server/openbanking');
		await db.insert(transactions).values(movementValues(m, item.accountTag, item.createdBy, await loadActiveRules(), `bank-${Date.now().toString(36)}`));
		message = 'Movimento aggiunto';
	} else if (decision === 'replace') {
		const target = item.matches.find((x) => x.id === replaceId) ?? item.matches[0];
		if (!target) throw new Error('Nessun movimento da sostituire');
		const ok = await replaceMovement(target.id, { description: m.description, amount: Math.abs(m.amount), date: m.date, tags: [item.accountTag, 'Banca'], externalId: m.externalId });
		if (!ok) throw new Error('Il movimento da sostituire non esiste più');
		message = 'Movimento esistente aggiornato';
	} else {
		const skipped = await getSetting<string[]>('bank_skipped', []);
		await setSetting('bank_skipped', [...skipped, m.externalId].slice(-MAX_SKIPPED));
		message = 'Movimento ignorato';
	}
	await setSetting('bank_conflicts', queue.filter((c) => c.id !== id));
	return message;
}
