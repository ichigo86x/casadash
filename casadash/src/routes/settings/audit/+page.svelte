<script lang="ts">
    import '../../../app.css';

    let { data } = $props();

    const labels: Record<string, string> = {
        'login.ok': 'Accesso',
        'login.failed': 'Accesso fallito',
        'mfa.failed': 'Codice MFA errato',
        'mfa.enabled': 'MFA attivata',
        'mfa.disabled': 'MFA disattivata',
        'mfa.recovery_regenerated': 'Nuovi codici di recupero',
        'password.changed': 'Password cambiata',
        'sessions.revoked_all': 'Altri dispositivi disconnessi',
        'user.created': 'Utente creato',
        'user.deleted': 'Utente eliminato',
        'user.role': 'Ruolo modificato',
        'user.password_reset': 'Password reimpostata',
        'user.mfa_reset': 'MFA reimpostata',
        'transaction.deleted': 'Movimento eliminato',
        'transaction.bulk_deleted': 'Eliminazione in blocco',
        'transaction.restored': 'Movimenti ripristinati',
        'backup.restored': 'Backup ripristinato',
        'sensor_token.created': 'Token sensori creato',
        'bank.connected': 'Banca collegata',
        'bank.disconnected': 'Banca scollegata',
        'import.done': 'Importazione',
        'import.undone': 'Importazione annullata',
        'import.edited': 'Importazione modificata',
        'import.replaced': 'Movimenti sostituiti da importazione',
        'transaction.replaced': 'Movimento sostituito',
        'bank.conflict_resolved': 'Possibile doppione risolto'
    };
    const warn = (a: string) => a.endsWith('failed') || a.includes('reset') || a.includes('restored') || a.includes('deleted') || a.includes('disabled');
</script>

<div class="container">
    <div class="page-header">
        <h1><i class="fas fa-clipboard-list"></i> Registro attività</h1>
        <p class="page-subtitle">Ultimi 300 eventi di sicurezza e modifiche sensibili. Conservati per un anno.</p>
    </div>

    <div class="recent-transactions">
        <div class="table-responsive">
            <table class="table">
                <thead><tr><th>Quando</th><th>Utente</th><th>Evento</th><th>Dettaglio</th><th>Indirizzo</th></tr></thead>
                <tbody>
                    {#each data.entries as e}
                        <tr>
                            <td style="white-space:nowrap;">{new Date(e.at).toLocaleString('it-IT')}</td>
                            <td>{e.username || '-'}</td>
                            <td style="{warn(e.action) ? 'color:var(--accent-red); font-weight:600;' : ''}">{labels[e.action] || e.action}</td>
                            <td>{e.detail || ''}</td>
                            <td>{e.ip || ''}</td>
                        </tr>
                    {:else}
                        <tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Nessun evento registrato.</td></tr>
                    {/each}
                </tbody>
            </table>
        </div>
    </div>
</div>
