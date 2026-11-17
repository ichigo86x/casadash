<script lang="ts">
	import { enhance } from '$app/forms';
	import { base } from '$app/paths';
	import '../../../app.css';

	let { data, form } = $props();
	const statusLabel: Record<string, string> = { pending: 'In attesa di autorizzazione', linked: 'Collegato', expired: 'Autorizzazione scaduta', failed: 'Non riuscito' };
	const providerName: Record<string, string> = { enablebanking: 'Enable Banking', gocardless: 'GoCardless' };
	let anyConfigured = $derived(data.providers.enablebanking || data.providers.gocardless);
	let pending = $derived(data.connections.filter((c) => c.status === 'pending' && c.provider === 'enablebanking'));
</script>

<div class="container">
	<div class="page-header">
		<h1><i class="fas fa-university"></i> Collegamento bancario</h1>
		<p class="page-subtitle">Importa i movimenti direttamente dalla banca (Open Banking PSD2, sola lettura), senza scaricare file.</p>
	</div>

	{#if form?.error || data.error}
		<div class="error-msg" style="background:var(--accent-red-glow); color:var(--accent-red); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-exclamation-circle"></i> {form?.error || data.error}</div>
	{/if}
	{#if form?.cleaned}
		<div style="background:var(--accent-green-glow); color:var(--accent-green); padding:12px; border-radius:8px; margin-bottom:20px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
			<span><i class="fas fa-check-circle"></i> {form.cleaned}.</span>
			<form method="POST" action="?/restoreCleanup" use:enhance style="margin:0;"><input type="hidden" name="batch" value={form.batch}><button style="text-decoration:underline; font-weight:700; background:none; border:none; color:inherit; cursor:pointer;"><i class="fas fa-undo"></i> Annulla</button></form>
		</div>
	{/if}
	{#if form?.synced || data.message}
		<div style="background:var(--accent-green-glow); color:var(--accent-green); padding:12px; border-radius:8px; margin-bottom:20px;"><i class="fas fa-check-circle"></i> {form?.synced || data.message}</div>
	{/if}

	<div class="main-content">
		<!-- Enable Banking: free for personal use -->
		<div class="form-section">
			<h2><i class="fas fa-key"></i> Enable Banking <small style="font-weight:normal; color:var(--text-muted);">(consigliato, gratuito)</small></h2>
			<p style="color:var(--text-muted); margin-top:0;">
				Servizio autorizzato PSD2 gratuito per uso personale, per i <strong>tuoi</strong> conti. Crea un account su
				<a href="https://enablebanking.com" target="_blank" rel="noopener">enablebanking.com</a>, apri il Control Panel → <em>API applications → Register a new application</em>,
				scegli l'ambiente <strong>production</strong>, inserisci come indirizzo di reindirizzamento <code>{data.redirectUrl}</code> e scarica la chiave privata (.pem).
				Poi attiva l'applicazione collegando i tuoi conti ("Activate by linking accounts"). Le credenziali bancarie non passano mai da CasaDash.
			</p>
			{#if data.providers.enablebanking}
				<p><i class="fas fa-check-circle" style="color:var(--accent-green);"></i> Applicazione configurata.</p>
				<form method="POST" action="?/removeCredentials" use:enhance={({ cancel }) => { if (!confirm('Rimuovere le chiavi? I collegamenti smetteranno di sincronizzare.')) cancel(); }}>
					<input type="hidden" name="provider" value="enablebanking">
					<button class="btn-submit btn-auto btn-secondary"><i class="fas fa-trash-alt"></i> Rimuovi</button>
				</form>
			{:else}
				<form method="POST" action="?/saveEnableBanking" use:enhance>
					<div class="form-group"><label for="app_id">Application ID</label><input type="text" id="app_id" name="app_id" required autocomplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></div>
					<div class="form-group"><label for="private_key">Chiave privata (contenuto del file .pem)</label><textarea id="private_key" name="private_key" rows="5" required autocomplete="off" spellcheck="false" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></div>
					<button class="btn-submit btn-primary-action"><i class="fas fa-save"></i> Salva</button>
				</form>
			{/if}
		</div>

		<!-- GoCardless: only for keys created before 2025 -->
		<div class="form-section">
			<h2><i class="fas fa-key"></i> GoCardless <small style="font-weight:normal; color:var(--text-muted);">(solo chiavi già esistenti)</small></h2>
			<p style="color:var(--text-muted); margin-top:0;">
				GoCardless Bank Account Data (ex Nordigen) non accetta più nuove registrazioni dal 2025. Se hai già un Secret ID e una Secret Key, funzionano ancora.
			</p>
			{#if data.providers.gocardless}
				<p><i class="fas fa-check-circle" style="color:var(--accent-green);"></i> Chiavi configurate.</p>
				<form method="POST" action="?/removeCredentials" use:enhance={({ cancel }) => { if (!confirm('Rimuovere le chiavi? I collegamenti smetteranno di sincronizzare.')) cancel(); }}>
					<input type="hidden" name="provider" value="gocardless">
					<button class="btn-submit btn-auto btn-secondary"><i class="fas fa-trash-alt"></i> Rimuovi</button>
				</form>
			{:else}
				<form method="POST" action="?/saveGoCardless" use:enhance>
					<div class="form-group"><label for="secret_id">Secret ID</label><input type="text" id="secret_id" name="secret_id" required autocomplete="off"></div>
					<div class="form-group"><label for="secret_key">Secret Key</label><input type="password" id="secret_key" name="secret_key" required autocomplete="off"></div>
					<button class="btn-submit btn-primary-action"><i class="fas fa-save"></i> Salva</button>
				</form>
			{/if}
		</div>
	</div>

	{#if anyConfigured}
	<div class="form-section" style="margin-top:24px;">
		<h2><i class="fas fa-plus-circle"></i> Collega una banca</h2>
		<form method="GET" style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
			<select name="provider" style="flex:0 0 auto;">
				{#each Object.keys(providerName) as p}{#if data.providers[p as 'gocardless' | 'enablebanking']}<option value={p} selected={data.provider === p}>{providerName[p]}</option>{/if}{/each}
			</select>
			<input type="text" name="q" placeholder="Cerca la banca (es. Poste, BNL, Deutsche)" value={data.q} style="flex:1; min-width:180px;">
			<button class="btn-submit btn-auto btn-secondary"><i class="fas fa-search"></i> Cerca</button>
		</form>
		{#each data.institutions as inst (inst.id + (inst.country ?? ''))}
			<form method="POST" action="?/connect" use:enhance style="display:flex; gap:10px; align-items:center; padding:6px 0; border-top:1px solid var(--border-color);">
				<input type="hidden" name="provider" value={data.provider}>
				<input type="hidden" name="institution_id" value={inst.id}>
				<input type="hidden" name="institution_name" value={inst.name}>
				<input type="hidden" name="country" value={inst.country ?? 'IT'}>
				<span style="flex:1;">{inst.name}</span>
				<button class="btn-submit btn-auto btn-primary-action">Collega</button>
			</form>
		{:else}
			{#if data.q !== ''}<p style="color:var(--text-muted);">Nessuna banca trovata per «{data.q}». Se non compare, non è tra quelle supportate da questo servizio.</p>{/if}
		{/each}
	</div>
	{/if}

	{#each pending as c (c.id)}
		<div class="form-section" style="margin-top:24px; border-left:4px solid var(--accent-orange, #e67e22);">
			<h2><i class="fas fa-hourglass-half"></i> Completa il collegamento di {c.institutionName}</h2>
			<p style="color:var(--text-muted); margin-top:0;">
				Dopo aver autorizzato l'accesso sul sito della banca arrivi su una pagina di <strong>enablebanking.com</strong>. Copia l'<strong>indirizzo completo</strong>
				dalla barra del browser (contiene <code>?code=…</code>) e incollalo qui.
			</p>
			<form method="POST" action="?/finishEnableBanking" use:enhance style="display:flex; gap:8px; flex-wrap:wrap;">
				<input type="hidden" name="id" value={c.id}>
				<input type="text" name="pasted" required placeholder="https://enablebanking.com/?state=…&code=…" autocomplete="off" style="flex:1; min-width:220px;">
				<button class="btn-submit btn-auto btn-primary-action"><i class="fas fa-link"></i> Completa</button>
			</form>
			<form method="POST" action="?/disconnect" use:enhance style="margin-top:8px;"><input type="hidden" name="id" value={c.id}><button class="btn-submit btn-auto btn-secondary">Annulla</button></form>
		</div>
	{/each}

	{#if data.connections.length}
	<div class="recent-transactions" style="margin-top:24px;">
		<h2><i class="fas fa-link"></i> Conti collegati</h2>
		<div class="table-responsive">
			<table class="table">
				<thead><tr><th>Banca</th><th>Conto di CasaDash</th><th>Stato</th><th>Ultima lettura</th><th></th></tr></thead>
				<tbody>
					{#each data.connections.filter((c) => c.status !== 'pending' || c.provider === 'gocardless') as c (c.id)}
						<tr>
							<td>{c.institutionName}<br><small style="color:var(--text-muted);">{providerName[c.provider] || c.provider}{#if c.accountId} · …{c.accountId.slice(-6)}{/if}</small></td>
							<td>
								<form method="POST" action="?/setAccount" use:enhance style="display:flex; gap:6px; margin:0;">
									<input type="hidden" name="id" value={c.id}>
									<select name="tag" value={c.accountTag ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
										<option value="" disabled>Scegli…</option>
										{#each data.accountTags as t}<option value={t}>{t}</option>{/each}
									</select>
								</form>
							</td>
							<td>
								{statusLabel[c.status] || c.status}{#if c.lastError}<br><small style="color:var(--accent-red);">{c.lastError}</small>{/if}
								<form method="POST" action="?/toggleAuto" use:enhance style="margin:4px 0 0;">
									<input type="hidden" name="id" value={c.id}>
									<button class="chip-btn" title="Quando è accesa CasaDash legge il conto da sola ogni 8 ore; spenta, importi tu i movimenti dalla pagina Importa">
										<i class="fas fa-{c.autoSync ? 'toggle-on' : 'toggle-off'}"></i> Lettura automatica: {c.autoSync ? 'accesa' : 'spenta'}
									</button>
								</form>
							</td>
							<td>{c.lastSync ? new Date(c.lastSync).toLocaleString('it-IT') : '—'}</td>
							<td style="white-space:nowrap;">
								{#if c.status === 'linked'}
									<a class="edit-btn" href="{base}/import?bank={c.id}" title="Importa movimenti da questa banca, scegliendo le date" style="text-decoration:none; display:inline-block;"><i class="fas fa-file-import"></i></a>
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
		<p class="month-note">Per avere più controllo i movimenti si importano <strong>a mano</strong> dalla pagina <a href="{base}/import">Importa</a> (pulsante con la freccia), scegliendo le date e vedendo l'anteprima con i doppioni. Se vuoi, la <em>lettura automatica</em> di un conto porta i nuovi movimenti ogni 8 ore (le banche consentono poche letture al giorno); quelli dubbi restano in <a href="{base}/conflicts">Possibili doppioni</a>. Il tag <code>Banca</code> li contrassegna. Con Enable Banking il consenso dura fino a 180 giorni, poi va rinnovato.</p>
	</div>
	{/if}

	<div class="form-section" style="margin-top:24px;">
		<h2><i class="fas fa-broom"></i> Pulizia dei movimenti «Banca»</h2>
		<p style="color:var(--text-muted); margin-top:0;">
			Elimina i movimenti che hanno il tag <code>Banca</code> (ora <strong>{data.bankMovements}</strong>), tutti oppure solo di un conto o di un periodo.
			Si possono recuperare per 30 giorni con <em>Annulla</em> nel messaggio di conferma. I movimenti importati da file o inseriti a mano non vengono toccati.
		</p>
		<form method="POST" action="?/cleanup" use:enhance={({ cancel }) => { if (!confirm('Eliminare i movimenti con tag Banca selezionati?')) cancel(); }} style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
			<div class="form-group" style="margin:0;"><label for="cl-account">Conto</label>
				<select id="cl-account" name="account"><option value="">Tutti</option>{#each data.accountTags as t}<option value={t}>{t}</option>{/each}</select></div>
			<div class="form-group" style="margin:0;"><label for="cl-from">Dal</label><input type="date" id="cl-from" name="from"></div>
			<div class="form-group" style="margin:0;"><label for="cl-to">Al</label><input type="date" id="cl-to" name="to"></div>
			<button class="btn-submit btn-auto" style="background:var(--accent-red);" disabled={data.bankMovements === 0}><i class="fas fa-trash-alt"></i> Elimina</button>
		</form>
	</div>
</div>

<style>
	.chip-btn { font-size:0.75rem; background:none; border:1px solid var(--border-color); border-radius:12px; padding:2px 8px; cursor:pointer; color:var(--text-muted); }
</style>
