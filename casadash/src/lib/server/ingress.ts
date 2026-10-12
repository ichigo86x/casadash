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
