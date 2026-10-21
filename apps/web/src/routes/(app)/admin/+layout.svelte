<script lang="ts">
  import { goto } from '$app/navigation';
  import { session } from '$lib/session.svelte.js';

  let { children } = $props();
  const isAdmin = $derived(session.user?.role === 'admin');

  $effect(() => {
    if (!isAdmin) void goto('/', { replaceState: true });
  });
</script>

{#if isAdmin}
  {@render children()}
{/if}
