<script lang="ts">
  /**
   * Bouton à appui long : l'action n'a lieu qu'après `duration` ms de pression continue.
   * Un clic accidentel à l'antenne ne fait donc rien.
   */
  let {
    label,
    hint,
    duration = 1000,
    onhold,
  }: { label: string; hint: string; duration?: number; onhold: () => void } = $props();

  let holding = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function start(e: PointerEvent) {
    if (e.button !== 0) return;
    holding = true;
    timer = setTimeout(() => {
      holding = false;
      onhold();
    }, duration);
  }

  function cancel() {
    holding = false;
    clearTimeout(timer);
  }
</script>

<button
  type="button"
  class="hold"
  class:holding
  style:--hold-ms="{duration}ms"
  title={hint}
  aria-label="{label} ({hint})"
  onpointerdown={start}
  onpointerup={cancel}
  onpointerleave={cancel}
  onpointercancel={cancel}
  oncontextmenu={(e) => e.preventDefault()}
>
  <span class="fill" aria-hidden="true"></span>
  <span class="text">{label}</span>
</button>

<style>
  .hold {
    position: relative;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .fill {
    position: absolute;
    inset: 0;
    background: var(--danger-bg);
    transform: scaleX(0);
    transform-origin: left;
  }
  .holding .fill {
    transform: scaleX(1);
    transition: transform var(--hold-ms) linear;
  }
  .text {
    position: relative;
  }
</style>
