import { error } from '@sveltejs/kit';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { client } from '$lib/server/db';
import { DATABASE_PATH, UPLOADS_DIR } from '$lib/server/config';

export const GET = async ({ locals }) => {
    if (!locals.user) {
        throw error(401, 'Non autorizzato');
    }

    // Consistent snapshot through the SQLite online backup API, even while the app is writing
    const snapshot = path.join(os.tmpdir(), `casadash-backup-${Date.now()}.db`);
    try {
        await client.backup(snapshot);

        const zip = new AdmZip();
        // Archive layout (unchanged since v1): database/<file>.db + uploads/receipts/...
        zip.addLocalFile(snapshot, 'database', path.basename(DATABASE_PATH));
        if (fs.existsSync(UPLOADS_DIR)) {
            zip.addLocalFolder(UPLOADS_DIR, 'uploads');
        }

        const buffer = zip.toBuffer();
        const dateStr = new Date().toISOString().split('T')[0];

        return new Response(new Uint8Array(buffer), {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="CasaDash_Backup_${dateStr}.zip"`
            }
        });
    } catch (e: any) {
        console.error('[BACKUP] Errore generazione backup:', e);
        throw error(500, 'Errore generazione backup: ' + e.message);
    } finally {
        fs.rmSync(snapshot, { force: true });
    }
};
