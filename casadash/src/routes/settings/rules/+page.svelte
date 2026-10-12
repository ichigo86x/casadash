<script lang="ts">
	import { enhance } from '$app/forms';
	import { ruleTags } from '$lib/rules';

	let { data, form } = $props();
	let editing: any = $state(null);
	const typeLabel: Record<string, string> = { any: 'Entrate e uscite', expense: 'Uscite', income: 'Entrate' };
</script>

<svelte:head>
	<title>Regole - CasaDash</title>
</svelte:head>

{#snippet ruleFields(r: any)}
	<div class="form-group">
		<label for="pattern-{r?.id ?? 'new'}">Se la descrizione contiene</label>
		<input id="pattern-{r?.id ?? 'new'}" name="pattern" required placeholder="Es. ESSELUNGA" value={r?.pattern ?? ''}>
	</div>
	<div class="form-row">
		<div class="form-group">
			<label for="type-{r?.id ?? 'new'}">Vale per</label>
			<select id="type-{r?.id ?? 'new'}" name="type" value={r?.type ?? 'expense'}>
				<option value="expense">Uscite</option>
				<option value="income">Entrate</option>
				<option value="any">Entrate e uscite</option>
			</select>
		</div>
		<div class="form-group">
			<label for="category-{r?.id ?? 'new'}">Categoria</label>
			<select id="category-{r?.id ?? 'new'}" name="category" value={r?.category ?? ''}>
				<option value="">Non cambiare</option>
				<optgroup label="Uscite">{#each data.expenseCategories as c}<option value={c}>{c}</option>{/each}</optgroup>
				<optgroup label="Entrate">{#each data.incomeCategories as c}<option value={c}>{c}</option>{/each}</optgroup>
			</select>
		</div>
	</div>
	<div class="form-group">
		<label for="tags-{r?.id ?? 'new'}">Aggiungi tag (separati da virgola)</label>
		<input id="tags-{r?.id ?? 'new'}" name="add_tags" placeholder={data.accounts.length ? `Es. Spesa, ${data.accounts[0]}` : 'Es. Spesa'} value={r ? ruleTags(r).join(', ') : ''}>
	</div>
	<div class="form-row">
		<label class="check"><input type="checkbox" name="mark_transfer" checked={!!r?.markTransfer}> È un trasferimento tra conti</label>
		<div class="form-group">
			<label for="priority-{r?.id ?? 'new'}">Priorità</label>
			<input id="priority-{r?.id ?? 'new'}" name="priority" type="number" value={r?.priority ?? 0} title="Se più regole corrispondono vince quella con priorità più alta">
		</div>
	</div>
{/snippet}

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-magic"></i> Regole automatiche</h1>
		<p class="page-subtitle">Assegnano categoria e tag in base alla descrizione: nei nuovi movimenti, nelle importazioni e sui movimenti esistenti</p>
	</div>

	{#if form?.error}
		<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-exclamation-circle"></i> {form.error}</div>
	{/if}
	{#if form?.applied !== undefined}
		<div style="background:var(--accent-green-glow); color:var(--accent-green); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-check-circle"></i> Regole applicate: {form.applied} movimenti aggiornati.</div>
	{/if}

	<div class="main-content">
		<div class="form-section">
			<h2><i class="fas fa-plus-circle"></i> Nuova regola</h2>
			<form method="POST" action="?/add" use:enhance>
				{@render ruleFields(null)}
				<button type="submit" class="btn-submit"><i class="fas fa-save"></i> Salva regola</button>
			</form>
			<p class="muted" style="margin-top:12px;">Il confronto ignora maiuscole e accenti. Esempio: <code>esselunga</code> riconosce "PAGAMENTO POS ESSELUNGA MILANO".</p>
		</div>

		<div class="recent-transactions">
			<h2><i class="fas fa-list"></i> Regole ({data.rules.length})</h2>
			{#if data.rules.length === 0}
				<p class="muted" style="padding:20px; text-align:center;">Nessuna regola. Creane una per classificare automaticamente i movimenti.</p>
			{:else}
				<div class="table-responsive">
					<table>
						<thead><tr><th>Contiene</th><th>Vale per</th><th>Risultato</th><th>Priorità</th><th></th></tr></thead>
						<tbody>
							{#each data.rules as r (r.id)}
								<tr style="opacity:{r.isActive ? 1 : 0.5};">
									<td><code>{r.pattern}</code></td>
									<td>{typeLabel[r.type]}</td>
									<td class="wrap">
										{#if r.category}<span class="pill">{r.category}</span>{/if}
										{#each ruleTags(r) as t}<span class="pill tag">{t}</span>{/each}
										{#if r.markTransfer}<span class="pill transfer"><i class="fas fa-exchange-alt"></i> Trasferimento</span>{/if}
									</td>
									<td>{r.priority}</td>
									<td class="actions">
										<form method="POST" action="?/toggle" use:enhance>
											<input type="hidden" name="id" value={r.id}><input type="hidden" name="active" value={r.isActive}>
											<button title={r.isActive ? 'Disattiva' : 'Attiva'}><i class="fas {r.isActive ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></button>
										</form>
										<button type="button" title="Modifica" onclick={() => (editing = r)}><i class="fas fa-edit"></i></button>
										<form method="POST" action="?/delete" use:enhance={({ cancel }) => { if (!confirm(`Eliminare la regola "${r.pattern}"?`)) cancel(); }}>
											<input type="hidden" name="id" value={r.id}>
											<button title="Elimina"><i class="fas fa-trash-alt"></i></button>
										</form>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="apply">
					<h3><i class="fas fa-play-circle"></i> Applica ai movimenti esistenti</h3>
					<form method="POST" action="?/apply" use:enhance style="display:flex; gap:10px; flex-wrap:wrap;">
						<button class="btn-submit" style="width:auto;" name="scope" value="uncategorized"><i class="fas fa-filter"></i> Solo quelli in "Altro"</button>
						<button class="btn-submit" style="width:auto; background:var(--accent-orange, #e67e22);" name="scope" value="all"
							onclick={(e) => { if (!confirm('Le regole sovrascriveranno la categoria di tutti i movimenti che corrispondono. Continuare?')) e.preventDefault(); }}>
							<i class="fas fa-sync-alt"></i> Tutti i movimenti
						</button>
					</form>
					<p class="muted">I tag delle regole vengono aggiunti, mai rimossi.</p>
				</div>
			{/if}
		</div>
	</div>
</div>

{#if editing}
<div class="modal-overlay" role="presentation" onclick={() => (editing = null)}>
	<div class="modal-card" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (editing = null)}>
		<h2>Modifica regola</h2>
		<form method="POST" action="?/edit" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') editing = null; }}>
			<input type="hidden" name="id" value={editing.id}>
			{@render ruleFields(editing)}
			<div style="display:flex; gap:10px;">
				<button type="button" class="btn-submit" style="background:var(--bg-secondary); color:var(--text-primary);" onclick={() => (editing = null)}>Annulla</button>
				<button type="submit" class="btn-submit"><i class="fas fa-save"></i> Salva</button>
			</div>
		</form>
	</div>
</div>
{/if}

<style>
	.muted { color:var(--text-muted); font-size:0.85rem; }
	.check { display:flex; gap:8px; align-items:center; font-size:0.9rem; flex:1; }
	.wrap { white-space:normal; }
	.pill { display:inline-block; font-size:0.75rem; padding:2px 8px; border-radius:10px; background:var(--bg-secondary); border:1px solid var(--border-color); margin:2px 4px 2px 0; }
	.pill.tag { border-style:dashed; }
	.pill.transfer { color:var(--accent-blue); border-color:var(--accent-blue); }
	.actions { display:flex; gap:6px; align-items:center; }
	.actions form { margin:0; }
	.actions button { background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px; font-size:1rem; }
	.actions button:hover { color:var(--text-primary); }
	.apply { margin-top:20px; padding-top:16px; border-top:1px solid var(--border-color); }
	.apply h3 { font-size:1rem; margin:0 0 10px; }
	.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
	.modal-card { background:var(--bg-card); border-radius:12px; padding:24px; width:100%; max-width:520px; border:1px solid var(--border-color); max-height:90vh; overflow:auto; }
</style>
