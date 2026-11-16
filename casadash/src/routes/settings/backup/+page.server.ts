import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { KEY_FILE } from '$lib/server/secrets';
import { audit } from '$lib/server/audit';
import { client } from '$lib/server/db';
import { BACKUP_DIR, DATABASE_PATH, RESTART_EXIT_CODE, UPLOADS_DIR } from '$lib/server/config';
import { DEFAULT_SCHEDULE, backupFilePath, listBackups, saveBackup, type BackupSchedule } from '$lib/server/backup';
import { getSetting, setSetting } from '$lib/server/settings';
import { requireAdmin } from '$lib/server/roles';
import { createSensorToken, hasSensorToken, revokeSensorToken } from '$lib/server/sensors';
import { env } from '$env/dynamic/private';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const MAX_ENTRIES = 50_000;
const MAX_UNCOMPRESSED = 4 * 1024 * 1024 * 1024; // 4 GB

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
        backupDir: BACKUP_DIR,
        sensorToken: await hasSensorToken(),
        // In the add-on the sensors are pushed to Home Assistant automatically
        addon: !!env.SUPERVISOR_TOKEN
    };
};

export const actions: Actions = {
    createToken: async ({ locals, getClientAddress }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        await audit(locals.user, 'sensor_token.created', undefined, getClientAddress());
        // Shown once: only its hash is stored
        return { newToken: await createSensorToken() };
    },
    revokeToken: async ({ locals }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;
        await revokeSensorToken();
        return { tokenRevoked: true };
    },
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
    restore: async ({ request, locals, getClientAddress }) => {
        const denied = requireAdmin(locals);
        if (denied) return denied;

        const data = await request.formData();
        const file = data.get('backup') as File | null;

        if (!file || file.size === 0 || !file.name.endsWith('.zip')) {
            return fail(400, { error: 'Seleziona un formato ZIP valido generato da CasaDash.' });
        }

        let dbClosed = false;
        const probe = path.join(os.tmpdir(), `casadash-restore-${Date.now()}.db`);
        try {
            const zip = new AdmZip(Buffer.from(await file.arrayBuffer()));
            const zipEntries = zip.getEntries();

            // Zip-bomb guard: refuse absurd archives before inflating anything
            if (zipEntries.length > MAX_ENTRIES) return fail(400, { error: 'Archivio con troppi file.' });
            const declared = zipEntries.reduce((s, e) => s + (e.header.size || 0), 0);
            if (declared > MAX_UNCOMPRESSED) return fail(400, { error: 'Archivio troppo grande una volta decompresso.' });

            // Validate the whole archive before touching anything on disk
            const dbEntry = zipEntries.find(e => !e.isDirectory && e.entryName.startsWith('database/'));
            const dbData = dbEntry?.getData();
            if (!dbData || !dbData.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
                return fail(400, { error: `L'archivio non contiene il database SQLite CasaDash.` });
            }

            // The database must open, pass SQLite's own integrity check and look like CasaDash (has an administrator)
            fs.writeFileSync(probe, dbData);
            const check = new Database(probe, { readonly: true });
            try {
                const integrity = check.pragma('integrity_check', { simple: true });
                if (integrity !== 'ok') return fail(400, { error: 'Il database nell\'archivio è danneggiato.' });
                const tables = new Set((check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
                if (!['users', 'transactions', 'categories'].every((t) => tables.has(t))) {
                    return fail(400, { error: 'Il database nell\'archivio non è un database CasaDash.' });
                }
                const admins = (check.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
                if (admins < 1) return fail(400, { error: 'Il database nell\'archivio non ha nessun amministratore.' });
            } finally {
                check.close();
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
            const keyEntry = zipEntries.find((e) => !e.isDirectory && e.entryName === 'keys/secret.key');

            // Safety net: a backup of the current data is written first, so a wrong restore can be reverted
            try {
                await saveBackup(Number.MAX_SAFE_INTEGER, 'CasaDash_Backup');
            } catch (e) {
                console.error('[RESTORE] Backup preventivo non riuscito:', e);
                return fail(500, { error: 'Impossibile creare il backup preventivo dei dati attuali: ripristino annullato.' });
            }

            // Close DB explicitly before overwriting, then swap the file in atomically
            client.close();
            dbClosed = true;
            const tmpDb = `${DATABASE_PATH}.restore`;
            fs.writeFileSync(tmpDb, dbData);
            fs.renameSync(tmpDb, DATABASE_PATH);
            // Leftover journal files of the old database must not be applied to the new one
            for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(DATABASE_PATH + suffix, { force: true });
            // Recorded in the restored database itself: an entry written before the swap would be lost with it
            try {
                const restored = new Database(DATABASE_PATH);
                restored.prepare('INSERT INTO audit_log (at, user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(new Date().toISOString(), locals.user?.id ?? null, locals.user?.username ?? null, 'backup.restored', file.name.slice(0, 200), getClientAddress());
                restored.close();
            } catch (e) {
                console.error('[RESTORE] Registro attività non aggiornato:', (e as Error).message);
            }

            for (const { dest, data } of uploads) {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest, data);
            }
            // The encryption key travels with the backup, unless the key is supplied by CASADASH_SECRET_KEY
            if (keyEntry && !env.CASADASH_SECRET_KEY) fs.writeFileSync(KEY_FILE, keyEntry.getData(), { mode: 0o600 });

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
        } finally {
            fs.rmSync(probe, { force: true });
        }
    }
};
