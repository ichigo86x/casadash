import { db } from '$lib/server/db';
import { rules } from '$lib/server/db/schema';

export async function loadActiveRules() {
	return (await db.select().from(rules)).filter((r) => r.isActive);
}
