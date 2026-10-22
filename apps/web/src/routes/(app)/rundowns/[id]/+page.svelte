<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    MAX_RUNDOWN_ITEMS,
    formatDuration,
    itemColors,
    itemSeconds,
    parseItemDuration,
    rundownSchedule,
    secondsToTime,
    type ItemScriptInfo,
    type Library,
    type Rundown,
    type RundownItem,
    type RundownItemInput,
    type Script,
  } from '@onair-desk/shared';
  import { ApiRequestError, api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { ownerKey, ownerName } from '$lib/library.js';
  import { formatAirDate, newItemUid, shortTime } from '$lib/rundowns.js';
  import { session } from '$lib/session.svelte.js';
  import { stationSettings } from '$lib/settings.svelte.js';

  const AUTOSAVE_MS = 1000;
  const RETRY_MS = 5000;

  /** Élément en cours d'édition : la durée est saisie en texte (m:ss). */
  type EditItem = RundownItem & { durationText: string; durationInvalid: boolean };

  const id = $derived(Number(page.params.id));

  let rundown = $state<Rundown | null>(null);
  let lib = $state<Library | null>(null);
  let error = $state('');
  let notice = $state('');

  let title = $state('');
  let airDate = $state('');
  let startTime = $state('07:00:00');
  let items = $state<EditItem[]>([]);
  let version = 0;

  type Status = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict';
  let status = $state<Status>('saved');
  let dirty = false;
  let saving = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const types = $derived(stationSettings.value?.itemTypes ?? []);
  const canWrite = $derived(rundown?.canWrite ?? false);
  const schedule = $derived(rundownSchedule(startTime, items));

  const toEdit = (i: RundownItem): EditItem => ({
    ...i,
    durationText: i.durationSeconds === null ? '' : formatDuration(i.durationSeconds),
    durationInvalid: false,
  });

  function apply(r: Rundown) {
    rundown = r;
    title = r.title;
    airDate = r.airDate;
    startTime = r.startTime;
    items = r.items.map(toEdit);
    version = r.version;
  }

  async function load() {
    const [r, l] = await Promise.all([
      api<Rundown>('GET', `/api/rundowns/${id}`),
      api<Library>('GET', '/api/library'),
      stationSettings.load(),
    ]);
    lib = l;
    apply(r);
  }

  $effect(() => {
    void id;
    load().catch((e) => (error = errorMessage(errorCode(e))));
  });

  // ---- Enregistrement automatique (même principe que l'éditeur de scripts) ----------

  function changed() {
    if (status === 'conflict' || !canWrite) return;
    dirty = true;
    status = 'pending';
    clearTimeout(timer);
    timer = setTimeout(save, AUTOSAVE_MS);
  }

  const toInput = (i: EditItem): RundownItemInput => ({
    uid: i.uid,
    typeId: i.typeId,
    title: i.title.trim() || t('rundowns.newItemTitle'),
    durationSeconds: i.durationSeconds,
    notes: i.notes,
    scriptId: i.scriptId,
  });

  async function save(): Promise<boolean> {
    clearTimeout(timer);
    if (!dirty || !rundown || status === 'conflict') return !dirty;
    if (saving) {
      timer = setTimeout(save, 300);
      return false;
    }
    saving = true;
    dirty = false;
    status = 'saving';
    try {
      const r = await api<Rundown>('PATCH', `/api/rundowns/${rundown.id}`, {
        version,
        title: title.trim() || rundown.title,
        airDate,
        startTime,
        items: items.map(toInput),
      });
      version = r.version;
      rundown = r;
      // Les infos de script (titre, durée) viennent du serveur ; la saisie reste en place.
      for (const item of items) {
        item.script = r.items.find((x) => x.uid === item.uid)?.script ?? item.script;
      }
      if (!dirty) status = 'saved';
      return true;
    } catch (e) {
      dirty = true;
      if (e instanceof ApiRequestError && e.code === 'version_conflict') {
        status = 'conflict';
      } else if (e instanceof ApiRequestError && e.status === 0) {
        status = 'offline';
        timer = setTimeout(save, RETRY_MS);
      } else {
        status = 'pending';
        error = errorMessage(errorCode(e));
      }
      return false;
    } finally {
      saving = false;
    }
  }

  async function reloadLatest() {
    apply(await api<Rundown>('GET', `/api/rundowns/${id}`));
    dirty = false;
    status = 'saved';
  }

  async function keepMine() {
    const r = await api<Rundown>('GET', `/api/rundowns/${id}`);
    version = r.version;
    status = 'pending';
    dirty = true;
    await save();
  }

  beforeNavigate(() => {
    if (dirty) void save();
  });
  $effect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  });

  // ---- Éléments -----------------------------------------------------------------------

  function addItem() {
    if (items.length >= MAX_RUNDOWN_ITEMS) return;
    items.push(
      toEdit({
        uid: newItemUid(),
        typeId: types[0]?.id ?? 'autre',
        title: t('rundowns.newItemTitle'),
        durationSeconds: null,
        notes: '',
        scriptId: null,
        script: null,
      }),
    );
    changed();
  }

  function removeItem(i: number) {
    items.splice(i, 1);
    changed();
  }

  function moveItem(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item!);
    changed();
  }

  /** Pendant la frappe : appliquée dès qu'elle est valide ; erreur signalée en quittant le champ. */
  function typeDuration(item: EditItem) {
    const seconds = parseItemDuration(item.durationText);
    if (seconds === undefined) return;
    item.durationInvalid = false;
    item.durationSeconds = seconds;
    changed();
  }

  const scriptInfo = (s: Script | Library['scripts'][number]): ItemScriptInfo => ({
    title: s.title,
    wordCount: s.wordCount,
    speedWpm: s.speedWpm,
    cueSeconds: s.cueSeconds,
    deleted: false,
  });

  function setScript(item: EditItem, value: string) {
    const scriptId = value === '' ? null : Number(value);
    const s = lib?.scripts.find((x) => x.id === scriptId);
    item.scriptId = scriptId;
    item.script = s ? scriptInfo(s) : null;
    changed();
  }

  async function createScript(item: EditItem) {
    if (!rundown) return;
    error = '';
    try {
      const s = await api<Script>('POST', '/api/scripts', {
        ownerId: rundown.ownerId,
        title: item.title.trim().slice(0, 120) || t('rundowns.newItemTitle'),
      });
      lib?.scripts.push(s);
      item.scriptId = s.id;
      item.script = scriptInfo(s);
      changed();
      await save();
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  async function send(item: EditItem) {
    error = notice = '';
    if (!(await save()) && dirty) return;
    try {
      await api('POST', '/api/prompter', { rundownId: id, itemUid: item.uid });
      notice = t('library.sent');
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  async function duplicateToMe() {
    if (!rundown || !session.user) return;
    try {
      const copy = await api<Rundown>('POST', `/api/rundowns/${rundown.id}/duplicate`, {
        ownerId: session.user.id,
        airDate: rundown.airDate,
      });
      await goto(`/rundowns/${copy.id}`);
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  // ---- Glisser-déposer par la poignée (souris et tactile, via les événements pointeur) --

  let listEl = $state<HTMLOListElement | null>(null);
  let dragging = $state<number | null>(null);

  function dragStart(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = i;
  }

  function dragMove(e: PointerEvent) {
    if (dragging === null || !listEl) return;
    const rows = [...listEl.querySelectorAll<HTMLElement>(':scope > li')];
    // Position cible : premier élément dont le milieu est sous le pointeur.
    let target = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (target === -1) target = rows.length - 1;
    else if (target > dragging) target -= 1;
    if (target !== dragging) {
      const [item] = items.splice(dragging, 1);
      items.splice(target, 0, item!);
      dragging = target;
    }
  }

  function dragEnd() {
    if (dragging === null) return;
    dragging = null;
    changed();
  }

  const statusText: Record<Status, string> = $derived({
    saved: t('editor.saved'),
    pending: t('editor.unsaved'),
    saving: t('editor.saving'),
    offline: t('editor.offline'),
    conflict: t('rundowns.conflict'),
  });

  const autoDuration = (i: EditItem) =>
    i.script ? formatDuration(itemSeconds({ ...i, durationSeconds: null })) : '0:00';
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if rundown && lib}
  <div class="row top">
    <a href="/rundowns?owner={ownerKey(rundown.ownerId)}">← {t('rundowns.back')}</a>
    <span class="spacer"></span>
    {#if canWrite}<span class="status {status}" role="status">{statusText[status]}</span>{/if}
    {#if !canWrite}<button onclick={duplicateToMe}>{t('library.duplicate')}</button>{/if}
  </div>

  {#if notice}<p class="success">{notice}</p>{/if}

  {#if status === 'conflict'}
    <div class="notice">
      <p>{t('rundowns.conflictText')}</p>
      <div class="row">
        <button onclick={reloadLatest}>{t('editor.reload')}</button>
        <button onclick={keepMine}>{t('editor.keepMine')}</button>
      </div>
    </div>
  {/if}

  {#if canWrite}
    <div class="meta">
      <label class="grow">
        {t('rundowns.field.title')}
        <input bind:value={title} maxlength="120" oninput={changed} />
      </label>
      <label>
        {t('rundowns.field.airDate')}
        <input type="date" bind:value={airDate} required onchange={changed} />
      </label>
      <label>
        {t('rundowns.field.startTime')}
        <input type="time" step="1" bind:value={startTime} required onchange={changed} />
      </label>
    </div>
  {:else}
    <h1>{rundown.title}</h1>
    <p class="notice">{t('rundowns.readOnly')}</p>
    <p class="muted">
      {formatAirDate(rundown.airDate, i18n.locale)} · {shortTime(rundown.startTime)} ·
      {ownerName(lib.owners.find((o) => o.id === rundown!.ownerId) ?? { id: null, name: '' })}
    </p>
  {/if}

  <p class="muted total">
    {t('rundowns.total', {
      duration: formatDuration(schedule.total),
      end: secondsToTime(schedule.end),
    })}
  </p>

  {#if items.length === 0}
    <p class="muted">{t('rundowns.emptyRundown')}</p>
  {/if}

  <ol class="items" bind:this={listEl}>
    {#each items as item, i (item.uid)}
      {@const colors = itemColors(types, item.typeId)}
      <li
        class="item"
        class:dragging={dragging === i}
        style:background-color={colors.bg}
        style:color={colors.fg}
      >
        {#if canWrite}
          <button
            type="button"
            class="handle"
            aria-label={t('rundowns.item.drag')}
            title={t('rundowns.item.drag')}
            onpointerdown={(e) => dragStart(e, i)}
            onpointermove={dragMove}
            onpointerup={dragEnd}
            onpointercancel={dragEnd}>⠿</button
          >
        {/if}
        <span class="time mono">{secondsToTime(schedule.starts[i] ?? 0)}</span>

        {#if canWrite}
          <div class="fields">
            <div class="line">
              <select
                aria-label={t('rundowns.item.type')}
                bind:value={item.typeId}
                onchange={changed}
              >
                {#each types as type (type.id)}
                  <option value={type.id}>{type.label}</option>
                {/each}
                {#if !types.some((x) => x.id === item.typeId)}
                  <option value={item.typeId}>{item.typeId}</option>
                {/if}
              </select>
              <input
                class="item-title"
                aria-label={t('rundowns.item.title')}
                bind:value={item.title}
                maxlength="120"
                oninput={changed}
              />
              <input
                class="duration mono"
                aria-label={t('rundowns.item.duration')}
                title={t('rundowns.item.durationHint')}
                placeholder={autoDuration(item)}
                aria-invalid={item.durationInvalid}
                bind:value={item.durationText}
                oninput={() => typeDuration(item)}
                onchange={() =>
                  (item.durationInvalid = parseItemDuration(item.durationText) === undefined)}
              />
            </div>
            <div class="line">
              <select
                class="script"
                aria-label={t('rundowns.item.script')}
                value={item.scriptId === null ? '' : String(item.scriptId)}
                onchange={(e) => setScript(item, e.currentTarget.value)}
              >
                <option value="">{t('rundowns.item.noScript')}</option>
                {#if item.scriptId !== null && !lib.scripts.some((s) => s.id === item.scriptId)}
                  <option value={String(item.scriptId)}
                    >{item.script?.title ?? '?'} ({t('rundowns.item.scriptDeleted')})</option
                  >
                {/if}
                {#each lib.owners as o (ownerKey(o.id))}
                  {@const scripts = lib.scripts.filter((s) => s.ownerId === o.id)}
                  {#if scripts.length > 0}
                    <optgroup label={ownerName(o)}>
                      {#each scripts as s (s.id)}
                        <option value={String(s.id)}>{s.title}</option>
                      {/each}
                    </optgroup>
                  {/if}
                {/each}
              </select>
              {#if item.scriptId !== null}
                <a class="open" href="/scripts/{item.scriptId}">{t('rundowns.item.openScript')}</a>
              {:else}
                <button type="button" onclick={() => createScript(item)}
                  >{t('rundowns.item.createScript')}</button
                >
              {/if}
              <input
                class="notes"
                aria-label={t('rundowns.item.notes')}
                placeholder={t('rundowns.item.notes')}
                bind:value={item.notes}
                maxlength="500"
                oninput={changed}
              />
            </div>
            {#if item.durationInvalid}
              <span class="invalid">{t('rundowns.item.durationInvalid')}</span>
            {/if}
          </div>
          <div class="actions">
            <button
              type="button"
              aria-label={t('settings.moveUp')}
              disabled={i === 0}
              onclick={() => moveItem(i, i - 1)}>↑</button
            >
            <button
              type="button"
              aria-label={t('settings.moveDown')}
              disabled={i === items.length - 1}
              onclick={() => moveItem(i, i + 1)}>↓</button
            >
            <button type="button" title={t('rundowns.item.sendTitle')} onclick={() => send(item)}
              >{t('rundowns.item.send')}</button
            >
            <button type="button" class="danger" onclick={() => removeItem(i)}
              >{t('rundowns.item.remove')}</button
            >
          </div>
        {:else}
          <div class="fields">
            <span class="ro-title">
              {item.title}
              {#if item.scriptId !== null}<a class="open" href="/scripts/{item.scriptId}">📄</a
                >{/if}
            </span>
            {#if item.notes}<span class="ro-notes">{item.notes}</span>{/if}
          </div>
          <span class="mono">{formatDuration(itemSeconds(item))}</span>
          <div class="actions">
            <button type="button" title={t('rundowns.item.sendTitle')} onclick={() => send(item)}
              >{t('rundowns.item.send')}</button
            >
          </div>
        {/if}
      </li>
    {/each}
  </ol>

  {#if canWrite}
    <button
      class="primary add"
      onclick={addItem}
      disabled={items.length >= MAX_RUNDOWN_ITEMS || status === 'conflict'}
      >+ {t('rundowns.addItem')}</button
    >
  {/if}
{:else if !error}
  <p class="muted">{t('common.loading')}</p>
{/if}

<style>
  .top {
    margin-bottom: 1rem;
  }
  .spacer {
    flex: 1;
  }
  .status {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .status.saved {
    color: var(--ok);
  }
  .status.offline,
  .status.conflict {
    color: #fac775;
  }
  .meta {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .meta .grow {
    flex: 1;
    min-width: 14rem;
  }
  .total {
    margin: 0.75rem 0;
  }
  .items {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border-radius: 8px;
  }
  .item.dragging {
    outline: 2px solid #fff;
    opacity: 0.85;
  }
  .handle {
    cursor: grab;
    touch-action: none;
    background: transparent;
    border: 0;
    color: inherit;
    font-size: 1.2rem;
    padding: 0.2rem 0.3rem;
  }
  .item.dragging .handle {
    cursor: grabbing;
  }
  .time {
    width: 5.2rem;
    flex-shrink: 0;
  }
  .fields {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .line {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    flex-wrap: wrap;
  }
  /* Champs lisibles sur toutes les couleurs de fond. */
  .item input,
  .item select {
    background: rgba(0, 0, 0, 0.28);
    border-color: rgba(255, 255, 255, 0.18);
    color: inherit;
    padding: 0.35rem 0.5rem;
  }
  .item input::placeholder {
    color: inherit;
    opacity: 0.6;
  }
  .item option,
  .item optgroup {
    background: var(--surface);
    color: var(--text);
  }
  .item-title {
    flex: 1;
    min-width: 10rem;
  }
  .duration {
    width: 5.5rem;
  }
  .duration[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .script {
    max-width: 16rem;
  }
  .notes {
    flex: 1;
    min-width: 10rem;
  }
  .open {
    color: inherit;
    font-size: 0.9rem;
  }
  .invalid {
    font-size: 0.85rem;
    color: #f7c1c1;
  }
  .actions {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .actions button {
    padding: 0.3rem 0.55rem;
    background: rgba(0, 0, 0, 0.28);
    border-color: rgba(255, 255, 255, 0.18);
    color: inherit;
  }
  .ro-title {
    font-weight: 500;
  }
  .ro-notes {
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .add {
    margin-bottom: 2rem;
  }
</style>
