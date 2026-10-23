import { describe, expect, it } from 'vitest';
import { formatClock } from './time.js';
import { clockOffset } from './timing.js';

describe('clockOffset', () => {
  it('compense la moitié du trajet aller-retour', () => {
    // Client à 1000, réponse reçue à 1100, serveur à 5050 au milieu : décalage 4000.
    expect(clockOffset(1000, 5050, 1100)).toBe(4000);
  });
});

describe('formatClock', () => {
  const d = new Date('2026-10-21T15:04:05Z');
  it('affiche HH:MM:SS dans le fuseau de la station', () => {
    expect(formatClock(d, 'Europe/Paris', '24h')).toBe('17:04:05');
    expect(formatClock(d, 'UTC', '24h')).toBe('15:04:05');
  });
  it('gère le format 12 h', () => {
    expect(formatClock(d, 'UTC', '12h')).toMatch(/^03:04:05/);
  });
});
