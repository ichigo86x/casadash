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

export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

export class InvalidReceiptError extends Error {}

/** Detects the real format from the first bytes: the file name and the declared type are not trusted. */
export function sniffReceiptType(b: Buffer): string | null {
	if (b.length < 12) return null;
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
	if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
	if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
	if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
	if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
	if (b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(b.subarray(8, 12).toString('latin1'))) return 'heic';
	return null;
}

/** Saves an uploaded receipt and returns the public path stored in transactions.receipt_path. */
export async function saveReceipt(file: File): Promise<string> {
	if (file.size > MAX_RECEIPT_BYTES) throw new InvalidReceiptError('Allegato troppo grande (massimo 15 MB)');
	const data = Buffer.from(await file.arrayBuffer());
	// The stored extension comes from the content, so a renamed file cannot pass as something else
	const ext = sniffReceiptType(data);
	if (!ext) throw new InvalidReceiptError('Formato allegato non supportato: usa immagini (JPG, PNG, WebP, GIF, HEIC) o PDF');

	const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
	fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
	fs.writeFileSync(path.join(RECEIPTS_DIR, filename), data);
	return `/uploads/receipts/${filename}`;
}

/** Resolves a receipt file name to its absolute path, or null if it would escape RECEIPTS_DIR. */
export function receiptFilePath(name: string): string | null {
	const base = path.basename(name);
	if (!base || base !== name) return null;
	return path.join(RECEIPTS_DIR, base);
}

/** File name of a stored receipt path ("/uploads/receipts/<name>"), or null. */
export function receiptName(receiptPath: string | null | undefined): string | null {
	if (!receiptPath) return null;
	const name = path.basename(receiptPath);
	return receiptFilePath(name) ? name : null;
}

/**
 * Deletes receipt files no movement (or deleted-movement backup) points to any more.
 * Files younger than `graceMs` are kept: an upload may be in progress.
 */
export function removeOrphanReceipts(referenced: Set<string>, graceMs = 24 * 60 * 60 * 1000): number {
	if (!fs.existsSync(RECEIPTS_DIR)) return 0;
	let removed = 0;
	for (const name of fs.readdirSync(RECEIPTS_DIR)) {
		if (referenced.has(name)) continue;
		const full = path.join(RECEIPTS_DIR, name);
		try {
			if (Date.now() - fs.statSync(full).mtimeMs < graceMs) continue;
			fs.rmSync(full, { force: true });
			removed++;
		} catch {}
	}
	return removed;
}
