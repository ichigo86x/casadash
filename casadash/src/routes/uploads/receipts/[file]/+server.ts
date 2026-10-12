import fs from 'fs';
import path from 'path';
import { RECEIPT_TYPES, receiptFilePath } from '$lib/server/receipts';

// Access is restricted to signed-in users by the guard in hooks.server.ts.
export const GET = async ({ params }) => {
    const fullPath = receiptFilePath(params.file);

    if (fullPath && fs.existsSync(fullPath)) {
        const ext = path.extname(fullPath).slice(1).toLowerCase();
        return new Response(fs.readFileSync(fullPath), {
            headers: {
                'Content-Type': RECEIPT_TYPES[ext] || 'application/octet-stream',
                'Cache-Control': 'private, max-age=31536000',
                'Content-Disposition': 'inline',
                'X-Content-Type-Options': 'nosniff'
            }
        });
    }

    console.warn(`[FILE-SERVER] Attachment not found: ${params.file}`);
    return new Response('File non trovato sul server.', { status: 404 });
};
