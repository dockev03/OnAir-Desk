import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureInternalCertificates } from '../src/tls/certificates.js';

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onair-tls-'))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('autorité de certification interne', () => {
  it('émet un certificat serveur valide, signé par la racine, pour les noms et IP demandés', async () => {
    const r = await ensureInternalCertificates(dir, ['onair-desk.lan', '192.168.1.20']);
    expect(r.created).toEqual(['ca', 'server']);

    const ca = new X509Certificate(r.rootCaPem!);
    const server = new X509Certificate(fs.readFileSync(path.join(dir, 'tls/server.crt')));
    expect(ca.ca).toBe(true);
    expect(server.ca).toBe(false);
    expect(server.verify(ca.publicKey)).toBe(true);
    expect(server.checkHost('onair-desk.lan')).toBe('onair-desk.lan');
    expect(server.checkIP('192.168.1.20')).toBe('192.168.1.20');
    expect(server.checkHost('autre.lan')).toBeUndefined();
    expect(server.keyUsage).toContain('1.3.6.1.5.5.7.3.1'); // serverAuth
    // La clé correspond bien au certificat.
    expect(server.checkPrivateKey(createPrivateKey(r.key))).toBe(true);
  });

  it('protège les clés privées (lecture par le propriétaire uniquement)', async () => {
    await ensureInternalCertificates(dir, ['onair-desk.lan']);
    for (const f of ['ca.key', 'server.key']) {
      expect(fs.statSync(path.join(dir, 'tls', f)).mode & 0o077).toBe(0);
    }
  });

  it('ne recrée rien au redémarrage, mais réémet si les noms changent', async () => {
    const first = await ensureInternalCertificates(dir, ['onair-desk.lan']);
    const again = await ensureInternalCertificates(dir, ['onair-desk.lan']);
    expect(again.created).toEqual([]);
    expect(again.cert).toBe(first.cert);

    const renamed = await ensureInternalCertificates(dir, ['onair-desk.lan', '10.0.0.5']);
    expect(renamed.created).toEqual(['server']);
    // La racine ne change pas : rien à réinstaller sur les postes.
    expect(renamed.rootCaPem).toBe(first.rootCaPem);
  });
});
