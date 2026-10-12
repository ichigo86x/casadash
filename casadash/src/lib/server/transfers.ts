import { sql } from 'drizzle-orm';
import { transactions } from '$lib/server/db/schema';
import { TRANSFER_TAG } from '$lib/transfers';

/** SQL condition: the transaction carries the "Trasferimento" tag (case-insensitive). */
export const isTransfer = sql`(json_valid(${transactions.tags}) AND EXISTS (
	SELECT 1 FROM json_each(${transactions.tags}) WHERE lower(json_each.value) = lower(${TRANSFER_TAG})
))`;

/** SQL condition: a real income or expense, i.e. not a transfer between own accounts. */
export const notTransfer = sql`NOT ${isTransfer}`;

/** SQL condition: the transaction carries the given tag (exact match). */
export function hasTag(tag: string) {
	return sql`(json_valid(${transactions.tags}) AND EXISTS (
		SELECT 1 FROM json_each(${transactions.tags}) WHERE json_each.value = ${tag}
	))`;
}
