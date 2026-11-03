import { randomUUID } from 'node:crypto';
import {
  LOGBOOK_BACKDATE_MAX_MS,
  LOGBOOK_NOTES_PER_MINUTE,
  MAX_DUPLEX_LINES,
  REGIE_SEND_PER_MINUTE,
  activeMessage,
  type DuplexLine,
  type DuplexState,
  type LogbookNoteInput,
  type RegieKind,
  type RegieMessage,
  type RegieState,
} from '@onair-desk/shared';
import type { AirStateStore } from './air/state.js';
import type { Repos, User } from './db/index.js';
import { badRequest, conflict, notFound, tooManyRequests } from './lib/errors.js';
import { RateCounter } from './lib/rate.js';

/** Contenu d'un message envoyé à l'écran studio. */
export interface RegieSend {
  kind: RegieKind;
  text: string;
  urgent: boolean;
  /** Ordre rapide ou carte de liner d'origine. */
  ref?: string;
}

/**
 * Régie (voir docs/plan-etape-10.md) : message affiché sur l'écran studio, accusé « Vu »,
 * lignes de duplex et notes de main courante. Un état par studio, conservé en base et reporté
 * dans l'état antenne ; chaque action est tracée au journal (catégorie « régie »). Les droits
 * sont vérifiés par les routes ; le débit, ici.
 */
export class RegieService {
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly sends: RateCounter;
  private readonly notes: RateCounter;

  constructor(
    private readonly repos: Repos,
    private readonly air: AirStateStore,
    private readonly now: () => number = Date.now,
  ) {
    this.sends = new RateCounter(REGIE_SEND_PER_MINUTE, 60_000, now);
    this.notes = new RateCounter(LOGBOOK_NOTES_PER_MINUTE, 60_000, now);
  }

  /** Reporte l'état conservé dans l'état antenne (démarrage du serveur). */
  restore(studioId: number): void {
    const state = this.repos.regie.get(studioId);
    if (state.message && !activeMessage(state, this.now())) state.message = null;
    this.commit(studioId, state);
  }

  get(studioId: number): RegieState {
    return this.repos.regie.get(studioId);
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // ---- Messages et ordres -------------------------------------------------------------

  /** Affiche un message (remplace le précédent). */
  send(studioId: number, user: User, input: RegieSend): RegieMessage {
    this.throttle(this.sends, user);
    const at = this.now();
    const ttl = this.repos.settings.get().regie.messageTtlMinutes * 60_000;
    const message: RegieMessage = {
      id: randomUUID(),
      kind: input.kind,
      text: input.text,
      urgent: input.urgent,
      sentAt: at,
      byName: user.displayName,
      expiresAt: at + ttl,
      seenAt: null,
    };
    this.commit(studioId, { ...this.repos.regie.get(studioId), message });
    this.repos.audit.write(
      { type: 'user', id: user.id },
      input.kind === 'message' ? 'regie.message_sent' : 'regie.order_sent',
      {
        id: message.id,
        kind: input.kind,
        text: input.text,
        urgent: input.urgent,
        ...(input.ref ? { ref: input.ref } : {}),
      },
      studioId,
    );
    return message;
  }

  /** Efface le message affiché ; rien à effacer : sans effet. */
  clear(studioId: number, user: User): void {
    this.throttle(this.sends, user);
    const state = this.repos.regie.get(studioId);
    if (!activeMessage(state, this.now())) {
      if (state.message) this.commit(studioId, { ...state, message: null });
      return;
    }
    this.commit(studioId, { ...state, message: null });
    this.repos.audit.write(
      { type: 'user', id: user.id },
      'regie.message_cleared',
      { id: state.message!.id, text: state.message!.text },
      studioId,
    );
  }

  /** Accusé « Vu » depuis l'écran studio : seulement le message affiché, une seule fois. */
  seen(studioId: number, deviceId: number, id: string): RegieMessage {
    const state = this.repos.regie.get(studioId);
    const message = activeMessage(state, this.now());
    if (!message || message.id !== id) throw notFound();
    if (message.seenAt !== null) return message;
    const seen = { ...message, seenAt: this.now() };
    this.commit(studioId, { ...state, message: seen });
    this.repos.audit.write(
      { type: 'device', id: deviceId },
      'regie.message_seen',
      { id, text: message.text },
      studioId,
    );
    return seen;
  }

  // ---- Duplex -------------------------------------------------------------------------

  addDuplex(studioId: number, user: User, name: string): DuplexLine {
    this.throttle(this.sends, user);
    const state = this.repos.regie.get(studioId);
    if (state.duplex.length >= MAX_DUPLEX_LINES) throw conflict('duplex_limit');
    const line: DuplexLine = { id: randomUUID(), name, state: 'waiting', changedAt: this.now() };
    this.commit(studioId, { ...state, duplex: [...state.duplex, line] });
    this.duplexAudit(studioId, user, { action: 'created', name, state: line.state });
    return line;
  }

  updateDuplex(
    studioId: number,
    user: User,
    id: string,
    patch: { name?: string | undefined; state?: DuplexState | undefined },
  ): DuplexLine {
    this.throttle(this.sends, user);
    const state = this.repos.regie.get(studioId);
    const current = state.duplex.find((l) => l.id === id);
    if (!current) throw notFound();
    const next: DuplexLine = {
      ...current,
      name: patch.name ?? current.name,
      state: patch.state ?? current.state,
      changedAt: patch.state && patch.state !== current.state ? this.now() : current.changedAt,
    };
    if (next.name === current.name && next.state === current.state) return current;
    this.commit(studioId, {
      ...state,
      duplex: state.duplex.map((l) => (l.id === id ? next : l)),
    });
    this.duplexAudit(studioId, user, {
      action: 'updated',
      name: next.name,
      state: next.state,
      ...(next.state !== current.state ? { from: current.state } : {}),
      ...(next.name !== current.name ? { previousName: current.name } : {}),
    });
    return next;
  }

  removeDuplex(studioId: number, user: User, id: string): void {
    this.throttle(this.sends, user);
    const state = this.repos.regie.get(studioId);
    const line = state.duplex.find((l) => l.id === id);
    if (!line) throw notFound();
    this.commit(studioId, { ...state, duplex: state.duplex.filter((l) => l.id !== id) });
    this.duplexAudit(studioId, user, { action: 'removed', name: line.name });
  }

  /** « Tout effacer » en fin d'émission. */
  clearDuplex(studioId: number, user: User): void {
    this.throttle(this.sends, user);
    const state = this.repos.regie.get(studioId);
    if (state.duplex.length === 0) return;
    this.commit(studioId, { ...state, duplex: [] });
    this.duplexAudit(studioId, user, { action: 'cleared', count: state.duplex.length });
  }

  // ---- Main courante ------------------------------------------------------------------

  /** Note de main courante, rattachée au conducteur suivi à ce moment (s'il y en a un). */
  addNote(
    studioId: number,
    user: User,
    input: LogbookNoteInput,
    rundownId: number | null,
  ): { at: number } {
    this.throttle(this.notes, user);
    const now = this.now();
    const at = input.at ?? now;
    // Heure corrigée : dans les 2 dernières heures, pas dans le futur (1 min de tolérance).
    if (at < now - LOGBOOK_BACKDATE_MAX_MS || at > now + 60_000) throw badRequest('note_time');
    this.repos.audit.write(
      { type: 'user', id: user.id },
      'logbook.note',
      { text: input.text, noteAt: Math.min(at, now), rundownId },
      studioId,
    );
    return { at: Math.min(at, now) };
  }

  // ---- Interne ------------------------------------------------------------------------

  private throttle(counter: RateCounter, user: User): void {
    if (!counter.take(String(user.id))) throw tooManyRequests();
  }

  private duplexAudit(studioId: number, user: User, details: Record<string, unknown>): void {
    this.repos.audit.write({ type: 'user', id: user.id }, 'duplex.changed', details, studioId);
  }

  /** Enregistre, reporte dans l'état antenne et programme l'expiration du message. */
  private commit(studioId: number, state: RegieState): void {
    this.repos.regie.set(studioId, state, this.now());
    this.air.update(studioId, { regie: state });
    clearTimeout(this.timers.get(studioId));
    this.timers.delete(studioId);
    const message = state.message;
    if (message) {
      const delay = Math.max(0, message.expiresAt - this.now());
      const timer = setTimeout(() => {
        this.timers.delete(studioId);
        const current = this.repos.regie.get(studioId);
        if (current.message?.id === message.id)
          this.commit(studioId, { ...current, message: null });
      }, delay);
      timer.unref();
      this.timers.set(studioId, timer);
    }
  }
}
