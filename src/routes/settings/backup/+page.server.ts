import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { client } from '$lib/server/db';
import { env } from '$env/dynamic/private';

export const actions: Actions = {
    restore: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });

        const data = await request.formData();
        const file = data.get('backup') as File | null;

        if (!file || file.size === 0 || !file.name.endsWith('.zip')) {
            return fail(400, { error: 'Seleziona un formaro ZIP valido generato da CasaDash.' });
        }

        try {
            // Read zip buffer
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            const zip = new AdmZip(buffer);
            
            // Check if it's a valid CasaDash backup
            const zipEntries = zip.getEntries();
            const hasDatabase = zipEntries.some(e => e.entryName.startsWith('database'));
            
            if (!hasDatabase) {
                return fail(400, { error: `L'archivio non contiene il database SQLite CasaDash.` });
            }

            // Close DB explicitly before overwriting!
            client.close();

            // Extract the ZIP contents correctly mapped
            for (const entry of zipEntries) {
                if (entry.entryName.startsWith('database/')) {
                    let dbDest = path.join(process.cwd(), 'data', 'sqlite.db');
                    if (env.DATABASE_URL) {
                        dbDest = path.resolve(process.cwd(), env.DATABASE_URL);
                    }
                    fs.writeFileSync(dbDest, entry.getData());
                } else if (entry.entryName.startsWith('uploads/')) {
                    const dest = path.join(process.cwd(), entry.entryName);
                    const dir = path.dirname(dest);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    if (!entry.isDirectory) {
                        fs.writeFileSync(dest, entry.getData());
                    }
                }
            }

            // Trigger safe restart
            setTimeout(() => {
                process.exit(0);
            }, 1000);

            return { success: true };
        } catch (e: any) {
            return fail(500, { error: 'Errore critico di ripristino: ' + e.message });
        }
    }
};
