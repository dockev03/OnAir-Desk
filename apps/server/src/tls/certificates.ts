// Requis par @peculiar/x509 (injection de dépendances interne), avant tout import de la bibliothèque.
import 'reflect-metadata';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomBytes, webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

x509.cryptoProvider.set(webcrypto);

const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const DAY = 24 * 60 * 60_000;
const CA_VALIDITY_DAYS = 3650;
const SERVER_VALIDITY_DAYS = 397;
/** Le certificat serveur est renouvelé quand il lui reste moins de 30 jours. */
const RENEW_BEFORE_DAYS = 30;

export interface TlsMaterial {
  key: string;
  /** Certificat serveur suivi du certificat racine (chaîne complète). */
  cert: string;
  /** Certificat racine à installer sur les postes ; null si le certificat est fourni par la station. */
  rootCaPem: string | null;
  /** Date d'expiration du certificat serveur. */
  notAfter: Date;
}

const serial = () => {
  const b = randomBytes(16);
  b[0]! &= 0x7f; // numéro de série positif
  return b.toString('hex');
};

const toPem = (der: ArrayBuffer, label: string) => {
  const b64 = Buffer.from(der)
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
};

const fromPem = (pem: string): ArrayBuffer => {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

async function exportPrivateKey(key: CryptoKey): Promise<string> {
  return toPem(await webcrypto.subtle.exportKey('pkcs8', key), 'PRIVATE KEY');
}

const writeSecret = (file: string, content: string) =>
  fs.writeFileSync(file, content, { mode: 0o600 });

const sanEntries = (hostnames: string[]): x509.JsonGeneralName[] =>
  hostnames.map((h) => (net.isIP(h) ? { type: 'ip', value: h } : { type: 'dns', value: h }));

/** Noms (DNS et IP) inscrits dans un certificat, triés, pour comparaison. */
function certificateNames(cert: x509.X509Certificate): string[] {
  const san = cert.getExtension(x509.SubjectAlternativeNameExtension);
  return (san?.names.toJSON() ?? []).map((n) => n.value.toLowerCase()).sort();
}

async function createRootCa(dir: string, installId: string) {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const now = Date.now();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=OnAir-Desk Root CA ${installId}, O=OnAir-Desk`,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + CA_VALIDITY_DAYS * DAY),
    keys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  writeSecret(path.join(dir, 'ca.key'), await exportPrivateKey(keys.privateKey));
  fs.writeFileSync(path.join(dir, 'ca.crt'), cert.toString('pem') + '\n');
}

async function createServerCertificate(dir: string, hostnames: string[]) {
  const caCert = new x509.X509Certificate(fs.readFileSync(path.join(dir, 'ca.crt'), 'utf8'));
  const caKey = await webcrypto.subtle.importKey(
    'pkcs8',
    fromPem(fs.readFileSync(path.join(dir, 'ca.key'), 'utf8')),
    ALG,
    false,
    ['sign'],
  );
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const now = Date.now();
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${hostnames[0]}`,
    issuer: caCert.subject,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + SERVER_VALIDITY_DAYS * DAY),
    signingKey: caKey,
    publicKey: keys.publicKey,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(sanEntries(hostnames)),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(caCert),
    ],
  });
  writeSecret(path.join(dir, 'server.key'), await exportPrivateKey(keys.privateKey));
  fs.writeFileSync(path.join(dir, 'server.crt'), cert.toString('pem') + '\n');
}

export interface EnsureResult extends TlsMaterial {
  /** Ce qui a été créé lors de cet appel, pour les logs. */
  created: ('ca' | 'server')[];
}

/**
 * Prépare le certificat HTTPS : génère l'autorité interne au premier démarrage, puis un
 * certificat serveur signé par elle, renouvelé avant expiration ou si les noms ont changé.
 */
export async function ensureInternalCertificates(
  dataDir: string,
  hostnames: string[],
): Promise<EnsureResult> {
  if (hostnames.length === 0) throw new Error('Aucun nom à inscrire dans le certificat.');
  const dir = path.join(dataDir, 'tls');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const created: EnsureResult['created'] = [];

  if (!fs.existsSync(path.join(dir, 'ca.key')) || !fs.existsSync(path.join(dir, 'ca.crt'))) {
    await createRootCa(dir, randomBytes(3).toString('hex'));
    created.push('ca');
  }

  const serverCrt = path.join(dir, 'server.crt');
  let renew = created.includes('ca') || !fs.existsSync(serverCrt);
  if (!renew) {
    const current = new x509.X509Certificate(fs.readFileSync(serverCrt, 'utf8'));
    const wanted = hostnames.map((h) => h.toLowerCase()).sort();
    renew =
      current.notAfter.getTime() - Date.now() < RENEW_BEFORE_DAYS * DAY ||
      certificateNames(current).join(',') !== wanted.join(',') ||
      !fs.existsSync(path.join(dir, 'server.key'));
  }
  if (renew) {
    await createServerCertificate(dir, hostnames);
    created.push('server');
  }

  const rootCaPem = fs.readFileSync(path.join(dir, 'ca.crt'), 'utf8');
  const serverPem = fs.readFileSync(serverCrt, 'utf8');
  return {
    key: fs.readFileSync(path.join(dir, 'server.key'), 'utf8'),
    cert: serverPem + rootCaPem,
    rootCaPem,
    notAfter: new x509.X509Certificate(serverPem).notAfter,
    created,
  };
}

/** Certificat fourni par la station (TLS_CERT_FILE / TLS_KEY_FILE). */
export function loadProvidedCertificate(certFile: string, keyFile: string): TlsMaterial {
  const cert = fs.readFileSync(certFile, 'utf8');
  const first = cert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!first) throw new Error(`Aucun certificat PEM dans ${certFile}.`);
  return {
    key: fs.readFileSync(keyFile, 'utf8'),
    cert,
    rootCaPem: null,
    notAfter: new x509.X509Certificate(first[0]).notAfter,
  };
}
