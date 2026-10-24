import { describe, expect, it } from 'vitest';
import {
  alertLevel,
  formatCountdown,
  introRemaining,
  isTimed,
  nextStartAt,
  trackAlertLevel,
  trackProgress,
  trackRemaining,
} from './timing.js';

const START = 1_000_000;
const track = { durationMs: 200_000, startedAt: START, introMs: 15_000 };

describe('titre en cours', () => {
  it('temps restant et progression : début, milieu, fin, dépassement', () => {
    expect(trackRemaining(track, START)).toBe(200_000);
    expect(trackProgress(track, START)).toBe(0);
    expect(trackRemaining(track, START + 50_000)).toBe(150_000);
    expect(trackProgress(track, START + 50_000)).toBe(0.25);
    expect(trackRemaining(track, START + 200_000)).toBe(0);
    // Titre terminé mais pas encore remplacé : ni négatif, ni au-delà de 100 %.
    expect(trackRemaining(track, START + 260_000)).toBe(0);
    expect(trackProgress(track, START + 260_000)).toBe(1);
    // Horloge de l'écran légèrement en retard sur le début annoncé.
    expect(trackRemaining(track, START - 2_000)).toBe(200_000);
  });

  it('titre pas encore lancé, durée nulle', () => {
    expect(trackRemaining({ durationMs: 180_000, startedAt: null }, START)).toBe(180_000);
    expect(trackProgress({ durationMs: 0, startedAt: START }, START)).toBe(0);
  });

  it('heure de démarrage du suivant = maintenant + temps restant', () => {
    expect(nextStartAt(track, START + 50_000)).toBe(START + 200_000);
    expect(nextStartAt(null, START)).toBeNull();
    expect(nextStartAt({ durationMs: 1000, startedAt: null }, START)).toBeNull();
    // Passage de minuit : le calcul en millisecondes absolues n'a pas de cas particulier.
    const lateEvening = Date.UTC(2026, 9, 23, 23, 59, 0);
    const late = { durationMs: 180_000, startedAt: lateEvening };
    expect(new Date(nextStartAt(late, lateEvening)!).toISOString()).toBe(
      '2026-10-24T00:02:00.000Z',
    );
  });

  it('intro restante (talk-over)', () => {
    expect(introRemaining(track, START + 5_000)).toBe(10_000);
    expect(introRemaining(track, START + 20_000)).toBe(0);
    expect(introRemaining({ durationMs: 1, startedAt: START, introMs: null }, START)).toBeNull();
  });
});

describe('alertes et affichage', () => {
  const thresholds = { soonSeconds: 30, nowSeconds: 10 };
  it('niveaux aux seuils exacts (bornes incluses)', () => {
    expect(alertLevel(30_001, thresholds)).toBe('none');
    expect(alertLevel(30_000, thresholds)).toBe('soon');
    expect(alertLevel(10_001, thresholds)).toBe('soon');
    expect(alertLevel(10_000, thresholds)).toBe('now');
    expect(alertLevel(0, thresholds)).toBe('now');
  });

  it('compte à rebours arrondi à la seconde supérieure', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(125_000)).toBe('2:05');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('alerte de fin du titre en cours', () => {
  const thresholds = { soonSeconds: 30, nowSeconds: 10 };
  it('suit le temps restant du titre', () => {
    expect(trackAlertLevel(track, START + 100_000, thresholds)).toBe('none');
    expect(trackAlertLevel(track, START + 170_000, thresholds)).toBe('soon');
    expect(trackAlertLevel(track, START + 190_000, thresholds)).toBe('now');
  });
  it('mode dégradé (ni durée ni heure de début) : jamais d’alerte ni d’heure du suivant', () => {
    const untimed = { durationMs: 0, startedAt: null };
    expect(isTimed(untimed)).toBe(false);
    expect(isTimed({ durationMs: 0, startedAt: START })).toBe(false);
    expect(isTimed(track)).toBe(true);
    expect(trackAlertLevel(untimed, START, thresholds)).toBe('none');
    expect(trackAlertLevel(null, START, thresholds)).toBe('none');
    expect(nextStartAt({ durationMs: 0, startedAt: START }, START)).toBeNull();
  });
});
