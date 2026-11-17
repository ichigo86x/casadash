<script lang="ts">
	import { enhance } from '$app/forms';
	import '../../app.css';

	let { data, form } = $props();
	const eur = (n: number) => '€' + Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const fmt = (d: string) => d.split('-').reverse().join('/');
	const label = { exact: 'identico', strong: 'molto simile', probable: 'possibile' } as const;
	let chosen: Record<string, number> = $state({});
</script>

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-code-compare"></i> Possibili doppioni</h1>
		<p class="page-subtitle">Movimenti arrivati dalla banca che somigliano a qualcosa di già registrato (un pagamento PayPal e il suo addebito, una spesa con carta e l'addebito mensile…). Decidi tu cosa farne.</p>
	</div>

	{#if form?.error}<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> {form.error}</div>{/if}
	{#if form?.done}<div style="background:var(--accent-green-glow); color:var(--accent-green); padding:12px; border-radius:8px; margin-bottom:16px;"><i class="fas fa-check-circle"></i> {form.done}</div>{/if}

	{#if data.conflicts.length > 1}
		<div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
			<form method="POST" action="?/resolveAll" use:enhance={({ cancel }) => { if (!confirm('Aggiungere tutti i movimenti in attesa come nuovi?')) cancel(); }}><input type="hidden" name="decision" value="keep"><button class="btn-submit btn-auto btn-secondary"><i class="fas fa-copy"></i> Tieni tutti</button></form>
			<form method="POST" action="?/resolveAll" use:enhance={({ cancel }) => { if (!confirm('Ignorare tutti i movimenti in attesa?')) cancel(); }}><input type="hidden" name="decision" value="skip"><button class="btn-submit btn-auto btn-secondary"><i class="fas fa-ban"></i> Salta tutti</button></form>
		</div>
	{/if}

	{#each data.conflicts as c (c.id)}
		<div class="form-section" style="margin-bottom:16px;">
			<div class="row-head">
				<div>
					<strong>{c.movement.description}</strong><br>
					<small style="color:var(--text-muted);">{c.institution} → {c.accountTag} · {fmt(c.movement.date)}</small>
				</div>
				<strong class={c.movement.amount < 0 ? 'expense-amount' : 'income-amount'}>{c.movement.amount < 0 ? '−' : '+'}{eur(c.movement.amount)}</strong>
			</div>
			<p class="month-note" style="margin:10px 0 4px;">Già registrato:</p>
			{#each c.matches as m (m.id)}
				<label class="match-row">
					{#if c.matches.length > 1}<input type="radio" name="pick-{c.id}" checked={(chosen[c.id] ?? c.matches[0].id) === m.id} onchange={() => (chosen[c.id] = m.id)}>{/if}
					<span style="flex:1;">{m.description}<br><small style="color:var(--text-muted);">{fmt(m.date)} · {m.category}{m.tags.length ? ' · ' + m.tags.join(', ') : ''} — {label[m.level]}: {m.reason}</small></span>
					<span>{eur(m.amount)}</span>
				</label>
			{/each}
			<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
				<form method="POST" action="?/resolve" use:enhance><input type="hidden" name="id" value={c.id}><input type="hidden" name="decision" value="keep"><button class="btn-submit btn-auto btn-primary-action"><i class="fas fa-copy"></i> Tieni entrambi</button></form>
				<form method="POST" action="?/resolve" use:enhance><input type="hidden" name="id" value={c.id}><input type="hidden" name="decision" value="replace"><input type="hidden" name="replace_id" value={chosen[c.id] ?? c.matches[0]?.id}><button class="btn-submit btn-auto btn-secondary" title="Aggiorna il movimento esistente con i dati della banca"><i class="fas fa-exchange-alt"></i> Sostituisci l'esistente</button></form>
				<form method="POST" action="?/resolve" use:enhance><input type="hidden" name="id" value={c.id}><input type="hidden" name="decision" value="skip"><button class="btn-submit btn-auto btn-secondary"><i class="fas fa-ban"></i> Salta (è lo stesso)</button></form>
			</div>
		</div>
	{:else}
		<p style="color:var(--text-muted);"><i class="fas fa-check-circle" style="color:var(--accent-green);"></i> Nessun movimento in attesa di una decisione.</p>
	{/each}
</div>

<style>
	.row-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
	.match-row { display:flex; gap:10px; align-items:center; padding:8px 0; border-top:1px solid var(--border-color); cursor:pointer; }
</style>
