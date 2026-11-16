<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import Chart from 'chart.js/auto';
	import '../../app.css';

	let { data, form } = $props();
	let editing: any = $state(null);
	let kind: 'asset' | 'liability' = $state('asset');
	$effect(() => { if (editing) kind = editing.kind; });

	const eur = (n: number) => '€' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	let categories = $derived(kind === 'asset' ? data.assetCategories : data.liabilityCategories);
	let owned = $derived(data.assets.filter((a) => a.kind === 'asset'));
	let owed = $derived(data.assets.filter((a) => a.kind === 'liability'));

	let canvas: HTMLCanvasElement;
	let chart: any = null;
	function render() {
		if (chart) chart.destroy();
		if (!canvas) return;
		const css = getComputedStyle(document.documentElement);
		Chart.defaults.color = css.getPropertyValue('--text-primary').trim() || '#e2e8f0';
		Chart.defaults.borderColor = css.getPropertyValue('--border-color').trim() || 'rgba(255,255,255,0.1)';
		const h = data.history;
		chart = new Chart(canvas.getContext('2d')!, {
			type: 'line',
			data: {
				labels: h.labels,
				datasets: [
					{ label: 'Patrimonio netto', data: h.net, borderColor: '#4361ee', backgroundColor: 'rgba(67,97,238,0.12)', fill: true, tension: 0.25, borderWidth: 3 },
					{ label: 'Conti', data: h.accounts, borderColor: '#2ecc71', tension: 0.25, borderWidth: 2, pointRadius: 0 },
					{ label: 'Beni e investimenti', data: h.assets, borderColor: '#f39c12', tension: 0.25, borderWidth: 2, pointRadius: 0 },
					{ label: 'Debiti', data: h.liabilities.map((v) => -v), borderColor: '#e74c3c', tension: 0.25, borderWidth: 2, pointRadius: 0 }
				]
			},
			options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false } }
		});
	}
	onMount(() => { render(); return () => chart?.destroy(); });
</script>

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-landmark"></i> Patrimonio netto</h1>
		<p class="page-subtitle">Conti, beni, investimenti e debiti: quanto vale la famiglia, e come cambia nel tempo.</p>
	</div>

	{#if form?.error}
		<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-exclamation-circle"></i> {form.error}</div>
	{/if}

	<div class="dashboard">
		<div class="summary-card card-balance {data.netWorth >= 0 ? 'positive' : 'negative'}">
			<div class="card-content"><h3>Patrimonio netto</h3><p class="amount">{eur(data.netWorth)}</p></div>
		</div>
		<div class="summary-card"><div class="card-content"><h3>Liquidità sui conti</h3><p class="amount">{eur(data.liquid)}</p></div></div>
		<div class="summary-card"><div class="card-content"><h3>Beni e investimenti</h3><p class="amount income-amount">{eur(data.totals.assets)}</p></div></div>
		<div class="summary-card"><div class="card-content"><h3>Debiti</h3><p class="amount expense-amount">{eur(data.totals.liabilities)}</p></div></div>
	</div>

	<div class="form-section" style="margin-bottom:24px;">
		<h2><i class="fas fa-chart-line"></i> Ultimi 24 mesi</h2>
		<div class="chart-container" style="height:300px;"><canvas bind:this={canvas}></canvas></div>
		<p class="month-note">Conti: saldo a fine mese dei conti definiti in Categorie → Conti. Beni e debiti: l'ultimo valore che hai registrato fino a quel mese.</p>
	</div>

	<div class="main-content">
		<div class="form-section">
			<h2><i class="fas fa-plus-circle"></i> {editing ? 'Aggiorna voce' : 'Nuova voce'}</h2>
			<form method="POST" action={editing ? '?/edit' : '?/add'} use:enhance={() => async ({ update }) => { await update(); editing = null; kind = 'asset'; }}>
				{#if editing}<input type="hidden" name="id" value={editing.id}>{/if}
				<div class="form-group">
					<label for="kind">È un…</label>
					<select id="kind" name="kind" bind:value={kind}>
						<option value="asset">Bene o investimento (valore positivo)</option>
						<option value="liability">Debito (mutuo, prestito)</option>
					</select>
				</div>
				<div class="form-group">
					<label for="name">Nome</label>
					<input type="text" id="name" name="name" required maxlength="80" placeholder={kind === 'asset' ? 'Es. Casa, Fondo pensione, Auto' : 'Es. Mutuo prima casa'} value={editing?.name ?? ''}>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label for="category">Categoria</label>
						<select id="category" name="category" value={editing?.category ?? 'Altro'}>{#each categories as c}<option>{c}</option>{/each}</select>
					</div>
					<div class="form-group">
						<label for="value">{kind === 'asset' ? 'Valore attuale (€)' : 'Residuo da pagare (€)'}</label>
						<input type="number" id="value" name="value" min="0" step="0.01" required value={editing?.value ?? ''}>
					</div>
				</div>
				<div class="form-group">
					<label for="note">Nota</label>
					<input type="text" id="note" name="note" maxlength="200" value={editing?.note ?? ''}>
				</div>
				<button type="submit" class="btn-submit btn-primary-action"><i class="fas fa-save"></i> Salva</button>
				{#if editing}<button type="button" class="btn-submit btn-secondary" style="margin-top:8px;" onclick={() => { editing = null; kind = 'asset'; }}>Annulla</button>{/if}
				<p class="month-note">Aggiorna il valore ogni tanto (es. a fine trimestre): lo storico serve per il grafico.</p>
			</form>
		</div>

		<div class="recent-transactions">
			{#each [{ title: 'Beni e investimenti', rows: owned }, { title: 'Debiti', rows: owed }] as block}
				<h2>{block.title}</h2>
				<div class="table-responsive" style="margin-bottom:24px;">
					<table class="table">
						<thead><tr><th>Nome</th><th>Categoria</th><th style="text-align:right;">Valore</th><th>Aggiornato</th><th></th></tr></thead>
						<tbody>
							{#each block.rows as a (a.id)}
								<tr>
									<td>{a.name}{#if a.note}<br><small style="color:var(--text-muted);">{a.note}</small>{/if}</td>
									<td>{a.category}</td>
									<td style="text-align:right; font-weight:600;">{eur(a.value)}</td>
									<td>{a.updatedAt.split('-').reverse().join('/')}</td>
									<td style="white-space:nowrap;">
										<button class="edit-btn" title="Modifica" onclick={() => (editing = a)}><i class="fas fa-edit"></i></button>
										<form method="POST" action="?/delete" use:enhance={({ cancel }) => { if (!confirm('Eliminare questa voce e il suo storico?')) cancel(); }} class="inline">
											<input type="hidden" name="id" value={a.id}>
											<button class="delete-btn" title="Elimina"><i class="fas fa-trash-alt"></i></button>
										</form>
									</td>
								</tr>
							{:else}
								<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Nessuna voce.</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
		</div>
	</div>
</div>
