<script lang="ts">
  import {
    AUDIT_CATEGORIES,
    type AuditCategory,
    type AuditEntry,
    type AuditPage,
    type PublicUser,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { stationSettings } from '$lib/settings.svelte.js';

  /** Journal d'audit (admin, lecture seule) : qui a fait quoi, et quand. */
  let data = $state<AuditPage | null>(null);
  let users = $state<PublicUser[]>([]);
  let error = $state('');

  let category = $state<AuditCategory | ''>('');
  let actorId = $state('');
  let from = $state('');
  let to = $state('');
  let page = $state(1);

  async function load() {
    error = '';
    const q = Object.entries({ page: String(page), category, actorId, from, to })
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    try {
      data = await api<AuditPage>('GET', `/api/audit?${q}`);
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  $effect(() => {
    void load();
    void stationSettings.load().catch(() => {});
    api<PublicUser[]>('GET', '/api/users')
      .then((u) => (users = u))
      .catch(() => {});
  });

  function filter(e: SubmitEvent) {
    e.preventDefault();
    page = 1;
    void load();
  }

  function go(delta: number) {
    page += delta;
    void load();
  }

  const pages = $derived(data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1);
  /** Heure dans le fuseau de la station, comme sur l'écran studio. */
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale, {
      dateStyle: 'short',
      timeStyle: 'medium',
      ...(stationSettings.value ? { timeZone: stationSettings.value.timezone } : {}),
    }).format(new Date(iso));
  const actor = (e: AuditEntry) =>
    e.actorName ??
    (e.actorType === 'system'
      ? t('audit.system')
      : e.actorType === 'anonymous'
        ? t('audit.anonymous')
        : '—');
  /** Détails sur une ligne (identifiants, adresse IP…). */
  const details = (e: AuditEntry) =>
    e.details
      ? Object.entries(e.details)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join(' · ')
      : '';
</script>

<h1>{t('audit.title')}</h1>
<p class="muted">{t('audit.intro')}</p>

<form class="row filters" onsubmit={filter}>
  <label>
    {t('audit.category')}
    <select bind:value={category}>
      <option value="">{t('audit.all')}</option>
      {#each AUDIT_CATEGORIES as c (c)}<option value={c}>{t(`audit.category.${c}`)}</option>{/each}
    </select>
  </label>
  <label>
    {t('audit.actor')}
    <select bind:value={actorId}>
      <option value="">{t('audit.all')}</option>
      {#each users as u (u.id)}<option value={String(u.id)}>{u.displayName}</option>{/each}
    </select>
  </label>
  <label>
    {t('templates.from')}
    <input type="date" bind:value={from} />
  </label>
  <label>
    {t('templates.to')}
    <input type="date" bind:value={to} min={from} />
  </label>
  <button class="primary">{t('audit.filter')}</button>
</form>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if data}
  <p class="muted small">{t('audit.count', { n: data.total })}</p>
  {#if data.entries.length === 0}
    <p class="muted">{t('audit.empty')}</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t('audit.at')}</th>
            <th>{t('audit.category')}</th>
            <th>{t('audit.action')}</th>
            <th>{t('audit.actor')}</th>
            <th>{t('audit.details')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as e (e.id)}
            <tr>
              <td class="nowrap small">{when(e.at)}</td>
              <td><span class="cat {e.category}">{t(`audit.category.${e.category}`)}</span></td>
              <td class="mono small">{e.action}</td>
              <td>{actor(e)}</td>
              <td class="small details">{details(e)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="row pager">
      <button disabled={page <= 1} onclick={() => go(-1)}>← {t('audit.previous')}</button>
      <span class="muted">{t('audit.page', { page, pages })}</span>
      <button disabled={page >= pages} onclick={() => go(1)}>{t('audit.next')} →</button>
    </div>
  {/if}
{/if}

<style>
  .filters {
    align-items: flex-end;
    margin-bottom: 1rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .nowrap {
    white-space: nowrap;
  }
  .details {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .cat {
    font-size: 0.8rem;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    background: var(--surface-2);
    white-space: nowrap;
  }
  .cat.securite {
    background: #3c3489;
  }
  .cat.contenu {
    background: #085041;
  }
  .cat.antenne {
    background: #0c447c;
  }
  .cat.regie {
    background: #633806;
  }
  .pager {
    justify-content: center;
    margin: 1rem 0 2rem;
  }
</style>
