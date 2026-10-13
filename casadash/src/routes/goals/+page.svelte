<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const icons = ['fa-piggy-bank', 'fa-plane', 'fa-car', 'fa-home', 'fa-umbrella-beach', 'fa-graduation-cap', 'fa-gift', 'fa-ring', 'fa-baby', 'fa-laptop', 'fa-medkit', 'fa-shield-alt'];
	const formatEuro = (n: number) => '€' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const formatDate = (d: string) => d.split('-').reverse().join('/');

	let showArchived = $state(false);
	let editing: any = $state(null);
	let visibleGoals = $derived(data.goals.filter((g) => showArchived || !g.archived));
	let userName = (id: number | null) => data.allUsers.find((u) => u.id === id)?.displayName || '';
</script>

<svelte:head>
	<title>Obiettivi - CasaDash</title>
</svelte:head>

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-piggy-bank"></i> Obiettivi di risparmio</h1>
		<p class="page-subtitle">Metti da parte soldi per un traguardo e segui quanto manca</p>
	</div>

	{#if form?.error}
		<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;">
			<i class="fas fa-exclamation-circle"></i> {form.error}
		</div>
	{/if}

	<div class="main-content">
		<div class="form-section">
			<h2><i class="fas fa-plus-circle"></i> Nuovo obiettivo</h2>
			<form method="POST" action="?/addGoal" use:enhance>
				<div class="form-group">
					<label for="name">Nome</label>
					<input type="text" id="name" name="name" required placeholder="Es. Vacanze 2027">
				</div>
				<div class="form-row">
					<div class="form-group">
						<label for="target">Obiettivo (€)</label>
						<input id="target" name="target" type="number" min="0.01" step="0.01" required>
					</div>
					<div class="form-group">
						<label for="deadline">Entro il (facoltativo)</label>
						<input id="deadline" name="deadline" type="date">
					</div>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label for="color">Colore</label>
						<input id="color" name="color" type="color" value="#4361ee">
					</div>
					<div class="form-group">
						<label for="icon">Icona</label>
						<select id="icon" name="icon">
							{#each icons as ic}<option value={ic}>{ic.replace('fa-', '')}</option>{/each}
						</select>
					</div>
				</div>
				<button type="submit" class="btn-submit btn-primary-action"><i class="fas fa-save"></i> Crea obiettivo</button>
			</form>
		</div>

		<div class="goals-column">
			<label class="check" style="justify-content:flex-end; color:var(--text-muted);">
				<input type="checkbox" bind:checked={showArchived}> Mostra archiviati
			</label>

			{#if visibleGoals.length === 0}
				<p style="color:var(--text-muted); text-align:center; padding:30px;">Nessun obiettivo. Creane uno per iniziare a risparmiare.</p>
			{/if}

			{#each visibleGoals as g (g.id)}
				{@const pct = Math.min((g.saved / g.target) * 100, 100)}
				<div class="goal-card" style="border-left-color:{g.color}; opacity:{g.archived ? 0.6 : 1};">
					<div class="goal-head">
						<div class="goal-icon" style="background:{g.color};"><i class="fas {g.icon}"></i></div>
						<div style="flex:1;">
							<h3>{g.name} {#if g.archived}<small>(archiviato)</small>{/if}</h3>
							<p class="muted">
								{formatEuro(g.saved)} di {formatEuro(g.target)}
								{#if g.deadline} · entro il {formatDate(g.deadline)}{/if}
							</p>
						</div>
						<div class="goal-actions">
							<button type="button" title="Modifica" onclick={() => (editing = { ...g })}><i class="fas fa-edit"></i></button>
							<form method="POST" action="?/toggleArchive" use:enhance>
								<input type="hidden" name="id" value={g.id}>
								<button title={g.archived ? 'Ripristina' : 'Archivia'}><i class="fas {g.archived ? 'fa-box-open' : 'fa-archive'}"></i></button>
							</form>
							<form method="POST" action="?/deleteGoal" use:enhance={({ cancel }) => { if (!confirm(`Eliminare "${g.name}" e tutti i suoi versamenti?`)) cancel(); }}>
								<input type="hidden" name="id" value={g.id}>
								<button title="Elimina"><i class="fas fa-trash-alt"></i></button>
							</form>
						</div>
					</div>

					<div class="budget-bar" style="margin:12px 0 6px;">
						<div class="budget-bar-fill ok" style="width:{pct}%; background:{g.color};"></div>
					</div>
					<p class="muted">
						{#if g.remaining <= 0}
							<span style="color:var(--accent-green); font-weight:600;"><i class="fas fa-trophy"></i> Obiettivo raggiunto!</span>
						{:else}
							{pct.toFixed(0)}% · mancano {formatEuro(g.remaining)}
							{#if g.monthsLeft === 0}
								· <span style="color:var(--accent-red);">scadenza superata</span>
							{:else if g.monthlyNeeded}
								· servono {formatEuro(g.monthlyNeeded)} al mese per {g.monthsLeft} {g.monthsLeft === 1 ? 'mese' : 'mesi'}
							{/if}
						{/if}
					</p>

					{#if !g.archived}
					<form method="POST" action="?/contribute" use:enhance class="contribute">
						<input type="hidden" name="goal_id" value={g.id}>
						<select name="direction" aria-label="Tipo di movimento">
							<option value="in">Versa</option>
							<option value="out">Preleva</option>
						</select>
						<input name="amount" type="number" min="0.01" step="0.01" placeholder="€" required aria-label="Importo">
						<input name="date" type="date" value={data.today} aria-label="Data">
						<input type="text" name="note" placeholder="Nota (facoltativa)" aria-label="Nota">
						<button type="submit" class="btn-submit btn-auto btn-primary-action" aria-label="Registra movimento" title="Registra movimento"><i class="fas fa-check"></i></button>
					</form>
					{/if}

					{#if g.contributions.length > 0}
						<details>
							<summary class="muted">Ultimi movimenti</summary>
							<ul class="contributions">
								{#each g.contributions as c}
									<li>
										<span>{formatDate(c.date)}</span>
										<span class={c.amount < 0 ? 'expense-amount' : 'income-amount'}>{c.amount < 0 ? '-' : '+'}{formatEuro(Math.abs(c.amount))}</span>
										<span class="muted">{c.note || ''} {userName(c.createdBy)}</span>
										<form method="POST" action="?/deleteContribution" use:enhance>
											<input type="hidden" name="id" value={c.id}>
											<button class="delete-btn" title="Elimina movimento"><i class="fas fa-times"></i></button>
										</form>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>

{#if editing}
<div class="modal-overlay" role="presentation" onclick={() => (editing = null)}>
	<div class="modal-card" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && (editing = null)}>
		<h2>Modifica obiettivo</h2>
		<form method="POST" action="?/editGoal" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') editing = null; }}>
			<input type="hidden" name="id" value={editing.id}>
			<div class="form-group"><label for="e_name">Nome</label><input type="text" id="e_name" name="name" required value={editing.name}></div>
			<div class="form-row">
				<div class="form-group"><label for="e_target">Obiettivo (€)</label><input id="e_target" name="target" type="number" min="0.01" step="0.01" required value={editing.target}></div>
				<div class="form-group"><label for="e_deadline">Entro il</label><input id="e_deadline" name="deadline" type="date" value={editing.deadline || ''}></div>
			</div>
			<div class="form-row">
				<div class="form-group"><label for="e_color">Colore</label><input id="e_color" name="color" type="color" value={editing.color}></div>
				<div class="form-group">
					<label for="e_icon">Icona</label>
					<select id="e_icon" name="icon" value={editing.icon}>
						{#each icons as ic}<option value={ic}>{ic.replace('fa-', '')}</option>{/each}
					</select>
				</div>
			</div>
			<div style="display:flex; gap:10px;">
				<button type="button" class="btn-submit btn-secondary" onclick={() => (editing = null)}>Annulla</button>
				<button type="submit" class="btn-submit btn-primary-action"><i class="fas fa-save"></i> Salva</button>
			</div>
		</form>
	</div>
</div>
{/if}

<style>
	.goals-column { display:flex; flex-direction:column; gap:16px; }
	.goal-card { background:var(--bg-card); border:1px solid var(--border-color); border-left:5px solid; border-radius:12px; padding:18px; }
	.goal-head { display:flex; gap:14px; align-items:center; }
	.goal-head h3 { margin:0; font-size:1.05rem; }
	.goal-icon { width:42px; height:42px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#fff; flex-shrink:0; }
	.goal-actions { display:flex; gap:6px; }
	.goal-actions form { margin:0; }
	.goal-actions button { background:none; border:none; color:var(--text-muted); cursor:pointer; padding:6px; }
	.goal-actions button:hover { color:var(--text-primary); }
	.muted { color:var(--text-muted); font-size:0.85rem; margin:0; }
	.contribute { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
	.contribute select, .contribute input { flex:1; min-width:110px; width:auto; }
	details { margin-top:10px; }
	summary { cursor:pointer; }
	.contributions { list-style:none; padding:0; margin:8px 0 0; display:flex; flex-direction:column; gap:4px; }
	.contributions li { display:grid; grid-template-columns:90px 110px 1fr auto; gap:8px; align-items:center; font-size:0.85rem; }
	.contributions form { margin:0; }
	.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
	.modal-card { background:var(--bg-card); border-radius:12px; padding:24px; width:100%; max-width:480px; border:1px solid var(--border-color); }
</style>
