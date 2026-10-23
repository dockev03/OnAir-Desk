<script lang="ts">
  import {
    ITEM_COLORS,
    LOCALES,
    LOGO_TYPES,
    MAX_LOGO_BYTES,
    MAX_CUES,
    MAX_ITEM_TYPES,
    PROMPTER_FONT_MAX,
    PROMPTER_FONT_MIN,
    SPEED_WPM_MAX,
    SPEED_WPM_MIN,
    TEXT_COLORS,
    TIME_FORMATS,
    type Settings,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';
  import { logoUrl, stationSettings } from '$lib/settings.svelte.js';
  import { timezones } from '$lib/timezones.js';

  let settings = $state<Settings | null>(null);
  let error = $state('');
  let saved = $state(false);
  let hasRootCa = $state(false);

  $effect(() => {
    api<Settings>('GET', '/api/settings')
      .then((s) => (settings = s))
      .catch((e) => (error = errorMessage(errorCode(e))));
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
    } catch (err) {
      error = errorMessage(errorCode(err));
    }
  }
</script>

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
  .cue-row {
    display: grid;
    grid-template-columns: 9rem minmax(8rem, 1fr) auto auto;
    gap: 0.5rem;
    align-items: center;
  }
  @media (max-width: 720px) {
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
