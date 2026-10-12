<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import Chart from 'chart.js/auto';
	
	let { data } = $props();

	// Computed map for constant O(1) lookups
	let allCategoriesMap: Record<string, any> = $derived(
		data.allCategories.reduce((acc, c) => ({ ...acc, [c.name]: c }), {})
	);

	let formatEuro = (amount: number) => '€' + amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	let formatDate = (dateStr: string) => {
		const [y, m, d] = dateStr.split('-');
		return `${d}/${m}/${y}`;
	};

	const italianMonths = [
		'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 
		'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
	];

	// Filter state
	let filterType = $state(data.filters.type);
	let fromStr = $state(data.filters.from);
	let toStr = $state(data.filters.to);
	let selectedYear = $state(data.filters.year);
	let selectedMonth = $state(data.filters.month);
	let selectedPaymentMethod = $state(data.filters.paymentMethod || 'all');
	let selectedTags: string[] = $state(data.filters.tags || []);
	let selectedCategory = $state(data.filters.category || '');
	let selectedAttachment = $state(data.filters.attachment || '');
	let excludeCC = $state(false);

	function handleTagInput(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			const val = (e.target as HTMLInputElement).value.trim();
			if (val && !selectedTags.includes(val)) selectedTags.push(val);
			(e.target as HTMLInputElement).value = '';
		}
	}

	function updateFilter(type: string) {
		filterType = type;
	}

	function applyFilters() {
		const params = new URLSearchParams();
		params.set('type', filterType);
		if (filterType === 'range') {
			params.set('from', fromStr);
			params.set('to', toStr);
		} else if (filterType === 'monthly') {
			params.set('month', selectedMonth.toString());
			params.set('year', selectedYear.toString());
		} else if (filterType === 'annual') {
			params.set('year', selectedYear.toString());
		}
		params.set('payment_method', selectedPaymentMethod);
        if (selectedCategory) params.set('category', selectedCategory);
        if (selectedTags.length > 0) {
            params.set('tags', selectedTags.join(','));
        }
        if (selectedAttachment) params.set('attachment', selectedAttachment);
        if (excludeCC) params.set('exclude_cc', '1');
		goto(`?${params.toString()}`, { replaceState: false, keepFocus: true });
	}

	// Chart Drawing
	let chartCanvas: HTMLCanvasElement;
	let chartInstance: any = null;

	function renderChart() {
		if (chartInstance) chartInstance.destroy();
		if (!chartCanvas || data.expenseBreakdown.length === 0) return;

		const labels = data.expenseBreakdown.map(b => b.category);
		const vals = data.expenseBreakdown.map(b => b.total);
		const bg = data.expenseBreakdown.map(b => allCategoriesMap[b.category]?.color || '#999');

		const ctx = chartCanvas.getContext('2d');
		if (!ctx) return;

        Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e2e8f0';
        Chart.defaults.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || 'rgba(255, 255, 255, 0.1)';
		chartInstance = new Chart(ctx, {
			type: 'doughnut',
			data: { labels, datasets: [{ data: vals, backgroundColor: bg, borderWidth: 0 }] },
			options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, cutout: '70%' }
		});
	}

	let lineChartCanvas: HTMLCanvasElement;
	let lineChartInstance: any = null;

	function renderLineChart() {
		if (lineChartInstance) lineChartInstance.destroy();
		if (!lineChartCanvas || data.dailyBreakdown.length === 0) return;

		const labels = data.dailyBreakdown.map(d => formatDate(d.date).slice(0, 5)); // Mostra GG/MM
		const expenseVals = data.dailyBreakdown.map(d => d.expense);
		const incomeVals = data.dailyBreakdown.map(d => d.income);

		const ctx = lineChartCanvas.getContext('2d');
		if (!ctx) return;

		lineChartInstance = new Chart(ctx, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{ label: 'Uscite', data: expenseVals, borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', tension: 0.4, fill: true, borderWidth: 2, pointRadius: 3 },
					{ label: 'Entrate', data: incomeVals, borderColor: '#2ecc71', backgroundColor: 'rgba(46,204,113,0.1)', tension: 0.4, fill: true, borderWidth: 2, pointRadius: 3 }
				]
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				scales: {
                    y: { display: false, beginAtZero: true },
                    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--text-muted)' } }
                },
				plugins: { legend: { position: 'top', labels: { color: 'var(--text-primary)' } } }
			}
		});
	}

	$effect(() => {
		// Reactive bind to URL changes
		let dummy = data.summary.expense; // trigger re-render 
		renderChart();
        renderLineChart();
	});

	onMount(() => { renderChart(); renderLineChart(); });

	function exportToCsv() {
		if (!data.transactions || data.transactions.length === 0) {
            alert("Nessuna traccia da esportare in questo periodo.");
            return;
        }

		const headers = ['Data', 'Descrizione', 'Categoria', 'Tipologia', 'Importo', 'Metodo di Pagamento'];
		const rows = data.transactions.map((t: any) => [
			t.date,
			`"${(t.description || '').replace(/"/g, '""')}"`,
			`"${(t.category || '').replace(/"/g, '""')}"`,
			t.type === 'income' ? 'Entrata' : 'Uscita',
			t.amount.toString().replace('.', ','),
			`"${t.paymentMethod}"`
		]);

		const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
		const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		
		const link = document.createElement('a');
		link.href = url;
		link.download = `casadash_report_${new Date().toISOString().split('T')[0]}.csv`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}
</script>

<div class="container">
	<div class="page-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
        <div>
            <h1><i class="fas fa-file-invoice-dollar"></i> Report & Statistiche</h1>
            <p class="page-subtitle">Analizza le transazioni per periodo</p>
        </div>
        		<button type="button" class="btn-primary" onclick={exportToCsv} style="display:flex; gap:8px; align-items:center; padding:10px 20px; border-radius:var(--radius-md); font-weight:600; cursor:pointer;">
            <i class="fas fa-file-csv"></i> Esporta in Excel / CSV
        </button>
        <button type="button" onclick={() => { excludeCC = !excludeCC; applyFilters(); }} title="Escludi/Includi spese Carta di Credito non saldate" style="display:flex; gap:8px; align-items:center; padding:10px 20px; border-radius:var(--radius-md); font-weight:600; cursor:pointer; background:{excludeCC ? 'rgba(230, 126, 34, 0.15)' : 'var(--bg-card)'}; border:1px solid {excludeCC ? '#e67e22' : 'var(--border-color)'}; color:{excludeCC ? '#e67e22' : 'var(--text-primary)'}; transition:all 0.2s;">
            <i class="fas fa-credit-card"></i> {excludeCC ? 'Mostra CC non saldate' : 'Escludi CC non saldate'}
        </button>
	</div>

	<!-- Tabs -->
	<div class="report-tabs">
		<button class="report-tab {filterType === 'range' ? 'active' : ''}" onclick={() => updateFilter('range')}>
			<i class="fas fa-calendar-alt"></i> Per Date
		</button>
		<button class="report-tab {filterType === 'monthly' ? 'active' : ''}" onclick={() => updateFilter('monthly')}>
			<i class="fas fa-calendar-day"></i> Mensile
		</button>
		<button class="report-tab {filterType === 'annual' ? 'active' : ''}" onclick={() => updateFilter('annual')}>
			<i class="fas fa-calendar"></i> Annuale
		</button>
	</div>

	<!-- Filters -->
	{#if filterType === 'range'}
	<div class="report-filter" style="display:block;">
		<div class="filter-row">
			<div class="filter-group">
				<label><i class="fas fa-play"></i> Da</label>
				<input type="date" bind:value={fromStr}>
			</div>
			<div class="filter-group">
				<label><i class="fas fa-stop"></i> A</label>
				<input type="date" bind:value={toStr}>
			</div>
			<div class="filter-group">
				<label><i class="fas fa-credit-card"></i> Metodo</label>
				<select bind:value={selectedPaymentMethod}>
					<option value="all">Tutti</option>
					<option value="bancomat">Conto / Bancomat</option>
					<option value="credit_card">Solo Carta di Credito</option>
					<option value="cash">Solo Contanti</option>
				</select>
			</div>
            <div class="filter-group">
                <label><i class="fas fa-tags"></i> Filtra Tags</label>
                <div class="tags-input-container">
                    {#each selectedTags as t, i}
                        <span class="tag-pill">
                            {t} <button type="button" onclick={() => selectedTags.splice(i, 1)}><i class="fas fa-times"></i></button>
                        </span>
                    {/each}
                    <input type="text" placeholder="Filtra tag..." list="reports_tags_list" onkeydown={handleTagInput}>
                </div>
            </div>
			<div class="filter-group">
				<label><i class="fas fa-paperclip"></i> Allegato</label>
				<select bind:value={selectedAttachment}>
					<option value="">Tutti</option>
					<option value="with">Con allegato</option>
					<option value="without">Senza allegato</option>
				</select>
			</div>
			<button class="btn-filter" onclick={applyFilters}><i class="fas fa-search"></i> Cerca</button>
		</div>
	</div>
	{:else if filterType === 'monthly'}
	<div class="report-filter" style="display:block;">
		<div class="filter-row">
			<div class="filter-group">
				<label>Mese</label>
				<select bind:value={selectedMonth}>
					{#each italianMonths as num, i}
						<option value={i+1}>{num}</option>
					{/each}
				</select>
			</div>
			<div class="filter-group">
				<label>Anno</label>
				<select bind:value={selectedYear}>
					{#each data.filters.availableYears as yr}
						<option value={yr}>{yr}</option>
					{/each}
				</select>
			</div>
			<div class="filter-group">
				<label><i class="fas fa-credit-card"></i> Metodo</label>
				<select bind:value={selectedPaymentMethod}>
					<option value="all">Tutti</option>
					<option value="bancomat">Conto / Bancomat</option>
					<option value="credit_card">Solo Carta di Credito</option>
					<option value="cash">Solo Contanti</option>
				</select>
			</div>
            <div class="filter-group">
                <label><i class="fas fa-tags"></i> Filtra Tags</label>
                <div class="tags-input-container">
                    {#each selectedTags as t, i}
                        <span class="tag-pill">
                            {t} <button type="button" onclick={() => selectedTags.splice(i, 1)}><i class="fas fa-times"></i></button>
                        </span>
                    {/each}
                    <input type="text" placeholder="Filtra tag..." list="reports_tags_list" onkeydown={handleTagInput}>
                </div>
            </div>
			<div class="filter-group">
				<label><i class="fas fa-paperclip"></i> Allegato</label>
				<select bind:value={selectedAttachment}>
					<option value="">Tutti</option>
					<option value="with">Con allegato</option>
					<option value="without">Senza allegato</option>
				</select>
			</div>
			<button class="btn-filter" onclick={applyFilters}><i class="fas fa-search"></i> Cerca</button>
		</div>
	</div>
	{:else if filterType === 'annual'}
	<div class="report-filter" style="display:block;">
		<div class="filter-row">
			<div class="filter-group">
				<label>Anno</label>
				<select bind:value={selectedYear}>
					{#each data.filters.availableYears as yr}
						<option value={yr}>{yr}</option>
					{/each}
				</select>
			</div>
			<div class="filter-group">
				<label><i class="fas fa-credit-card"></i> Metodo</label>
				<select bind:value={selectedPaymentMethod}>
					<option value="all">Tutti</option>
					<option value="bancomat">Conto / Bancomat</option>
					<option value="credit_card">Solo Carta di Credito</option>
					<option value="cash">Solo Contanti</option>
				</select>
			</div>
            <div class="filter-group">
                <label><i class="fas fa-tags"></i> Filtra Tags</label>
                <div class="tags-input-container">
                    {#each selectedTags as t, i}
                        <span class="tag-pill">
                            {t} <button type="button" onclick={() => selectedTags.splice(i, 1)}><i class="fas fa-times"></i></button>
                        </span>
                    {/each}
                    <input type="text" placeholder="Filtra tag..." list="reports_tags_list" onkeydown={handleTagInput}>
                </div>
            </div>
			<div class="filter-group">
				<label><i class="fas fa-paperclip"></i> Allegato</label>
				<select bind:value={selectedAttachment}>
					<option value="">Tutti</option>
					<option value="with">Con allegato</option>
					<option value="without">Senza allegato</option>
				</select>
			</div>
			<button class="btn-filter" onclick={applyFilters}><i class="fas fa-search"></i> Cerca</button>
		</div>
	</div>
	{/if}

	<!-- Results -->
	<div class="report-results">
        {#if selectedCategory}
        <div style="margin-bottom:20px; background:var(--bg-card); padding:12px 20px; border-radius:var(--radius-md); border:1px solid var(--accent-blue-light); display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fas fa-filter"></i> Filtrato per Categoria: <strong style="color:var(--accent-blue);">{selectedCategory}</strong></span>
            <button class="btn-primary" style="padding:6px 14px; font-size:0.85rem;" onclick={() => { selectedCategory = ''; applyFilters(); }}>
                <i class="fas fa-times"></i> Rimuovi
            </button>
        </div>
        {/if}

		<div class="report-summary">
			<div class="summary-card card-income">
				<div class="card-icon"><i class="fas fa-arrow-down"></i></div>
				<div class="card-content">
					<h3>Entrate</h3>
					<p class="amount income-amount">{formatEuro(data.summary.income)}</p>
				</div>
			</div>
			<div class="summary-card card-expense">
				<div class="card-icon"><i class="fas fa-arrow-up"></i></div>
				<div class="card-content">
					<h3>Uscite</h3>
					<p class="amount expense-amount">{formatEuro(data.summary.expense)}</p>
				</div>
			</div>
			<div class="summary-card card-balance">
				<div class="card-icon"><i class="fas fa-balance-scale"></i></div>
				<div class="card-content">
					<h3>Bilancio</h3>
					<p class="amount balance-amount" class:text-red-500={data.summary.balance < 0}>{formatEuro(data.summary.balance)}</p>
				</div>
			</div>
			<div class="summary-card card-count">
				<div class="card-icon"><i class="fas fa-list"></i></div>
				<div class="card-content">
					<h3>Transazioni</h3>
					<p class="amount">{data.transactions.length}</p>
				</div>
			</div>
		</div>

		{#if data.budget > 0}
			{@const pct = (data.summary.expense / data.budget) * 100}
			<div class="budget-report-card" style="margin-bottom:24px;">
				<div class="budget-header">
					<span class="budget-label"><i class="fas fa-bullseye"></i> Budget del periodo</span>
					<span class="budget-values">{formatEuro(data.summary.expense)} / {formatEuro(data.budget)}</span>
				</div>
				<div class="budget-bar">
					<div class="budget-bar-fill {pct > 90 ? 'danger' : (pct > 70 ? 'warning' : 'ok')}" style="width: {Math.min(pct, 100)}%"></div>
				</div>
				<div class="budget-footer">
					<span>{pct.toFixed(1)}% utilizzato</span>
					<span>{data.budget - data.summary.expense >= 0 ? `Rimangono ${formatEuro(data.budget - data.summary.expense)}` : `Sforato di ${formatEuro(data.summary.expense - data.budget)}`}</span>
				</div>
			</div>
		{/if}

		<div class="report-charts" style="display:flex; flex-direction:column; gap:24px; margin-bottom:24px;">
            {#if data.dailyBreakdown && data.dailyBreakdown.length > 0}
			<div class="chart-section" style="width:100%;">
				<h3><i class="fas fa-chart-line"></i> Andamento Temporale</h3>
				<div class="chart-container" style="height:250px;">
					<canvas bind:this={lineChartCanvas}></canvas>
				</div>
			</div>
            {/if}
            {#if data.expenseBreakdown.length > 0}
			<div class="chart-section" style="width:100%;">
				<h3><i class="fas fa-chart-pie"></i> Distribuzione per Categoria (Uscite)</h3>
				<div class="chart-container" style="height:280px;">
					<canvas bind:this={chartCanvas}></canvas>
				</div>
			</div>
            {/if}
		</div>

		<div class="category-breakdown">
			<h3><i class="fas fa-layer-group"></i> Dettaglio Categorie</h3>
			<div class="categories-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; margin-top:15px;">
				{#each data.breakdown as b}
					<div role="button" tabindex="0" class="category-item" style="cursor:pointer; flex-direction:column; align-items:stretch; gap:6px; padding:12px 16px; border:1px solid var(--border-color); border-radius:8px; box-shadow:none; background:var(--bg-primary); transition:background 0.2s;" onclick={() => { selectedCategory = b.category; applyFilters(); }} onkeydown={(e) => { if(e.key==='Enter') { selectedCategory = b.category; applyFilters(); }}}>
                        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
						    <div class="category-info">
							    <div class="category-icon" style="background-color: {allCategoriesMap[b.category]?.color || '#999'}">
								    <i class="fas {allCategoriesMap[b.category]?.icon || 'fa-tag'}"></i>
							    </div>
							    <div>
								    <span class="category-name">{b.category}</span>
								    <span class="category-tx-count">{b.count} transazioni</span>
							    </div>
						    </div>
						    <span class="category-amount {b.type === 'income' ? 'income-amount' : 'expense-amount'}">
							    {b.type === 'income' ? '+' : '-'}{formatEuro(b.total)}
						    </span>
                        </div>
                        {#if b.type === 'expense' && data.categoryBudgets[b.category]}
                            {@const catBudget = data.categoryBudgets[b.category]}
                            {@const pct = (b.total / catBudget) * 100}
                            <div style="width:100%;">
                                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">
                                    <span>Budget: {formatEuro(catBudget)}</span>
                                    <span>{pct.toFixed(1)}%</span>
                                </div>
                                <div class="budget-bar" style="height:6px;">
                                    <div class="budget-bar-fill {pct > 90 ? 'danger' : (pct > 75 ? 'warning' : 'ok')}" style="width: {Math.min(pct, 100)}%"></div>
                                </div>
                            </div>
                        {/if}
					</div>
				{/each}
				{#if data.breakdown.length === 0}
					<p style="text-align:center; color: var(--text-muted); padding:20px;">Nessun dato per questo periodo.</p>
				{/if}
			</div>
		</div>

		<div class="report-table">
			<div class="section-header">
				<h3><i class="fas fa-list-alt"></i> Lista Transazioni</h3>
			</div>
			<div class="table-responsive">
				<table>
					<thead>
						<tr>
							<th>Data</th>
							<th>Descrizione</th>
							<th>Categoria</th>
							<th>Tags</th>
							<th>Tipo</th>
							<th>Importo</th>
						</tr>
					</thead>
					<tbody>
						{#each data.transactions as t}
							<tr class="transaction-row {t.type}-row">
								<td data-label="Data">{formatDate(t.date)}</td>
								<td data-label="Descrizione">
                                    {t.description}
                                    {#if t.paymentMethod === 'credit_card'}
                                        <i class="fas fa-credit-card" style="color:var(--accent-blue-light); font-size: 0.85rem; margin-left:6px;" title="Pagamento con Carta di Credito"></i>
                                    {/if}
                                    {#if t.tags && t.tags.includes('Ricorrente')}
                                        <i class="fas fa-sync-alt" style="color:var(--accent-green); font-size: 0.85rem; margin-left:4px;" title="Spesa Autogenerata"></i>
                                    {/if}
                                    {#if t.receiptPath}
                                        <a href="{base}{t.receiptPath}" target="_blank" style="color:var(--text-muted); text-decoration:none; font-size: 0.85rem; margin-left:6px;" title="Vedi Allegato"><i class="fas fa-paperclip"></i></a>
                                    {/if}
                                    {#if t.createdBy}
                                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                                            <i class="fas fa-user" style="font-size:0.65rem;"></i> {data.allUsers.find(u => u.id === t.createdBy)?.displayName || 'Sconosciuto'}
                                        </div>
                                    {/if}
                                </td>
								<td data-label="Categoria">
									<span class="category-tag" style="background-color: {allCategoriesMap[t.category]?.color || '#999'}">{t.category}</span>
								</td>
								<td data-label="Tags">
									{#if t.tags && t.tags !== '[]'}
										{@const tagsArr = JSON.parse(t.tags)}
										<div style="display:flex; flex-wrap:wrap; gap:4px; max-width:180px;">
											{#each tagsArr.slice(0, 2) as tag}
												<span style="font-size:0.65rem; background:var(--bg-input); color:var(--text-primary); padding:3px 8px; border-radius:12px; border:1px solid var(--border-color); font-weight:500;">{tag}</span>
											{/each}
											{#if tagsArr.length > 2}
												<span style="font-size:0.65rem; background:var(--bg-card); color:var(--text-primary); padding:3px 8px; border-radius:12px; border:1px solid var(--border-color); font-weight:500; cursor:help;" title={tagsArr.slice(2).join(', ')}>+{tagsArr.length - 2}</span>
											{/if}
										</div>
									{/if}
								</td>
								<td data-label="Tipo">
									<span class="type-badge type-{t.type}">
										<i class="fas fa-arrow-{t.type === 'income' ? 'down' : 'up'}"></i>
										{t.type === 'income' ? 'Entrata' : 'Uscita'}
									</span>
								</td>
								<td data-label="Importo" class="amount {t.type === 'income' ? 'income-amount' : 'expense-amount'}">
									{t.type === 'income' ? '+' : '-'}{formatEuro(t.amount)}
								</td>
							</tr>
						{/each}
						{#if data.transactions.length === 0}
							<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding:20px;">Nessuna transazione trovata.</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>

<datalist id="reports_tags_list">
	{#each data.availableTags as tg}
		<option value={tg}></option>
	{/each}
</datalist>

<style>
.tags-input-container { display:flex; flex-wrap:wrap; gap:4px; padding:4px 8px; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--bg-input); align-items:center; min-height:38px; }
.tags-input-container input[type=text] { border:none; background:transparent; outline:none; flex:1; min-width:80px; color:var(--text-primary); padding:0; height:auto; }
.tags-input-container input[type=text]:focus { outline:none; box-shadow:none; }
.tag-pill { display:flex; align-items:center; gap:6px; background:var(--primary-color); color:white; padding:2px 8px; border-radius:20px; font-size:0.75rem; font-weight:600; }
.tag-pill button { background:none; border:none; color:white; opacity:0.7; cursor:pointer; padding:0; display:flex; align-items:center; }
.tag-pill button:hover { opacity:1; }
</style>
