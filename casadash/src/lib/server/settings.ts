import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';

/** Reads a JSON setting, falling back to `fallback` when missing or unreadable. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
	if (!rows[0]) return fallback;
	try {
		return JSON.parse(rows[0].value) as T;
	} catch {
		return fallback;
	}
}

export async function setSetting(key: string, value: unknown) {
	const json = JSON.stringify(value);
	await db
		.insert(settings)
		.values({ key, value: json })
		.onConflictDoUpdate({ target: settings.key, set: { value: json } });
}
