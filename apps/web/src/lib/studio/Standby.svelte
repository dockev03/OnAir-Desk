<script lang="ts">
  import {
    formatCountdown,
    isTimed,
    trackRemaining,
    type AirState,
    type RundownSummary,
  } from '@onair-desk/shared';
  import { i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';
  import { STANDBY_DRIFT, burnInShift, translate } from './burnin.js';

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
    <!-- Voyant gris tant que le déclenchement du On Air n'existe pas (étape 9). -->
    <div class="onair" aria-label={t('studio.onAir')}>{t('studio.onAir')}</div>
    {#if current}
      <div class="track" data-testid="standby-track">
        <span class="title">{current.title}</span>
        {#if current.artist}<span class="artist"> · {current.artist}</span>{/if}
        {#if remaining !== null}<span class="left mono"> · {formatCountdown(remaining)}</span>{/if}
      </div>
    {/if}
    <div class="next" data-testid="standby-next">{nextText}</div>
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
  .onair {
    padding: 0.3rem 1.2rem;
    border: 2px solid #3a3b3f;
    border-radius: 8px;
    color: #5f5e5a;
    font-weight: 700;
    letter-spacing: 0.15em;
    font-size: 1.4rem;
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
