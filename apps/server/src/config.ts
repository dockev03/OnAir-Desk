import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8443),
  DATA_DIR: z.string().default('/data'),
  WEB_DIR: z.string().optional(),
  PUBLIC_ORIGIN: csv,
  TLS_HOSTNAMES: csv,
  TLS_CERT_FILE: z.string().optional(),
  TLS_KEY_FILE: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface TlsConfig {
  /** Noms DNS et adresses IP à inscrire dans le certificat généré. */
  hostnames: string[];
  /** Certificat fourni par la station (remplace la génération automatique). */
  certFile?: string;
  keyFile?: string;
}

export interface Config {
  env: 'production' | 'development' | 'test';
  host: string;
  port: number;
  dataDir: string;
  webDir: string;
  /** Origines autorisées (vérification de l'en-tête Origin). La première est l'adresse principale. */
  allowedOrigins: string[];
  /** null : HTTP simple, autorisé uniquement hors production. */
  tls: TlsConfig | null;
  secureCookies: boolean;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
}

export class ConfigError extends Error {}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`PUBLIC_ORIGIN invalide : « ${value} »`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(`PUBLIC_ORIGIN doit commencer par https:// : « ${value} »`);
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`);
    throw new ConfigError(`Variables d'environnement invalides :\n- ${details.join('\n- ')}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  let allowedOrigins = e.PUBLIC_ORIGIN.map(normalizeOrigin);
  if (allowedOrigins.length === 0) {
    if (production) {
      throw new ConfigError(
        'PUBLIC_ORIGIN est obligatoire en production (ex. https://onair-desk.lan).',
      );
    }
    allowedOrigins = [`http://localhost:5173`, `http://localhost:${e.PORT}`];
  }

  if (Boolean(e.TLS_CERT_FILE) !== Boolean(e.TLS_KEY_FILE)) {
    throw new ConfigError('TLS_CERT_FILE et TLS_KEY_FILE doivent être renseignés ensemble.');
  }

  let tls: TlsConfig | null = null;
  if (production) {
    if (allowedOrigins.some((o) => o.startsWith('http:'))) {
      throw new ConfigError('En production, PUBLIC_ORIGIN doit être en https://.');
    }
    const hostnames =
      e.TLS_HOSTNAMES.length > 0
        ? e.TLS_HOSTNAMES
        : [...new Set(allowedOrigins.map((o) => new URL(o).hostname))];
    tls = { hostnames };
    if (e.TLS_CERT_FILE && e.TLS_KEY_FILE) {
      tls.certFile = e.TLS_CERT_FILE;
      tls.keyFile = e.TLS_KEY_FILE;
    }
  }

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    dataDir: path.resolve(e.DATA_DIR),
    webDir: path.resolve(e.WEB_DIR ?? path.join(here, '../../web/build')),
    allowedOrigins,
    tls,
    secureCookies: production,
    logLevel: e.LOG_LEVEL,
  };
}
