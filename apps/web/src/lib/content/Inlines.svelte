<script lang="ts">
  import { formatDuration, type Cue, type Inline, type Mark } from '@onair-desk/shared';

  let { nodes, cues }: { nodes: Inline[]; cues: Cue[] } = $props();

  const has = (marks: Mark[] | undefined, type: Mark['type']) =>
    marks?.some((m) => m.type === type) ?? false;
  const colorOf = (marks: Mark[] | undefined, type: 'textStyle' | 'highlight') => {
    const m = marks?.find((x) => x.type === type);
    return m && 'attrs' in m ? m.attrs.color : undefined;
  };
  const cueOf = (id: string) => cues.find((c) => c.id === id);
</script>

<!-- Rendu élément par élément : aucune chaîne n'est interprétée comme du HTML. -->
{#each nodes as node, i (i)}
  {#if node.type === 'text'}
    <span
      class:b={has(node.marks, 'bold')}
      class:i={has(node.marks, 'italic')}
      class:u={has(node.marks, 'underline')}
      class:hl={colorOf(node.marks, 'highlight') !== undefined}
      style:color={colorOf(node.marks, 'textStyle')}
      style:background-color={colorOf(node.marks, 'highlight')}>{node.text}</span
    >
  {:else if node.type === 'hardBreak'}
    <br />
  {:else if node.type === 'cue'}
    {@const cue = cueOf(node.attrs.cueId)}
    <!-- data-cue-seconds : repéré par le prompteur pour arrêter le défilement automatique. -->
    <span
      class="cue"
      style:color={cue?.color ?? '#B4B2A9'}
      data-cue-seconds={node.attrs.seconds}
      data-cue-label={cue?.label ?? node.attrs.label}
      >[{cue?.label ?? node.attrs.label}{node.attrs.seconds
        ? ` · ${formatDuration(node.attrs.seconds)}`
        : ''}]</span
    >
  {/if}
{/each}

<style>
  .b {
    font-weight: 700;
  }
  .i {
    font-style: italic;
  }
  .u {
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  .hl {
    padding: 0 0.2em;
    border-radius: 0.15em;
    color: #fff;
  }
  .cue {
    font-weight: 600;
    letter-spacing: 0.03em;
  }
</style>
