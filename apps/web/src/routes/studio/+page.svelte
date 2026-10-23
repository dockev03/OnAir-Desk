<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PROMPTER_FONT_MAX,
    PROMPTER_FONT_MIN,
    formatClock,
    rundownSchedule,
    secondsToTime,
    type Library,
    type PrompterRundown,
    type RundownList,
  } from '@onair-desk/shared';
  import { api } from '$lib/api.js';
  import { i18n, t } from '$lib/i18n/index.svelte.js';
  import { ownerName } from '$lib/library.js';
  import { LiveLink } from '$lib/live.svelte.js';
  import { groupByDate, type StudioView } from '$lib/rundowns.js';
  import { logoUrl } from '$lib/settings.svelte.js';
  import ItemCard from '$lib/studio/ItemCard.svelte';
  import NowPlaying from '$lib/studio/NowPlaying.svelte';
  import Reader from '$lib/studio/Reader.svelte';
  import RundownPicker from '$lib/studio/RundownPicker.svelte';
  import RundownView from '$lib/studio/RundownView.svelte';
  import StudioBrowser from '$lib/studio/StudioBrowser.svelte';
  import StudioSidebar from '$lib/studio/StudioSidebar.svelte';

  const FONT_KEY = 'onair-desk.studio.fontSize';
  const LIBRARY_REFRESH_MS = 60_000;

  const link = new LiveLink();
  /** Heure serveur estimée, mise à jour à chaque changement de seconde. */
  let now = $state(Date.now());
  const timezone = $derived(
    link.settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  // Recalculée aussi dès que les paramètres (fuseau, format) arrivent ou changent.
  const clock = $derived(formatClock(new Date(now), timezone, link.settings?.timeFormat ?? '24h'));
  /** Titres en cours / à venir : affichés dès qu'une source d'automation est choisie. */
  const showAir = $derived((link.air?.state.source.id ?? 'none') !== 'none');

  let lib = $state<Library | null>(null);
  let rundownList = $state<RundownList | null>(null);
  /** Zone principale : Aujourd'hui (au démarrage), scripts, conducteurs d'un dossier, conducteur. */
  let view = $state<StudioView>('today');
  /** Conducteur ouvert dans la navigation, et sa copie quand il n'est pas sur le prompteur. */
  let rundownId = $state<number | null>(null);
  let browsed = $state<PrompterRundown | null>(null);
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
  /** Conducteur suivi sur le prompteur et position de l'élément en cours. */
  const live = $derived(
    link.prompter?.rundown && link.prompter.itemUid ? link.prompter.rundown : null,
  );
  const itemIndex = $derived(
    live ? live.items.findIndex((i) => i.uid === link.prompter?.itemUid) : -1,
  );
  const item = $derived(live?.items[itemIndex] ?? null);
  const reading = $derived((script !== null || item !== null) && !leftReading);
  const types = $derived(link.settings?.itemTypes ?? []);
  /** Conducteur affiché dans la vue : la version en direct s'il est sur le prompteur. */
  const shownRundown = $derived(
    link.prompter?.rundown?.id === rundownId ? link.prompter!.rundown : browsed,
  );
  const todayRundowns = $derived(
    rundownList ? groupByDate(rundownList.rundowns, rundownList.today).today : [],
  );
  const ownerRundowns = $derived.by(() => {
    if (!rundownList) return [];
    const g = groupByDate(
      rundownList.rundowns.filter((r) => r.ownerId === currentOwner),
      rundownList.today,
    );
    // Sur l'écran studio : le jour et la suite d'abord, quelques passés seulement.
    return [...g.today, ...g.upcoming, ...g.past.slice(0, 10)];
  });
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
      [lib, rundownList] = await Promise.all([
        api<Library>('GET', '/api/library'),
        api<RundownList>('GET', '/api/rundowns'),
      ]);
    } catch {
      // Hors ligne ou écran non appairé : on garde la dernière liste connue.
    }
  }

  async function openRundown(id: number) {
    view = 'rundown';
    if (rundownId !== id) browsed = null;
    rundownId = id;
    // La barre latérale suit le dossier du conducteur (ouvert depuis « Aujourd'hui »).
    const summary = rundownList?.rundowns.find((r) => r.id === id);
    if (summary) select(summary.ownerId, null);
    try {
      browsed = await api<PrompterRundown>('GET', `/api/rundowns/${id}`);
    } catch {
      // Hors ligne : la dernière copie connue reste affichée.
    }
  }

  async function openItem(uid: string) {
    if (rundownId === null) return;
    leftReading = false;
    await api('POST', '/api/prompter', { rundownId, itemUid: uid }).catch(() => {});
  }

  function stepItem(delta: number) {
    const next = live?.items[itemIndex + delta];
    if (live && next) {
      rundownId = live.id;
      void openItem(next.uid);
    }
  }

  const ownerLabel = (id: number | null) => {
    const o = lib?.owners.find((x) => x.id === id);
    return o ? ownerName(o) : '';
  };

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

  /** Sortie de lecture ; depuis un conducteur, retour à sa liste. */
  async function exit() {
    if (live && !leftReading) {
      view = 'rundown';
      rundownId = live.id;
      browsed = live;
    }
    leftReading = true;
    void loadLibrary();
    await api('POST', '/api/prompter', { scriptId: null }).catch(() => {});
  }

  function select(owner: number | null, folder: number | null) {
    ownerId = owner;
    folderId = folder;
  }

  /** Navigation latérale pendant la lecture : on sort, la vue choisie l'emporte. */
  function navigate(next: StudioView, apply: () => void) {
    if (reading) void exit();
    view = next;
    apply();
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
  let lastShown = '';
  $effect(() => {
    const p = link.prompter;
    const s = p?.script ?? null;
    const r = p?.rundown ?? null;
    untrack(() => {
      leftReading = false;
      // Même script ou même élément, simplement modifié : rien ne bouge.
      const key = `${r?.id ?? ''}/${p?.itemUid ?? ''}/${s?.id ?? ''}`;
      if (key === lastShown) return;
      lastShown = key;
      manualCollapse = null;
      if (r && p?.itemUid) {
        // La navigation suit le conducteur : « Conducteur » y ramène.
        view = 'rundown';
        rundownId = r.id;
        ownerId = r.ownerId;
      } else if (s && s.ownerId !== undefined) {
        // La navigation suit le dossier du script affiché : « Sortir » y ramène.
        view = 'scripts';
        select(s.ownerId, s.folderId ?? null);
      }
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
    {#if showAir && link.air}
      <NowPlaying
        air={link.air.state}
        {now}
        {timezone}
        timeFormat={link.settings?.timeFormat ?? '24h'}
      />
    {/if}
    <!-- Dans le bandeau : une coupure ne décale pas le texte en cours de lecture. -->
    <div class="spacer" class:compact={showAir}>
      {#if link.state === 'offline'}<div class="offline-line">{t('studio.offline')}</div>{/if}
    </div>
    <div class="link {link.state}" title={link.state}><span class="dot"></span></div>
  </header>

  <div class="body">
    {#if lib}
      <StudioSidebar
        {lib}
        {view}
        ownerId={currentOwner}
        {folderId}
        {collapsed}
        logo={reading ? null : logoUrl(link.settings)}
        onselect={(o, f) => navigate('scripts', () => select(o, f))}
        ontoday={() => navigate('today', () => {})}
        onrundowns={(o) => navigate('rundowns', () => select(o, null))}
        ontoggle={() => (manualCollapse = !collapsed)}
      />
    {/if}

    {#if reading && live && item}
      {@const position = t('studio.itemOf', { n: itemIndex + 1, total: live.items.length })}
      {#if script}
        <Reader
          {script}
          cues={link.settings?.cues ?? []}
          {fontSize}
          deleted={link.prompter?.deleted ?? false}
          canPrev={itemIndex > 0}
          canNext={itemIndex < live.items.length - 1}
          onfont={changeFont}
          onprev={() => stepItem(-1)}
          onnext={() => stepItem(1)}
          onexit={() => void exit()}
          label="{position} · {item.title}"
          exitLabel={t('studio.backToRundown')}
        />
      {:else}
        <ItemCard
          {item}
          {types}
          {position}
          startsAt={secondsToTime(
            rundownSchedule(live.startTime, live.items).starts[itemIndex] ?? 0,
          )}
          canPrev={itemIndex > 0}
          canNext={itemIndex < live.items.length - 1}
          onprev={() => stepItem(-1)}
          onnext={() => stepItem(1)}
          onexit={() => void exit()}
        />
      {/if}
    {:else if reading && script}
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
    {:else if view === 'today' && rundownList}
      <RundownPicker
        title={t('studio.today')}
        rundowns={todayRundowns}
        today={rundownList.today}
        {ownerLabel}
        empty={t('studio.noRundown')}
        onopen={(id) => void openRundown(id)}
      />
    {:else if view === 'rundowns' && rundownList}
      <RundownPicker
        title="{ownerLabel(currentOwner)} · {t('studio.rundowns')}"
        rundowns={ownerRundowns}
        today={rundownList.today}
        empty={t('rundowns.empty')}
        onopen={(id) => void openRundown(id)}
      />
    {:else if view === 'rundown' && shownRundown}
      <RundownView
        rundown={shownRundown}
        {types}
        currentUid={link.prompter?.rundown?.id === shownRundown.id ? link.prompter.itemUid : null}
        onitem={(uid) => void openItem(uid)}
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
  .spacer.compact {
    flex: 0 1 auto;
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
