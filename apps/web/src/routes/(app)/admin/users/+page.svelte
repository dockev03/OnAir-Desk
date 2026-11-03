<script lang="ts">
  import { PASSWORD_MIN_LENGTH, ROLES, type PublicUser, type Role } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';
  import { session } from '$lib/session.svelte.js';

  let users = $state<PublicUser[]>([]);
  let error = $state('');
  let showForm = $state(false);

  let username = $state('');
  let displayName = $state('');
  let role = $state<Role>('animateur');
  let isDirector = $state(false);
  let password = $state('');

  async function refresh() {
    try {
      users = await api<PublicUser[]>('GET', '/api/users');
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

  async function create(e: SubmitEvent) {
    e.preventDefault();
    await run(async () => {
      await api('POST', '/api/users', { username, displayName, role, isDirector, password });
      username = displayName = password = '';
      role = 'animateur';
      isDirector = false;
      showForm = false;
    });
  }

  const update = (u: PublicUser, patch: Record<string, unknown>) =>
    run(() => api('PATCH', `/api/users/${u.id}`, patch));

  function resetPassword(u: PublicUser) {
    const pwd = prompt(t('users.resetPrompt', { name: u.displayName }));
    if (pwd) void update(u, { password: pwd });
  }

  function remove(u: PublicUser) {
    if (confirm(t('common.confirmDelete', { name: u.displayName }))) {
      void run(() => api('DELETE', `/api/users/${u.id}`));
    }
  }
</script>

<div class="row" style="justify-content: space-between">
  <h1>{t('users.title')}</h1>
  <button class="primary" onclick={() => (showForm = !showForm)}>{t('users.add')}</button>
</div>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if showForm}
  <form class="card stack" onsubmit={create} style="margin-bottom: 1.5rem">
    <label>
      {t('field.username')}
      <input bind:value={username} required autocomplete="off" />
      <small>{t('field.usernameHint')}</small>
    </label>
    <label>
      {t('field.displayName')}
      <input bind:value={displayName} required maxlength="64" />
    </label>
    <label>
      {t('field.role')}
      <select bind:value={role}>
        {#each ROLES as r (r)}<option value={r}>{t(`role.${r}`)}</option>{/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={isDirector} />
      {t('users.director')}
    </label>
    <small class="muted">{t('users.directorHint')}</small>
    <label>
      {t('field.password')}
      <input
        type="password"
        bind:value={password}
        required
        minlength={PASSWORD_MIN_LENGTH}
        autocomplete="new-password"
      />
      <small>{t('field.passwordHint')}</small>
    </label>
    <div class="row">
      <button class="primary">{t('users.create')}</button>
      <button type="button" onclick={() => (showForm = false)}>{t('common.cancel')}</button>
    </div>
  </form>
{/if}

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>{t('field.displayName')}</th>
        <th>{t('field.username')}</th>
        <th>{t('field.role')}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each users as u (u.id)}
        {@const self = u.id === session.user?.id}
        <tr class:inactive={!u.isActive}>
          <td>
            {u.displayName}
            {#if self}<span class="badge">{t('users.you')}</span>{/if}
            {#if !u.isActive}<span class="badge">{t('users.inactive')}</span>{/if}
          </td>
          <td class="mono">{u.username}</td>
          <td>
            {t(
              `role.${u.role}`,
            )}{#if u.isDirector && u.role !== 'admin'}{` · ${t('role.director')}`}{/if}
          </td>
          <td>
            <div class="row" style="justify-content: flex-end">
              <button onclick={() => resetPassword(u)}>{t('users.resetPassword')}</button>
              {#if !self}
                <button
                  onclick={() => update(u, { role: u.role === 'admin' ? 'animateur' : 'admin' })}
                >
                  {u.role === 'admin' ? t('users.makeAnimateur') : t('users.makeAdmin')}
                </button>
                {#if u.role !== 'admin'}
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={u.isDirector}
                      onchange={(e) => update(u, { isDirector: e.currentTarget.checked })}
                    />
                    {t('role.director')}
                  </label>
                {/if}
                <button onclick={() => update(u, { isActive: !u.isActive })}>
                  {u.isActive ? t('users.deactivate') : t('users.activate')}
                </button>
                <button class="danger" onclick={() => remove(u)}>{t('common.delete')}</button>
              {/if}
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  tr.inactive td {
    opacity: 0.6;
  }
  .check {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
</style>
