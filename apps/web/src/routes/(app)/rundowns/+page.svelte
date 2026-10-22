<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    formatDuration,
    type Library,
    type Rundown,
    type RundownList,
    type RundownSummary,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { ownerKey, ownerName, parseOwnerKey } from '$lib/library.js';
  import { addDays, formatAirDate, groupByDate, shortTime } from '$lib/rundowns.js';
  import { session } from '$lib/session.svelte.js';

  let lib = $state<Library | null>(null);
  let list = $state<RundownList | null>(null);
  let error = $state('');
  let notice = $state('');

  // Création : formulaire en ligne (titre, date, heure de début).
  let creating = $state(false);
  let newTitle = $state('');
  let newDate = $state('');
  let newStart = $state('07:00');

  // Duplication : conducteur choisi et date cible.
  let duplicating = $state<number | null>(null);
  let duplicateDate = $state('');

  const ownerId = $derived(
    parseOwnerKey(page.url.searchParams.get('owner')) ?? session.user?.id ?? null,
  );
  const owner = $derived(lib?.owners.find((o) => o.id === ownerId));
  const canWrite = $derived(owner?.canWrite ?? false);
  const groups = $derived(
    list
      ? groupByDate(
          list.rundowns.filter((r) => r.ownerId === ownerId),
          list.today,
        )
      : null,
  );

  async function refresh() {
    try {
      [lib, list] = await Promise.all([
        api<Library>('GET', '/api/library'),
        api<RundownList>('GET', '/api/rundowns'),
      ]);
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  $effect(() => {
    void refresh();
  });

  function select(owner: number | null) {
    creating = false;
    duplicating = null;
    void goto(`/rundowns?owner=${ownerKey(owner)}`, { keepFocus: true, noScroll: true });
  }

  async function run(action: () => Promise<unknown>, success = '') {
    error = notice = '';
    try {
      await action();
      notice = success;
      await refresh();
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  function startCreate() {
    creating = true;
    newTitle = '';
    newDate = list?.today ?? '';
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api<Rundown>('POST', '/api/rundowns', {
        ownerId,
        title: newTitle,
        airDate: newDate,
        startTime: newStart,
      });
      await goto(`/rundowns/${r.id}`);
    });
  }

  function startDuplicate(r: RundownSummary) {
    duplicating = r.id;
    // Par défaut : une semaine plus tard (émission hebdomadaire).
    duplicateDate = addDays(r.airDate, 7);
  }

  async function duplicate(e: SubmitEvent, r: RundownSummary) {
    e.preventDefault();
    await run(async () => {
      await api('POST', `/api/rundowns/${r.id}/duplicate`, {
        // Conducteur d'un collègue : la copie va chez moi.
        ownerId: canWrite ? r.ownerId : session.user!.id,
        airDate: duplicateDate,
      });
      duplicating = null;
    }, t('rundowns.duplicated'));
  }

  function trash(r: RundownSummary) {
    if (confirm(t('rundowns.trashConfirm', { title: r.title }))) {
      void run(() => api('DELETE', `/api/rundowns/${r.id}`));
    }
  }

  const meta = (r: RundownSummary) =>
    t('rundowns.meta', {
      date: formatAirDate(r.airDate, i18n.locale),
      time: shortTime(r.startTime),
      n: r.itemCount,
      duration: formatDuration(r.totalSeconds),
    });
</script>

{#snippet rundownList(items: RundownSummary[])}
  <ul class="list">
    {#each items as r (r.id)}
      <li class="item">
        <div class="info">
          <a href="/rundowns/{r.id}" class="title">{r.title}</a>
          <span class="muted small">{meta(r)}</span>
        </div>
        <div class="row actions">
          {#if duplicating === r.id}
            <form class="row" onsubmit={(e) => duplicate(e, r)}>
              <label class="inline">
                {t('rundowns.duplicateTo')}
                <input type="date" bind:value={duplicateDate} required />
              </label>
              <button class="primary">{t('rundowns.duplicate')}</button>
              <button type="button" onclick={() => (duplicating = null)}
                >{t('common.cancel')}</button
              >
            </form>
          {:else}
            <button onclick={() => startDuplicate(r)}>{t('rundowns.duplicate')}</button>
            {#if canWrite}
              <button class="danger" onclick={() => trash(r)}>{t('library.trash')}</button>
            {/if}
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="layout">
  <aside class="tree">
    {#if lib}
      {#each lib.owners as o (ownerKey(o.id))}
        <button class="node" class:active={o.id === ownerId} onclick={() => select(o.id)}>
          <span class="icon" class:common={o.id === null}>▣</span>
          {ownerName(o)}
          {#if !o.canWrite}<span class="ro" title={t('rundowns.readOnly')}>🔒</span>{/if}
        </button>
      {/each}
    {/if}
  </aside>

  <section class="main">
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="success">{notice}</p>{/if}

    {#if owner && groups}
      <div class="row head">
        <h1>{ownerName(owner)} · {t('rundowns.title')}</h1>
        {#if canWrite && !creating}
          <button class="primary" onclick={startCreate}>{t('rundowns.new')}</button>
        {/if}
      </div>

      {#if creating}
        <form class="card row create" onsubmit={create}>
          <label class="grow">
            {t('rundowns.field.title')}
            <input bind:value={newTitle} required maxlength="120" />
          </label>
          <label>
            {t('rundowns.field.airDate')}
            <input type="date" bind:value={newDate} required />
          </label>
          <label>
            {t('rundowns.field.startTime')}
            <input type="time" bind:value={newStart} required />
          </label>
          <button class="primary">{t('rundowns.create')}</button>
          <button type="button" onclick={() => (creating = false)}>{t('common.cancel')}</button>
        </form>
      {/if}

      {#if !canWrite}<p class="notice">{t('rundowns.readOnly')}</p>{/if}

      {#if groups.today.length + groups.upcoming.length + groups.past.length === 0}
        <p class="muted">{t('rundowns.empty')}</p>
      {/if}
      {#if groups.today.length > 0}
        <h2>{t('rundowns.today')}</h2>
        {@render rundownList(groups.today)}
      {/if}
      {#if groups.upcoming.length > 0}
        <h2>{t('rundowns.upcoming')}</h2>
        {@render rundownList(groups.upcoming)}
      {/if}
      {#if groups.past.length > 0}
        <h2>{t('rundowns.past')}</h2>
        {@render rundownList(groups.past)}
      {/if}
    {:else if !error}
      <p class="muted">{t('common.loading')}</p>
    {/if}
  </section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 1.25rem;
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .node:hover {
    background: var(--surface-2);
  }
  .node.active {
    background: var(--accent);
    color: var(--accent-text);
  }
  .icon {
    color: #85b7eb;
  }
  .icon.common {
    color: var(--muted);
  }
  .ro {
    margin-left: auto;
    font-size: 0.75rem;
  }
  .head {
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .head h1 {
    margin: 0;
  }
  h2 {
    font-size: 1rem;
    color: var(--muted);
    margin: 1.25rem 0 0.25rem;
  }
  .create {
    align-items: flex-end;
    margin-bottom: 1rem;
  }
  .create .grow {
    flex: 1;
    min-width: 14rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.65rem 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-weight: 500;
    color: var(--text);
    text-decoration: none;
  }
  .title:hover {
    text-decoration: underline;
  }
  .small {
    font-size: 0.85rem;
  }
</style>
