import fs from 'fs';
import path from 'path';

export const GET = async ({ params }) => {
    // Decode URI component in case the browser encoded dashes/spaces in filename
    const filename = decodeURIComponent(params.file);
    // ensure safe path to prevent directory traversal
    const safePath = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(process.cwd(), 'uploads', 'receipts', safePath);
    
    console.log(`[FILE-SERVER] Requesting attachment: ${filename} -> Resolved local path: ${fullPath}`);

    if (fs.existsSync(fullPath)) {
        const file = fs.readFileSync(fullPath);
        const isPdf = filename.toLowerCase().endsWith('.pdf');
        return new Response(file, { 
            headers: { 
                'Content-Type': isPdf ? 'application/pdf' : 'image/webp',
                'Cache-Control': 'public, max-age=31536000',
                'Content-Disposition': 'inline'
            } 
        });
    }

    console.warn(`[FILE-SERVER] Attachment not found physically on disk at: ${fullPath}`);
    return new Response('File non trovato sul server.', { status: 404 });
};
