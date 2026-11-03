<script lang="ts">
  import type { AirSnapshot, OnAirResponse } from '@onair-desk/shared';
  import { api } from '$lib/api.js';
  import { t } from '$lib/i18n/index.svelte.js';

  /**
   * Bouton On Air de secours dans la barre de l'interface (comptes connectés), avec
   * confirmation. L'état est relu régulièrement : le voyant peut changer depuis le studio.
   */
  const REFRESH_MS = 15_000;
  let on = $state<boolean | null>(null);
  let busy = $state(false);

  async function refresh() {
    try {
      on = (await api<AirSnapshot>('GET', '/api/air')).state.onAir.on;
    } catch {
      // Hors ligne : on garde le dernier état connu.
    }
  }

  async function toggle() {
    if (on === null || busy) return;
    if (!confirm(on ? t('onair.confirmOff') : t('onair.confirmOn'))) return;
    busy = true;
    try {
      on = (await api<OnAirResponse>('POST', '/api/studio/onair', { state: on ? 'off' : 'on' })).on;
    } catch {
      await refresh();
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

{#if on !== null}
  <button
    class="onair"
    class:on
    disabled={busy}
    aria-pressed={on}
    title={on ? t('onair.stateOn') : t('onair.stateOff')}
    data-testid="onair-button"
    onclick={() => void toggle()}>{t('onair.button')}</button
  >
{/if}

<style>
  .onair {
    font-weight: 700;
    letter-spacing: 0.08em;
    border: 2px solid #3a3b3f;
    color: #8a8984;
    background: transparent;
  }
  .onair.on {
    border-color: #e24b4a;
    background: #a32d2d;
    color: #fff;
  }
</style>
