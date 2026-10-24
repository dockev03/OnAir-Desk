<script lang="ts">
  import { formatDuration, type RadiodjSong } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';

  /** Recherche d'un titre dans la bibliothèque RadioDJ (élément « titre » d'un conducteur). */
  let { onpick, onclose }: { onpick: (song: RadiodjSong) => void; onclose: () => void } = $props();

  let query = $state('');
  let songs = $state<RadiodjSong[] | null>(null);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Numéro de la dernière recherche : une réponse plus ancienne arrivée après est ignorée. */
  let seq = 0;

  function search() {
    clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      songs = null;
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const found = await api<RadiodjSong[]>(
          'GET',
          `/api/radiodj/songs?q=${encodeURIComponent(q)}`,
        );
        if (mine === seq) {
          songs = found;
          error = '';
        }
      } catch (e) {
        if (mine === seq) error = errorMessage(errorCode(e));
      }
    }, 300);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<div class="picker">
  <div class="row">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="search"
      autofocus
      placeholder={t('rundowns.item.songSearch')}
      aria-label={t('rundowns.item.songSearch')}
      bind:value={query}
      oninput={search}
      maxlength="100"
    />
    <button type="button" onclick={onclose}>{t('rundowns.item.songClose')}</button>
  </div>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if songs && songs.length === 0}
    <p class="muted">{t('rundowns.item.songNone')}</p>
  {:else if songs}
    <ul>
      {#each songs as song (song.id)}
        <li>
          <button type="button" class="song" onclick={() => onpick(song)}>
            <span>{song.artist} — {song.title}</span>
            <span class="mono">{formatDuration(Math.round(song.durationMs / 1000))}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
  }
  .picker input {
    flex: 1;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 14rem;
    overflow-y: auto;
  }
  .song {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    text-align: left;
  }
  p {
    margin: 0;
  }
</style>
