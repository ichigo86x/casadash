<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import Chart from 'chart.js/auto';
	
	let { data, form } = $props();

	// Computed map for constant O(1) lookups
	let allCategoriesMap: Record<string, any> = $derived(
		data.allCategories.reduce((acc, c) => ({ ...acc, [c.name]: c }), {})
	);

	let formatEuro = (amount: number) => '€' + amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	let formatDate = (dateStr: string) => {
		const [y, m, d] = dateStr.split('-');
		return `${d}/${m}/${y}`;
	};
	// Transaction form state
	let formType: 'income' | 'expense' = $state('expense');
	let newPaymentMethod: string = $state('bancomat');

    // Editing State
    let editingTransaction: any = $state(null);
	let currentTags: string[] = $state([]);
	let editTags: string[] = $state([]);

	function handleTagInput(e: KeyboardEvent, isEdit = false) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			const val = (e.target as HTMLInputElement).value.trim();
			if (val) {
				if (isEdit && !editTags.includes(val)) editTags.push(val);
				if (!isEdit && !currentTags.includes(val)) currentTags.push(val);
			}
			(e.target as HTMLInputElement).value = '';
		}
	}

    // Pagination & Search State
    let currentPage = $state(1);
    let itemsPerPage = $state(15);
	
    // Search State
    let showSearch = $state(false);
    let searchTerm = $state('');
    let searchCategory = $state('');
    let searchType = $state('');
    let searchMinAmount = $state<number | null>(null);
    let searchMaxAmount = $state<number | null>(null);
    let searchFromDate = $state('');
    let searchToDate = $state('');
    let searchAttachment = $state('');

    let filteredTransactions = $derived(
        data.allTransactions.filter(t => {
            if (searchTerm && !t.description.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (searchCategory && t.category !== searchCategory) return false;
            if (searchType && t.type !== searchType) return false;
            if (searchMinAmount !== null && t.amount < searchMinAmount) return false;
            if (searchMaxAmount !== null && t.amount > searchMaxAmount) return false;
            if (searchFromDate && t.date < searchFromDate) return false;
            if (searchToDate && t.date > searchToDate) return false;
            if (searchAttachment === 'with' && !t.receiptPath) return false;
            if (searchAttachment === 'without' && t.receiptPath) return false;
            return true;
        })
    );

	let paginatedTransactions = $derived(
		filteredTransactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
	);
	let totalPages = $derived(
		Math.ceil(filteredTransactions.length / itemsPerPage)
	);

    // Reset page when filters change
    $effect(() => {
        searchTerm; searchCategory; searchType; searchMinAmount; searchMaxAmount; searchFromDate; searchToDate; searchAttachment;
        currentPage = 1;
    });

    function editTransaction(t: any) {
        editingTransaction = { ...t, date: t.date.split('T')[0] };
		try { editTags = JSON.parse(t.tags || '[]'); } catch(e) { editTags = []; }
    }
    
    function closeEdit() {
        editingTransaction = null;
    }

	function setType(type: 'income' | 'expense') {
		formType = type;
	}

	let compressedReceiptBlob: Blob | null = $state(null);
    let receiptFileName: string = $state('');

	async function handleFileSelect(e: any) {
		const file = e.target.files[0];
		if (!file) {
            compressedReceiptBlob = null;
            receiptFileName = '';
            return;
        }

        receiptFileName = file.name;

		if (file.type.startsWith('image/')) {
			const img = new Image();
			img.src = URL.createObjectURL(file);
			await new Promise(r => img.onload = r);

			let width = img.width;
			let height = img.height;
			const maxDim = 1200;

			if (width > height && width > maxDim) {
				height *= maxDim / width;
				width = maxDim;
			} else if (height > maxDim) {
				width *= maxDim / height;
				height = maxDim;
			}

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			ctx?.drawImage(img, 0, 0, width, height);

			canvas.toBlob((blob) => {
				compressedReceiptBlob = blob;
			}, 'image/webp', 0.6);
		} else {
			// PDFs or other formats
			compressedReceiptBlob = file; 
		}
	}

    // CC Widget State & Logic
    let showCcWidget = $state(false);
    // Pre-fill bulk-settle from date: last settled CC date, or first of last month
    let ccSettleFromDate = $state(data.lastSettledDate || '');
    // Pre-fill bulk-settle to date: today
    let ccSettleToDate = $state(new Date().toISOString().split('T')[0]);
    $effect(() => {
        if (!ccSettleFromDate) {
            const today = new Date();
            let y = today.getFullYear();
            let m = today.getMonth(); // 0-indexed
            if (m === 0) { m = 11; y -= 1; } else { m -= 1; }
            ccSettleFromDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        }
    });

	const italianMonths = [
		'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 
		'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
	];

	// Charts
	let chartCanvas: HTMLCanvasElement;
	let chartInstance: any = null;
	let currentChartType = $state('doughnut');

	onMount(() => {
		renderChart('expense'); // Default filter show expenses pie
	});

	function renderChart(filter: 'expense'|'income'|'all') {
		if (chartInstance) chartInstance.destroy();
		if (!chartCanvas) return;

		const ctx = chartCanvas.getContext('2d');
		
        Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e2e8f0';
        Chart.defaults.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || 'rgba(255, 255, 255, 0.1)';
		
		if (currentChartType === 'doughnut') {
			let labels = [];
			let d = [];
			let bg = [];
			
			for (let i = 0; i < data.chartData.category.labels.length; i++) {
				const cat = data.chartData.category.labels[i];
				const val = filter === 'expense' ? data.chartData.category.expenses[i] 
						 : filter === 'income' ? data.chartData.category.incomes[i] 
						 : data.chartData.category.expenses[i] + data.chartData.category.incomes[i];
				
				if (val > 0) {
					labels.push(cat);
					d.push(val);
					bg.push(allCategoriesMap[cat]?.color || '#999');
				}
			}

			chartInstance = new Chart(ctx, {
				type: 'doughnut',
				data: { labels, datasets: [{ data: d, backgroundColor: bg, borderWidth: 0 }] },
				options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '75%' }
			});
		} else if (currentChartType === 'line') {
			chartInstance = new Chart(ctx, {
				type: 'line',
				data: {
					labels: data.chartData.trend.labels.map(l => l.substring(8,10) + '/' + l.substring(5,7)),
					datasets: [
						{ label: 'Entrate', data: data.chartData.trend.income, borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.1)', fill: true, tension: 0.4 },
						{ label: 'Uscite', data: data.chartData.trend.expense, borderColor: '#e74c3c', backgroundColor: 'rgba(231, 76, 60, 0.1)', fill: true, tension: 0.4 }
					]
				},
				options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
			});
		} else if (currentChartType === 'bar') {
			chartInstance = new Chart(ctx, {
				type: 'bar',
				data: {
					labels: italianMonths.map(m => m.substring(0,3)),
					datasets: [
						{ label: 'Entrate', data: data.chartData.monthly.income, backgroundColor: '#2ecc71', borderRadius: 4 },
						{ label: 'Uscite', data: data.chartData.monthly.expense, backgroundColor: '#e74c3c', borderRadius: 4 }
					]
				},
				options: { responsive: true, maintainAspectRatio: false }
			});
		}
	}

	$effect(() => {
		// Re-render when chart type changes
		renderChart('expense'); // using default filter for simplicity
	});
</script>

<div class="container">
	<!-- Dashboard Cards -->
	<div class="dashboard">
		<div class="summary-card card-income">
			<div class="card-icon"><i class="fas fa-arrow-down"></i></div>
			<div class="card-content">
				<h3>Entrate Totali</h3>
				<p class="amount income-amount">{formatEuro(data.summary.totalIncome)}</p>
			</div>
		</div>

		<div class="summary-card card-expense">
			<div class="card-icon"><i class="fas fa-arrow-up"></i></div>
			<div class="card-content">
				<h3>Uscite Totali</h3>
				<p class="amount expense-amount">{formatEuro(data.summary.totalExpenses)}</p>
			</div>
		</div>

		<div class="summary-card card-balance {data.summary.balance >= 0 ? 'positive' : 'negative'}">
			<div class="card-icon"><i class="fas fa-balance-scale"></i></div>
			<div class="card-content">
				<h3>Bilancio</h3>
				<p class="amount balance-amount">{data.summary.balance >= 0 ? '+' : ''}{formatEuro(data.summary.balance)}</p>
			</div>
		</div>

		<div role="button" tabindex="0" class="summary-card card-cc" style="cursor:pointer; border:1px solid {showCcWidget ? 'var(--accent-blue-light)' : 'transparent'}; transition:var(--transition);" onclick={() => showCcWidget = !showCcWidget} onkeydown={(e) => { if(e.key==='Enter') showCcWidget = !showCcWidget; }}>
			<div class="card-icon" style="background:rgba(52, 152, 219, 0.15); color:{data.ccUnsettledTotal > 0 ? 'var(--accent-orange, #e67e22)' : 'var(--accent-green)'};"><i class="fas fa-credit-card"></i></div>
			<div class="card-content">
				<h3>Carta di Credito</h3>
				<p class="amount" style="color:{data.ccUnsettledTotal > 0 ? 'var(--accent-orange, #e67e22)' : 'var(--accent-green)'}">{formatEuro(data.ccUnsettledTotal)}</p>
				<p style="font-size:0.75rem; color:var(--text-muted); margin-top:6px; display:flex; align-items:center; gap:6px;">
					<i class="fas fa-hourglass-half"></i> {data.ccUnsettledCount} {data.ccUnsettledCount === 1 ? 'spesa' : 'spese'} da saldare
					<i class="fas fa-chevron-{showCcWidget ? 'up' : 'down'}" style="margin-left:auto;"></i>
				</p>
			</div>
		</div>
	</div>

	{#if showCcWidget}
	<div style="margin-top:-15px; margin-bottom:30px; background: linear-gradient(135deg, var(--bg-secondary) 0%, rgba(52, 152, 219, 0.05) 100%); border: 1px solid var(--border-color); border-left: 4px solid var(--accent-blue); padding:20px; border-radius:var(--radius-md); animation: fadeIn 0.2s ease;">
		{#if data.ccUnsettledTotal > 0}
		<div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--border-color);">
			<p style="color:var(--text-muted); font-size:0.875rem;"><i class="fas fa-info-circle"></i> Totale CC in sospeso (non ancora saldato): <strong style="color:var(--accent-orange, #e67e22);">{formatEuro(data.ccUnsettledTotal)}</strong> — {data.ccUnsettledCount} {data.ccUnsettledCount === 1 ? 'transazione' : 'transazioni'}</p>
		</div>
		{:else}
		<div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--border-color);">
			<p style="color:var(--accent-green); font-size:0.875rem;"><i class="fas fa-check-circle"></i> Nessuna spesa CC in sospeso. Tutto saldato!</p>
		</div>
		{/if}
		<form method="POST" action="?/settleCC" use:enhance={({ cancel, formData }) => {
			if (!confirm(`Segna come saldati tutti gli acquisti CC dal ${ccSettleFromDate} al ${ccSettleToDate}?`)) { cancel(); }
			return async ({ update }) => { await update(); };
		}}>
			<div style="color: var(--accent-blue); font-weight:600; margin-bottom:12px; font-size:0.9rem;"><i class="fas fa-check-double"></i> Salda in blocco</div>
			<div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;">
				<div style="display:flex; flex-direction:column; gap:6px;">
					<label style="font-size:0.8rem; color:var(--text-muted); font-weight:600;">Dal:</label>
					<input type="date" name="from_date" bind:value={ccSettleFromDate} style="padding:8px 12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); outline:none;">
				</div>
				<div style="display:flex; flex-direction:column; gap:6px;">
					<label style="font-size:0.8rem; color:var(--text-muted); font-weight:600;">Al:</label>
					<input type="date" name="to_date" bind:value={ccSettleToDate} style="padding:8px 12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-input); color:var(--text-primary); outline:none;">
				</div>
				<button type="submit" style="padding:8px 20px; background:var(--accent-blue); color:white; border:none; border-radius:6px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:8px; transition:opacity 0.2s;" disabled={data.ccUnsettledTotal === 0}>
					<i class="fas fa-check-double"></i> Segna come Saldate
				</button>
			</div>
			{#if data.lastSettledDate}
			<p style="font-size:0.75rem; color:var(--text-muted); margin-top:8px;"><i class="fas fa-history"></i> Ultima CC saldata: {formatDate(data.lastSettledDate)}</p>
			{/if}
		</form>
	</div>
	{/if}


	<!-- Main Content -->
	<div class="main-content">
		<!-- Form Section -->
		<div class="form-section">
            <h2 style="display:flex; justify-content:space-between; align-items:center;">
                <span><i class="fas fa-plus-circle"></i> Nuova Transazione</span>
            </h2>

            {#if form?.error}
                <div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:15px; font-weight:500;">
                    <i class="fas fa-exclamation-circle"></i> {form.error}
                </div>
            {/if}

			<!-- Type Toggle -->
			<div class="type-toggle">
				<button type="button" class="type-btn {formType === 'expense' ? 'active' : ''}" data-type="expense" onclick={() => setType('expense')}>
					<i class="fas fa-arrow-up"></i> Uscita
				</button>
				<button type="button" class="type-btn {formType === 'income' ? 'active' : ''}" data-type="income" onclick={() => setType('income')}>
					<i class="fas fa-arrow-down"></i> Entrata
				</button>
			</div>

			<form method="POST" action="?/addTransaction" enctype="multipart/form-data" use:enhance={({ formData }) => {
				if (compressedReceiptBlob) {
					formData.set('receipt', compressedReceiptBlob, compressedReceiptBlob.type === 'image/webp' ? 'receipt.webp' : receiptFileName);
				}
				return async ({ update }) => {
					await update();
					currentTags = [];
					formType = 'expense';
                    compressedReceiptBlob = null;
                    receiptFileName = '';
                    const fInput = document.getElementById('receipt_file') as HTMLInputElement;
                    if (fInput) fInput.value = '';
				};
			}}>
				<input type="hidden" name="type" value={formType}>

				<div class="form-group">
					<label for="description">Descrizione</label>
					<input type="text" id="description" name="description" required placeholder="Per cosa è questa transazione?" list="desc_list">
				</div>

				<div class="form-group">
					<label>Tags (premi Invio o Virgola)</label>
					<div class="tags-input-container">
						{#each currentTags as t, i}
							<span class="tag-pill">
								{t} <button type="button" onclick={() => currentTags.splice(i, 1)}><i class="fas fa-times"></i></button>
							</span>
						{/each}
						<input type="text" placeholder="Aggiungi tag..." list="tags_list" onkeydown={(e) => handleTagInput(e, false)}>
						<input type="hidden" name="tags" value={JSON.stringify(currentTags)}>
					</div>
				</div>

				<div class="form-row">
					<div class="form-group">
						<label for="amount">Importo (€)</label>
						<input type="number" id="amount" name="amount" min="0.01" step="0.01" required placeholder="0,00">
					</div>
					<div class="form-group">
						<label for="date">Data</label>
						<input type="date" id="date" name="date" required value={new Date().toISOString().split('T')[0]}>
					</div>
				</div>

				<div class="form-group">
					<label for="category">Categoria</label>
					<select id="category" name="category" required>
						{#if formType === 'expense'}
							<optgroup label="— Categorie Uscite —">
								{#each data.expenseCategories as cat}
									<option value={cat.name}>{cat.name}</option>
								{/each}
							</optgroup>
						{:else}
							<optgroup label="— Categorie Entrate —">
								{#each data.incomeCategories as cat}
									<option value={cat.name}>{cat.name}</option>
								{/each}
							</optgroup>
						{/if}
					</select>
				</div>

				<div class="form-group" style="margin-top:15px; margin-bottom:20px;">
					<label for="receipt_file"><i class="fas fa-paperclip"></i> Allega Scontrino / Ricevuta (Opzionale)</label>
					<input type="file" id="receipt_file" accept="image/*,application/pdf" onchange={handleFileSelect} style="background:var(--bg-input); padding:10px; border-radius:8px; width:100%; color:var(--text-primary); border:1px solid var(--border-color);">
                    {#if compressedReceiptBlob && receiptFileName}
                        <div style="font-size:0.8rem; color:var(--accent-green); margin-top:5px; font-weight:600;"><i class="fas fa-check-circle"></i> {receiptFileName} pronto ({Math.round(compressedReceiptBlob.size / 1024)} KB)</div>
                    {/if}
				</div>

                {#if formType === 'expense'}
				<div class="form-group" style="margin-bottom:20px;">
					<label for="payment_method"><i class="fas fa-credit-card"></i> Metodo Pagamento</label>
					<select id="payment_method" name="payment_method" required bind:value={newPaymentMethod}>
						<option value="bancomat">Conto / Bancomat</option>
						<option value="credit_card">Carta di Credito</option>
						<option value="cash">Contanti</option>
					</select>
				</div>
				{#if newPaymentMethod === 'credit_card'}
				<div class="form-group" style="margin-bottom:20px;">
					<label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-size:0.9rem;">
						<input type="checkbox" name="settled" value="1" style="width:18px; height:18px; accent-color:var(--accent-green); cursor:pointer;">
						<span><i class="fas fa-check-circle" style="color:var(--accent-green);"></i> Già saldato (la spesa non risulterà in sospeso)</span>
					</label>
				</div>
				{/if}
                {/if}

				<button type="submit" class="btn-submit {formType === 'income' ? 'income-mode' : ''}">
					<i class="fas fa-save"></i> Aggiungi {formType === 'income' ? 'Entrata' : 'Uscita'}
				</button>
			</form>

		</div>

		<!-- Chart Section -->
		<div class="chart-section">
			<h2><i class="fas fa-chart-pie"></i> Panoramica</h2>
			<div class="chart-container">
				<canvas bind:this={chartCanvas}></canvas>
			</div>
			<div class="chart-toggles">
				<button class="chart-btn {currentChartType === 'doughnut' ? 'active' : ''}" onclick={() => currentChartType = 'doughnut'}>
					<i class="fas fa-chart-pie"></i> Ciambella
				</button>
				<button class="chart-btn {currentChartType === 'bar' ? 'active' : ''}" onclick={() => currentChartType = 'bar'}>
					<i class="fas fa-chart-bar"></i> Mensile
				</button>
				<button class="chart-btn {currentChartType === 'line' ? 'active' : ''}" onclick={() => currentChartType = 'line'}>
					<i class="fas fa-chart-line"></i> Trend
				</button>
			</div>
		</div>
	</div>

	<!-- Recent Transactions -->
	<div class="recent-transactions">
		<h2 style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
			<span><i class="fas fa-list"></i> Storico Transazioni</span>
			<div style="font-size:0.85rem; display:flex; gap:15px; align-items:center; font-weight:normal;">
				<button 
					type="button" 
					onclick={() => showSearch = !showSearch}
					style="background:none; border:none; color: {showSearch ? 'var(--accent-blue)' : 'var(--text-muted)'}; cursor:pointer; font-size:1.1rem; padding:5px; transition:all 0.2s;"
					class="search-toggle-btn"
					title="Cerca transazioni"
				>
					<i class="fas fa-search"></i>
				</button>
				<div style="display:flex; gap:8px; align-items:center;">
					<span>Mostra:</span>
					<select bind:value={itemsPerPage} onchange={() => currentPage = 1} style="padding:4px; border-radius:4px; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-color);">
						<option value={10}>10</option>
						<option value={15}>15</option>
						<option value={25}>25</option>
						<option value={50}>50</option>
						<option value={100}>100</option>
					</select>
				</div>
			</div>
		</h2>

		{#if showSearch}
		<div class="search-panel" transition:slide={{ duration: 300 }}>
			<div class="search-grid">
				<div class="search-field">
					<label for="search_term">Descrizione</label>
					<input id="search_term" type="text" bind:value={searchTerm} placeholder="Cerca descrizione...">
				</div>
				<div class="search-field">
					<label for="search_cat">Categoria</label>
					<select id="search_cat" bind:value={searchCategory}>
						<option value="">Tutte le categorie</option>
						{#each data.expenseCategories as cat}
							<option value={cat.name}>{cat.name}</option>
						{/each}
						{#each data.incomeCategories as cat}
							<option value={cat.name}>{cat.name}</option>
						{/each}
					</select>
				</div>
				<div class="search-field">
					<label for="search_type">Tipo</label>
					<select id="search_type" bind:value={searchType}>
						<option value="">Tutti</option>
						<option value="income">Solo Entrate</option>
						<option value="expense">Solo Uscite</option>
					</select>
				</div>
				<div class="search-field">
					<label for="search_min">Importo Min</label>
					<input id="search_min" type="number" step="0.01" bind:value={searchMinAmount} placeholder="€">
				</div>
				<div class="search-field">
					<label for="search_max">Importo Max</label>
					<input id="search_max" type="number" step="0.01" bind:value={searchMaxAmount} placeholder="€">
				</div>
				<div class="search-field">
					<label for="search_from">Da data</label>
					<input id="search_from" type="date" bind:value={searchFromDate}>
				</div>
				<div class="search-field">
					<label for="search_to">A data</label>
					<input id="search_to" type="date" bind:value={searchToDate}>
				</div>
				<div class="search-field">
					<label for="search_attachment">Allegato</label>
					<select id="search_attachment" bind:value={searchAttachment}>
						<option value="">Tutti</option>
						<option value="with">Con allegato</option>
						<option value="without">Senza allegato</option>
					</select>
				</div>
				<div class="search-actions">
					<button type="button" class="btn-clear-filters" onclick={() => {
						searchTerm = ''; searchCategory = ''; searchType = '';
						searchMinAmount = null; searchMaxAmount = null;
						searchFromDate = ''; searchToDate = ''; searchAttachment = '';
					}}>
						<i class="fas fa-filter-circle-xmark"></i> Pulisci Filtri
					</button>
				</div>
			</div>
		</div>
		{/if}
		{#if data.allTransactions.length === 0}
			<p class="no-transactions">Nessuna transazione registrata. Inizia aggiungendo la prima!</p>
		{:else}
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
							<th>Azioni</th>
						</tr>
					</thead>
					<tbody>
						{#each paginatedTransactions as t}
						<tr class="transaction-row {t.type}-row">
							<td data-label="Data">{formatDate(t.date)}</td>
							<td data-label="Descrizione">
                                {t.description}
                                {#if t.paymentMethod === 'credit_card'}
                                    <i class="fas fa-credit-card" style="color:{t.settled ? 'var(--accent-green)' : 'var(--accent-orange, #e67e22)'}; font-size: 0.85rem; margin-left:6px;" title="{t.settled ? 'CC Saldato' : 'CC Non ancora saldato'}"></i>
                                {/if}
                                {#if t.tags && t.tags.includes('Ricorrente')}
                                    <i class="fas fa-sync-alt" style="color:var(--accent-green); font-size: 0.85rem; margin-left:4px;" title="Spesa Autogenerata"></i>
                                {/if}
                                {#if t.receiptPath}
                                    <a href={t.receiptPath} target="_blank" rel="external" data-sveltekit-reload title="Vedi Ricevuta/Scontrino" style="margin-left:6px; color:var(--accent-blue); text-decoration:none;">
                                        <i class="fas fa-paperclip"></i>
                                    </a>
                                {/if}
                                {#if t.createdBy}
                                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                                        <i class="fas fa-user" style="font-size:0.65rem;"></i> {data.allUsers.find(u => u.id === t.createdBy)?.displayName || 'Sconosciuto'}
                                    </div>
                                {/if}
                            </td>
							<td data-label="Categoria">
								<span class="category-tag" style="background-color: {allCategoriesMap[t.category]?.color || '#999'}">
									{t.category}
								</span>
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
							<td data-label="Azioni" style="display:flex; gap:8px; border:none;">
                                <button class="edit-btn" title="Modifica" onclick={() => editTransaction(t)} style="background:var(--bg-secondary); color:var(--text-color); border:1px solid var(--border-color); padding:6px 10px; border-radius:4px; cursor:pointer;">
                                    <i class="fas fa-edit"></i>
                                </button>
								<form method="POST" action="?/deleteTransaction" use:enhance={({ cancel }) => { if(!confirm(`Confermi l'eliminazione definitiva di questa transazione?`)) cancel(); }} class="inline" style="margin:0;">
									<input type="hidden" name="id" value={t.id}>
									<button class="delete-btn" title="Elimina" style="padding:6px 10px;">
										<i class="fas fa-trash-alt"></i>
									</button>
								</form>
							</td>
						</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; font-size:0.9rem; color:var(--text-muted);">
				<span>Pagina {currentPage} di {totalPages}</span>
				<div style="display:flex; gap:10px;">
					<button disabled={currentPage === 1} onclick={() => currentPage--} style="padding:6px 12px; background:var(--bg-card); border:1px solid var(--border-color); color:var(--text-primary); border-radius:4px; cursor:pointer; opacity: {currentPage === 1 ? '0.5' : '1'};">Precedente</button>
					<button disabled={currentPage === totalPages} onclick={() => currentPage++} style="padding:6px 12px; background:var(--bg-card); border:1px solid var(--border-color); color:var(--text-primary); border-radius:4px; cursor:pointer; opacity: {currentPage === totalPages ? '0.5' : '1'};">Successivo</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Edit Transaction Modal -->
{#if editingTransaction}
<div class="modal-backdrop" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); display:flex; justify-content:center; align-items:center; z-index:9999; padding:20px;">
    <div class="modal-content" style="background:var(--bg-color); width:100%; max-width:500px; border-radius:12px; padding:25px; box-shadow:0 10px 30px rgba(0,0,0,0.3);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <h2 style="margin:0; font-size:1.3rem;"><i class="fas fa-edit"></i> Modifica Transazione</h2>
            <button onclick={closeEdit} style="background:none; border:none; font-size:1.5rem; color:var(--text-muted); cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>

        {#if form?.error}
            <div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:15px; font-weight:500;">
                <i class="fas fa-exclamation-circle"></i> {form.error}
            </div>
        {/if}

        <form method="POST" action="?/editTransaction" enctype="multipart/form-data" use:enhance={({ formData }) => {
            if (compressedReceiptBlob) {
                formData.set('receipt', compressedReceiptBlob, compressedReceiptBlob.type === 'image/webp' ? 'receipt.webp' : receiptFileName);
            }
            return async ({ update }) => { 
                await update(); 
                closeEdit(); 
                compressedReceiptBlob = null;
                receiptFileName = '';
            }; 
        }}>
            <input type="hidden" name="id" value={editingTransaction.id}>
            <input type="hidden" name="type" value={editingTransaction.type}>

            <div class="form-group">
                <label>Descrizione</label>
                <input type="text" name="description" required list="desc_list" bind:value={editingTransaction.description}>
            </div>

            <div class="form-group" style="margin-top:15px; margin-bottom:15px;">
                <label>Tags (premi Invio o Virgola)</label>
                <div class="tags-input-container">
                    {#each editTags as t, i}
                        <span class="tag-pill">
                            {t} <button type="button" onclick={() => editTags.splice(i, 1)}><i class="fas fa-times"></i></button>
                        </span>
                    {/each}
                    <input type="text" placeholder="Tag..." list="tags_list" onkeydown={(e) => handleTagInput(e, true)}>
                    <input type="hidden" name="tags" value={JSON.stringify(editTags)}>
                </div>
            </div>

            <div class="form-group" style="margin-bottom:15px;">
                <label><i class="fas fa-paperclip"></i> Scontrino (Lascia vuoto per mantenere inalterato)</label>
                <input type="file" id="edit_receipt_file" accept="image/*,application/pdf" onchange={handleFileSelect} style="background:var(--bg-input); padding:10px; border-radius:8px; width:100%; color:var(--text-primary); border:1px solid var(--border-color);">
                {#if compressedReceiptBlob && receiptFileName}
                    <div style="font-size:0.8rem; color:var(--accent-green); margin-top:5px; font-weight:600;"><i class="fas fa-check-circle"></i> Nuovo file pronto: {receiptFileName} ({Math.round(compressedReceiptBlob.size / 1024)} KB)</div>
                {/if}
                {#if editingTransaction.receiptPath && !compressedReceiptBlob}
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:8px; display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.1); padding:8px; border-radius:6px;">
                        <span><i class="fas fa-paperclip"></i> File attuale: <a href={editingTransaction.receiptPath} target="_blank" rel="external" data-sveltekit-reload style="color:var(--accent-blue); text-decoration:none;">Vedi allegato</a></span>
                        <label style="display:flex; align-items:center; gap:5px; color:var(--accent-red); cursor:pointer; font-weight:600;">
                            <input type="checkbox" name="delete_receipt" value="true">
                            <i class="fas fa-trash-alt"></i> Rimuovi
                        </label>
                    </div>
                {/if}
            </div>

            <div class="form-row" style="display:flex; gap:15px; margin-bottom:15px;">
                <div class="form-group" style="flex:1;">
                    <label>Importo (€)</label>
                    <input type="number" name="amount" min="0.01" step="0.01" required bind:value={editingTransaction.amount}>
                </div>
                <div class="form-group" style="flex:1;">
                    <label>Data</label>
                    <input type="date" name="date" required bind:value={editingTransaction.date}>
                </div>
            </div>

            <div class="form-group" style="margin-bottom:15px;">
                <label>Categoria</label>
                <select name="category" required bind:value={editingTransaction.category}>
                    {#if editingTransaction.type === 'expense'}
                        <optgroup label="— Categorie Uscite —">
                            {#each data.expenseCategories as cat}
                                <option value={cat.name}>{cat.name}</option>
                            {/each}
                        </optgroup>
                    {:else}
                        <optgroup label="— Categorie Entrate —">
                            {#each data.incomeCategories as cat}
                                <option value={cat.name}>{cat.name}</option>
                            {/each}
                        </optgroup>
                    {/if}
                </select>
            </div>

            {#if editingTransaction.type === 'expense'}
            <div class="form-group" style="margin-bottom:20px;">
                <label><i class="fas fa-credit-card"></i> Metodo Pagamento</label>
                <select name="payment_method" required bind:value={editingTransaction.paymentMethod}>
                    <option value="bancomat">Conto / Bancomat</option>
                    <option value="credit_card">Carta di Credito</option>
                    <option value="cash">Contanti</option>
                </select>
            </div>
            {#if editingTransaction.paymentMethod === 'credit_card'}
            <div class="form-group" style="margin-bottom:20px;">
                <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-size:0.9rem;">
                    <input type="checkbox" name="settled" value="1" checked={editingTransaction.settled === 1} onchange={(e) => editingTransaction.settled = (e.target as HTMLInputElement).checked ? 1 : 0} style="width:18px; height:18px; accent-color:var(--accent-green); cursor:pointer;">
                    <span><i class="fas fa-check-circle" style="color:var(--accent-green);"></i> Saldato (non risulterà più in sospeso)</span>
                </label>
                <input type="hidden" name="settled" value={editingTransaction.settled || 0}>
            </div>
            {/if}
            {/if}

            <button type="submit" class="btn-submit" style="width:100%;">
                <i class="fas fa-save"></i> Salva Modifiche
            </button>
        </form>
    </div>
</div>
{/if}

<datalist id="desc_list">
	{#each data.uniqueDescriptions as desc}
		<option value={desc}></option>
	{/each}
</datalist>

<datalist id="tags_list">
	{#each data.uniqueTags as tag}
		<option value={tag}></option>
	{/each}
</datalist>

<style>
.tags-input-container { display:flex; flex-wrap:wrap; gap:8px; padding:8px; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--bg-input); align-items:center; }
.tags-input-container input[type=text] { border:none; background:transparent; outline:none; flex:1; min-width:120px; color:var(--text-primary); padding:0; height:auto; }
.tags-input-container input[type=text]:focus { outline:none; box-shadow:none; }
.tag-pill { display:flex; align-items:center; gap:6px; background:var(--primary-color); color:white; padding:4px 10px; border-radius:20px; font-size:0.8rem; font-weight:600; }
.tag-pill button { background:none; border:none; color:white; opacity:0.7; cursor:pointer; padding:0; display:flex; align-items:center; }
.tag-pill button:hover { opacity:1; }

.search-panel { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px; margin: 15px 0 25px; box-shadow: var(--shadow-sm); border-left: 4px solid var(--accent-blue); }
.search-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; align-items: flex-end; }
.search-field { display: flex; flex-direction: column; gap: 6px; }
.search-field label { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.search-field input, .search-field select { padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-primary); outline: none; transition: all 0.2s; font-size: 0.9rem; }
.search-field input:focus, .search-field select:focus { border-color: var(--accent-blue); box-shadow: 0 0 0 2px var(--accent-blue-glow); }
.btn-clear-filters { padding: 10px 16px; background: none; border: 1px dashed var(--border-color); border-radius: var(--radius-sm); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.9rem; transition: all 0.2s; margin-top: 5px; width: fit-content; }
.btn-clear-filters:hover { border-color: var(--accent-red); color: var(--accent-red); background: var(--accent-red-glow); }
.search-toggle-btn:hover { color: var(--accent-blue) !important; transform: translateY(-1px); }
</style>
