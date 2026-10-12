# Changelog

## 1.2.0

### Correzioni
- Movimenti ricorrenti a fine mese: il 31 gennaio + 1 mese ora dà il 28/29 febbraio. Prima diventava il 3 marzo.
- Movimenti ricorrenti saltati, ad esempio con l'app spenta per settimane: ora vengono registrati tutti, uno per ogni scadenza. Prima ne veniva creato uno all'ora.
- Una frequenza non valida non genera più lo stesso movimento ogni ora.
- Date calcolate nel fuso orario locale invece che in UTC:
  - data predefinita di un nuovo movimento;
  - grafico degli ultimi 30 giorni;
  - intervallo predefinito dei report, che prima partiva dall'ultimo giorno del mese precedente;
  - nomi dei file di backup e CSV.

### Manutenzione
- Rimossi file non usati (`src/lib/categories.ts`, `src/lib/server/db/seed.ts`). Le categorie predefinite sono definite solo in `seed.js`.
- Nessun errore di type-check (`npm run check`).

## 1.1.0

### Sicurezza
- Sessioni lato server con token casuale (cookie `casadash_session`) al posto del cookie con l'ID utente in chiaro. Dopo l'aggiornamento tutti devono rifare l'accesso.
- Tutte le pagine e le API richiedono l'accesso, comprese le ricevute e il backup.
- La verifica MFA è legata a un token temporaneo di 5 minuti e non più a un ID inviato dal browser.
- Blocco di 15 minuti dopo 5 tentativi di accesso falliti.
- Cambio password obbligatorio per l'account predefinito `admin`/`admin` e per gli utenti creati da un altro membro.
- Al cambio password vengono disconnessi gli altri dispositivi.
- La pagina Famiglia non invia più al browser i segreti TOTP.
- Il ripristino dei backup verifica che l'archivio contenga un database SQLite e rifiuta i percorsi che escono dalla cartella uploads.
- Gli allegati accettano solo immagini e PDF.
- Il flag `Secure` del cookie dipende dal protocollo (`COOKIE_SECURE=auto`): il login funziona anche in HTTP sulla rete locale.

### Home Assistant
- Supporto Ingress: CasaDash si apre dal pannello laterale.
- Porta diretta disattivata di default; si abilita dalla scheda *Rete*.
- Watchdog sulla porta 8099.
- Architetture supportate: `amd64`, `aarch64`.
- Repository add-on installabile da URL.

### Installazione
- Un solo launcher (`start.mjs`, `npm start`) per add-on, Docker e installazione diretta.
- Riavvio automatico dopo il ripristino di un backup, anche fuori da Docker.
- Variabile `DATA_DIR` per database e ricevute.
- Upload fino a 100 MB (`BODY_SIZE_LIMIT`), prima limitati a 512 KB.
- Immagine Docker multi-stage più leggera, pubblicabile su GHCR.
- Backup del database con l'API di backup online di SQLite.
- Icone PWA corrette (192 e 512 px).

## 1.0.0
- Prima versione SvelteKit, porting dalla versione PHP.
