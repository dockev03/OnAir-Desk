<script lang="ts">
  import { page } from '$app/state';
  import {
    formatClock,
    formatDuration,
    formatSigned,
    itemColors,
    type ReportLine,
    type RundownReportView,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { actionLabel, entrySummary, entryTime } from '$lib/audit.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';
  import { logoUrl, stationSettings } from '$lib/settings.svelte.js';

  /**
   * Bilan d'émission (plan étape 11, décisions 19 et 20) : heure et durée prévues / réelles de
   * chaque élément, main courante jointe. Imprimable (« Enregistrer en PDF » du navigateur).
   */
  const id = $derived(Number(page.params.id));

  let view = $state<RundownReportView | null>(null);
  let error = $state('');

  const settings = $derived(stationSettings.value);
  const types = $derived(settings?.itemTypes ?? []);
  const tz = $derived(settings?.timezone ?? 'UTC');
  const clock = (ms: number | null) =>
    ms === null ? '—' : formatClock(new Date(ms), tz, settings?.timeFormat ?? '24h');
  const typeLabel = (typeId: string) => types.find((x) => x.id === typeId)?.label ?? typeId;

  async function load() {
    const [v] = await Promise.all([
      api<RundownReportView>('GET', `/api/rundowns/${id}/report`),
      stationSettings.load(),
    ]);
    view = v;
  }

  $effect(() => {
    void id;
    load().catch((e) => (error = errorMessage(errorCode(e))));
  });

  async function close() {
    if (!view?.report || !confirm(t('report.closeConfirm'))) return;
    error = '';
    try {
      await api('POST', `/api/runs/${view.report.runId}/close`);
      await load();
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  const startGap = (l: ReportLine) =>
    l.plannedAt === null || l.actualAt === null ? null : l.actualAt - l.plannedAt;
  const lengthGap = (l: ReportLine) =>
    l.actualSeconds === null ? null : (l.actualSeconds - l.plannedSeconds) * 1000;
  /** Écart : rouge au-delà de 30 s de retard (le code couleur de l'écran studio). */
  const late = (ms: number | null) => ms !== null && ms >= 30_000;
</script>

<svelte:head>
  <title>{view ? `${t('report.title')} · ${view.rundown.title}` : t('report.title')}</title>
</svelte:head>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if view}
  {@const r = view.report}
  <div class="row toolbar no-print">
    <a href="/rundowns/{view.rundown.id}">← {t('report.back')}</a>
    <span class="spacer"></span>
    {#if view.canClose}
      <button onclick={close} data-testid="report-close">{t('report.close')}</button>
    {/if}
    {#if r}<button class="primary" onclick={() => print()}>{t('report.print')}</button>{/if}
  </div>
  {#if view.active}<p class="notice no-print">{t('report.active')}</p>{/if}

  <article class="sheet" data-testid="report">
    <header class="head">
      {#if logoUrl(settings)}<img class="logo" src={logoUrl(settings)} alt="" />{/if}
      <div class="titles">
        <div class="station">{settings?.stationName ?? ''} · {t('report.title')}</div>
        <h1>{view.rundown.title}</h1>
        <div class="when">
          {formatAirDate(view.rundown.airDate, i18n.locale)} · {shortTime(view.rundown.startTime)}
        </div>
      </div>
    </header>

    {#if !r}
      <p>{t('report.none')}</p>
    {:else}
      <dl class="summary">
        <div>
          <dt>{t('report.start')}</dt>
          <dd>{clock(r.plannedStart)}</dd>
        </div>
        <div>
          <dt>{t('report.plannedEnd')}</dt>
          <dd>{clock(r.plannedEnd)}</dd>
        </div>
        <div>
          <dt>{t('report.actualEnd')}</dt>
          <dd>{clock(r.actualEnd)}</dd>
        </div>
        {#if r.imposedEnd !== null}
          <div>
            <dt>{t('report.imposedEnd')}</dt>
            <dd>{clock(r.imposedEnd)}</dd>
          </div>
        {/if}
      </dl>

      <table class="lines">
        <thead>
          <tr>
            <th>{t('report.item')}</th>
            <th>{t('report.planned')}</th>
            <th>{t('report.actual')}</th>
            <th>{t('report.gap')}</th>
            <th>{t('report.plannedDuration')}</th>
            <th>{t('report.actualDuration')}</th>
            <th>{t('report.durationGap')}</th>
          </tr>
        </thead>
        <tbody>
          {#each r.lines as l (l.uid)}
            {@const c = itemColors(types, l.typeId)}
            {@const g = startGap(l)}
            {@const lg = lengthGap(l)}
            <tr class:removed={l.removed} data-testid="report-line">
              <td class="name">
                <span class="type" style:background-color={c.bg} style:color={c.fg}
                  >{typeLabel(l.typeId)}</span
                >
                {l.title}{#if l.artist}<span class="artist"> · {l.artist}</span>{/if}
                {#if l.added}<span class="flag">{t('report.added')}</span>{/if}
                {#if l.removed}<span class="flag">{t('report.removed')}</span>{/if}
                {#if l.source === 'automation'}<span class="flag">{t('report.automation')}</span
                  >{/if}
              </td>
              <td class="mono">{clock(l.plannedAt)}</td>
              <td class="mono">
                {#if l.actualAt === null}<span class="muted">{t('report.notPointed')}</span
                  >{:else}{clock(l.actualAt)}{/if}
              </td>
              <td class="mono" class:late={late(g)}>{g === null ? '' : formatSigned(g)}</td>
              <td class="mono">{formatDuration(l.plannedSeconds)}</td>
              <td class="mono">{l.actualSeconds === null ? '' : formatDuration(l.actualSeconds)}</td
              >
              <td class="mono" class:late={late(lg)}>{lg === null ? '' : formatSigned(lg)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <section class="logbook">
        <h2>{t('report.logbook')}</h2>
        {#if view.logbook.length === 0}
          <p class="muted">{t('report.logbookEmpty')}</p>
        {:else}
          <ul>
            {#each view.logbook as e (e.id)}
              <li>
                <span class="mono">{clock(entryTime(e))}</span>
                <strong>{actionLabel(e.action)}</strong>
                <span>{entrySummary(e)}</span>
                {#if e.actorName}<span class="muted">· {e.actorName}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </article>
{:else if !error}
  <p class="muted">{t('common.loading')}</p>
{/if}

<style>
  .toolbar {
    margin-bottom: 0.75rem;
  }
  .spacer {
    flex: 1;
  }
  .sheet {
    background: #fff;
    color: #000;
    padding: 14mm 12mm;
    border-radius: 4px;
    font-size: 10pt;
    line-height: 1.3;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 1rem;
    border-bottom: 2px solid #000;
    padding-bottom: 0.6rem;
    margin-bottom: 0.8rem;
  }
  .logo {
    max-height: 22mm;
    max-width: 45mm;
    object-fit: contain;
  }
  .station {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  h1 {
    font-size: 17pt;
    margin: 0.1rem 0;
    color: #000;
  }
  h2 {
    font-size: 12pt;
    color: #000;
    margin: 1rem 0 0.4rem;
  }
  .summary {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
    margin: 0 0 0.8rem;
  }
  .summary dt {
    font-size: 8pt;
    text-transform: uppercase;
    color: #444;
  }
  .summary dd {
    margin: 0;
    font-size: 12pt;
    font-weight: 600;
  }
  .lines {
    width: 100%;
    border-collapse: collapse;
  }
  .lines th,
  .lines td {
    border-bottom: 1px solid #999;
    padding: 0.3rem 0.4rem;
    text-align: left;
    vertical-align: top;
  }
  .lines th {
    font-size: 8pt;
    text-transform: uppercase;
  }
  .type {
    display: inline-block;
    padding: 0 0.4rem;
    border-radius: 3px;
    font-size: 8pt;
    margin-right: 0.3rem;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .artist {
    color: #444;
  }
  .flag {
    margin-left: 0.4rem;
    font-size: 8pt;
    font-style: italic;
    color: #444;
  }
  .removed td {
    color: #666;
  }
  .late {
    color: #a32d2d;
    font-weight: 700;
  }
  .muted {
    color: #666;
  }
  .logbook ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .logbook li {
    display: flex;
    gap: 0.6rem;
    padding: 0.15rem 0;
    border-bottom: 1px dotted #bbb;
  }
  @media print {
    .sheet {
      padding: 0;
      border-radius: 0;
    }
  }
</style>
