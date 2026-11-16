<script lang="ts">
	import { enhance } from '$app/forms';
	import '../../../app.css';

	let { data, form } = $props();
	const statusLabel: Record<string, string> = { pending: 'In attesa di autorizzazione', linked: 'Collegato', expired: 'Autorizzazione scaduta', failed: 'Non riuscito' };
</script>

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-university"></i> Collegamento bancario</h1>
		<p class="page-subtitle">Importa i movimenti direttamente dalla banca (Open Banking PSD2, sola lettura), senza scaricare file.</p>
	</div>

	{#if form?.error || data.error}
		<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-exclamation-circle"></i> {form?.error || data.error}</div>
	{/if}
	{#if form?.synced || data.message}
		<div style="background:var(--accent-green-glow); color:var(--accent-green); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-check-circle"></i> {form?.synced || data.message}</div>
	{/if}

	<div class="main-content">
		<div class="form-section">
			<h2><i class="fas fa-key"></i> Chiavi API</h2>
			<p style="color:var(--text-muted); margin-top:0;">
				CasaDash usa il servizio <strong>GoCardless Bank Account Data</strong> (ex Nordigen). Le chiavi si creano nel portale del servizio e vengono salvate
				<strong>cifrate</strong>. La banca chiede di rinnovare il consenso ogni 90 giorni. Il servizio ha limitato la creazione di nuovi account dal 2025:
				funziona con le chiavi già esistenti; in alternativa usa l'<a href="../../import">importazione da file</a>.
			</p>
			{#if data.configured}
				<p><i class="fas fa-check-circle" style="color:var(--accent-green);"></i> Chiavi configurate.</p>
				<form method="POST" action="?/removeCredentials" use:enhance={({ cancel }) => { if (!confirm('Rimuovere le chiavi? I collegamenti smetteranno di sincronizzare.')) cancel(); }}>
					<button class="btn-submit btn-auto btn-secondary"><i class="fas fa-trash-alt"></i> Rimuovi chiavi</button>
				</form>
			{:else}
				<form method="POST" action="?/saveCredentials" use:enhance>
					<div class="form-group"><label for="secret_id">Secret ID</label><input type="text" id="secret_id" name="secret_id" required autocomplete="off"></div>
					<div class="form-group"><label for="secret_key">Secret Key</label><input type="password" id="secret_key" name="secret_key" required autocomplete="off"></div>
					<button class="btn-submit btn-primary-action"><i class="fas fa-save"></i> Salva</button>
				</form>
			{/if}
		</div>

		{#if data.configured}
		<div class="form-section">
			<h2><i class="fas fa-plus-circle"></i> Collega una banca</h2>
			<form method="GET" style="display:flex; gap:8px; margin-bottom:12px;">
				<input type="text" name="q" placeholder="Cerca la banca (es. Poste, Intesa, BNL)" value={data.q} style="flex:1;">
				<button class="btn-submit btn-auto btn-secondary"><i class="fas fa-search"></i></button>
			</form>
			{#each data.institutions as inst (inst.id)}
				<form method="POST" action="?/connect" use:enhance style="display:flex; gap:10px; align-items:center; padding:6px 0; border-top:1px solid var(--border-color);">
					<input type="hidden" name="institution_id" value={inst.id}>
					<input type="hidden" name="institution_name" value={inst.name}>
					<span style="flex:1;">{inst.name}</span>
					<button class="btn-submit btn-auto btn-primary-action">Collega</button>
				</form>
			{/each}
		</div>
		{/if}
	</div>

	{#if data.connections.length}
	<div class="recent-transactions" style="margin-top:24px;">
		<h2><i class="fas fa-link"></i> Conti collegati</h2>
		<div class="table-responsive">
			<table class="table">
				<thead><tr><th>Banca</th><th>Conto di CasaDash</th><th>Stato</th><th>Ultima lettura</th><th></th></tr></thead>
				<tbody>
					{#each data.connections as c (c.id)}
						<tr>
							<td>{c.institutionName}{#if c.accountId}<br><small style="color:var(--text-muted);">…{c.accountId.slice(-6)}</small>{/if}</td>
							<td>
								<form method="POST" action="?/setAccount" use:enhance style="display:flex; gap:6px; margin:0;">
									<input type="hidden" name="id" value={c.id}>
									<select name="tag" value={c.accountTag ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="" disabled>Scegli…</option>
										{#each data.accountTags as t}<option value={t}>{t}</option>{/each}
									</select>
								</form>
							</td>
							<td>{statusLabel[c.status] || c.status}{#if c.lastError}<br><small style="color:var(--accent-red);">{c.lastError}</small>{/if}</td>
							<td>{c.lastSync ? new Date(c.lastSync).toLocaleString('it-IT') : '—'}</td>
							<td style="white-space:nowrap;">
								{#if c.status === 'linked'}
									<form method="POST" action="?/sync" use:enhance class="inline"><input type="hidden" name="id" value={c.id}><button class="edit-btn" title="Sincronizza ora"><i class="fas fa-sync-alt"></i></button></form>
								{/if}
								<form method="POST" action="?/disconnect" use:enhance={({ cancel }) => { if (!confirm('Scollegare questo conto? I movimenti già importati restano.')) cancel(); }} class="inline">
									<input type="hidden" name="id" value={c.id}><button class="delete-btn" title="Scollega"><i class="fas fa-unlink"></i></button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="month-note">I movimenti si aggiornano da soli ogni 8 ore, con le regole automatiche applicate e senza doppioni con le importazioni da file. Il tag <code>Banca</code> li contrassegna.</p>
	</div>
	{/if}
</div>
