<script lang="ts">
  import { t } from '$lib/i18n/index.svelte.js';
  import { session } from '$lib/session.svelte.js';
</script>

<h1>{t('home.title', { name: session.user?.displayName ?? '' })}</h1>
<p class="muted">{t('home.soon')}</p>
