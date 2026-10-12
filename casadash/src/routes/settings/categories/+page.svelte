<script lang="ts">
    import { enhance } from '$app/forms';
    import '../../../app.css';

    let { data } = $props();

    let icons = [
        'fa-tag', 'fa-utensils', 'fa-car', 'fa-film', 'fa-bolt', 
        'fa-shopping-bag', 'fa-heartbeat', 'fa-home', 'fa-graduation-cap', 
        'fa-briefcase', 'fa-laptop-code', 'fa-chart-line', 'fa-store', 
        'fa-gift', 'fa-plane', 'fa-receipt', 'fa-coffee', 'fa-gamepad'
    ];

    let editingCategory: any = $state(null);
    function editCategory(c: any) { editingCategory = { ...c }; }
    function closeEdit() { editingCategory = null; }
</script>

<div class="container">
    <div class="page-header">
        <h1><i class="fas fa-tags"></i> Gestione Categorie</h1>
        <p class="page-subtitle">Aggiungi o rimuovi categorie personalizzate</p>
    </div>

    <div class="main-content">
        <div class="form-section">
            <h2><i class="fas fa-plus-circle"></i> Nuova Categoria</h2>
            <form method="POST" action="?/addCategory" use:enhance>
                <div class="form-row">
                    <div class="form-group">
                        <label for="name">Nome</label>
                        <input type="text" id="name" name="name" required placeholder="Es. Palestra">
                    </div>
                    <div class="form-group">
                        <label for="type">Tipo</label>
                        <select id="type" name="type" required>
                            <option value="expense">Uscita</option>
                            <option value="income">Entrata</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="color">Colore</label>
                        <input type="color" id="color" name="color" value="#4895ef" style="height: 48px; cursor: pointer;">
                    </div>
                    <div class="form-group">
                        <label for="icon">Icona (FontAwesome)</label>
                        <select id="icon" name="icon">
                            {#each icons as ic}
                                <option value={ic}>{ic.replace('fa-', '')}</option>
                            {/each}
                        </select>
                    </div>
                </div>
                <button type="submit" class="btn-submit">
                    <i class="fas fa-save"></i> Crea Categoria
                </button>
            </form>
        </div>

        <div class="recent-transactions">
            <h2><i class="fas fa-list"></i> Categorie Attive</h2>
            <div class="category-list" style="margin-top:20px;">
                {#each data.categories as cat}
                    <div class="category-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border-color);">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div style="width:36px; height:36px; border-radius:99px; background-color:{cat.color}; color:white; display:flex; align-items:center; justify-content:center;">
                                <i class="fas {cat.icon}"></i>
                            </div>
                            <div>
                                <div style="font-weight:600;">{cat.name}</div>
                                <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">
                                    {cat.type === 'income' ? 'Entrata' : 'Uscita'}
                                </div>
                            </div>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button type="button" onclick={() => editCategory(cat)} style="padding:6px 10px; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;"><i class="fas fa-edit"></i></button>
                            <form method="POST" action="?/deleteCategory" use:enhance={({ cancel }) => { if(!confirm('Vuoi davvero cancellare questa categoria? Verra spostato tutto in Altro.')) cancel(); }} style="margin:0;">
                                <input type="hidden" name="id" value={cat.id}>
                                <button type="submit" class="delete-btn" style="padding:6px 10px;"><i class="fas fa-trash-alt"></i></button>
                            </form>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    </div>

    <!-- Accounts are plain tags: their balance is shown on the dashboard -->
    <div class="form-section" style="margin-top:30px;">
        <h2><i class="fas fa-university"></i> Conti</h2>
        <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:15px;">
            Elenca i tag che indicano dove sono i soldi, separati da virgola. Ad esempio: <code>BNL, Poste, Libretto</code>.
            La dashboard mostra il saldo di ogni conto e li offre come tag rapidi.
            Per spostare soldi tra due conti registra un'uscita dal primo e un'entrata nel secondo, entrambe con il tag <strong>Trasferimento</strong>:
            cambiano i saldi dei conti ma non contano come entrate o uscite.
        </p>
        <form method="POST" action="?/setAccounts" use:enhance={() => async ({ update }) => update({ reset: false })} style="display:flex; gap:10px; flex-wrap:wrap;">
            <input type="text" name="accounts" value={data.accountTags.join(', ')} placeholder="BNL, Poste, Libretto" style="flex:1; min-width:220px;">
            <button type="submit" class="btn-submit" style="width:auto;"><i class="fas fa-save"></i> Salva conti</button>
        </form>
    </div>
</div>

<!-- Edit Category Modal -->
{#if editingCategory}
<div class="modal-backdrop" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px;">
    <div class="modal-content" style="background:var(--bg-color); width:100%; max-width:500px; border-radius:12px; padding:25px; box-shadow:0 10px 30px rgba(0,0,0,0.3);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <h2 style="margin:0; font-size:1.3rem;"><i class="fas fa-edit"></i> Modifica Categoria</h2>
            <button onclick={closeEdit} style="background:none; border:none; font-size:1.5rem; color:var(--text-muted); cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>

        <form method="POST" action="?/editCategory" use:enhance onsubmit={closeEdit}>
            <input type="hidden" name="id" value={editingCategory.id}>
            
            <div class="form-group" style="margin-bottom:15px;">
                <label>Nome Categoria</label>
                <input type="text" name="name" required bind:value={editingCategory.name}>
            </div>

            <div class="form-row" style="display:flex; gap:15px; margin-bottom:15px;">
                <div class="form-group" style="flex:1;">
                    <label>Colore</label>
                    <input type="color" name="color" bind:value={editingCategory.color} style="height:48px; width:100%; cursor:pointer;">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Icona</label>
                    <select name="icon" bind:value={editingCategory.icon}>
                        {#each icons as ic}
                            <option value={ic}>{ic.replace('fa-', '')}</option>
                        {/each}
                    </select>
                </div>
            </div>

            <div style="background:rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.3); padding:10px; border-radius:6px; font-size:0.85rem; color:var(--text-muted); margin-bottom:20px;">
                <i class="fas fa-exclamation-triangle" style="color:var(--accent-red);"></i> 
                Modificando il nome, tutte le transazioni passate legate a questa categoria verranno aggiornate per mantenere la coerenza storica.
            </div>

            <button type="submit" class="btn-submit" style="width:100%;">
                <i class="fas fa-save"></i> Salva Modifiche
            </button>
        </form>
    </div>
</div>
{/if}
