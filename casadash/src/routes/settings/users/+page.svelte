<script lang="ts">
    import { enhance } from '$app/forms';
    import '../../../app.css';

    let { data, form } = $props();
</script>

<div class="container">
    <div class="page-header">
        <h1><i class="fas fa-users"></i> Gestione Familiari</h1>
        <p class="page-subtitle">Aggiungi membri al tuo CasaDash (Registrazioni pubbliche disabilitate)</p>
    </div>

    {#if form?.error}
        <div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;">
            <i class="fas fa-exclamation-circle"></i> {form.error}
        </div>
    {/if}

    <div class="main-content">
        <div class="form-section">
            <h2><i class="fas fa-user-plus"></i> Nuovo Utente</h2>
            <form method="POST" action="?/addUser" use:enhance>
                <div class="form-group">
                    <label for="username">Username (per il login)</label>
                    <input type="text" id="username" name="username" required placeholder="Es. giulia" pattern="[a-zA-Z0-9_\-]+" title="Solo lettere, numeri, trattini">
                </div>
                <div class="form-group">
                    <label for="display_name">Nome Visualizzato</label>
                    <input type="text" id="display_name" name="display_name" required placeholder="Es. Giulia">
                </div>
                <div class="form-group">
                    <label for="password">Password Iniziale</label>
                    <input type="password" id="password" name="password" required minlength="6" placeholder="Min. 6 caratteri">
                </div>
                <button type="submit" class="btn-submit">
                    <i class="fas fa-save"></i> Crea Profilo
                </button>
            </form>
        </div>

        <div class="recent-transactions">
            <h2><i class="fas fa-list"></i> Utenti Esistenti</h2>
            <div class="table-responsive" style="margin-top:20px;">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Username</th>
                            <th>MFA</th>
                            <th>Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each data.users as u}
                            <tr>
                                <td><i class="fas fa-user-circle"></i> {u.displayName}</td>
                                <td><span style="font-family:monospace; background:var(--bg-secondary); padding:2px 8px; border-radius:4px;">{u.username}</span></td>
                                <td>
                                    {#if u.hasMfa}
                                        <span style="color:var(--accent-green); font-weight:600;"><i class="fas fa-shield-alt"></i> Attivo</span>
                                    {:else}
                                        <span style="color:var(--text-muted);"><i class="fas fa-shield-alt"></i> No</span>
                                    {/if}
                                </td>
                                <td>
                                    {#if u.id !== data?.user?.id}
                                        <form method="POST" action="?/deleteUser" use:enhance={({ cancel }) => { if(!confirm('Sei sicuro di voler eliminare questo utente? Tutte le sue associazioni andranno forzatamente a te.')) cancel(); }} class="inline">
                                            <input type="hidden" name="id" value={u.id}>
                                            <button class="delete-btn" title="Elimina Utente">
                                                <i class="fas fa-trash-alt"></i>
                                            </button>
                                        </form>
                                    {:else}
                                        <span style="color:var(--text-muted); font-size:0.8rem;">(Tu)</span>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>
