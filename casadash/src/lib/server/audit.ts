import { desc } from 'drizzle-orm';
import { client, db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';

type Actor = { id: number; username: string } | null | undefined;

/** Records who did what. Never throws: an audit failure must not break the action itself. */
export async function audit(actor: Actor, action: string, detail?: string, ip?: string) {
	try {
		await db.insert(auditLog).values({
			at: new Date().toISOString(),
			userId: actor?.id ?? null,
			username: actor?.username ?? null,
			action,
			detail: detail?.slice(0, 500) ?? null,
			ip: ip ?? null
		});
	} catch (e) {
		console.error('[AUDIT] Registrazione non riuscita:', (e as Error).message);
	}
}

export async function recentAudit(limit = 300) {
	return db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit);
}

/** Keeps the log from growing forever: entries older than a year are dropped. */
export function pruneAudit() {
	const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
	client.prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff);
}
