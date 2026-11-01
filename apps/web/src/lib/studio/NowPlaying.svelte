<script lang="ts">
  import {
    formatClock,
    formatCountdown,
    formatDuration,
    introRemaining,
    isTimed,
    nextStartAt,
    trackAlertLevel,
    trackProgress,
    trackRemaining,
    type AirState,
    type TimeFormat,
    type TrackAlertSettings,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';

  /**
   * Bandeau supérieur : titre en cours (temps restant, progression, alerte de fin, intro) et
   * titre à venir (heure de démarrage), calculés avec l'heure serveur. Bandeau réduit
   * (disposition « Interview ») : titre en cours et temps restant seulement.
   */
  let {
    air,
    now,
    timezone,
    timeFormat,
    alert,
    compact = false,
  }: {
    air: AirState;
    now: number;
    timezone: string;
    timeFormat: TimeFormat;
    alert: TrackAlertSettings;
    compact?: boolean;
  } = $props();

  const current = $derived(air.nowPlaying);
  /** Mode dégradé (seul le nom du titre est connu) : ni temps restant, ni barre, ni alerte. */
  const timed = $derived(current !== null && isTimed(current));
  const remaining = $derived(current ? trackRemaining(current, now) : 0);
  const progress = $derived(current ? trackProgress(current, now) : 0);
  const nextAt = $derived(nextStartAt(current, now));
  const level = $derived(trackAlertLevel(current, now, alert));
  const intro = $derived(current && timed ? introRemaining(current, now) : null);
  /** Repères sur la barre : fin de l'intro, début de l'outro (fraction de la durée). */
  const marks = $derived.by(() => {
    if (!current || !timed) return [];
    const d = current.durationMs;
    return [current.introMs, current.outroMs === null ? null : d - current.outroMs]
      .filter((v): v is number => v !== null && v > 0 && v < d)
      .map((v) => v / d);
  });
  const failed = $derived(air.source.state === 'error');
  const seconds = (ms: number) => formatDuration(Math.round(ms / 1000));
</script>

<section
  class="card track now"
  class:soon={level === 'soon'}
  class:alert-now={level === 'now'}
  aria-label={t('studio.nowPlaying')}
  data-alert={level}
>
  <div class="label">{t('studio.nowPlaying')}</div>
  {#if current}
    <div class="row-main">
      <div class="names">
        <div class="title" data-testid="now-title">{current.title}</div>
        {#if current.artist && !compact}<div class="artist">{current.artist}</div>{/if}
      </div>
      {#if intro !== null && intro > 0}
        <div class="intro mono" data-testid="intro-left">
          {t('studio.introLeft', { time: formatCountdown(intro) })}
        </div>
      {/if}
      {#if timed}
        <div class="remaining mono" title={t('studio.trackRemaining')}>
          {formatCountdown(remaining)}
        </div>
      {/if}
    </div>
    {#if level !== 'none'}
      <div class="cue-text" role="status" data-testid="track-alert">
        {level === 'soon'
          ? t('studio.soon')
          : t('studio.yourTurn', { n: Math.max(0, Math.ceil(remaining / 1000)) })}
      </div>
    {/if}
    {#if timed && !compact}
      <div
        class="bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(progress * 100)}
      >
        <span class="fill" style:transform="scaleX({progress})"></span>
        {#each marks as m, i (i)}
          <span class="mark" style:left="{m * 100}%"></span>
        {/each}
      </div>
      <div class="meta mono">
        {seconds(current.durationMs)}{current.outroMs
          ? ` · ${t('studio.outro')} ${seconds(current.outroMs)}`
          : ''}
      </div>
    {:else if failed}
      <div class="meta">{t('studio.sourceError')}</div>
    {/if}
  {:else}
    <div class="empty">{failed ? t('studio.sourceError') : '—'}</div>
  {/if}
</section>

{#if !compact}
  <section class="card track next" aria-label={t('studio.nextTrack')}>
    <div class="label">{t('studio.nextTrack')}</div>
    {#if air.next}
      <div class="names">
        <div class="title" data-testid="next-title">{air.next.title}</div>
        <div class="artist">{air.next.artist}</div>
      </div>
      <div class="meta mono">
        {seconds(air.next.durationMs)}{air.next.introMs
          ? ` · ${t('studio.intro')} ${seconds(air.next.introMs)}`
          : ''}
        {#if nextAt !== null}
          · {t('studio.startsAtShort', {
            time: formatClock(new Date(nextAt), timezone, timeFormat),
          })}
        {/if}
      </div>
    {:else}
      <div class="empty">—</div>
    {/if}
  </section>
{/if}

<style>
  .track {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    padding: 6px 14px;
    min-width: 0;
  }
  .now {
    flex: 1.4;
  }
  .next {
    flex: 1;
  }
  .label {
    font-size: 0.8rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .names {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: 1.25rem;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    color: #c9c8c2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Lisible à 2 m : le temps restant est la donnée la plus regardée du bloc. */
  .remaining {
    font-size: 2.2rem;
    font-weight: 600;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: #2f3034;
    overflow: hidden;
  }
  /* Animation GPU (transform), une mise à jour par seconde. */
  .bar .fill {
    display: block;
    height: 100%;
    background: #85b7eb;
    transform-origin: left;
    transition: transform 1s linear;
  }
  /* Repères intro / outro : traits fins, hors du code couleur d'alerte. */
  .bar .mark {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: #fff;
    opacity: 0.8;
  }
  /* Talk-over : couleur neutre (l'orange et le rouge sont réservés aux alertes). */
  .intro {
    font-size: 1.4rem;
    font-weight: 600;
    color: #85b7eb;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* Alerte de fin de titre : un seul code couleur pour tout l'écran. */
  .now.soon {
    border-color: var(--warn);
    background: #3b2a0c;
  }
  .now.soon .remaining,
  .now.soon .cue-text {
    color: var(--warn);
  }
  .now.alert-now {
    position: relative;
    border-color: var(--danger);
    background: var(--danger-bg);
  }
  /* Pulsation lente (~1 Hz) par l'opacité d'un calque : pas de flash, animée par le GPU. */
  .now.alert-now::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--danger);
    opacity: 0;
    pointer-events: none;
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.35;
    }
  }
  .cue-text {
    font-size: 1.3rem;
    font-weight: 700;
    color: #fff;
  }
  .meta {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .empty {
    color: var(--muted);
    font-size: 1.1rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar .fill {
      transition: none;
    }
    /* Rouge fixe, sans pulsation. */
    .now.alert-now::after {
      animation: none;
      opacity: 0.25;
    }
  }
</style>
