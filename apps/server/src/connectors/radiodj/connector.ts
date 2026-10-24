import type { Track } from '@onair-desk/shared';
import { zonedToEpoch } from '../../lib/time.js';
import type { AutomationConnector, AutomationUpdate, ConnectorContext } from '../types.js';
import { displayArtist, toTrack, type SongRow } from './cues.js';
import { radiodjErrorCode, type RadiodjReader } from './reader.js';

/** Relecture de la base : filet si un signal se perd, et changements de la file d'attente. */
export const POLL_MS = 1_000;
/** Relectures rapprochées après un signal : la ligne d'historique peut arriver juste après. */
export const SIGNAL_RETRIES_MS = [100, 250, 500, 1_000, 2_000];
/** Un signal sert d'heure de début s'il précède de moins de 10 s la découverte du titre. */
export const SIGNAL_WINDOW_MS = 10_000;
/** Nom comparable d'un titre : casse, accents, ponctuation et séparateurs ignorés. */
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** Le signal « Artiste - Titre » du plugin désigne-t-il ce titre de la base ? */
export function signalMatches(signal: string, row: SongRow): boolean {
  const s = normalize(signal);
  if (!s) return false;
  return [row.artist, displayArtist(row.artist)].some((a) => normalize(a + row.title) === s);
}

/** Au-delà de sa fin + 30 s sans nouveau titre (RadioDJ arrêté), le titre n'est plus affiché. */
export const STALE_AFTER_MS = 30_000;

/**
 * Connecteur RadioDJ : la base fait foi (voir docs/plan-etape-7.md, décisions 1 à 6).
 * Le plugin « Metadata Export » ne fait que signaler qu'un titre démarre ; le connecteur
 * relit alors la base aussitôt, et de toute façon toutes les secondes. Si le signal désigne
 * le titre à venir, celui-ci passe en cours sans attendre la base (affichage instantané).
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
  /** Premier titre de la file à la dernière lecture (passé en cours par un signal). */
  private nextRow: SongRow | null = null;
  /** Titre passé en cours par un signal, en attendant sa ligne d'historique. */
  private early: Track | null = null;

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
  signal(receivedAt: number, title = ''): void {
    if (this.stopped) return;
    this.signalAt = receivedAt;
    if (this.ctx && this.nextRow && signalMatches(title, this.nextRow)) {
      // Titre attendu : affiché tout de suite, la base confirmera.
      this.early = toTrack(this.nextRow, receivedAt);
      this.send(this.ctx, { nowPlaying: this.early, next: null });
    }
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

    this.nextRow = nextRow;

    if (row && row.id !== this.historyId) {
      this.historyId = row.id;
      this.current = toTrack(row, this.startTime(row.datePlayed, now));
      this.early = null;
    } else if (!row) {
      this.historyId = null;
      this.current = null;
    }

    let nowPlaying = this.current;
    let next = nextRow ? toTrack(nextRow, null) : null;
    if (this.early && now - this.early.startedAt! > SIGNAL_WINDOW_MS) this.early = null;
    if (this.early) {
      // Ligne d'historique pas encore écrite : on garde le titre signalé, sans le répéter à venir.
      nowPlaying = this.early;
      if (next?.title === this.early.title && next.artist === this.early.artist) next = null;
    }
    if (
      nowPlaying?.startedAt != null &&
      now > nowPlaying.startedAt + nowPlaying.durationMs + STALE_AFTER_MS
    ) {
      nowPlaying = null;
    }
    this.send(ctx, { nowPlaying, next });
  }

  /** Transmet au cœur, seulement si quelque chose a changé. */
  private send(ctx: ConnectorContext, update: AutomationUpdate): void {
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
    const signal = this.early?.startedAt ?? this.signalAt;
    this.signalAt = null;
    if (signal !== null && now - signal >= 0 && now - signal <= SIGNAL_WINDOW_MS) return signal;
    const played = zonedToEpoch(datePlayed, this.timezone);
    return played === null ? now : Math.min(played, now);
  }
}
