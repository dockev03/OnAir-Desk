<script lang="ts">
  import { untrack } from 'svelte';
  import { formatClock } from '@onair-desk/shared';
  import { api } from '$lib/api.js';
  import ScriptView from '$lib/content/ScriptView.svelte';
  import { i18n, t } from '$lib/i18n/index.svelte.js';
  import { LiveLink } from '$lib/live.svelte.js';

  const link = new LiveLink();
  /** Heure serveur estimée, mise à jour à chaque changement de seconde. */
  let now = $state(Date.now());
  // Recalculée aussi dès que les paramètres (fuseau, format) arrivent ou changent.
  const clock = $derived(
    formatClock(
      new Date(now),
      link.settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      link.settings?.timeFormat ?? '24h',
    ),
  );

  /** Appairage : le jeton est lu après le # (jamais envoyé dans l'URL), puis retiré de l'adresse. */
  async function pairFromHash() {
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (!token) return;
    history.replaceState(null, '', location.pathname);
    await api('POST', '/api/kiosk/pair', { token }).catch(() => {});
  }

  // Démarrage unique : rien de réactif n'est lu ici (untrack), sinon chaque nouveau
  // paramètre relancerait la connexion.
  $effect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      now = link.now();
      timer = setTimeout(tick, 1000 - (now % 1000) + 5);
    };
    untrack(tick);

    void pairFromHash().finally(() => link.start());
    return () => {
      clearTimeout(timer);
      link.stop();
    };
  });

  $effect(() => {
    if (link.settings) i18n.set(link.settings.locale);
  });
</script>

<svelte:head>
  <title>{link.settings?.stationName ?? 'OnAir-Desk'}</title>
</svelte:head>

<div class="studio">
  {#if link.prompter?.script}
    {@const script = link.prompter.script}
    <div class="bar">
      <div class="station">{link.settings?.stationName ?? ''}</div>
      <div class="script-title">
        {script.title}
        {#if link.prompter.deleted}<span class="deleted">{t('studio.deleted')}</span>{/if}
      </div>
      <div class="small-clock mono">{clock}</div>
      <div class="link {link.state}" title={link.state}><span class="dot"></span></div>
    </div>
    {#if link.state === 'offline'}<div class="offline-line">{t('studio.offline')}</div>{/if}
    <!-- Nouveau script : on repart du haut ; même script modifié : la position est gardée. -->
    {#key script.id}
      <div class="reader">
        <ScriptView
          doc={script.content}
          cues={link.settings?.cues ?? []}
          fontSize={link.settings?.prompterFontSize ?? 48}
        />
      </div>
    {/key}
  {:else}
    <div class="top">
      <div class="station">{link.settings?.stationName ?? ''}</div>
      <div class="link {link.state}" title={link.state}>
        <span class="dot"></span>
        {#if link.state === 'offline'}{t('studio.offline')}{/if}
      </div>
    </div>

    <div class="clock mono" aria-live="off">{clock}</div>
  {/if}

  {#if link.state === 'unauthorized'}
    <div class="message">
      <strong>{t('studio.notPaired')}</strong>
      <span>{t('studio.notPairedText')}</span>
    </div>
  {:else if link.state === 'revoked'}
    <div class="message"><strong>{t('studio.revoked')}</strong></div>
  {/if}
</div>

<style>
  :global(body) {
    overflow: hidden;
    user-select: none;
  }
  .studio {
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 12px 16px;
    background: #111214;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
    font-size: 1.1rem;
  }
  .station {
    font-weight: 500;
    color: #fff;
  }
  .link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--warn);
  }
  .link.online .dot {
    background: var(--ok);
  }
  .link.offline,
  .link.connecting {
    color: #fac775;
  }
  .link.unauthorized .dot,
  .link.revoked .dot {
    background: var(--danger);
  }
  .clock {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: min(18vw, 40vh);
    font-weight: 500;
    color: #fff;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 1rem;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  .script-title {
    color: var(--muted);
    font-size: 1.1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .deleted {
    margin-left: 0.5rem;
    font-size: 0.85rem;
    color: #f7c1c1;
    border: 1px solid var(--danger);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }
  .small-clock {
    font-size: 2.2rem;
    font-weight: 500;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .offline-line {
    color: #fac775;
    font-size: 0.95rem;
    padding-top: 4px;
  }
  .reader {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 0.5rem 50vh;
    scrollbar-width: thin;
    scrollbar-color: #2f3034 transparent;
  }
  .message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 1rem;
    border: 1px solid var(--danger);
    background: var(--danger-bg);
    border-radius: var(--radius);
    color: #f7c1c1;
    text-align: center;
  }
</style>
