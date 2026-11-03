<script lang="ts">
  import { untrack } from 'svelte';
  import {
    DUPLEX_NAME_MAX,
    DUPLEX_STATES,
    LOGBOOK_NOTE_MAX,
    MAX_DUPLEX_LINES,
    REGIE_MESSAGE_MAX,
    activeMessage,
    addDays,
    canDirect,
    effectiveLayout,
    emptyRegieState,
    formatClock,
    showInProgress,
    zonedToEpoch,
    type DuplexLine,
    type DuplexState,
    type LogbookView,
    type RundownList,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { actionLabel, entrySummary, entryTime } from '$lib/audit.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';
  import { LiveLink } from '$lib/live.svelte.js';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';
  import { session } from '$lib/session.svelte.js';
  import { i18n } from '$lib/i18n/index.svelte.js';

  /**
   * Console de régie (voir docs/plan-etape-10.md, décisions 21 et 22) : messages, ordres
   * rapides, liners, duplex, conducteur à l'antenne, main courante. Temps réel par le
   * WebSocket ; tous les envois passent par l'API (droits vérifiés côté serveur).
   */
  const allowed = $derived(canDirect(session.user));
  const link = new LiveLink();
  let now = $state(Date.now());
  let error = $state('');

  let text = $state('');
  let urgent = $state(false);
  let duplexName = $state('');
  let note = $state('');
  let noteTime = $state('');
  let rundowns = $state<RundownList | null>(null);
  let logbookId = $state<number | null>(null);
  let logbook = $state<LogbookView | null>(null);

  const settings = $derived(link.settings);
  const regie = $derived(link.air?.state.regie ?? emptyRegieState());
  const message = $derived(activeMessage(regie, now));
  const timezone = $derived(settings?.timezone ?? 'Europe/Paris');
  const timeFormat = $derived(settings?.timeFormat ?? '24h');
  /** Émission en cours d'après les heures des conducteurs (comme le serveur et l'écran). */
  const onShow = $derived(
    rundowns
      ? showInProgress(
          rundowns.rundowns.filter(
            (r) => r.airDate >= addDays(rundowns!.today, -1) && r.airDate <= rundowns!.today,
          ),
          now,
          timezone,
        )
      : null,
  );
  /** Conducteur à l'antenne : suivi sur l'écran studio, sinon celui de l'émission en cours. */
  const onAirRundown = $derived(link.prompter?.rundown ?? onShow);
  const onAirItem = $derived(
    link.prompter?.rundown?.items.find((i) => i.uid === link.prompter?.itemUid) ?? null,
  );
  const layout = $derived(
    effectiveLayout(onAirRundown?.layout ?? null, settings?.defaultLayout ?? 'solo'),
  );
  const orders = $derived(settings?.regie.orders.filter((o) => o.active) ?? []);
  const liners = $derived(settings?.liners.items.filter((l) => l.active) ?? []);
  /** Conducteurs de la veille et du jour, pour la main courante. */
  const recent = $derived(
    rundowns
      ? rundowns.rundowns
          .filter((r) => r.airDate >= addDays(rundowns!.today, -1) && r.airDate <= rundowns!.today)
          .sort((a, b) =>
            `${b.airDate} ${b.startTime}`.localeCompare(`${a.airDate} ${a.startTime}`),
          )
      : [],
  );

  const clock = (ms: number) => formatClock(new Date(ms), timezone, timeFormat);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    error = '';
    try {
      await action();
      after?.();
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  const sendMessage = (e: SubmitEvent) => {
    e.preventDefault();
    void run(
      () => api('POST', '/api/regie/message', { text, urgent }),
      () => {
        text = '';
        urgent = false;
        void loadLogbook();
      },
    );
  };
  /** Déroulé d'antenne en cours (étape 11) : « Clore l'émission » fige le bilan. */
  const airRun = $derived(link.air?.state.run ?? null);
  const closeRun = () => {
    if (airRun && !airRun.rehearsal && confirm(t('report.closeConfirm'))) {
      void run(() => api('POST', `/api/runs/${airRun.id}/close`), loadLogbook);
    }
  };
  const clearMessage = () => run(() => api('DELETE', '/api/regie/message'), loadLogbook);
  const sendOrder = (id: string) => run(() => api('POST', `/api/regie/order/${id}`), loadLogbook);
  const sendLiner = (id: string) => run(() => api('POST', `/api/regie/liner/${id}`), loadLogbook);

  const addDuplex = (e: SubmitEvent) => {
    e.preventDefault();
    void run(
      () => api('POST', '/api/regie/duplex', { name: duplexName }),
      () => (duplexName = ''),
    );
  };
  const setDuplex = (line: DuplexLine, state: DuplexState) =>
    run(() => api('PATCH', `/api/regie/duplex/${line.id}`, { state }), loadLogbook);
  const removeDuplex = (line: DuplexLine) =>
    run(() => api('DELETE', `/api/regie/duplex/${line.id}`));
  const clearDuplex = () => {
    if (confirm(t('regie.duplexClearConfirm'))) void run(() => api('DELETE', '/api/regie/duplex'));
  };

  /** Heure corrigée « HH:MM » du jour (fuseau de la station) → horloge serveur. */
  function noteAt(): number | undefined {
    if (!noteTime) return undefined;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(now));
    return zonedToEpoch(`${day} ${noteTime}:00`, timezone) ?? undefined;
  }

  const addNote = (e: SubmitEvent) => {
    e.preventDefault();
    void run(
      () => api('POST', '/api/regie/logbook', { text: note, at: noteAt() }),
      () => {
        note = noteTime = '';
        void loadLogbook();
      },
    );
  };

  async function loadLogbook() {
    if (logbookId === null) return;
    try {
      logbook = await api<LogbookView>('GET', `/api/regie/logbook?rundownId=${logbookId}`);
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  // Démarrage unique : rien de réactif n'est lu dans la mise en route (untrack), sinon chaque
  // seconde (heure, décalage d'horloge) relancerait la liaison temps réel.
  $effect(() => {
    if (!allowed) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      now = link.now();
      timer = setTimeout(tick, 1000 - (now % 1000) + 5);
    };
    untrack(() => {
      link.start();
      tick();
      api<RundownList>('GET', '/api/rundowns')
        .then((r) => (rundowns = r))
        .catch(() => {});
    });
    return () => {
      clearTimeout(timer);
      link.stop();
    };
  });

  // Main courante : par défaut, le conducteur à l'antenne.
  $effect(() => {
    if (logbookId === null && onAirRundown) logbookId = onAirRundown.id;
  });
  $effect(() => {
    void logbookId;
    void loadLogbook();
  });
</script>

<h1>{t('regie.title')}</h1>

{#if !allowed}
  <p class="notice">{t('regie.forbidden')}</p>
{:else}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if link.state !== 'online' && link.state !== 'connecting'}
    <p class="notice">{t('studio.offline')}</p>
  {/if}

  <section class="card stack">
    <h2>{t('regie.onAirRundown')}</h2>
    {#if onAirRundown}
      <p>
        <strong>{onAirRundown.title}</strong>
        <span class="muted">
          · {formatAirDate(onAirRundown.airDate, i18n.locale)} · {shortTime(
            onAirRundown.startTime,
          )}</span
        >
        {#if onAirItem}<br />{t('regie.currentItem', { title: onAirItem.title })}{/if}
      </p>
      <div class="row">
        <a class="button primary" href="/rundowns/{onAirRundown.id}" data-testid="live-edit-link"
          >{t('regie.editOnAir')}</a
        >
        <a class="button" href="/rundowns/{onAirRundown.id}/report">{t('rundowns.report')}</a>
        {#if airRun && !airRun.rehearsal && airRun.rundownId === onAirRundown.id}
          <button onclick={closeRun} data-testid="regie-close-run">{t('report.close')}</button>
        {/if}
      </div>
      {#if layout !== 'regie'}
        <p class="notice small" data-testid="layout-warning">{t('regie.layoutWarning')}</p>
      {/if}
    {:else}
      <p class="muted">{t('regie.noRundown')}</p>
    {/if}
  </section>

  <section class="card stack">
    <h2>{t('regie.message')}</h2>
    <div class="preview" class:urgent={message?.urgent} data-testid="regie-preview">
      {#if message}
        <span class="preview-text">{message.text}</span>
        <span class="muted small">
          {clock(message.sentAt)}{#if message.byName}{` · ${message.byName}`}{/if} · {t(
            'regie.until',
            { time: clock(message.expiresAt) },
          )}
        </span>
        {#if message.seenAt !== null}
          <span class="seen" data-testid="regie-seen-at"
            >✓ {t('regie.seenAt', { time: clock(message.seenAt) })}</span
          >
        {/if}
        <button type="button" onclick={() => void clearMessage()}>{t('regie.clear')}</button>
      {:else}
        <span class="muted">{t('regie.noMessage')}</span>
      {/if}
    </div>
    <form class="send" onsubmit={sendMessage}>
      <input
        bind:value={text}
        required
        maxlength={REGIE_MESSAGE_MAX}
        placeholder={t('regie.messagePlaceholder')}
        aria-label={t('regie.message')}
      />
      <label class="inline">
        <input type="checkbox" bind:checked={urgent} />
        {t('regie.urgent')}
      </label>
      <button class="primary">{t('regie.send')}</button>
    </form>

    <h3>{t('regie.orders')}</h3>
    {#if orders.length === 0}
      <p class="muted small">{t('regie.noOrders')}</p>
    {:else}
      <div class="orders">
        {#each orders as order (order.id)}
          <button
            type="button"
            class="order"
            class:urgent={order.urgent}
            onclick={() => void sendOrder(order.id)}>{order.label}</button
          >
        {/each}
      </div>
    {/if}

    {#if liners.length > 0}
      <h3>{t('regie.liners')}</h3>
      <ul class="liners">
        {#each liners as liner (liner.id)}
          <li>
            <span>{liner.text}</span>
            <button type="button" onclick={() => void sendLiner(liner.id)}>{t('regie.send')}</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card stack">
    <h2>{t('regie.duplex')}</h2>
    {#each regie.duplex as line (line.id)}
      <div class="duplex-row" data-testid="duplex-row">
        <strong class="grow">{line.name}</strong>
        <div class="states" role="group" aria-label={line.name}>
          {#each DUPLEX_STATES as state (state)}
            <button
              type="button"
              class="state {state}"
              aria-pressed={line.state === state}
              onclick={() => void setDuplex(line, state)}>{t(`regie.duplexState.${state}`)}</button
            >
          {/each}
        </div>
        <button type="button" class="danger" onclick={() => void removeDuplex(line)}
          >{t('common.delete')}</button
        >
      </div>
    {/each}
    <form class="send" onsubmit={addDuplex}>
      <input
        bind:value={duplexName}
        required
        maxlength={DUPLEX_NAME_MAX}
        placeholder={t('regie.duplexPlaceholder')}
        aria-label={t('regie.duplexName')}
        disabled={regie.duplex.length >= MAX_DUPLEX_LINES}
      />
      <button disabled={regie.duplex.length >= MAX_DUPLEX_LINES}>{t('regie.duplexAdd')}</button>
      {#if regie.duplex.length > 0}
        <button type="button" onclick={clearDuplex}>{t('regie.duplexClear')}</button>
      {/if}
    </form>
  </section>

  <section class="card stack">
    <h2>{t('regie.logbook')}</h2>
    <form class="send" onsubmit={addNote}>
      <input
        bind:value={note}
        required
        maxlength={LOGBOOK_NOTE_MAX}
        placeholder={t('regie.notePlaceholder')}
        aria-label={t('regie.note')}
      />
      <label class="inline">
        {t('regie.noteTime')}
        <input type="time" bind:value={noteTime} />
      </label>
      <button class="primary">{t('regie.addNote')}</button>
    </form>
    <label>
      {t('regie.logbookRundown')}
      <select bind:value={logbookId}>
        <option value={null}>—</option>
        {#each recent as r (r.id)}
          <option value={r.id}
            >{formatAirDate(r.airDate, i18n.locale)} · {shortTime(r.startTime)} · {r.title}</option
          >
        {/each}
      </select>
    </label>
    {#if logbook}
      {#if logbook.entries.length === 0}
        <p class="muted">{t('audit.empty')}</p>
      {:else}
        <ol class="logbook" data-testid="logbook">
          {#each logbook.entries as entry (entry.id)}
            <li class:note={entry.action === 'logbook.note'}>
              <span class="mono time">{clock(entryTime(entry))}</span>
              <span class="what">{actionLabel(entry.action)}</span>
              <span class="detail">{entrySummary(entry)}</span>
              <span class="muted who">{entry.actorName ?? ''}</span>
            </li>
          {/each}
        </ol>
      {/if}
      <button type="button" onclick={() => void loadLogbook()}>{t('regie.refresh')}</button>
    {/if}
  </section>
{/if}

<style>
  section {
    margin-bottom: 1.25rem;
  }
  h2 {
    margin: 0;
  }
  h3 {
    margin: 0.5rem 0 0;
    font-size: 1rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .grow {
    flex: 1;
  }
  .send {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .send input:not([type='checkbox']):not([type='time']) {
    flex: 1;
    min-width: 12rem;
  }
  .inline {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
  .preview {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-left: 5px solid #85b7eb;
    border-radius: 6px;
    background: var(--surface-2);
    min-height: 2.6rem;
  }
  .preview.urgent {
    border-left-color: var(--danger);
  }
  .preview-text {
    flex: 1;
    font-size: 1.3rem;
    font-weight: 700;
  }
  .seen {
    color: var(--ok);
  }
  .orders {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.5rem;
  }
  .order {
    min-height: 3.2rem;
    font-size: 1.05rem;
    font-weight: 600;
  }
  .order.urgent {
    border-color: var(--danger);
  }
  .liners {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .liners li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .liners li span {
    flex: 1;
  }
  .duplex-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .states {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .state[aria-pressed='true'] {
    background: #2c2c2a;
    color: #fff;
    font-weight: 700;
  }
  .state.ready[aria-pressed='true'] {
    background: #0f3d2e;
    color: #9fe1cb;
  }
  .state.onair[aria-pressed='true'] {
    background: #185fa5;
    color: #fff;
  }
  .state.cut[aria-pressed='true'] {
    text-decoration: line-through;
  }
  .logbook {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .logbook li {
    display: grid;
    grid-template-columns: 5.5rem 11rem 1fr auto;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--border);
  }
  .logbook li.note .detail {
    font-weight: 600;
  }
  .what {
    color: var(--muted);
  }
  @media (max-width: 640px) {
    .logbook li {
      grid-template-columns: 5rem 1fr;
    }
  }
</style>
