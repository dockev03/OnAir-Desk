<script lang="ts">
  import { page } from '$app/state';
  import {
    formatDuration,
    itemColors,
    itemSeconds,
    rundownSchedule,
    secondsToTime,
    type Rundown,
    type Script,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import Blocks from '$lib/content/Blocks.svelte';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';
  import { logoUrl, stationSettings } from '$lib/settings.svelte.js';

  /**
   * Version papier d'un conducteur (A4), pour la régie en secours et l'archive. « Imprimer »
   * ouvre la boîte du navigateur, qui propose aussi « Enregistrer en PDF ».
   */
  const id = $derived(Number(page.params.id));

  let rundown = $state<Rundown | null>(null);
  let error = $state('');
  let withScripts = $state(false);
  /** Textes des scripts attachés ; null : script supprimé ou introuvable. */
  let scripts = $state<Map<number, Script | null>>(new Map());
  let loadingScripts = $state(false);

  const settings = $derived(stationSettings.value);
  const types = $derived(settings?.itemTypes ?? []);
  const schedule = $derived(rundown ? rundownSchedule(rundown.startTime, rundown.items) : null);
  const printedAt = new Date();

  $effect(() => {
    void id;
    Promise.all([api<Rundown>('GET', `/api/rundowns/${id}`), stationSettings.load()])
      .then(([r]) => (rundown = r))
      .catch((e) => (error = errorMessage(errorCode(e))));
  });

  // Textes des scripts : chargés seulement si l'option est cochée.
  $effect(() => {
    if (!withScripts || !rundown) return;
    const ids = [...new Set(rundown.items.map((i) => i.scriptId))].filter(
      (x): x is number => x !== null && !scripts.has(x),
    );
    if (ids.length === 0) return;
    loadingScripts = true;
    void Promise.all(
      ids.map((sid) =>
        api<Script>('GET', `/api/scripts/${sid}`)
          .then((s) => [sid, s] as const)
          .catch(() => [sid, null] as const),
      ),
    ).then((loaded) => {
      scripts = new Map([...scripts, ...loaded]);
      loadingScripts = false;
    });
  });

  const dateTime = (d: Date) =>
    new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'short' }).format(d);

  // Pied de page imprimé : date d'impression et numéro de page (marges de la page A4). La règle
  // @page ne peut pas être écrite dans le style du composant : elle est ajoutée au document.
  $effect(() => {
    const quote = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;
    const style = document.createElement('style');
    style.textContent = `@page {
      size: A4;
      margin: 14mm 12mm 16mm;
      @bottom-left { content: ${quote(t('print.printedAt', { date: dateTime(printedAt) }))}; font: 9pt sans-serif; }
      @bottom-right { content: ${quote(t('print.page'))} " " counter(page) " / " counter(pages); font: 9pt sans-serif; }
    }`;
    document.head.append(style);
    return () => style.remove();
  });

  const typeLabel = (typeId: string) => types.find((x) => x.id === typeId)?.label ?? typeId;
  /** Éléments dont le texte du script suit le tableau (un script attaché plusieurs fois : une fois). */
  const withText = $derived(
    rundown?.items.filter(
      (item, i, all) =>
        item.scriptId !== null && all.findIndex((x) => x.scriptId === item.scriptId) === i,
    ) ?? [],
  );
</script>

<svelte:head>
  <title>{rundown ? `${rundown.title} · ${rundown.airDate}` : t('print.open')}</title>
</svelte:head>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if rundown && schedule}
  <div class="row toolbar no-print">
    <a href="/rundowns/{rundown.id}">← {t('print.back')}</a>
    <span class="spacer"></span>
    <label class="inline">
      <input type="checkbox" bind:checked={withScripts} />
      {t('print.withScripts')}
    </label>
    <button class="primary" disabled={loadingScripts} onclick={() => print()}
      >{t('print.print')}</button
    >
  </div>
  <p class="muted small no-print">{t('print.hint')}</p>

  <article class="sheet">
    <header class="head">
      {#if logoUrl(settings)}<img class="logo" src={logoUrl(settings)} alt="" />{/if}
      <div class="titles">
        <div class="station">{settings?.stationName ?? ''}</div>
        <h1>{rundown.title}</h1>
        <div class="when">
          {formatAirDate(rundown.airDate, i18n.locale)} ·
          {t('print.times', {
            start: shortTime(rundown.startTime),
            end: shortTime(secondsToTime(schedule.end)),
          })}
          · {t('print.duration', { duration: formatDuration(schedule.total) })}
        </div>
      </div>
    </header>

    {#if rundown.items.length === 0}
      <p>{t('rundowns.emptyRundown')}</p>
    {:else}
      <table class="items">
        <thead>
          <tr>
            <th>{t('print.col.time')}</th>
            <th>{t('rundowns.item.type')}</th>
            <th>{t('rundowns.item.title')}</th>
            <th class="num">{t('rundowns.item.duration')}</th>
            <th>{t('rundowns.item.notes')}</th>
            <th>{t('rundowns.item.script')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rundown.items as item, i (item.uid)}
            <tr>
              <td class="mono">{secondsToTime(schedule.starts[i] ?? 0)}</td>
              <td class="type">
                <span class="dot" style:background-color={itemColors(types, item.typeId).bg}></span>
                {typeLabel(item.typeId)}
              </td>
              <td class="title">{item.title}</td>
              <td class="mono num">{formatDuration(itemSeconds(item))}</td>
              <td class="notes">{item.notes}</td>
              <td>
                {#if item.script}
                  {item.script.title}{item.script.deleted
                    ? ` (${t('rundowns.item.scriptDeleted')})`
                    : ''}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if withScripts}
      {#each withText as item (item.uid)}
        {@const script = scripts.get(item.scriptId!)}
        <section class="script-text">
          <h2>{item.title}{script ? ` · ${script.title}` : ''}</h2>
          {#if script}
            <div class="text">
              <Blocks blocks={script.content.content} cues={settings?.cues ?? []} />
            </div>
          {:else if script === null}
            <p class="muted">{t('print.scriptGone')}</p>
          {:else}
            <p class="muted">{t('common.loading')}</p>
          {/if}
        </section>
      {/each}
    {/if}
  </article>
{:else if !error}
  <p class="muted">{t('common.loading')}</p>
{/if}

<style>
  .toolbar {
    margin-bottom: 0.5rem;
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: 0.85rem;
  }
  /* À l'écran : aperçu d'une feuille blanche. */
  .sheet {
    background: #fff;
    color: #000;
    padding: 14mm 12mm;
    border-radius: 4px;
    font-size: 10.5pt;
    line-height: 1.35;
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
  .when {
    font-size: 10pt;
  }
  .items {
    width: 100%;
    border-collapse: collapse;
  }
  .items th,
  .items td {
    border-bottom: 1px solid #999;
    padding: 0.3rem 0.4rem;
    text-align: left;
    vertical-align: top;
    color: #000;
  }
  .items th {
    border-bottom: 1.5px solid #000;
    font-size: 9pt;
    text-transform: uppercase;
  }
  .items tr {
    break-inside: avoid;
  }
  .num {
    text-align: right !important;
    white-space: nowrap;
  }
  .type {
    white-space: nowrap;
  }
  /* Pastille de couleur et libellé : lisible aussi en noir et blanc. */
  .dot {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    border-radius: 50%;
    border: 1px solid #000;
    vertical-align: -0.05em;
    margin-right: 0.25em;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .title {
    font-weight: 600;
  }
  .notes {
    font-size: 9.5pt;
    white-space: pre-wrap;
  }
  .script-text {
    margin-top: 1rem;
    break-inside: auto;
  }
  .script-text h2 {
    font-size: 12pt;
    color: #000;
    margin: 0 0 0.3rem;
    border-bottom: 1px solid #000;
    break-after: avoid;
  }
  /* Couleurs du prompteur (pensées pour un fond sombre) : texte noir sur papier. */
  .text :global(span) {
    color: #000 !important;
  }
  .text :global(.hl) {
    background: none !important;
    outline: 1px solid #000;
  }
  .text :global(p) {
    margin: 0 0 0.4em;
  }
  @media print {
    .sheet {
      padding: 0;
      border-radius: 0;
    }
  }
</style>
