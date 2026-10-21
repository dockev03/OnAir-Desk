<script lang="ts">
  import type { Library } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';
  import { folderTree, ownerKey, ownerName } from '$lib/library.js';

  let {
    lib,
    ownerId,
    folderId,
    collapsed,
    onselect,
    ontoggle,
  }: {
    lib: Library | null;
    ownerId: number | null | undefined;
    folderId: number | null;
    collapsed: boolean;
    onselect: (owner: number | null, folder: number | null) => void;
    ontoggle: () => void;
  } = $props();

  const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';
</script>

<nav class="side" class:mini={collapsed} aria-label={t('studio.folders')}>
  <button class="it toggle" onclick={ontoggle} aria-expanded={!collapsed}>
    <span class="ic">{collapsed ? '»' : '«'}</span>
    <span class="tx">{t('studio.collapse')}</span>
  </button>
  {#if lib}
    {#each lib.owners as o (ownerKey(o.id))}
      <button
        class="it"
        class:on={o.id === ownerId && folderId === null}
        title={ownerName(o)}
        onclick={() => onselect(o.id, null)}
      >
        <span class="ic badge" class:common={o.id === null}>{initial(ownerName(o))}</span>
        <span class="tx">{ownerName(o)}</span>
      </button>
      {#if !collapsed && o.id === ownerId}
        {#each folderTree(lib, o.id) as f (f.id)}
          <button
            class="it sub"
            class:on={f.id === folderId}
            style:padding-left="{1.2 + f.depth * 0.8}rem"
            onclick={() => onselect(o.id, f.id)}
          >
            <span class="ic">▸</span><span class="tx">{f.name}</span>
          </button>
        {/each}
      {/if}
    {/each}
  {/if}
</nav>

<style>
  .side {
    width: 230px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    border-right: 1px solid #2a2b2e;
    padding-right: 8px;
    transition: width 0.2s;
  }
  .side.mini {
    width: 54px;
  }
  .mini .tx {
    display: none;
  }
  .it {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    padding: 0.4rem 0.6rem;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #ddd;
    font-size: 1.05rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .it:hover {
    background: #232427;
  }
  .it.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  .it.sub {
    min-height: 42px;
    font-size: 0.98rem;
  }
  .toggle {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .ic {
    width: 1.6rem;
    flex-shrink: 0;
    text-align: center;
  }
  .badge {
    height: 1.6rem;
    line-height: 1.6rem;
    border-radius: 50%;
    background: #0c447c;
    color: #e6f1fb;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .badge.common {
    background: #444441;
  }
</style>
