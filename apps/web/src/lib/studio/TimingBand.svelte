<script lang="ts">
  import {
    backtime,
    balanceLevel,
    driftLevel,
    endLevel,
    fixedTimeLevel,
    formatClock,
    formatElapsed,
    formatSigned,
    rundownDrift,
    sequenceLevel,
    sequenceTimer,
    type AlertLevel,
    type FixedCountdown,
    type RunState,
    type TimeFormat,
    type TimeTrackingSettings,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';
  import HoldButton from './HoldButton.svelte';

  /**
   * Bande de temps (voir docs/plan-etape-11.md, décisions 5 à 15) : minuteur de séquence,
   * avance / retard, fin imposée, prochain horaire fixe. Zone fixe, jamais par-dessus le texte ;
   * chaque case n'apparaît que si elle a quelque chose à dire. Code couleur unique de l'écran :
   * orange = bientôt, rouge = maintenant (fixe, sans pulsation).
   */
  let {
    run,
    fixed,
    now,
    settings,
    timezone,
    timeFormat,
    canStop = false,
    onstop,
  }: {
    run: RunState | null;
    fixed: FixedCountdown | null;
    now: number;
    settings: TimeTrackingSettings;
    timezone: string;
    timeFormat: TimeFormat;
    /** Bouton « Arrêter la répétition » (appui long) sur l'écran. */
    canStop?: boolean;
    onstop?: () => void;
  } = $props();

  const seq = $derived(run ? sequenceTimer(run, now) : null);
  const showSeq = $derived(seq !== null && !seq.automation);
  const seqLevel = $derived<AlertLevel>(seq ? sequenceLevel(seq.remainingMs, settings) : 'none');

  const drift = $derived(run ? rundownDrift(run, now) : null);
  const dLevel = $derived<AlertLevel>(drift === null ? 'none' : driftLevel(drift, settings));

  const bt = $derived(run ? backtime(run, now) : null);
  const eLevel = $derived<AlertLevel>(bt ? endLevel(bt.remainingMs, settings) : 'none');
  const bLevel = $derived<AlertLevel>(bt ? balanceLevel(bt, settings) : 'none');

  const fLevel = $derived<AlertLevel>(fixed ? fixedTimeLevel(fixed.remainingMs) : 'none');

  const clock = (ms: number) => formatClock(new Date(ms), timezone, timeFormat).slice(0, 5);
  /** m:ss, arrondi à la seconde supérieure (« 0:01 » jusqu'au bout). */
  const left = (ms: number) => formatElapsed(Math.ceil(Math.max(0, ms) / 1000) * 1000);
</script>

<div class="band" data-testid="timing-band" aria-label={t('timing.band')}>
  {#if run?.rehearsal}
    <div class="cell rehearsal" data-testid="timing-rehearsal">
      <span class="tag">{t('timing.rehearsal')}</span>
      {#if canStop && onstop}
        <HoldButton
          label={t('timing.stopRehearsal')}
          hint={t('studio.holdToExit')}
          onhold={onstop}
        />
      {/if}
    </div>
  {/if}

  {#if showSeq && seq}
    <div class="cell {seqLevel}" data-testid="timing-sequence" data-level={seqLevel}>
      <span class="label">{t('timing.sequence')}</span>
      <span class="value mono">
        {#if seq.remainingMs === null}
          {t('timing.running', { time: formatElapsed(seq.elapsedMs) })}
        {:else if seq.remainingMs < 0}
          {formatSigned(-seq.remainingMs)}
        {:else}
          {t('timing.left', { time: left(seq.remainingMs) })}
        {/if}
      </span>
    </div>
  {/if}

  {#if drift !== null}
    <div class="cell {dLevel}" data-testid="timing-drift" data-level={dLevel}>
      <span class="label">{t('timing.drift')}</span>
      <span class="value mono">
        {#if Math.abs(drift) < settings.onTimeSeconds * 1000}
          {t('timing.onTime')}
        {:else if drift > 0}
          {t('timing.late', { time: formatSigned(drift) })}
        {:else}
          {t('timing.early', { time: formatSigned(drift) })}
        {/if}
      </span>
    </div>
  {/if}

  {#if bt}
    <div class="cell end {eLevel}" data-testid="timing-end" data-level={eLevel}>
      <span class="label">{t('timing.end', { time: clock(bt.endAt) })}</span>
      <span class="value mono">
        {bt.remainingMs >= 0
          ? t('timing.endLeft', { time: left(bt.remainingMs) })
          : t('timing.endPassed', { time: formatElapsed(-bt.remainingMs) })}
      </span>
      <span class="balance b-{bLevel}" data-testid="timing-balance" data-level={bLevel}>
        {bt.balanceMs >= 0
          ? t('timing.fill', { time: formatElapsed(bt.balanceMs) })
          : t('timing.cut', { time: formatElapsed(-bt.balanceMs) })}{#if bt.cutSuffices}{` · ${t(
            'timing.cutSuffices',
          )}`}{/if}
      </span>
    </div>
  {/if}

  {#if fixed && !run?.rehearsal}
    <div class="cell fixed {fLevel}" data-testid="timing-fixed" data-level={fLevel}>
      <span class="value">
        {fixed.remainingMs <= 0
          ? t('timing.fixedNow', { label: fixed.label })
          : t('timing.fixedIn', { label: fixed.label, time: left(fixed.remainingMs) })}
      </span>
    </div>
  {/if}
</div>

<style>
  .band {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  .cell {
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid #3a3b3f;
    background: #1b1c1f;
    color: #e4e4e7;
  }
  .label {
    font-size: 1rem;
    color: var(--muted);
    white-space: nowrap;
  }
  /* Chiffres lisibles à 1,5–2 m (taille de l'heure du bandeau). */
  .value {
    font-size: 2rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .balance {
    font-size: 1.3rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .end {
    flex-wrap: wrap;
  }
  .fixed {
    margin-left: auto;
  }
  .soon {
    border-color: var(--warn);
    color: var(--warn);
  }
  .soon .label {
    color: var(--warn);
  }
  .now {
    border-color: var(--danger);
    background: var(--danger-bg);
    color: #f7c1c1;
  }
  .now .label {
    color: #f7c1c1;
  }
  .balance.b-soon {
    color: var(--warn);
  }
  .balance.b-now {
    color: #ff8a8a;
  }
  /* Répétition : neutre (ni orange ni rouge), toujours visible. */
  .rehearsal {
    align-items: center;
    border-color: #85b7eb;
    background: #0c447c;
  }
  .tag {
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #e6f1fb;
  }
  .rehearsal :global(.hold) {
    padding: 0.4rem 0.9rem;
    font-size: 1rem;
  }
</style>
