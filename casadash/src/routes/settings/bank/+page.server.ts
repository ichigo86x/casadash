import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bankConnections } from '$lib/server/db/schema';
import { getSetting } from '$lib/server/settings';
import { requireAdmin } from '$lib/server/roles';
import { audit } from '$lib/server/audit';
import {
	ENABLE_BANKING_REDIRECT, clearCredentials, completeConnection, configuredProviders, disconnect, finishEnableBanking,
	saveEnableBankingCredentials, saveGoCardlessCredentials, searchInstitutions, startConnection, syncConnection, type Provider
} from '$lib/server/openbanking';
import type { Actions, PageServerLoad } from './$types';

const asProvider = (v: unknown): Provider => (v === 'gocardless' ? 'gocardless' : 'enablebanking');

// Administrators only: enforced by the guard in hooks.server.ts
export const load: PageServerLoad = async ({ url }) => {
	const providers = await configuredProviders();
	let message = '';
	let error = '';

	// GoCardless sends the user back here with ?ref=...: finish linking the accounts
	const ref = url.searchParams.get('ref');
	if (ref && providers.gocardless) {
		const pending = (await db.select().from(bankConnections)).find((c) => c.status === 'pending' && c.provider === 'gocardless');
		try {
			if (pending) message = `Banca collegata: ${await completeConnection(pending.requisitionId)} conto/i trovato/i. Scegli ora a quale conto di CasaDash corrispondono.`;
		} catch (e) {
			error = (e as Error).message;
		}
	}

	const provider = url.searchParams.has('provider') ? asProvider(url.searchParams.get('provider')) : providers.enablebanking ? 'enablebanking' : 'gocardless';
	let institutions: { id: string; name: string; country?: string }[] = [];
	const q = url.searchParams.get('q');
	if (providers[provider] && q !== null) {
		try {
			institutions = await searchInstitutions(provider, url.searchParams.get('country') || 'IT', q);
		} catch (e) {
			error = (e as Error).message;
		}
	}

	return {
		providers,
		provider,
		redirectUrl: ENABLE_BANKING_REDIRECT,
		message,
		error,
		q: q ?? '',
		institutions,
		connections: await db.select().from(bankConnections),
		accountTags: await getSetting<string[]>('account_tags', [])
	};
};

export const actions: Actions = {
	saveGoCardless: async ({ request, locals, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const secretId = data.get('secret_id')?.toString().trim() || '';
		const secretKey = data.get('secret_key')?.toString().trim() || '';
		if (!secretId || !secretKey) return fail(400, { error: 'Inserisci entrambe le chiavi' });
		await saveGoCardlessCredentials(secretId, secretKey);
		await audit(locals.user, 'bank.credentials_saved', 'GoCardless', getClientAddress());
		return { saved: true };
	},
	saveEnableBanking: async ({ request, locals, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const appId = data.get('app_id')?.toString().trim() || '';
		const privateKey = data.get('private_key')?.toString() || '';
		if (!appId || !privateKey.trim()) return fail(400, { error: 'Inserisci identificativo e chiave privata' });
		try {
			await saveEnableBankingCredentials(appId, privateKey);
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
		await audit(locals.user, 'bank.credentials_saved', 'Enable Banking', getClientAddress());
		return { saved: true };
	},
	removeCredentials: async ({ request, locals, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const provider = asProvider((await request.formData()).get('provider'));
		await clearCredentials(provider);
		await audit(locals.user, 'bank.credentials_removed', provider, getClientAddress());
		return { saved: true };
	},
	connect: async ({ request, locals, url, getClientAddress }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const provider = asProvider(data.get('provider'));
		const id = data.get('institution_id')?.toString() || '';
		const name = data.get('institution_name')?.toString() || '';
		const country = data.get('country')?.toString() || 'IT';
		if (!id) return fail(400, { error: 'Scegli una banca' });
		// GoCardless sends the browser back to this page: use the address the browser sees (Ingress included)
		const origin = request.headers.get('origin') || url.origin;
		let link: string;
		try {
			link = await startConnection(provider, { id, name, country }, `${origin}${locals.base}/settings/bank`, locals.user!.id);
		} catch (e) {
			return fail(502, { error: (e as Error).message });
		}
		await audit(locals.user, 'bank.connected', `${name} (${provider})`, getClientAddress());
		throw redirect(303, link);
	},
	// Enable Banking: the user pastes the address of the page the bank sent them to
	finishEnableBanking: async ({ request, locals }) => {
		const denied = requireAdmin(locals);
		if (denied) return denied;
		const data = await request.formData();
		const id = parseInt(data.get('id')?.toString() || '0');
		try {
			const n = await finishEnableBanking(id, data.get('pasted')?.toString() || '');
			return { synced: `Banca collegata: ${n} conto/i. Scegli ora a quale conto di CasaDash corrispondono.` };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
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
			return { synced: `${r.added} nuovi movimenti, ${r.skipped} già presenti${r.conflicts ? `, ${r.conflicts} da verificare in «Possibili doppioni»` : ''}` };
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
