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
		csrf: {
			checkOrigin: false
		}
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
