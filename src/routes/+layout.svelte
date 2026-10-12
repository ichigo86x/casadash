<script lang="ts">
	import { page } from '$app/stores';
	import '../app.css';
	import '../custom.css';
	let { data, children } = $props();

    let displayName = $derived(data.user?.displayName || "Utente");
    let isLoginPage = $derived($page.url.pathname.startsWith('/login'));

    import { onMount } from 'svelte';
    let isDarkTheme = $state(true);

    onMount(() => {
        const stored = localStorage.getItem('casadash_theme');
        if (stored === 'light' || (!stored && window.matchMedia('(prefers-color-scheme: light)').matches)) {
            isDarkTheme = false;
        } else {
            isDarkTheme = true;
        }
        document.documentElement.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
    });

    function toggleTheme() {
        isDarkTheme = !isDarkTheme;
        const newTheme = isDarkTheme ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('casadash_theme', newTheme);
    }
</script>

<svelte:head>
    <title>CasaDash — Gestione Finanziaria Familiare</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
</svelte:head>

<div class="app-wrapper">
    <!-- Top Navigation -->
    {#if !isLoginPage}
    <nav class="top-nav">
        <div class="nav-left">
            <i class="fas fa-wallet nav-logo-icon"></i>
            <span class="nav-brand">CasaDash</span>
        </div>
        <div class="nav-center">
            <a href="/" class="nav-link {$page.url.pathname === '/' ? 'active' : ''}">
                <i class="fas fa-home"></i> <span>Dashboard</span>
            </a>
            <a href="/reports" class="nav-link {$page.url.pathname.startsWith('/reports') ? 'active' : ''}">
                <i class="fas fa-chart-bar"></i> <span>Report</span>
            </a>
            <a href="/settings/categories" class="nav-link {$page.url.pathname.startsWith('/settings/categories') ? 'active' : ''}">
                <i class="fas fa-tags"></i> <span>Categorie</span>
            </a>
            <a href="/settings/budgets" class="nav-link {$page.url.pathname.startsWith('/settings/budgets') ? 'active' : ''}">
                <i class="fas fa-bullseye"></i> <span>Budget</span>
            </a>
            <a href="/settings/recurring" class="nav-link {$page.url.pathname.startsWith('/settings/recurring') ? 'active' : ''}">
                <i class="fas fa-sync-alt"></i> <span>Ricorrenti</span>
            </a>
            <a href="/settings/users" class="nav-link {$page.url.pathname.startsWith('/settings/users') ? 'active' : ''}">
                <i class="fas fa-users"></i> <span>Famiglia</span>
            </a>
            <a href="/settings/mfa" class="nav-link {$page.url.pathname.startsWith('/settings/mfa') ? 'active' : ''}">
                <i class="fas fa-shield-alt"></i> <span>MFA</span>
            </a>
            <a href="/settings/backup" class="nav-link {$page.url.pathname.startsWith('/settings/backup') ? 'active' : ''}">
                <i class="fas fa-archive"></i> <span>Dati</span>
            </a>
        </div>
        <div class="nav-right" style="display:flex; align-items:center; gap:5px;">
            <button class="nav-link" onclick={() => window.location.reload()} style="background:none; border:none; cursor:pointer;" title="Ricarica Pagina">
                <i class="fas fa-redo-alt"></i>
            </button>
            <button class="nav-link" onclick={toggleTheme} style="background:none; border:none; cursor:pointer;" title="Cambia Tema">
                {#if isDarkTheme}
                    <i class="fas fa-sun"></i>
                {:else}
                    <i class="fas fa-moon"></i>
                {/if}
            </button>
            <a href="/settings/profile" class="nav-user" style="text-decoration:none; color:inherit; display:flex; align-items:center; border:1px solid transparent; padding:5px 10px; border-radius:12px; transition:0.2s;" title="Il tuo Profilo">
                <i class="fas fa-user-circle" style="font-size:1.1rem;"></i>
                <span class="nav-user-name" style="margin-left:6px; font-weight:500;">{displayName}</span>
            </a>
            <form method="POST" action="/login?/logout" style="margin:0;">
                <button type="submit" class="nav-logout" title="Esci" style="background:none;border:none;cursor:pointer;">
                    <i class="fas fa-sign-out-alt"></i>
                </button>
            </form>
        </div>
    </nav>
    {/if}

    {@render children()}
</div>
