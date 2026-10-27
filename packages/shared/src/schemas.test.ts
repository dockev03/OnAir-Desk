import { describe, expect, it } from 'vitest';
import { DEFAULT_CUES } from './content.js';
import { DEFAULT_ITEM_TAGS, DEFAULT_ITEM_TYPES } from './rundown.js';
import { setupSchema, updateUserSchema, usernameSchema, settingsSchema } from './schemas.js';

describe('usernameSchema', () => {
  it('normalise en minuscules', () => {
    expect(usernameSchema.parse('  Jean.Dupont ')).toBe('jean.dupont');
  });
  it('refuse les caractères spéciaux et les noms trop courts', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('jean dupont').success).toBe(false);
    expect(usernameSchema.safeParse('<script>').success).toBe(false);
  });
});

describe('settingsSchema', () => {
  const base = {
    stationName: 'Radio',
    locale: 'fr',
    timezone: 'Europe/Paris',
    timeFormat: '24h',
    defaultSpeedWpm: 150,
    prompterFontSize: 48,
    cues: DEFAULT_CUES,
    itemTypes: DEFAULT_ITEM_TYPES,
    itemTags: DEFAULT_ITEM_TAGS,
    automationSource: 'none',
    simulatorSpeed: 1,
    radiodj: { host: '', port: 3306, database: 'radiodj', user: 'onairdesk' },
    trackAlert: { soonSeconds: 30, nowSeconds: 10 },
    logoHash: null,
  };
  it('accepte un paramétrage valide', () => {
    expect(settingsSchema.safeParse(base).success).toBe(true);
  });
  it('refuse un fuseau horaire inconnu', () => {
    expect(settingsSchema.safeParse({ ...base, timezone: 'Mars/Olympus' }).success).toBe(false);
  });
  it('borne la vitesse et la taille du texte', () => {
    expect(settingsSchema.safeParse({ ...base, defaultSpeedWpm: 10 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, prompterFontSize: 500 }).success).toBe(false);
  });
  it('refuse une langue non prise en charge', () => {
    expect(settingsSchema.safeParse({ ...base, locale: 'de' }).success).toBe(false);
  });
  it('seuils d’alerte : « maintenant » plus court que « bientôt », bornés', () => {
    const alert = (soonSeconds: number, nowSeconds: number) =>
      settingsSchema.safeParse({ ...base, trackAlert: { soonSeconds, nowSeconds } }).success;
    expect(alert(30, 10)).toBe(true);
    expect(alert(10, 10)).toBe(false);
    expect(alert(10, 30)).toBe(false);
    expect(alert(121, 10)).toBe(false);
    expect(alert(30, 0)).toBe(false);
  });
  it('accès RadioDJ : hôte, base et port validés, aucun mot de passe accepté', () => {
    const radiodj = (over: object) =>
      settingsSchema.safeParse({ ...base, radiodj: { ...base.radiodj, ...over } }).success;
    expect(radiodj({ host: 'studio-pc.lan' })).toBe(true);
    expect(radiodj({ host: '192.168.1.30' })).toBe(true);
    expect(radiodj({ host: 'pc studio' })).toBe(false);
    expect(radiodj({ host: 'pc;DROP' })).toBe(false);
    expect(radiodj({ database: 'radio dj' })).toBe(false);
    expect(radiodj({ port: 0 })).toBe(false);
    expect(radiodj({ password: 'secret' })).toBe(false);
  });
});

describe('setupSchema', () => {
  it('exige un mot de passe de 12 caractères minimum', () => {
    const r = setupSchema.safeParse({
      code: 'abc',
      station: { stationName: 'Radio', locale: 'fr', timezone: 'Europe/Paris' },
      admin: { username: 'admin', displayName: 'Admin', password: 'court' },
    });
    expect(r.success).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('refuse une mise à jour vide', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });
});
