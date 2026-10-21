<script lang="ts">
  import { PASSWORD_MIN_LENGTH } from '@onair-desk/shared';
  import { api, errorCode } from '$lib/api.js';
  import { errorMessage, t } from '$lib/i18n/index.svelte.js';

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let error = $state('');
  let done = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    done = false;
    if (newPassword !== confirmPassword) {
      error = t('error.passwordMismatch');
      return;
    }
    try {
      await api('POST', '/api/auth/password', { currentPassword, newPassword });
      currentPassword = newPassword = confirmPassword = '';
      done = true;
    } catch (err) {
      error = errorMessage(errorCode(err));
    }
  }
</script>

<h1>{t('account.title')}</h1>

<form class="card stack" onsubmit={submit} style="max-width: 440px">
  <h2 style="margin-top: 0">{t('account.changePassword')}</h2>
  <label>
    {t('account.current')}
    <input type="password" bind:value={currentPassword} required autocomplete="current-password" />
  </label>
  <label>
    {t('account.new')}
    <input
      type="password"
      bind:value={newPassword}
      required
      minlength={PASSWORD_MIN_LENGTH}
      autocomplete="new-password"
    />
    <small>{t('field.passwordHint')}</small>
  </label>
  <label>
    {t('field.passwordConfirm')}
    <input
      type="password"
      bind:value={confirmPassword}
      required
      minlength={PASSWORD_MIN_LENGTH}
      autocomplete="new-password"
    />
  </label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if done}<p class="success">{t('account.changed')}</p>{/if}
  <div><button class="primary">{t('common.save')}</button></div>
</form>
