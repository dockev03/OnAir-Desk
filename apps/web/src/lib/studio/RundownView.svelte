<script lang="ts">
  import {
    formatDuration,
    itemColors,
    itemSeconds,
    rundownSchedule,
    secondsToTime,
    type ItemType,
    type PrompterRundown,
  } from '@onair-desk/shared';
  import { i18n } from '$lib/i18n/index.svelte.js';
  import { formatAirDate } from '$lib/rundowns.js';

  /** Conducteur : une ligne colorée par élément, heure de passage, durée ; clic = lecture. */
  let {
    rundown,
    types,
    currentUid,
    onitem,
  }: {
    rundown: PrompterRundown;
    types: ItemType[];
    /** Élément affiché sur le prompteur (mis en évidence). */
    currentUid: string | null;
    onitem: (uid: string) => void;
  } = $props();

  const schedule = $derived(rundownSchedule(rundown.startTime, rundown.items));
</script>

<div class="view">
  <div class="head">
    <h2>{rundown.title}</h2>
    <span class="sub">
      {formatAirDate(rundown.airDate, i18n.locale)} · {secondsToTime(schedule.starts[0] ?? 0)} →
      {secondsToTime(schedule.end)}
    </span>
  </div>
  <div class="rows">
    {#each rundown.items as item, i (item.uid)}
      {@const c = itemColors(types, item.typeId)}
      <button
        class="row"
        class:current={item.uid === currentUid}
        style:background-color={c.bg}
        style:color={c.fg}
        onclick={() => onitem(item.uid)}
      >
        <span class="time mono">{secondsToTime(schedule.starts[i] ?? 0)}</span>
        <span class="name">
          {item.title}
          {#if item.scriptId !== null && item.script && !item.script.deleted}<span
              class="doc"
              aria-hidden="true">≡</span
            >{/if}
        </span>
        <span class="dur mono">{formatDuration(itemSeconds(item))}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .view {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
    margin: 0.3rem 0 0.6rem;
  }
  h2 {
    color: #fff;
    font-size: 1.2rem;
    margin: 0;
  }
  .sub {
    color: var(--muted);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-height: 54px;
    padding: 0.4rem 1rem;
    border-radius: 8px;
    border: 0;
    font-size: 1.15rem;
    text-align: left;
  }
  .row.current {
    outline: 3px solid #ef9f27;
    outline-offset: -3px;
  }
  .time {
    width: 5.4rem;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .doc {
    margin-left: 0.5rem;
    font-weight: 700;
    opacity: 0.8;
  }
  .dur {
    font-size: 1rem;
  }
</style>
