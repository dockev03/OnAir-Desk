import https from 'node:https';
import tls from 'node:tls';
import type { AzuracastSettings } from '@onair-desk/shared';

/** Délai d'une requête (connexion comprise). */
export const REQUEST_TIMEOUT_MS = 5_000;
/** Flux SSE : AzuraCast envoie un ping toutes les 25 s ; au-delà de 75 s de silence, on reconnecte. */
export const SSE_IDLE_MS = 75_000;
/** Reconnexion du flux SSE : de 1 s à 60 s. */
export const SSE_BACKOFF_MS = [1_000, 60_000] as const;
/** Taille maximale d'une réponse (ou d'un message du flux). */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Accès à AzuraCast : paramètres de la station et secrets du serveur. */
export interface AzuracastAccess {
  url: string;
  station: string;
  /** Clé API (AZURACAST_API_KEY) ; null : aucune. */
  apiKey: string | null;
  /** Certificat PEM à accepter en plus des autorités publiques (AZURACAST_CA_FILE). */
  ca: string | null;
}

/** Erreur dont le code est stable (traduit côté interface). */
export class AzuracastError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Statut HTTP de la réponse, s'il y en a eu une. */
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

const TLS_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'EPROTO',
]);
const NETWORK_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** Erreur réseau, TLS ou HTTP → code stable. */
export function azuracastErrorCode(err: unknown): string {
  if (err instanceof AzuracastError) return err.code;
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && TLS_ERRORS.has(code)) return 'azuracast_tls';
  if (typeof code === 'string' && NETWORK_ERRORS.has(code)) return 'azuracast_unreachable';
  return 'azuracast_error';
}

/** Ce dont le connecteur a besoin : lecture de l'état et flux temps réel. */
export interface AzuracastClient {
  nowPlaying(): Promise<unknown>;
  /**
   * Flux SSE : `onMessage` reçoit chaque message JSON. Se reconnecte seul ; renvoie la fonction
   * d'arrêt. Une coupure du flux n'est pas une panne : la relecture périodique prend le relais.
   */
  subscribe(onMessage: (message: unknown) => void): () => void;
}

/** Accès incomplet : code stable, ou null si l'adresse et la station sont renseignées. */
export function azuracastConfigError(settings: AzuracastSettings): string | null {
  if (!settings.url || !settings.station) return 'azuracast_not_configured';
  return null;
}

/**
 * Client HTTPS d'AzuraCast, sans dépendance (module `https` de Node). La vérification du
 * certificat n'est jamais désactivée ; la clé API ne part qu'une fois le serveur authentifié
 * (en-têtes envoyés après la négociation TLS), jamais dans l'adresse.
 */
export class HttpsAzuracastClient implements AzuracastClient {
  private readonly base: URL;
  private readonly prefix: string;

  constructor(private readonly access: AzuracastAccess) {
    this.base = new URL(access.url);
    if (this.base.protocol !== 'https:') throw new AzuracastError('azuracast_url', 'https only');
    this.prefix = this.base.pathname.replace(/\/+$/, '');
  }

  private options(path: string, accept: string): https.RequestOptions {
    const headers: Record<string, string> = { accept, 'user-agent': 'OnAir-Desk' };
    if (this.access.apiKey) headers['x-api-key'] = this.access.apiKey;
    return {
      method: 'GET',
      // Adresse IPv6 : sans crochets pour le module https.
      hostname: this.base.hostname.replace(/^\[|\]$/g, ''),
      port: this.base.port || 443,
      path: `${this.prefix}${path}`,
      headers,
      ...(this.access.ca ? { ca: [...tls.rootCertificates, this.access.ca] } : {}),
      // Pas de réutilisation de connexion : chaque appel revérifie le certificat.
      agent: false,
    };
  }

  private station(): string {
    return encodeURIComponent(this.access.station);
  }

  nowPlaying(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        this.options(`/api/nowplaying/${this.station()}`, 'application/json'),
        (res) => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            res.resume();
            const code =
              status === 401 || status === 403
                ? 'azuracast_unauthorized'
                : status === 404
                  ? 'azuracast_station_unknown'
                  : 'azuracast_http';
            reject(new AzuracastError(code, `HTTP ${status}`, status));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              req.destroy(new AzuracastError('azuracast_bad_response', 'response too large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
              reject(new AzuracastError('azuracast_bad_response', 'invalid JSON', status));
            }
          });
          res.on('error', reject);
        },
      );
      req.setTimeout(REQUEST_TIMEOUT_MS, () =>
        req.destroy(new AzuracastError('azuracast_unreachable', 'timeout')),
      );
      req.on('error', reject);
      req.end();
    });
  }

  subscribe(onMessage: (message: unknown) => void): () => void {
    let stopped = false;
    let req: ReturnType<typeof https.request> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff: number = SSE_BACKOFF_MS[0];
    const connectParam = encodeURIComponent(
      JSON.stringify({ subs: { [`station:${this.access.station}`]: { recover: true } } }),
    );

    const connect = () => {
      if (stopped) return;
      let retried = false;
      const retry = () => {
        if (retried || stopped) return;
        retried = true;
        req?.destroy();
        timer = setTimeout(connect, backoff);
        timer.unref?.();
        backoff = Math.min(backoff * 2, SSE_BACKOFF_MS[1]);
      };
      req = https.request(
        this.options(`/api/live/nowplaying/sse?cf_connect=${connectParam}`, 'text/event-stream'),
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            retry();
            return;
          }
          backoff = SSE_BACKOFF_MS[0];
          res.setEncoding('utf8');
          let buffer = '';
          let data: string[] = [];
          res.on('data', (chunk: string) => {
            buffer += chunk;
            if (buffer.length > MAX_BODY_BYTES) return retry();
            let i: number;
            while ((i = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, i).replace(/\r$/, '');
              buffer = buffer.slice(i + 1);
              if (line.startsWith('data:')) {
                data.push(line.slice(5).trimStart());
              } else if (line === '' && data.length > 0) {
                // Fin d'un événement : ses lignes « data » forment un message JSON.
                const text = data.join('\n');
                data = [];
                try {
                  onMessage(JSON.parse(text));
                } catch {
                  // Message illisible : ignoré, le flux continue.
                }
              }
            }
          });
          res.on('end', retry);
          res.on('error', retry);
        },
      );
      req.setTimeout(SSE_IDLE_MS, retry);
      req.on('error', retry);
      req.end();
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      req?.destroy();
    };
  }
}
