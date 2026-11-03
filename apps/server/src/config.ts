import fs from 'node:fs';
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
  /** Port HTTP dédié aux connecteurs entrants (plugin RadioDJ) ; absent : écoute fermée. */
  CONNECTOR_HTTP_PORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  /** Mot de passe du compte MariaDB (lecture seule) de RadioDJ. */
  RADIODJ_DB_PASSWORD: z.string().optional(),
  /** Clé API AzuraCast (station non publique) : compte dédié, sans droit d'administration. */
  AZURACAST_API_KEY: z.string().optional(),
  /** Certificat (PEM) à accepter pour AzuraCast, en plus des autorités publiques. */
  AZURACAST_CA_FILE: z.string().optional(),
  /** Adresse de l'API Open-Meteo : à ne changer que pour les tests. */
  OPEN_METEO_URL: z.string().url().optional(),
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
  /** Port HTTP dédié aux connecteurs ; null : écoute fermée (défaut). */
  connectorHttpPort: number | null;
  /** Secret : jamais journalisé ni renvoyé par l'API. */
  radiodjDbPassword: string | null;
  /** Secret : jamais journalisé ni renvoyé par l'API. */
  azuracastApiKey: string | null;
  /** Contenu PEM du certificat à accepter pour AzuraCast (auto-signé) ; null : aucun. */
  azuracastCa: string | null;
  /** Adresse de l'API Open-Meteo ; null : l'adresse publique. */
  openMeteoUrl: string | null;
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

  if (e.CONNECTOR_HTTP_PORT !== undefined && e.CONNECTOR_HTTP_PORT === e.PORT) {
    throw new ConfigError('CONNECTOR_HTTP_PORT doit être différent de PORT.');
  }

  if (Boolean(e.TLS_CERT_FILE) !== Boolean(e.TLS_KEY_FILE)) {
    throw new ConfigError('TLS_CERT_FILE et TLS_KEY_FILE doivent être renseignés ensemble.');
  }

  let azuracastCa: string | null = null;
  if (e.AZURACAST_CA_FILE) {
    try {
      azuracastCa = fs.readFileSync(e.AZURACAST_CA_FILE, 'utf8');
    } catch {
      throw new ConfigError(`AZURACAST_CA_FILE illisible : « ${e.AZURACAST_CA_FILE} ».`);
    }
    if (!azuracastCa.includes('-----BEGIN CERTIFICATE-----')) {
      throw new ConfigError('AZURACAST_CA_FILE doit contenir un certificat au format PEM.');
    }
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
    connectorHttpPort: e.CONNECTOR_HTTP_PORT ?? null,
    radiodjDbPassword: e.RADIODJ_DB_PASSWORD || null,
    azuracastApiKey: e.AZURACAST_API_KEY?.trim() || null,
    azuracastCa,
    openMeteoUrl: e.OPEN_METEO_URL ?? null,
  };
}
