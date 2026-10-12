<script lang="ts">
	import { enhance } from '$app/forms';
	import { base } from '$app/paths';
	import '../../app.css'; // global styles
	
	let { form } = $props();

</script>

<svelte:head>
	<title>Accedi — CasaDash</title>
</svelte:head>

<div class="login-wrapper">
	<div class="login-box">
		<div class="login-header">
			<i class="fas fa-wallet login-logo"></i>
			<h2>CasaDash</h2>
			<p>Gestione Finanziaria Familiare</p>
		</div>
		
		{#if form?.error}
			<div class="error-msg">
				<i class="fas fa-exclamation-circle"></i> {form.error}
			</div>
		{/if}

		{#if form?.mfaRequired}
			<form method="POST" action="?/mfaVerify" use:enhance class="login-form">
				<p style="text-align:center; color:var(--text-muted); margin-bottom:15px;">
					Inserisci il codice a 6 cifre dall'app Google Authenticator.
				</p>
				<div class="form-group">
					<label for="code"><i class="fas fa-shield-alt"></i> Codice MFA</label>
					<input type="text" inputmode="numeric" id="code" name="code" placeholder="123 456" pattern="[0-9 ]+" maxlength="7" required autocomplete="one-time-code" style="font-size:1.5rem; text-align:center; letter-spacing:8px;">
				</div>
				<button type="submit" class="btn-submit">
					<i class="fas fa-check-circle"></i> Verifica
				</button>
				<button type="button" class="btn-submit" style="background:#e74c3c; margin-top:15px; box-shadow:none;" onclick={() => window.location.href=`${base}/login`}>
					<i class="fas fa-arrow-left"></i> Annulla
				</button>
			</form>
		{:else}
			<form method="POST" action="?/login" use:enhance class="login-form">
				<div class="form-group">
					<label for="username"><i class="fas fa-user"></i> Nome Utente</label>
					<input type="text" id="username" name="username" required placeholder="tuonome" autocomplete="username">
				</div>
			
			<div class="form-group">
				<label for="password"><i class="fas fa-lock"></i> Password</label>
				<input type="password" id="password" name="password" required placeholder="••••••••" autocomplete="current-password">
			</div>
			
				<button type="submit" class="btn-submit">
					<i class="fas fa-sign-in-alt"></i> Accedi
				</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.login-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background-color: var(--bg-primary);
		padding: 20px;
	}

	.login-box {
		background: var(--bg-card);
		width: 100%;
		max-width: 400px;
		padding: 40px 30px;
		border-radius: var(--radius-xl);
		border: 1px solid var(--border-color);
		box-shadow: var(--shadow-lg);
	}

	.login-header {
		text-align: center;
		margin-bottom: 30px;
	}

	.login-logo {
		font-size: 3rem;
		background: var(--gradient-primary);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		margin-bottom: 10px;
	}

	.login-header h2 {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 5px;
	}

	.login-header p {
		color: var(--text-muted);
		font-size: 0.95rem;
	}

	.error-msg {
		background: var(--accent-red-glow);
		color: var(--accent-red);
		padding: 12px;
		border-radius: var(--radius-sm);
		font-size: 0.9rem;
		margin-bottom: 20px;
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1px solid rgba(231, 76, 60, 0.2);
	}

	.login-form .form-group {
		margin-bottom: 20px;
	}
	
	.login-form input {
		width: 100%;
		padding: 14px;
		font-size: 1rem;
	}
	
	.login-form .btn-submit {
		width: 100%;
		padding: 14px;
		font-size: 1.05rem;
		margin-top: 10px;
		background: var(--gradient-primary);
		box-shadow: 0 4px 15px rgba(67, 97, 238, 0.3);
	}
</style>
