<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PROMPTER_FONT_MAX,
    PROMPTER_FONT_MIN,
    formatClock,
    type Library,
  } from '@onair-desk/shared';
  import { api } from '$lib/api.js';
  import { i18n, t } from '$lib/i18n/index.svelte.js';
  import { LiveLink } from '$lib/live.svelte.js';
  import Reader from '$lib/studio/Reader.svelte';
  import StudioBrowser from '$lib/studio/StudioBrowser.svelte';
  import StudioSidebar from '$lib/studio/StudioSidebar.svelte';

  const FONT_KEY = 'onair-desk.studio.fontSize';
  const LIBRARY_REFRESH_MS = 60_000;

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

  let lib = $state<Library | null>(null);
  /** Dossier affiché dans la navigation (undefined : premier dossier de la liste). */
  let ownerId = $state<number | null | undefined>(undefined);
  let folderId = $state<number | null>(null);
  /** Sortie demandée sur cet écran, avant confirmation du serveur (ou hors ligne). */
  let leftReading = $state(false);
  /** Réduction manuelle de la barre latérale (null : automatique selon le mode). */
  let manualCollapse = $state<boolean | null>(null);
  /** Taille du texte propre à cet écran (null : celle des paramètres). */
  let localFont = $state<number | null>(readFont());

  const script = $derived(link.prompter?.script ?? null);
  const reading = $derived(script !== null && !leftReading);
  const collapsed = $derived(manualCollapse ?? reading);
  const currentOwner = $derived(ownerId === undefined ? (lib?.owners[0]?.id ?? null) : ownerId);
  const fontSize = $derived(localFont ?? link.settings?.prompterFontSize ?? 48);

  /** Scripts du même dossier que le script affiché, pour Précédent / Suivant. */
  const siblings = $derived.by(() => {
    if (!lib || !script || script.ownerId === undefined) return [];
    return lib.scripts.filter(
      (s) => s.ownerId === script.ownerId && s.folderId === (script.folderId ?? null),
    );
  });
  const index = $derived(script ? siblings.findIndex((s) => s.id === script.id) : -1);

  function readFont(): number | null {
    try {
      const v = Number(localStorage.getItem(FONT_KEY));
      return v >= PROMPTER_FONT_MIN && v <= PROMPTER_FONT_MAX ? v : null;
    } catch {
      return null;
    }
  }

  function changeFont(delta: number) {
    const next = Math.min(PROMPTER_FONT_MAX, Math.max(PROMPTER_FONT_MIN, fontSize + delta));
    localFont = next;
    try {
      localStorage.setItem(FONT_KEY, String(next));
    } catch {
      // Stockage indisponible : le réglage vaut pour la session en cours.
    }
  }

  async function loadLibrary() {
    try {
      lib = await api<Library>('GET', '/api/library');
    } catch {
      // Hors ligne ou écran non appairé : on garde la dernière liste connue.
    }
  }

  /** Appairage : le jeton est lu après le # (jamais envoyé dans l'URL), puis retiré de l'adresse. */
  async function pairFromHash() {
    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    if (!token) return;
    history.replaceState(null, '', location.pathname);
    await api('POST', '/api/kiosk/pair', { token }).catch(() => {});
  }

  async function open(id: number) {
    leftReading = false;
    await api('POST', '/api/prompter', { scriptId: id }).catch(() => {});
  }

  async function exit() {
    leftReading = true;
    void loadLibrary();
    await api('POST', '/api/prompter', { scriptId: null }).catch(() => {});
  }

  function select(owner: number | null, folder: number | null) {
    ownerId = owner;
    folderId = folder;
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

    void pairFromHash().finally(() => {
      link.start();
      void loadLibrary();
    });
    const refresh = setInterval(() => void loadLibrary(), LIBRARY_REFRESH_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(refresh);
      link.stop();
    };
  });

  // Chaque nouvel état du prompteur (envoi depuis un poste ou cet écran) l'emporte.
  let lastScriptId: number | null = null;
  $effect(() => {
    const s = link.prompter?.script ?? null;
    untrack(() => {
      leftReading = false;
      if ((s?.id ?? null) === lastScriptId) return; // même script, simplement modifié
      lastScriptId = s?.id ?? null;
      manualCollapse = null;
      // La navigation suit le dossier du script affiché : « Sortir » y ramène.
      if (s && s.ownerId !== undefined) select(s.ownerId, s.folderId ?? null);
    });
  });

  // Au retour de la liaison, la liste des dossiers est rechargée.
  $effect(() => {
    if (link.state === 'online') untrack(() => void loadLibrary());
  });

  $effect(() => {
    if (link.settings) i18n.set(link.settings.locale);
  });
</script>

<svelte:head>
  <title>{link.settings?.stationName ?? 'OnAir-Desk'}</title>
</svelte:head>

<div class="studio">
  <header class="top">
    <div class="card clock-card">
      <div class="station">{link.settings?.stationName ?? ''}</div>
      <div class="clock mono" aria-live="off">{clock}</div>
    </div>
    <!-- Dans le bandeau : une coupure ne décale pas le texte en cours de lecture. -->
    <div class="spacer">
      {#if link.state === 'offline'}<div class="offline-line">{t('studio.offline')}</div>{/if}
    </div>
    <div class="link {link.state}" title={link.state}><span class="dot"></span></div>
  </header>

  <div class="body">
    {#if lib}
      <StudioSidebar
        {lib}
        ownerId={currentOwner}
        {folderId}
        {collapsed}
        onselect={(o, f) => {
          select(o, f);
          if (reading) void exit();
        }}
        ontoggle={() => (manualCollapse = !collapsed)}
      />
    {/if}

    {#if reading && script}
      <Reader
        {script}
        cues={link.settings?.cues ?? []}
        {fontSize}
        deleted={link.prompter?.deleted ?? false}
        canPrev={index > 0}
        canNext={index >= 0 && index < siblings.length - 1}
        onfont={changeFont}
        onprev={() => void open(siblings[index - 1]!.id)}
        onnext={() => void open(siblings[index + 1]!.id)}
        onexit={() => void exit()}
      />
    {:else if lib}
      <StudioBrowser
        {lib}
        ownerId={currentOwner}
        {folderId}
        onfolder={(f) => (folderId = f)}
        onscript={(id) => void open(id)}
      />
    {:else}
      <div class="big-clock mono">{clock}</div>
    {/if}
  </div>

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
    gap: 10px;
    padding: 12px 16px;
    background: #111214;
  }
  .top {
    display: flex;
    align-items: stretch;
    gap: 10px;
  }
  .clock-card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 6px 14px;
    min-width: 13rem;
  }
  .station {
    font-size: 0.9rem;
    color: var(--muted);
  }
  .clock {
    font-size: 2.4rem;
    font-weight: 500;
    color: #fff;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
    display: flex;
    align-items: center;
  }
  .link {
    display: flex;
    align-items: flex-start;
    padding-top: 4px;
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
  .link.unauthorized .dot,
  .link.revoked .dot {
    background: var(--danger);
  }
  .offline-line {
    color: #fac775;
    background: #412402;
    border: 1px solid var(--warn);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.95rem;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
  }
  .big-clock {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: min(18vw, 40vh);
    font-weight: 500;
    color: #fff;
    font-variant-numeric: tabular-nums;
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
