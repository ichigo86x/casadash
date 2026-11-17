import { fail } from '@sveltejs/kit';
import { listConflicts, resolveConflict, type Decision } from '$lib/server/conflicts';
import { audit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ conflicts: await listConflicts() });

export const actions: Actions = {
	resolve: async ({ request, locals }) => {
		const data = await request.formData();
		const id = data.get('id')?.toString() || '';
		const decision = data.get('decision')?.toString() as Decision;
		if (!['keep', 'replace', 'skip'].includes(decision)) return fail(400, { error: 'Scelta non valida' });
		const replaceId = parseInt(data.get('replace_id')?.toString() || '0') || undefined;
		try {
			const message = await resolveConflict(id, decision, replaceId);
			await audit(locals.user, 'bank.conflict_resolved', `${decision}: ${id}`);
			return { done: message };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},
	// Same choice for everything waiting: handy after a first sync of a long history
	resolveAll: async ({ request, locals }) => {
		const decision = (await request.formData()).get('decision')?.toString() as Decision;
		if (!['keep', 'skip'].includes(decision)) return fail(400, { error: 'Scelta non valida' });
		let n = 0;
		for (const c of await listConflicts()) {
			try { await resolveConflict(c.id, decision); n++; } catch { /* already handled */ }
		}
		await audit(locals.user, 'bank.conflict_resolved', `${decision} su ${n}`);
		return { done: `${n} movimenti ${decision === 'keep' ? 'aggiunti' : 'ignorati'}` };
	}
};
