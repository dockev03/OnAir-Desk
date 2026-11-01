<script lang="ts">
  import {
    MAX_RUNDOWN_ITEMS,
    formatDuration,
    itemColors,
    itemSeconds,
    parseItemDuration,
    rundownSchedule,
    secondsToTime,
    sourcesInUse,
    type ItemScriptInfo,
    type ItemType,
    type Library,
    type RadiodjSong,
    type Script,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';
  import { ownerKey, ownerName } from '$lib/library.js';
  import { newItemUid } from '$lib/rundowns.js';
  import { stationSettings } from '$lib/settings.svelte.js';
  import { toEdit, type EditItem } from './items.js';
  import SongPicker from './SongPicker.svelte';

  /**
   * Liste des éléments d'un conducteur ou d'un modèle : couleurs, heures de passage, durées,
   * script attaché, glisser-déposer. Chaque modification appelle onchange (enregistrement
   * automatique par la page). « Afficher » n'existe que si onsend est fourni (conducteur).
   */
  let {
    items = $bindable(),
    lib = $bindable(),
    types,
    startTime,
    canWrite,
    ownerId,
    locked = false,
    onchange,
    onsend,
    onerror,
  }: {
    items: EditItem[];
    lib: Library;
    types: ItemType[];
    startTime: string;
    canWrite: boolean;
    /** Propriétaire des scripts créés depuis un élément. */
    ownerId: number | null;
    /** Ajout bloqué (conflit de version en cours). */
    locked?: boolean;
    onchange: () => void;
    onsend?: (item: EditItem) => void;
    onerror: (message: string) => void;
  } = $props();

  const schedule = $derived(rundownSchedule(startTime, items));

  // ---- Titre choisi dans la bibliothèque RadioDJ (si RadioDJ est la source) ------------

  $effect(() => {
    void stationSettings.load().catch(() => {});
  });
  const radiodj = $derived(
    stationSettings.value ? sourcesInUse(stationSettings.value).includes('radiodj') : false,
  );
  /** Élément dont la recherche de titre est ouverte. */
  let picking = $state<string | null>(null);

  /** Titre, durée (jusqu'au point de mix) et type « titre » s'il existe. */
  function pickSong(item: EditItem, song: RadiodjSong) {
    item.title = `${song.artist} - ${song.title}`.slice(0, 120);
    item.durationSeconds = Math.round(song.durationMs / 1000);
    item.durationText = formatDuration(item.durationSeconds);
    item.durationInvalid = false;
    if (types.some((x) => x.id === 'titre')) item.typeId = 'titre';
    picking = null;
    onchange();
  }

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
    onchange();
  }

  function removeItem(i: number) {
    items.splice(i, 1);
    onchange();
  }

  function moveItem(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item!);
    onchange();
  }

  /** Pendant la frappe : appliquée dès qu'elle est valide ; erreur signalée en quittant le champ. */
  function typeDuration(item: EditItem) {
    const seconds = parseItemDuration(item.durationText);
    if (seconds === undefined) return;
    item.durationInvalid = false;
    item.durationSeconds = seconds;
    onchange();
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
    const s = lib.scripts.find((x) => x.id === scriptId);
    item.scriptId = scriptId;
    item.script = s ? scriptInfo(s) : null;
    onchange();
  }

  async function createScript(item: EditItem) {
    try {
      const s = await api<Script>('POST', '/api/scripts', {
        ownerId,
        title: item.title.trim().slice(0, 120) || t('rundowns.newItemTitle'),
      });
      lib.scripts.push(s);
      item.scriptId = s.id;
      item.script = scriptInfo(s);
      onchange();
    } catch (e) {
      onerror(errorMessage(errorCode(e)));
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
    onchange();
  }

  const autoDuration = (i: EditItem) =>
    i.script ? formatDuration(itemSeconds({ ...i, durationSeconds: null })) : '0:00';
</script>

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
            <select aria-label={t('rundowns.item.type')} bind:value={item.typeId} {onchange}>
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
              oninput={onchange}
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
            {#if radiodj}
              <button
                type="button"
                onclick={() => (picking = picking === item.uid ? null : item.uid)}
                >{t('rundowns.item.pickSong')}</button
              >
            {/if}
            <input
              class="notes"
              aria-label={t('rundowns.item.notes')}
              placeholder={t('rundowns.item.notes')}
              bind:value={item.notes}
              maxlength="500"
              oninput={onchange}
            />
          </div>
          {#if item.durationInvalid}
            <span class="invalid">{t('rundowns.item.durationInvalid')}</span>
          {/if}
          {#if picking === item.uid}
            <SongPicker onpick={(song) => pickSong(item, song)} onclose={() => (picking = null)} />
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
          {#if onsend}
            <button type="button" title={t('rundowns.item.sendTitle')} onclick={() => onsend(item)}
              >{t('rundowns.item.send')}</button
            >
          {/if}
          <button type="button" class="danger" onclick={() => removeItem(i)}
            >{t('rundowns.item.remove')}</button
          >
        </div>
      {:else}
        <div class="fields">
          <span class="ro-title">
            {item.title}
            {#if item.scriptId !== null}<a class="open" href="/scripts/{item.scriptId}">📄</a>{/if}
          </span>
          {#if item.notes}<span class="ro-notes">{item.notes}</span>{/if}
        </div>
        <span class="mono">{formatDuration(itemSeconds(item))}</span>
        {#if onsend}
          <div class="actions">
            <button type="button" title={t('rundowns.item.sendTitle')} onclick={() => onsend(item)}
              >{t('rundowns.item.send')}</button
            >
          </div>
        {/if}
      {/if}
    </li>
  {/each}
</ol>

{#if canWrite}
  <button
    class="primary add"
    onclick={addItem}
    disabled={items.length >= MAX_RUNDOWN_ITEMS || locked}>+ {t('rundowns.addItem')}</button
  >
{/if}

<style>
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
