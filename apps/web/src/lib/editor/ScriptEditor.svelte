<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { Color, TextStyle } from '@tiptap/extension-text-style';
  import Highlight from '@tiptap/extension-highlight';
  import {
    HIGHLIGHT_COLORS,
    TEXT_COLORS,
    sanitizeDoc,
    type Cue,
    type ScriptDoc,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';
  import { CueNode } from './cue.js';

  let {
    content,
    cues,
    onchange,
  }: { content: ScriptDoc; cues: Cue[]; onchange: (doc: ScriptDoc) => void } = $props();

  let element: HTMLDivElement;
  let editor = $state<Editor | null>(null);
  /** Incrémenté à chaque transaction : force la mise à jour de l'état des boutons. */
  let tick = $state(0);

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          // Hors liste blanche : désactivés pour ne pas pouvoir être créés.
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          strike: false,
          link: false,
          heading: { levels: [2, 3] },
        }),
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        CueNode.configure({ cues: () => cues }),
      ],
      content,
      editorProps: { attributes: { class: 'script-editor', spellcheck: 'true' } },
      onTransaction: () => tick++,
      onUpdate: ({ editor: e }) => onchange(sanitizeDoc(e.getJSON())),
    });
  });

  onDestroy(() => editor?.destroy());

  /** Remplace le contenu (rechargement après conflit, restauration). */
  export function setContent(doc: ScriptDoc) {
    editor?.commands.setContent(doc, { emitUpdate: false });
  }

  const active = $derived.by(() => {
    void tick;
    const e = editor;
    return {
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      underline: e?.isActive('underline') ?? false,
      h2: e?.isActive('heading', { level: 2 }) ?? false,
      h3: e?.isActive('heading', { level: 3 }) ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      color: (e?.getAttributes('textStyle').color as string | undefined)?.toUpperCase(),
      highlight: (e?.getAttributes('highlight').color as string | undefined)?.toUpperCase(),
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    };
  });

  const chain = () => editor!.chain().focus();
</script>

<!-- Les boutons ne prennent pas le focus : la sélection et la frappe restent dans le texte. -->
<div
  class="toolbar"
  role="toolbar"
  tabindex="-1"
  aria-label={t('editor.toolbar')}
  onmousedown={(e) => e.preventDefault()}
>
  <div class="group">
    <button
      type="button"
      class:on={active.bold}
      aria-pressed={active.bold}
      aria-label={t('editor.bold')}
      title={t('editor.bold')}
      onclick={() => chain().toggleBold().run()}><b>G</b></button
    >
    <button
      type="button"
      class:on={active.italic}
      aria-pressed={active.italic}
      aria-label={t('editor.italic')}
      title={t('editor.italic')}
      onclick={() => chain().toggleItalic().run()}><i>I</i></button
    >
    <button
      type="button"
      class:on={active.underline}
      aria-pressed={active.underline}
      aria-label={t('editor.underline')}
      title={t('editor.underline')}
      onclick={() => chain().toggleUnderline().run()}><u>S</u></button
    >
  </div>
  <div class="group">
    <button
      type="button"
      class:on={active.h2}
      aria-pressed={active.h2}
      aria-label={t('editor.heading')}
      title={t('editor.heading')}
      onclick={() => chain().toggleHeading({ level: 2 }).run()}>T1</button
    >
    <button
      type="button"
      class:on={active.h3}
      aria-pressed={active.h3}
      aria-label={t('editor.subheading')}
      title={t('editor.subheading')}
      onclick={() => chain().toggleHeading({ level: 3 }).run()}>T2</button
    >
    <button
      type="button"
      class:on={active.bullet}
      aria-pressed={active.bullet}
      aria-label={t('editor.bulletList')}
      title={t('editor.bulletList')}
      onclick={() => chain().toggleBulletList().run()}>•</button
    >
    <button
      type="button"
      class:on={active.ordered}
      aria-pressed={active.ordered}
      aria-label={t('editor.orderedList')}
      title={t('editor.orderedList')}
      onclick={() => chain().toggleOrderedList().run()}>1.</button
    >
  </div>
  <div class="group" aria-label={t('editor.color')} title={t('editor.color')}>
    <span class="lbl">A</span>
    {#each TEXT_COLORS as c (c)}
      <button
        type="button"
        class="swatch"
        class:on={active.color === c}
        style:color={c}
        aria-label="{t('editor.color')} {c}"
        onclick={() => chain().setColor(c).run()}>A</button
      >
    {/each}
    <button
      type="button"
      class="swatch"
      aria-label="{t('editor.color')} : {t('editor.noColor')}"
      onclick={() => chain().unsetColor().run()}>∅</button
    >
  </div>
  <div class="group" aria-label={t('editor.highlight')} title={t('editor.highlight')}>
    {#each HIGHLIGHT_COLORS as c (c)}
      <button
        type="button"
        class="swatch hl"
        class:on={active.highlight === c}
        style:background-color={c}
        aria-label="{t('editor.highlight')} {c}"
        onclick={() => chain().toggleHighlight({ color: c }).run()}
      ></button>
    {/each}
    <button
      type="button"
      class="swatch"
      aria-label="{t('editor.highlight')} : {t('editor.noColor')}"
      onclick={() => chain().unsetHighlight().run()}>∅</button
    >
  </div>
  <div class="group">
    <span class="lbl">{t('editor.cue')}</span>
    {#each cues as cue (cue.id)}
      <button
        type="button"
        class="cue-btn"
        style:color={cue.color}
        onclick={() =>
          chain()
            .insertContent({ type: 'cue', attrs: { cueId: cue.id, label: cue.label } })
            .run()}>[{cue.label}]</button
      >
    {/each}
  </div>
  <div class="group">
    <button
      type="button"
      disabled={!active.canUndo}
      aria-label={t('editor.undo')}
      title={t('editor.undo')}
      onclick={() => chain().undo().run()}>↶</button
    >
    <button
      type="button"
      disabled={!active.canRedo}
      aria-label={t('editor.redo')}
      title={t('editor.redo')}
      onclick={() => chain().redo().run()}>↷</button
    >
  </div>
</div>

<div class="surface" bind:this={element}></div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius) var(--radius) 0 0;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding-right: 0.5rem;
    border-right: 1px solid var(--border);
  }
  .group:last-child {
    border-right: 0;
  }
  .toolbar button {
    min-width: 2rem;
    padding: 0.25rem 0.45rem;
  }
  .toolbar button.on {
    background: var(--accent);
    color: var(--accent-text);
    border-color: #185fa5;
  }
  .swatch {
    font-weight: 700;
  }
  .swatch.hl {
    width: 1.6rem;
    min-width: 1.6rem;
    height: 1.6rem;
  }
  .swatch.on {
    outline: 2px solid #fff;
  }
  .cue-btn {
    font-weight: 600;
    font-size: 0.8rem;
  }
  .lbl {
    color: var(--muted);
    font-size: 0.8rem;
    padding: 0 0.2rem;
  }
  .surface {
    background: #0b0b0c;
    border: 1px solid var(--border);
    border-top: 0;
    border-radius: 0 0 var(--radius) var(--radius);
  }
  .surface :global(.script-editor) {
    min-height: 50vh;
    padding: 1rem 1.25rem;
    font-size: 1.25rem;
    line-height: 1.6;
    outline: none;
    color: #ececec;
  }
  .surface :global(.script-editor p) {
    margin: 0 0 0.5em;
  }
  .surface :global(.script-editor h2) {
    font-size: 1.4em;
    margin: 0.4em 0;
  }
  .surface :global(.script-editor h3) {
    font-size: 1.2em;
    margin: 0.4em 0;
  }
  .surface :global(.script-editor mark) {
    color: #fff;
    padding: 0 0.15em;
    border-radius: 0.15em;
  }
  .surface :global(.script-editor .cue) {
    font-weight: 600;
    cursor: default;
  }
  .surface :global(.script-editor .cue.ProseMirror-selectednode) {
    outline: 2px solid #85b7eb;
    border-radius: 3px;
  }
</style>
