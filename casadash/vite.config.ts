import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { port: 8081, host: '0.0.0.0' },
	test: {
		include: ['tests/**/*.test.ts'],
		alias: {
			'$env/dynamic/private': path.resolve('tests/stubs/env.ts')
		}
	}
});
