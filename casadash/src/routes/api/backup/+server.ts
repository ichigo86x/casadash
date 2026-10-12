import { error } from '@sveltejs/kit';
import { localDateString } from '$lib/dates';
import { buildBackupZip } from '$lib/server/backup';

// Admin-only: enforced by the guard in hooks.server.ts
export const GET = async () => {
    try {
        const buffer = await buildBackupZip();
        return new Response(new Uint8Array(buffer), {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="CasaDash_Backup_${localDateString()}.zip"`
            }
        });
    } catch (e: any) {
        console.error('[BACKUP] Errore generazione backup:', e);
        throw error(500, 'Errore generazione backup: ' + e.message);
    }
};
