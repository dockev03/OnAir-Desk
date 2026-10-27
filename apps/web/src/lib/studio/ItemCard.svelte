<script lang="ts">
  import {
    formatDuration,
    itemColors,
    itemSeconds,
    type ItemType,
    type RundownItem,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';
  import HoldButton from './HoldButton.svelte';

  /**
   * Élément de conducteur sans texte à lire (titre, pub…) : grande carte, pour que
   * l'animateur sache toujours ce qui passe et ce qui suit.
   */
  let {
    item,
    types,
    position,
    startsAt,
    canPrev,
    canNext,
    onprev,
    onnext,
    onexit,
  }: {
    item: RundownItem;
    types: ItemType[];
    /** « 3/12 » */
    position: string;
    startsAt: string;
    canPrev: boolean;
    canNext: boolean;
    onprev: () => void;
    onnext: () => void;
    onexit: () => void;
  } = $props();

  const colors = $derived(itemColors(types, item.typeId));
  const typeLabel = $derived(types.find((x) => x.id === item.typeId)?.label ?? item.typeId);
</script>

<div class="wrap">
  <div class="card-item" style:background-color={colors.bg} style:color={colors.fg}>
    <div class="top">
      <span class="type">{typeLabel}</span>
      <span class="pos mono">{position}</span>
    </div>
    <div class="title">{item.title}</div>
    {#if item.artist || item.year !== null}
      <div class="artist">{[item.artist, item.year].filter(Boolean).join(' · ')}</div>
    {/if}
    <div class="facts mono">
      <span>{t('studio.startsAt', { time: startsAt })}</span>
      <span>{formatDuration(itemSeconds(item))}</span>
      {#if item.introSeconds !== null}
        <span>{t('studio.introTime', { time: formatDuration(item.introSeconds) })}</span>
      {/if}
      {#if item.cuttable}<span>✂ {t('rundowns.item.cuttable')}</span>{/if}
    </div>
    {#if item.notes}<p class="notes">{item.notes}</p>{/if}
    <p class="hint">
      {item.scriptId !== null ? t('studio.scriptGone') : t('studio.noText')}
    </p>
  </div>

  <div class="nav">
    <button class="big" onclick={onprev} disabled={!canPrev}>‹ {t('studio.previous')}</button>
    <HoldButton label={t('studio.backToRundown')} hint={t('studio.holdToExit')} onhold={onexit} />
    <button class="big" onclick={onnext} disabled={!canNext}>{t('studio.next')} ›</button>
  </div>
</div>

<style>
  .wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1rem;
    padding: 2rem 2.5rem;
    border-radius: 12px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    font-size: 1.3rem;
    opacity: 0.85;
  }
  .type {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }
  .title {
    font-size: clamp(2rem, 6vw, 4rem);
    font-weight: 600;
    line-height: 1.15;
  }
  .artist {
    font-size: clamp(1.4rem, 3.5vw, 2.4rem);
    opacity: 0.85;
  }
  .facts {
    display: flex;
    gap: 0.5rem 2rem;
    flex-wrap: wrap;
    font-size: 1.5rem;
  }
  .notes {
    margin: 0;
    font-size: 1.4rem;
    white-space: pre-wrap;
  }
  .hint {
    margin: 0;
    opacity: 0.65;
    font-size: 1rem;
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
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
</style>
