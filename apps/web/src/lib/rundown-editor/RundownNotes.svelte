<script lang="ts">
  import { MAX_RUNDOWN_NOTES } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';

  /** Notes générales d'un conducteur ou d'un modèle (consignes, règles de jeu). */
  let {
    notes = $bindable(),
    canWrite,
    onchange,
  }: { notes: string; canWrite: boolean; onchange: () => void } = $props();
</script>

{#if canWrite}
  <label class="notes">
    {t('rundowns.field.notes')}
    <textarea
      bind:value={notes}
      maxlength={MAX_RUNDOWN_NOTES}
      rows="5"
      placeholder={t('rundowns.notesHint')}
      oninput={onchange}></textarea>
  </label>
{:else if notes.trim()}
  <section class="notes">
    <h2>{t('rundowns.field.notes')}</h2>
    <p class="ro">{notes}</p>
  </section>
{/if}

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 2rem;
  }
  textarea {
    resize: vertical;
    font: inherit;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0;
  }
  .ro {
    margin: 0;
    white-space: pre-wrap;
  }
</style>
