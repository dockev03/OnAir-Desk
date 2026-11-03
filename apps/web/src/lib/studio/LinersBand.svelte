<script lang="ts">
  import type { LinersSettings } from '@onair-desk/shared';

  /**
   * Cartes de liners : bande fixe en bas de la zone principale, jamais par-dessus le texte du
   * prompteur. Rotation calée sur l'heure serveur ; un clic passe à la carte suivante, sur cet
   * écran seulement (aucune écriture côté serveur).
   */
  let { liners, now }: { liners: LinersSettings; now: number } = $props();

  const active = $derived(liners.items.filter((l) => l.active));
  /** Cartes passées à la main depuis l'ouverture de l'écran. */
  let skipped = $state(0);
  const index = $derived(
    active.length === 0
      ? 0
      : (Math.floor(now / (liners.rotationSeconds * 1000)) + skipped) % active.length,
  );
  const card = $derived(active[index] ?? null);
</script>

{#if card}
  <button
    type="button"
    class="liners"
    data-testid="liner"
    onclick={() => (skipped += 1)}
    aria-live="polite"
  >
    {#key card.id}
      <span class="text">{card.text}</span>
    {/key}
    {#if active.length > 1}<span class="pos mono">{index + 1}/{active.length}</span>{/if}
  </button>
{/if}

<style>
  .liners {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 3rem;
    padding: 6px 16px;
    border: 1px solid #2f3034;
    border-left: 4px solid #85b7eb;
    border-radius: var(--radius);
    background: #17181b;
    color: #fff;
    text-align: left;
    cursor: default;
  }
  .text {
    flex: 1;
    font-size: 1.5rem;
    font-weight: 600;
    animation: fade 0.6s ease-out;
  }
  .pos {
    color: var(--muted);
    font-size: 0.85rem;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .text {
      animation: none;
    }
  }
</style>
