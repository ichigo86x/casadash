# CLAUDE.md

CasaDash: app web self-hosted per il budget familiare (SvelteKit 2 + Svelte 5 runes, SQLite/better-sqlite3, Drizzle). Gira come **add-on Home Assistant** (Ingress), container Docker o Node diretto. Interfaccia e messaggi in **italiano**; commenti nel codice in inglese. Il README.md è la documentazione funzionale completa: tienilo aggiornato quando cambi funzionalità.

## Layout

- Root del repo = repository add-on HA (`repository.yaml`, `docker-compose.yml`, `.github/workflows/publish.yml`).
- L'app sta in `casadash/` (qui girano tutti i comandi npm). `casadash/config.yaml` è il manifest add-on, con `version`.
- `src/lib/*.ts` = codice condiviso browser/server (date, import CSV, regole, tag trasferimento). `src/lib/server/*` = solo server.
- `src/hooks.server.ts`: sessione, guard di accesso, job orari (ricorrenti, backup, pulizia sessioni), push sensori ogni 10 min.
- `seed.js`: crea/aggiorna lo schema a ogni avvio (migrazioni "aggiungi tabella/colonna se manca") + admin e categorie. `drizzle/` è solo storico: **lo schema reale si modifica in `seed.js` e `src/lib/server/db/schema.ts` insieme**.
- `start.mjs` è il launcher comune (seed → server → riavvio con exit code 75 dopo un ripristino).

## Comandi (da `casadash/`)

```bash
npm ci
cp .env.example .env
npm run dev      # seed + Vite su :8081
npm run check    # svelte-check
npm test         # Vitest: tests/*.test.ts (solo logica pura: validate, csrf, subscriptions, insights, ocr, openbanking)
npm run build && npm start   # produzione su :8099
npm run lint     # prettier --check
```

Verifica sempre con `npm run check` (0 errori attesi; i warning a11y esistenti sono noti) e `npm test`.

**Attenzione ai dati di sviluppo:** `casadash/.env` ha `DATABASE_URL=../data/cdash.db`, quindi `npm run dev`, `node seed.js` e `node start.mjs` toccano il database reale in `casadash/data/` (`DATA_DIR` da solo non basta, vince `DATABASE_URL`). Per prove distruttive imposta `DATABASE_URL` e `DATA_DIR` insieme verso una cartella temporanea. Su Windows i file sono CRLF: attenzione alle sostituzioni di testo multilinea.

## Convenzioni che non vanno violate

- **Ingress**: link interni con `base` da `$app/paths` (`href="{base}/reports"`), redirect lato server con `appUrl(locals, '/x')`. Mai percorsi assoluti.
- **Trasferimenti**: movimenti col tag `Trasferimento` spostano soldi tra conti ma NON sono entrate/uscite. Ogni query di totali/grafici/budget/report deve aggiungere `notTransfer` (`lib/server/transfers.ts`); i saldi dei conti invece li includono.
- **Conti** = tag elencati nella setting `account_tags`. Il saldo di un conto = entrate − uscite dei movimenti con quel tag.
- Le carte di credito hanno `settled` (0 = non ancora addebitata in banca).
- Tutta la logica dei totali condivisa tra dashboard e sensori HA sta in `lib/server/stats.ts` (`monthOverview`, `accountBalances`, `creditCardUnsettled`, `financialPosition`). Un nuovo numero va qui, poi esposto in dashboard e in `sensors.ts`.
- Settings chiave/valore JSON in tabella `settings` via `getSetting/setSetting`.
- Azioni riservate ad admin: `requireAdmin(locals)`. Backup e `/api/backup` sono protetti anche in hooks.
- Le intestazioni `X-Remote-User-*` sono fidate solo con `SUPERVISOR_TOKEN`, path Ingress valido e client `172.30.32.2` (`ingress.ts`).
- Gli importi sono `REAL` (float): le somme SQL di `stats.ts` sono già arrotondate a 2 decimali (`round(...,2)`); in input usa `parseAmount`/`round2` di `lib/validate.ts`.
- `/api/sensors` è pubblico per il guard ma richiede il token Bearer (solo hash SHA-256 salvato).
- Il controllo CSRF di SvelteKit è disattivato; lo sostituisce `lib/server/csrf.ts` (Sec-Fetch-Site/Origin), chiamato per primo in `hooks.server.ts`. CSP in `svelte.config.js`, altre intestazioni in `withSecurityHeaders`.
- adapter-node considera ogni richiesta "https" se `ORIGIN` non è impostato: per il protocollo usa `requestIsHttps(headers)` in `config.ts`, mai `event.url.protocol`.
- Password: sempre `lib/server/passwords.ts` (async, bcrypt 12) e `lib/passwordPolicy.ts`. MFA: `lib/server/mfa.ts`; segreti cifrati con `lib/server/secrets.ts` (chiave in `DATA_DIR/secret.key`, inclusa nei backup).
- Ogni form che scrive movimenti passa da `lib/validate.ts`. Eliminazioni di movimenti: `trashRows` (`lib/server/trash.ts`) per l'annullamento a 30 giorni.
- Eventi sensibili: `audit(locals.user, 'azione', dettaglio, ip)` (`lib/server/audit.ts`); le etichette sono in `settings/audit/+page.svelte`.
- Colonne/tabelle nuove: `seed.js` (blocco "added in 1.6.0" con `addColumn`) + `db/schema.ts`.
- OCR: `scripts/copy-ocr.mjs` copia motore e lingua in `static/ocr` (gitignored) a ogni dev/build; `lib/ocr.ts` li carica da lì.
- Open Banking: `lib/openbanking.ts` (puro, testato) + `lib/server/openbanking.ts` (Enable Banking e GoCardless; sync ogni 8 ore dal job orario). Enable Banking: JWT RS256 firmato con la chiave dell'app, redirect fisso `https://enablebanking.com/` e codice incollato dall'utente (`finishEnableBanking`).

## Rilascio

Alzare `version` in `casadash/config.yaml` + `CHANGELOG.md`, poi taggare `v<versione>` e pushare: l'action pubblica l'immagine GHCR che l'add-on scarica. Senza tag HA mostra l'aggiornamento ma non lo scarica.

## Dati locali

`data/` (database, ricevute, backup) è ignorato da git: non committarlo e non modificare il `.db` a mano.
