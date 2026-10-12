// CasaDash launcher, used by every deployment target (Home Assistant add-on, Docker, bare metal):
//   1. loads .env if present
//   2. runs seed.js (schema migrations, default admin and categories)
//   3. starts the SvelteKit server and restarts it when it asks to (exit code 75, after a backup restore)
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const RESTART_EXIT_CODE = 75;
const appDir = path.dirname(fileURLToPath(import.meta.url));

try { process.loadEnvFile(path.join(appDir, '.env')); } catch {}

process.env.PORT ||= '8099';
process.env.HOST ||= '0.0.0.0';
// adapter-node rejects request bodies over 512K by default: too small for receipts and backup archives
process.env.BODY_SIZE_LIMIT ||= '100M';

function seed() {
	const result = spawnSync(process.execPath, [path.join(appDir, 'seed.js')], { stdio: 'inherit', cwd: process.cwd() });
	if (result.status !== 0) {
		console.error('[START] Inizializzazione database fallita.');
		process.exit(result.status ?? 1);
	}
}

let child = null;
let stopping = false;

function run() {
	seed();
	child = spawn(process.execPath, [path.join(appDir, 'build', 'index.js')], { stdio: 'inherit', cwd: process.cwd() });
	child.on('exit', (code, signal) => {
		if (!stopping && code === RESTART_EXIT_CODE) {
			console.log('[START] Riavvio richiesto dall\'applicazione...');
			run();
			return;
		}
		process.exit(code ?? (signal ? 1 : 0));
	});
}

for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		stopping = true;
		if (child) child.kill(sig);
		else process.exit(0);
	});
}

console.log(`[START] CasaDash su http://${process.env.HOST}:${process.env.PORT}`);
run();
