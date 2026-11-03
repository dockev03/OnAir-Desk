import { describe, expect, it } from 'vitest';
import { LAYOUT_BLOCKS } from './layout.js';
import { linersSettingsSchema, onAirRequestSchema, weatherSettingsSchema } from './schemas.js';
import { standbyActive } from './standby.js';
import { MIC_LAST_SHOWN_MS, formatElapsed, micTimer } from './timing.js';
import {
  WEATHER_MAX_AGE_MS,
  WEATHER_STALE_MS,
  formatTemperature,
  weatherFreshness,
  weatherIcon,
  weatherLabel,
} from './weather.js';

describe('météo', () => {
  it('codes WMO regroupés en libellés et pictogrammes, de jour et de nuit', () => {
    expect([0, 1, 2, 3, 45, 51, 61, 71, 80, 95].map(weatherLabel)).toEqual([
      'clear',
      'partly',
      'partly',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'snow',
      'showers',
      'storm',
    ]);
    expect(weatherLabel(86)).toBe('snow');
    expect(weatherLabel(42)).toBe('cloudy');
    expect(weatherIcon(0, false)).toBe('clear-night');
    expect(weatherIcon(2, false)).toBe('partly-night');
    expect(weatherIcon(61, false)).toBe('rain');
  });

  it('fraîcheur : récente, ancienne (affichée avec son heure), trop ancienne', () => {
    const t = 1_000_000_000;
    expect(weatherFreshness(t, t + WEATHER_STALE_MS)).toBe('fresh');
    expect(weatherFreshness(t, t + WEATHER_STALE_MS + 1)).toBe('stale');
    expect(weatherFreshness(t, t + WEATHER_MAX_AGE_MS + 1)).toBe('expired');
    expect(weatherFreshness(null, t)).toBe('expired');
  });

  it('température arrondie, sans « -0 »', () => {
    expect(formatTemperature(12.4)).toBe('12 °C');
    expect(formatTemperature(-0.4)).toBe('0 °C');
    expect(formatTemperature(-3.6)).toBe('-4 °C');
  });

  it('paramètres : ville obligatoire avec un fournisseur, coordonnées bornées', () => {
    const w = { provider: 'openmeteo', city: 'Vichy', latitude: 46.13, longitude: 3.43 };
    expect(weatherSettingsSchema.safeParse(w).success).toBe(true);
    expect(weatherSettingsSchema.safeParse({ ...w, city: '' }).success).toBe(false);
    expect(weatherSettingsSchema.safeParse({ ...w, provider: 'none', city: '' }).success).toBe(
      true,
    );
    expect(weatherSettingsSchema.safeParse({ ...w, latitude: -91 }).success).toBe(false);
  });
});

describe('On Air', () => {
  it('requête : on, off ou toggle, rien d’autre', () => {
    for (const state of ['on', 'off', 'toggle']) {
      expect(onAirRequestSchema.safeParse({ state }).success).toBe(true);
    }
    for (const body of [{ state: 'ON' }, { state: 1 }, { state: 'on', token: 'x' }, {}]) {
      expect(onAirRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it('chronomètre : temps écoulé, puis dernière durée 10 s après l’extinction', () => {
    expect(micTimer({ on: false, since: null, lastDurationMs: null }, 0)).toBeNull();
    expect(micTimer({ on: true, since: 1000, lastDurationMs: null }, 66_000)).toEqual({
      ms: 65_000,
      running: true,
    });
    const off = { on: false, since: 100_000, lastDurationMs: 65_000 };
    expect(micTimer(off, 100_000 + MIC_LAST_SHOWN_MS)).toEqual({ ms: 65_000, running: false });
    expect(micTimer(off, 100_001 + MIC_LAST_SHOWN_MS)).toBeNull();
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_999)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('micro ouvert : pas de veille', () => {
    expect(standbyActive([], 0, 'Europe/Paris', false, true)).toBe(false);
    expect(standbyActive([], 0, 'Europe/Paris', false, false)).toBe(true);
  });
});

describe('liners', () => {
  const item = (id: string) => ({ id, text: 'Vous écoutez Radio Démo', active: true });
  it('30 cartes au plus, identifiants uniques, texte borné, rotation de 10 à 120 s', () => {
    const ok = { items: [item('a'), item('b')], rotationSeconds: 20 };
    expect(linersSettingsSchema.safeParse(ok).success).toBe(true);
    expect(linersSettingsSchema.safeParse({ ...ok, items: [item('a'), item('a')] }).success).toBe(
      false,
    );
    const many = Array.from({ length: 31 }, (_, i) => item(`l${i}`));
    expect(linersSettingsSchema.safeParse({ ...ok, items: many }).success).toBe(false);
    expect(
      linersSettingsSchema.safeParse({ ...ok, items: [{ ...item('a'), text: 'x'.repeat(201) }] })
        .success,
    ).toBe(false);
    expect(linersSettingsSchema.safeParse({ ...ok, rotationSeconds: 5 }).success).toBe(false);
  });

  it('bande masquée en disposition « Interview »', () => {
    expect(LAYOUT_BLOCKS.solo.liners).toBe(true);
    expect(LAYOUT_BLOCKS.interview.liners).toBe(false);
  });
});
