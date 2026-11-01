import { describe, expect, it } from 'vitest';
import { LAYOUT_BLOCKS, effectiveLayout } from './layout.js';
import { airSwitchSchema, azuracastSettingsSchema, sourcesInUse } from './schemas.js';
import {
  STANDBY_MARGIN_MS,
  nextShow,
  showInProgress,
  showWindow,
  standbyActive,
} from './standby.js';

const TZ = 'Europe/Paris';
/** 2026-11-02 à l'heure de Paris (UTC+1 en hiver). */
const paris = (time: string) => Date.parse(`2026-11-02T${time}+01:00`);

const show = (title: string, airDate: string, startTime: string, totalSeconds: number) => ({
  title,
  airDate,
  startTime,
  totalSeconds,
});

const matinale = show('Matinale', '2026-11-02', '07:00:00', 2 * 3600);
const soir = show('Soir', '2026-11-02', '18:00:00', 3600);
const demain = show('Demain', '2026-11-03', '07:00:00', 3600);

describe('écran de veille', () => {
  it('fenêtre d’une émission dans le fuseau de la station', () => {
    expect(showWindow(matinale, TZ)).toEqual({ start: paris('07:00:00'), end: paris('09:00:00') });
    expect(showWindow({ ...matinale, airDate: 'illisible' }, TZ)).toBeNull();
  });

  it('émission en cours avec 10 min de marge avant et après', () => {
    const shows = [matinale, soir, demain];
    expect(showInProgress(shows, paris('06:49:59'), TZ)).toBeNull();
    expect(showInProgress(shows, paris('06:50:00'), TZ)).toBe(matinale);
    expect(showInProgress(shows, paris('09:10:00'), TZ)).toBe(matinale);
    expect(showInProgress(shows, paris('09:10:01'), TZ)).toBeNull();
    expect(showInProgress(shows, paris('18:30:00'), TZ)).toBe(soir);
    expect(STANDBY_MARGIN_MS).toBe(600_000);
  });

  it('prochaine émission, aujourd’hui ou demain ; aucune', () => {
    const shows = [demain, soir, matinale];
    expect(nextShow(shows, paris('10:00:00'), TZ)).toEqual({
      show: soir,
      startsAt: paris('18:00:00'),
    });
    expect(nextShow(shows, paris('20:00:00'), TZ)?.show).toBe(demain);
    expect(nextShow([], paris('20:00:00'), TZ)).toBeNull();
  });

  it('veille : ni émission en cours, ni direct', () => {
    expect(standbyActive([matinale], paris('12:00:00'), TZ, false)).toBe(true);
    expect(standbyActive([matinale], paris('08:00:00'), TZ, false)).toBe(false);
    expect(standbyActive([matinale], paris('12:00:00'), TZ, true)).toBe(false);
    expect(standbyActive([], paris('12:00:00'), TZ, false)).toBe(true);
  });

  it('émission qui passe minuit', () => {
    const nuit = show('Nuit', '2026-11-02', '23:30:00', 3600);
    expect(showInProgress([nuit], Date.parse('2026-11-03T00:20:00+01:00'), TZ)).toBe(nuit);
  });
});

describe('dispositions', () => {
  it('trois dispositions figées ; celle de l’émission l’emporte', () => {
    expect(LAYOUT_BLOCKS.solo).toEqual({
      compactHeader: false,
      regieZone: false,
      collapseSidebar: false,
    });
    expect(LAYOUT_BLOCKS.regie.regieZone).toBe(true);
    expect(LAYOUT_BLOCKS.interview).toMatchObject({ compactHeader: true, collapseSidebar: true });
    expect(effectiveLayout('interview', 'solo')).toBe('interview');
    expect(effectiveLayout(null, 'regie')).toBe('regie');
    expect(effectiveLayout(undefined, 'solo')).toBe('solo');
  });
});

describe('paramètres AzuraCast et bascule', () => {
  const az = { url: 'https://radio.example.org', station: 'vichyradio', streamDelaySeconds: 10 };
  it('adresse https:// sans identifiants, station, retard borné', () => {
    expect(azuracastSettingsSchema.safeParse(az).success).toBe(true);
    expect(azuracastSettingsSchema.safeParse({ ...az, url: '', station: '' }).success).toBe(true);
    expect(azuracastSettingsSchema.safeParse({ ...az, url: 'https://h/azuracast' }).success).toBe(
      true,
    );
    for (const url of [
      'http://radio.example.org',
      'radio.example.org',
      'https://a:b@h',
      'https://h/?k=1',
    ]) {
      expect(azuracastSettingsSchema.safeParse({ ...az, url }).success, url).toBe(false);
    }
    expect(azuracastSettingsSchema.safeParse({ ...az, station: 'a b' }).success).toBe(false);
    expect(azuracastSettingsSchema.safeParse({ ...az, streamDelaySeconds: -31 }).success).toBe(
      false,
    );
    expect(azuracastSettingsSchema.safeParse({ ...az, apiKey: 'x' }).success).toBe(false);
  });

  it('bascule : deux sources différentes ; sources en service', () => {
    const sw = { enabled: true, liveSource: 'radiodj', offAirSource: 'azuracast', force: 'auto' };
    expect(airSwitchSchema.safeParse(sw).success).toBe(true);
    expect(airSwitchSchema.safeParse({ ...sw, offAirSource: 'radiodj' }).success).toBe(false);
    expect(airSwitchSchema.safeParse({ ...sw, liveSource: 'none' }).success).toBe(false);

    const base = { automationSource: 'simulator' as const, airSwitch: airSwitchSchema.parse(sw) };
    expect(sourcesInUse(base)).toEqual(['radiodj', 'azuracast']);
    expect(sourcesInUse({ ...base, airSwitch: { ...base.airSwitch, enabled: false } })).toEqual([
      'simulator',
    ]);
    expect(
      sourcesInUse({
        automationSource: 'none',
        airSwitch: { ...base.airSwitch, enabled: false },
      }),
    ).toEqual([]);
  });
});
