<script lang="ts">
  import {
    formatClock,
    formatCountdown,
    formatDuration,
    nextStartAt,
    trackProgress,
    trackRemaining,
    type AirState,
    type TimeFormat,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';

  /**
   * Bandeau supérieur : titre en cours (temps restant, progression) et titre à venir (heure de
   * démarrage), calculés avec l'heure serveur. Les alertes de fin de titre arrivent à l'étape 7.
   */
  let {
    air,
    now,
    timezone,
    timeFormat,
  }: { air: AirState; now: number; timezone: string; timeFormat: TimeFormat } = $props();

  const current = $derived(air.nowPlaying);
  const remaining = $derived(current ? trackRemaining(current, now) : 0);
  const progress = $derived(current ? trackProgress(current, now) : 0);
  const nextAt = $derived(nextStartAt(current, now));
  const failed = $derived(air.source.state === 'error');
  const seconds = (ms: number) => formatDuration(Math.round(ms / 1000));
</script>

<section class="card track now" aria-label={t('studio.nowPlaying')}>
  <div class="label">{t('studio.nowPlaying')}</div>
  {#if current}
    <div class="row-main">
      <div class="names">
        <div class="title" data-testid="now-title">{current.title}</div>
        <div class="artist">{current.artist}</div>
      </div>
      <div class="remaining mono" title={t('studio.trackRemaining')}>
        {formatCountdown(remaining)}
      </div>
    </div>
    <div
      class="bar"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(progress * 100)}
    >
      <span style:transform="scaleX({progress})"></span>
    </div>
    <div class="meta mono">
      {seconds(current.durationMs)}{current.outroMs
        ? ` · ${t('studio.outro')} ${seconds(current.outroMs)}`
        : ''}
    </div>
  {:else}
    <div class="empty">{failed ? t('studio.sourceError') : '—'}</div>
  {/if}
</section>

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
    height: 6px;
    border-radius: 3px;
    background: #2f3034;
    overflow: hidden;
  }
  /* Animation GPU (transform), une mise à jour par seconde. */
  .bar span {
    display: block;
    height: 100%;
    background: #85b7eb;
    transform-origin: left;
    transition: transform 1s linear;
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
    .bar span {
      transition: none;
    }
  }
</style>
