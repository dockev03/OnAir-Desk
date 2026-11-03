<script lang="ts">
  import {
    AIR_FORCES,
    AUTOMATION_SOURCES,
    CONNECTED_SOURCES,
    ITEM_COLORS,
    LAYOUTS,
    LINER_MAX_LENGTH,
    LINER_ROTATION_MAX,
    LINER_ROTATION_MIN,
    LOCALES,
    LOGO_TYPES,
    MAX_LOGO_BYTES,
    MAX_CUES,
    MAX_ITEM_TAGS,
    MAX_ITEM_TYPES,
    MAX_LINERS,
    MAX_QUICK_ORDERS,
    MAX_FIXED_TIMES,
    FIXED_TIME_LABEL_MAX,
    FIXED_WARN_MAX_MINUTES,
    FIXED_WARN_MIN_MINUTES,
    ALL_DAYS,
    ALL_HOURS,
    MESSAGE_TTL_MAX_MINUTES,
    MESSAGE_TTL_MIN_MINUTES,
    QUICK_ORDER_LABEL_MAX,
    PROMPTER_FONT_MAX,
    PROMPTER_FONT_MIN,
    SPEED_WPM_MAX,
    SIMULATOR_SPEED_MAX,
    SPEED_WPM_MIN,
    STREAM_DELAY_MAX_SECONDS,
    TEXT_COLORS,
    TIME_FORMATS,
    TRACK_ALERT_MAX_SECONDS,
    WEATHER_PROVIDERS,
    formatTemperature,
    sourcesInUse,
    weatherLabel,
    type AirSnapshot,
    type AzuracastTestResult,
    type ConnectorTokenCreated,
    type ConnectorTokenStatus,
    type RadiodjTestResult,
    type Settings,
    type SourceStatus,
    type WeatherTestResult,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { logoUrl, stationSettings } from '$lib/settings.svelte.js';
  import { WEEKDAYS, weekdayName } from '$lib/templates.js';
  import { timezones } from '$lib/timezones.js';

  let settings = $state<Settings | null>(null);
  let error = $state('');
  let saved = $state(false);
  let hasRootCa = $state(false);
  /** État du connecteur d'automation (en marche, erreur…). */
  let air = $state<AirSnapshot | null>(null);

  function loadAir() {
    api<AirSnapshot>('GET', '/api/air')
      .then((a) => (air = a))
      .catch(() => {});
  }

  // ---- RadioDJ : test de la base, jeton du plugin ---------------------------------------

  let tokenStatus = $state<ConnectorTokenStatus | null>(null);
  /** Jeton tout juste généré : affiché une seule fois. */
  let newToken = $state('');
  let tokenError = $state('');
  let testResult = $state<RadiodjTestResult | null>(null);
  let testing = $state(false);

  /** Adresse à recopier dans le plugin : celle du serveur, sur le port dédié aux connecteurs. */
  const pluginUrl = $derived(
    tokenStatus?.httpPort
      ? `http://${location.hostname}:${tokenStatus.httpPort}/api/connectors/radiodj`
      : '',
  );

  function loadToken() {
    api<ConnectorTokenStatus>('GET', '/api/settings/radiodj/token')
      .then((s) => (tokenStatus = s))
      .catch(() => {});
  }

  async function generateToken() {
    if (tokenStatus?.configured && !confirm(t('settings.radiodjTokenConfirm'))) return;
    tokenError = '';
    try {
      const r = await api<ConnectorTokenCreated>('POST', '/api/settings/radiodj/token');
      tokenStatus = r.status;
      newToken = r.token;
    } catch (err) {
      tokenError = errorMessage(errorCode(err));
    }
  }

  // ---- On Air : jeton de l'API, adresses à recopier dans le Stream Deck / la console --------

  let onAirToken = $state<ConnectorTokenStatus | null>(null);
  let newOnAirToken = $state('');
  let onAirTokenError = $state('');
  const onAirBase = $derived(
    onAirToken?.httpPort ? `http://${location.hostname}:${onAirToken.httpPort}/api/onair` : '',
  );

  function loadOnAirToken() {
    api<ConnectorTokenStatus>('GET', '/api/settings/onair/token')
      .then((s) => (onAirToken = s))
      .catch(() => {});
  }

  async function generateOnAirToken() {
    if (onAirToken?.configured && !confirm(t('settings.radiodjTokenConfirm'))) return;
    onAirTokenError = '';
    try {
      const r = await api<ConnectorTokenCreated>('POST', '/api/settings/onair/token');
      onAirToken = r.status;
      newOnAirToken = r.token;
    } catch (err) {
      onAirTokenError = errorMessage(errorCode(err));
    }
  }

  // ---- Météo : bouton « Tester » ----------------------------------------------------------

  let weatherTest = $state<WeatherTestResult | null>(null);
  let weatherTesting = $state(false);

  async function testWeather() {
    if (!settings) return;
    weatherTesting = true;
    weatherTest = null;
    try {
      weatherTest = await api<WeatherTestResult>('POST', '/api/settings/weather/test', {
        weather: settings.weather,
      });
    } catch (err) {
      weatherTest = { ok: false, error: errorCode(err), weather: null };
    } finally {
      weatherTesting = false;
    }
  }

  // ---- Ordres rapides de la régie --------------------------------------------------------

  function addOrder() {
    if (!settings || settings.regie.orders.length >= MAX_QUICK_ORDERS) return;
    settings.regie.orders.push({
      id: cueId(
        'ordre',
        settings.regie.orders.map((o) => o.id),
      ),
      label: '',
      urgent: false,
      active: true,
    });
  }

  // ---- Horaires fixes (étape 11) ---------------------------------------------------------

  function addFixedTime() {
    if (!settings || settings.fixedTimes.length >= MAX_FIXED_TIMES) return;
    settings.fixedTimes.push({
      id: cueId(
        'horaire',
        settings.fixedTimes.map((f) => f.id),
      ),
      label: t('settings.fixedNew'),
      minute: 0,
      hours: [...ALL_HOURS],
      days: [...ALL_DAYS],
      warnMinutes: 5,
      active: true,
    });
  }

  /** Coche / décoche une heure ou un jour ; la liste ne reste jamais vide. */
  function toggle(list: number[], value: number) {
    const i = list.indexOf(value);
    if (i === -1) list.push(value);
    else if (list.length > 1) list.splice(i, 1);
    list.sort((a, b) => a - b);
  }

  // ---- Liners ----------------------------------------------------------------------------

  function addLiner() {
    if (!settings || settings.liners.items.length >= MAX_LINERS) return;
    settings.liners.items.push({
      id: cueId(
        'liner',
        settings.liners.items.map((l) => l.id),
      ),
      text: settings.stationName,
      active: true,
    });
  }

  async function testRadiodj() {
    if (!settings) return;
    testing = true;
    testResult = null;
    try {
      // Accès saisi, même s'il n'est pas encore enregistré.
      testResult = await api<RadiodjTestResult>('POST', '/api/settings/radiodj/test', {
        radiodj: settings.radiodj,
      });
    } catch (err) {
      testResult = { ok: false, error: errorCode(err), songs: null };
    } finally {
      testing = false;
    }
  }

  /** Sources en service (source unique, ou les deux de la bascule). */
  const inUse = $derived(settings ? sourcesInUse(settings) : []);

  // ---- AzuraCast : test de la connexion --------------------------------------------------

  let azTest = $state<AzuracastTestResult | null>(null);
  let azTesting = $state(false);

  async function testAzuracast() {
    if (!settings) return;
    azTesting = true;
    azTest = null;
    try {
      // Accès saisi, même s'il n'est pas encore enregistré.
      azTest = await api<AzuracastTestResult>('POST', '/api/settings/azuracast/test', {
        azuracast: settings.azuracast,
      });
    } catch (err) {
      azTest = {
        ok: false,
        error: errorCode(err),
        auth: null,
        keyConfigured: false,
        stationName: null,
        nowPlaying: null,
        live: null,
      };
    } finally {
      azTesting = false;
    }
  }

  /** Erreur du connecteur : « code: détail technique » → message traduit + détail. */
  function sourceError(raw: string): { text: string; detail: string } {
    const m = /^((?:radiodj|azuracast)_[a-z_]+)(?::\s*(.*))?$/.exec(raw);
    return m ? { text: errorMessage(m[1]!), detail: m[2] ?? '' } : { text: '', detail: raw };
  }

  $effect(() => {
    api<Settings>('GET', '/api/settings')
      .then((s) => (settings = s))
      .catch((e) => (error = errorMessage(errorCode(e))));
    loadAir();
    loadToken();
    loadOnAirToken();
    fetch('/api/tls/root-ca.crt', { method: 'HEAD' })
      .then((r) => (hasRootCa = r.ok))
      .catch(() => {});
  });

  /** Identifiant stable d'un nouveau repère, tiré de son libellé. */
  function cueId(label: string, taken: string[]): string {
    const base =
      label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 28) || 'repere';
    let id = base;
    for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
    return id;
  }

  function addCue() {
    if (!settings || settings.cues.length >= MAX_CUES) return;
    const label = t('editor.cue').toUpperCase();
    settings.cues.push({
      id: cueId(
        label,
        settings.cues.map((c) => c.id),
      ),
      label,
      color: TEXT_COLORS[0],
    });
  }

  function moveCue(i: number, delta: number) {
    if (settings) swap(settings.cues, i, i + delta);
  }

  function swap<T>(list: T[], i: number, j: number) {
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
  }

  const itemColorList = Object.keys(ITEM_COLORS) as (keyof typeof ITEM_COLORS)[];

  function addItemType() {
    if (!settings || settings.itemTypes.length >= MAX_ITEM_TYPES) return;
    // Identifiant interne neutre et stable : le libellé reste modifiable.
    settings.itemTypes.push({
      id: cueId(
        'type',
        settings.itemTypes.map((x) => x.id),
      ),
      label: t('rundowns.newItemTitle'),
      color: itemColorList[0]!,
    });
  }

  function addItemTag() {
    if (!settings || settings.itemTags.length >= MAX_ITEM_TAGS) return;
    settings.itemTags.push({
      id: cueId(
        'tag',
        settings.itemTags.map((x) => x.id),
      ),
      label: t('settings.newTag'),
      color: itemColorList[0]!,
    });
  }

  // ---- Logo : envoyé tout de suite, indépendamment du formulaire -------------------------

  let logoError = $state('');
  let logoBusy = $state(false);

  /** Contenu d'un fichier en base64 (sans l'en-tête « data:… »). */
  function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function logoAction(action: () => Promise<Settings>) {
    logoError = '';
    logoBusy = true;
    try {
      const next = await action();
      stationSettings.set(next);
      if (settings) settings.logoHash = next.logoHash;
    } catch (err) {
      logoError = errorMessage(errorCode(err));
    } finally {
      logoBusy = false;
    }
  }

  async function uploadLogo(e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Vérifications anticipées ; le serveur contrôle le contenu réel du fichier.
    if (file.size > MAX_LOGO_BYTES) return void (logoError = errorMessage('logo_too_large'));
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
      return void (logoError = errorMessage('logo_type'));
    }
    await logoAction(async () =>
      api<Settings>('PUT', '/api/settings/logo', { data: await readBase64(file) }),
    );
  }

  function removeLogo() {
    if (confirm(t('settings.logoRemoveConfirm'))) {
      void logoAction(() => api<Settings>('DELETE', '/api/settings/logo'));
    }
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!settings) return;
    error = '';
    saved = false;
    try {
      settings = await api<Settings>('PUT', '/api/settings', settings);
      stationSettings.set(settings);
      saved = true;
      // Le connecteur redémarre aussitôt : son nouvel état est relu un instant après.
      setTimeout(loadAir, 500);
    } catch (err) {
      error = errorMessage(errorCode(err));
    }
  }
</script>

{#snippet sourceLine(source: SourceStatus)}
  <p class="source-state {source.state}" role="status">
    {t(`automation.${source.id}`)} · {t(`automation.state.${source.state}`)}
    {#if source.updatedAt}
      · {t('settings.automationUpdated', {
        time: new Date(source.updatedAt).toLocaleTimeString(),
      })}
    {/if}
    {#if source.error}
      {@const e = sourceError(source.error)}
      {#if e.text}<br />{e.text}{/if}
      {#if e.detail}<br /><span class="mono">{e.detail}</span>{/if}
    {/if}
  </p>
{/snippet}

<h1>{t('settings.title')}</h1>

{#if settings}
  <section class="card logo-card">
    <h2>{t('settings.logo')}</h2>
    <p class="muted">{t('settings.logoIntro')}</p>
    <div class="row">
      {#if logoUrl(settings)}
        <img class="logo-preview" src={logoUrl(settings)} alt={t('settings.logo')} />
      {:else}
        <span class="muted">{t('settings.noLogo')}</span>
      {/if}
      <label class="file" class:disabled={logoBusy}>
        {logoUrl(settings) ? t('settings.logoReplace') : t('settings.logoUpload')}
        <input
          type="file"
          accept={LOGO_TYPES.join(',')}
          disabled={logoBusy}
          onchange={uploadLogo}
        />
      </label>
      {#if logoUrl(settings)}
        <button class="danger" disabled={logoBusy} onclick={removeLogo}
          >{t('settings.logoRemove')}</button
        >
      {/if}
    </div>
    {#if logoError}<p class="error" role="alert">{logoError}</p>{/if}
  </section>

  <form class="card stack" onsubmit={save}>
    <label>
      {t('field.stationName')}
      <input bind:value={settings.stationName} required maxlength="80" />
    </label>
    <label>
      {t('field.locale')}
      <select bind:value={settings.locale}>
        {#each LOCALES as l (l)}<option value={l}>{t(`locale.${l}`)}</option>{/each}
      </select>
    </label>
    <label>
      {t('field.timezone')}
      <select bind:value={settings.timezone}>
        {#each timezones() as tz (tz)}<option value={tz}>{tz}</option>{/each}
      </select>
    </label>
    <label>
      {t('field.timeFormat')}
      <select bind:value={settings.timeFormat}>
        {#each TIME_FORMATS as f (f)}<option value={f}>{t(`timeFormat.${f}`)}</option>{/each}
      </select>
    </label>

    <h2>{t('settings.automation')}</h2>
    <p class="muted" style="margin: 0">{t('settings.automationIntro')}</p>
    <label>
      {t('settings.airMode')}
      <select bind:value={settings.airSwitch.enabled}>
        <option value={false}>{t('settings.airMode.single')}</option>
        <option value={true}>{t('settings.airMode.switch')}</option>
      </select>
    </label>
    <p class="muted" style="margin: 0">{t('settings.airModeIntro')}</p>
    {#if settings.airSwitch.enabled}
      <div class="grid2">
        <label>
          {t('settings.liveSource')}
          <select bind:value={settings.airSwitch.liveSource}>
            {#each CONNECTED_SOURCES as source (source)}
              <option value={source}>{t(`automation.${source}`)}</option>
            {/each}
          </select>
        </label>
        <label>
          {t('settings.offAirSource')}
          <select bind:value={settings.airSwitch.offAirSource}>
            {#each CONNECTED_SOURCES as source (source)}
              <option value={source}>{t(`automation.${source}`)}</option>
            {/each}
          </select>
        </label>
      </div>
      <label>
        {t('settings.airForce')}
        <select bind:value={settings.airSwitch.force}>
          {#each AIR_FORCES as force (force)}
            <option value={force}>{t(`airForce.${force}`)}</option>
          {/each}
        </select>
      </label>
      <p class="muted" style="margin: 0">
        {settings.airSwitch.offAirSource === 'azuracast'
          ? t('settings.airForceAuto')
          : t('settings.airForceManualOnly')}
      </p>
    {:else}
      <label>
        {t('settings.automationSource')}
        <select bind:value={settings.automationSource}>
          {#each AUTOMATION_SOURCES as source (source)}
            <option value={source}>{t(`automation.${source}`)}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if inUse.includes('simulator')}
      <label>
        {t('settings.simulatorSpeed')}
        <input
          type="number"
          min="1"
          max={SIMULATOR_SPEED_MAX}
          bind:value={settings.simulatorSpeed}
          required
        />
      </label>
    {/if}
    {#if air?.state.live}
      {@const live = air.state.live}
      <p class="source-state ok" role="status" data-testid="air-side">
        {t('settings.airState', {
          side: t(live.active ? 'settings.airSide.live' : 'settings.airSide.offair'),
          source: t(`automation.${air.state.source.id}`),
        })}{live.forced ? ` · ${t('settings.airForced')}` : ''}
      </p>
      {@render sourceLine(live.liveSource)}
      {@render sourceLine(live.offAirSource)}
    {:else if air && air.state.source.id !== 'none'}
      {@render sourceLine(air.state.source)}
    {/if}

    {#if inUse.includes('radiodj')}
      <h3>{t('settings.radiodj')}</h3>
      <p class="muted" style="margin: 0">{t('settings.radiodjIntro')}</p>
      <div class="grid2">
        <label>
          {t('settings.radiodjHost')}
          <input bind:value={settings.radiodj.host} maxlength="253" placeholder="192.168.1.30" />
        </label>
        <label>
          {t('settings.radiodjPort')}
          <input type="number" min="1" max="65535" bind:value={settings.radiodj.port} required />
        </label>
        <label>
          {t('settings.radiodjDatabase')}
          <input bind:value={settings.radiodj.database} required maxlength="64" />
        </label>
        <label>
          {t('settings.radiodjUser')}
          <input bind:value={settings.radiodj.user} required maxlength="80" />
        </label>
      </div>
      <div class="row">
        <button type="button" onclick={testRadiodj} disabled={testing}
          >{t('settings.radiodjTest')}</button
        >
        {#if testResult}
          <span class="test-result" class:ok={testResult.ok} role="status">
            {testResult.ok
              ? t('settings.radiodjTestOk', { n: testResult.songs ?? 0 })
              : errorMessage(testResult.error ?? 'radiodj_error')}
          </span>
        {/if}
      </div>

      <h3>{t('settings.radiodjPlugin')}</h3>
      <p class="muted" style="margin: 0">{t('settings.radiodjPluginIntro')}</p>
      {#if tokenStatus}
        {#if !tokenStatus.httpPort}
          <p class="warn-text">{t('settings.radiodjPortClosed')}</p>
        {:else}
          <p class="muted" style="margin: 0">{t('settings.radiodjSetup', { url: pluginUrl })}</p>
        {/if}
        <p style="margin: 0">
          {tokenStatus.createdAt
            ? t('settings.radiodjTokenSince', {
                date: new Date(tokenStatus.createdAt).toLocaleString(),
              })
            : t('settings.radiodjTokenNone')}
        </p>
        {#if newToken}
          <p class="warn-text" style="margin: 0">{t('settings.radiodjTokenShown')}</p>
          <code class="token">{newToken}</code>
        {/if}
        <div>
          <button type="button" onclick={generateToken}
            >{tokenStatus.configured
              ? t('settings.radiodjTokenRegenerate')
              : t('settings.radiodjTokenGenerate')}</button
          >
        </div>
        {#if tokenError}<p class="error" role="alert">{tokenError}</p>{/if}
      {/if}
    {/if}

    {#if inUse.includes('azuracast')}
      <h3>{t('settings.azuracast')}</h3>
      <p class="muted" style="margin: 0">{t('settings.azuracastIntro')}</p>
      <div class="grid2">
        <label>
          {t('settings.azuracastUrl')}
          <input
            type="url"
            bind:value={settings.azuracast.url}
            maxlength="200"
            placeholder="https://radio.example.org"
            pattern="https://.*"
          />
        </label>
        <label>
          {t('settings.azuracastStation')}
          <input
            bind:value={settings.azuracast.station}
            maxlength="64"
            pattern="[A-Za-z0-9_\-]*"
            placeholder="ma_radio"
          />
        </label>
        <label>
          {t('settings.azuracastDelay')}
          <input
            type="number"
            min={-STREAM_DELAY_MAX_SECONDS}
            max={STREAM_DELAY_MAX_SECONDS}
            bind:value={settings.azuracast.streamDelaySeconds}
            required
          />
          <span class="muted small">{t('settings.azuracastDelayHelp')}</span>
        </label>
      </div>
      <div class="row">
        <button type="button" onclick={testAzuracast} disabled={azTesting}
          >{t('settings.azuracastTest')}</button
        >
        {#if azTest}
          <span class="test-result" class:ok={azTest.ok} role="status">
            {azTest.ok
              ? t('settings.azuracastTestOk', { station: azTest.stationName ?? '' })
              : errorMessage(azTest.error ?? 'azuracast_error')}
            {#if azTest.nowPlaying}<br />{t('settings.azuracastTestNow', {
                title: azTest.nowPlaying,
              })}{/if}
            {#if azTest.live}<br />{t('settings.azuracastTestLive')}{/if}
            {#if azTest.auth}<br />{t(`settings.azuracastAuth.${azTest.auth}`)}{/if}
          </span>
        {/if}
      </div>
    {/if}

    <h2>{t('settings.display')}</h2>
    <label>
      {t('settings.defaultLayout')}
      <select bind:value={settings.defaultLayout}>
        {#each LAYOUTS as layout (layout)}
          <option value={layout}>{t(`layout.${layout}`)}</option>
        {/each}
      </select>
      <span class="muted small">{t('settings.defaultLayoutHelp')}</span>
    </label>
    <label class="inline">
      <input type="checkbox" bind:checked={settings.burnInProtection} />
      {t('settings.burnIn')}
    </label>
    <p class="muted small" style="margin: 0">{t('settings.burnInHelp')}</p>

    <h2>{t('settings.onAir')}</h2>
    <p class="muted" style="margin: 0">{t('settings.onAirIntro')}</p>
    <label class="inline">
      <input type="checkbox" bind:checked={settings.onAirKiosk} />
      {t('settings.onAirKiosk')}
    </label>
    <h3>{t('settings.onAirToken')}</h3>
    {#if onAirToken}
      {#if !onAirToken.httpPort}
        <p class="warn-text">{t('settings.onAirPortClosed')}</p>
      {:else}
        <p class="muted" style="margin: 0">{t('settings.onAirExamples')}</p>
        <code class="token small">POST {onAirBase} {'{"state":"toggle"}'}</code>
        <code class="token small">GET {onAirBase}</code>
      {/if}
      <p style="margin: 0">
        {onAirToken.createdAt
          ? t('settings.radiodjTokenSince', {
              date: new Date(onAirToken.createdAt).toLocaleString(),
            })
          : t('settings.radiodjTokenNone')}
      </p>
      {#if newOnAirToken}
        <p class="warn-text" style="margin: 0">{t('settings.radiodjTokenShown')}</p>
        <code class="token">{newOnAirToken}</code>
      {/if}
      <div>
        <button type="button" onclick={generateOnAirToken}
          >{onAirToken.configured
            ? t('settings.radiodjTokenRegenerate')
            : t('settings.radiodjTokenGenerate')}</button
        >
      </div>
      {#if onAirTokenError}<p class="error" role="alert">{onAirTokenError}</p>{/if}
    {/if}
    <label class="inline">
      <input type="checkbox" bind:checked={settings.onAirSimpleCall} />
      {t('settings.onAirSimpleCall')}
    </label>
    <p class="muted small" style="margin: 0">{t('settings.onAirSimpleCallHelp')}</p>
    {#if settings.onAirSimpleCall && onAirBase}
      <code class="token small">GET {onAirBase}/toggle?token=…</code>
    {/if}

    <h2>{t('settings.weather')}</h2>
    <p class="muted" style="margin: 0">{t('settings.weatherIntro')}</p>
    <label>
      {t('settings.weatherProvider')}
      <select bind:value={settings.weather.provider}>
        {#each WEATHER_PROVIDERS as p (p)}<option value={p}>{t(`weatherProvider.${p}`)}</option
          >{/each}
      </select>
    </label>
    {#if settings.weather.provider !== 'none'}
      <div class="grid2">
        <label>
          {t('settings.weatherCity')}
          <input bind:value={settings.weather.city} maxlength="80" required />
        </label>
        <label>
          {t('settings.weatherLatitude')}
          <input
            type="number"
            min="-90"
            max="90"
            step="0.0001"
            bind:value={settings.weather.latitude}
            required
          />
        </label>
        <label>
          {t('settings.weatherLongitude')}
          <input
            type="number"
            min="-180"
            max="180"
            step="0.0001"
            bind:value={settings.weather.longitude}
            required
          />
        </label>
      </div>
      <div class="row">
        <button type="button" onclick={testWeather} disabled={weatherTesting}
          >{t('settings.weatherTest')}</button
        >
        {#if weatherTest}
          <span class="test-result" class:ok={weatherTest.ok} role="status">
            {weatherTest.ok && weatherTest.weather
              ? t('settings.weatherTestOk', {
                  city: weatherTest.weather.city,
                  temperature: formatTemperature(weatherTest.weather.temperature),
                  label: t(`weather.${weatherLabel(weatherTest.weather.code)}`),
                })
              : errorMessage(weatherTest.error ?? 'weather_error')}
          </span>
        {/if}
      </div>
      {#if settings.weather.provider === 'openmeteo'}
        <p class="muted small" style="margin: 0">
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer"
            >{t('weather.attribution')}</a
          >
        </p>
      {/if}
    {/if}

    <h2>{t('settings.liners')}</h2>
    <p class="muted" style="margin: 0">{t('settings.linersIntro')}</p>
    <div class="cues">
      {#each settings.liners.items as liner, i (liner.id)}
        <div class="liner-row">
          <input
            aria-label={t('settings.linerText')}
            bind:value={liner.text}
            required
            maxlength={LINER_MAX_LENGTH}
          />
          <label class="inline">
            <input type="checkbox" bind:checked={liner.active} />
            {t('settings.linerActive')}
          </label>
          <div class="row">
            <button
              type="button"
              aria-label={t('settings.moveUp')}
              disabled={i === 0}
              onclick={() => swap(settings!.liners.items, i, i - 1)}>↑</button
            >
            <button
              type="button"
              aria-label={t('settings.moveDown')}
              disabled={i === settings.liners.items.length - 1}
              onclick={() => swap(settings!.liners.items, i, i + 1)}>↓</button
            >
            <button type="button" class="danger" onclick={() => settings!.liners.items.splice(i, 1)}
              >{t('settings.removeCue')}</button
            >
          </div>
        </div>
      {/each}
    </div>
    <div>
      <button type="button" onclick={addLiner} disabled={settings.liners.items.length >= MAX_LINERS}
        >{t('settings.addLiner')}</button
      >
    </div>
    <label>
      {t('settings.linersRotation')}
      <input
        type="number"
        min={LINER_ROTATION_MIN}
        max={LINER_ROTATION_MAX}
        bind:value={settings.liners.rotationSeconds}
        required
      />
    </label>

    <h2>{t('settings.regie')}</h2>
    <p class="muted" style="margin: 0">{t('settings.regieIntro')}</p>
    <label>
      {t('settings.regieTtl')}
      <input
        type="number"
        min={MESSAGE_TTL_MIN_MINUTES}
        max={MESSAGE_TTL_MAX_MINUTES}
        bind:value={settings.regie.messageTtlMinutes}
        required
      />
    </label>
    <label class="inline">
      <input type="checkbox" bind:checked={settings.regie.kioskSeen} />
      {t('settings.regieKioskSeen')}
    </label>
    <h3>{t('settings.regieOrders')}</h3>
    <div class="cues">
      {#each settings.regie.orders as order, i (order.id)}
        <div class="liner-row">
          <input
            aria-label={t('settings.regieOrderLabel')}
            bind:value={order.label}
            required
            maxlength={QUICK_ORDER_LABEL_MAX}
          />
          <label class="inline">
            <input type="checkbox" bind:checked={order.urgent} />
            {t('regie.urgent')}
          </label>
          <label class="inline">
            <input type="checkbox" bind:checked={order.active} />
            {t('settings.linerActive')}
          </label>
          <div class="row">
            <button
              type="button"
              aria-label={t('settings.moveUp')}
              disabled={i === 0}
              onclick={() => swap(settings!.regie.orders, i, i - 1)}>↑</button
            >
            <button
              type="button"
              aria-label={t('settings.moveDown')}
              disabled={i === settings.regie.orders.length - 1}
              onclick={() => swap(settings!.regie.orders, i, i + 1)}>↓</button
            >
            <button type="button" class="danger" onclick={() => settings!.regie.orders.splice(i, 1)}
              >{t('settings.removeCue')}</button
            >
          </div>
        </div>
      {/each}
    </div>
    <div>
      <button
        type="button"
        onclick={addOrder}
        disabled={settings.regie.orders.length >= MAX_QUICK_ORDERS}
        >{t('settings.regieAddOrder')}</button
      >
    </div>

    <h2>{t('settings.trackAlert')}</h2>
    <p class="muted" style="margin: 0">{t('settings.trackAlertIntro')}</p>
    <div class="grid2">
      <label>
        {t('settings.trackAlertSoon')}
        <input
          type="number"
          min="2"
          max={TRACK_ALERT_MAX_SECONDS}
          bind:value={settings.trackAlert.soonSeconds}
          required
        />
      </label>
      <label>
        {t('settings.trackAlertNow')}
        <input
          type="number"
          min="1"
          max={settings.trackAlert.soonSeconds - 1}
          bind:value={settings.trackAlert.nowSeconds}
          required
        />
      </label>
    </div>

    <h2>{t('settings.fixedTimes')}</h2>
    <p class="muted" style="margin: 0">{t('settings.fixedTimesHint')}</p>
    <div class="cues" data-testid="fixed-times">
      {#each settings.fixedTimes as f, i (f.id)}
        <fieldset class="fixed-row">
          <div class="fixed-head">
            <input
              aria-label={t('settings.fixedLabel')}
              bind:value={f.label}
              required
              maxlength={FIXED_TIME_LABEL_MAX}
            />
            <label class="inline">
              {t('settings.fixedMinute')}
              <input type="number" min="0" max="59" bind:value={f.minute} required />
            </label>
            <label class="inline">
              {t('settings.fixedWarn')}
              <input
                type="number"
                min={FIXED_WARN_MIN_MINUTES}
                max={FIXED_WARN_MAX_MINUTES}
                bind:value={f.warnMinutes}
                required
              />
            </label>
            <label class="inline">
              <input type="checkbox" bind:checked={f.active} />
              {t('settings.fixedActive')}
            </label>
            <button type="button" class="danger" onclick={() => settings!.fixedTimes.splice(i, 1)}
              >{t('settings.fixedRemove')}</button
            >
          </div>
          <div class="chips" aria-label={t('settings.fixedHours')}>
            <span class="muted">{t('settings.fixedHours')}</span>
            <button
              type="button"
              class="chip"
              class:on={f.hours.length === 24}
              onclick={() => (f.hours = [...ALL_HOURS])}>{t('settings.fixedAllHours')}</button
            >
            {#each ALL_HOURS as h (h)}
              <button
                type="button"
                class="chip mono"
                class:on={f.hours.includes(h)}
                aria-pressed={f.hours.includes(h)}
                onclick={() => toggle(f.hours, h)}>{String(h).padStart(2, '0')}</button
              >
            {/each}
          </div>
          <div class="chips" aria-label={t('settings.fixedDays')}>
            <span class="muted">{t('settings.fixedDays')}</span>
            {#each WEEKDAYS as d (d)}
              <button
                type="button"
                class="chip"
                class:on={f.days.includes(d)}
                aria-pressed={f.days.includes(d)}
                onclick={() => toggle(f.days, d)}>{weekdayName(d, i18n.locale)}</button
              >
            {/each}
          </div>
        </fieldset>
      {/each}
    </div>
    <div>
      <button
        type="button"
        onclick={addFixedTime}
        disabled={settings.fixedTimes.length >= MAX_FIXED_TIMES}>{t('settings.fixedAdd')}</button
      >
    </div>

    <h2>{t('settings.timeTracking')}</h2>
    <p class="muted" style="margin: 0">{t('settings.timeTrackingHint')}</p>
    <div class="grid2">
      <label>
        {t('settings.driftSoon')}
        <input
          type="number"
          min="5"
          max="600"
          bind:value={settings.timeTracking.driftSoonSeconds}
          required
        />
      </label>
      <label>
        {t('settings.driftNow')}
        <input
          type="number"
          min={settings.timeTracking.driftSoonSeconds + 1}
          max="1800"
          bind:value={settings.timeTracking.driftNowSeconds}
          required
        />
      </label>
      <label>
        {t('settings.onTime')}
        <input
          type="number"
          min="0"
          max="60"
          bind:value={settings.timeTracking.onTimeSeconds}
          required
        />
      </label>
      <label>
        {t('settings.sequenceSoon')}
        <input
          type="number"
          min="1"
          max="120"
          bind:value={settings.timeTracking.sequenceSoonSeconds}
          required
        />
      </label>
      <label>
        {t('settings.endSoon')}
        <input
          type="number"
          min="2"
          max="60"
          bind:value={settings.timeTracking.endSoonMinutes}
          required
        />
      </label>
      <label>
        {t('settings.endNow')}
        <input
          type="number"
          min="1"
          max={settings.timeTracking.endSoonMinutes - 1}
          bind:value={settings.timeTracking.endNowMinutes}
          required
        />
      </label>
    </div>
    <label class="inline">
      <input type="checkbox" bind:checked={settings.timeTracking.kioskRehearsal} />
      {t('settings.kioskRehearsal')}
    </label>

    <h2>{t('settings.scripts')}</h2>
    <label>
      {t('settings.defaultSpeed')}
      <input
        type="number"
        min={SPEED_WPM_MIN}
        max={SPEED_WPM_MAX}
        step="5"
        bind:value={settings.defaultSpeedWpm}
        required
      />
    </label>
    <label>
      {t('settings.fontSize')}
      <input
        type="number"
        min={PROMPTER_FONT_MIN}
        max={PROMPTER_FONT_MAX}
        bind:value={settings.prompterFontSize}
        required
      />
    </label>

    <h2>{t('settings.cues')}</h2>
    <p class="muted" style="margin: 0">{t('settings.cuesIntro')}</p>
    <div class="cues">
      {#each settings.cues as cue, i (cue.id)}
        <div class="cue-row">
          <span class="preview" style:color={cue.color}>[{cue.label}]</span>
          <input
            aria-label={t('settings.cueLabel')}
            bind:value={cue.label}
            required
            maxlength="40"
          />
          <div class="row colors" role="radiogroup" aria-label={t('settings.cueColor')}>
            {#each TEXT_COLORS as c (c)}
              <button
                type="button"
                class="swatch"
                class:on={cue.color === c}
                style:background-color={c}
                role="radio"
                aria-checked={cue.color === c}
                aria-label={c}
                onclick={() => (cue.color = c)}
              ></button>
            {/each}
          </div>
          <div class="row">
            <button
              type="button"
              aria-label={t('settings.moveUp')}
              disabled={i === 0}
              onclick={() => moveCue(i, -1)}>↑</button
            >
            <button
              type="button"
              aria-label={t('settings.moveDown')}
              disabled={i === settings.cues.length - 1}
              onclick={() => moveCue(i, 1)}>↓</button
            >
            <button type="button" class="danger" onclick={() => settings!.cues.splice(i, 1)}
              >{t('settings.removeCue')}</button
            >
          </div>
        </div>
      {/each}
    </div>
    <div>
      <button type="button" onclick={addCue} disabled={settings.cues.length >= MAX_CUES}
        >{t('settings.addCue')}</button
      >
    </div>

    <h2>{t('settings.itemTypes')}</h2>
    <p class="muted" style="margin: 0">{t('settings.itemTypesIntro')}</p>
    <div class="cues">
      {#each settings.itemTypes as type, i (type.id)}
        <div class="cue-row">
          <span
            class="preview type-preview"
            style:background-color={type.color}
            style:color={ITEM_COLORS[type.color]}>{type.label}</span
          >
          <input
            aria-label={t('settings.typeLabel')}
            bind:value={type.label}
            required
            maxlength="40"
          />
          <div class="row colors" role="radiogroup" aria-label={t('settings.cueColor')}>
            {#each itemColorList as c (c)}
              <button
                type="button"
                class="swatch"
                class:on={type.color === c}
                style:background-color={c}
                role="radio"
                aria-checked={type.color === c}
                aria-label={c}
                onclick={() => (type.color = c)}
              ></button>
            {/each}
          </div>
          <div class="row">
            <button
              type="button"
              aria-label={t('settings.moveUp')}
              disabled={i === 0}
              onclick={() => swap(settings!.itemTypes, i, i - 1)}>↑</button
            >
            <button
              type="button"
              aria-label={t('settings.moveDown')}
              disabled={i === settings.itemTypes.length - 1}
              onclick={() => swap(settings!.itemTypes, i, i + 1)}>↓</button
            >
            <button
              type="button"
              class="danger"
              disabled={settings.itemTypes.length <= 1}
              onclick={() => settings!.itemTypes.splice(i, 1)}>{t('settings.removeCue')}</button
            >
          </div>
        </div>
      {/each}
    </div>
    <div>
      <button
        type="button"
        onclick={addItemType}
        disabled={settings.itemTypes.length >= MAX_ITEM_TYPES}>{t('settings.addItemType')}</button
      >
    </div>

    <h2>{t('settings.itemTags')}</h2>
    <p class="muted" style="margin: 0">{t('settings.itemTagsIntro')}</p>
    <div class="cues">
      {#each settings.itemTags as tag, i (tag.id)}
        <div class="cue-row">
          <span
            class="preview type-preview"
            style:background-color={tag.color}
            style:color={ITEM_COLORS[tag.color]}>{tag.label}</span
          >
          <input
            aria-label={t('settings.tagLabel')}
            bind:value={tag.label}
            required
            maxlength="40"
          />
          <div class="row colors" role="radiogroup" aria-label={t('settings.cueColor')}>
            {#each itemColorList as c (c)}
              <button
                type="button"
                class="swatch"
                class:on={tag.color === c}
                style:background-color={c}
                role="radio"
                aria-checked={tag.color === c}
                aria-label={c}
                onclick={() => (tag.color = c)}
              ></button>
            {/each}
          </div>
          <div class="row">
            <button
              type="button"
              aria-label={t('settings.moveUp')}
              disabled={i === 0}
              onclick={() => swap(settings!.itemTags, i, i - 1)}>↑</button
            >
            <button
              type="button"
              aria-label={t('settings.moveDown')}
              disabled={i === settings.itemTags.length - 1}
              onclick={() => swap(settings!.itemTags, i, i + 1)}>↓</button
            >
            <button type="button" class="danger" onclick={() => settings!.itemTags.splice(i, 1)}
              >{t('settings.removeCue')}</button
            >
          </div>
        </div>
      {/each}
    </div>
    <div>
      <button
        type="button"
        onclick={addItemTag}
        disabled={settings.itemTags.length >= MAX_ITEM_TAGS}>{t('settings.addItemTag')}</button
      >
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if saved}<p class="success">{t('common.saved')}</p>{/if}
    <div><button class="primary">{t('common.save')}</button></div>
  </form>
{:else if error}
  <p class="error">{error}</p>
{/if}

{#if hasRootCa}
  <h2>{t('settings.tls')}</h2>
  <p class="muted">{t('settings.tlsText')}</p>
  <a href="/api/tls/root-ca.crt" download>{t('setup.downloadCa')}</a>
{/if}

<style>
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.75rem;
  }
  .test-result {
    color: #f7c1c1;
  }
  .small {
    font-size: 0.85rem;
  }
  .test-result.ok {
    color: var(--ok);
  }
  .warn-text {
    color: var(--warn);
    margin: 0;
  }
  .token {
    display: block;
    user-select: all;
    word-break: break-all;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 1.05rem;
  }
  .source-state {
    margin: 0;
    color: var(--muted);
  }
  .source-state.ok {
    color: var(--ok);
  }
  .source-state.error {
    color: #f7c1c1;
  }
  .logo-card {
    margin-bottom: 1rem;
  }
  .logo-card h2 {
    margin-top: 0;
  }
  .logo-preview {
    max-height: 64px;
    max-width: 200px;
    object-fit: contain;
    background: var(--surface-2);
    border-radius: 6px;
    padding: 4px;
  }
  /* Bouton d'envoi de fichier : le champ natif est masqué, le libellé sert de bouton. */
  .file {
    position: relative;
    display: inline-block;
    color: var(--text);
    font-size: inherit;
    cursor: pointer;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    padding: 0.5rem 0.9rem;
  }
  .file.disabled {
    opacity: 0.55;
  }
  .file input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .file:focus-within {
    outline: 2px solid #85b7eb;
  }
  .cues {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .fixed-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem;
    margin: 0;
  }
  .fixed-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }
  .fixed-head input[type='number'] {
    width: 4.5rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
  }
  .chip {
    padding: 0.15rem 0.45rem;
    font-size: 0.85rem;
    opacity: 0.55;
  }
  .chip.on {
    opacity: 1;
    border-color: #85b7eb;
  }
  .liner-row {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) auto auto;
    gap: 0.5rem;
    align-items: center;
  }
  .cue-row {
    display: grid;
    grid-template-columns: 9rem minmax(8rem, 1fr) auto auto;
    gap: 0.5rem;
    align-items: center;
  }
  @media (max-width: 720px) {
    .liner-row,
    .cue-row {
      grid-template-columns: 1fr;
    }
  }
  .preview {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .colors {
    gap: 0.25rem;
  }
  .swatch {
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border-radius: 50%;
  }
  .type-preview {
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
  }
  .swatch.on {
    outline: 2px solid #fff;
    outline-offset: 1px;
  }
</style>
