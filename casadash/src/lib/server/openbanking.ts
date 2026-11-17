import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bankConnections, transactions } from '$lib/server/db/schema';
import { getSetting, setSetting } from '$lib/server/settings';
import { decryptSecret, encryptSecret } from '$lib/server/secrets';
import { loadActiveRules } from '$lib/server/rules';
import { matchRule, ruleTags } from '$lib/rules';
import { TRANSFER_TAG } from '$lib/transfers';
import { descriptionKey } from '$lib/import';
import {
	extractAuthCode, mapBankTransaction, mapEnableBankingTransaction, sessionAccounts, syncFrom,
	type BankTransaction, type EnableBankingTransaction, type MappedMovement
} from '$lib/openbanking';

// Open Banking (PSD2), read-only access to the movements of the family's own accounts. Two providers:
//  - Enable Banking: free for personal use when you link your own accounts (recommended);
//  - GoCardless Bank Account Data (the former Nordigen): closed to new sign-ups since 2025, keys created
//    before keep working.
// The family registers its own API keys: CasaDash never sees bank passwords, and the keys are stored
// encrypted. Banks allow only a few unattended reads per account per day, hence the long intervals.

export type Provider = 'gocardless' | 'enablebanking';

const AUTO_SYNC_EVERY = 8 * 60 * 60 * 1000; // 3 reads a day, under the PSD2 limit of 4
const MANUAL_SYNC_EVERY = 20 * 60 * 1000;
/** Enable Banking redirects the browser here after the bank consent; the user pastes the code back into CasaDash. */
export const ENABLE_BANKING_REDIRECT = 'https://enablebanking.com/';

export type Institution = { id: string; name: string; country?: string };

// ---------------------------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------------------------

type GoCardlessCreds = { secretId: string; secretKey: string };
type EnableBankingCreds = { appId: string; privateKey: string };

async function readCreds<T extends Record<string, string>>(key: string): Promise<T | null> {
	const raw = await getSetting<Record<string, string> | null>(key, null);
	if (!raw) return null;
	try {
		return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, decryptSecret(v)])) as T;
	} catch {
		return null;
	}
}
const writeCreds = (key: string, values: Record<string, string>) =>
	setSetting(key, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, encryptSecret(v)])));

export async function configuredProviders(): Promise<Record<Provider, boolean>> {
	return {
		gocardless: !!(await readCreds<GoCardlessCreds>('openbanking')),
		enablebanking: !!(await readCreds<EnableBankingCreds>('enablebanking'))
	};
}

export async function hasAnyCredentials() {
	const p = await configuredProviders();
	return p.gocardless || p.enablebanking;
}

export async function saveGoCardlessCredentials(secretId: string, secretKey: string) {
	await writeCreds('openbanking', { secretId, secretKey });
	gcToken = null;
}

/** The private key is checked here, so a wrong paste is reported now and not at the first sync. */
export async function saveEnableBankingCredentials(appId: string, privateKey: string) {
	const pem = normalizePem(privateKey);
	if (!/^[0-9a-f-]{20,}$/i.test(appId)) throw new Error("L'identificativo dell'applicazione non sembra valido (è un UUID)");
	try {
		crypto.createPrivateKey(pem);
	} catch {
		throw new Error('La chiave privata non è valida: incolla tutto il contenuto del file .pem');
	}
	await writeCreds('enablebanking', { appId, privateKey: pem });
}

export async function clearCredentials(provider: Provider) {
	await setSetting(provider === 'gocardless' ? 'openbanking' : 'enablebanking', null);
	if (provider === 'gocardless') gcToken = null;
}

/** A pasted PEM often loses its line breaks: rebuild them. */
function normalizePem(input: string): string {
	const text = input.trim().replace(/\\n/g, '\n');
	const m = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
	if (!m) return text;
	const body = m[2].replace(/\s+/g, '');
	return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END ${m[1]}-----\n`;
}

// ---------------------------------------------------------------------------------------------
// GoCardless Bank Account Data
// ---------------------------------------------------------------------------------------------

const GC_API = 'https://bankaccountdata.gocardless.com/api/v2';
let gcToken: { value: string; until: number } | null = null;

async function gcAccessToken(): Promise<string> {
	if (gcToken && gcToken.until > Date.now() + 60_000) return gcToken.value;
	const creds = await readCreds<GoCardlessCreds>('openbanking');
	if (!creds) throw new Error('Chiavi GoCardless non configurate');
	const res = await fetch(`${GC_API}/token/new/`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ secret_id: creds.secretId, secret_key: creds.secretKey }),
		signal: AbortSignal.timeout(15000)
	});
	if (!res.ok) throw new Error(`Autenticazione rifiutata (HTTP ${res.status}): controlla le chiavi API`);
	const body = (await res.json()) as { access: string; access_expires: number };
	gcToken = { value: body.access, until: Date.now() + body.access_expires * 1000 };
	return gcToken.value;
}

async function request<T>(url: string, init: { method?: string; body?: unknown; token: string }): Promise<T> {
	const res = await fetch(url, {
		method: init.method || 'GET',
		headers: { Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
		body: init.body ? JSON.stringify(init.body) : undefined,
		signal: AbortSignal.timeout(30000)
	});
	if (res.status === 429) throw new Error('La banca ha limitato le richieste di oggi: riprova più tardi');
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`Errore della banca (HTTP ${res.status}) ${detail.slice(0, 160)}`);
	}
	return res.status === 204 ? ({} as T) : ((await res.json()) as T);
}

const gc = async <T>(path: string, init: { method?: string; body?: unknown } = {}) =>
	request<T>(`${GC_API}${path}`, { ...init, token: await gcAccessToken() });

// ---------------------------------------------------------------------------------------------
// Enable Banking
// ---------------------------------------------------------------------------------------------

const EB_API = 'https://api.enablebanking.com';

/** Short-lived RS256 token signed with the application's private key (the API caps it at 24 h). */
function ebJwt(creds: EnableBankingCreds): string {
	const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const head = part({ typ: 'JWT', alg: 'RS256', kid: creds.appId });
	const body = part({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 });
	const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(creds.privateKey).toString('base64url');
	return `${head}.${body}.${sig}`;
}

async function eb<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
	const creds = await readCreds<EnableBankingCreds>('enablebanking');
	if (!creds) throw new Error('Chiavi Enable Banking non configurate');
	return request<T>(`${EB_API}${path}`, { ...init, token: ebJwt(creds) });
}

// ---------------------------------------------------------------------------------------------
// Linking a bank
// ---------------------------------------------------------------------------------------------

export async function searchInstitutions(provider: Provider, country: string, query: string): Promise<Institution[]> {
	const q = query.trim().toLowerCase();
	if (provider === 'gocardless') {
		const list = await gc<{ id: string; name: string }[]>(`/institutions/?country=${encodeURIComponent(country.toLowerCase())}`);
		return list.filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 40);
	}
	const res = await eb<{ aspsps?: { name: string; country: string; psu_types?: string[] }[] }>(`/aspsps?country=${encodeURIComponent(country.toUpperCase())}`);
	return (res.aspsps ?? [])
		.filter((a) => (!a.psu_types || a.psu_types.includes('personal')) && (!q || a.name.toLowerCase().includes(q)))
		.slice(0, 60)
		.map((a) => ({ id: a.name, name: a.name, country: a.country }));
}

/**
 * Starts the bank consent: returns the page the user must visit to authorise read access.
 * GoCardless sends the browser back to CasaDash; Enable Banking sends it to its own page, where
 * the user copies the code (see finishEnableBanking).
 */
export async function startConnection(provider: Provider, institution: Institution, redirectBase: string, userId: number): Promise<string> {
	if (provider === 'gocardless') {
		const reference = crypto.randomUUID();
		const req = await gc<{ id: string; link: string }>('/requisitions/', {
			method: 'POST',
			body: { redirect: `${redirectBase}?ref=${reference}`, institution_id: institution.id, reference, user_language: 'IT' }
		});
		await db.insert(bankConnections).values({
			provider, institutionId: institution.id, institutionName: institution.name.slice(0, 80),
			requisitionId: req.id, status: 'pending', createdBy: userId
		});
		return req.link;
	}

	const country = institution.country || 'IT';
	const state = crypto.randomBytes(16).toString('hex');
	// Banks may shorten this; 180 days is the maximum PSD2 allows
	const validUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
	const auth = await eb<{ url: string }>('/auth', {
		method: 'POST',
		body: { access: { valid_until: validUntil }, aspsp: { name: institution.name, country }, psu_type: 'personal', state, redirect_url: ENABLE_BANKING_REDIRECT }
	});
	await db.insert(bankConnections).values({
		provider, institutionId: `${country}|${institution.name}`, institutionName: institution.name.slice(0, 80),
		requisitionId: state, status: 'pending', createdBy: userId
	});
	return auth.url;
}

/** GoCardless: after the user returns from the bank, reads the authorised accounts and stores them. */
export async function completeConnection(requisitionId: string): Promise<number> {
	const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.requisitionId, requisitionId)).limit(1);
	if (!conn) throw new Error('Collegamento non trovato');
	const req = await gc<{ status: string; accounts: string[] }>(`/requisitions/${requisitionId}/`);
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

/** Enable Banking: exchanges the code the user pasted for a session and stores its accounts. */
export async function finishEnableBanking(connectionId: number, pasted: string): Promise<number> {
	const code = extractAuthCode(pasted);
	if (!code) throw new Error("Non trovo il codice: incolla l'indirizzo completo della pagina su cui sei arrivato");
	const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.id, connectionId)).limit(1);
	if (!conn || conn.provider !== 'enablebanking' || conn.status !== 'pending') throw new Error('Collegamento non in attesa');

	const session = await eb<{ session_id?: string; uid?: string; accounts?: unknown; accounts_data?: unknown }>('/sessions', { method: 'POST', body: { code } });
	const sessionId = session.session_id || session.uid;
	const accounts = sessionAccounts(session);
	if (!sessionId || accounts.length === 0) throw new Error('La banca non ha reso disponibile nessun conto: controlla le autorizzazioni date');

	const label = (a: { label: string }) => `${conn.institutionName}${a.label ? ` ${a.label}` : ''}`.slice(0, 80);
	const [first, ...others] = accounts;
	await db.update(bankConnections).set({ requisitionId: sessionId, accountId: first.uid, institutionName: label(first), status: 'linked', lastError: null }).where(eq(bankConnections.id, conn.id));
	for (const a of others) {
		await db.insert(bankConnections).values({
			provider: conn.provider, institutionId: conn.institutionId, institutionName: label(a),
			requisitionId: sessionId, accountId: a.uid, status: 'linked', createdBy: conn.createdBy
		});
	}
	return accounts.length;
}

export async function disconnect(id: number) {
	const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.id, id)).limit(1);
	if (!conn) return;
	const siblings = await db.select({ id: bankConnections.id }).from(bankConnections).where(eq(bankConnections.requisitionId, conn.requisitionId));
	// The consent is revoked at the bank only when no other account of the same consent is left
	if (siblings.length <= 1 && conn.status !== 'pending') {
		try {
			if (conn.provider === 'gocardless') await gc(`/requisitions/${conn.requisitionId}/`, { method: 'DELETE' });
			else await eb(`/sessions/${conn.requisitionId}`, { method: 'DELETE' });
		} catch (e) {
			console.warn('[BANCA] Revoca non riuscita:', (e as Error).message);
		}
	}
	await db.delete(bankConnections).where(eq(bankConnections.id, id));
}

// ---------------------------------------------------------------------------------------------
// Reading movements
// ---------------------------------------------------------------------------------------------

async function fetchMovements(conn: typeof bankConnections.$inferSelect): Promise<MappedMovement[]> {
	const from = syncFrom(conn.lastSync);
	if (conn.provider === 'gocardless') {
		const body = await gc<{ transactions: { booked: BankTransaction[] } }>(`/accounts/${conn.accountId}/transactions/?date_from=${from}`);
		return (body.transactions?.booked || []).map(mapBankTransaction).filter((m): m is MappedMovement => !!m);
	}

	const out: MappedMovement[] = [];
	let continuation: string | undefined;
	for (let page = 0; page < 20; page++) {
		const params = new URLSearchParams({ date_from: from, transaction_status: 'BOOK' });
		if (continuation) params.set('continuation_key', continuation);
		const res = await eb<{ transactions?: EnableBankingTransaction[]; continuation_key?: string | null }>(`/accounts/${conn.accountId}/transactions?${params}`);
		for (const t of res.transactions ?? []) {
			const m = mapEnableBankingTransaction(t);
			if (m) out.push(m);
		}
		continuation = res.continuation_key || undefined;
		if (!continuation) break;
	}
	return out;
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
		const mapped = await fetchMovements(conn);

		const rules = await loadActiveRules();
		const existing = await db.select({ externalId: transactions.externalId, date: transactions.date, amount: transactions.amount, type: transactions.type, description: transactions.description })
			.from(transactions);
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
		// 401/403 from the bank API usually means the consent expired
		const expired = /HTTP (401|403)/.test(message) || /EXPIRED_SESSION/.test(message);
		await db.update(bankConnections).set({ lastError: message.slice(0, 200), status: expired ? 'expired' : conn.status }).where(eq(bankConnections.id, id));
		throw e;
	}
}

/** Hourly job: refreshes every linked account that has not been read in the last 8 hours. */
export async function syncAllBankConnections() {
	if (!(await hasAnyCredentials())) return;
	const linked = (await db.select().from(bankConnections)).filter((c) => c.status === 'linked');
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
