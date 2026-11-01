import type { AutomationConnector, AutomationUpdate, ConnectorContext } from '../types.js';
import { azuracastErrorCode, type AzuracastClient } from './client.js';
import { matchesStation, parseNowPlaying, ssePayloads, toUpdate } from './nowplaying.js';

/** Relecture de l'état : filet si le flux SSE se tait ou ne publie rien. */
export const POLL_MS = 30_000;
/** Titre fini depuis plus de 2 minutes sans nouvelle donnée : il n'est plus affiché. */
export const STALE_AFTER_MS = 2 * 60_000;

/**
 * Connecteur AzuraCast (voir docs/plan-etape-8.md, décisions 1 à 6) : flux SSE pour être
 * prévenu à chaque changement, et relecture de l'état toutes les 30 s. Tout est sortant : aucun
 * port à ouvrir côté OnAir-Desk. Seule la relecture qui échoue est une panne.
 */
export class AzuracastConnector implements AutomationConnector {
  private ctx: ConnectorContext | null = null;
  private poll: ReturnType<typeof setInterval> | undefined;
  private unsubscribe: (() => void) | null = null;
  private stopped = false;
  private lastSent = '';
  /** Dernières données reçues (relecture ou flux), réévaluées à chaque relecture. */
  private last: ReturnType<typeof toUpdate> | null = null;

  constructor(
    private readonly client: AzuracastClient,
    private readonly station: string,
    /** Retard du flux (ms) ajouté à l'heure de début des titres. */
    private readonly delayMs: number,
  ) {}

  async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;
    await this.refresh();
    if (this.stopped) return;
    this.unsubscribe = this.client.subscribe((message) => {
      for (const raw of ssePayloads(message)) this.receive(raw);
    });
    this.poll = setInterval(() => void this.refresh(), POLL_MS);
    this.poll.unref?.();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.poll);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async refresh(): Promise<void> {
    const ctx = this.ctx;
    if (this.stopped || !ctx) return;
    let raw: unknown;
    try {
      raw = await this.client.nowPlaying();
    } catch (err) {
      if (!this.stopped) {
        ctx.fail(`${azuracastErrorCode(err)}: ${(err as Error)?.message ?? String(err)}`);
      }
      return;
    }
    if (this.stopped) return;
    if (!this.receive(raw)) ctx.fail('azuracast_bad_response: unexpected now playing data');
  }

  /** Données « Now Playing » reçues ; faux si elles sont illisibles. */
  private receive(raw: unknown): boolean {
    const ctx = this.ctx;
    if (this.stopped || !ctx) return true;
    const np = parseNowPlaying(raw);
    if (!np) return false;
    // Flux partagé : une publication d'une autre station est ignorée.
    if (!matchesStation(np, this.station)) return true;
    this.last = toUpdate(np, this.delayMs);
    this.send(ctx);
    return true;
  }

  private send(ctx: ConnectorContext): void {
    if (!this.last) return;
    let { nowPlaying } = this.last;
    if (
      nowPlaying?.startedAt != null &&
      nowPlaying.durationMs > 0 &&
      ctx.now() > nowPlaying.startedAt + nowPlaying.durationMs + STALE_AFTER_MS
    ) {
      nowPlaying = null;
    }
    const update: AutomationUpdate = { ...this.last, nowPlaying };
    const key = JSON.stringify(update);
    if (key !== this.lastSent) {
      this.lastSent = key;
      ctx.update(update);
    }
  }
}
