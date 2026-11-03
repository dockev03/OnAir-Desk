<script lang="ts">
  import { formatElapsed, micTimer, type OnAirState } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';

  /**
   * Voyant ON AIR (gris = éteint, rouge fixe = allumé) et chronomètre micro ouvert. S'il est
   * cliquable (écran studio autorisé), un appui long d'1 seconde l'inverse : un clic
   * accidentel ne fait rien.
   */
  let {
    onAir,
    now,
    interactive = false,
    large = false,
    ontoggle = () => {},
  }: {
    onAir: OnAirState;
    now: number;
    interactive?: boolean;
    large?: boolean;
    ontoggle?: () => void;
  } = $props();

  const HOLD_MS = 1000;
  let holding = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mic = $derived(micTimer(onAir, now));

  function start(e: PointerEvent) {
    if (!interactive || e.button !== 0) return;
    holding = true;
    timer = setTimeout(() => {
      holding = false;
      ontoggle();
    }, HOLD_MS);
  }

  function cancel() {
    holding = false;
    clearTimeout(timer);
  }
</script>

<div class="onair-row" class:large>
  {#if interactive}
    <button
      type="button"
      class="lamp"
      class:on={onAir.on}
      class:holding
      style:--hold-ms="{HOLD_MS}ms"
      data-testid="onair-lamp"
      aria-pressed={onAir.on}
      aria-label="{onAir.on ? t('studio.onAirOff') : t('studio.onAirOn')} ({t(
        'studio.holdToExit',
      )})"
      title={t('studio.holdToExit')}
      onpointerdown={start}
      onpointerup={cancel}
      onpointerleave={cancel}
      onpointercancel={cancel}>{t('studio.onAir')}</button
    >
  {:else}
    <span class="lamp" class:on={onAir.on} data-testid="onair-lamp">{t('studio.onAir')}</span>
  {/if}
  {#if mic}
    <span
      class="mic mono"
      class:stopped={!mic.running}
      data-testid="mic-timer"
      title={mic.running
        ? t('studio.micOpen', { time: formatElapsed(mic.ms) })
        : t('studio.micLast', { time: formatElapsed(mic.ms) })}>{formatElapsed(mic.ms)}</span
    >
  {/if}
</div>

<style>
  .onair-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lamp {
    position: relative;
    overflow: hidden;
    padding: 1px 10px;
    border: 2px solid #3a3b3f;
    border-radius: 6px;
    background: transparent;
    color: #5f5e5a;
    font-weight: 700;
    font-size: 0.85rem;
    letter-spacing: 0.12em;
    line-height: 1.4;
    cursor: default;
  }
  .large .lamp {
    font-size: 1.4rem;
    padding: 0.3rem 1.2rem;
    border-radius: 8px;
  }
  /* Voyant allumé : rouge fixe, sans clignotement (convention radio, hors code d'alerte). */
  .lamp.on {
    border-color: #e24b4a;
    background: #a32d2d;
    color: #fff;
  }
  /* Appui long : remplissage progressif, comme le bouton « Sortir ». */
  button.lamp::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.25);
    transform: scaleX(0);
    transform-origin: left;
  }
  button.lamp.holding::after {
    transform: scaleX(1);
    transition: transform var(--hold-ms) linear;
  }
  .mic {
    color: #fff;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .large .mic {
    font-size: 1.4rem;
  }
  .mic.stopped {
    color: var(--muted);
  }
  @media (prefers-reduced-motion: reduce) {
    button.lamp.holding::after {
      transition: none;
      transform: scaleX(0.5);
    }
  }
</style>
