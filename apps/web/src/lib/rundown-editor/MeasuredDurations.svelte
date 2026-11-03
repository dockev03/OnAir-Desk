<script lang="ts">
  import {
    formatClock,
    formatDuration,
    formatElapsed,
    localDateIn,
    type RehearsalSummary,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatAirDate } from '$lib/rundowns.js';
  import { stationSettings } from '$lib/settings.svelte.js';
  import type { EditItem } from './items.js';

  /**
   * Durées mesurées en répétition (plan étape 11, décision 18) : l'animateur coche celles à
   * reprendre ; l'enregistrement reste celui de l'éditeur (version, droits habituels).
   */
  let {
    rundownId,
    items = $bindable(),
    canWrite,
    onchange,
  }: {
    rundownId: number;
    items: EditItem[];
    canWrite: boolean;
    onchange: () => void;
  } = $props();

  let list = $state<RehearsalSummary[] | null>(null);
  let chosen = $state(0);
  let ticked = $state<Record<string, boolean>>({});
  let error = $state('');
  let notice = $state('');

  async function load() {
    try {
      list = await api<RehearsalSummary[]>('GET', `/api/rundowns/${rundownId}/rehearsals`);
      chosen = list[0]?.runId ?? 0;
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  const current = $derived(list?.find((r) => r.runId === chosen) ?? null);
  const present = $derived(new Set(items.map((i) => i.uid)));

  function apply() {
    if (!current) return;
    let n = 0;
    for (const m of current.items) {
      if (!ticked[m.uid] || m.measuredSeconds === null) continue;
      const item = items.find((i) => i.uid === m.uid);
      if (!item) continue;
      item.durationSeconds = m.measuredSeconds;
      item.durationText = formatDuration(m.measuredSeconds);
      item.durationInvalid = false;
      n++;
    }
    ticked = {};
    if (n > 0) {
      notice = t('rundowns.measuredApplied', { n });
      onchange();
    }
  }

  /** Date et heure d'une répétition, dans le fuseau de la station. */
  const when = (ms: number) => {
    const tz = stationSettings.value?.timezone ?? 'UTC';
    const format = stationSettings.value?.timeFormat ?? '24h';
    return {
      date: formatAirDate(localDateIn(ms, tz), i18n.locale),
      time: formatClock(new Date(ms), tz, format).slice(0, 5),
    };
  };
</script>

<details
  class="measured"
  ontoggle={(e) => {
    if ((e.currentTarget as HTMLDetailsElement).open && list === null) void load();
  }}
>
  <summary>{t('rundowns.measured')}</summary>
  {#if error}<p class="error">{error}</p>{/if}
  {#if list && list.length === 0}
    <p class="muted">{t('rundowns.noRehearsal')}</p>
  {:else if list && current}
    <select bind:value={chosen} aria-label={t('rundowns.measured')}>
      {#each list as r (r.runId)}
        <option value={r.runId}
          >{t('rundowns.rehearsalOf', {
            ...when(r.startedAt),
            total: formatElapsed(r.totalSeconds * 1000),
          })}</option
        >
      {/each}
    </select>
    {#if canWrite}<p class="muted">{t('rundowns.measuredHint')}</p>{/if}
    <ul>
      {#each current.items.filter((m) => present.has(m.uid)) as m (m.uid)}
        <li>
          <label>
            {#if canWrite}
              <input
                type="checkbox"
                bind:checked={ticked[m.uid]}
                disabled={m.measuredSeconds === null}
              />
            {/if}
            <span class="name">{m.title}</span>
            <span class="muted"
              >{t('rundowns.plannedShort', { time: formatDuration(m.plannedSeconds) })}</span
            >
            <strong
              >{m.measuredSeconds === null
                ? '—'
                : t('rundowns.measuredShort', { time: formatDuration(m.measuredSeconds) })}</strong
            >
          </label>
        </li>
      {/each}
    </ul>
    {#if canWrite}
      <button onclick={apply} disabled={!Object.values(ticked).some(Boolean)}
        >{t('rundowns.applyMeasured')}</button
      >
    {/if}
    {#if notice}<p class="success">{notice}</p>{/if}
  {/if}
</details>

<style>
  .measured {
    margin: 1rem 0;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
  }
  li label {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    padding: 0.2rem 0;
  }
  .name {
    flex: 1;
  }
</style>
