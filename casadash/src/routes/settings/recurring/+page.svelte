<script lang="ts">
	import { localDateString } from '$lib/dates';
    import { enhance } from '$app/forms';
    import { fly } from 'svelte/transition';

    let { data } = $props();

    let formType = $state('expense');
    let incomeCategories = $derived(data.categories.filter((c: any) => c.type === 'income'));
    let expenseCategories = $derived(data.categories.filter((c: any) => c.type === 'expense'));

    let formatEuro = (amount: number) => '€' + amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let formatDate = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    };

    let frequencyMap: Record<string, string> = {
        'daily': 'Giornaliero',
        'weekly': 'Settimanale',
        'monthly': 'Mensile',
        'yearly': 'Annuale'
    };

    let currentTags: string[] = $state([]);
	function handleTagInput(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			const val = (e.target as HTMLInputElement).value.trim();
			if (val && !currentTags.includes(val)) currentTags.push(val);
			(e.target as HTMLInputElement).value = '';
		}
	}

    let editingId: number | null = $state(null);
    let editingJob = $state<any>(null);

    function startEdit(job: any) {
        editingId = job.id;
        editingJob = job;
        formType = job.type;
        try {
            currentTags = JSON.parse(job.tags || '[]').filter((t: string) => t !== 'Ricorrente');
        } catch(e) {
            currentTags = [];
        }
    }

    function cancelEdit() {
        editingId = null;
        editingJob = null;
        formType = 'expense';
        currentTags = [];
    }
</script>

<div class="container">
    <div class="page-header">
        <h1><i class="fas fa-sync-alt"></i> Spese Ricorrenti</h1>
        <p class="page-subtitle">Imposta bollette o stipendi automatici</p>
    </div>

	<!-- Summary outside the grid so it spans full width -->
	{#if Object.values(data.summary).some((s: any) => s.income > 0 || s.expense > 0)}
	<div style="margin-bottom:20px;">
		<h3 style="font-size:0.9rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;"><i class="fas fa-chart-bar"></i> Riepilogo Ricorrenti Attivi</h3>
		<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:12px;">
			{#each Object.entries(data.summary) as [freq, s]}
				{#if (s as any).income > 0 || (s as any).expense > 0}
				{@const sum = s as any}
				<div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; flex-direction:column; gap:8px;">
					<div style="font-weight:700; color:var(--text-primary); font-size:0.95rem; margin-bottom:2px;">
						<i class="fas {freq === 'daily' ? 'fa-sun' : freq === 'weekly' ? 'fa-calendar-week' : freq === 'monthly' ? 'fa-calendar-alt' : 'fa-calendar'}"></i> {sum.label}
					</div>
					{#if sum.income > 0}
					<div style="display:flex; justify-content:space-between; font-size:0.9rem;">
						<span style="color:var(--text-muted);">Entrate</span>
						<span style="color:var(--accent-green); font-weight:600;">+{formatEuro(sum.income)}</span>
					</div>
					{/if}
					{#if sum.expense > 0}
					<div style="display:flex; justify-content:space-between; font-size:0.9rem;">
						<span style="color:var(--text-muted);">Uscite</span>
						<span style="color:var(--accent-red); font-weight:600;">-{formatEuro(sum.expense)}</span>
					</div>
					{/if}
					<div style="border-top:1px solid var(--border-color); padding-top:8px; font-size:0.78rem; color:var(--text-muted);">
						Equivalente annuo: <span style="color:{sum.annualIncome - sum.annualExpense >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight:600;">{sum.annualIncome - sum.annualExpense >= 0 ? '+' : ''}{formatEuro(sum.annualIncome - sum.annualExpense)}</span>
					</div>
				</div>
				{/if}
			{/each}
		</div>
	</div>
	{/if}

    <div class="main-content">
        <div class="form-section">
            <h2><i class="fas fa-plus-circle"></i> Nuova Automazione</h2>
        
        <div class="type-toggle" style="margin-bottom:20px;">
            <button type="button" class="type-btn {formType === 'expense' ? 'active' : ''}" onclick={() => formType = 'expense'}>
                <i class="fas fa-arrow-up"></i> Uscita Automatica
            </button>
            <button type="button" class="type-btn {formType === 'income' ? 'active' : ''}" onclick={() => formType = 'income'}>
                <i class="fas fa-arrow-down"></i> Entrata Automatica
            </button>
        </div>

        <form method="POST" action={editingId ? "?/editJob" : "?/addJob"} use:enhance={() => {
            return async ({ update }) => {
                await update();
                cancelEdit();
            };
        }}>
            {#if editingId}
                <input type="hidden" name="id" value={editingId}>
            {/if}
            <input type="hidden" name="type" value={formType}>

            <div class="form-group">
                <label>Descrizione (es. Bolletta Luce, Mutuo, Stipendio)</label>
                <input type="text" name="description" required value={editingJob ? editingJob.description : ''}>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label>Importo Fisso (€)</label>
                    <input type="number" name="amount" min="0.01" step="0.01" required placeholder="0,00" value={editingJob ? editingJob.amount : ''}>
                </div>
                <div class="form-group">
                    <label>Data Prossima Esecuzione</label>
                    <input type="date" name="next_date" required min={editingJob ? '' : localDateString()} value={editingJob ? editingJob.nextDate : ''}>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label>Frequenza Scatto</label>
                    <select name="frequency" required value={editingJob ? editingJob.frequency : 'monthly'}>
                        <option value="monthly">Mensile (Ogni mese)</option>
                        <option value="yearly">Annuale (Ogni anno)</option>
                        <option value="weekly">Settimanale</option>
                        <option value="daily">Giornaliero (persecuzione)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Categoria</label>
                    <select name="category" required value={editingJob ? editingJob.category : ''}>
                        {#if formType === 'expense'}
                            {#each expenseCategories as cat}
                                <option value={cat.name}>{cat.name}</option>
                            {/each}
                        {:else}
                            {#each incomeCategories as cat}
                                <option value={cat.name}>{cat.name}</option>
                            {/each}
                        {/if}
                    </select>
                </div>
            </div>

            <div class="form-group" style="margin-bottom:20px;">
                <label>Tags Aggiuntivi (premi Invio o Virgola)</label>
                <div class="tags-input-container">
                    {#each currentTags as t, i}
                        <span class="tag-pill">
                            {t} <button type="button" onclick={() => currentTags.splice(i, 1)}><i class="fas fa-times"></i></button>
                        </span>
                    {/each}
                    <input type="text" placeholder="Aggiungi tag..." onkeydown={handleTagInput}>
                    <input type="hidden" name="tags" value={JSON.stringify(currentTags)}>
                </div>
            </div>

            {#if formType === 'expense'}
            <div class="form-group" style="margin-bottom:20px;">
                <label><i class="fas fa-credit-card"></i> Modalità Pagamento (default)</label>
                <select name="payment_method" required value={editingJob ? editingJob.paymentMethod : 'bancomat'}>
                    <option value="bancomat">Conto / Bancomat</option>
                    <option value="credit_card">Carta di Credito</option>
                    <option value="cash">Contanti</option>
                </select>
            </div>
            {/if}

            <div style="display: flex; gap: 10px;">
                <button type="submit" class="btn-submit {formType === 'income' ? 'income-mode' : ''}" style="flex: 1;">
                    <i class="fas {editingId ? 'fa-save' : 'fa-robot'}"></i> {editingId ? 'Salva Modifiche' : 'Avvia Automazione'}
                </button>
                {#if editingId}
                <button type="button" class="btn-submit" style="background: var(--bg-secondary); color: var(--text-primary); flex: 0.3;" onclick={cancelEdit}>
                    <i class="fas fa-times"></i> Annulla
                </button>
                {/if}
            </div>
        </form>
        </div>

        <!-- Active Jobs List -->
        <div class="recent-transactions">
            <h2><i class="fas fa-tasks"></i> Automazioni Attive</h2>
        {#if data.jobs.length === 0}
            <div style="padding:30px; text-align:center; color:var(--text-muted); background:rgba(0,0,0,0.1); border-radius:var(--radius-md);">
                Nessuna transazione ricorrente programmata.
            </div>
        {:else}
            <div style="display:flex; flex-direction:column; gap:15px;">
                {#each data.jobs as job}
                    <div transition:fly={{ y: 20, duration: 300 }} class="job-row" style="border-left:4px solid {job.type === 'income' ? 'var(--accent-green)' : 'var(--accent-red)'}; filter: {job.isActive === 0 ? 'grayscale(0.8) opacity(0.7)' : 'none'};">
                        <div class="job-info">
                            <div style="font-weight:700; font-size:1.1rem; margin-bottom:4px;">
                                {job.description}
                                {#if job.isActive === 0}
                                    <span style="font-size:0.7rem; background:var(--accent-orange); color:white; padding:2px 8px; border-radius:12px; margin-left:8px; vertical-align:middle;"><i class="fas fa-pause-circle"></i> Sospesa</span>
                                {/if}
                            </div>
                            <div style="font-size:0.85rem; color:var(--text-muted); display:flex; gap:15px;">
                                <span><i class="fas fa-{job.type === 'income' ? 'arrow-down' : 'arrow-up'}"></i> {job.type === 'income' ? 'Entrata' : 'Uscita'}</span>
                                <span><i class="fas fa-calendar-alt"></i> Il prossimo: <strong>{formatDate(job.nextDate)}</strong></span>
                                <span><i class="fas fa-history"></i> {frequencyMap[job.frequency]}</span>
                            </div>
                        </div>
                        <div class="job-actions">
                            <span style="font-size:1.3rem; font-weight:800; color:{job.type === 'income' ? 'var(--accent-green)' : 'var(--accent-red)'}">
                                {job.type === 'income' ? '+' : '-'}{formatEuro(job.amount)}
                            </span>
                            <div style="display:flex; gap:8px;">
                                <form method="POST" action="?/toggleJob" use:enhance style="margin:0;">
                                    <input type="hidden" name="id" value={job.id}>
                                    <input type="hidden" name="current_state" value={job.isActive}>
                                    <button type="submit" title={job.isActive === 0 ? "Riattiva questa automazione" : "Sospendi temporaneamente"} style="background:{job.isActive === 0 ? 'var(--accent-blue)' : 'var(--bg-secondary)'}; color:{job.isActive === 0 ? 'white' : 'var(--text-primary)'}; border:1px solid var(--border-color); border-radius:8px; width:36px; height:36px; cursor:pointer; display:flex; justify-content:center; align-items:center; transition:0.2s;">
                                        <i class="fas fa-{job.isActive === 0 ? 'play' : 'pause'}"></i>
                                    </button>
                                </form>

                                <button type="button" title="Modifica" style="background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:8px; width:36px; height:36px; cursor:pointer; display:flex; justify-content:center; align-items:center; transition:0.2s;" onclick={() => {
                                    startEdit(job);
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}>
                                    <i class="fas fa-edit"></i>
                                </button>

                                <form method="POST" action="?/deleteJob" use:enhance={({ cancel }) => { if(!confirm('Sei sicuro di voler bloccare definitivamente questa spesa ricorrente? Le transazioni passate rimarranno intatte nello storico.')) cancel(); }} style="margin:0;">
                                    <input type="hidden" name="id" value={job.id}>
                                    <button type="submit" title="Elimina definitivamente" style="background:var(--accent-red-glow); color:var(--accent-red); border:1px solid transparent; border-radius:8px; width:36px; height:36px; cursor:pointer; display:flex; justify-content:center; align-items:center; transition:0.2s;">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
        </div>
    </div>
</div>

<style>
.tags-input-container { display:flex; flex-wrap:wrap; gap:8px; padding:8px; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--bg-input); align-items:center; }
.tags-input-container input[type=text] { border:none; background:transparent; outline:none; flex:1; min-width:120px; color:var(--text-primary); padding:0; height:auto; }
.tags-input-container input[type=text]:focus { outline:none; box-shadow:none; }
.tag-pill { display:flex; align-items:center; gap:6px; background:var(--primary-color); color:white; padding:4px 10px; border-radius:20px; font-size:0.8rem; font-weight:600; }
.tag-pill button { background:none; border:none; color:white; opacity:0.7; cursor:pointer; padding:0; display:flex; align-items:center; }
.tag-pill button:hover { opacity:1; }

:global(.type-btn) { flex:1; padding:12px; display:flex; align-items:center; justify-content:center; gap:8px; background:var(--bg-secondary); border:1px solid var(--border-color); color:var(--text-muted); cursor:pointer; transition:var(--transition); font-size:0.95rem; font-weight:600; border-radius:8px; }
:global(.type-btn.active) { background:var(--primary-color); color:white; border-color:var(--primary-color); }

.job-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg-input);
    padding: 15px;
    border-radius: var(--radius-md);
    transition: var(--transition-fast);
    flex-wrap: wrap;
    gap: 15px;
}
.job-info {
    flex: 1 1 200px;
}
.job-actions {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
}
</style>
