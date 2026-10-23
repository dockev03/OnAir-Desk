<script lang="ts">
  import type { TrashItem } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { formatDate } from '$lib/library.js';

  let items = $state<TrashItem[] | null>(null);
  let error = $state('');

  async function refresh() {
    try {
      items = await api<TrashItem[]>('GET', '/api/trash');
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  $effect(() => {
    void refresh();
  });

  async function run(action: () => Promise<unknown>) {
    error = '';
    try {
      await action();
      await refresh();
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  /** Routes de la corbeille : scripts à la racine, conducteurs et modèles à part. */
  const trashUrl = (item: TrashItem) =>
    item.kind === 'rundown'
      ? `/api/trash/rundowns/${item.id}`
      : item.kind === 'template'
        ? `/api/trash/templates/${item.id}`
        : `/api/trash/${item.id}`;

  function remove(item: TrashItem) {
    if (confirm(t('trash.deleteConfirm', { title: item.title }))) {
      void run(() => api('DELETE', trashUrl(item)));
    }
  }
</script>

<h1>{t('trash.title')}</h1>
<p class="muted">{t('trash.intro')}</p>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if items && items.length === 0}
  <p class="muted">{t('trash.empty')}</p>
{:else if items}
  <div class="table-wrap">
    <table>
      <tbody>
        {#each items as item (`${item.kind}-${item.id}`)}
          <tr>
            <td>
              <strong>{item.title}</strong>
              <div class="muted small">
                {#if item.kind === 'rundown'}{t('trash.kindRundown')} ·{/if}
                {#if item.kind === 'template'}{t('trash.kindTemplate')} ·{/if}
                {item.ownerId === null ? t('library.common') : item.ownerName} ·
                {item.kind !== 'script'
                  ? t('trash.items', { n: item.itemCount ?? 0 })
                  : t('library.words', { n: item.wordCount ?? 0 })}
              </div>
            </td>
            <td class="small">
              {t('trash.deletedBy', {
                date: formatDate(item.deletedAt, i18n.locale),
                name: item.deletedByName ?? '—',
              })}
              <div class="muted">
                {t('trash.purgeAt', { date: formatDate(item.purgeAt, i18n.locale) })}
              </div>
            </td>
            <td>
              <div class="row" style="justify-content: flex-end">
                <button
                  class="primary"
                  onclick={() => run(() => api('POST', `${trashUrl(item)}/restore`))}
                  >{t('trash.restore')}</button
                >
                <button class="danger" onclick={() => remove(item)}
                  >{t('trash.deleteForever')}</button
                >
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .small {
    font-size: 0.85rem;
  }
</style>
