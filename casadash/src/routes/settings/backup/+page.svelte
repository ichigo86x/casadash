<svelte:head>
    <title>Backup Dati - CasaDash</title>
</svelte:head>

<script lang="ts">
	import { base } from '$app/paths';
    import { enhance } from '$app/forms';

    let { form } = $props();
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
</div>
