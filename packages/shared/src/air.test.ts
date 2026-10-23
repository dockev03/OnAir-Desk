import { describe, expect, it } from 'vitest';
import { applyAirMessage, emptyAirState, type AirMessage, type Track } from './air.js';
import { AUDIT_ACTIONS, auditQuerySchema } from './audit.js';

const track = (title: string): Track => ({
  title,
  artist: 'Artiste',
  durationMs: 180_000,
  startedAt: 1000,
  introMs: null,
  outroMs: null,
});
const msg = (version: number, changes: AirMessage['changes'], full = false): AirMessage => ({
  type: 'air',
  version,
  full,
  changes,
});

describe('application des messages « air » sur l’écran', () => {
  it('état complet, puis différentiels dans l’ordre', () => {
    let s = applyAirMessage(null, msg(4, emptyAirState('simulator'), true));
    expect(s).toMatchObject({ version: 4, state: { nowPlaying: null } });
    s = applyAirMessage(s as Exclude<typeof s, 'resync'>, msg(5, { nowPlaying: track('A') }));
    expect(s).toMatchObject({ version: 5, state: { nowPlaying: { title: 'A' } } });
    // Les champs non transmis sont conservés.
    expect(s).toMatchObject({ state: { source: { id: 'simulator' } } });
  });

  it('version manquante ou état absent : redemander l’état complet', () => {
    const s = { version: 5, state: emptyAirState() };
    expect(applyAirMessage(s, msg(7, {}))).toBe('resync');
    expect(applyAirMessage(null, msg(1, {}))).toBe('resync');
    // Message en double ou en retard : ignoré.
    expect(applyAirMessage(s, msg(5, { next: track('B') }))).toBe(s);
  });
});

describe('journal d’audit', () => {
  it('chaque action a une catégorie connue', () => {
    for (const category of Object.values(AUDIT_ACTIONS)) {
      expect(['securite', 'contenu', 'antenne', 'regie', 'systeme']).toContain(category);
    }
  });

  it('filtres validés', () => {
    expect(auditQuerySchema.parse({ page: '2', category: 'antenne' })).toEqual({
      page: 2,
      category: 'antenne',
    });
    expect(auditQuerySchema.parse({}).page).toBe(1);
    expect(auditQuerySchema.safeParse({ category: 'autre' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: '2026-13-01' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ sql: '1' }).success).toBe(false);
  });
});
