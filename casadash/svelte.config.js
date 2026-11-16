import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		// Relative asset/base paths let the same build run at "/" and behind the
		// Home Assistant Ingress prefix (/api/hassio_ingress/<token>/).
		// App links must therefore use `base` from $app/paths.
		paths: {
			relative: true
		},
		// Ingress and reverse proxies change Host/Origin; CSRF is mitigated by SameSite=Lax session cookies
		// (hooks.server.ts runs its own, Sec-Fetch-Site based check: see lib/server/csrf.ts)
		csrf: {
			checkOrigin: false
		},
		// Content-Security-Policy: scripts only from this app (SvelteKit adds hashes for its inline bootstrap).
		// Fonts and icons still come from Google Fonts and cdnjs; frame-ancestors is added in hooks.server.ts.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
				'img-src': ['self', 'data:', 'blob:'],
				'connect-src': ['self'],
				'worker-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
