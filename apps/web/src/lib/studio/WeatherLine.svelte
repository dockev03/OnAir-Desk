<script lang="ts">
  import {
    formatClock,
    formatTemperature,
    weatherFreshness,
    weatherIcon,
    weatherLabel,
    type TimeFormat,
    type WeatherState,
  } from '@onair-desk/shared';
  import { t } from '$lib/i18n/index.svelte.js';
  import WeatherIcon from './WeatherIcon.svelte';

  /**
   * Météo du bloc horloge (et de la veille) : pictogramme, température, libellé, min / max.
   * Valeur ancienne : affichée avec son heure ; trop ancienne : plus rien.
   */
  let {
    weather,
    now,
    timezone,
    timeFormat,
    large = false,
  }: {
    weather: WeatherState | null;
    now: number;
    timezone: string;
    timeFormat: TimeFormat;
    large?: boolean;
  } = $props();

  const freshness = $derived(weatherFreshness(weather?.updatedAt ?? null, now));
  const w = $derived(weather?.now && freshness !== 'expired' ? weather.now : null);
</script>

{#if w}
  <div class="weather" class:large data-testid="weather" data-freshness={freshness}>
    <WeatherIcon icon={weatherIcon(w.code, w.isDay)} size={large ? 40 : 24} />
    <span class="temp">{formatTemperature(w.temperature)}</span>
    <span class="label">{t(`weather.${weatherLabel(w.code)}`)}</span>
    {#if w.min !== null && w.max !== null}
      <span class="minmax">{Math.round(w.min)}° / {Math.round(w.max)}°</span>
    {/if}
    {#if freshness === 'stale' && weather?.updatedAt}
      <span class="at" data-testid="weather-at">
        {t('studio.weatherAt', {
          time: formatClock(new Date(weather.updatedAt), timezone, timeFormat).slice(0, 5),
        })}
      </span>
    {/if}
  </div>
{/if}

<style>
  .weather {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #c9c8c2;
    font-size: 0.95rem;
    white-space: nowrap;
  }
  .weather.large {
    font-size: 1.4rem;
    gap: 10px;
  }
  .temp {
    color: #fff;
    font-weight: 600;
  }
  .minmax,
  .at {
    color: var(--muted);
    font-size: 0.85em;
  }
</style>
