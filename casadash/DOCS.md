# CasaDash

Gestione del budget familiare: entrate e uscite, budget per categoria, movimenti ricorrenti, report con export CSV, più utenti con verifica in due passaggi.

## Primo avvio

1. Avvia l'add-on e apri **CasaDash** dal pannello laterale.
2. Accedi con `admin` / `admin`.
3. CasaDash ti chiede subito una nuova password.
4. Aggiungi gli altri membri da **Famiglia**. Al primo accesso dovranno scegliere una password personale.

## Accesso

- **Ingress (consigliato):** dal pannello laterale di Home Assistant, senza aprire porte.
- **Porta diretta (opzionale):** nella scheda **Rete** imposta una porta host per `8099/tcp`, poi apri `http://<ip-home-assistant>:<porta>`. È utile per installare l'app sullo smartphone come PWA.

L'accesso a CasaDash è separato da quello di Home Assistant: anche via Ingress serve il login di CasaDash.

## Conti e trasferimenti

1. In **Categorie → Conti** elenca i tag dei tuoi conti, ad esempio `BNL, Poste, Libretto`.
2. Aggiungi a ogni movimento il tag del conto da cui escono o in cui entrano i soldi.
3. Per spostare soldi da un conto all'altro registra due movimenti, entrambi con il tag **Trasferimento**:
   - un'uscita con il tag del conto di partenza (es. `BNL`);
   - un'entrata con il tag del conto di arrivo (es. `Libretto`).

I trasferimenti aggiornano i saldi dei conti ma non contano come entrate o uscite.

Per impostare il saldo iniziale di un conto, registra un'entrata con il tag del conto e il tag **Trasferimento**: così non risulta come un'entrata.

## Ruoli

- **Amministratore:** gestisce utenti, backup e ripristino.
- **Membro:** gestisce movimenti, budget, categorie, ricorrenti e obiettivi.

## Dati e backup

Database e ricevute sono salvati nella cartella `/data` dell'add-on, che è inclusa nei backup di Home Assistant.

In **Dati → Backup automatici** puoi pianificare un backup giornaliero o settimanale. I file vengono salvati in `/share/casadash/backups`, raggiungibile anche con l'add-on Samba, e restano anche se disinstalli CasaDash.

Puoi anche scaricare un archivio ZIP da **Backup** dentro CasaDash e ripristinarlo su un'altra installazione: add-on, Docker o installazione diretta.

## Aggiornamento dalla versione 1.0.0

- Tutti gli utenti devono rifare l'accesso.
- Se l'account `admin` usa ancora la password `admin`, al prossimo accesso viene chiesto di cambiarla.
- La porta diretta è ora disattivata di default. Se usavi `http://<ip>:8081`, riattivala dalla scheda **Rete**.
