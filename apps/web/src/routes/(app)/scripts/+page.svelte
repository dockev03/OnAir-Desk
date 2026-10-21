<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    formatDuration,
    readingSeconds,
    type Library,
    type Script,
    type ScriptSummary,
    type SearchHit,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import {
    folderPath,
    folderTree,
    formatDate,
    ownerKey,
    ownerName,
    parseOwnerKey,
  } from '$lib/library.js';
  import { session } from '$lib/session.svelte.js';

  let lib = $state<Library | null>(null);
  let error = $state('');
  let notice = $state('');
  let q = $state('');
  let hits = $state<SearchHit[] | null>(null);

  // Sélection courante, gardée dans l'URL (retour arrière, lien direct).
  const ownerId = $derived(
    parseOwnerKey(page.url.searchParams.get('owner')) ?? session.user?.id ?? null,
  );
  const folderId = $derived(Number(page.url.searchParams.get('folder')) || null);
  const owner = $derived(lib?.owners.find((o) => o.id === ownerId));
  const canWrite = $derived(owner?.canWrite ?? false);
  const subfolders = $derived(
    lib?.folders.filter((f) => f.ownerId === ownerId && f.parentId === folderId) ?? [],
  );
  const scripts = $derived(
    lib?.scripts.filter((s) => s.ownerId === ownerId && s.folderId === folderId) ?? [],
  );
  const path = $derived(lib ? folderPath(lib, folderId) : []);
  const currentFolder = $derived(path.at(-1));

  async function refresh() {
    try {
      lib = await api<Library>('GET', '/api/library');
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  $effect(() => {
    void refresh();
  });

  // Recherche avec un léger délai pendant la frappe.
  $effect(() => {
    const query = q.trim();
    if (!query) {
      hits = null;
      return;
    }
    const timer = setTimeout(async () => {
      try {
        hits = await api<SearchHit[]>('GET', `/api/scripts?q=${encodeURIComponent(query)}`);
      } catch (e) {
        error = errorMessage(errorCode(e));
      }
    }, 250);
    return () => clearTimeout(timer);
  });

  function select(owner: number | null, folder: number | null = null) {
    const query = `owner=${ownerKey(owner)}${folder ? `&folder=${folder}` : ''}`;
    q = '';
    void goto(`/scripts?${query}`, { keepFocus: true, noScroll: true });
  }

  async function run(action: () => Promise<unknown>, success = '') {
    error = notice = '';
    try {
      await action();
      notice = success;
      await refresh();
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  async function newScript() {
    const title = prompt(t('library.newScriptPrompt'))?.trim();
    if (!title) return;
    await run(async () => {
      const s = await api<Script>('POST', '/api/scripts', { ownerId, folderId, title });
      await goto(`/scripts/${s.id}`);
    });
  }

  function newFolder() {
    const name = prompt(t('library.newFolderPrompt'))?.trim();
    if (name) void run(() => api('POST', '/api/folders', { ownerId, parentId: folderId, name }));
  }

  function renameFolder() {
    if (!currentFolder) return;
    const name = prompt(t('library.renamePrompt'), currentFolder.name)?.trim();
    if (name) void run(() => api('PATCH', `/api/folders/${currentFolder.id}`, { name }));
  }

  function deleteFolder() {
    if (!currentFolder || !confirm(t('library.deleteFolderConfirm', { name: currentFolder.name })))
      return;
    const folder = currentFolder;
    void run(async () => {
      await api('DELETE', `/api/folders/${folder.id}`);
      select(ownerId, folder.parentId);
    });
  }

  const send = (s: ScriptSummary) =>
    run(() => api('POST', '/api/prompter', { scriptId: s.id }), t('library.sent'));

  const duplicate = (s: ScriptSummary) =>
    run(
      () =>
        api('POST', `/api/scripts/${s.id}/duplicate`, {
          ownerId: session.user!.id,
          title: t('library.copyTitle', { title: s.title }).slice(0, 120),
        }),
      t('library.duplicated'),
    );

  function trash(s: ScriptSummary) {
    if (confirm(t('library.trashConfirm', { title: s.title }))) {
      void run(() => api('DELETE', `/api/scripts/${s.id}`));
    }
  }

  async function move(s: ScriptSummary, target: string) {
    const folder = target === 'root' ? null : Number(target);
    await run(async () => {
      const full = await api<Script>('GET', `/api/scripts/${s.id}`);
      await api('PATCH', `/api/scripts/${s.id}`, { version: full.version, folderId: folder });
    });
  }

  const ownerLabel = (id: number | null) => {
    const o = lib?.owners.find((x) => x.id === id);
    return o ? ownerName(o) : '';
  };
  const meta = (s: ScriptSummary) =>
    `${t('library.words', { n: s.wordCount })} · ${formatDuration(readingSeconds(s.wordCount, s.speedWpm))}`;

  /** Extrait de recherche : termes trouvés encadrés par \u0002 … \u0003. */
  const snippetParts = (snippet: string) =>
    snippet.split('\u0002').flatMap((part, i) => {
      if (i === 0) return [{ text: part, hit: false }];
      const [hit = '', rest = ''] = part.split('\u0003');
      return [
        { text: hit, hit: true },
        { text: rest, hit: false },
      ];
    });
</script>

<div class="layout">
  <aside class="tree">
    {#if lib}
      {#each lib.owners as o (ownerKey(o.id))}
        <button
          class="node"
          class:active={o.id === ownerId && folderId === null}
          onclick={() => select(o.id)}
        >
          <span class="icon" class:common={o.id === null}>▣</span>
          {ownerName(o)}
          {#if !o.canWrite}<span class="ro" title={t('library.readOnly')}>🔒</span>{/if}
        </button>
        {#if o.id === ownerId}
          {#each folderTree(lib, o.id) as f (f.id)}
            <button
              class="node sub"
              class:active={f.id === folderId}
              style:padding-left="{1.4 + f.depth * 0.9}rem"
              onclick={() => select(o.id, f.id)}
            >
              <span class="icon">▸</span>{f.name}
            </button>
          {/each}
        {/if}
      {/each}
    {/if}
  </aside>

  <section class="main">
    <input
      class="search"
      type="search"
      bind:value={q}
      placeholder={t('library.searchPlaceholder')}
      aria-label={t('library.searchPlaceholder')}
    />

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if notice}<p class="success">{notice}</p>{/if}

    {#if hits}
      {#if hits.length === 0}
        <p class="muted">{t('library.noResults')}</p>
      {/if}
      <ul class="list">
        {#each hits as h (h.id)}
          <li class="item">
            <div class="info">
              <a href="/scripts/{h.id}" class="title">{h.title}</a>
              <span class="muted small"
                >{t('library.in', { name: ownerLabel(h.ownerId) })} · {meta(h)}</span
              >
              <span class="snippet">
                {#each snippetParts(h.snippet) as part, i (i)}{#if part.hit}<mark>{part.text}</mark
                    >{:else}{part.text}{/if}{/each}
              </span>
            </div>
            <div class="row actions">
              <button onclick={() => send(h)}>{t('library.send')}</button>
            </div>
          </li>
        {/each}
      </ul>
    {:else if lib && owner}
      <div class="row head">
        <nav class="crumbs" aria-label="breadcrumb">
          <button class="link" onclick={() => select(ownerId)}>{ownerName(owner)}</button>
          {#each path as f (f.id)}
            <span class="muted">/</span>
            <button class="link" onclick={() => select(ownerId, f.id)}>{f.name}</button>
          {/each}
        </nav>
        {#if canWrite}
          <div class="row">
            <button class="primary" onclick={newScript}>{t('library.newScript')}</button>
            <button onclick={newFolder}>{t('library.newFolder')}</button>
            {#if currentFolder}
              <button onclick={renameFolder}>{t('library.renameFolder')}</button>
              <button class="danger" onclick={deleteFolder}>{t('library.deleteFolder')}</button>
            {/if}
          </div>
        {/if}
      </div>

      {#if !canWrite}<p class="notice">{t('library.readOnly')}</p>{/if}

      {#if subfolders.length === 0 && scripts.length === 0}
        <p class="muted">{t('library.empty')}</p>
      {/if}

      <ul class="list">
        {#each subfolders as f (f.id)}
          <li class="item folder">
            <button class="link title" onclick={() => select(ownerId, f.id)}>▸ {f.name}</button>
          </li>
        {/each}
        {#each scripts as s (s.id)}
          <li class="item">
            <div class="info">
              <a href="/scripts/{s.id}" class="title">{s.title}</a>
              <span class="muted small">
                {meta(s)} · {t('library.updated', {
                  date: formatDate(s.updatedAt, i18n.locale),
                  name: s.updatedByName ?? '—',
                })}
              </span>
            </div>
            <div class="row actions">
              <button onclick={() => send(s)}>{t('library.send')}</button>
              {#if canWrite}
                <select
                  aria-label={t('library.move')}
                  onchange={(e) => move(s, e.currentTarget.value)}
                >
                  <option value="" selected disabled>{t('library.moveTo')}</option>
                  <option value="root" disabled={s.folderId === null}>{t('library.root')}</option>
                  {#each folderTree(lib, ownerId) as f (f.id)}
                    <option value={f.id} disabled={f.id === s.folderId}
                      >{'  '.repeat(f.depth)}{f.name}</option
                    >
                  {/each}
                </select>
                <button class="danger" onclick={() => trash(s)}>{t('library.trash')}</button>
              {:else}
                <button onclick={() => duplicate(s)}>{t('library.duplicate')}</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{t('common.loading')}</p>
    {/if}
  </section>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 1.25rem;
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    text-align: left;
    border: 0;
    background: transparent;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .node:hover {
    background: var(--surface-2);
  }
  .node.active {
    background: var(--accent);
    color: var(--accent-text);
  }
  .node.sub {
    font-size: 0.92rem;
  }
  .icon {
    color: #85b7eb;
  }
  .icon.common {
    color: var(--muted);
  }
  .ro {
    margin-left: auto;
    font-size: 0.75rem;
  }
  .search {
    width: 100%;
    margin-bottom: 1rem;
  }
  .head {
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .crumbs {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.65rem 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-weight: 500;
    color: var(--text);
    text-decoration: none;
  }
  .title:hover {
    text-decoration: underline;
  }
  .small {
    font-size: 0.85rem;
  }
  .snippet {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .snippet mark {
    background: #633806;
    color: #fff;
    border-radius: 3px;
    padding: 0 0.15em;
  }
  .actions select {
    max-width: 12rem;
  }
</style>
