<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    formatDuration,
    rundownSchedule,
    secondsToTime,
    type Library,
    type Rundown,
    type Template,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { ownerKey, ownerName } from '$lib/library.js';
  import { Autosave, type SaveStatus } from '$lib/rundown-editor/autosave.svelte.js';
  import ItemsEditor from '$lib/rundown-editor/ItemsEditor.svelte';
  import { toEdit, toInput, type EditItem } from '$lib/rundown-editor/items.js';
  import RundownNotes from '$lib/rundown-editor/RundownNotes.svelte';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';
  import { session } from '$lib/session.svelte.js';
  import { stationSettings } from '$lib/settings.svelte.js';

  const id = $derived(Number(page.params.id));

  let rundown = $state<Rundown | null>(null);
  let lib = $state<Library | null>(null);
  let error = $state('');
  let notice = $state('');

  let title = $state('');
  let airDate = $state('');
  let startTime = $state('07:00:00');
  let notes = $state('');
  let items = $state<EditItem[]>([]);
  let version = 0;

  const types = $derived(stationSettings.value?.itemTypes ?? []);
  const canWrite = $derived(rundown?.canWrite ?? false);
  const schedule = $derived(rundownSchedule(startTime, items));

  function apply(r: Rundown) {
    rundown = r;
    title = r.title;
    airDate = r.airDate;
    startTime = r.startTime;
    notes = r.notes;
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

  // ---- Enregistrement automatique ------------------------------------------------------

  const autosave = new Autosave(
    async () => {
      const r = await api<Rundown>('PATCH', `/api/rundowns/${rundown!.id}`, {
        version,
        title: title.trim() || rundown!.title,
        airDate,
        startTime,
        notes,
        items: items.map(toInput),
      });
      version = r.version;
      rundown = r;
      // Les infos de script (titre, durée) viennent du serveur ; la saisie reste en place.
      for (const item of items) {
        item.script = r.items.find((x) => x.uid === item.uid)?.script ?? item.script;
      }
    },
    () => canWrite && rundown !== null,
    (code) => (error = errorMessage(code)),
  );
  const changed = () => autosave.changed();

  async function reloadLatest() {
    apply(await api<Rundown>('GET', `/api/rundowns/${id}`));
    autosave.reset();
  }

  async function keepMine() {
    version = (await api<Rundown>('GET', `/api/rundowns/${id}`)).version;
    await autosave.force();
  }

  beforeNavigate(() => {
    if (autosave.dirty) void autosave.save();
  });
  $effect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (autosave.dirty) e.preventDefault();
    };
    addEventListener('beforeunload', warn);
    return () => {
      removeEventListener('beforeunload', warn);
      autosave.dispose();
    };
  });

  // ---- Actions ------------------------------------------------------------------------

  async function send(item: EditItem) {
    error = notice = '';
    if (!(await autosave.save()) && autosave.dirty) return;
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

  /** Le modèle va dans le même dossier que le conducteur, ou chez moi s'il est à un collègue. */
  async function saveAsTemplate() {
    if (!rundown || !session.user) return;
    error = '';
    try {
      if (!(await autosave.save()) && autosave.dirty) return;
      const template = await api<Template>('POST', `/api/rundowns/${rundown.id}/save-as-template`, {
        ownerId: canWrite ? rundown.ownerId : session.user.id,
      });
      await goto(`/rundowns/templates/${template.id}`);
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  async function reapplyTemplate() {
    if (!rundown?.template || !confirm(t('templates.reapplyConfirm'))) return;
    error = notice = '';
    try {
      if (!(await autosave.save()) && autosave.dirty) return;
      apply(
        await api<Rundown>('POST', `/api/rundowns/${rundown.id}/reapply-template`, { version }),
      );
      notice = t('templates.reapplied');
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  const statusText: Record<SaveStatus, string> = $derived({
    saved: t('editor.saved'),
    pending: t('editor.unsaved'),
    saving: t('editor.saving'),
    offline: t('editor.offline'),
    conflict: t('rundowns.conflict'),
  });
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if rundown && lib}
  <div class="row top">
    <a href="/rundowns?owner={ownerKey(rundown.ownerId)}">← {t('rundowns.back')}</a>
    <span class="spacer"></span>
    {#if canWrite}
      <span class="status {autosave.status}" role="status">{statusText[autosave.status]}</span>
    {/if}
    <a class="button" href="/rundowns/{rundown.id}/print">{t('print.open')}</a>
    <button onclick={saveAsTemplate}>{t('templates.saveAs')}</button>
    {#if !canWrite}<button onclick={duplicateToMe}>{t('library.duplicate')}</button>{/if}
  </div>

  {#if notice}<p class="success">{notice}</p>{/if}

  {#if autosave.status === 'conflict'}
    <div class="notice">
      <p>{t('rundowns.conflictText')}</p>
      <div class="row">
        <button onclick={reloadLatest}>{t('editor.reload')}</button>
        <button onclick={keepMine}>{t('editor.keepMine')}</button>
      </div>
    </div>
  {/if}

  {#if rundown.template}
    <p class="muted from-template">
      {t('templates.createdFrom')}
      {#if rundown.template.deleted}
        « {rundown.template.title} » ({t('templates.inTrash')})
      {:else}
        <a href="/rundowns/templates/{rundown.template.id}">« {rundown.template.title} »</a>
        {#if canWrite}
          <button onclick={reapplyTemplate}>{t('templates.reapply')}</button>
        {/if}
      {/if}
    </p>
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

  <ItemsEditor
    bind:items
    bind:lib
    {types}
    {startTime}
    {canWrite}
    ownerId={rundown.ownerId}
    locked={autosave.status === 'conflict'}
    onchange={changed}
    onsend={(item) => void send(item)}
    onerror={(message) => (error = message)}
  />

  <RundownNotes bind:notes {canWrite} onchange={changed} />
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
  .from-template {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
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
</style>
