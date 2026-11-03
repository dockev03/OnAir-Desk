<script lang="ts">
  import type { WeatherIcon } from '@onair-desk/shared';

  /**
   * Pictogrammes météo dessinés en SVG, livrés avec l'interface : aucune ressource externe,
   * l'afficheur n'a pas besoin d'Internet. Traits simples, lisibles en petit.
   */
  let { icon, size = 28 }: { icon: WeatherIcon; size?: number } = $props();

  const sun = $derived(icon === 'clear' || icon === 'partly');
  const moon = $derived(icon === 'clear-night' || icon === 'partly-night');
  const cloud = $derived(icon !== 'clear' && icon !== 'clear-night');
  const small = $derived(icon === 'partly' || icon === 'partly-night');
</script>

<svg
  class="weather-icon"
  width={size}
  height={size}
  viewBox="0 0 32 32"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if sun}
    <g class="sun" transform={small ? 'translate(-5 -5)' : ''}>
      <circle cx="16" cy="16" r={small ? 4.5 : 6} />
      {#each [0, 45, 90, 135, 180, 225, 270, 315] as a (a)}
        <line x1="16" y1={small ? 7 : 4} x2="16" y2={small ? 9 : 7} transform="rotate({a} 16 16)" />
      {/each}
    </g>
  {:else if moon}
    <path
      class="moon"
      transform={small ? 'translate(-5 -5)' : ''}
      d="M20 6a10 10 0 1 0 6 16A8 8 0 0 1 20 6z"
    />
  {/if}
  {#if cloud}
    <path
      class="cloud"
      d={small
        ? 'M12 26h12a5 5 0 0 0 0-10 7 7 0 0 0-13 2 4 4 0 0 0 1 8z'
        : 'M9 22h15a6 6 0 0 0 0-12 8 8 0 0 0-15 3 4.5 4.5 0 0 0 0 9z'}
    />
  {/if}
  {#if icon === 'fog'}
    <line x1="6" y1="26" x2="26" y2="26" /><line x1="9" y1="29" x2="23" y2="29" />
  {:else if icon === 'drizzle'}
    <line x1="12" y1="26" x2="11" y2="28" /><line x1="18" y1="26" x2="17" y2="28" />
  {:else if icon === 'rain' || icon === 'showers'}
    <line x1="11" y1="25" x2="9" y2="30" /><line x1="16" y1="25" x2="14" y2="30" /><line
      x1="21"
      y1="25"
      x2="19"
      y2="30"
    />
  {:else if icon === 'snow'}
    <circle cx="11" cy="27" r="1" /><circle cx="16" cy="29" r="1" /><circle cx="21" cy="27" r="1" />
  {:else if icon === 'storm'}
    <path d="M17 23l-3 4h4l-3 4" />
  {/if}
</svg>

<style>
  .weather-icon {
    flex-shrink: 0;
  }
  /* Jaune pâle : l'orange et le rouge sont réservés aux alertes. */
  .sun {
    stroke: #ece0b0;
  }
  .moon {
    stroke: #c9c8c2;
  }
</style>
