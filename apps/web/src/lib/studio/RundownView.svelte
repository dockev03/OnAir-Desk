<script lang="ts">
  import {
    formatClock,
    formatDuration,
    rundownDrift,
    runPlannedStarts,
    itemColors,
    itemSeconds,
    rundownSchedule,
    secondsToTime,
    songNumbers,
    type ItemType,
    type LiveChange,
    type PrompterRundown,
    type RunState,
    type TimeFormat,
  } from '@onair-desk/shared';
  import { i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatAirDate } from '$lib/rundowns.js';
  import HoldButton from './HoldButton.svelte';

  /** Conducteur : une ligne colorée par élément, heure de passage, durée ; clic = lecture. */
  let {
    rundown,
    types,
    tags,
    currentUid,
    change = null,
    run = null,
    now = 0,
    timezone = 'UTC',
    timeFormat = '24h',
    onTimeSeconds = 5,
    onrehearse,
    onitem,
  }: {
    rundown: PrompterRundown;
    types: ItemType[];
    tags: ItemType[];
    /** Élément affiché sur le prompteur (mis en évidence). */
    currentUid: string | null;
    /** Modification en direct récente : éléments soulignés quelques secondes. */
    change?: LiveChange | null;
    /** Déroulé de ce conducteur : heures réelles (passés) et recalculées (à venir). */
    run?: RunState | null;
    now?: number;
    timezone?: string;
    timeFormat?: TimeFormat;
    onTimeSeconds?: number;
    /** « Répéter » (appui long), si l'écran y est autorisé. */
    onrehearse?: () => void;
    onitem: (uid: string) => void;
  } = $props();

  const schedule = $derived(rundownSchedule(rundown.startTime, rundown.items));
  const numbers = $derived(songNumbers(rundown.items));
  /** Heure réelle des éléments passés ; heure recalculée (prévue + retard) des suivants. */
  const actual = $derived(new Map(run?.passages.map((p) => [p.uid, p.at]) ?? []));
  const drift = $derived(run ? rundownDrift(run, now) : null);
  const planned = $derived(run ? runPlannedStarts(run) : []);
  const plannedOf = $derived(new Map(run?.items.map((it, i) => [it.uid, planned[i]!]) ?? []));
  const clock = (ms: number) => formatClock(new Date(ms), timezone, timeFormat);
  function subTime(uid: string): string | null {
    if (!run) return null;
    const at = actual.get(uid);
    if (at !== undefined) return t('timing.actual', { time: clock(at) });
    const p = plannedOf.get(uid);
    if (p === undefined || drift === null || Math.abs(drift) < onTimeSeconds * 1000) return null;
    return t('timing.expected', { time: clock(p + drift) });
  }
  const touched = $derived(
    new Set(change ? [...change.added, ...change.changed, ...change.moved] : []),
  );
</script>

<div class="view">
  <div class="head">
    <h2>{rundown.title}</h2>
    <span class="sub">
      {formatAirDate(rundown.airDate, i18n.locale)} · {secondsToTime(schedule.starts[0] ?? 0)} →
      {secondsToTime(schedule.end)}
    </span>
    {#if onrehearse}
      <span class="rehearse">
        <HoldButton
          label={t('timing.rehearse')}
          hint={t('studio.holdToExit')}
          onhold={onrehearse}
        />
      </span>
    {/if}
    {#if change}
      <span class="changed-note" data-testid="live-change-note">
        {t('studio.changedBy', { name: change.byName ?? '' })}{#if change.removed > 0}{` · ${t(
            'studio.removedCount',
            { n: change.removed },
          )}`}{/if}
      </span>
    {/if}
  </div>
  <div class="rows">
    {#each rundown.items as item, i (item.uid)}
      {@const c = itemColors(types, item.typeId)}
      {@const sub = subTime(item.uid)}
      <button
        class="row"
        class:current={item.uid === currentUid}
        class:touched={touched.has(item.uid)}
        data-touched={touched.has(item.uid) || undefined}
        style:background-color={c.bg}
        style:color={c.fg}
        onclick={() => onitem(item.uid)}
      >
        <span class="num">{numbers[i] ?? ''}</span>
        <span class="time mono"
          >{secondsToTime(schedule.starts[i] ?? 0)}{#if sub}<span
              class="sub-time"
              data-testid="row-subtime">{sub}</span
            >{/if}</span
        >
        <span class="name">
          {item.title}{#if item.artist}<span class="artist">{` · ${item.artist}`}</span>{/if}
          {#if item.scriptId !== null && item.script && !item.script.deleted}<span
              class="doc"
              aria-hidden="true">≡</span
            >{/if}
        </span>
        {#each item.tags as tagId (tagId)}
          {@const tc = itemColors(tags, tagId)}
          <span class="tag" style:background-color={tc.bg} style:color={tc.fg}
            >{tags.find((x) => x.id === tagId)?.label ?? tagId}</span
          >
        {/each}
        {#if item.introSeconds !== null}
          <span class="intro mono"
            >{t('studio.introTime', { time: formatDuration(item.introSeconds) })}</span
          >
        {/if}
        {#if item.cuttable}<span class="cut" aria-label={t('rundowns.item.cuttable')}>✂</span>{/if}
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
    display: flex;
    flex-direction: column;
  }
  .sub-time {
    font-size: 0.8rem;
    opacity: 0.85;
    white-space: nowrap;
  }
  .rehearse {
    margin-left: auto;
  }
  .rehearse :global(.hold) {
    padding: 0.4rem 1rem;
  }
  .name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .num {
    width: 1.6rem;
    flex-shrink: 0;
    text-align: right;
    font-weight: 700;
  }
  .artist {
    opacity: 0.8;
  }
  .tag {
    flex-shrink: 0;
    padding: 0.05rem 0.55rem;
    border-radius: 999px;
    font-size: 0.85rem;
    border: 1px solid rgba(255, 255, 255, 0.35);
  }
  .intro {
    flex-shrink: 0;
    font-size: 1rem;
    opacity: 0.85;
  }
  .cut {
    flex-shrink: 0;
  }
  .doc {
    margin-left: 0.5rem;
    font-weight: 700;
    opacity: 0.8;
  }
  .dur {
    font-size: 1rem;
  }
  /* Modifié en direct : liseré neutre (ni orange ni rouge, réservés aux alertes). */
  .row.touched {
    outline: 3px solid #e6f1fb;
    outline-offset: -3px;
  }
  .changed-note {
    margin-left: auto;
    color: #e6f1fb;
    font-size: 1rem;
  }
</style>
