<script lang="ts">
  import type { Cue, ScriptDoc } from '@onair-desk/shared';
  import Blocks from './Blocks.svelte';

  /** Affichage d'un script dans le style du prompteur (fond sombre, grand texte). */
  let { doc, cues, fontSize = 26 }: { doc: ScriptDoc; cues: Cue[]; fontSize?: number } = $props();
</script>

<div class="script" style:font-size="{fontSize}px">
  <Blocks blocks={doc.content} {cues} />
</div>

<style>
  .script {
    color: #ececec;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .script :global(p) {
    margin: 0 0 0.5em;
  }
  .script :global(h2) {
    font-size: 1.25em;
    margin: 0.4em 0 0.4em;
    font-weight: 600;
  }
  .script :global(h3) {
    font-size: 1.1em;
    margin: 0.4em 0 0.3em;
    font-weight: 600;
  }
  .script :global(ul),
  .script :global(ol) {
    margin: 0 0 0.5em;
    padding-left: 1.3em;
  }
  .script :global(li > p) {
    margin: 0;
  }
</style>
