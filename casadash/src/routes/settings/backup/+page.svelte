<svelte:head>
    <title>Backup Dati - CasaDash</title>
</svelte:head>

<script lang="ts">
	import { base } from '$app/paths';
    import { enhance } from '$app/forms';

    let { data, form } = $props();
    const formatSize = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
    const formatWhen = (iso: string) => new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    let restoring = $state(false);
</script>

<div class="container" style="max-width:800px; margin:20px auto; display:flex; flex-direction:column; gap:20px;">
    <h2><i class="fas fa-archive"></i> Gestione Dati & Backup</h2>

    {#if form?.error}
        <div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:15px; border-radius:8px; font-weight:500;">
            <i class="fas fa-exclamation-triangle"></i> {form.error}
        </div>
    {/if}

    {#if form?.success}
        <div class="success-msg" style="background:var(--accent-green-glow); color:var(--accent-green); padding:15px; border-radius:8px; font-weight:500; font-size:1.1rem; text-align:center;">
            <p><i class="fas fa-check-circle" style="font-size:2rem; margin-bottom:10px; display:block;"></i></p>
            <p><strong>Ripristino Completato con Successo!</strong></p>
            <p style="margin-top:5px; font-size:0.9rem;">L'applicazione si sta riavviando sul server. Ricarica la pagina tra pochi secondi.</p>
        </div>
    {/if}

    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:20px;">
        
        <!-- Esporta Backup Box -->
        <div class="budget-card" style="padding:25px; border-radius:12px;">
            <h3 style="margin-top:0; color:var(--accent-blue);"><i class="fas fa-download"></i> Esporta Archivi</h3>
            <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.5; margin-bottom:20px;">
                Scarica interamente tutto il database SQLite e le foto degli Scontrini o Ricevute caricate in un unico file zippato. Salvalo in un luogo sicuro.
            </p>
            
            <a href="{base}/api/backup" target="_blank" class="btn-submit" style="display:inline-block; text-align:center; text-decoration:none; background:var(--accent-blue-light); color:var(--text-primary); transition:transform 0.2s;">
                <i class="fas fa-cloud-download-alt"></i> Scarica Archivio ZIP
            </a>
        </div>

        <!-- Ripristina Backup Box -->
        <div class="budget-card" style="padding:25px; border-radius:12px; border-left:4px solid var(--accent-red);">
            <h3 style="margin-top:0; color:var(--accent-red);"><i class="fas fa-upload"></i> Ripristino Distruttivo</h3>
            <p style="color:var(--text-muted); font-size:0.9rem; line-height:1.5; margin-bottom:20px;">
                Carica un file `<span style="font-family:monospace">.zip</span>` estratto in precedenza. <strong>Attenzione:</strong> Questo eliminerà e sovrascriverà tutti i dati attuali con quelli contenuti nell'archivio.
            </p>

            {#if !form?.success}
            <form method="POST" action="?/restore" enctype="multipart/form-data" use:enhance={() => { restoring = true; return async ({ update }) => { await update(); restoring = false; }; }}>
                <div class="form-group" style="margin-bottom:15px;">
                    <input type="file" name="backup" accept=".zip" required style="background:var(--bg-input); padding:10px; border-radius:8px; width:100%; color:var(--text-primary); border:1px solid var(--border-color);">
                </div>
                
                <button type="submit" class="btn-submit" style="background:var(--accent-red); opacity: {restoring ? '0.6' : '1'}; transition:transform 0.2s;" disabled={restoring}>
                    {#if restoring}
                        <i class="fas fa-spinner fa-spin"></i> Ripristino & Riavvio in corso...
                    {:else}
                        <i class="fas fa-radiation"></i> Esegui Sovrascrittura e Ripristina
                    {/if}
                </button>
            </form>
            {/if}
        </div>
    </div>

    <!-- Automatic backups -->
    <div class="budget-card" style="padding:25px; border-radius:12px;">
        <h3 style="margin-top:0; color:var(--accent-blue);"><i class="fas fa-clock"></i> Backup automatici</h3>
        {#if form?.scheduleSaved}<p style="color:var(--accent-green);"><i class="fas fa-check"></i> Pianificazione salvata.</p>{/if}
        {#if form?.backupCreated}<p style="color:var(--accent-green);"><i class="fas fa-check"></i> Creato {form.backupCreated}.</p>{/if}
        <form method="POST" action="?/saveSchedule" use:enhance={() => async ({ update }) => update({ reset: false })} style="display:flex; gap:15px; flex-wrap:wrap; align-items:flex-end;">
            <label style="display:flex; gap:8px; align-items:center;">
                <input type="checkbox" name="enabled" checked={data.schedule.enabled}> Attivi
            </label>
            <div class="form-group" style="margin:0;">
                <label for="frequency">Frequenza</label>
                <select id="frequency" name="frequency" value={data.schedule.frequency}>
                    <option value="daily">Ogni giorno</option>
                    <option value="weekly">Ogni settimana</option>
                </select>
            </div>
            <div class="form-group" style="margin:0;">
                <label for="keep">Copie da tenere</label>
                <input id="keep" type="number" name="keep" min="1" max="100" value={data.schedule.keep} style="width:90px;">
            </div>
            <button type="submit" class="btn-submit" style="width:auto;"><i class="fas fa-save"></i> Salva</button>
        </form>
        <p style="color:var(--text-muted); font-size:0.85rem; margin-top:12px;">
            Cartella: <code>{data.backupDir}</code>
            {#if data.lastBackup} · Ultimo backup automatico: {formatWhen(data.lastBackup)}{/if}
        </p>

        <form method="POST" action="?/runNow" use:enhance style="margin-top:10px;">
            <button type="submit" class="btn-submit" style="width:auto; background:var(--accent-blue-light); color:var(--text-primary);"><i class="fas fa-play"></i> Esegui backup ora</button>
        </form>

        {#if data.backups.length > 0}
        <div class="table-responsive" style="margin-top:20px;">
            <table>
                <thead><tr><th>File</th><th>Data</th><th>Dimensione</th><th>Azioni</th></tr></thead>
                <tbody>
                    {#each data.backups as b}
                    <tr>
                        <td style="font-family:monospace; font-size:0.8rem;">{b.name}</td>
                        <td>{formatWhen(b.createdAt)}</td>
                        <td>{formatSize(b.size)}</td>
                        <td style="display:flex; gap:8px;">
                            <a href="{base}/api/backup/files/{b.name}" title="Scarica" data-sveltekit-reload><i class="fas fa-download"></i></a>
                            <form method="POST" action="?/deleteBackup" use:enhance={({ cancel }) => { if (!confirm(`Eliminare ${b.name}?`)) cancel(); }} style="margin:0;">
                                <input type="hidden" name="name" value={b.name}>
                                <button class="delete-btn" title="Elimina"><i class="fas fa-trash-alt"></i></button>
                            </form>
                        </td>
                    </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        {/if}
    </div>
</div>
