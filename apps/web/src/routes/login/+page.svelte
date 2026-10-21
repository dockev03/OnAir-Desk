<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PublicUser } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';
  import { session } from '$lib/session.svelte.js';

  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  /** Redirection après connexion : uniquement vers une page de cette application. */
  function nextUrl(): string {
    const next = page.url.searchParams.get('next') ?? '/';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      const res = await api<{ user: PublicUser }>('POST', '/api/auth/login', {
        username,
        password,
      });
      session.set(res.user);
      await goto(nextUrl(), { replaceState: true });
    } catch (err) {
      error = errorMessage(errorCode(err));
      password = '';
    } finally {
      busy = false;
    }
  }
</script>

<div class="narrow">
  <form class="card stack" onsubmit={submit}>
    <h1>{t('login.title')}</h1>
    <label>
      {t('field.username')}
      <input bind:value={username} required autocomplete="username" />
    </label>
    <label>
      {t('field.password')}
      <input type="password" bind:value={password} required autocomplete="current-password" />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" disabled={busy}>{t('login.submit')}</button>
  </form>
</div>
