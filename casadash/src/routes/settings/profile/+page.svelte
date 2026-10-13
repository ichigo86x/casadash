<script lang="ts">
    import { enhance } from '$app/forms';
    import '../../../app.css';

    let { data, form } = $props();
</script>

<div class="container">
    <div class="page-header">
        <h1><i class="fas fa-user-cog"></i> Il Tuo Profilo</h1>
        <p class="page-subtitle">Modifica il tuo nome visualizzato e aggiorna la password di sicurezza</p>
    </div>

    {#if data.user?.mustChangePassword}
        <div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:var(--radius-sm); margin-bottom:20px; border: 1px solid rgba(231,76,60,0.2);">
            <i class="fas fa-key"></i> Per continuare devi impostare una nuova password personale.
        </div>
    {/if}

    {#if form?.error}
        <div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:var(--radius-sm); margin-bottom:20px; border: 1px solid rgba(231,76,60,0.2);">
            <i class="fas fa-exclamation-circle"></i> {form.error}
        </div>
    {/if}

    {#if form?.success}
        <div class="success-msg" style="background:rgba(46,204,113,0.1); color:var(--accent-green); padding:12px; border-radius:var(--radius-sm); margin-bottom:20px; border: 1px solid rgba(46,204,113,0.3);">
            <i class="fas fa-check-circle"></i> Password aggiornata con successo!
        </div>
    {/if}

    {#if form?.profileSuccess}
        <div class="success-msg" style="background:rgba(46,204,113,0.1); color:var(--accent-green); padding:12px; border-radius:var(--radius-sm); margin-bottom:20px; border: 1px solid rgba(46,204,113,0.3);">
            <i class="fas fa-check-circle"></i> Nome visualizzato aggiornato! Ricarica o procedi per visualizzarlo in alto.
        </div>
    {/if}

    <div class="main-content" style="display:flex; flex-direction:row; gap:20px; flex-wrap:wrap;">
        
        <!-- General Profile Box -->
        <div class="form-section" style="flex:1; min-width:300px;">
            <h2><i class="fas fa-id-badge"></i> Dati Personali</h2>
            <form method="POST" action="?/updateName" use:enhance>
                <div class="form-group">
                    <label for="username">Username (Non Modificabile)</label>
                    <input type="text" id="username" disabled value={data.user?.username} style="background:var(--bg-secondary); color:var(--text-muted); cursor:not-allowed;">
                </div>
                <div class="form-group">
                    <label for="display_name">Nome Visualizzato</label>
                    <input type="text" id="display_name" name="display_name" required value={data.user?.displayName}>
                </div>
                <button type="submit" class="btn-submit btn-primary-action">
                    <i class="fas fa-save"></i> Aggiorna Nome
                </button>
            </form>
        </div>

        <!-- Security / Password Box -->
        <div class="form-section" style="flex:1; min-width:300px;">
            <h2><i class="fas fa-lock"></i> Sicurezza Profilo</h2>
            <form method="POST" action="?/updatePassword" use:enhance>
                <div class="form-group">
                    <label for="current_password">Password Attuale</label>
                    <input type="password" id="current_password" name="current_password" required placeholder="Inserisci la password attuale">
                </div>
                
                <hr style="border:0; border-top:1px solid var(--border-color); margin:15px 0;">

                <div class="form-group">
                    <label for="new_password">Nuova Password</label>
                    <input type="password" id="new_password" name="new_password" required minlength="6" placeholder="Minimo 6 caratteri">
                </div>
                <div class="form-group">
                    <label for="confirm_password">Conferma Nuova Password</label>
                    <input type="password" id="confirm_password" name="confirm_password" required placeholder="Ripeti la nuova password">
                </div>
                
                <button type="submit" class="btn-submit btn-primary-action">
                    <i class="fas fa-key"></i> Cambia Password
                </button>
            </form>
        </div>

    </div>

    <!-- Automatic sign-in from the Home Assistant sidebar -->
    <div class="form-section" style="margin-top:30px;">
        <h2><i class="fas fa-home"></i> Accesso da Home Assistant</h2>
        {#if form?.haSaved}<p style="color:var(--accent-green);"><i class="fas fa-check"></i> Impostazione salvata.</p>{/if}
        {#if data.haUser}
            {#if data.haLinkedToThis}
                <p>Il tuo account è collegato all'utente Home Assistant <strong>{data.haUser.displayName || data.haUser.name}</strong>: aprendo CasaDash dalla barra laterale entri senza password.</p>
                <form method="POST" action="?/unlinkHa" use:enhance><button class="btn-submit btn-auto btn-secondary"><i class="fas fa-unlink"></i> Scollega</button></form>
            {:else}
                <p>Stai usando CasaDash come utente Home Assistant <strong>{data.haUser.displayName || data.haUser.name}</strong>. Collegalo al tuo account per entrare dalla barra laterale senza password.</p>
                <form method="POST" action="?/linkHa" use:enhance><button class="btn-submit btn-auto btn-primary-action"><i class="fas fa-link"></i> Collega a {data.user?.displayName}</button></form>
            {/if}
        {:else}
            <p style="color:var(--text-muted);">
                {#if data.haLinked}
                    Il tuo account è collegato a un utente Home Assistant.
                    <form method="POST" action="?/unlinkHa" use:enhance style="display:inline;"><button class="btn-submit btn-auto btn-secondary">Scollega</button></form>
                {:else}
                    Disponibile nell'add-on: apri CasaDash dalla barra laterale di Home Assistant e torna in questa pagina per collegare il tuo utente.
                {/if}
            </p>
        {/if}
    </div>
</div>
