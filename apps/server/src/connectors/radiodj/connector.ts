import { zonedToEpoch, type Track } from '@onair-desk/shared';
import type { AutomationConnector, AutomationUpdate, ConnectorContext } from '../types.js';
import { toTrack } from './cues.js';
import { radiodjErrorCode, type RadiodjReader } from './reader.js';

/** Relecture de la base : filet si un signal se perd, et changements de la file d'attente. */
export const POLL_MS = 5_000;
/** Relectures rapprochées après un signal : la ligne d'historique peut arriver juste après. */
export const SIGNAL_RETRIES_MS = [500, 1_500, 3_000];
/** Un signal sert d'heure de début s'il précède de moins de 10 s la découverte du titre. */
export const SIGNAL_WINDOW_MS = 10_000;
/** Au-delà de sa fin + 30 s sans nouveau titre (RadioDJ arrêté), le titre n'est plus affiché. */
export const STALE_AFTER_MS = 30_000;

/**
 * Connecteur RadioDJ : la base fait foi (voir docs/plan-etape-7.md, décisions 1 à 6).
 * Le plugin « Metadata Export » ne fait que signaler qu'un titre démarre ; le connecteur
 * relit alors la base aussitôt, et de toute façon toutes les 5 s.
 */
export class RadiodjConnector implements AutomationConnector {
  private ctx: ConnectorContext | null = null;
  private poll: ReturnType<typeof setInterval> | undefined;
  private retries: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;
  private reading = false;
  private again = false;
  /** Dernière ligne d'historique vue, et le titre qui en a été tiré. */
  private historyId: number | null = null;
  private current: Track | null = null;
  /** Heure (serveur) du dernier signal pas encore rattaché à un titre. */
  private signalAt: number | null = null;
  private lastSent = '';

  constructor(
    private readonly reader: RadiodjReader,
    /** Fuseau de la station : celui de `date_played` (horloge du PC RadioDJ). */
    private readonly timezone: string,
  ) {}

  async start(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;
    await this.refresh();
    if (this.stopped) return;
    this.poll = setInterval(() => void this.refresh(), POLL_MS);
    this.poll.unref?.();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.poll);
    for (const t of this.retries) clearTimeout(t);
    this.retries = [];
    this.reader.close().catch(() => {
      // Lot de connexions déjà fermé ou base injoignable : rien à faire.
    });
  }

  /** Le plugin signale qu'un titre démarre (heure de réception, horloge serveur). */
  signal(receivedAt: number): void {
    if (this.stopped) return;
    this.signalAt = receivedAt;
    void this.refresh();
    for (const t of this.retries) clearTimeout(t);
    this.retries = SIGNAL_RETRIES_MS.map((delay) => {
      const t = setTimeout(() => void this.refresh(), delay);
      t.unref?.();
      return t;
    });
  }

  /** Une seule lecture à la fois ; une demande pendant une lecture en relance une après. */
  private async refresh(): Promise<void> {
    if (this.stopped || !this.ctx) return;
    if (this.reading) {
      this.again = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.again = false;
        await this.read(this.ctx);
      } while (this.again && !this.stopped);
    } catch (err) {
      if (!this.stopped) {
        const message = (err as Error)?.message ?? String(err);
        this.ctx.fail(`${radiodjErrorCode(err)}: ${message}`);
      }
    } finally {
      this.reading = false;
    }
  }

  private async read(ctx: ConnectorContext): Promise<void> {
    const [row, nextRow] = await Promise.all([this.reader.current(), this.reader.next()]);
    if (this.stopped) return;
    const now = ctx.now();

    if (row && row.id !== this.historyId) {
      this.historyId = row.id;
      this.current = toTrack(row, this.startTime(row.datePlayed, now));
    } else if (!row) {
      this.historyId = null;
      this.current = null;
    }

    let nowPlaying = this.current;
    if (
      nowPlaying?.startedAt != null &&
      now > nowPlaying.startedAt + nowPlaying.durationMs + STALE_AFTER_MS
    ) {
      nowPlaying = null;
    }
    const update: AutomationUpdate = {
      nowPlaying,
      next: nextRow ? toTrack(nextRow, null) : null,
    };
    const key = JSON.stringify(update);
    if (key !== this.lastSent) {
      this.lastSent = key;
      ctx.update(update);
    }
  }

  /**
   * Heure de début d'un titre découvert : l'heure du signal s'il vient d'arriver (horloge
   * serveur, la plus précise), sinon `date_played` (horloge du PC RadioDJ, à la seconde).
   */
  private startTime(datePlayed: string, now: number): number {
    const signal = this.signalAt;
    this.signalAt = null;
    if (signal !== null && now - signal >= 0 && now - signal <= SIGNAL_WINDOW_MS) return signal;
    const played = zonedToEpoch(datePlayed, this.timezone);
    return played === null ? now : Math.min(played, now);
  }
}
