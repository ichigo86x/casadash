import { fail } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { goals, goalContributions, users } from '$lib/server/db/schema';
import { localDateString } from '$lib/dates';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	const rows = await db.select().from(goals).orderBy(goals.archived, goals.deadline, goals.name);

	const contributions = await db
		.select()
		.from(goalContributions)
		.orderBy(desc(goalContributions.date), desc(goalContributions.id));
	const allUsers = await db.select({ id: users.id, displayName: users.displayName }).from(users);

	const today = localDateString();
	return {
		today,
		goals: rows.map((goal) => {
			const own = contributions.filter((c) => c.goalId === goal.id);
			const saved = own.reduce((sum, c) => sum + c.amount, 0);
			// Months left until the deadline (at least 1 while the deadline has not passed)
			let monthsLeft: number | null = null;
			if (goal.deadline) {
				const [y, m] = goal.deadline.split('-').map(Number);
				const [ty, tm] = today.split('-').map(Number);
				monthsLeft = goal.deadline < today ? 0 : Math.max(1, (y - ty) * 12 + (m - tm));
			}
			const remaining = Math.max(0, goal.target - saved);
			return {
				...goal,
				saved,
				remaining,
				monthsLeft,
				monthlyNeeded: monthsLeft ? remaining / monthsLeft : null,
				contributions: own.slice(0, 10)
			};
		}),
		allUsers
	};
};

function readGoal(data: FormData) {
	const name = data.get('name')?.toString().trim();
	const target = parseFloat(data.get('target')?.toString() || '');
	const deadline = data.get('deadline')?.toString() || null;
	const color = data.get('color')?.toString() || '#4361ee';
	const icon = data.get('icon')?.toString() || 'fa-piggy-bank';
	if (!name) return { error: 'Inserisci un nome' } as const;
	if (isNaN(target) || target <= 0) return { error: 'Importo obiettivo non valido' } as const;
	return { value: { name, target, deadline, color, icon } } as const;
}

export const actions: Actions = {
	addGoal: async ({ request, locals }) => {
		const parsed = readGoal(await request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });
		await db.insert(goals).values({ ...parsed.value, createdBy: locals.user!.id, createdAt: new Date().toISOString() });
		return { success: true };
	},
	editGoal: async ({ request }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		const parsed = readGoal(data);
		if (!id) return fail(400, { error: 'ID mancante' });
		if ('error' in parsed) return fail(400, { error: parsed.error });
		await db.update(goals).set(parsed.value).where(eq(goals.id, id));
		return { success: true };
	},
	toggleArchive: async ({ request }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'ID mancante' });
		await db.update(goals).set({ archived: sql`1 - ${goals.archived}` }).where(eq(goals.id, id));
		return { success: true };
	},
	deleteGoal: async ({ request }) => {
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'ID mancante' });
		await db.delete(goalContributions).where(eq(goalContributions.goalId, id));
		await db.delete(goals).where(eq(goals.id, id));
		return { success: true };
	},
	contribute: async ({ request, locals }) => {
		const data = await request.formData();
		const goalId = parseInt(data.get('goal_id')?.toString() || '0');
		const amount = parseFloat(data.get('amount')?.toString() || '');
		const direction = data.get('direction')?.toString() === 'out' ? -1 : 1;
		const date = data.get('date')?.toString() || localDateString();
		const note = data.get('note')?.toString().trim() || null;
		if (!goalId) return fail(400, { error: 'Obiettivo mancante' });
		if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Importo non valido' });
		await db.insert(goalContributions).values({ goalId, amount: amount * direction, date, note, createdBy: locals.user!.id });
		return { success: true };
	},
	deleteContribution: async ({ request }) => {
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		if (!id) return fail(400, { error: 'ID mancante' });
		await db.delete(goalContributions).where(eq(goalContributions.id, id));
		return { success: true };
	}
};
