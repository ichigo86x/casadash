# Changelog

## 1.4.1
- Importazione: nella lista da controllare si modifica la descrizione con un clic, prima di importare.
- Importazione: per i doppioni basta passare il mouse sull'etichetta per vedere il movimento già registrato con stessa data e importo (descrizione, importo, categoria, metodo, tag). Un clic apre il dettaglio sotto la riga, comodo anche da telefono.

## 1.4.0

### Novità
- **Importazione dal conto corrente** (menu *Importa*): carica l'export CSV dei movimenti della banca e importa le uscite, e se vuoi anche le entrate.
  - Riconosce da solo separatore, riga di intestazione (anche dopo righe di preambolo), date `gg/mm/aaaa` e importi in formato italiano o inglese.
  - Gestisce un'unica colonna con segno oppure colonne separate per addebiti e accrediti. Le righe di saldo vengono scartate.
  - Prima di importare mostra l'anteprima:
    - categoria suggerita dai movimenti già registrati con la stessa descrizione;
    - doppioni già presenti esclusi, possibili doppioni segnalati;
    - giroconti da marcare come trasferimenti.
  - I movimenti importati ricevono il tag del conto scelto e il tag `Importato`.
  - La mappatura delle colonne viene ricordata per i file successivi con la stessa intestazione.

## 1.3.0

### Novità
- **Trasferimenti tra conti:** i movimenti con il tag `Trasferimento` non contano come entrate o uscite in totali, grafici, budget, previsioni e report. Restano visibili con un badge dedicato e sono riassunti a parte nei report.
- **Conti:** in *Categorie → Conti* indichi i tag che rappresentano i conti (es. `BNL, Poste, Libretto`). La dashboard mostra il saldo di ciascun conto, e i conti compaiono come tag rapidi e come filtro.
- **Obiettivi di risparmio:** nuova pagina *Obiettivi* con importo da raggiungere, scadenza facoltativa, versamenti e prelievi, e quota mensile necessaria.
- **Previsione di fine mese** in dashboard: spese finora, stesso ritmo per i giorni rimanenti e ricorrenti ancora da addebitare, confrontati con il budget mensile. In dashboard compaiono anche gli avvisi sulle categorie oltre l'80% del budget.
- **Report:**
  - confronto con lo stesso periodo dell'anno precedente, sui totali e per categoria;
  - esportazione PDF;
  - tag e trasferimenti inclusi nel CSV.
- **Backup automatici** giornalieri o settimanali, con numero di copie da tenere, esecuzione manuale, download ed eliminazione. Nell'add-on finiscono in `/share/casadash/backups`.
- **Ruoli:** *Amministratore* e *Membro*. Solo gli amministratori gestiscono utenti, backup e ripristino. Dopo l'aggiornamento il primo account creato diventa amministratore e gli altri diventano membri.
- **Ricerca in dashboard:** nuovi filtri per metodo di pagamento, conto e trasferimenti.

### Miglioramenti
- **Dashboard più veloce:** totali e grafici calcolati dal database, e la lista è paginata dal server invece di caricare tutti i movimenti. I filtri della lista restano nell'indirizzo della pagina.
- **Ricorrenti del 31:** tornano al 31 dopo i mesi più corti (31/1 → 28/2 → 31/3). Per i ricorrenti già esistenti il giorno di riferimento è quello della prossima scadenza attuale; modificali per reimpostarlo.
- Ricorrenti, pulizia delle sessioni e backup girano ogni ora in background, anche senza nessuno che apre l'app.
- Report: una categoria presente sia tra le entrate sia tra le uscite (es. *Altro*) non viene più sommata in un'unica voce.

## 1.2.1
- L'add-on scarica l'immagine già pronta da GitHub Container Registry invece di compilarla su Home Assistant. Installazioni e aggiornamenti richiedono pochi secondi.

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
