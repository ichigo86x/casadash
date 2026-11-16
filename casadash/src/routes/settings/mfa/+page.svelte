<script lang="ts">
    import { enhance } from '$app/forms';
    import '../../../app.css';

    let { data, form } = $props();
    let showCodes = $derived(!!form?.recoveryCodes);
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

    {#if showCodes}
        <div class="form-section" style="border-left:4px solid var(--accent-orange, #e67e22); margin-bottom:20px;">
            <h2><i class="fas fa-life-ring"></i> Codici di recupero</h2>
            <p style="color:var(--text-muted);">
                Conservali in un posto sicuro: <strong>non verranno mostrati di nuovo</strong>. Ogni codice funziona una sola volta
                al posto del codice dell'app, se perdi il telefono.
            </p>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px; font-family:monospace; font-size:1.1rem; margin:12px 0;">
                {#each form?.recoveryCodes ?? [] as c}
                    <span style="background:var(--bg-secondary); padding:6px 10px; border-radius:6px; text-align:center;">{c}</span>
                {/each}
            </div>
            <button type="button" class="btn-submit btn-auto btn-secondary" onclick={() => navigator.clipboard?.writeText((form?.recoveryCodes ?? []).join('\n'))}>
                <i class="fas fa-copy"></i> Copia
            </button>
        </div>
    {/if}

    <div class="main-content">
        <div class="form-section">
            {#if data.hasMfa || form?.recoveryCodes}
                <div style="text-align:center;">
                    <div style="margin: 20px 0; color:var(--accent-green); font-size:4rem;">
                        <i class="fas fa-check-circle"></i>
                    </div>
                    <h2>L'Autenticazione a Due Fattori è ATTIVA</h2>
                    <p style="color:var(--text-muted); margin-bottom: 20px;">
                        Codici di recupero rimasti: <strong>{data.recoveryLeft ?? 10}</strong>
                    </p>
                </div>

                <div style="display:flex; gap:30px; flex-wrap:wrap; justify-content:center;">
                    <form method="POST" action="?/regenerate" use:enhance style="min-width:260px;">
                        <h3 style="margin-top:0;">Nuovi codici di recupero</h3>
                        <div class="form-group">
                            <label for="code-regen">Codice dell'app</label>
                            <input type="text" inputmode="numeric" id="code-regen" name="code" required autocomplete="one-time-code" maxlength="7">
                        </div>
                        <button class="btn-submit btn-auto btn-secondary"><i class="fas fa-sync"></i> Rigenera</button>
                    </form>

                    <form method="POST" action="?/disable" use:enhance={({ cancel }) => { if (!confirm('Disattivare la verifica in due passaggi?')) cancel(); }} style="min-width:260px;">
                        <h3 style="margin-top:0;">Disattiva MFA</h3>
                        <div class="form-group">
                            <label for="pw-disable">Password</label>
                            <input type="password" id="pw-disable" name="password" required autocomplete="current-password">
                        </div>
                        <div class="form-group">
                            <label for="code-disable">Codice dell'app o di recupero</label>
                            <input type="text" id="code-disable" name="code" required autocomplete="one-time-code">
                        </div>
                        <button class="delete-btn" style="padding:10px 20px; font-weight:600;">
                            <i class="fas fa-lock-open"></i> Disattiva MFA
                        </button>
                    </form>
                </div>
            {:else}
                <div style="text-align:center;">
                    <h2>Abilita MFA con Google Authenticator</h2>
                    <p style="color:var(--text-muted); margin-bottom: 20px;">
                        1. Scarica e apri Google Authenticator (o simili) sul tuo smartphone.<br>
                        2. Scansiona il codice QR sottostante.<br>
                        3. Inserisci il codice a 6 cifre per confermare: riceverai i codici di recupero.
                    </p>

                    <div style="background:white; padding:15px; display:inline-block; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.1); margin-bottom:20px;">
                        <img src={data.qrCodeUrl} alt="QR Code" style="width:200px; height:200px;">
                    </div>
                    <p style="font-size:0.8rem; color:var(--text-muted);">Se non puoi scansionare il QR, inserisci a mano: <code>{data.secret}</code></p>

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
                </div>
            {/if}
        </div>
    </div>
</div>
