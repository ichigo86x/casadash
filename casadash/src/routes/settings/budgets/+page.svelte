<script lang="ts">
	import { base } from '$app/paths';
    import { enhance } from '$app/forms';
    import { goto } from '$app/navigation';
    
    let { data } = $props();

    let selectedYear = $state(data.currentYear);
    let selectedMonth = $state(data.currentMonth);

    let formatEuro = (amount: number) => '€' + amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const italianMonths = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

    function changePeriod() {
        goto(`${base}/settings/budgets?year=${selectedYear}&month=${selectedMonth}`);
    }

    let globalMonthlyBudget = $derived(data.budgets.find((b: any) => b.category === 'Totale')?.amount || 0);

</script>

<div class="container">
    <div class="page-header">
        <h1><i class="fas fa-bullseye"></i> Gestione Budget</h1>
        <p class="page-subtitle">Imposta limiti di spesa annuali e mensili</p>
    </div>

    <!-- 1. Annual TOTAL Budget -->
    <div class="form-section" style="margin-bottom:20px; border-left:4px solid var(--accent-purple);">
        <h2 style="display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fas fa-calendar"></i> Budget Annuale Totale</span>
            <span style="color:var(--accent-purple);">{formatEuro(data.annualBudget)}</span>
        </h2>
        <form method="POST" action="?/setAnnualBudget" use:enhance style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
            <input type="hidden" name="year" value={selectedYear}>
            <div class="form-group" style="margin:0; flex:1; min-width:200px;">
                <label for="annual_total_amount">Tetto massimo per l'intero anno {selectedYear} (€)</label>
                <input id="annual_total_amount" type="number" name="amount" min="0" step="1" value={data.annualBudget > 0 ? data.annualBudget : ''} placeholder="Inserisci 0 per rimuovere">
            </div>
            <button type="submit" class="btn-submit" style="width:auto; padding:12px 20px;"><i class="fas fa-save"></i> Salva</button>
        </form>
    </div>

    <!-- 2. Annual PER-CATEGORY Budgets -->
    <div class="form-section" style="margin-bottom:20px; border-left:4px solid var(--accent-green);">
        <h2 style="margin-bottom:5px;"><i class="fas fa-tags"></i> Budget Annuale per Categoria</h2>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:20px;">Limiti di spesa per categoria sull'intero anno {selectedYear}.</p>

        <div class="categories-grid">
            {#each data.categories as cat}
                {@const catBudget = data.annualCategoryBudgets.find((b: any) => b.category === cat.name)?.amount || 0}
                <div class="category-budget-row" style="background:var(--bg-input); padding:15px; border-radius:var(--radius-md); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px; border-left:3px solid {cat.color}">
                    <div style="display:flex; align-items:center; gap:10px; min-width:150px;">
                        <div class="cat-icon" style="background:{cat.color}; width:36px; height:36px; border-radius:50%; display:flex; justify-content:center; align-items:center; color:white;">
                            <i class="fas {cat.icon}"></i>
                        </div>
                        <div>
                            <span style="font-weight:600;">{cat.name}</span>
                            {#if catBudget > 0}
                                <div style="font-size:0.78rem; color:var(--text-muted);">{formatEuro(catBudget)} / anno</div>
                            {/if}
                        </div>
                    </div>
                    
                    <form method="POST" action="?/setAnnualCategoryBudget" use:enhance style="display:flex; gap:10px; align-items:center; margin:0;">
                        <input type="hidden" name="year" value={selectedYear}>
                        <input type="hidden" name="category" value={cat.name}>
                        <input type="number" name="amount" min="0" step="1" value={catBudget > 0 ? catBudget : ''} placeholder="Nessun limite" style="width:120px;">
                        <button type="submit" title="Salva Budget {cat.name}" style="background:var(--bg-secondary); border:1px solid var(--border-color); color:var(--text-primary); padding:10px; border-radius:8px; cursor:pointer; min-width:38px;"><i class="fas fa-check"></i></button>
                    </form>
                </div>
            {/each}
        </div>
    </div>

    <!-- 3. Monthly TOTAL Budget -->
    <div class="form-section" style="border-left:4px solid var(--accent-blue);">
        <h2 style="display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fas fa-globe"></i> Budget Mensile Totale</span>
            <span style="color:var(--accent-blue);">{formatEuro(globalMonthlyBudget)}</span>
        </h2>

        <div style="display:flex; gap:15px; align-items:flex-end; flex-wrap:wrap; margin-bottom:20px; padding-bottom:20px; border-bottom:1px solid var(--border-color);">
            <div class="form-group" style="margin:0;">
                <label for="sel_month">Seleziona Mese</label>
                <select id="sel_month" bind:value={selectedMonth} onchange={changePeriod}>
                    {#each italianMonths as m, i}
                        <option value={i+1}>{m}</option>
                    {/each}
                </select>
            </div>
            <div class="form-group" style="margin:0;">
                <label for="sel_year">Anno</label>
                <input id="sel_year" type="number" bind:value={selectedYear} onchange={changePeriod} style="width:100px;">
            </div>
            <div style="flex:1;"></div>
            <div style="text-align:right;">
                <div style="font-size:0.85rem; color:var(--text-muted);">Periodo Visualizzato</div>
                <div style="font-weight:700; font-size:1.2rem; color:var(--text-primary);">{italianMonths[selectedMonth-1]} {selectedYear}</div>
            </div>
        </div>

        <form method="POST" action="?/setCategoryBudget" use:enhance style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
            <input type="hidden" name="year" value={selectedYear}>
            <input type="hidden" name="month" value={selectedMonth}>
            <input type="hidden" name="category" value="Totale">
            <div class="form-group" style="margin:0; flex:1; min-width:200px;">
                <label for="monthly_total_amount">Tetto massimo totale per {italianMonths[selectedMonth-1]} (€)</label>
                <input id="monthly_total_amount" type="number" name="amount" min="0" step="1" value={globalMonthlyBudget > 0 ? globalMonthlyBudget : ''} placeholder="Inserisci 0 per rimuovere">
            </div>
            <button type="submit" class="btn-submit" style="width:auto; padding:12px 20px;"><i class="fas fa-save"></i> Salva</button>
        </form>
    </div>
</div>

<style>
.categories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 15px; }
</style>
