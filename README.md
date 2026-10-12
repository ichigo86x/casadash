# CasaDash

CasaDash è un'applicazione web self-hosted per la gestione del budget familiare: registra entrate e uscite, imposta budget mensili e annuali per categoria, automatizza le spese ricorrenti e produce report filtrabili ed esportabili.

È scritta in **SvelteKit** (Svelte 5, Node.js) con database **SQLite**, ed è nata come porting di una precedente versione PHP. Lo stesso codice funziona in tre modi:

- come **add-on di Home Assistant**, con accesso dal pannello laterale tramite Ingress;
- come **container Docker** standalone;
- **direttamente** su una macchina con Node.js.

---

## Indice

- [Funzionalità](#funzionalità)
  - [Conti e trasferimenti](#conti-e-trasferimenti)
- [Stack tecnologico](#stack-tecnologico)
- [Struttura del repository](#struttura-del-repository)
- [Installazione](#installazione)
  - [Add-on Home Assistant](#1-add-on-home-assistant)
  - [Docker / Docker Compose](#2-docker--docker-compose)
  - [Esecuzione diretta con Node.js](#3-esecuzione-diretta-con-nodejs)
- [Configurazione](#configurazione)
- [Primo accesso](#primo-accesso)
- [Dati, backup e ripristino](#dati-backup-e-ripristino)
- [Modello dati](#modello-dati)
- [Sviluppo](#sviluppo)
- [Rilasci](#rilasci)
- [Sicurezza](#sicurezza)

---

## Funzionalità

### Dashboard (`/`)
- **Riepilogo:** totale entrate, totale uscite e saldo complessivo. I trasferimenti tra conti sono esclusi.
- **Questo mese:**
  - spese ed entrate del mese;
  - avanzamento del budget mensile;
  - **previsione di fine mese**: spese finora + stesso ritmo giornaliero per i giorni rimanenti + ricorrenti ancora da addebitare;
  - avvisi per le categorie oltre l'80% del budget.
- **Saldi per conto:** saldo di ogni conto definito in *Categorie → Conti*, trasferimenti inclusi. Un clic filtra la lista su quel conto.
- **Grafici** (Chart.js):
  - entrate e uscite per categoria;
  - andamento giornaliero degli ultimi 30 giorni;
  - entrate e uscite mese per mese dell'anno corrente.
- **Gestione movimenti:**
  - inserimento, modifica ed eliminazione di entrate e uscite;
  - campi: tipo, descrizione, importo, data, categoria, metodo di pagamento, tag;
  - metodi di pagamento: **bancomat**, **contanti**, **carta di credito**;
  - **tag liberi** con suggerimenti, più pulsanti rapidi per `Trasferimento` e per i conti;
  - **autocompletamento della descrizione** dai movimenti precedenti;
  - **allegato ricevuta** (immagine o PDF), visualizzabile e rimovibile;
  - indicazione dell'utente della famiglia che ha registrato il movimento.
- **Lista e ricerca:**
  - paginazione lato server, veloce anche con anni di dati;
  - filtri per descrizione, categoria, tipo (entrata, uscita, trasferimento), metodo di pagamento, conto, importo, date e allegato;
  - i filtri restano nell'indirizzo della pagina, quindi sopravvivono al ricaricamento.
- **Carta di credito:**
  - le spese con carta di credito possono restare "da saldare";
  - la dashboard mostra totale e numero dei movimenti non ancora addebitati;
  - **saldo in blocco** per intervallo di date, con la data di partenza precompilata dall'ultimo saldo.

### Conti e trasferimenti
- I **conti** sono tag, ad esempio `BNL`, `Poste`, `Libretto`. Si elencano in *Categorie → Conti*.
- Un movimento con il tag **`Trasferimento`** sposta soldi tra due conti della famiglia:
  - cambia il saldo dei conti coinvolti;
  - **non conta** come entrata o uscita in totali, grafici, budget, previsioni e report.
- Per un giroconto, ad esempio da BNL al Libretto, registra:
  - un'uscita con i tag `BNL` e `Trasferimento`;
  - un'entrata con i tag `Libretto` e `Trasferimento`.
- Il **saldo iniziale** di un conto si registra come entrata con il tag del conto e `Trasferimento`.

### Report (`/reports`)
- Filtri per **intervallo di date**, **mese** o **anno**.
- Filtri aggiuntivi:
  - metodo di pagamento (conto/bancomat, carta di credito, contanti);
  - tag multipli, quindi anche per conto;
  - categoria;
  - esclusione delle spese con carta di credito non saldate;
  - presenza o assenza di ricevuta.
- Riepilogo di entrate, uscite e saldo del periodo, con un riquadro separato per i trasferimenti.
- **Confronto con lo stesso periodo dell'anno precedente**, sui totali e per ogni categoria di spesa.
- Ripartizione per categoria (entrate e uscite separate) e ripartizione giornaliera, confrontate con i budget del periodo.
- **Esportazione CSV** compatibile con Excel (separatore `;`, codifica UTF-8 con BOM, tag inclusi).
- **Esportazione PDF** dalla stampa del browser, con un layout pulito senza menu e filtri.

### Importazione dal conto corrente (`/import`)
- Caricamento dell'**export CSV** dei movimenti della banca. Il file viene letto nel browser e solo le righe confermate arrivano al server.
- Riconoscimento automatico, modificabile a mano:
  - separatore (`;`, `,`, tabulazione) e codifica (UTF-8 o Windows-1252);
  - riga di intestazione, anche dopo righe di preambolo con IBAN e periodo;
  - colonne di data, descrizione e importo (una colonna con segno, oppure addebiti e accrediti separati);
  - date `gg/mm/aaaa`, `gg-mm-aa`, `aaaa-mm-gg` e importi `1.234,56` o `1,234.56`.
- Righe di saldo e intestazioni ripetute vengono scartate e mostrate a parte.
- **Anteprima** prima dell'importazione:
  - categoria suggerita dai movimenti con la stessa descrizione;
  - doppioni rilevati (stessa data, importo e descrizione) ed esclusi in automatico;
  - possibili doppioni segnalati (stessa data e importo);
  - per ogni doppione, il movimento già registrato: si vede passando il mouse sull'etichetta o con un clic;
  - descrizione modificabile con un clic direttamente nella lista;
  - selezione riga per riga e marcatura dei giroconti come trasferimenti.
- Di default importa solo le uscite. Le entrate si includono con un'opzione.
- I movimenti ricevono il tag del conto scelto e il tag `Importato`, e si ritrovano con la ricerca.
- La mappatura delle colonne viene ricordata per formato di file (impostazione `import_profiles`).
- I file Excel vanno prima salvati come CSV.

### Obiettivi di risparmio (`/goals`)
- Obiettivi con nome, importo da raggiungere, scadenza facoltativa, colore e icona.
- Versamenti e prelievi con data e nota.
- Avanzamento, importo mancante e **quota mensile necessaria** per arrivare alla scadenza.
- Gli obiettivi raggiunti o abbandonati si possono archiviare.

### Budget (`/settings/budgets`)
- Budget **mensile** per categoria e totale.
- Budget **annuale** totale.
- Budget **annuale per categoria**.

### Categorie e conti (`/settings/categories`)
- Categorie di entrata e di uscita con **colore** e **icona** (Font Awesome).
- Creazione, modifica ed eliminazione.
- Categorie predefinite create al primo avvio:
  - **Uscite:** Cibo, Trasporti, Intrattenimento, Utenze, Shopping, Salute, Casa, Istruzione, Altro.
  - **Entrate:** Stipendio, Freelance, Investimenti, Vendite, Bonus, Rimborsi, Altro.
- Elenco dei **conti**, vedi [Conti e trasferimenti](#conti-e-trasferimenti).

### Movimenti ricorrenti (`/settings/recurring`)
- Abbonamenti, stipendi e spese fisse con frequenza **giornaliera, settimanale, mensile o annuale**.
- Attivazione e disattivazione senza eliminare la regola.
- **Esecuzione automatica:** ogni ora, in background, il server crea i movimenti scaduti con la data prevista, li etichetta con il tag `Ricorrente` e porta avanti la prossima scadenza.
- Se l'app è rimasta spenta, al riavvio vengono registrate tutte le scadenze saltate.
- Il giorno del mese scelto viene ricordato. Un ricorrente del 31 cade il 28/29 febbraio e torna al 31 a marzo.

### Famiglia / Utenti (`/settings/users`)
- Più utenti per nucleo familiare: tutti vedono e gestiscono gli stessi dati.
- **Ruoli:**
  - **Amministratore**: gestisce utenti, ruoli, backup e ripristino;
  - **Membro**: gestisce movimenti, budget, categorie, ricorrenti e obiettivi.
- Deve sempre restare almeno un amministratore.
- I dati di un utente eliminato passano a chi lo elimina.
- Un nuovo utente deve scegliere una password personale al primo accesso.

### Profilo e sicurezza
- **Profilo** (`/settings/profile`): modifica del nome visualizzato e della password. Il cambio password disconnette gli altri dispositivi.
- **Autenticazione a due fattori** (`/settings/mfa`): TOTP compatibile con Google Authenticator, Authy e simili, attivabile tramite QR code.
- Password salvate con **bcrypt**; sono accettati anche gli hash `$2y$` della vecchia versione PHP.
- Sessioni lato server con token casuale e blocco temporaneo dopo 5 tentativi di accesso falliti.

### Backup (`/settings/backup`, solo amministratori)
- **Download** di un archivio ZIP con il database SQLite e tutte le ricevute caricate.
- **Backup automatici** giornalieri o settimanali, con numero di copie da tenere. Si possono avviare a mano, scaricare ed eliminare.
- **Ripristino** da un archivio ZIP di CasaDash, con riavvio automatico dell'applicazione. L'archivio viene convalidato prima di sovrascrivere i dati.
- Gli archivi sono compatibili tra add-on, Docker e installazione diretta.

### Interfaccia
- Tema **scuro e chiaro**, con la preferenza salvata nel browser.
- **PWA**: con `manifest.json` è installabile sulla schermata home dello smartphone.
- Interfaccia in italiano.
- Funziona sia all'indirizzo diretto sia dietro **Home Assistant Ingress**.

---

## Stack tecnologico

| Componente | Tecnologia |
|---|---|
| Framework | SvelteKit 2, Svelte 5 (runes) |
| Runtime | Node.js 24 (`@sveltejs/adapter-node`) |
| Database | SQLite tramite `better-sqlite3` |
| ORM / migrazioni | Drizzle ORM, drizzle-kit |
| Stile | Tailwind CSS 4 e CSS personalizzato |
| Grafici | Chart.js |
| Autenticazione | bcryptjs, otpauth (TOTP), qrcode |
| Backup | adm-zip |

---

## Struttura del repository

Il repository segue il formato dei **repository di add-on Home Assistant**: nella root ci sono i file del repository, l'applicazione sta nella cartella `casadash/`.

```
.
├── repository.yaml           # Manifest del repository add-on Home Assistant
├── docker-compose.yml        # Avvio standalone con Docker Compose
├── .github/workflows/
│   └── publish.yml           # Build e pubblicazione dell'immagine multi-arch su GHCR
└── casadash/                 # Add-on e applicazione
    ├── config.yaml           # Manifest dell'add-on (Ingress, porte, architetture)
    ├── DOCS.md               # Documentazione mostrata in Home Assistant
    ├── CHANGELOG.md
    ├── icon.png
    ├── Dockerfile            # Immagine multi-stage per add-on e Docker
    ├── run.sh                # Entrypoint del container
    ├── start.mjs             # Launcher comune: seed, avvio, riavvio dopo un ripristino
    ├── seed.js               # Schema e migrazioni, admin e categorie predefinite
    ├── .env.example          # Configurazione per l'installazione diretta
    ├── drizzle/              # Migrazioni e snapshot drizzle-kit
    ├── static/               # manifest PWA, icone
    └── src/
        ├── hooks.server.ts   # Sessione, controllo accessi, attività orarie (ricorrenti, backup)
        ├── lib/dates.ts      # Date locali e calcolo delle scadenze ricorrenti
        ├── lib/transfers.ts  # Tag "Trasferimento" (condiviso con il browser)
        ├── lib/import.ts     # Lettura dei CSV bancari: separatore, date, importi, colonne
        ├── lib/server/
        │   ├── config.ts     # Percorsi dati (DATA_DIR) e opzioni cookie
        │   ├── auth.ts       # Sessioni, MFA, limitazione dei tentativi
        │   ├── ingress.ts    # Prefisso Home Assistant Ingress
        │   ├── receipts.ts   # Salvataggio e servizio delle ricevute
        │   ├── backup.ts     # Archivio ZIP, backup automatici e conservazione
        │   ├── settings.ts   # Impostazioni chiave/valore
        │   ├── transfers.ts  # Condizioni SQL per trasferimenti e tag
        │   ├── roles.ts      # Controllo del ruolo amministratore
        │   └── db/           # Connessione SQLite, schema Drizzle
        └── routes/
            ├── +page.*       # Dashboard e azioni sui movimenti
            ├── login/        # Login e verifica MFA
            ├── reports/      # Report, confronto annuale, export CSV e PDF
            ├── goals/        # Obiettivi di risparmio
            ├── import/       # Importazione dell'export CSV della banca
            ├── settings/     # budgets, categories, recurring, users, profile, mfa, backup
            ├── api/backup/   # GET: download del backup ZIP
            └── uploads/receipts/[file]/  # Servizio delle ricevute
```

---

## Installazione

Le tre modalità usano lo stesso launcher, `start.mjs`, che esegue in ordine:
1. le migrazioni del database con `seed.js`;
2. l'avvio del server;
3. il riavvio automatico dopo il ripristino di un backup.

### 1. Add-on Home Assistant

**Da repository (consigliato)**

1. In Home Assistant apri **Impostazioni → Componenti aggiuntivi → Store**.
2. Apri **⋮ → Repository**, aggiungi `https://github.com/ichigo86x/casadash` e conferma.
3. Apri **CasaDash** nello Store e premi **Installa**. Viene scaricata l'immagine già pronta.
4. Avvia l'add-on e attiva **Mostra nella barra laterale**. CasaDash si apre dal pannello tramite **Ingress**.

Per provare un branch non ancora unito a `main`, aggiungi il repository come `https://github.com/ichigo86x/casadash#nome-branch`.

**Come add-on locale (sviluppo)**

1. Copia la cartella `casadash/` in `/addons/casadash` sull'host, con l'add-on *Samba* o *SSH*.
2. Nello Store apri **⋮ → Controlla aggiornamenti**: CasaDash compare tra gli *Add-on locali*.
3. Installa e avvia come sopra.

**Accesso diretto (opzionale)**

La porta 8099 non è pubblicata di default. Per usare CasaDash fuori dal pannello, ad esempio come PWA sullo smartphone:
1. apri la scheda **Rete** dell'add-on;
2. imposta una porta host per `8099/tcp`, ad esempio `8081`;
3. apri `http://<ip-home-assistant>:8081`.

Database e ricevute stanno nella cartella `/data` dell'add-on, quindi sono inclusi nei backup di Home Assistant.

Architetture supportate: `amd64` e `aarch64` (Raspberry Pi 4/5 con sistema a 64 bit).

### 2. Docker / Docker Compose

```bash
git clone https://github.com/ichigo86x/casadash.git
cd casadash
docker compose up -d --build
```

L'app è disponibile su `http://localhost:8099`. I dati restano nel volume `casadash_data`, montato su `/data`.

Per cambiare porta o fuso orario modifica `docker-compose.yml`:

```yaml
    ports:
      - "8080:8099"        # host:container
    environment:
      - TZ=Europe/Rome
```

Senza Compose:

```bash
docker build -t casadash ./casadash
docker run -d --name casadash --restart unless-stopped \
  -p 8099:8099 -v casadash_data:/data -e TZ=Europe/Rome casadash
```

In alternativa alla build locale puoi usare l'immagine pubblicata: `image: ghcr.io/ichigo86x/casadash:latest` al posto di `build:`.

### 3. Esecuzione diretta con Node.js

Requisiti: **Node.js 22.12 o superiore** (consigliato 24). Se per la tua piattaforma non esiste un binario precompilato di `better-sqlite3`, servono anche gli strumenti di compilazione: `python3`, `make` e `g++` su Linux, i *Build Tools* di Visual Studio su Windows.

```bash
git clone https://github.com/ichigo86x/casadash.git
cd casadash/casadash
npm ci
npm run build
cp .env.example .env      # Windows: copy .env.example .env
npm start
```

L'app è disponibile su `http://localhost:8099`. Database e ricevute vengono salvati in `./data`, o nella cartella indicata da `DATA_DIR` in `.env`.

Per tenerla attiva all'avvio della macchina usa un gestore di servizi che esegua `npm start` nella cartella `casadash/`. Su Linux puoi usare systemd:

```ini
# /etc/systemd/system/casadash.service
[Unit]
Description=CasaDash
After=network.target

[Service]
WorkingDirectory=/opt/casadash/casadash
ExecStart=/usr/bin/node start.mjs
Restart=on-failure
User=casadash

[Install]
WantedBy=multi-user.target
```

Su Windows puoi usare NSSM o pm2.

---

## Configurazione

Variabili d'ambiente, oppure file `.env` nell'installazione diretta:

| Variabile | Default | Descrizione |
|---|---|---|
| `DATA_DIR` | `./data` (`/data` nel container) | Cartella del database (`cdash.db`) e delle ricevute (`uploads/`). |
| `DATABASE_URL` | `$DATA_DIR/cdash.db` | Percorso esplicito del database. Lo usa anche drizzle-kit. |
| `UPLOADS_DIR` | `$DATA_DIR/uploads` | Cartella delle ricevute. |
| `BACKUP_DIR` | `$DATA_DIR/backups` (`/share/casadash/backups` nell'add-on) | Cartella dei backup automatici. |
| `PORT` | `8099` | Porta HTTP. Nell'add-on è fissa, perché Ingress usa la 8099. |
| `HOST` | `0.0.0.0` | Interfaccia di ascolto. |
| `COOKIE_SECURE` | `auto` | Flag `Secure` del cookie di sessione. `auto` lo attiva solo per richieste HTTPS, anche dietro un proxy che invia `X-Forwarded-Proto`. Valori ammessi: `true`, `false`. |
| `BODY_SIZE_LIMIT` | `100M` | Dimensione massima di upload per ricevute e backup. |
| `TZ` | fuso del sistema | Fuso orario, ad esempio `Europe/Rome`. |

L'add-on Home Assistant non ha opzioni da configurare.

---

## Primo accesso

Al primo avvio, se il database non ha utenti, viene creato l'account:

- **utente:** `admin`
- **password:** `admin`

Al primo accesso CasaDash chiede subito una nuova password. Lo stesso succede alle installazioni esistenti che usano ancora `admin`/`admin`.

Dopo il primo accesso:
- attiva la verifica in due passaggi da **MFA**;
- aggiungi gli altri membri da **Famiglia**. Anche loro dovranno scegliere una password personale al primo accesso.

---

## Dati, backup e ripristino

| Dato | Add-on / Docker | Installazione diretta |
|---|---|---|
| Database | `/data/cdash.db` | `$DATA_DIR/cdash.db` (default `./data/cdash.db`) |
| Ricevute | `/data/uploads/receipts/` | `$DATA_DIR/uploads/receipts/` |
| Backup automatici | `/share/casadash/backups/` (add-on), `/data/backups/` (Docker) | `$DATA_DIR/backups/` |

- **Backup dall'app:** *Backup → Scarica* produce `CasaDash_Backup_AAAA-MM-GG.zip`. Il database viene copiato con l'API di backup online di SQLite, quindi la copia è coerente anche mentre l'app è in uso.
- **Ripristino dall'app:** carica lo ZIP.
  - L'archivio viene prima convalidato: deve contenere un database SQLite e nessun percorso fuori dalla cartella uploads.
  - Poi database e ricevute vengono sostituiti e l'app si riavvia da sola.
- **Backup di sistema:** copia la cartella dei dati. Nell'add-on è già inclusa nei backup di Home Assistant.

Gli archivi sono compatibili con la versione 1.0.0 e tra le tre modalità di installazione.

Lo schema viene creato e aggiornato a ogni avvio da `seed.js`, che aggiunge tabelle e colonne mancanti. I database delle versioni precedenti vengono quindi migrati automaticamente.

---

## Modello dati

| Tabella | Contenuto |
|---|---|
| `users` | username, hash della password, segreto TOTP opzionale, nome visualizzato, ruolo (`admin`/`member`), obbligo di cambio password |
| `sessions` | sessioni attive e verifiche MFA in corso (solo l'hash SHA-256 del token), con scadenza |
| `transactions` | tipo (`income`/`expense`), descrizione, importo, data, categoria, metodo di pagamento, tag (JSON), ricevuta, stato del saldo della carta di credito, autore |
| `recurring_transactions` | regole ricorrenti: frequenza, prossima scadenza, giorno del mese di riferimento, attiva/disattiva |
| `budgets` | tipo di periodo (`monthly`, `annual`, `annual-category`), anno, mese, categoria (`Totale` = complessivo), importo |
| `categories` | nome, tipo, colore, icona |
| `goals` / `goal_contributions` | obiettivi di risparmio e relativi versamenti (positivi) e prelievi (negativi) |
| `settings` | impostazioni chiave/valore in JSON: conti (`account_tags`), pianificazione dei backup, mappature di importazione (`import_profiles`) |

---

## Sviluppo

```bash
cd casadash
npm ci
cp .env.example .env
npm run dev          # esegue seed.js e avvia Vite su http://localhost:8081
```

| Script | Descrizione |
|---|---|
| `npm run dev` | Migrazioni e server di sviluppo Vite (porta 8081) |
| `npm run build` | Build di produzione in `build/` |
| `npm start` | Avvio di produzione tramite `start.mjs` |
| `npm run seed` | Solo migrazioni e dati iniziali |
| `npm run check` | Type-check con svelte-check |
| `npm run lint` / `npm run format` | Prettier |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | drizzle-kit |

**Link interni e Ingress.** L'app gira sia su `/` sia sotto il prefisso di Ingress (`/api/hassio_ingress/<token>/`). Per questo:
- i link interni usano `base` da `$app/paths`, ad esempio `href="{base}/reports"`, mai percorsi assoluti come `/reports`;
- i redirect lato server usano `appUrl(locals, '/percorso')`;
- la configurazione `paths.relative: true` in `svelte.config.js` rende relativi i percorsi degli asset.

---

## Rilasci

1. Aggiorna `version` in `casadash/config.yaml` e `casadash/CHANGELOG.md`.
2. Crea e invia il tag corrispondente:
   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```
3. La GitHub Action `publish.yml` pubblica `ghcr.io/ichigo86x/casadash` per `amd64` e `arm64`.
4. La prima volta, rendi pubblico il pacchetto dalla pagina *Packages* di GitHub.

L'add-on usa questa immagine (`image:` in `casadash/config.yaml`). Ogni aumento di `version` richiede quindi il push del tag `v<versione>`: altrimenti Home Assistant mostra l'aggiornamento ma non riesce a scaricarlo.

---

## Sicurezza

- Tutte le pagine, le API e le ricevute richiedono l'accesso.
- Le sessioni sono lato server: il cookie contiene un token casuale e il database ne conserva solo l'hash.
- La verifica MFA è legata a un token temporaneo di 5 minuti.
- Dopo 5 tentativi di accesso falliti l'accesso è bloccato per 15 minuti, per indirizzo e utente.
- Il cookie è `HttpOnly` e `SameSite=Lax`. Il flag `Secure` dipende da `COOKIE_SECURE`.
- La password predefinita deve essere cambiata al primo accesso.
- Gli allegati accettano solo immagini e PDF, e i ripristini rifiutano archivi non validi.

CasaDash resta pensata per una **rete domestica**. Per l'accesso da Internet usa Ingress di Home Assistant, una VPN (WireGuard, Tailscale) o un reverse proxy HTTPS con `COOKIE_SECURE=true`. Non pubblicare direttamente la porta 8099.
