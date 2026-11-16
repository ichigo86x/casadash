import { env } from '$env/dynamic/private';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origins allowed in addition to the request's own host, e.g. a public URL behind a proxy that rewrites Host. */
function trustedOrigins(): string[] {
	return (env.TRUSTED_ORIGINS || '')
		.split(',')
		.map((o) => o.trim().replace(/\/$/, '').toLowerCase())
		.filter(Boolean);
}

/**
 * Cross-site request forgery check for state-changing requests.
 *
 * SameSite=Lax is not enough: cookies ignore the port, so another web app on the same host
 * (another add-on, another container) counts as "same site". Browsers tell the truth in
 * `Sec-Fetch-Site`, which a web page cannot forge:
 *   - same-origin / none  -> our own pages (or the user typing the URL): allowed
 *   - same-site / cross-site -> refused, unless the Origin is listed in TRUSTED_ORIGINS
 * Without that header (old browsers, scripts) the Origin host must match the Host, or the request
 * must carry no Origin at all (not a browser form post: no ambient cookies to abuse).
 */
export function isRequestAllowed(method: string, headers: Headers, requestHost: string): boolean {
	if (SAFE_METHODS.has(method.toUpperCase())) return true;

	const origin = headers.get('origin')?.replace(/\/$/, '').toLowerCase() || null;
	if (origin && trustedOrigins().includes(origin)) return true;

	const fetchSite = headers.get('sec-fetch-site');
	if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';

	if (!origin) return true;
	if (origin === 'null') return false;
	let originHost: string;
	try {
		originHost = new URL(origin).host;
	} catch {
		return false;
	}
	const hosts = [headers.get('host'), headers.get('x-forwarded-host')?.split(',')[0].trim(), requestHost]
		.filter(Boolean)
		.map((h) => h!.toLowerCase());
	return hosts.includes(originHost);
}
