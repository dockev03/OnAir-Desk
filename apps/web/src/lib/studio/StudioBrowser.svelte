<script lang="ts">
  import { formatDuration, readingSeconds, type Library } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';
  import { folderPath, ownerName } from '$lib/library.js';

  let {
    lib,
    ownerId,
    folderId,
    onfolder,
    onscript,
  }: {
    lib: Library;
    ownerId: number | null;
    folderId: number | null;
    onfolder: (folder: number | null) => void;
    onscript: (id: number) => void;
  } = $props();

  const owner = $derived(lib.owners.find((o) => o.id === ownerId));
  const path = $derived(folderPath(lib, folderId));
  const folders = $derived(
    lib.folders.filter((f) => f.ownerId === ownerId && f.parentId === folderId),
  );
  const scripts = $derived(
    lib.scripts.filter((s) => s.ownerId === ownerId && s.folderId === folderId),
  );
</script>

<div class="browser">
  <div class="crumbs">
    <button class="crumb" onclick={() => onfolder(null)}>{owner ? ownerName(owner) : ''}</button>
    {#each path as f (f.id)}
      <span class="sep">/</span>
      <button class="crumb" onclick={() => onfolder(f.id)}>{f.name}</button>
    {/each}
  </div>

  {#if folders.length === 0 && scripts.length === 0}
    <p class="empty">{t('library.empty')}</p>
  {/if}

  <div class="rows">
    {#if path.length > 0}
      <button class="row back" onclick={() => onfolder(path.at(-1)?.parentId ?? null)}>
        <span class="ic">↰</span><span class="name">{t('studio.up')}</span>
      </button>
    {/if}
    {#each folders as f (f.id)}
      <button class="row folder" onclick={() => onfolder(f.id)}>
        <span class="ic">▸</span><span class="name">{f.name}</span>
      </button>
    {/each}
    {#each scripts as s (s.id)}
      <button class="row script" onclick={() => onscript(s.id)}>
        <span class="ic">≡</span>
        <span class="name">{s.title}</span>
        <span class="dur mono">{formatDuration(readingSeconds(s.wordCount, s.speedWpm))}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .browser {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }
  .crumb {
    border: 0;
    background: none;
    color: #fff;
    font-size: 1.2rem;
    font-weight: 600;
    padding: 0.3rem 0.2rem;
  }
  .sep,
  .empty {
    color: var(--muted);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-height: 56px;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    border: 1px solid #2f3034;
    background: #1c1d20;
    color: #ececec;
    font-size: 1.15rem;
    text-align: left;
  }
  .row:hover {
    background: #232427;
  }
  .row.script {
    border-left: 4px solid #5dcaa5;
  }
  .row.back {
    color: var(--muted);
  }
  .ic {
    width: 1.4rem;
    text-align: center;
    color: #85b7eb;
  }
  .name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dur {
    color: var(--muted);
    font-size: 1rem;
  }
</style>
