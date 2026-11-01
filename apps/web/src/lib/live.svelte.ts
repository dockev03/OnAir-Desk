import {
  WS_CLOSE,
  applyAirMessage,
  clockOffset,
  type AirSnapshot,
  type ClientMessage,
  type PrompterState,
  type ServerMessage,
  type Settings,
  type Studio,
} from '@onair-desk/shared';

export type LinkState = 'connecting' | 'online' | 'offline' | 'unauthorized' | 'revoked';

const PING_EVERY_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
/** Nombre de mesures conservées ; on garde celle dont l'aller-retour est le plus court. */
const SAMPLES = 5;

/**
 * Liaison temps réel avec le serveur : heure de référence, paramètres de la station, prompteur
 * et état antenne du studio. Se reconnecte seule ; l'état affiché est conservé pendant les
 * coupures.
 */
export class LiveLink {
  state = $state<LinkState>('connecting');
  settings = $state<Settings | null>(null);
  /** Script affiché sur le prompteur (conservé pendant une coupure). */
  prompter = $state<PrompterState | null>(null);
  /** Studio de cet écran et son état antenne (titre en cours / à venir…). */
  studio = $state<Studio | null>(null);
  air = $state<AirSnapshot | null>(null);
  /** Décalage (ms) à ajouter à Date.now() pour obtenir l'heure serveur. */
  offset = $state(0);
  /** Dernier message reçu du serveur (heure serveur estimée) ; null : jamais. */
  syncedAt = $state<number | null>(null);
  /** Début de la coupure en cours (heure serveur estimée) ; null : liaison établie. */
  offlineSince = $state<number | null>(null);

  private ws: WebSocket | null = null;
  private samples: { rtt: number; offset: number }[] = [];
  private backoff = 1000;
  private pingTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private readonly onAuthLost: (revoked: boolean) => void = () => {}) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** Heure serveur estimée. */
  now(): number {
    return Date.now() + this.offset;
  }

  private connect(): void {
    clearTimeout(this.retryTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/ws`);
    this.ws = ws;
    if (this.state !== 'online') this.state = 'connecting';

    // Les événements d'une ancienne connexion (remplacée ou arrêtée) sont ignorés.
    const current = () => this.ws === ws && !this.stopped;

    ws.onopen = () => {
      if (!current()) return;
      this.backoff = 1000;
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
    };

    ws.onmessage = (ev) => {
      if (!current()) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        this.state = 'online';
        this.offlineSince = null;
        this.settings = msg.settings;
        this.prompter = msg.prompter;
        this.studio = msg.studio;
        this.air = msg.air;
        if (this.samples.length === 0) this.offset = msg.serverTime - Date.now();
      } else if (msg.type === 'settings') {
        this.settings = msg.settings;
      } else if (msg.type === 'prompter') {
        this.prompter = msg.prompter;
      } else if (msg.type === 'air') {
        const next = applyAirMessage(this.air, msg);
        if (next === 'resync') this.send({ type: 'air.sync' });
        else this.air = next;
      } else if (msg.type === 'pong') {
        const t1 = Date.now();
        const sample = { rtt: t1 - msg.t0, offset: clockOffset(msg.t0, msg.serverTime, t1) };
        this.samples = [...this.samples, sample].slice(-SAMPLES);
        this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
      }
      this.syncedAt = this.now();
    };

    ws.onclose = (ev) => {
      if (!current()) return;
      clearInterval(this.pingTimer);
      if (ev.code === WS_CLOSE.revoked || ev.code === WS_CLOSE.unauthorized) {
        // Un appareil révoqué reste affiché comme tel lors des tentatives suivantes.
        const revoked = ev.code === WS_CLOSE.revoked || this.state === 'revoked';
        this.state = revoked ? 'revoked' : 'unauthorized';
        this.onAuthLost(revoked);
        // On continue d'essayer, plus lentement : un nouvel appairage rétablira la liaison.
        this.retryTimer = setTimeout(() => this.connect(), MAX_BACKOFF_MS);
        return;
      }
      this.state = 'offline';
      // Une coupure dure tant que la liaison n'est pas rétablie (essais successifs compris).
      this.offlineSince ??= this.now();
      this.retryTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
  }

  private ping(): void {
    this.send({ type: 'ping', t0: Date.now() });
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
