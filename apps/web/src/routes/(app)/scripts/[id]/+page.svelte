<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    SPEED_WPM_MAX,
    SPEED_WPM_MIN,
    countWords,
    docToText,
    formatDuration,
    readingSeconds,
    type Revision,
    type RevisionSummary,
    type Script,
    type ScriptDoc,
  } from '@onair-desk/shared';
  import { ApiRequestError, api, errorCode } from '$lib/api.js';
  import ScriptView from '$lib/content/ScriptView.svelte';
  import ScriptEditor from '$lib/editor/ScriptEditor.svelte';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatDate, ownerKey } from '$lib/library.js';
  import { session } from '$lib/session.svelte.js';
  import { stationSettings } from '$lib/settings.svelte.js';

  const AUTOSAVE_MS = 1500;
  const RETRY_MS = 5000;

  const id = $derived(Number(page.params.id));

  let script = $state<Script | null>(null);
  let error = $state('');
  let notice = $state('');

  // Valeurs en cours d'édition.
  let title = $state('');
  let speedWpm = $state(150);
  let doc = $state<ScriptDoc | null>(null);
  let version = 0;

  type Status = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict';
  let status = $state<Status>('saved');
  let dirty = false;
  let saving = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let editorRef = $state<ReturnType<typeof ScriptEditor> | null>(null);
  let panel = $state<'none' | 'preview' | 'history'>('none');
  let revisions = $state<RevisionSummary[]>([]);
  let selectedRevision = $state<Revision | null>(null);

  const cues = $derived(stationSettings.value?.cues ?? []);
  const words = $derived(doc ? countWords(docToText(doc)) : 0);

  function apply(s: Script) {
    script = s;
    title = s.title;
    speedWpm = s.speedWpm;
    doc = s.content;
    version = s.version;
  }

  $effect(() => {
    const scriptId = id;
    void Promise.all([api<Script>('GET', `/api/scripts/${scriptId}`), stationSettings.load()])
      .then(([s]) => apply(s))
      .catch((e) => (error = errorMessage(errorCode(e))));
  });

  function changed() {
    if (status === 'conflict') return;
    dirty = true;
    status = 'pending';
    clearTimeout(timer);
    timer = setTimeout(save, AUTOSAVE_MS);
  }

  /** Enregistre si nécessaire ; une seule requête à la fois. */
  async function save(): Promise<boolean> {
    clearTimeout(timer);
    if (!dirty || !script || status === 'conflict') return !dirty;
    if (saving) {
      timer = setTimeout(save, 300);
      return false;
    }
    saving = true;
    dirty = false;
    status = 'saving';
    try {
      const s = await api<Script>('PATCH', `/api/scripts/${script.id}`, {
        version,
        title: title.trim() || script.title,
        content: doc,
        speedWpm,
      });
      version = s.version;
      script = { ...s, content: script.content };
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
    const s = await api<Script>('GET', `/api/scripts/${id}`);
    apply(s);
    editorRef?.setContent(s.content);
    dirty = false;
    status = 'saved';
  }

  async function keepMine() {
    const s = await api<Script>('GET', `/api/scripts/${id}`);
    version = s.version;
    status = 'pending';
    dirty = true;
    await save();
  }

  async function send() {
    error = notice = '';
    await save();
    try {
      await api('POST', '/api/prompter', { scriptId: id });
      notice = t('library.sent');
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  async function duplicate() {
    if (!script || !session.user) return;
    try {
      const copy = await api<Script>('POST', `/api/scripts/${script.id}/duplicate`, {
        ownerId: session.user.id,
        title: t('library.copyTitle', { title: script.title }).slice(0, 120),
      });
      await goto(`/scripts/${copy.id}`);
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  async function openHistory() {
    panel = panel === 'history' ? 'none' : 'history';
    selectedRevision = null;
    if (panel === 'history') {
      await save();
      revisions = await api<RevisionSummary[]>('GET', `/api/scripts/${id}/revisions`);
    }
  }

  async function preview(r: RevisionSummary) {
    selectedRevision = await api<Revision>('GET', `/api/scripts/${id}/revisions/${r.id}`);
  }

  async function restore() {
    if (!selectedRevision || !confirm(t('revisions.restoreConfirm'))) return;
    await save();
    try {
      const s = await api<Script>(
        'POST',
        `/api/scripts/${id}/revisions/${selectedRevision.id}/restore`,
        {
          version,
        },
      );
      apply(s);
      editorRef?.setContent(s.content);
      panel = 'none';
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  // Ne rien perdre en quittant la page.
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

  const statusText: Record<Status, string> = $derived({
    saved: t('editor.saved'),
    pending: t('editor.unsaved'),
    saving: t('editor.saving'),
    offline: t('editor.offline'),
    conflict: t('editor.conflictTitle'),
  });
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if script && doc}
  <div class="row top">
    <a
      href="/scripts?owner={ownerKey(script.ownerId)}{script.folderId
        ? `&folder=${script.folderId}`
        : ''}">← {t('editor.back')}</a
    >
    <span class="spacer"></span>
    {#if script.canWrite}<span class="status {status}" role="status">{statusText[status]}</span
      >{/if}
    <button class="primary" onclick={send}>{t('library.send')}</button>
  </div>

  {#if notice}<p class="success">{notice}</p>{/if}

  {#if script.canWrite}
    <div class="meta">
      <label class="grow">
        {t('editor.title')}
        <input bind:value={title} maxlength="120" oninput={changed} />
      </label>
      <label>
        {t('editor.speed')} ({t('editor.wpm')})
        <input
          type="number"
          min={SPEED_WPM_MIN}
          max={SPEED_WPM_MAX}
          step="5"
          bind:value={speedWpm}
          oninput={changed}
        />
      </label>
    </div>
    <p class="muted estimate">
      {t('editor.estimate', {
        words,
        duration: formatDuration(readingSeconds(words, speedWpm)),
        wpm: speedWpm,
      })}
    </p>

    {#if status === 'conflict'}
      <div class="notice stack">
        <strong>{t('editor.conflictTitle')}</strong>
        <span>{t('editor.conflictText')}</span>
        <div class="row">
          <button onclick={reloadLatest}>{t('editor.reload')}</button>
          <button class="primary" onclick={keepMine}>{t('editor.keepMine')}</button>
        </div>
      </div>
    {/if}

    <div class="row tabs">
      <button
        class:on={panel === 'preview'}
        onclick={() => (panel = panel === 'preview' ? 'none' : 'preview')}
        >{t('editor.preview')}</button
      >
      <button class:on={panel === 'history'} onclick={openHistory}>{t('editor.history')}</button>
    </div>

    <div class="work" class:split={panel !== 'none'}>
      <div>
        <ScriptEditor
          bind:this={editorRef}
          content={doc}
          {cues}
          onchange={(d) => {
            doc = d;
            changed();
          }}
        />
      </div>
      {#if panel === 'preview'}
        <aside class="side card">
          <ScriptView {doc} {cues} fontSize={28} />
        </aside>
      {:else if panel === 'history'}
        <aside class="side card stack">
          <h2 style="margin: 0">{t('revisions.title')}</h2>
          {#if revisions.length === 0}<p class="muted">{t('revisions.empty')}</p>{/if}
          <ul class="revs">
            {#each revisions as r (r.id)}
              <li>
                <button
                  class="rev"
                  class:on={selectedRevision?.id === r.id}
                  onclick={() => preview(r)}
                >
                  {t('revisions.item', {
                    version: r.version,
                    date: formatDate(r.savedAt, i18n.locale),
                    name: r.savedByName ?? '—',
                  })}
                  <span class="muted">· {t('library.words', { n: r.wordCount })}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if selectedRevision}
            <strong>{selectedRevision.title}</strong>
            <div class="rev-preview">
              <ScriptView doc={selectedRevision.content} {cues} fontSize={18} />
            </div>
            <button class="primary" onclick={restore}>{t('revisions.restore')}</button>
          {/if}
        </aside>
      {/if}
    </div>
  {:else}
    <h1>{script.title}</h1>
    <p class="notice">{t('editor.readOnly')}</p>
    <div class="row" style="margin: 0.75rem 0">
      <button onclick={duplicate}>{t('library.duplicate')}</button>
    </div>
    <p class="muted estimate">
      {t('editor.estimate', {
        words,
        duration: formatDuration(readingSeconds(words, speedWpm)),
        wpm: speedWpm,
      })}
    </p>
    <div class="card readonly"><ScriptView {doc} {cues} fontSize={22} /></div>
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
  .meta input[type='number'] {
    width: 7rem;
  }
  .estimate {
    margin: 0.5rem 0 0.75rem;
    font-size: 0.9rem;
  }
  .tabs {
    margin-bottom: 0.5rem;
  }
  .tabs button.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  .work.split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1rem;
  }
  @media (max-width: 900px) {
    .work.split {
      grid-template-columns: 1fr;
    }
  }
  .side {
    background: #0b0b0c;
    max-height: 75vh;
    overflow: auto;
  }
  .revs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .rev {
    width: 100%;
    text-align: left;
    font-size: 0.85rem;
  }
  .rev.on {
    border-color: #85b7eb;
  }
  .rev-preview {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
  .readonly {
    background: #0b0b0c;
  }
</style>
