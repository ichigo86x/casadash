<script lang="ts">
	import { base } from '$app/paths';
	import { deserialize } from '$app/forms';
	import { applyMapping, guessHeaderRow, guessMapping, parseCsv, type Mapping, type ParsedRow } from '$lib/import';

	let { data } = $props();

	const formatEuro = (n: number) => '€' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const formatDate = (d: string) => d.split('-').reverse().join('/');

	// Step 1: file
	let fileName = $state('');
	let rows: string[][] = $state([]);
	let mapping = $state<Mapping | null>(null);
	let error = $state('');

	// Step 2: options
	let account = $state(data.accounts[0] || '');
	let paymentMethod = $state('bancomat');
	let settled = $state(true);
	let includeIncomes = $state(false);
	let defaultExpense = $state(data.expenseCategories.includes('Altro') ? 'Altro' : data.expenseCategories[0] || 'Altro');
	let defaultIncome = $state(data.incomeCategories.includes('Altro') ? 'Altro' : data.incomeCategories[0] || 'Altro');

	// Step 3: reviewed rows
	type Match = { description: string; amount: number; category: string; paymentMethod: string; tags: string[] };
	type ReviewRow = ParsedRow & {
		include: boolean;
		category: string;
		transfer: boolean;
		duplicate: string | null;
		matches: Match[];
		suggested: boolean;
		editing: boolean;
		showMatches: boolean;
	};
	const paymentLabels: Record<string, string> = { bancomat: 'Conto / Bancomat', credit_card: 'Carta di credito', cash: 'Contanti' };
	const matchTooltip = (m: Match[]) =>
		'Già registrato:\n' + m.map((x) => `• ${x.description} — ${formatEuro(x.amount)} · ${x.category}${x.tags.length ? ' · ' + x.tags.join(', ') : ''}`).join('\n');

	// Focuses the description field as soon as it appears
	function autofocus(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
	let review: ReviewRow[] = $state([]);
	let busy = $state(false);
	let imported = $state<number | null>(null);

	let header = $derived(mapping ? rows[mapping.headerRow] || [] : []);
	let signature = $derived(header.join('|'));
	let result = $derived(mapping ? applyMapping(rows, mapping) : { parsed: [], skipped: [] });
	let candidates = $derived(result.parsed.filter((r) => includeIncomes || r.amount < 0));
	let selected = $derived(review.filter((r) => r.include));
	let selectedExpense = $derived(selected.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0));

	async function readFile(file: File): Promise<string> {
		const buffer = await file.arrayBuffer();
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
		} catch {
			// Many Italian banks still export in Windows-1252
			return new TextDecoder('windows-1252').decode(buffer);
		}
	}

	async function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		error = '';
		review = [];
		imported = null;
		if (!file) return;
		if (/\.xlsx?$/i.test(file.name)) {
			error = 'I file Excel non sono ancora supportati: aprilo e salvalo come CSV, poi caricalo di nuovo.';
			return;
		}
		fileName = file.name;
		rows = parseCsv(await readFile(file));
		if (rows.length < 2) {
			error = 'Il file non contiene righe leggibili.';
			mapping = null;
			return;
		}
		const remembered = data.profiles[rows[guessHeaderRow(rows)]?.join('|')];
		mapping = remembered ? { ...remembered } : guessMapping(rows);
	}

	function toggleDescription(col: number) {
		if (!mapping) return;
		const i = mapping.description.indexOf(col);
		if (i >= 0) mapping.description.splice(i, 1);
		else mapping.description.push(col);
	}

	async function post(action: string, form: FormData) {
		const res = await fetch(`?/${action}`, { method: 'POST', body: form, headers: { 'x-sveltekit-action': 'true' } });
		return deserialize(await res.text());
	}

	async function analyze() {
		busy = true;
		error = '';
		const form = new FormData();
		form.set('rows', JSON.stringify(candidates.map(({ date, description, amount }) => ({ date, description, amount }))));
		const res = await post('preview', form);
		busy = false;
		if (res.type !== 'success') {
			error = res.type === 'failure' ? String(res.data?.error) : 'Analisi non riuscita.';
			return;
		}
		const suggestions = res.data?.suggestions as { category: string | null; duplicate: string | null; matches: Match[] }[];
		review = candidates.map((r, i) => ({
			...r,
			duplicate: suggestions[i].duplicate,
			matches: suggestions[i].matches || [],
			editing: false,
			showMatches: false,
			include: suggestions[i].duplicate !== 'exact',
			category: suggestions[i].category || (r.amount < 0 ? defaultExpense : defaultIncome),
			suggested: !!suggestions[i].category,
			transfer: false
		}));
	}

	async function doImport() {
		if (!mapping || selected.length === 0) return;
		busy = true;
		error = '';
		const form = new FormData();
		form.set('rows', JSON.stringify(selected.map(({ date, description, amount, category, transfer }) => ({ date, description, amount, category, transfer }))));
		form.set('account', account);
		form.set('payment_method', paymentMethod);
		if (settled) form.set('settled', 'on');
		form.set('signature', signature);
		form.set('mapping', JSON.stringify(mapping));
		const res = await post('import', form);
		busy = false;
		if (res.type === 'success') {
			imported = res.data?.imported as number;
			review = [];
		} else {
			error = res.type === 'failure' ? String(res.data?.error) : 'Importazione non riuscita.';
		}
	}

	const setAll = (include: boolean) => review.forEach((r) => (r.include = include));
</script>

<svelte:head>
	<title>Importa movimenti - CasaDash</title>
</svelte:head>

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-file-import"></i> Importa dal conto corrente</h1>
		<p class="page-subtitle">Carica l'export CSV dei movimenti della banca, controlla l'anteprima e importa le uscite</p>
	</div>

	{#if error}
		<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;">
			<i class="fas fa-exclamation-circle"></i> {error}
		</div>
	{/if}

	{#if imported !== null}
		<div class="panel" style="border-left:4px solid var(--accent-green);">
			<p style="margin:0;"><i class="fas fa-check-circle" style="color:var(--accent-green);"></i> Importati <strong>{imported}</strong> movimenti con il tag <code>Importato</code>.</p>
			<p class="muted" style="margin-top:6px;">Per rivederli usa la ricerca in <a href="{base}/">Dashboard</a> o filtra il tag <code>Importato</code> nei <a href="{base}/reports">Report</a>.</p>
		</div>
	{/if}

	<!-- Step 1 -->
	<div class="panel">
		<h2><span class="step">1</span> File della banca</h2>
		<input type="file" accept=".csv,.txt,text/csv" onchange={onFile}>
		<p class="muted">Formato CSV (separatore <code>;</code>, <code>,</code> o tabulazione). Da Excel: <em>File → Salva con nome → CSV</em>.</p>
	</div>

	{#if mapping}
	<!-- Step 2 -->
	<div class="panel">
		<h2><span class="step">2</span> Colonne di <em>{fileName}</em></h2>
		<div class="grid">
			<label>Riga di intestazione
				<input type="number" min="1" max={rows.length} value={mapping.headerRow + 1} onchange={(e) => mapping && (mapping.headerRow = Math.max(0, Math.min(rows.length - 1, +e.currentTarget.value - 1)))}>
			</label>
			<label>Data
				<select bind:value={mapping.date}>{#each header as h, i}<option value={i}>{h || `Colonna ${i + 1}`}</option>{/each}</select>
			</label>
			<label>Importo
				<select bind:value={mapping.amountMode}>
					<option value="single">Una colonna con segno (− = uscita)</option>
					<option value="split">Due colonne: addebiti e accrediti</option>
				</select>
			</label>
			{#if mapping.amountMode === 'single'}
				<label>Colonna importo
					<select bind:value={mapping.amount}>{#each header as h, i}<option value={i}>{h || `Colonna ${i + 1}`}</option>{/each}</select>
				</label>
				<label class="check"><input type="checkbox" bind:checked={mapping.invert}> Le uscite sono numeri positivi</label>
			{:else}
				<label>Addebiti (uscite)
					<select bind:value={mapping.debit}>{#each header as h, i}<option value={i}>{h || `Colonna ${i + 1}`}</option>{/each}</select>
				</label>
				<label>Accrediti (entrate)
					<select bind:value={mapping.credit}>{#each header as h, i}<option value={i}>{h || `Colonna ${i + 1}`}</option>{/each}</select>
				</label>
			{/if}
		</div>
		<p class="label-title">Descrizione (una o più colonne)</p>
		<div class="chips">
			{#each header as h, i}
				<button type="button" class="chip {mapping.description.includes(i) ? 'on' : ''}" onclick={() => toggleDescription(i)}>{h || `Colonna ${i + 1}`}</button>
			{/each}
		</div>

		<p class="muted" style="margin-top:12px;">
			Righe lette: <strong>{result.parsed.length}</strong>
			({result.parsed.filter((r) => r.amount < 0).length} uscite, {result.parsed.filter((r) => r.amount > 0).length} entrate)
			{#if result.skipped.length} · {result.skipped.length} ignorate (righe di saldo, intestazioni o senza importo){/if}
		</p>
		{#if result.parsed.length}
			<div class="table-responsive">
				<table class="mini">
					<thead><tr><th>Data</th><th>Descrizione</th><th>Importo</th></tr></thead>
					<tbody>
						{#each result.parsed.slice(0, 5) as r}
							<tr><td>{formatDate(r.date)}</td><td>{r.description}</td><td class={r.amount < 0 ? 'expense-amount' : 'income-amount'}>{formatEuro(r.amount)}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		{#if result.skipped.length}
			<details><summary class="muted">Righe ignorate</summary>
				<ul class="muted">{#each result.skipped.slice(0, 20) as s}<li>Riga {s.line}: {s.reason} — <code>{s.raw}</code></li>{/each}</ul>
			</details>
		{/if}
	</div>

	<!-- Step 3 -->
	<div class="panel">
		<h2><span class="step">3</span> Opzioni</h2>
		<div class="grid">
			<label>Conto
				<select bind:value={account}>
					<option value="">Nessuno</option>
					{#each data.accounts as a}<option value={a}>{a}</option>{/each}
				</select>
			</label>
			<label>Metodo di pagamento
				<select bind:value={paymentMethod}>
					<option value="bancomat">Conto / Bancomat</option>
					<option value="credit_card">Carta di credito</option>
					<option value="cash">Contanti</option>
				</select>
			</label>
			{#if paymentMethod === 'credit_card'}
				<label class="check"><input type="checkbox" bind:checked={settled}> Già saldate</label>
			{/if}
			<label>Categoria predefinita uscite
				<select bind:value={defaultExpense}>{#each data.expenseCategories as c}<option value={c}>{c}</option>{/each}</select>
			</label>
			<label class="check"><input type="checkbox" bind:checked={includeIncomes}> Importa anche le entrate</label>
			{#if includeIncomes}
				<label>Categoria predefinita entrate
					<select bind:value={defaultIncome}>{#each data.incomeCategories as c}<option value={c}>{c}</option>{/each}</select>
				</label>
			{/if}
		</div>
		{#if data.accounts.length === 0}
			<p class="muted">Suggerimento: elenca i tuoi conti in <a href="{base}/settings/categories">Categorie → Conti</a> per assegnare i movimenti importati al conto giusto.</p>
		{/if}
		<button type="button" class="btn-submit" style="width:auto; margin-top:10px;" disabled={busy || candidates.length === 0} onclick={analyze}>
			<i class="fas {busy ? 'fa-spinner fa-spin' : 'fa-search'}"></i> Analizza {candidates.length} movimenti
		</button>
	</div>
	{/if}

	{#if review.length}
	<!-- Step 4 -->
	<div class="panel">
		<h2><span class="step">4</span> Controlla e importa</h2>
		<p class="muted">
			La categoria è suggerita dai movimenti già registrati con la stessa descrizione (<i class="fas fa-magic"></i>).
			I possibili doppioni sono segnalati; quelli identici sono già esclusi.
			Spunta <i class="fas fa-exchange-alt"></i> per i giroconti verso altri tuoi conti: non conteranno come uscite.
		</p>
		<div style="display:flex; gap:10px; margin:10px 0;">
			<button type="button" class="chip" onclick={() => setAll(true)}>Seleziona tutti</button>
			<button type="button" class="chip" onclick={() => setAll(false)}>Deseleziona tutti</button>
		</div>
		<div class="table-responsive">
			<table>
				<thead><tr><th></th><th>Data</th><th>Descrizione</th><th>Importo</th><th>Categoria</th><th title="Trasferimento tra conti"><i class="fas fa-exchange-alt"></i></th></tr></thead>
				<tbody>
					{#each review as r}
						<tr class:dim={!r.include}>
							<td><input type="checkbox" bind:checked={r.include} aria-label="Importa riga {r.line}"></td>
							<td style="white-space:nowrap;">{formatDate(r.date)}</td>
							<td>
								{#if r.editing}
									<input
										class="desc-input"
										bind:value={r.description}
										use:autofocus
										aria-label="Descrizione"
										onblur={() => { r.description = r.description.trim() || '(senza descrizione)'; r.editing = false; }}
										onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
									>
								{:else}
									<button type="button" class="desc" title="Clicca per modificare la descrizione" onclick={() => (r.editing = true)}>
										{r.description} <i class="fas fa-pen"></i>
									</button>
								{/if}
								{#if r.duplicate}
									<button
										type="button"
										class="flag {r.duplicate === 'exact' ? 'red' : 'orange'}"
										title={matchTooltip(r.matches)}
										onclick={() => (r.showMatches = !r.showMatches)}
									>
										{r.duplicate === 'exact' ? 'già presente' : 'possibile doppione'} <i class="fas fa-chevron-{r.showMatches ? 'up' : 'down'}"></i>
									</button>
								{/if}
								{#if r.showMatches && r.matches.length}
									<div class="matches">
										<strong>Già registrat{r.matches.length === 1 ? 'o' : 'i'} il {formatDate(r.date)}:</strong>
										{#each r.matches as m}
											<div class="match">
												<span>{m.description}</span>
												<span class="expense-amount">{formatEuro(m.amount)}</span>
												<span class="muted">{m.category} · {paymentLabels[m.paymentMethod] || m.paymentMethod}{m.tags.length ? ' · ' + m.tags.join(', ') : ''}</span>
											</div>
										{/each}
									</div>
								{/if}
							</td>
							<td class={r.amount < 0 ? 'expense-amount' : 'income-amount'} style="white-space:nowrap;">{formatEuro(r.amount)}</td>
							<td>
								<select bind:value={r.category} aria-label="Categoria">
									{#each r.amount < 0 ? data.expenseCategories : data.incomeCategories as c}<option value={c}>{c}</option>{/each}
								</select>
								{#if r.suggested}<i class="fas fa-magic muted" title="Categoria suggerita dallo storico"></i>{/if}
							</td>
							<td><input type="checkbox" bind:checked={r.transfer} aria-label="Trasferimento"></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; flex-wrap:wrap; gap:10px;">
			<span class="muted">Selezionati {selected.length} su {review.length} · uscite {formatEuro(selectedExpense)}</span>
			<button type="button" class="btn-submit" style="width:auto;" disabled={busy || selected.length === 0} onclick={doImport}>
				<i class="fas {busy ? 'fa-spinner fa-spin' : 'fa-file-import'}"></i> Importa {selected.length} movimenti
			</button>
		</div>
	</div>
	{/if}
</div>

<style>
	.panel { background:var(--bg-card); border:1px solid var(--border-color); border-radius:12px; padding:20px; margin-bottom:20px; }
	.panel h2 { font-size:1.05rem; margin:0 0 14px; display:flex; gap:10px; align-items:center; }
	.step { display:inline-flex; width:26px; height:26px; border-radius:50%; background:var(--accent-blue); color:#fff; align-items:center; justify-content:center; font-size:0.85rem; }
	.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:14px; }
	.grid label { display:flex; flex-direction:column; gap:6px; font-size:0.85rem; color:var(--text-muted); }
	.grid label.check { flex-direction:row; align-items:center; gap:8px; }
	.muted { color:var(--text-muted); font-size:0.85rem; }
	.label-title { font-size:0.85rem; color:var(--text-muted); margin:14px 0 6px; }
	.chips { display:flex; flex-wrap:wrap; gap:6px; }
	.chip { font-size:0.8rem; padding:4px 10px; border-radius:14px; border:1px solid var(--border-color); background:none; color:var(--text-primary); cursor:pointer; }
	.chip.on { border-color:var(--accent-blue); background:rgba(67, 97, 238, 0.12); color:var(--accent-blue); }
	table.mini td, table.mini th { font-size:0.8rem; padding:6px 8px; }
	tr.dim { opacity:0.45; }
	.flag { font-size:0.7rem; padding:2px 8px; border-radius:10px; margin-left:6px; white-space:nowrap; }
	.flag.red { background:var(--accent-red-glow); color:var(--accent-red); }
	.flag.orange { background:rgba(230, 126, 34, 0.15); color:#e67e22; }
	td select { padding:4px 6px; font-size:0.85rem; }
	.desc { background:none; border:none; padding:2px 4px; margin:-2px -4px; color:var(--text-primary); cursor:text; text-align:left; font:inherit; border-radius:4px; }
	.desc:hover { background:var(--bg-secondary); }
	.desc i { font-size:0.7rem; color:var(--text-muted); opacity:0; }
	.desc:hover i, .desc:focus i { opacity:1; }
	.desc-input { width:100%; min-width:220px; padding:4px 6px; font-size:0.9rem; }
	button.flag { border:none; cursor:pointer; font:inherit; font-size:0.7rem; }
	.matches { margin-top:6px; padding:8px 10px; border-radius:8px; background:var(--bg-secondary); border:1px solid var(--border-color); font-size:0.8rem; display:flex; flex-direction:column; gap:4px; }
	.match { display:flex; flex-wrap:wrap; gap:4px 10px; align-items:baseline; }
</style>
