<script lang="ts">
  import { formatDuration, type RundownSummary } from '@onair-desk/shared';
  import { i18n } from '$lib/i18n/index.svelte.js';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';

  /** Liste de conducteurs à grandes zones cliquables (Aujourd'hui, ou ceux d'un dossier). */
  let {
    title,
    rundowns,
    today,
    ownerLabel,
    empty,
    onopen,
  }: {
    title: string;
    rundowns: RundownSummary[];
    today: string;
    /** Nom du dossier affiché sur chaque ligne (Aujourd'hui : tous dossiers confondus). */
    ownerLabel?: (ownerId: number | null) => string;
    empty: string;
    onopen: (id: number) => void;
  } = $props();
</script>

<div class="picker">
  <h2>{title}</h2>
  {#if rundowns.length === 0}<p class="empty">{empty}</p>{/if}
  <div class="rows">
    {#each rundowns as r (r.id)}
      <button class="row" class:today={r.airDate === today} onclick={() => onopen(r.id)}>
        <span class="when mono">
          {#if r.airDate !== today}<span class="date">{formatAirDate(r.airDate, i18n.locale)}</span
            >{/if}
          {shortTime(r.startTime)}
        </span>
        <span class="name">
          {r.title}
          {#if ownerLabel}<span class="owner">{ownerLabel(r.ownerId)}</span>{/if}
        </span>
        <span class="dur mono">{formatDuration(r.totalSeconds)}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .picker {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  h2 {
    color: #fff;
    font-size: 1.2rem;
    margin: 0.3rem 0 0.6rem;
  }
  .empty {
    color: var(--muted);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-height: 56px;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    border: 1px solid #2f3034;
    border-left: 4px solid #85b7eb;
    background: #1c1d20;
    color: #ececec;
    font-size: 1.15rem;
    text-align: left;
  }
  .row.today {
    border-left-color: #fac775;
  }
  .row:hover {
    background: #232427;
  }
  .when {
    display: flex;
    flex-direction: column;
    min-width: 4rem;
  }
  .date {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .owner {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .dur {
    color: var(--muted);
    font-size: 1rem;
  }
</style>
