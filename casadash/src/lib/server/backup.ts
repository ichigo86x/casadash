import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { client } from '$lib/server/db';
import { BACKUP_DIR, DATABASE_PATH, UPLOADS_DIR } from '$lib/server/config';
import { getSetting, setSetting } from '$lib/server/settings';
import { localDateString } from '$lib/dates';

export type BackupSchedule = {
	enabled: boolean;
	frequency: 'daily' | 'weekly';
	keep: number;
};

export const DEFAULT_SCHEDULE: BackupSchedule = { enabled: false, frequency: 'weekly', keep: 8 };

const FILE_PATTERN = /^CasaDash_(Backup|Auto)_[0-9T_-]+\.zip$/;

/**
 * Builds the backup archive: database/<file>.db (consistent snapshot through the SQLite
 * online backup API, even while the app is writing) + uploads/receipts/...
 */
export async function buildBackupZip(): Promise<Buffer> {
	const snapshot = path.join(os.tmpdir(), `casadash-backup-${Date.now()}.db`);
	try {
		await client.backup(snapshot);
		const zip = new AdmZip();
		zip.addLocalFile(snapshot, 'database', path.basename(DATABASE_PATH));
		if (fs.existsSync(UPLOADS_DIR)) zip.addLocalFolder(UPLOADS_DIR, 'uploads');
		return zip.toBuffer();
	} finally {
		fs.rmSync(snapshot, { force: true });
	}
}

export function listBackups() {
	if (!fs.existsSync(BACKUP_DIR)) return [];
	return fs
		.readdirSync(BACKUP_DIR)
		.filter((name) => FILE_PATTERN.test(name))
		.map((name) => {
			const stat = fs.statSync(path.join(BACKUP_DIR, name));
			return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
		})
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Absolute path of a stored backup, or null for any name that is not one of ours. */
export function backupFilePath(name: string): string | null {
	if (!FILE_PATTERN.test(name) || path.basename(name) !== name) return null;
	const full = path.join(BACKUP_DIR, name);
	return fs.existsSync(full) ? full : null;
}

/** Writes a backup into BACKUP_DIR and removes the oldest automatic ones beyond `keep`. */
export async function saveBackup(keep: number): Promise<string> {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const now = new Date();
	const stamp = `${localDateString(now)}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
	const name = `CasaDash_Auto_${stamp}.zip`;
	const tmp = path.join(BACKUP_DIR, `${name}.tmp`);
	fs.writeFileSync(tmp, await buildBackupZip());
	fs.renameSync(tmp, path.join(BACKUP_DIR, name));
	await setSetting('backup_last', now.toISOString());

	const autos = listBackups().filter((b) => b.name.startsWith('CasaDash_Auto_'));
	for (const old of autos.slice(Math.max(1, keep))) {
		fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
	}
	return name;
}

/** Called by the hourly scheduler: makes a backup when the configured interval has elapsed. */
export async function runScheduledBackup() {
	const schedule = await getSetting<BackupSchedule>('backup_schedule', DEFAULT_SCHEDULE);
	if (!schedule.enabled) return;
	const last = await getSetting<string | null>('backup_last', null);
	const interval = (schedule.frequency === 'daily' ? 1 : 7) * 24 * 60 * 60 * 1000;
	// Small tolerance so an hourly timer does not drift a full hour later every time
	if (last && Date.now() - new Date(last).getTime() < interval - 30 * 60 * 1000) return;
	const name = await saveBackup(schedule.keep);
	console.log(`[BACKUP] Backup automatico creato: ${name}`);
}
