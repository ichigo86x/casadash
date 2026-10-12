# CasaDash

CasaDash è un'applicazione web self-hosted per la gestione del budget familiare: registra entrate e uscite, imposta budget mensili e annuali per categoria, automatizza le spese ricorrenti e produce report filtrabili ed esportabili.

È scritta in **SvelteKit** (Svelte 5, Node.js) con database **SQLite** ed è nata come porting di una precedente versione PHP. Oggi è confezionata come **add-on per Home Assistant**, ma gira anche come container Docker standalone o direttamente su una macchina con Node.js (vedi [Installazione](#installazione)).

> **Stato:** progetto personale in sviluppo attivo. Leggi la sezione [Sicurezza](#sicurezza-e-limiti-noti) prima di esporre l'app fuori dalla rete di casa.

---

## Indice

- [Funzionalità](#funzionalità)
- [Stack tecnologico](#stack-tecnologico)
- [Struttura del progetto](#struttura-del-progetto)
- [Installazione](#installazione)
  - [Add-on Home Assistant](#1-add-on-home-assistant)
  - [Docker / Docker Compose](#2-docker--docker-compose)
  - [Esecuzione diretta con Node.js](#3-esecuzione-diretta-con-nodejs)
- [Configurazione](#configurazione)
- [Primo accesso](#primo-accesso)
- [Dati, backup e ripristino](#dati-backup-e-ripristino)
- [Modello dati](#modello-dati)
- [Sviluppo](#sviluppo)
- [Sicurezza e limiti noti](#sicurezza-e-limiti-noti)

---

## Funzionalità

### Dashboard (`/`)
- **Riepilogo:** totale entrate, totale uscite, saldo complessivo, spese del mese corrente e dell'anno corrente.
- **Avanzamento budget:** barre di avanzamento del budget mensile totale e del budget annuale.
- **Avvisi budget per categoria:** segnala le categorie che hanno superato l'80% del budget mensile, in ordine di gravità.
- **Grafici** (Chart.js):
  - entrate e uscite per categoria;
  - andamento giornaliero degli ultimi 30 giorni;
  - entrate e uscite mese per mese dell'anno corrente.
- **Gestione movimenti:**
  - inserimento, modifica ed eliminazione di entrate e uscite;
  - campi: tipo, descrizione, importo, data, categoria, metodo di pagamento, tag;
  - metodi di pagamento: **bancomat**, **contanti**, **carta di credito**;
  - **tag liberi** con suggerimenti basati sui tag già usati;
  - **autocompletamento della descrizione** dai movimenti precedenti;
  - **allegato ricevuta** (immagine o PDF), visualizzabile e rimovibile;
  - indicazione dell'utente della famiglia che ha registrato il movimento;
  - lista completa con paginazione lato client.
- **Carta di credito:**
  - le spese con carta di credito possono restare "da saldare";
  - la dashboard mostra totale e numero dei movimenti non ancora addebitati;
  - **saldo in blocco** per intervallo di date, con la data di partenza precompilata dall'ultimo saldo.

### Report (`/reports`)
- Filtri per **intervallo di date**, **mese** o **anno**.
- Filtri aggiuntivi: metodo di pagamento, tag (multipli), categoria, esclusione delle spese con carta di credito, presenza o assenza di ricevuta.
- Riepilogo entrate, uscite e saldo del periodo.
- Ripartizione per categoria, ripartizione delle uscite e ripartizione giornaliera, confrontate con i budget del periodo.
- **Esportazione CSV** compatibile con Excel (separatore `;`, codifica UTF-8 con BOM).

### Budget (`/settings/budgets`)
- Budget **mensile** per categoria e totale.
- Budget **annuale** totale.
- Budget **annuale per categoria**.

### Categorie (`/settings/categories`)
- Categorie di entrata e di uscita con **colore** e **icona** (Font Awesome).
- Creazione, modifica ed eliminazione.
- Categorie predefinite create al primo avvio:
  - **Uscite:** Cibo, Trasporti, Intrattenimento, Utenze, Shopping, Salute, Casa, Istruzione, Altro.
  - **Entrate:** Stipendio, Freelance, Investimenti, Vendite, Bonus, Rimborsi, Altro.

### Movimenti ricorrenti (`/settings/recurring`)
- Abbonamenti, stipendi e spese fisse con frequenza **giornaliera, settimanale, mensile o annuale**.
- Attivazione e disattivazione senza eliminare la regola.
- Esecuzione automatica: alla prima richiesta HTTP di ogni ora il server crea i movimenti scaduti con la data prevista, li etichetta con il tag `Ricorrente` e porta avanti la prossima scadenza.

### Famiglia / Utenti (`/settings/users`)
- Più utenti per nucleo familiare: tutti vedono e gestiscono gli stessi dati.
- Aggiunta ed eliminazione degli utenti. I dati di un utente eliminato passano a chi lo elimina.

### Profilo e sicurezza
- **Profilo** (`/settings/profile`): modifica del nome visualizzato e della password.
- **Autenticazione a due fattori** (`/settings/mfa`): TOTP compatibile con Google Authenticator, Authy e simili, attivabile tramite QR code.
- Password salvate con **bcrypt**; sono accettati anche gli hash `$2y$` della vecchia versione PHP.

### Backup (`/settings/backup`)
- **Download** di un archivio ZIP con il database SQLite e tutte le ricevute caricate.
- **Ripristino** da un archivio ZIP di CasaDash. Dopo il ripristino il processo termina e deve essere riavviato dal supervisore (Home Assistant, Docker `restart` o systemd).

### Interfaccia
- Tema **scuro e chiaro**, con la preferenza salvata nel browser.
- **PWA**: con `manifest.json` è installabile sulla schermata home dello smartphone.
- Interfaccia in italiano.

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

## Struttura del progetto

```
casadash/
├── config.json             # Manifest dell'add-on Home Assistant
├── Dockerfile              # Immagine usata dall'add-on e da Docker
├── docker-compose.yml      # Avvio standalone con Docker Compose
├── run.sh                  # Entrypoint del container (prepara /data, seed, avvio)
├── seed.js                 # Crea e migra lo schema, crea admin e categorie predefinite
├── drizzle/                # Migrazioni e snapshot drizzle-kit
├── drizzle.config.ts
├── static/                 # manifest PWA, robots.txt
└── src/
    ├── hooks.server.ts     # Sessione utente ed esecuzione dei movimenti ricorrenti
    ├── lib/
    │   ├── categories.ts   # Categorie predefinite (lato client)
    │   └── server/db/      # Connessione SQLite, schema Drizzle
    └── routes/
        ├── +page.*         # Dashboard e azioni sui movimenti
        ├── login/          # Login e verifica MFA
        ├── reports/        # Report e export CSV
        ├── settings/       # budgets, categories, recurring, users, profile, mfa, backup
        ├── api/backup/     # GET: download del backup ZIP
        └── uploads/receipts/[file]/  # Servizio dei file delle ricevute
```

---

## Installazione

In tutte le modalità l'app ha bisogno di:
- un percorso scrivibile per il database SQLite, indicato da `DATABASE_URL`;
- una cartella `uploads/` scrivibile per le ricevute, relativa alla directory di lavoro del processo.

### 1. Add-on Home Assistant

Il repository contiene `config.json` e `Dockerfile` nel formato degli add-on locali di Home Assistant.

1. Copia la cartella del progetto in `/addons/casadash` sull'host di Home Assistant (ad esempio con l'add-on *Samba* o *SSH*).
2. In Home Assistant apri **Impostazioni → Componenti aggiuntivi → Store**, poi **⋮ → Controlla aggiornamenti**.
3. Nella sezione *Add-on locali* apri **CasaDash** e premi **Installa**. La prima build richiede alcuni minuti.
4. Nella scheda **Configurazione** puoi cambiare la porta interna (`port`, predefinita `8099`).
5. Avvia l'add-on e apri `http://<ip-home-assistant>:8081`. La porta 8099 del container è pubblicata sulla porta 8081 dell'host; puoi cambiarla nella scheda *Rete*.

Database e ricevute vengono salvati nella cartella `/data` dell'add-on, quindi sono inclusi nei backup di Home Assistant.

> Ingress non è attivo (`"ingress": false`): l'app si apre sulla porta dedicata, non dal pannello laterale.

### 2. Docker / Docker Compose

```bash
git clone https://github.com/ichigo86x/casadash.git
cd casadash
docker compose up -d --build
```

L'app è disponibile su `http://localhost:8099`. I dati restano nel volume `casadash_data`, montato su `/data`.

Per cambiare porta modifica `docker-compose.yml`:

```yaml
    ports:
      - "8080:8099"        # host:container
```

Oppure, senza Compose:

```bash
docker build -t casadash .
docker run -d --name casadash --restart unless-stopped \
  -p 8099:8099 -v casadash_data:/data casadash
```

Fuori da Home Assistant `run.sh` non trova `/data/options.json` e usa la variabile `PORT`, oppure `8099`.

### 3. Esecuzione diretta con Node.js

Requisiti: **Node.js 24** e gli strumenti di compilazione per i moduli nativi di `better-sqlite3`. Su Linux servono `python3`, `make` e `g++`; su Windows servono i *Build Tools* di Visual Studio.

```bash
git clone https://github.com/ichigo86x/casadash.git
cd casadash
npm install
npm run build

# Linux / macOS
export DATABASE_URL=./data/cdash.db
node seed.js                 # crea lo schema, l'utente admin e le categorie
PORT=8099 HOST=0.0.0.0 node build/index.js
```

Su Windows (PowerShell):

```powershell
$env:DATABASE_URL = "./data/cdash.db"
node seed.js
$env:PORT = "8099"; $env:HOST = "0.0.0.0"; node build/index.js
```

Le ricevute vengono salvate in `./uploads/receipts`, rispetto alla cartella da cui avvii il server.

Per tenerla attiva come servizio usa systemd, pm2 o NSSM su Windows. Il servizio deve riavviarsi automaticamente, perché il ripristino di un backup termina il processo.

---

## Configurazione

| Variabile | Obbligatoria | Default | Descrizione |
|---|---|---|---|
| `DATABASE_URL` | sì | — (`/data/cdash.db` nel container) | Percorso del file SQLite. La cartella viene creata se manca. |
| `PORT` | no | `8099` nel container, `3000` con adapter-node | Porta HTTP. |
| `HOST` | no | `0.0.0.0` nel container | Interfaccia di ascolto. |

Opzioni dell'add-on Home Assistant (`/data/options.json`):

| Opzione | Default | Descrizione |
|---|---|---|
| `port` | `8099` | Porta interna del server. |

Per lo sviluppo copia `.env.example` in `.env` e imposta `DATABASE_URL` con un percorso valido, ad esempio `DATABASE_URL=../data/cdash.db`.

---

## Primo accesso

Al primo avvio, se il database non ha utenti, `seed.js` crea l'account:

- **utente:** `admin`
- **password:** `admin`

**Cambia subito la password** da *Profilo* e valuta l'attivazione della verifica in due passaggi da *MFA*. Gli altri membri della famiglia si aggiungono da *Famiglia*.

---

## Dati, backup e ripristino

| Dato | Container / add-on | Esecuzione diretta |
|---|---|---|
| Database | `/data/cdash.db` | percorso di `DATABASE_URL` |
| Ricevute | `/data/uploads/receipts`, collegata a `/app/uploads` | `./uploads/receipts` |

- **Backup dall'app:** *Backup → Scarica* produce `CasaDash_Backup_AAAA-MM-GG.zip`.
- **Ripristino dall'app:** carica lo ZIP. Il database e le ricevute vengono sovrascritti e il processo si riavvia.
- **Backup a livello di sistema:** copia la cartella `/data` del volume. Nell'add-on è già inclusa negli snapshot di Home Assistant.

Lo schema viene creato e aggiornato all'avvio da `seed.js` e da `src/lib/server/db/index.ts`, che aggiungono le colonne mancanti. I database delle versioni precedenti vengono quindi migrati automaticamente.

---

## Modello dati

| Tabella | Contenuto |
|---|---|
| `users` | username, hash della password, segreto TOTP opzionale, nome visualizzato |
| `transactions` | tipo (`income`/`expense`), descrizione, importo, data, categoria, metodo di pagamento, tag (JSON), ricevuta, stato del saldo della carta di credito, autore |
| `recurring_transactions` | regole ricorrenti: frequenza, prossima scadenza, attiva/disattiva |
| `budgets` | tipo di periodo (`monthly`, `annual`, `annual-category`), anno, mese, categoria (`Totale` = complessivo), importo |
| `categories` | nome, tipo, colore, icona |

---

## Sviluppo

```bash
npm install
cp .env.example .env          # poi imposta DATABASE_URL=../data/cdash.db
DATABASE_URL=../data/cdash.db node seed.js
npm run dev                   # http://localhost:8081
```

| Script | Descrizione |
|---|---|
| `npm run dev` | Server di sviluppo Vite (porta 8081) |
| `npm run build` | Build di produzione in `build/` |
| `npm run preview` | Anteprima della build |
| `npm run check` | Type-check con svelte-check |
| `npm run lint` / `npm run format` | Prettier |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | drizzle-kit |

---

## Sicurezza e limiti noti

CasaDash è pensata per una **rete domestica fidata**. Allo stato attuale:

- **La sessione non è firmata.** Il cookie `auth_user` contiene solo l'ID numerico dell'utente, quindi chi può raggiungere l'app può impersonare un utente.
- **Alcune pagine e azioni non verificano il login lato server.** Tra queste ci sono il caricamento della dashboard, l'eliminazione dei movimenti, l'elenco utenti, le categorie e il servizio delle ricevute.
- **L'account predefinito è `admin` / `admin`.**
- **Il cookie di sessione è `Secure` in produzione.** Su HTTP semplice da un indirizzo diverso da `localhost`, il browser può rifiutarlo e il login non riesce. Usa HTTPS (reverse proxy) o accedi da `localhost`.
- **Il ripristino del backup non convalida i percorsi dentro lo ZIP.** Usa solo archivi generati da CasaDash.

**Non esporre CasaDash su Internet** senza un reverse proxy con HTTPS e un'autenticazione davanti, ad esempio una VPN o Tailscale, finché questi punti non sono risolti.
