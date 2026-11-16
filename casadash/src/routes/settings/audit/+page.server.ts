import { recentAudit } from '$lib/server/audit';
import type { PageServerLoad } from './$types';

// Administrators only: enforced by the guard in hooks.server.ts
export const load: PageServerLoad = async () => ({ entries: await recentAudit(300) });
