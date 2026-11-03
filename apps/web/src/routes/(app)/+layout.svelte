<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { canDirect, type SetupStatus } from '@onair-desk/shared';
  import { api } from '$lib/api.js';
  import OnAirButton from '$lib/OnAirButton.svelte';
  import { t } from '$lib/i18n/index.svelte.js';
  import { loadMe, logout, session } from '$lib/session.svelte.js';
  import { logoUrl as logoOf, stationSettings } from '$lib/settings.svelte.js';

  let { children } = $props();
  let ready = $state(false);
  let failed = $state(false);

  $effect(() => {
    void init();
  });

  async function init() {
    try {
      const status = await api<SetupStatus>('GET', '/api/setup/status');
      if (status.needsSetup) return goto('/setup', { replaceState: true });
      const me = await loadMe();
      if (!me)
        return goto(`/login?next=${encodeURIComponent(page.url.pathname)}`, { replaceState: true });
      if (me.kind === 'device') return goto('/studio', { replaceState: true });
      // Nom et logo de la station dans l'en-tête ; un échec n'empêche pas d'utiliser l'outil.
      void stationSettings.load().catch(() => {});
      ready = true;
    } catch {
      failed = true;
    }
  }

  async function signOut() {
    await logout();
    await goto('/login');
  }

  const isAdmin = $derived(session.user?.role === 'admin');
  const logoUrl = $derived(logoOf(stationSettings.value));
  const links = $derived([
    { href: '/scripts', label: t('nav.scripts') },
    { href: '/rundowns', label: t('nav.rundowns') },
    { href: '/trash', label: t('nav.trash') },
    ...(canDirect(session.user) ? [{ href: '/regie', label: t('nav.regie') }] : []),
    ...(isAdmin
      ? [
          { href: '/admin/users', label: t('nav.users') },
          { href: '/admin/devices', label: t('nav.devices') },
          { href: '/admin/settings', label: t('nav.settings') },
          { href: '/admin/audit', label: t('nav.audit') },
        ]
      : []),
    { href: '/account', label: t('nav.account') },
    { href: '/studio', label: t('nav.studio') },
  ]);
</script>

{#if failed}
  <div class="narrow"><p class="error">{t('error.network')}</p></div>
{:else if ready && session.user}
  <header class="no-print">
    <a class="brand" href="/">
      {#if logoUrl}<img class="logo" src={logoUrl} alt="" />{/if}
      {stationSettings.value?.stationName ?? t('app.name')}
    </a>
    <nav>
      {#each links as link (link.href)}
        <a href={link.href} class:active={page.url.pathname.startsWith(link.href)}>{link.label}</a>
      {/each}
    </nav>
    <OnAirButton />
    <span class="who muted">{session.user.displayName}</span>
    <button onclick={signOut}>{t('nav.logout')}</button>
  </header>
  <main>
    {@render children()}
  </main>
  {#if stationSettings.value?.weather.provider === 'openmeteo'}
    <!-- Données météo sous licence CC BY 4.0 : attribution obligatoire. -->
    <footer class="attribution muted no-print">
      <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer"
        >{t('weather.attribution')}</a
      >
    </footer>
  {/if}
{:else}
  <div class="narrow muted">{t('common.loading')}</div>
{/if}

<style>
  .attribution {
    padding: 1rem;
    text-align: center;
    font-size: 0.8rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.6rem 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }
  .logo {
    height: 28px;
    max-width: 120px;
    object-fit: contain;
  }
  nav {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    flex: 1;
  }
  nav a {
    color: var(--text);
    text-decoration: none;
    padding: 0.35rem 0.7rem;
    border-radius: 6px;
  }
  nav a:hover {
    background: var(--surface-2);
  }
  nav a.active {
    background: var(--accent);
    color: var(--accent-text);
  }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 1.5rem 16px 3rem;
  }
  @media print {
    main {
      max-width: none;
      padding: 0;
    }
  }
</style>
