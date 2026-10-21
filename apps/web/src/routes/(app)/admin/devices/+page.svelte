<script lang="ts">
  import type { DeviceWithToken, PublicDevice } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';

  let devices = $state<PublicDevice[]>([]);
  let error = $state('');
  let name = $state('');
  /** Jeton tout juste créé : affiché une seule fois. */
  let issued = $state<DeviceWithToken | null>(null);
  let copied = $state(false);

  const kioskUrl = $derived(issued ? `${location.origin}/studio#token=${issued.token}` : '');

  async function refresh() {
    try {
      devices = await api<PublicDevice[]>('GET', '/api/devices');
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  $effect(() => {
    void refresh();
  });

  async function run(action: () => Promise<unknown>) {
    error = '';
    try {
      await action();
      await refresh();
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    await run(async () => {
      issued = await api<DeviceWithToken>('POST', '/api/devices', { name });
      copied = false;
      name = '';
    });
  }

  function regenerate(d: PublicDevice) {
    if (!confirm(t('devices.regenerateConfirm', { name: d.name }))) return;
    void run(async () => {
      issued = await api<DeviceWithToken>('POST', `/api/devices/${d.id}/regenerate`);
      copied = false;
    });
  }

  function revoke(d: PublicDevice) {
    if (confirm(t('devices.revokeConfirm', { name: d.name }))) {
      void run(() => api('POST', `/api/devices/${d.id}/revoke`));
    }
  }

  function remove(d: PublicDevice) {
    if (confirm(t('common.confirmDelete', { name: d.name }))) {
      void run(() => api('DELETE', `/api/devices/${d.id}`));
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(kioskUrl);
      copied = true;
    } catch {
      // Presse-papiers indisponible : l'adresse reste sélectionnable à la main.
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(iso),
        )
      : t('devices.never');
</script>

<h1>{t('devices.title')}</h1>
<p class="muted">{t('devices.intro')}</p>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if issued}
  <div class="notice stack" style="margin-bottom: 1.5rem">
    <strong>{t('devices.tokenTitle', { name: issued.device.name })}</strong>
    <span>{t('devices.tokenText')}</span>
    <input class="mono" readonly value={kioskUrl} onfocus={(e) => e.currentTarget.select()} />
    <div class="row">
      <button onclick={copy}>{copied ? t('devices.copied') : t('devices.copy')}</button>
      <button class="primary" onclick={() => (issued = null)}>{t('devices.close')}</button>
    </div>
  </div>
{/if}

<form class="row" onsubmit={create} style="margin-bottom: 1.5rem">
  <input
    bind:value={name}
    required
    maxlength="64"
    placeholder={t('devices.namePlaceholder')}
    aria-label={t('devices.name')}
  />
  <button class="primary">{t('devices.add')}</button>
</form>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>{t('devices.name')}</th>
        <th>{t('devices.lastSeen')}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each devices as d (d.id)}
        <tr>
          <td>
            {d.name}
            <span class="badge">{d.revokedAt ? t('devices.revoked') : t('devices.active')}</span>
          </td>
          <td>{fmt(d.lastSeenAt)}</td>
          <td>
            <div class="row" style="justify-content: flex-end">
              <button onclick={() => regenerate(d)}>{t('devices.regenerate')}</button>
              {#if !d.revokedAt}<button onclick={() => revoke(d)}>{t('devices.revoke')}</button
                >{/if}
              <button class="danger" onclick={() => remove(d)}>{t('common.delete')}</button>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
