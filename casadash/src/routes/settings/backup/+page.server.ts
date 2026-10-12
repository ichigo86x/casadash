import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { client } from '$lib/server/db';
import { BACKUP_DIR, DATABASE_PATH, RESTART_EXIT_CODE, UPLOADS_DIR } from '$lib/server/config';
import { DEFAULT_SCHEDULE, backupFilePath, listBackups, saveBackup, type BackupSchedule } from '$lib/server/backup';
import { getSetting, setSetting } from '$lib/server/settings';
import { requireAdmin } from '$lib/server/roles';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

/** Target path for an "uploads/..." archive entry, or null if it would escape UPLOADS_DIR. */
function uploadDestination(entryName: string): string | null {
    const relative = entryName.slice('uploads/'.length);
    const dest = path.resolve(UPLOADS_DIR, relative);
    return dest.startsWith(UPLOADS_DIR + path.sep) ? dest : null;
}

export const load: PageServerLoad = async () => {
    return {
        schedule: await getSetting<BackupSchedule>('backup_schedule', DEFAULT_SCHEDULE),
        lastBackup: await getSetting<string | null>('backup_last', null),
        backups: listBackups(),
        backupDir: BACKUP_DIR
    };
};

export const actions: Actions = {
    saveSchedule: async ({ request, locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const data = await request.formData();
        const keep = Math.min(100, Math.max(1, parseInt(data.get('keep')?.toString() || '8') || 8));
        await setSetting('backup_schedule', {
            enabled: data.get('enabled') === 'on',
            frequency: data.get('frequency') === 'daily' ? 'daily' : 'weekly',
            keep
        } satisfies BackupSchedule);
        return { scheduleSaved: true };
    },
    runNow: async ({ locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const schedule = await getSetting<BackupSchedule>('backup_schedule', DEFAULT_SCHEDULE);
        try {
            const name = await saveBackup(schedule.keep);
            return { backupCreated: name };
        } catch (e: any) {
            return fail(500, { error: 'Backup non riuscito: ' + e.message });
        }
    },
    deleteBackup: async ({ request, locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        const file = backupFilePath((await request.formData()).get('name')?.toString() || '');
        if (!file) return fail(404, { error: 'Backup non trovato' });
        fs.rmSync(file, { force: true });
        return { backupDeleted: true };
    },
    restore: async ({ request, locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;

        const data = await request.formData();
        const file = data.get('backup') as File | null;

        if (!file || file.size === 0 || !file.name.endsWith('.zip')) {
            return fail(400, { error: 'Seleziona un formaro ZIP valido generato da CasaDash.' });
        }

        let dbClosed = false;
        try {
            const zip = new AdmZip(Buffer.from(await file.arrayBuffer()));
            const zipEntries = zip.getEntries();

            // Validate the whole archive before touching anything on disk
            const dbEntry = zipEntries.find(e => !e.isDirectory && e.entryName.startsWith('database/'));
            const dbData = dbEntry?.getData();
            if (!dbData || !dbData.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
                return fail(400, { error: `L'archivio non contiene il database SQLite CasaDash.` });
            }

            const uploads: Array<{ dest: string; data: Buffer }> = [];
            for (const entry of zipEntries) {
                if (entry.isDirectory || !entry.entryName.startsWith('uploads/')) continue;
                const dest = uploadDestination(entry.entryName);
                if (!dest) {
                    return fail(400, { error: `Percorso non valido nell'archivio: ${entry.entryName}` });
                }
                uploads.push({ dest, data: entry.getData() });
            }

            // Close DB explicitly before overwriting, then swap the file in atomically
            client.close();
            dbClosed = true;
            const tmpDb = `${DATABASE_PATH}.restore`;
            fs.writeFileSync(tmpDb, dbData);
            fs.renameSync(tmpDb, DATABASE_PATH);

            for (const { dest, data } of uploads) {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest, data);
            }

            // The launcher (start.mjs) restarts the server with the restored database
            console.log('[RESTORE] Backup ripristinato, riavvio in corso...');
            setTimeout(() => {
                process.exit(RESTART_EXIT_CODE);
            }, 1000);

            return { success: true };
        } catch (e: any) {
            // The connection is gone: restart so the app reopens whatever database is on disk
            if (dbClosed) setTimeout(() => process.exit(RESTART_EXIT_CODE), 1000);
            return fail(500, { error: 'Errore critico di ripristino: ' + e.message });
        }
    }
};
