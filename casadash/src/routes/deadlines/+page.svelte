<script lang="ts">
	import { enhance } from '$app/forms';
	import '../../app.css';

	let { data, form } = $props();
	let editing: any = $state(null);

	const eur = (n: number) => '€' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const fmt = (d: string) => d.split('-').reverse().join('/');
	const when = (n: number) => (n < 0 ? `scaduta da ${-n} giorni` : n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`);
	let open = $derived(data.deadlines.filter((d) => !d.done));
	let closed = $derived(data.deadlines.filter((d) => d.done));
	const repeatLabel: Record<string, string> = { none: 'Una volta', monthly: 'Ogni mese', yearly: 'Ogni anno' };
</script>

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-calendar-check"></i> Scadenze</h1>
		<p class="page-subtitle">Bollo, assicurazioni, tasse e altre date da non dimenticare, con promemoria nella dashboard e in Home Assistant.</p>
	</div>

	{#if form?.error}
		<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-exclamation-circle"></i> {form.error}</div>
	{/if}

	<div class="main-content">
		<div class="form-section">
			<h2><i class="fas fa-plus-circle"></i> {editing ? 'Modifica scadenza' : 'Nuova scadenza'}</h2>
			<form method="POST" action={editing ? '?/edit' : '?/add'} use:enhance={() => async ({ update }) => { await update(); editing = null; }}>
				{#if editing}<input type="hidden" name="id" value={editing.id}>{/if}
				<div class="form-group">
					<label for="title">Titolo</label>
					<input type="text" id="title" name="title" required maxlength="100" placeholder="Es. Bollo Panda" value={editing?.title ?? ''}>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label for="due_date">Scadenza</label>
						<input type="date" id="due_date" name="due_date" required value={editing?.dueDate ?? ''}>
					</div>
					<div class="form-group">
						<label for="amount">Importo previsto (€)</label>
						<input type="number" id="amount" name="amount" min="0" step="0.01" placeholder="0,00" value={editing?.amount || ''}>
					</div>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label for="kind">Tipo</label>
						<select id="kind" name="kind" value={editing?.kind ?? 'Altro'}>{#each data.kinds as k}<option>{k}</option>{/each}</select>
					</div>
					<div class="form-group">
						<label for="repeat">Si ripete</label>
						<select id="repeat" name="repeat" value={editing?.repeat ?? 'none'}>
							<option value="none">Una volta</option><option value="monthly">Ogni mese</option><option value="yearly">Ogni anno</option>
						</select>
					</div>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label for="remind_days">Avvisami (giorni prima)</label>
						<input type="number" id="remind_days" name="remind_days" min="0" max="365" value={editing?.remindDays ?? 14}>
					</div>
					<div class="form-group">
						<label for="category">Categoria della spesa</label>
						<select id="category" name="category" value={editing?.category ?? 'Altro'}>{#each data.categories as c}<option>{c}</option>{/each}</select>
					</div>
				</div>
				<button type="submit" class="btn-submit btn-primary-action"><i class="fas fa-save"></i> Salva</button>
				{#if editing}<button type="button" class="btn-submit btn-secondary" style="margin-top:8px;" onclick={() => (editing = null)}>Annulla modifica</button>{/if}
			</form>
		</div>

		<div class="recent-transactions">
			<h2><i class="fas fa-list"></i> Da pagare</h2>
			{#each open as d (d.id)}
				<div class="deadline {d.daysLeft < 0 ? 'late' : d.daysLeft <= d.remindDays ? 'soon' : ''}">
					<div class="deadline-main">
						<strong>{d.title}</strong>
						<small>{d.kind} · {repeatLabel[d.repeat]} · {fmt(d.dueDate)} — <em>{when(d.daysLeft)}</em></small>
					</div>
					<div class="deadline-amount">{d.amount > 0 ? eur(d.amount) : ''}</div>
					<div class="deadline-actions">
						<form method="POST" action="?/pay" use:enhance style="display:flex; gap:6px; align-items:center; margin:0;">
							<input type="hidden" name="id" value={d.id}>
							{#if d.amount > 0}<label style="font-size:0.75rem;"><input type="checkbox" name="book" checked> registra la spesa</label>{/if}
							<button class="btn-submit btn-auto btn-primary-action" title="Segna come pagata"><i class="fas fa-check"></i> Pagata</button>
						</form>
						<button class="edit-btn" title="Modifica" onclick={() => (editing = d)}><i class="fas fa-edit"></i></button>
						<form method="POST" action="?/delete" use:enhance={({ cancel }) => { if (!confirm('Eliminare questa scadenza?')) cancel(); }} style="margin:0;">
							<input type="hidden" name="id" value={d.id}>
							<button class="delete-btn" title="Elimina"><i class="fas fa-trash-alt"></i></button>
						</form>
					</div>
				</div>
			{:else}
				<p style="color:var(--text-muted);">Nessuna scadenza aperta.</p>
			{/each}

			{#if closed.length}
				<h3 style="margin-top:24px;">Completate</h3>
				{#each closed as d (d.id)}
					<div class="deadline done">
						<div class="deadline-main"><strong>{d.title}</strong><small>{fmt(d.dueDate)}</small></div>
						<div class="deadline-amount">{d.amount > 0 ? eur(d.amount) : ''}</div>
						<div class="deadline-actions">
							<form method="POST" action="?/reopen" use:enhance style="margin:0;"><input type="hidden" name="id" value={d.id}><button class="edit-btn" title="Riapri"><i class="fas fa-undo"></i></button></form>
							<form method="POST" action="?/delete" use:enhance style="margin:0;"><input type="hidden" name="id" value={d.id}><button class="delete-btn" title="Elimina"><i class="fas fa-trash-alt"></i></button></form>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.deadline { display:flex; gap:14px; align-items:center; padding:12px 14px; margin-bottom:8px; border:1px solid var(--border-color); border-left:4px solid var(--border-color); border-radius:10px; background:var(--bg-card); flex-wrap:wrap; }
	.deadline.soon { border-left-color:var(--accent-orange, #e67e22); }
	.deadline.late { border-left-color:var(--accent-red); }
	.deadline.done { opacity:0.6; }
	.deadline-main { flex:1; min-width:160px; display:flex; flex-direction:column; gap:2px; }
	.deadline-main small { color:var(--text-muted); }
	.deadline-amount { font-weight:700; }
	.deadline-actions { display:flex; gap:8px; align-items:center; }
</style>
