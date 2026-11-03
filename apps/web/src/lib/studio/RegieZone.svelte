<script lang="ts">
  import {
    activeMessage,
    formatClock,
    urgentExpanded,
    type LiveChange,
    type RegieState,
    type TimeFormat,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';

  /**
   * Zone régie (voir docs/plan-etape-10.md, décisions 7, 8, 13 et 16) : zone fixe sous le
   * bandeau, jamais par-dessus le texte du prompteur. Message de la régie (normal, ou urgent :
   * agrandi 5 secondes sur fond rouge), pastilles des duplex, modification récente du
   * conducteur. Un clic sur le message le marque « vu » (si les paramètres l'autorisent).
   */
  let {
    regie,
    now,
    timezone,
    timeFormat,
    change,
    canSeen,
    onseen,
  }: {
    regie: RegieState;
    now: number;
    timezone: string;
    timeFormat: TimeFormat;
    /** Modification du conducteur à signaler (null : aucune, ou trop ancienne). */
    change: LiveChange | null;
    canSeen: boolean;
    onseen: (id: string) => void;
  } = $props();

  const message = $derived(activeMessage(regie, now));
  const expanded = $derived(urgentExpanded(message, now));
  const changeCount = $derived(
    change ? change.added.length + change.changed.length + change.moved.length + change.removed : 0,
  );
  const time = (ms: number) => formatClock(new Date(ms), timezone, timeFormat).slice(0, -3);
</script>

<section
  class="zone"
  class:urgent={message?.urgent}
  class:expanded
  data-testid="regie-zone"
  aria-live="assertive"
>
  <span class="label">{t('studio.regieZone')}</span>
  <div class="main">
    {#if message}
      <button
        type="button"
        class="message"
        data-testid="regie-message"
        disabled={!canSeen || message.seenAt !== null}
        onclick={() => onseen(message.id)}
      >
        <span class="text">{message.text}</span>
        <span class="meta mono">
          {time(message.sentAt)}{#if message.byName}{` · ${message.byName}`}{/if}
          {#if message.seenAt !== null}<span class="seen" data-testid="regie-seen"
              >✓ {t('regie.seen')}</span
            >{/if}
        </span>
      </button>
    {:else if change}
      <span class="change" data-testid="live-change">
        {t('studio.liveChange', { n: changeCount })}{#if change.byName}{` · ${change.byName}`}{/if}
      </span>
    {/if}
  </div>
  {#if regie.duplex.length > 0}
    <ul class="duplex" aria-label={t('regie.duplex')}>
      {#each regie.duplex as line (line.id)}
        <li class="pill {line.state}" data-testid="duplex-pill">
          {#if line.state === 'onair'}<span aria-hidden="true">🎙</span>{/if}
          <span class="name">{line.name}</span>
          <span class="state">{t(`regie.duplexState.${line.state}`)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .zone {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 3.2rem;
    padding: 4px 14px;
    border: 1px dashed #2f3034;
    border-radius: var(--radius);
    transition: min-height 0.4s ease-out;
  }
  .label {
    color: #5f5e5a;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  .main {
    flex: 1;
    min-width: 0;
  }
  .message {
    display: flex;
    align-items: baseline;
    gap: 16px;
    width: 100%;
    padding: 4px 12px;
    border: 0;
    border-left: 6px solid #85b7eb;
    border-radius: 6px;
    background: #17212c;
    color: #fff;
    text-align: left;
    cursor: pointer;
  }
  .message:disabled {
    cursor: default;
    opacity: 1;
  }
  .text {
    flex: 1;
    font-size: 2rem;
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: 0.85rem;
    color: #b4b2a9;
    white-space: nowrap;
  }
  .seen {
    margin-left: 8px;
    color: var(--ok);
  }
  /* Urgent : rouge = « maintenant » (code couleur unique de l'écran), fixe, sans clignoter. */
  .zone.urgent .message {
    border-left-color: var(--danger);
  }
  .zone.expanded {
    min-height: 6.4rem;
    border: 2px solid var(--danger);
    background: var(--danger-bg);
  }
  .zone.expanded .message {
    background: transparent;
  }
  .zone.expanded .text {
    font-size: 2.8rem;
  }
  .change {
    color: #c9c7be;
    font-size: 1.2rem;
    border-left: 4px solid #b4b2a9;
    padding-left: 10px;
  }
  .duplex {
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  /* États des duplex : ni orange, ni rouge (réservés aux alertes). */
  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #2c2c2a;
    color: #d3d1c7;
    font-size: 0.95rem;
    white-space: nowrap;
  }
  .pill .state {
    font-size: 0.75rem;
    text-transform: uppercase;
    opacity: 0.85;
  }
  .pill.ready {
    background: #0f3d2e;
    color: #9fe1cb;
  }
  .pill.onair {
    background: #185fa5;
    color: #fff;
    font-weight: 700;
    font-size: 1.1rem;
  }
  .pill.cut .name {
    text-decoration: line-through;
  }
  .pill.cut {
    color: #888780;
  }
  @media (prefers-reduced-motion: reduce) {
    .zone {
      transition: none;
    }
  }
</style>
