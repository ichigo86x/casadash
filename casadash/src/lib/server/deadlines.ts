import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { deadlines } from '$lib/server/db/schema';
import { localDateString } from '$lib/dates';

export const DEADLINE_KINDS = ['Bollo auto', 'Assicurazione', 'Tasse', 'Utenze', 'Condominio', 'Abbonamento', 'Altro'];

const DAY = 24 * 60 * 60 * 1000;
export const daysUntil = (date: string, today = localDateString()) =>
	Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY);

/** Open deadlines that are overdue or inside their reminder window, most urgent first. */
export async function dueSoon(today = localDateString()) {
	const open = await db.select().from(deadlines).where(eq(deadlines.done, 0)).orderBy(asc(deadlines.dueDate));
	return open
		.map((d) => ({ ...d, daysLeft: daysUntil(d.dueDate, today) }))
		.filter((d) => d.daysLeft <= d.remindDays);
}
