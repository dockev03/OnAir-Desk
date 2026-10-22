<script lang="ts">
  import { untrack } from 'svelte';
  import {
    SPEED_WPM_MAX,
    SPEED_WPM_MIN,
    countWords,
    docToText,
    formatDuration,
    type Cue,
    type PrompterScript,
  } from '@onair-desk/shared';
  import ScriptView from '$lib/content/ScriptView.svelte';
  import { t } from '$lib/i18n/index.svelte.js';
  import HoldButton from './HoldButton.svelte';

  let {
    script,
    cues,
    fontSize,
    deleted,
    canPrev,
    canNext,
    onfont,
    onprev,
    onnext,
    onexit,
    label,
    exitLabel,
  }: {
    script: PrompterScript;
    cues: Cue[];
    fontSize: number;
    deleted: boolean;
    canPrev: boolean;
    canNext: boolean;
    onfont: (delta: number) => void;
    onprev: () => void;
    onnext: () => void;
    onexit: () => void;
    /** Contexte affiché à la place du titre (ex. élément 3/12 d'un conducteur). */
    label?: string;
    /** Libellé du bouton de sortie (ex. retour au conducteur). */
    exitLabel?: string;
  } = $props();

  /** Position de la bande de lecture, en proportion de la hauteur de la zone. */
  const BAND_AT = 0.3;

  let viewHeight = $state(0);
  let contentHeight = $state(0);
  /** Distance défilée (px) : 0 = première ligne sur la bande de lecture. */
  let y = $state(0);
  let auto = $state(false);
  /** Correction de vitesse à la volée (mots/min), sans modifier le script. */
  let speedDelta = $state(0);

  const lineHeight = $derived(fontSize * 1.6);
  const bandTop = $derived(Math.round(viewHeight * BAND_AT));
  const maxY = $derived(Math.max(0, contentHeight - lineHeight));
  const words = $derived(countWords(docToText(script.content)));
  const wpm = $derived(
    Math.min(SPEED_WPM_MAX, Math.max(SPEED_WPM_MIN, script.speedWpm + speedDelta)),
  );
  /** Vitesse (px/s) : toute la hauteur du texte est parcourue en « mots ÷ vitesse ». */
  const pxPerSecond = $derived(words > 0 ? contentHeight / ((words / wpm) * 60) : 0);

  /**
   * Arrêts du défilement automatique : repères avec une durée (jingle de 12 s…). Quand le
   * repère atteint la bande de lecture, le texte attend la fin de l'élément puis repart.
   */
  type Stop = { at: number; seconds: number; label: string };
  let textEl: HTMLDivElement;
  let viewWidth = $state(0);
  let stops = $state<Stop[]>([]);
  let hold = $state<{ stop: Stop; until: number } | null>(null);
  let holdLeft = $state(0);
  /** Arrêt déjà marqué à cette position : ne se redéclenche pas en repartant. */
  let doneAt = -1;

  // Positions recalculées après chaque mise en page (texte, taille, largeur).
  $effect(() => {
    void [contentHeight, viewWidth, fontSize, script.content, cues];
    const found: Stop[] = [];
    for (const el of textEl.querySelectorAll<HTMLElement>('[data-cue-seconds]')) {
      const seconds = Number(el.dataset.cueSeconds);
      if (!(seconds > 0)) continue;
      // Centre du repère sur la bande de lecture.
      const centred = Math.round(el.offsetTop - (lineHeight - el.offsetHeight) / 2);
      // Bornée à la fin du défilement : un repère en dernière ligne reste atteint.
      const at = Math.min(maxY, Math.max(0, centred));
      const label = el.dataset.cueLabel ?? '';
      const prev = found.at(-1);
      // Plusieurs repères sur la même ligne : un seul arrêt, durées additionnées.
      if (prev && Math.abs(prev.at - at) < lineHeight / 2) {
        prev.seconds += seconds;
        prev.label += ` + ${label}`;
      } else found.push({ at, seconds, label });
    }
    stops = found.sort((a, b) => a.at - b.at);
  });

  const stopsAhead = $derived(stops.filter((s) => s.at > y || (s.at === y && s.at !== doneAt)));
  const remaining = $derived(
    (pxPerSecond > 0 ? (maxY - y) / pxPerSecond : 0) +
      stopsAhead.reduce((sum, s) => sum + s.seconds, 0) +
      (hold ? holdLeft : 0),
  );

  // Nouveau script : retour au début, défilement arrêté. Même script modifié : position gardée.
  let shownId = 0;
  $effect(() => {
    const id = script.id;
    if (id !== untrack(() => shownId)) {
      shownId = id;
      y = 0;
      auto = false;
      speedDelta = 0;
      hold = null;
      doneAt = -1;
    }
  });

  // Défilement automatique (requestAnimationFrame + transform : pris en charge par le GPU).
  $effect(() => {
    if (!auto) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (hold) {
        const left = Math.ceil((hold.until - now) / 1000);
        if (left > 0) {
          if (left !== holdLeft) holdLeft = left;
          frame = requestAnimationFrame(step);
          return;
        }
        hold = null;
      }
      const next = y + pxPerSecond * dt;
      const stop = stops.find((s) => s.at >= y && s.at <= next && s.at !== doneAt);
      if (stop) {
        y = stop.at;
        doneAt = stop.at;
        hold = { stop, until: now + stop.seconds * 1000 };
        holdLeft = stop.seconds;
        frame = requestAnimationFrame(step);
        return;
      }
      if (next >= maxY) {
        y = maxY;
        auto = false;
        return;
      }
      y = next;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });

  // Molette : défilement manuel, toujours actif (même pendant le défilement automatique).
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * lineHeight : e.deltaY;
    y = Math.min(maxY, Math.max(0, y + delta));
    // En remontant au-dessus du repère marqué, l'attente est abandonnée et il s'arrêtera de
    // nouveau ; sinon (correction vers le bas) l'élément en cours continue son décompte.
    if (y < doneAt) {
      hold = null;
      doneAt = -1;
    }
  }

  function toggleAuto() {
    if (!auto && y >= maxY) {
      y = 0;
      doneAt = -1;
    }
    // Pause pendant une attente : l'élément est considéré comme passé.
    hold = null;
    auto = !auto;
  }

  /** Fin de l'élément avant la durée prévue : le texte repart tout de suite. */
  function resumeNow(e: MouseEvent) {
    e.stopPropagation();
    hold = null;
  }

  const changeSpeed = (d: number) => (speedDelta += d);
</script>

<div class="reader">
  <div class="tools">
    <button class="big" class:on={auto} onclick={toggleAuto}>
      {auto ? `❚❚ ${t('studio.pause')}` : `▶ ${t('studio.auto')}`}
    </button>
    <div class="group" aria-label={t('editor.speed')}>
      <button
        onclick={() => changeSpeed(-10)}
        aria-label={t('studio.slower')}
        disabled={wpm <= SPEED_WPM_MIN}>−</button
      >
      <span class="val mono">{wpm} <small>{t('editor.wpm')}</small></span>
      <button
        onclick={() => changeSpeed(10)}
        aria-label={t('studio.faster')}
        disabled={wpm >= SPEED_WPM_MAX}>+</button
      >
    </div>
    <div class="group" aria-label={t('studio.textSize')}>
      <button onclick={() => onfont(-4)} aria-label={t('studio.smaller')}>A−</button>
      <button onclick={() => onfont(4)} aria-label={t('studio.larger')}>A+</button>
    </div>
    <span class="title">
      {label ?? script.title}
      {#if deleted}<span class="deleted">{t('studio.deleted')}</span>{/if}
    </span>
    <span class="remain mono" title={t('studio.remaining')}>{formatDuration(remaining)}</span>
  </div>

  <!-- Un clic dans le texte lance ou met en pause le défilement automatique. -->
  <div
    class="view"
    bind:clientHeight={viewHeight}
    bind:clientWidth={viewWidth}
    onwheel={wheel}
    onclick={toggleAuto}
    role="presentation"
  >
    <div
      class="band"
      class:hold={hold !== null}
      style:top="{bandTop}px"
      style:height="{lineHeight}px"
    ></div>
    {#if hold}
      <!-- Au-dessus de la bande : ne masque que du texte déjà lu. -->
      <div class="hold-box" style:bottom="calc(100% - {bandTop}px + 12px)">
        <span class="hold-label">{hold.stop.label}</span>
        <span class="hold-left mono">{formatDuration(holdLeft)}</span>
        <button class="big" onclick={resumeNow}>▶ {t('studio.resumeNow')}</button>
      </div>
    {/if}
    <div
      class="text"
      bind:this={textEl}
      bind:clientHeight={contentHeight}
      style:transform="translate3d(0, {bandTop - y}px, 0)"
    >
      <ScriptView doc={script.content} {cues} {fontSize} />
    </div>
  </div>

  <div class="nav">
    <button class="big" onclick={onprev} disabled={!canPrev}>‹ {t('studio.previous')}</button>
    <HoldButton
      label={exitLabel ?? t('studio.exit')}
      hint={t('studio.holdToExit')}
      onhold={onexit}
    />
    <button class="big" onclick={onnext} disabled={!canNext}>{t('studio.next')} ›</button>
  </div>
</div>

<style>
  .reader {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tools,
  .nav {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .nav {
    justify-content: space-between;
  }
  .tools :global(button),
  .nav :global(button) {
    min-height: 46px;
    min-width: 46px;
    font-size: 1.05rem;
    border-radius: 8px;
    background: #1c1d20;
    border: 1px solid #2f3034;
    color: #ddd;
  }
  .big {
    padding: 0 1.1rem;
  }
  .big.on {
    background: var(--accent) !important;
    color: var(--accent-text) !important;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .val {
    min-width: 5.5rem;
    text-align: center;
    color: #fff;
  }
  .val small {
    color: var(--muted);
  }
  .title {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .deleted {
    margin-left: 0.5rem;
    font-size: 0.85rem;
    color: #f7c1c1;
    border: 1px solid var(--danger);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }
  .remain {
    color: #fac775;
    font-size: 1.2rem;
  }
  .view {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: #0b0b0c;
    border-radius: 8px;
    cursor: pointer;
  }
  .band {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px solid #ef9f27;
    border-bottom: 2px solid #ef9f27;
    background: rgba(239, 159, 39, 0.08);
    pointer-events: none;
    z-index: 1;
  }
  .band.hold {
    border-color: #85b7eb;
    background: rgba(133, 183, 235, 0.12);
  }
  .hold-box {
    position: absolute;
    right: 16px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 16px;
    background: #12243a;
    border: 2px solid #85b7eb;
    border-radius: 10px;
    cursor: default;
  }
  .hold-label {
    font-weight: 600;
    color: #85b7eb;
    font-size: 1.3rem;
  }
  .hold-left {
    font-size: 2.4rem;
    color: #fff;
  }
  .hold-box button {
    min-height: 46px;
    font-size: 1.05rem;
    border-radius: 8px;
    background: #1c1d20;
    border: 1px solid #2f3034;
    color: #ddd;
  }
  .text {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    padding: 0 24px;
    will-change: transform;
  }
  /* Pas d'espace au-dessus de la première ligne : elle doit tomber pile sur la bande. */
  .text :global(.script > :first-child) {
    margin-top: 0;
  }
</style>
