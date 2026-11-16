// Stand-in for SvelteKit's `$env/dynamic/private` in unit tests.
export const env = process.env as Record<string, string | undefined>;
