<script lang="ts">
  import { LOCALES, TIME_FORMATS, type Settings } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';
  import { timezones } from '$lib/timezones.js';

  let settings = $state<Settings | null>(null);
  let error = $state('');
  let saved = $state(false);
  let hasRootCa = $state(false);

  $effect(() => {
    api<Settings>('GET', '/api/settings')
      .then((s) => (settings = s))
      .catch((e) => (error = errorMessage(errorCode(e))));
    fetch('/api/tls/root-ca.crt', { method: 'HEAD' })
      .then((r) => (hasRootCa = r.ok))
      .catch(() => {});
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!settings) return;
    error = '';
    saved = false;
    try {
      settings = await api<Settings>('PUT', '/api/settings', settings);
      saved = true;
    } catch (err) {
      error = errorMessage(errorCode(err));
    }
  }
</script>

<h1>{t('settings.title')}</h1>

{#if settings}
  <form class="card stack" onsubmit={save}>
    <label>
      {t('field.stationName')}
      <input bind:value={settings.stationName} required maxlength="80" />
    </label>
    <label>
      {t('field.locale')}
      <select bind:value={settings.locale}>
        {#each LOCALES as l (l)}<option value={l}>{t(`locale.${l}`)}</option>{/each}
      </select>
    </label>
    <label>
      {t('field.timezone')}
      <select bind:value={settings.timezone}>
        {#each timezones() as tz (tz)}<option value={tz}>{tz}</option>{/each}
      </select>
    </label>
    <label>
      {t('field.timeFormat')}
      <select bind:value={settings.timeFormat}>
        {#each TIME_FORMATS as f (f)}<option value={f}>{t(`timeFormat.${f}`)}</option>{/each}
      </select>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if saved}<p class="success">{t('common.saved')}</p>{/if}
    <div><button class="primary">{t('common.save')}</button></div>
  </form>
{:else if error}
  <p class="error">{error}</p>
{/if}

{#if hasRootCa}
  <h2>{t('settings.tls')}</h2>
  <p class="muted">{t('settings.tlsText')}</p>
  <a href="/api/tls/root-ca.crt" download>{t('setup.downloadCa')}</a>
{/if}
