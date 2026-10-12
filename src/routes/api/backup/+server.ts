import { error } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { env } from '$env/dynamic/private';

export const GET = async ({ locals }) => {
    if (!locals.user) {
        throw error(401, 'Non autorizzato');
    }

    try {
        const zip = new AdmZip();
        
        let dbPath = path.join(process.cwd(), 'data', 'sqlite.db');
        if (env.DATABASE_URL) {
            dbPath = path.resolve(process.cwd(), env.DATABASE_URL);
        }

        if (fs.existsSync(dbPath)) {
            zip.addLocalFile(dbPath, 'database'); 
        }

        // Add uploads dir
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (fs.existsSync(uploadsDir)) {
            zip.addLocalFolder(uploadsDir, 'uploads');
        }

        const buffer = zip.toBuffer();
        const dateStr = new Date().toISOString().split('T')[0];
        
        return new Response(buffer, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="CasaDash_Backup_${dateStr}.zip"`
            }
        });
    } catch (e: any) {
        throw error(500, 'Errore generazione backup: ' + e.message);
    }
};
