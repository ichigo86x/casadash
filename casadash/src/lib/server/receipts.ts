import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RECEIPTS_DIR } from '$lib/server/config';

// Receipts are photos (compressed to WebP in the browser) or PDFs.
export const RECEIPT_TYPES: Record<string, string> = {
	webp: 'image/webp',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	heic: 'image/heic',
	pdf: 'application/pdf'
};

export class InvalidReceiptError extends Error {}

/** Saves an uploaded receipt and returns the public path stored in transactions.receipt_path. */
export async function saveReceipt(file: File): Promise<string> {
	const ext = (file.name.split('.').pop() || 'webp').toLowerCase();
	if (!RECEIPT_TYPES[ext]) throw new InvalidReceiptError(`Formato allegato non supportato: .${ext}`);

	const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
	fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
	fs.writeFileSync(path.join(RECEIPTS_DIR, filename), Buffer.from(await file.arrayBuffer()));
	return `/uploads/receipts/${filename}`;
}

/** Resolves a receipt file name to its absolute path, or null if it would escape RECEIPTS_DIR. */
export function receiptFilePath(name: string): string | null {
	const base = path.basename(name);
	if (!base || base !== name) return null;
	return path.join(RECEIPTS_DIR, base);
}
