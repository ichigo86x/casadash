<script lang="ts">
    import { enhance } from '$app/forms';
    import '../../../app.css';

    let { data, form } = $props();
</script>

<div class="container">
    <div class="page-header">
        <h1><i class="fas fa-shield-alt"></i> Sicurezza (MFA)</h1>
        <p class="page-subtitle">Proteggi il tuo account con l'Autenticazione a Due Fattori</p>
    </div>

    {#if form?.error}
        <div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;">
            <i class="fas fa-exclamation-circle"></i> {form.error}
        </div>
    {/if}

    <div class="main-content">
        <div class="form-section">
            <div style="text-align:center;">
                {#if data.hasMfa}
                    <div style="margin: 30px 0; color:var(--accent-green); font-size:4rem;">
                        <i class="fas fa-check-circle"></i>
                    </div>
                    <h2>L'Autenticazione a Due Fattori è ATTIVA</h2>
                    <p style="color:var(--text-muted); margin-bottom: 20px;">Il tuo account è protetto a livello bancario contro accessi non autorizzati.</p>
                    
                    <form method="POST" action="?/disable" use:enhance>
                        <button class="delete-btn" style="padding:10px 20px; font-weight:600;">
                            <i class="fas fa-lock-open"></i> Disattiva MFA
                        </button>
                    </form>
                {:else}
                    <h2>Abilita MFA con Google Authenticator</h2>
                    <p style="color:var(--text-muted); margin-bottom: 20px;">
                        1. Scarica e apri Google Authenticator sul tuo smartphone.<br>
                        2. Scansiona il codice QR sottostante.<br>
                        3. Inserisci il codice a 6 cifre per confermare.
                    </p>

                    <div style="background:white; padding:15px; display:inline-block; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.1); margin-bottom:20px;">
                        <img src={data.qrCodeUrl} alt="QR Code" style="width:200px; height:200px;">
                    </div>
                    
                    <form method="POST" action="?/enable" use:enhance style="max-width:300px; margin: 0 auto; text-align:left;">
                        <input type="hidden" name="secret" value={data.secret}>
                        <div class="form-group">
                            <label for="code">Codice a 6 cifre</label>
                            <input type="text" inputmode="numeric" id="code" name="code" placeholder="Es. 123 456" pattern="[0-9 ]+" maxlength="7" required style="font-size:1.5rem; text-align:center; letter-spacing:8px;">
                        </div>
                        <button type="submit" class="btn-submit btn-primary-action">
                            <i class="fas fa-shield-alt"></i> Conferma & Attiva
                        </button>
                    </form>
                {/if}
            </div>
        </div>
    </div>
</div>
