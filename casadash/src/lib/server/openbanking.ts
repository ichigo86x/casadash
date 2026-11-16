import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bankConnections, transactions } from '$lib/server/db/schema';
import { getSetting, setSetting } from '$lib/server/settings';
import { decryptSecret, encryptSecret } from '$lib/server/secrets';
import { loadActiveRules } from '$lib/server/rules';
import { matchRule, ruleTags } from '$lib/rules';
import { TRANSFER_TAG } from '$lib/transfers';
import { descriptionKey } from '$lib/import';
import { mapBankTransaction, syncFrom, type BankTransaction } from '$lib/openbanking';

// Open Banking through GoCardless Bank Account Data (the former Nordigen), read-only access to balances
// and movements. The family registers its own API keys: CasaDash never sees bank passwords, and the
// keys are stored encrypted. GoCardless allows only a few reads per account per day, hence the long intervals.
// Note: GoCardless stopped accepting new sign-ups in 2025; keys created before that keep working.

const API = 'https://bankaccountdata.gocardless.com/api/v2';
const AUTO_SYNC_EVERY = 8 * 60 * 60 * 1000;
const MANUAL_SYNC_EVERY = 20 * 60 * 1000;

type Creds = { secretId: string; secretKey: string };

export async function getCredentials(): Promise<Creds | null> {
	const raw = await getSetting<{ secretId: string; secretKey: string } | null>('openbanking', null);
	if (!raw) return null;
	try {
		return { secretId: decryptSecret(raw.secretId), secretKey: decryptSecret(raw.secretKey) };
	} catch {
		return null;
	}
}

export async function saveCredentials(secretId: string, secretKey: string) {
	await setSetting('openbanking', { secretId: encryptSecret(secretId), secretKey: encryptSecret(secretKey) });
	token = null;
}

export async function clearCredentials() {
	await setSetting('openbanking', null);
	token = null;
}

let token: { value: string; until: number } | null = null;

async function accessToken(): Promise<string> {
	if (token && token.until > Date.now() + 60_000) return token.value;
	const creds = await getCredentials();
	if (!creds) throw new Error('Chiavi API non configurate');
	const res = await fetch(`${API}/token/new/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ secret_id: creds.secretId, secret_key: creds.secretKey }),
		signal: AbortSignal.timeout(15000)
	});
	if (!res.ok) throw new Error(`Autenticazione rifiutata (HTTP ${res.status}): controlla le chiavi API`);
	const body = (await res.json()) as { access: string; access_expires: number };
	token = { value: body.access, until: Date.now() + body.access_expires * 1000 };
	return token.value;
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		method: init.method || 'GET',
		headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
		body: init.body ? JSON.stringify(init.body) : undefined,
		signal: AbortSignal.timeout(30000)
	});
	if (res.status === 429) throw new Error('La banca ha limitato le richieste di oggi: riprova più tardi');
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Errore della banca (HTTP ${res.status}) ${detail.slice(0, 120)}`);
	}
	return (res.status === 204 ? ({} as T) : ((await res.json()) as T));
}

export type Institution = { id: string; name: string; logo?: string };

export async function searchInstitutions(country: string, query: string): Promise<Institution[]> {
	const list = await api<Institution[]>(`/institutions/?country=${encodeURIComponent(country.toLowerCase())}`);
	const q = query.trim().toLowerCase();
	return list.filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 40);
}

/** Starts the bank consent: returns the page the user must visit to authorise read access. */
export async function startConnection(institution: Institution, redirectBase: string, userId: number): Promise<string> {
	const reference = crypto.randomUUID();
	const req = await api<{ id: string; link: string }>('/requisitions/', {
		method: 'POST',
		body: { redirect: `${redirectBase}?ref=${reference}`, institution_id: institution.id, reference, user_language: 'IT' }
	});
	await db.insert(bankConnections).values({
		provider: 'gocardless',
		institutionId: institution.id,
		institutionName: institution.name.slice(0, 80),
		requisitionId: req.id,
		status: 'pending',
		createdBy: userId
	});
	return req.link;
}

/** After the user returns from the bank: reads the authorised accounts and stores them. */
export async function completeConnection(requisitionId: string): Promise<number> {
	const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.requisitionId, requisitionId)).limit(1);
	if (!conn) throw new Error('Collegamento non trovato');
	const req = await api<{ status: string; accounts: string[] }>(`/requisitions/${requisitionId}/`);
	if (req.status !== 'LN' || !req.accounts?.length) {
		await db.update(bankConnections).set({ status: req.status === 'LN' ? 'linked' : 'failed', lastError: `Stato banca: ${req.status}` }).where(eq(bankConnections.id, conn.id));
		throw new Error('Autorizzazione non completata');
	}
	const [first, ...others] = req.accounts;
	await db.update(bankConnections).set({ accountId: first, status: 'linked', lastError: null }).where(eq(bankConnections.id, conn.id));
	for (const accountId of others) {
		await db.insert(bankConnections).values({
			provider: conn.provider, institutionId: conn.institutionId, institutionName: conn.institutionName,
			requisitionId, accountId, status: 'linked', createdBy: conn.createdBy
		});
	}
	return req.accounts.length;
}

export async function disconnect(id: number) {
	const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.id, id)).limit(1);
	if (!conn) return;
	const siblings = await db.select({ id: bankConnections.id }).from(bankConnections).where(eq(bankConnections.requisitionId, conn.requisitionId));
	// The consent is revoked at the bank only when no other account of the same consent is left
	if (siblings.length <= 1) {
		try { await api(`/requisitions/${conn.requisitionId}/`, { method: 'DELETE' }); } catch (e) { console.warn('[BANCA] Revoca non riuscita:', (e as Error).message); }
	}
	await db.delete(bankConnections).where(eq(bankConnections.id, id));
}

/**
 * Downloads the booked transactions of a connection and stores the new ones.
 * Movements already present (same bank id, or the same day, amount and description from a CSV import) are skipped.
 */
export async function syncConnection(id: number, manual = false): Promise<{ added: number; skipped: number }> {
	const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.id, id)).limit(1);
	if (!conn || !conn.accountId) throw new Error('Conto non collegato');
	if (!conn.accountTag) throw new Error('Scegli prima a quale conto di CasaDash corrisponde');
	if (manual && conn.lastSync && Date.now() - new Date(conn.lastSync).getTime() < MANUAL_SYNC_EVERY) {
		throw new Error('Sincronizzato da poco: la banca consente poche letture al giorno');
	}

	try {
		const body = await api<{ transactions: { booked: BankTransaction[] } }>(`/accounts/${conn.accountId}/transactions/?date_from=${syncFrom(conn.lastSync)}`);
		const mapped = (body.transactions?.booked || []).map(mapBankTransaction).filter((m): m is NonNullable<typeof m> => !!m);

		const rules = await loadActiveRules();
		const existing = await db.select({ externalId: transactions.externalId, date: transactions.date, amount: transactions.amount, type: transactions.type, description: transactions.description })
			.from(transactions).where(eq(transactions.paymentMethod, 'bancomat'));
		const knownIds = new Set(existing.map((e) => e.externalId).filter(Boolean));
		const knownSig = new Set(existing.map((e) => `${e.date}|${e.type}|${e.amount}|${descriptionKey(e.description)}`));
		const batch = `bank-${Date.now().toString(36)}`;

		const values: (typeof transactions.$inferInsert)[] = [];
		let skipped = 0;
		for (const m of mapped) {
			const type = m.amount < 0 ? 'expense' : 'income';
			const amount = Math.abs(m.amount);
			if (knownIds.has(m.externalId) || knownSig.has(`${m.date}|${type}|${amount}|${descriptionKey(m.description)}`)) { skipped++; continue; }
			const rule = matchRule(rules, m.description, type);
			const tags = [conn.accountTag, 'Banca', ...(rule ? ruleTags(rule) : [])];
			if (rule?.markTransfer) tags.push(TRANSFER_TAG);
			values.push({
				type, description: m.description, amount, date: m.date,
				category: rule?.category || 'Altro', paymentMethod: 'bancomat',
				tags: JSON.stringify([...new Set(tags)]), settled: 1,
				importBatch: batch, externalId: m.externalId, createdBy: conn.createdBy
			});
		}
		db.transaction((tx) => {
			for (let i = 0; i < values.length; i += 200) tx.insert(transactions).values(values.slice(i, i + 200)).run();
		});
		await db.update(bankConnections).set({ lastSync: new Date().toISOString(), lastError: null, status: 'linked' }).where(eq(bankConnections.id, id));
		return { added: values.length, skipped };
	} catch (e) {
		const message = (e as Error).message;
		// 401/403 from the bank API usually means the 90-day consent expired
		const expired = /HTTP (401|403)/.test(message);
		await db.update(bankConnections).set({ lastError: message.slice(0, 200), status: expired ? 'expired' : conn.status }).where(eq(bankConnections.id, id));
		throw e;
	}
}

/** Hourly job: refreshes every linked account that has not been read in the last 8 hours. */
export async function syncAllBankConnections() {
	if (!(await getCredentials())) return;
	const linked = await db.select().from(bankConnections).where(and(eq(bankConnections.status, 'linked')));
	for (const c of linked) {
		if (!c.accountId || !c.accountTag) continue;
		if (c.lastSync && Date.now() - new Date(c.lastSync).getTime() < AUTO_SYNC_EVERY) continue;
		try {
			const r = await syncConnection(c.id);
			if (r.added) console.log(`[BANCA] ${c.institutionName}: ${r.added} nuovi movimenti`);
		} catch (e) {
			console.error(`[BANCA] ${c.institutionName}:`, (e as Error).message);
		}
	}
}
