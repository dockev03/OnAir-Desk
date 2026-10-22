<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { SetupStatus } from '@onair-desk/shared';
  import { api } from '$lib/api.js';
  import { t } from '$lib/i18n/index.svelte.js';
  import { loadMe, logout, session } from '$lib/session.svelte.js';

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
  const links = $derived([
    { href: '/scripts', label: t('nav.scripts') },
    { href: '/rundowns', label: t('nav.rundowns') },
    { href: '/trash', label: t('nav.trash') },
    ...(isAdmin
      ? [
          { href: '/admin/users', label: t('nav.users') },
          { href: '/admin/devices', label: t('nav.devices') },
          { href: '/admin/settings', label: t('nav.settings') },
        ]
      : []),
    { href: '/account', label: t('nav.account') },
    { href: '/studio', label: t('nav.studio') },
  ]);
</script>

{#if failed}
  <div class="narrow"><p class="error">{t('error.network')}</p></div>
{:else if ready && session.user}
  <header>
    <a class="brand" href="/">{t('app.name')}</a>
    <nav>
      {#each links as link (link.href)}
        <a href={link.href} class:active={page.url.pathname.startsWith(link.href)}>{link.label}</a>
      {/each}
    </nav>
    <span class="who muted">{session.user.displayName}</span>
    <button onclick={signOut}>{t('nav.logout')}</button>
  </header>
  <main>
    {@render children()}
  </main>
{:else}
  <div class="narrow muted">{t('common.loading')}</div>
{/if}

<style>
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
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
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
</style>
