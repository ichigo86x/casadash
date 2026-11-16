// Copies the OCR engine (Tesseract) and the Italian language data into static/ocr, so receipt scanning
// works offline and never loads code from a third-party server. Runs before dev and build.
import fs from 'fs';
import path from 'path';

const out = path.resolve('static/ocr');
const nm = path.resolve('node_modules');

const files = [
	[path.join(nm, 'tesseract.js/dist/worker.min.js'), 'worker.min.js'],
	[path.join(nm, 'tesseract.js-core/tesseract-core-lstm.wasm.js'), 'core/tesseract-core-lstm.wasm.js'],
	[path.join(nm, 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'core/tesseract-core-simd-lstm.wasm.js'],
	[path.join(nm, 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'), 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
	[path.join(nm, '@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz'), 'lang/ita.traineddata.gz']
];

let copied = 0;
for (const [from, to] of files) {
	const dest = path.join(out, to);
	if (!fs.existsSync(from)) {
		console.warn(`[OCR] File mancante, lettura scontrini non disponibile: ${path.relative(process.cwd(), from)}`);
		continue;
	}
	if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(from).size) continue;
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(from, dest);
	copied++;
}
if (copied) console.log(`[OCR] Copiati ${copied} file in static/ocr`);
