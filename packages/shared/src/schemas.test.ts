import { describe, expect, it } from 'vitest';
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
  const base = { stationName: 'Radio', locale: 'fr', timezone: 'Europe/Paris', timeFormat: '24h' };
  it('accepte un paramétrage valide', () => {
    expect(settingsSchema.safeParse(base).success).toBe(true);
  });
  it('refuse un fuseau horaire inconnu', () => {
    expect(settingsSchema.safeParse({ ...base, timezone: 'Mars/Olympus' }).success).toBe(false);
  });
  it('refuse une langue non prise en charge', () => {
    expect(settingsSchema.safeParse({ ...base, locale: 'de' }).success).toBe(false);
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
