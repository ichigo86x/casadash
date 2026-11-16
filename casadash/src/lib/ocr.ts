// Receipt scanning in the browser with Tesseract. The engine and the Italian language data are served by
// CasaDash itself (static/ocr, copied by scripts/copy-ocr.mjs): nothing is sent to a third party and
// the receipt photo never leaves the device for this step.
import { parseReceiptText, type ReceiptGuess } from '$lib/receiptParse';

/** Folder where static/ocr is served, also behind a Home Assistant Ingress prefix. */
function ocrRoot(): string {
	const here = import.meta.url;
	const prefix = here.includes('/_app/') ? here.split('/_app/')[0] : location.origin;
	return `${prefix}/ocr`;
}

export async function scanReceipt(image: Blob, onProgress?: (pct: number) => void): Promise<{ text: string; guess: ReceiptGuess }> {
	const { createWorker } = await import('tesseract.js');
	const root = ocrRoot();
	const worker = await createWorker('ita', 1, {
		workerPath: `${root}/worker.min.js`,
		corePath: `${root}/core`,
		langPath: `${root}/lang`,
		workerBlobURL: false,
		gzip: true,
		logger: (m: { status: string; progress: number }) => {
			if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100));
		}
	});
	try {
		const { data } = await worker.recognize(image);
		return { text: data.text, guess: parseReceiptText(data.text) };
	} finally {
		await worker.terminate();
	}
}
