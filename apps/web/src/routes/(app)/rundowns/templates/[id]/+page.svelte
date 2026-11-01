<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    LAYOUTS,
    MAX_CREATE_DAYS,
    MAX_TEMPLATE_EXCLUSIONS,
    daysBetween,
    formatDuration,
    rundownSchedule,
    secondsToTime,
    templateDates,
    type CreateFromTemplateResult,
    type Layout,
    type Library,
    type RundownList,
    type Template,
    type TemplateExclusion,
  } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, i18n, t } from '$lib/i18n/index.svelte.js';
  import { ownerKey, ownerName } from '$lib/library.js';
  import { Autosave, type SaveStatus } from '$lib/rundown-editor/autosave.svelte.js';
  import ItemsEditor from '$lib/rundown-editor/ItemsEditor.svelte';
  import { toEdit, toInput, type EditItem } from '$lib/rundown-editor/items.js';
  import { formatAirDate, shortTime } from '$lib/rundowns.js';
  import { session } from '$lib/session.svelte.js';
  import { stationSettings } from '$lib/settings.svelte.js';
  import { WEEKDAYS, formatDays, nextWeek, weekdayName } from '$lib/templates.js';

  const id = $derived(Number(page.params.id));

  let template = $state<Template | null>(null);
  let lib = $state<Library | null>(null);
  let today = $state('');
  let error = $state('');
  let notice = $state('');

  let title = $state('');
  let startTime = $state('07:00:00');
  let days = $state<number[]>([]);
  let validFrom = $state('');
  let validUntil = $state('');
  let active = $state(true);
  /** Disposition de l'écran studio, copiée dans les conducteurs créés. */
  let layout = $state<Layout | null>(null);
  let exclusions = $state<TemplateExclusion[]>([]);
  let items = $state<EditItem[]>([]);
  let version = 0;

  const types = $derived(stationSettings.value?.itemTypes ?? []);
  const canWrite = $derived(template?.canWrite ?? false);
  const schedule = $derived(rundownSchedule(startTime, items));

  function apply(x: Template) {
    template = x;
    title = x.title;
    startTime = x.startTime;
    days = [...x.days];
    validFrom = x.validFrom ?? '';
    validUntil = x.validUntil ?? '';
    active = x.active;
    layout = x.layout;
    exclusions = x.exclusions.map((e) => ({ ...e }));
    items = x.items.map(toEdit);
    version = x.version;
  }

  async function load() {
    const [x, l, list] = await Promise.all([
      api<Template>('GET', `/api/templates/${id}`),
      api<Library>('GET', '/api/library'),
      api<RundownList>('GET', '/api/rundowns'),
      stationSettings.load(),
    ]);
    lib = l;
    today = list.today;
    ({ from: periodFrom, to: periodTo } = nextWeek(today));
    apply(x);
  }

  $effect(() => {
    void id;
    load().catch((e) => (error = errorMessage(errorCode(e))));
  });

  // ---- Enregistrement automatique ------------------------------------------------------

  const autosave = new Autosave(
    async () => {
      const x = await api<Template>('PATCH', `/api/templates/${template!.id}`, {
        version,
        title: title.trim() || template!.title,
        startTime,
        days,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        active,
        layout,
        exclusions,
        items: items.map(toInput),
      });
      version = x.version;
      template = x;
      for (const item of items) {
        item.script = x.items.find((i) => i.uid === item.uid)?.script ?? item.script;
      }
    },
    () => canWrite && template !== null,
    (code) => (error = errorMessage(code)),
  );
  function changed() {
    error = '';
    autosave.changed();
  }

  async function reloadLatest() {
    apply(await api<Template>('GET', `/api/templates/${id}`));
    autosave.reset();
  }

  async function keepMine() {
    version = (await api<Template>('GET', `/api/templates/${id}`)).version;
    await autosave.force();
  }

  beforeNavigate(() => {
    if (autosave.dirty) void autosave.save();
  });
  $effect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (autosave.dirty) e.preventDefault();
    };
    addEventListener('beforeunload', warn);
    return () => {
      removeEventListener('beforeunload', warn);
      autosave.dispose();
    };
  });

  // ---- Jours et exclusions ----------------------------------------------------------------

  function toggleDay(day: number, on: boolean) {
    days = on ? [...days, day].sort() : days.filter((d) => d !== day);
    changed();
  }

  let exFrom = $state('');
  let exTo = $state('');
  let exLabel = $state('');

  function addExclusion(e: SubmitEvent) {
    e.preventDefault();
    if (!exFrom || exclusions.length >= MAX_TEMPLATE_EXCLUSIONS) return;
    const to = exTo && exTo >= exFrom ? exTo : exFrom;
    exclusions.push({ from: exFrom, to, label: exLabel.trim() });
    exclusions.sort((a, b) => a.from.localeCompare(b.from));
    exFrom = exTo = exLabel = '';
    changed();
  }

  function removeExclusion(i: number) {
    exclusions.splice(i, 1);
    changed();
  }

  const exclusionText = (e: TemplateExclusion) =>
    e.from === e.to
      ? formatAirDate(e.from, i18n.locale)
      : t('templates.range', {
          from: formatAirDate(e.from, i18n.locale),
          to: formatAirDate(e.to, i18n.locale),
        });

  // ---- Création des conducteurs ---------------------------------------------------------

  let periodFrom = $state('');
  let periodTo = $state('');
  let result = $state<CreateFromTemplateResult | null>(null);
  let creating = $state(false);

  const periodError = $derived(
    !periodFrom || !periodTo || periodTo < periodFrom
      ? t('templates.periodInvalid')
      : daysBetween(periodFrom, periodTo) >= MAX_CREATE_DAYS
        ? t('templates.periodTooLong')
        : '',
  );
  /** Aperçu calculé sur place (la même fonction que le serveur). */
  const preview = $derived(
    periodError
      ? null
      : templateDates(
          { days, validFrom: validFrom || null, validUntil: validUntil || null, exclusions },
          periodFrom,
          periodTo,
        ),
  );

  async function createRundowns() {
    if (!template || periodError) return;
    error = notice = '';
    result = null;
    creating = true;
    try {
      // Le modèle tel qu'affiché d'abord : les conducteurs suivent la dernière saisie.
      if (!(await autosave.save()) && autosave.dirty) return;
      result = await api<CreateFromTemplateResult>(
        'POST',
        `/api/templates/${template.id}/create-rundowns`,
        { from: periodFrom, to: periodTo },
      );
    } catch (e) {
      error = errorMessage(errorCode(e));
    } finally {
      creating = false;
    }
  }

  async function duplicateToMe() {
    if (!template || !session.user) return;
    try {
      const copy = await api<Template>('POST', `/api/templates/${template.id}/duplicate`, {
        ownerId: session.user.id,
      });
      await goto(`/rundowns/templates/${copy.id}`);
    } catch (e) {
      error = errorMessage(errorCode(e));
    }
  }

  const statusText: Record<SaveStatus, string> = $derived({
    saved: t('editor.saved'),
    pending: t('editor.unsaved'),
    saving: t('editor.saving'),
    offline: t('editor.offline'),
    conflict: t('templates.conflict'),
  });

  const reasonText = (reason: 'excluded' | 'outside') =>
    reason === 'excluded' ? t('templates.skippedExcluded') : t('templates.skippedOutside');
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if template && lib}
  <div class="row top">
    <a href="/rundowns?owner={ownerKey(template.ownerId)}">← {t('rundowns.back')}</a>
    <span class="spacer"></span>
    {#if canWrite}
      <span class="status {autosave.status}" role="status">{statusText[autosave.status]}</span>
    {:else}
      <button onclick={duplicateToMe}>{t('library.duplicate')}</button>
    {/if}
  </div>

  {#if notice}<p class="success">{notice}</p>{/if}

  {#if autosave.status === 'conflict'}
    <div class="notice">
      <p>{t('rundowns.conflictText')}</p>
      <div class="row">
        <button onclick={reloadLatest}>{t('editor.reload')}</button>
        <button onclick={keepMine}>{t('editor.keepMine')}</button>
      </div>
    </div>
  {/if}

  <p class="muted kind">{t('templates.kind')}</p>

  {#if canWrite}
    <div class="meta">
      <label class="grow">
        {t('rundowns.field.title')}
        <input bind:value={title} maxlength="120" oninput={changed} />
      </label>
      <label>
        {t('rundowns.field.startTime')}
        <input type="time" step="1" bind:value={startTime} required onchange={changed} />
      </label>
      <label>
        {t('field.layout')}
        <select bind:value={layout} onchange={changed}>
          <option value={null}>{t('layout.default')}</option>
          {#each LAYOUTS as l (l)}<option value={l}>{t(`layout.${l}`)}</option>{/each}
        </select>
      </label>
    </div>

    <fieldset class="days">
      <legend>{t('templates.days')}</legend>
      {#each WEEKDAYS as day (day)}
        <label class="inline day">
          <input
            type="checkbox"
            checked={days.includes(day)}
            disabled={days.length === 1 && days.includes(day)}
            onchange={(e) => toggleDay(day, e.currentTarget.checked)}
          />
          {weekdayName(day, i18n.locale)}
        </label>
      {/each}
    </fieldset>

    <div class="meta">
      <label>
        {t('templates.validFrom')}
        <input type="date" bind:value={validFrom} onchange={changed} />
      </label>
      <label>
        {t('templates.validUntil')}
        <input type="date" bind:value={validUntil} onchange={changed} />
      </label>
      <label class="inline active">
        <input type="checkbox" bind:checked={active} onchange={changed} />
        {t('templates.active')}
      </label>
    </div>
    <p class="muted small">{t('templates.validHint')}</p>
  {:else}
    <h1>{template.title}</h1>
    <p class="notice">{t('templates.readOnly')}</p>
    <p class="muted">
      {t('templates.meta', {
        days: formatDays(template.days, i18n.locale),
        time: shortTime(template.startTime),
        n: template.itemCount,
        duration: formatDuration(template.totalSeconds),
      })}
      · {ownerName(lib.owners.find((o) => o.id === template!.ownerId) ?? { id: null, name: '' })}
    </p>
  {/if}

  <h2>{t('templates.exclusions')}</h2>
  {#if exclusions.length === 0}
    <p class="muted small">{t('templates.noExclusion')}</p>
  {:else}
    <ul class="exclusions">
      {#each exclusions as ex, i (`${ex.from}-${ex.to}-${i}`)}
        <li>
          <span>{exclusionText(ex)}{ex.label ? ` · ${ex.label}` : ''}</span>
          {#if canWrite}
            <button class="danger" onclick={() => removeExclusion(i)}
              >{t('rundowns.item.remove')}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if canWrite}
    <form class="row exclusion-form" onsubmit={addExclusion}>
      <label>
        {t('templates.exFrom')}
        <input type="date" bind:value={exFrom} required />
      </label>
      <label>
        {t('templates.exTo')}
        <input type="date" bind:value={exTo} min={exFrom} />
      </label>
      <label class="grow">
        {t('templates.exLabel')}
        <input bind:value={exLabel} maxlength="80" placeholder={t('templates.exLabelHint')} />
      </label>
      <button disabled={exclusions.length >= MAX_TEMPLATE_EXCLUSIONS}
        >{t('templates.addExclusion')}</button
      >
    </form>
  {/if}

  <h2>{t('templates.items')}</h2>
  <p class="muted total">
    {t('rundowns.total', {
      duration: formatDuration(schedule.total),
      end: secondsToTime(schedule.end),
    })}
  </p>
  {#if items.length === 0}
    <p class="muted">{t('rundowns.emptyRundown')}</p>
  {/if}
  <ItemsEditor
    bind:items
    bind:lib
    {types}
    {startTime}
    {canWrite}
    ownerId={template.ownerId}
    locked={autosave.status === 'conflict'}
    onchange={changed}
    onerror={(message) => (error = message)}
  />

  {#if canWrite}
    <section class="card create">
      <h2>{t('templates.createTitle')}</h2>
      <p class="muted small">{t('templates.createIntro')}</p>
      {#if !active}<p class="notice">{t('templates.suspendedText')}</p>{/if}
      <div class="row">
        <label>
          {t('templates.from')}
          <input type="date" bind:value={periodFrom} required />
        </label>
        <label>
          {t('templates.to')}
          <input type="date" bind:value={periodTo} min={periodFrom} required />
        </label>
        <button
          class="primary"
          disabled={!active || !!periodError || creating || preview?.dates.length === 0}
          onclick={createRundowns}>{t('templates.create')}</button
        >
      </div>
      {#if periodError}
        <p class="invalid">{periodError}</p>
      {:else if preview}
        <p class="small">
          {t('templates.preview', { n: preview.dates.length })}
          {preview.dates.map((d) => formatAirDate(d, i18n.locale)).join(' · ')}
        </p>
      {/if}

      {#if result}
        <div class="success summary" role="status">
          <p>
            {t('templates.summary', {
              created: result.created.length,
              existing: result.existing.length,
              skipped: result.skipped.length,
            })}
          </p>
          {#if result.created.length > 0}
            <ul>
              {#each result.created as c (c.rundownId)}
                <li><a href="/rundowns/{c.rundownId}">{formatAirDate(c.date, i18n.locale)}</a></li>
              {/each}
            </ul>
          {/if}
          {#if result.existing.length > 0}
            <p class="small">
              {t('templates.existing')}
              {result.existing.map((d) => formatAirDate(d, i18n.locale)).join(' · ')}
            </p>
          {/if}
          {#each result.skipped as s (s.date)}
            <p class="small">{formatAirDate(s.date, i18n.locale)} : {reasonText(s.reason)}</p>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
{:else if !error}
  <p class="muted">{t('common.loading')}</p>
{/if}

<style>
  .top {
    margin-bottom: 1rem;
  }
  .spacer {
    flex: 1;
  }
  .status {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .status.saved {
    color: var(--ok);
  }
  .status.offline,
  .status.conflict {
    color: #fac775;
  }
  .kind {
    margin: 0 0 0.5rem;
    text-transform: uppercase;
    font-size: 0.8rem;
    letter-spacing: 0.05em;
  }
  .meta {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: flex-end;
    margin-bottom: 0.75rem;
  }
  .grow {
    flex: 1;
    min-width: 14rem;
  }
  .days {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    margin: 0 0 0.75rem;
  }
  .day,
  .active {
    text-transform: capitalize;
  }
  .small {
    font-size: 0.85rem;
  }
  .exclusions {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
  }
  .exclusions li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--border);
  }
  .exclusions button {
    padding: 0.25rem 0.6rem;
  }
  .exclusion-form {
    align-items: flex-end;
  }
  .total {
    margin: 0 0 0.75rem;
  }
  .create {
    margin: 1rem 0 2rem;
  }
  .create h2 {
    margin-top: 0;
  }
  .create .row {
    align-items: flex-end;
  }
  .invalid {
    color: #f7c1c1;
    font-size: 0.85rem;
  }
  .summary {
    margin-top: 0.75rem;
  }
  .summary p {
    margin: 0.2rem 0;
  }
  .summary a {
    color: inherit;
  }
</style>
