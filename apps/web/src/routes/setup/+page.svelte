<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    LOCALES,
    PASSWORD_MIN_LENGTH,
    type Locale,
    type PublicUser,
    type SetupStatus,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { session } from '$lib/session.svelte.js';
  import { timezones } from '$lib/timezones.js';

  let checking = $state(true);
  let done = $state(false);
  let busy = $state(false);
  let error = $state('');

  let code = $state('');
  let stationName = $state('');
  let locale = $state<Locale>(i18n.locale);
  let timezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris');
  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let confirm = $state('');

  $effect(() => {
    i18n.set(locale);
  });

  $effect(() => {
    api<SetupStatus>('GET', '/api/setup/status')
      .then((s) => {
        if (s.needsSetup) checking = false;
        else void goto('/login', { replaceState: true });
      })
      .catch(() => {
        checking = false;
        error = t('error.network');
      });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (password !== confirm) {
      error = t('error.passwordMismatch');
      return;
    }
    busy = true;
    try {
      const res = await api<{ user: PublicUser }>('POST', '/api/setup', {
        code,
        station: { stationName, locale, timezone },
        admin: { username, displayName, password },
      });
      session.set(res.user);
      done = true;
    } catch (err) {
      error = errorMessage(errorCode(err));
    } finally {
      busy = false;
    }
  }
</script>

<div class="narrow">
  {#if checking}
    <p class="muted">{t('common.loading')}</p>
  {:else if done}
    <div class="card stack">
      <h1>{t('setup.doneTitle')}</h1>
      <p>{t('setup.doneText')}</p>
      <a href="/api/tls/root-ca.crt" download>{t('setup.downloadCa')}</a>
      <button class="primary" onclick={() => goto('/admin/devices')}>{t('setup.continue')}</button>
    </div>
  {:else}
    <form class="card stack" onsubmit={submit}>
      <h1>{t('setup.title')}</h1>
      <p class="muted">{t('setup.intro')}</p>

      <label>
        {t('field.locale')}
        <select bind:value={locale}>
          {#each LOCALES as l (l)}<option value={l}>{t(`locale.${l}`)}</option>{/each}
        </select>
      </label>

      <label>
        {t('setup.code')}
        <input
          class="mono"
          bind:value={code}
          required
          autocomplete="off"
          placeholder="XXXX-XXXX-XXXX"
        />
      </label>

      <h2>{t('setup.station')}</h2>
      <label>
        {t('field.stationName')}
        <input bind:value={stationName} required maxlength="80" />
      </label>
      <label>
        {t('field.timezone')}
        <select bind:value={timezone}>
          {#each timezones() as tz (tz)}<option value={tz}>{tz}</option>{/each}
        </select>
      </label>

      <h2>{t('setup.admin')}</h2>
      <label>
        {t('field.username')}
        <input bind:value={username} required autocomplete="username" />
        <small>{t('field.usernameHint')}</small>
      </label>
      <label>
        {t('field.displayName')}
        <input bind:value={displayName} required maxlength="64" />
      </label>
      <label>
        {t('field.password')}
        <input
          type="password"
          bind:value={password}
          required
          minlength={PASSWORD_MIN_LENGTH}
          autocomplete="new-password"
        />
        <small>{t('field.passwordHint')}</small>
      </label>
      <label>
        {t('field.passwordConfirm')}
        <input
          type="password"
          bind:value={confirm}
          required
          minlength={PASSWORD_MIN_LENGTH}
          autocomplete="new-password"
        />
      </label>

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" disabled={busy}>{t('setup.submit')}</button>
    </form>
  {/if}
</div>
