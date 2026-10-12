import crypto from 'crypto';
import { env } from '$env/dynamic/private';
import { accountBalances, creditCardUnsettled, monthOverview } from '$lib/server/stats';
import { upcomingRecurring } from '$lib/server/wealth';
import { getSetting, setSetting } from '$lib/server/settings';
import { localDateString } from '$lib/dates';

type Sensor = {
	id: string; // entity id suffix: sensor.casadash_<id>
	name: string;
	state: number | string;
	unit?: string;
	icon: string;
	attributes?: Record<string, unknown>;
};

const round = (n: number) => Math.round(n * 100) / 100;

/** "Libretto Postale" -> "libretto_postale" (Home Assistant entity id rules) */
function slug(text: string) {
	return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'conto';
}

export async function sensorValues(): Promise<Sensor[]> {
	const month = await monthOverview();
	const accountTags = await getSetting<string[]>('account_tags', []);
	const accounts = await accountBalances(accountTags);
	const cc = await creditCardUnsettled();
	const now = new Date();
	const weekEnd = localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
	const nextWeek = (await upcomingRecurring(accountTags, 7)).filter((u) => u.date <= weekEnd);
	const budgetPct = month.budget.monthly > 0 ? round((month.expense / month.budget.monthly) * 100) : null;

	const sensors: Sensor[] = [
		{ id: 'spese_mese', name: 'CasaDash spese del mese', state: round(month.expense), unit: 'EUR', icon: 'mdi:cart-outline',
			attributes: { budget_mensile: month.budget.monthly, giorno: month.forecast.dayOfMonth, giorni_nel_mese: month.forecast.daysInMonth } },
		{ id: 'entrate_mese', name: 'CasaDash entrate del mese', state: round(month.income), unit: 'EUR', icon: 'mdi:cash-plus' },
		{ id: 'previsione_fine_mese', name: 'CasaDash previsione fine mese', state: round(month.forecast.expense), unit: 'EUR', icon: 'mdi:chart-timeline-variant',
			attributes: { budget_mensile: month.budget.monthly, ricorrenti_da_addebitare: round(month.forecast.pendingRecurring), sforamento_previsto: month.budget.monthly > 0 && month.forecast.expense > month.budget.monthly } },
		{ id: 'budget_mese', name: 'CasaDash budget mensile usato', state: budgetPct ?? 'unknown', unit: '%', icon: 'mdi:gauge',
			attributes: { categorie_oltre_80: month.budget.warnings.map((w) => ({ categoria: w.category, speso: round(w.spent), limite: w.limit, percentuale: round(w.pct) })) } },
		{ id: 'carta_da_saldare', name: 'CasaDash carta di credito da saldare', state: round(cc.total), unit: 'EUR', icon: 'mdi:credit-card-clock-outline',
			attributes: { movimenti: cc.count } },
		{ id: 'scadenze_7_giorni', name: 'CasaDash ricorrenti prossimi 7 giorni', state: round(nextWeek.filter((u) => u.type === 'expense').reduce((a, u) => a + u.amount, 0)), unit: 'EUR', icon: 'mdi:calendar-clock',
			attributes: { elenco: nextWeek.map((u) => ({ data: u.date, descrizione: u.description, importo: u.type === 'expense' ? -u.amount : u.amount })) } },
		...accounts.map((a) => ({ id: `saldo_${slug(a.tag)}`, name: `CasaDash saldo ${a.tag}`, state: round(a.balance), unit: 'EUR', icon: 'mdi:bank', attributes: { conto: a.tag } }))
	];
	if (accounts.length > 1) {
		sensors.push({ id: 'saldo_totale', name: 'CasaDash saldo totale conti', state: round(accounts.reduce((s, a) => s + a.balance, 0)), unit: 'EUR', icon: 'mdi:bank-outline' });
	}
	return sensors;
}

/** Flat JSON for the REST endpoint (Home Assistant `rest` integration, Docker and bare-metal installs). */
export async function sensorJson() {
	const sensors = await sensorValues();
	return {
		aggiornato: new Date().toISOString(),
		...Object.fromEntries(sensors.map((s) => [s.id, s.state])),
		dettagli: Object.fromEntries(sensors.map((s) => [s.id, { nome: s.name, unita: s.unit, ...s.attributes }]))
	};
}

let lastPushError = '';

/**
 * Add-on only: writes the sensors into Home Assistant through the Supervisor proxy
 * (needs `homeassistant_api: true` in config.yaml). States set this way are not kept by
 * Home Assistant across its own restarts, so they are pushed again periodically.
 */
export async function pushSensorsToHomeAssistant() {
	const token = env.SUPERVISOR_TOKEN;
	if (!token) return;
	try {
		for (const s of await sensorValues()) {
			const res = await fetch(`http://supervisor/core/api/states/sensor.casadash_${s.id}`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					state: s.state,
					attributes: {
						friendly_name: s.name,
						icon: s.icon,
						...(s.unit ? { unit_of_measurement: s.unit } : {}),
						...(s.unit === 'EUR' ? { device_class: 'monetary' } : {}),
						...s.attributes
					}
				})
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} su sensor.casadash_${s.id}`);
		}
		if (lastPushError) console.log('[SENSORI] Invio a Home Assistant ripristinato');
		lastPushError = '';
	} catch (e) {
		const msg = (e as Error).message;
		// Log once per distinct error, not every 10 minutes
		if (msg !== lastPushError) console.error('[SENSORI] Invio a Home Assistant non riuscito:', msg);
		lastPushError = msg;
	}
}

// --- REST endpoint token (only its SHA-256 is stored) ---

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function createSensorToken(): Promise<string> {
	const token = crypto.randomBytes(24).toString('base64url');
	await setSetting('sensor_token_hash', hash(token));
	return token;
}

export async function revokeSensorToken() {
	await setSetting('sensor_token_hash', null);
}

export async function hasSensorToken() {
	return !!(await getSetting<string | null>('sensor_token_hash', null));
}

export async function checkSensorToken(token: string | null): Promise<boolean> {
	const stored = await getSetting<string | null>('sensor_token_hash', null);
	if (!stored || !token) return false;
	const a = Buffer.from(hash(token));
	const b = Buffer.from(stored);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}
