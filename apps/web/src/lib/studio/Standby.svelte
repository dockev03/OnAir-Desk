<script lang="ts">
  import {
    fixedTimeLevel,
    formatCountdown,
    formatElapsed,
    isTimed,
    trackRemaining,
    type AirState,
    type FixedCountdown,
    type OnAirState,
    type RundownSummary,
    type TimeFormat,
    type WeatherState,
  } from '@onair-desk/shared';
  import { i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';
  import { STANDBY_DRIFT, burnInShift, translate } from './burnin.js';
  import OnAirLamp from './OnAirLamp.svelte';
  import WeatherLine from './WeatherLine.svelte';

  /**
   * Écran de veille hors émission : horloge, voyant On Air, titre en cours de la source active,
   * prochaine émission. Un clic le quitte (pour un temps). Le contenu dérive lentement dans
   * l'écran si la protection contre l'usure est active.
   */
  let {
    stationName,
    logo,
    clock,
    air,
    now,
    today,
    next,
    drift,
    onAir,
    weather,
    timezone,
    timeFormat,
    fixed = null,
    ondismiss,
  }: {
    stationName: string;
    logo: string | null;
    clock: string;
    air: AirState | null;
    now: number;
    /** Date du jour dans le fuseau de la station (AAAA-MM-JJ). */
    today: string;
    next: RundownSummary | null;
    drift: boolean;
    onAir: OnAirState;
    weather: WeatherState | null;
    timezone: string;
    timeFormat: TimeFormat;
    /** Prochain horaire fixe (« Top horaire dans 1:05 »), seule information de suivi du temps. */
    fixed?: FixedCountdown | null;
    ondismiss: () => void;
  } = $props();

  const current = $derived(air?.nowPlaying ?? null);
  const remaining = $derived(current && isTimed(current) ? trackRemaining(current, now) : null);
  const shift = $derived(drift ? translate(burnInShift(now, STANDBY_DRIFT)) : 'none');
  const nextText = $derived(
    !next
      ? t('studio.standbyNone')
      : next.airDate === today
        ? t('studio.standbyNext', { title: next.title, time: shortTime(next.startTime) })
        : t('studio.standbyNextDate', {
            title: next.title,
            date: formatAirDate(next.airDate, i18n.locale),
            time: shortTime(next.startTime),
          }),
  );
</script>

<!-- Toute la surface est cliquable : souris seule, aucune saisie clavier sur l'afficheur. -->
<button class="standby" data-testid="standby" onclick={ondismiss}>
  <div class="content" style:transform={shift}>
    {#if logo}<img class="logo" src={logo} alt="" />{/if}
    <div class="station">{stationName}</div>
    <div class="clock mono">{clock}</div>
    <OnAirLamp {onAir} {now} large />
    <WeatherLine {weather} {now} {timezone} {timeFormat} large />
    {#if current}
      <div class="track" data-testid="standby-track">
        <span class="title">{current.title}</span>
        {#if current.artist}<span class="artist"> · {current.artist}</span>{/if}
        {#if remaining !== null}<span class="left mono"> · {formatCountdown(remaining)}</span>{/if}
      </div>
    {/if}
    <div class="next" data-testid="standby-next">{nextText}</div>
    {#if fixed}
      <div class="fixed {fixedTimeLevel(fixed.remainingMs)}" data-testid="standby-fixed">
        {fixed.remainingMs <= 0
          ? t('timing.fixedNow', { label: fixed.label })
          : t('timing.fixedIn', {
              label: fixed.label,
              time: formatElapsed(Math.ceil(fixed.remainingMs / 1000) * 1000),
            })}
      </div>
    {/if}
    <div class="hint">{t('studio.standbyHint')}</div>
  </div>
</button>

<style>
  .standby {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    border: 0;
    border-radius: 0;
    padding: 0;
    background: #0b0c0d;
    color: #fff;
    cursor: default;
  }
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
    transition: transform 2s ease-in-out;
  }
  .logo {
    max-height: 96px;
    max-width: 320px;
    object-fit: contain;
  }
  .station {
    font-size: 1.6rem;
    color: var(--muted);
  }
  .clock {
    font-size: min(16vw, 30vh);
    font-weight: 500;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .track {
    font-size: 1.6rem;
    max-width: 80vw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    font-weight: 600;
  }
  .artist,
  .left {
    color: #c9c8c2;
  }
  .next {
    font-size: 1.3rem;
    color: #c9c8c2;
  }
  .fixed {
    font-size: 1.6rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .fixed.soon {
    color: var(--warn);
  }
  .fixed.now {
    color: #ff8a8a;
  }
  .hint {
    font-size: 0.9rem;
    color: #5f5e5a;
  }
  @media (prefers-reduced-motion: reduce) {
    .content {
      transition: none;
    }
  }
</style>
