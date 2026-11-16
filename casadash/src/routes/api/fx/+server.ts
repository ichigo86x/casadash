import { error, json } from '@sveltejs/kit';
import { isValidDate } from '$lib/validate';
import { localDateString } from '$lib/dates';

// Euro foreign-exchange rate for the movement form: 1 EUR = <rate> <currency> (ECB reference rates, via frankfurter.dev).
// Needs a signed-in user (hooks.server.ts) and is the only call CasaDash makes to the Internet on its own
// initiative of the user; the figures can always be typed by hand instead.
const cache = new Map<string, { rate: number; date: string; at: number }>();

export const GET = async ({ url }) => {
	const currency = (url.searchParams.get('currency') || '').toUpperCase();
	let date = url.searchParams.get('date') || localDateString();
	if (!/^[A-Z]{3}$/.test(currency) || currency === 'EUR') throw error(400, 'Valuta non valida');
	if (!isValidDate(date)) throw error(400, 'Data non valida');
	if (date > localDateString()) date = localDateString();

	const key = `${currency}|${date}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return json({ currency, rate: hit.rate, date: hit.date });

	try {
		const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=EUR&symbols=${currency}`, { signal: AbortSignal.timeout(6000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = (await res.json()) as { date: string; rates: Record<string, number> };
		const rate = body.rates?.[currency];
		if (!rate || !Number.isFinite(rate)) throw new Error('valuta sconosciuta');
		cache.set(key, { rate, date: body.date, at: Date.now() });
		return json({ currency, rate, date: body.date });
	} catch (e) {
		throw error(502, `Cambio non disponibile (${(e as Error).message}): inseriscilo a mano`);
	}
};
