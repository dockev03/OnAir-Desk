import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { AzuracastClient } from '../src/connectors/azuracast/client.js';
import { ensureInternalCertificates } from '../src/tls/certificates.js';

/**
 * Réponse réelle relevée au cadrage (AzuraCast Rolling #b62d317, station « vichyradio »,
 * hors direct). Seule une partie des champs est utile au connecteur ; le reste est gardé tel
 * quel pour vérifier que le schéma tolère tout ce qu'il ne lit pas.
 */
export const OFF_AIR = {
  station: {
    id: 1,
    name: 'Vichy Radio',
    shortcode: 'vichyradio',
    description: '',
    frontend: 'remote',
    backend: 'liquidsoap',
    timezone: 'Europe/Paris',
    listen_url: null,
    url: '',
    public_player_url: 'http://localhost:9080/public/vichyradio',
    is_public: true,
    requests_enabled: false,
    mounts: [],
    remotes: [],
    hls_enabled: false,
  },
  listeners: { total: 1, unique: 1, current: 1 },
  live: { is_live: false, streamer_name: '', broadcast_start: null, art: null },
  now_playing: {
    sh_id: 3,
    played_at: 1793540659,
    duration: 262,
    playlist: 'default',
    streamer: '',
    is_request: false,
    song: {
      id: 'd76abe1be38a998de17d3d67ae252e26',
      art: 'http://localhost:9080/api/station/vichyradio/art/27e3176b78443a8dfd36bb76-1793540003.jpg',
      custom_fields: [],
      text: 'Desireless - Mega 80 : Le retour de la compilation No. 1 des années 80 - Voyage voyage',
      artist: 'Desireless',
      title: 'Voyage voyage',
      album: 'Mega 80 : Le retour de la compilation No. 1 des années 80',
      genre: 'French Pop',
      isrc: '',
      lyrics: '',
    },
    elapsed: 114,
    remaining: 148,
  },
  playing_next: {
    cued_at: 1793540363,
    played_at: 1793540917,
    duration: 291.40800197628,
    playlist: 'default',
    is_request: false,
    song: {
      id: '102eed62c7f44b0cfa835c1ca7ad38f8',
      art: 'http://localhost:9080/api/station/vichyradio/art/bd634f167a6ca961b6cbc371-1793540003.jpg',
      custom_fields: [],
      text: "France Gall - Ella, elle l'a (Remasterisé en 2004)",
      artist: 'France Gall',
      title: "Ella, elle l'a (Remasterisé en 2004)",
      album: '',
      genre: '',
      isrc: '',
      lyrics: '',
    },
  },
  song_history: [],
  is_online: true,
  cache: null,
};

/**
 * Réponse « en direct » construite d'après la documentation d'AzuraCast (capture réelle à
 * faire pendant un direct RadioDJ) : DJ connecté, titre envoyé par l'encodeur, durée inconnue.
 */
export const LIVE = {
  ...OFF_AIR,
  live: {
    is_live: true,
    streamer_name: 'RadioDJ',
    broadcast_start: 1793541000,
    art: null,
  },
  now_playing: {
    ...OFF_AIR.now_playing,
    played_at: 1793541000,
    duration: 0,
    streamer: 'RadioDJ',
    song: {
      ...OFF_AIR.now_playing.song,
      text: 'Céline Dion - Pour que tu m’aimes encore',
      artist: 'Céline Dion',
      title: 'Pour que tu m’aimes encore',
    },
  },
};

/** Client en mémoire : réponse et erreur réglables, publications du flux à la demande. */
export class MemoryAzuracast implements AzuracastClient {
  np: unknown = OFF_AIR;
  error: Error | null = null;
  reads = 0;
  private listeners: ((m: unknown) => void)[] = [];

  nowPlaying(): Promise<unknown> {
    this.reads++;
    return this.error ? Promise.reject(this.error) : Promise.resolve(this.np);
  }

  subscribe(onMessage: (m: unknown) => void): () => void {
    this.listeners.push(onMessage);
    return () => (this.listeners = this.listeners.filter((l) => l !== onMessage));
  }

  get subscribers(): number {
    return this.listeners.length;
  }

  /** Publication du flux SSE (format Centrifugo). */
  publish(np: unknown): void {
    this.np = np;
    for (const l of this.listeners) l({ pub: { data: { np } } });
  }
}

/** Faux serveur AzuraCast en HTTPS (certificat signé par une autorité de test). */
export class FakeAzuracastServer {
  /** Requêtes reçues : chemin et clé API reçue (null : aucune). */
  readonly requests: { path: string; key: string | null }[] = [];
  status = 200;
  np: unknown = OFF_AIR;
  private streams: ServerResponse[] = [];

  private constructor(
    private readonly server: https.Server,
    readonly port: number,
    /** Certificat racine à fournir au client (AZURACAST_CA_FILE). */
    readonly ca: string,
    private readonly dir: string,
  ) {}

  static async start(): Promise<FakeAzuracastServer> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onair-azuracast-'));
    const tls = await ensureInternalCertificates(dir, ['localhost', '127.0.0.1']);
    let fake: FakeAzuracastServer | null = null;
    const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) =>
      fake!.handle(req.url ?? '', req.headers['x-api-key'], res),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    fake = new FakeAzuracastServer(server, port, tls.rootCaPem!, dir);
    return fake;
  }

  get url(): string {
    return `https://127.0.0.1:${this.port}`;
  }

  private handle(url: string, key: string | string[] | undefined, res: ServerResponse) {
    const p = url.split('?')[0]!;
    this.requests.push({ path: p, key: typeof key === 'string' ? key : null });
    if (this.status !== 200) {
      res.writeHead(this.status, { 'content-type': 'application/json' });
      res.end('{"error":"nope"}');
      return;
    }
    if (p === '/api/live/nowplaying/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const connect = {
        connect: {
          client: 'test',
          subs: { 'station:vichyradio': { publications: [{ data: { np: this.np } }] } },
        },
      };
      res.write(`data: ${JSON.stringify(connect)}\n\n`);
      this.streams.push(res);
      return;
    }
    if (p === '/api/nowplaying/vichyradio') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(this.np));
      return;
    }
    res.writeHead(404).end();
  }

  /** Publication sur les flux SSE ouverts. */
  publish(np: unknown): void {
    this.np = np;
    for (const s of this.streams) s.write(`data: ${JSON.stringify({ pub: { data: { np } } })}\n\n`);
  }

  async close(): Promise<void> {
    for (const s of this.streams) s.destroy();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
