import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bankConnections } from '$lib/server/db/schema';
import { getSetting } from '$lib/server/settings';
import { requireAdmin } from '$lib/server/roles';
import { audit } from '$lib/server/audit';
import {
	clearCredentials, completeConnection, disconnect, getCredentials, saveCredentials,
	searchInstitutions, startConnection, syncConnection
} from '$lib/server/openbanking';
import type { Actions, PageServerLoad } from './$types';

// Administrators only: enforced by the guard in hooks.server.ts
export const load: PageServerLoad = async ({ url }) => {
	const configured = !!(await getCredentials());
	let message = '';
	let error = '';

	// The bank sends the user back here with ?ref=...: finish linking the accounts
	const ref = url.searchParams.get('ref');
	if (ref && configured) {
		const pending = (await db.select().from(bankConnections)).find((c) => c.status === 'pending');
		try {
			if (pending) message = `Banca collegata: ${await completeConnection(pending.requisitionId)} conto/i trovato/i. Scegli ora a quale conto di CasaDash corrispondono.`;
		} catch (e) {
			error = (e as Error).message;
		}
	}

	let institutions: { id: string; name: string; logo?: string }[] = [];
	const q = url.searchParams.get('q');
	if (configured && q !== null) {
		try {
			institutions = await searchInstitutions(url.searchParams.get('country') || 'it', q);
		} catch (e) {
			error = (e as Error).message;
		}
	}

	return {
		configured,
		message,
		error,
		q: q ?? '',
		institutions,
		connections: await db.select().from(bankConnections),
		accountTags: await getSetting<string[]>('account_tags', [])
	};
};

export const actions: Actions = {
	saveCredentials: async ({ request, locals, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const secretId = data.get('secret_id')?.toString().trim() || '';
		const secretKey = data.get('secret_key')?.toString().trim() || '';
		if (!secretId || !secretKey) return fail(400, { error: 'Inserisci entrambe le chiavi' });
		await saveCredentials(secretId, secretKey);
		if (!(await getCredentials())) return fail(500, { error: 'Impossibile salvare le chiavi' });
		await audit(locals.user, 'bank.credentials_saved', undefined, getClientAddress());
		return { saved: true };
	},
	removeCredentials: async ({ locals, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		await clearCredentials();
		await audit(locals.user, 'bank.credentials_removed', undefined, getClientAddress());
		return { saved: true };
	},
	connect: async ({ request, locals, url, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const id = data.get('institution_id')?.toString() || '';
		const name = data.get('institution_name')?.toString() || '';
		if (!id) return fail(400, { error: 'Scegli una banca' });
		// The bank sends the browser back to this page: use the address the browser sees (Ingress included)
		const origin = request.headers.get('origin') || url.origin;
		let link: string;
		try {
			link = await startConnection({ id, name }, `${origin}${locals.base}/settings/bank`, locals.user!.id);
		} catch (e) {
			return fail(502, { error: (e as Error).message });
		}
		await audit(locals.user, 'bank.connected', name, getClientAddress());
		throw redirect(303, link);
	},
	setAccount: async ({ request, locals }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		const tag = data.get('tag')?.toString() || '';
		const tags = await getSetting<string[]>('account_tags', []);
		if (!id || !tags.includes(tag)) return fail(400, { error: 'Scegli un conto definito in Categorie → Conti' });
		await db.update(bankConnections).set({ accountTag: tag }).where(eq(bankConnections.id, id));
		return { saved: true };
	},
	sync: async ({ request, locals }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		try {
			const r = await syncConnection(id, true);
			return { synced: `${r.added} nuovi movimenti (${r.skipped} già presenti)` };
		} catch (e) {
			return fail(502, { error: (e as Error).message });
		}
	},
	disconnect: async ({ request, locals, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const id = parseInt((await request.formData()).get('id')?.toString() || '0');
		await disconnect(id);
		await audit(locals.user, 'bank.disconnected', `#${id}`, getClientAddress());
		return { saved: true };
	}
};
