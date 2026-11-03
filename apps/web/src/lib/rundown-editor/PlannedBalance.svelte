<script lang="ts">
  import {
    cuttableSeconds,
    formatDuration,
    plannedBalance,
    rundownSchedule,
    secondsToTime,
    timeToSeconds,
    type ItemTiming,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';

  /**
   * Fin imposée (backtiming) dans l'éditeur et à l'impression : fin calculée, fin imposée,
   * temps à caser ou à couper, et durée des éléments « à couper » (plan étape 11, décision 14).
   */
  let {
    startTime,
    endTime,
    items,
  }: {
    startTime: string;
    endTime: string | null;
    items: (ItemTiming & { cuttable?: boolean })[];
  } = $props();

  const schedule = $derived(rundownSchedule(startTime, items));
  const balance = $derived(plannedBalance(startTime, endTime, schedule.total));
  const cuttable = $derived(cuttableSeconds(items));
</script>

{#if endTime !== null && balance !== null}
  {@const args = {
    end: secondsToTime(schedule.end),
    imposed: secondsToTime(timeToSeconds(endTime)),
    time: formatDuration(Math.abs(balance)),
  }}
  <p class="balance" class:cut={balance < 0} data-testid="planned-balance">
    {balance > 0
      ? t('rundowns.balanceFill', args)
      : balance < 0
        ? t('rundowns.balanceCut', args)
        : t('rundowns.balanceExact', args)}
    {#if cuttable > 0}
      <span class="cuttable"
        >· {t('rundowns.cuttableTotal', { time: formatDuration(cuttable) })}</span
      >
    {/if}
  </p>
{/if}

<style>
  .balance {
    margin: 0.25rem 0 0.75rem;
    font-weight: 600;
  }
  .balance.cut {
    color: var(--danger);
  }
  .cuttable {
    font-weight: 400;
    color: var(--muted);
  }
</style>
