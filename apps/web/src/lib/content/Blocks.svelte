<script lang="ts">
  import type { Block, Cue, ListItem } from '@onair-desk/shared';
  import Blocks from './Blocks.svelte';
  import Inlines from './Inlines.svelte';

  let { blocks, cues }: { blocks: (Block | ListItem['content'][number])[]; cues: Cue[] } = $props();
</script>

{#each blocks as block, i (i)}
  {#if block.type === 'paragraph'}
    <p>
      {#if block.content}<Inlines nodes={block.content} {cues} />{:else}<br />{/if}
    </p>
  {:else if block.type === 'heading'}
    {#if block.attrs.level === 2}
      <h2><Inlines nodes={block.content ?? []} {cues} /></h2>
    {:else}
      <h3><Inlines nodes={block.content ?? []} {cues} /></h3>
    {/if}
  {:else if block.type === 'bulletList'}
    <ul>
      {#each block.content as item, j (j)}<li><Blocks blocks={item.content} {cues} /></li>{/each}
    </ul>
  {:else if block.type === 'orderedList'}
    <ol start={block.attrs?.start ?? 1}>
      {#each block.content as item, j (j)}<li><Blocks blocks={item.content} {cues} /></li>{/each}
    </ol>
  {/if}
{/each}
