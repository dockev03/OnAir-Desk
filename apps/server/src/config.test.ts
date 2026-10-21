import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('exige PUBLIC_ORIGIN en production', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('refuse le HTTP simple en production', () => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: 'http://onair-desk.lan' })).toThrow(/https/);
  });

  it('active le HTTPS et déduit les noms du certificat des origines', () => {
    const c = loadConfig({ PUBLIC_ORIGIN: 'https://onair-desk.lan, https://192.168.1.20:443/' });
    expect(c.allowedOrigins).toEqual(['https://onair-desk.lan', 'https://192.168.1.20']);
    expect(c.tls?.hostnames).toEqual(['onair-desk.lan', '192.168.1.20']);
    expect(c.secureCookies).toBe(true);
  });

  it('exige le certificat et la clé ensemble', () => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: 'https://a.lan', TLS_CERT_FILE: '/x.crt' })).toThrow(
      /ensemble/,
    );
  });

  it('autorise le HTTP en développement', () => {
    const c = loadConfig({ NODE_ENV: 'development' });
    expect(c.tls).toBeNull();
    expect(c.secureCookies).toBe(false);
  });
});
