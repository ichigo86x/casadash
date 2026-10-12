import { fail } from '@sveltejs/kit';

/** Returns a 403 action failure unless the current user is an administrator, otherwise null. */
export function requireAdmin(locals: App.Locals) {
	if (!locals.user) return fail(401, { error: 'Non autorizzato' });
	if (locals.user.role !== 'admin') return fail(403, { error: 'Operazione riservata agli amministratori' });
	return null;
}
