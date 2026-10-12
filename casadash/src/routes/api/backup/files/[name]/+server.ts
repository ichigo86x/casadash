import fs from 'fs';
import { error } from '@sveltejs/kit';
import { backupFilePath } from '$lib/server/backup';

// Download of a stored (automatic) backup. Admin-only: enforced by the guard in hooks.server.ts
export const GET = async ({ params }) => {
    const file = backupFilePath(params.name);
    if (!file) throw error(404, 'Backup non trovato');
    return new Response(new Uint8Array(fs.readFileSync(file)), {
        headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${params.name}"`
        }
    });
};
