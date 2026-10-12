<script lang="ts">
    import { page } from '$app/stores';
</script>

<div class="container" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:70vh; text-align:center;">
    <div style="font-size:4rem; color:var(--accent-red); margin-bottom:20px;">
        <i class="fas fa-exclamation-triangle"></i>
    </div>
    <h1 style="color:var(--text-primary); margin-bottom:10px;">Doh! Si è verificato un errore</h1>
    
    <div style="background:var(--bg-card); border:1px solid var(--border-color); padding:20px; border-radius:12px; margin-bottom:30px; max-width:600px; text-align:left;">
        <p style="color:var(--text-muted); font-size:1.1rem; margin-bottom:0;">
            {#if $page.status === 404}
                La pagina che stavi cercando non esiste o è stata spostata. (Errore 404)
            {:else}
                {$page.error?.message || "Impossibile completare la richiesta. Riprova più tardi."}
                <br><br>
                <span style="font-size:0.85rem; color:var(--text-muted);"><i class="fas fa-info-circle"></i> I log dettagliati sono stati generati nella console del server (sezione Gestione Errori).</span>
            {/if}
        </p>
    </div>

    <a href="/" class="btn-primary" style="text-decoration:none; padding:15px 30px; border-radius:8px; font-weight:600; display:inline-flex; align-items:center; gap:10px;">
        <i class="fas fa-home"></i> Torna alla Dashboard
    </a>
</div>
