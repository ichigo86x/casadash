import { env } from '$env/dynamic/private';

// Home Assistant Ingress proxies /api/hassio_ingress/<token>/<path> to this app as /<path>
// and tells us the browser-visible prefix in the X-Ingress-Path header.
const INGRESS_PATH = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/;

export function ingressBase(headers: Headers): string {
	const value = headers.get('x-ingress-path');
	return value && INGRESS_PATH.test(value) ? value : '';
}

/** Browser-visible URL for an app path, for server-side redirects. */
export function appUrl(locals: App.Locals, path: string): string {
	return `${locals.base}${path}`;
}

// Address of the Supervisor's Ingress proxy inside the add-on network
const SUPERVISOR_IP = '172.30.32.2';

export type HaUser = { id: string; name: string; displayName: string };

/**
 * The Home Assistant user behind an Ingress request (X-Remote-User-* headers).
 * Trusted only in the add-on (SUPERVISOR_TOKEN present), on a valid Ingress path and when the
 * request really comes from the Supervisor proxy: in any other setup the headers could be forged.
 */
export function ingressHaUser(headers: Headers, base: string, clientAddress: string): HaUser | null {
	if (!env.SUPERVISOR_TOKEN || !base) return null;
	if (clientAddress.replace(/^::ffff:/, '') !== SUPERVISOR_IP) return null;
	const id = headers.get('x-remote-user-id');
	if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
	return {
		id,
		name: headers.get('x-remote-user-name') || '',
		displayName: headers.get('x-remote-user-display-name') || headers.get('x-remote-user-name') || ''
	};
}
