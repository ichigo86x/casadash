import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { categories, deadlines, transactions } from '$lib/server/db/schema';
import { localDateString, nextOccurrence } from '$lib/dates';
import { DEADLINE_KINDS, daysUntil } from '$lib/server/deadlines';
import { isValidDate, parseAmount } from '$lib/validate';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = localDateString();
	const rows = await db.select().from(deadlines).orderBy(asc(deadlines.done), asc(deadlines.dueDate));
	const cats = await db.select({ name: categories.name }).from(categories).where(eq(categories.type, 'expense'));
	return {
		today,
		kinds: DEADLINE_KINDS,
		categories: cats.map((c) => c.name),
		deadlines: rows.map((d) => ({ ...d, daysLeft: daysUntil(d.dueDate, today) }))
	};
};

function readDeadline(data: FormData) {
	const title = data.get('title')?.toString().trim().slice(0, 100);
	const dueDate = data.get('due_date')?.toString() || '';
	const amountRaw = data.get('amount')?.toString().trim();
	const amount = amountRaw ? parseAmount(amountRaw) : 0;
	const kind = DEADLINE_KINDS.includes(data.get('kind')?.toString() || '') ? data.get('kind')!.toString() : 'Altro';
	const repeat = ['none', 'monthly', 'yearly'].includes(data.get('repeat')?.toString() || '') ? (data.get('repeat')!.toString() as 'none' | 'monthly' | 'yearly') : 'none';
	const remindDays = Math.min(365, Math.max(0, parseInt(data.get('remind_days')?.toString() || '14') || 0));
	const category = data.get('category')?.toString() || null;
	if (!title) return { error: 'Inserisci un titolo' } as const;
	if (!isValidDate(dueDate)) return { error: 'Data di scadenza non valida' } as const;
	if (amount === null) return { error: 'Importo non valido' } as const;
	return { value: { title, dueDate, amount, kind, repeat, remindDays, category } } as const;
}

export const actions: Actions = {
	add: async ({ request, locals }) => {
		const parsed = readDeadline(await request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });
		await db.insert(deadlines).values({ ...parsed.value, createdBy: locals.user!.id });
		return { success: true };
	},
	edit: async ({ request }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		const parsed = readDeadline(data);
		if (!id) return fail(400, { error: 'Scadenza non valida' });
		if ('error' in parsed) return fail(400, { error: parsed.error });
		await db.update(deadlines).set(parsed.value).where(eq(deadlines.id, id));
		return { success: true };
	},
	// Paid: optionally books the expense, then closes the deadline or moves a repeating one to its next date
	pay: async ({ request, locals }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		const [d] = await db.select().from(deadlines).where(eq(deadlines.id, id)).limit(1);
		if (!d) return fail(404, { error: 'Scadenza non trovata' });

		if (data.get('book') === 'on' && d.amount > 0) {
			const paidAmount = parseAmount(data.get('paid_amount')?.toString() || '') ?? d.amount;
			await db.insert(transactions).values({
				type: 'expense',
				description: d.title,
				amount: paidAmount,
				date: localDateString(),
				category: d.category || 'Altro',
				paymentMethod: 'bancomat',
				tags: JSON.stringify(['Scadenza']),
				settled: 1,
				createdBy: locals.user!.id
			});
		}
		if (d.repeat === 'none') {
			await db.update(deadlines).set({ done: 1 }).where(eq(deadlines.id, id));
		} else {
			await db.update(deadlines).set({ dueDate: nextOccurrence(d.dueDate, d.repeat, parseInt(d.dueDate.slice(8, 10))) }).where(eq(deadlines.id, id));
		}
		return { success: true };
	},
	reopen: async ({ request }) => {
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		await db.update(deadlines).set({ done: 0 }).where(eq(deadlines.id, id));
		return { success: true };
	},
	delete: async ({ request }) => {
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'Scadenza non valida' });
		await db.delete(deadlines).where(eq(deadlines.id, id));
		return { success: true };
	}
};
