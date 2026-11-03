import {
  REHEARSALS_KEPT,
  REHEARSAL_MAX_MS,
  RUN_CLOSE_AFTER_MS,
  STANDBY_MARGIN_MS,
  addDays,
  canDirect,
  itemSeconds,
  localDateIn,
  runReport,
  showInProgress,
  timeToSeconds,
  zonedToEpoch,
  type RehearsalSummary,
  type RunForReport,
  type RunItem,
  type RunReport,
  type RunState,
  type AirState,
  type Track,
} from '@onair-desk/shared';
import type { AirStateStore } from './air/state.js';
import { studioOf, type Identity } from './auth/identity.js';
import type { Actor } from './db/audit.js';
import type { Repos, RundownRecord, RunRecord, RunSnapshot, User } from './db/index.js';
import { badRequest, conflict, forbidden, notFound } from './lib/errors.js';
import { canWrite, type Library } from './library.js';

/** Vérification périodique : clôture automatique des déroulés et des répétitions. */
const TICK_MS = 15_000;

/** Artiste / titre comparés sans casse, accents ni espaces superflus. */
export const normalizeTitle = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const toRunItems = (rundown: RundownRecord): RunItem[] =>
  rundown.items.map((i) => ({
    uid: i.uid,
    title: i.title,
    typeId: i.typeId,
    artist: i.artist,
    plannedSeconds: itemSeconds(i),
    cuttable: i.cuttable,
  }));

/**
 * Déroulés (voir docs/plan-etape-11.md, décisions 1 à 4, 16 à 20) : heures réelles de passage
 * des éléments d'un conducteur à l'antenne ou en répétition.
 * - Un déroulé d'antenne démarre seul quand l'écran studio affiche un élément d'un conducteur
 *   dont l'émission est en cours ; chaque nouvel élément affiché est pointé (premier passage
 *   seulement). Les titres musicaux sont aussi pointés par l'automation (décision 3).
 * - Clôture : un autre conducteur démarre, la fin de l'émission + 30 min est passée, ou
 *   « Clore l'émission ». Un déroulé clos ne se rouvre pas : le bilan est figé.
 * - Répétition : heures comptées depuis son lancement, sans toucher au On Air ni au bilan.
 */
export class RunService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repos: Repos,
    private readonly air: AirStateStore,
    private readonly library: Library,
    private readonly now: () => number = Date.now,
  ) {
    library.prompterListeners.push((studioId) => this.onPrompter(studioId));
    library.rundownListeners.push((rundownId) => this.onRundownChanged(rundownId));
    air.listen((studioId, diff, state) => this.onAir(studioId, diff, state));
  }

  /** Reporte le déroulé en cours dans l'état antenne et lance la vérification périodique. */
  start(studioId: number): void {
    this.publish(studioId);
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---- État antenne ------------------------------------------------------------------

  toState(run: RunRecord): RunState {
    return {
      id: run.id,
      rundownId: run.rundownId,
      title: run.snapshot.title,
      rehearsal: run.rehearsal,
      startedAt: run.startedAt,
      baseAt: run.baseAt,
      endAt: run.endAt,
      items: run.snapshot.items,
      passages: run.passages,
    };
  }

  private publish(studioId: number): void {
    const run = this.repos.runs.findActive(studioId);
    this.air.update(studioId, { run: run ? this.toState(run) : null });
  }

  // ---- Heures de référence -------------------------------------------------------------

  /** Début prévu de l'émission et fin imposée (horloge serveur, ms). */
  private antennaTimes(r: { airDate: string; startTime: string; endTime: string | null }) {
    const tz = this.repos.settings.get().timezone;
    const baseAt = zonedToEpoch(`${r.airDate} ${r.startTime}`, tz);
    const endAt = r.endTime === null ? null : zonedToEpoch(`${r.airDate} ${r.endTime}`, tz);
    return { baseAt, endAt };
  }

  /** Répétition : fin imposée décalée comme l'heure de référence. */
  private rehearsalEnd(baseAt: number, r: { startTime: string; endTime: string | null }) {
    return r.endTime === null
      ? null
      : baseAt + (timeToSeconds(r.endTime) - timeToSeconds(r.startTime)) * 1000;
  }

  /** Fin de la fenêtre d'un déroulé d'antenne : fin calculée ou imposée, la plus tardive. */
  private showEnd(run: Pick<RunRecord, 'baseAt' | 'endAt' | 'snapshot'>): number {
    const total = run.snapshot.items.reduce((s, i) => s + i.plannedSeconds * 1000, 0);
    return Math.max(run.baseAt + total, run.endAt ?? 0);
  }

  /** Émission en cours d'après les heures des conducteurs proches (veille, étape 8). */
  private showNow(): number | null {
    const tz = this.repos.settings.get().timezone;
    const today = localDateIn(this.now(), tz);
    const nearby = this.repos.rundowns
      .listSummaries()
      .filter((r) => r.airDate >= addDays(today, -1) && r.airDate <= today);
    return showInProgress(nearby, this.now(), tz)?.id ?? null;
  }

  // ---- Pointage par l'écran -------------------------------------------------------------

  /** L'écran du studio affiche autre chose : pointage, démarrage ou sortie du conducteur. */
  onPrompter(studioId: number): void {
    const p = this.repos.prompter.get(studioId);
    const now = this.now();
    let active = this.repos.runs.findActive(studioId);
    const shown = p.rundownId !== null && p.itemUid !== null ? p.rundownId : null;

    if (active && shown === active.rundownId) {
      this.point(active, p.itemUid!, now, 'screen');
      this.publish(studioId);
      return;
    }
    // L'écran quitte le conducteur du déroulé : fin possible du dernier élément.
    if (active && active.leftAt === null) {
      this.repos.runs.setLeft(active.id, now);
    }
    if (shown !== null && (!active || !active.rehearsal)) {
      const rundown = this.repos.rundowns.findById(shown);
      if (rundown && !rundown.deletedAt && this.canStart(rundown)) {
        if (active) this.close(active, { type: 'system' }, 'replaced');
        active = this.begin(studioId, rundown);
        this.point(active, p.itemUid!, now, 'screen');
      }
    }
    this.publish(studioId);
  }

  /**
   * Un déroulé d'antenne peut démarrer : émission en cours (début − 10 min → fin + 10 min) et
   * jamais déroulée (un déroulé clos ne se rouvre pas).
   */
  private canStart(rundown: RundownRecord): boolean {
    const { baseAt, endAt } = this.antennaTimes(rundown);
    if (baseAt === null) return false;
    const total = toRunItems(rundown).reduce((s, i) => s + i.plannedSeconds * 1000, 0);
    const end = Math.max(baseAt + total, endAt ?? 0);
    const now = this.now();
    if (now < baseAt - STANDBY_MARGIN_MS || now > end + STANDBY_MARGIN_MS) return false;
    return this.repos.runs.findAntenna(rundown.id) === undefined;
  }

  private snapshotOf(rundown: RundownRecord): RunSnapshot {
    const items = toRunItems(rundown);
    return {
      title: rundown.title,
      airDate: rundown.airDate,
      startTime: rundown.startTime,
      endTime: rundown.endTime,
      items,
      removed: [],
      initialUids: items.map((i) => i.uid),
    };
  }

  private begin(studioId: number, rundown: RundownRecord): RunRecord {
    const { baseAt, endAt } = this.antennaTimes(rundown);
    const run = this.repos.runs.create({
      rundownId: rundown.id,
      studioId,
      rehearsal: false,
      startedAt: this.now(),
      baseAt: baseAt!,
      endAt,
      snapshot: this.snapshotOf(rundown),
    });
    this.repos.audit.write(
      { type: 'system' },
      'run.started',
      { runId: run.id, rundownId: rundown.id, title: rundown.title },
      studioId,
    );
    return run;
  }

  /**
   * Pointe un élément (premier passage seulement). Avant l'heure de début de l'émission
   * (préparation), l'élément affiché compte comme démarré à l'heure de début, et seul le
   * dernier affiché compte.
   */
  private point(run: RunRecord, uid: string, at: number, source: 'screen' | 'automation'): void {
    if (!run.snapshot.items.some((i) => i.uid === uid)) return;
    if (run.leftAt !== null) this.repos.runs.setLeft(run.id, null);
    if (!run.rehearsal && at < run.baseAt) {
      if (source === 'automation') return;
      this.repos.runs.clearPassages(run.id);
      this.repos.runs.addPassage(run.id, uid, run.baseAt, source);
      return;
    }
    this.repos.runs.addPassage(run.id, uid, at, source);
  }

  // ---- Pointage par l'automation (décision 3) -----------------------------------------

  private onAir(studioId: number, diff: Partial<AirState>, state: AirState): void {
    if (diff.onAir?.on) this.onAirSwitchedOn(studioId);
    if ('nowPlaying' in diff && state.nowPlaying) this.onTrack(studioId, state.nowPlaying, state);
  }

  /**
   * Un titre démarre : l'élément « titre » du conducteur à l'antenne qui a le même artiste et
   * le même titre est pointé à l'heure de démarrage réelle. Seulement pour la source du direct
   * (bascule active) ; jamais en répétition.
   */
  private onTrack(studioId: number, track: Track, state: AirState): void {
    const run = this.repos.runs.findActive(studioId);
    if (!run || run.rehearsal) return;
    const settings = this.repos.settings.get();
    if (settings.airSwitch.enabled && !state.live?.active) return;
    const artist = normalizeTitle(track.artist);
    const title = normalizeTitle(track.title);
    if (!artist || !title) return;
    const passed = new Set(run.passages.map((p) => p.uid));
    const item = run.snapshot.items.find(
      (i) =>
        !passed.has(i.uid) &&
        i.artist.trim() !== '' &&
        normalizeTitle(i.artist) === artist &&
        normalizeTitle(i.title) === title,
    );
    if (!item) return;
    const at = Math.max(track.startedAt ?? this.now(), run.baseAt);
    this.repos.runs.addPassage(run.id, item.uid, at, 'automation');
    this.publish(studioId);
  }

  // ---- Conducteur modifié --------------------------------------------------------------

  /** Le conducteur d'un déroulé en cours a changé : éléments, heures et fin imposée suivent. */
  onRundownChanged(rundownId: number): void {
    for (const studio of this.repos.studios.list()) {
      const run = this.repos.runs.findActive(studio.id);
      if (!run || run.rundownId !== rundownId) continue;
      const rundown = this.repos.rundowns.findById(rundownId);
      if (!rundown) continue;
      const items = toRunItems(rundown);
      const kept = new Set(items.map((i) => i.uid));
      const passed = new Set(run.passages.map((p) => p.uid));
      const removed = [
        ...run.snapshot.removed.filter((r) => !kept.has(r.uid)),
        ...run.snapshot.items.filter(
          (i) =>
            !kept.has(i.uid) &&
            passed.has(i.uid) &&
            !run.snapshot.removed.some((r) => r.uid === i.uid),
        ),
      ];
      const snapshot: RunSnapshot = {
        ...run.snapshot,
        title: rundown.title,
        airDate: rundown.airDate,
        startTime: rundown.startTime,
        endTime: rundown.endTime,
        items,
        removed,
      };
      let baseAt = run.baseAt;
      let endAt: number | null;
      if (run.rehearsal) {
        endAt = this.rehearsalEnd(run.baseAt, rundown);
      } else {
        const t = this.antennaTimes(rundown);
        baseAt = t.baseAt ?? run.baseAt;
        endAt = t.endAt;
      }
      this.repos.runs.updateSnapshot(run.id, snapshot, baseAt, endAt);
      this.publish(studio.id);
    }
  }

  // ---- Clôture --------------------------------------------------------------------------

  private close(run: RunRecord, actor: Actor, reason: string): void {
    const at = this.now();
    this.repos.runs.close(run.id, at);
    this.repos.audit.write(
      actor,
      run.rehearsal ? 'rehearsal.stopped' : 'run.closed',
      { runId: run.id, rundownId: run.rundownId, title: run.snapshot.title, reason },
      run.studioId,
    );
  }

  /** Clôtures automatiques : fin de l'émission + 30 min, répétition trop longue ou gênante. */
  tick(): void {
    const now = this.now();
    for (const studio of this.repos.studios.list()) {
      const run = this.repos.runs.findActive(studio.id);
      if (!run) {
        if (this.air.get(studio.id).state.run) this.publish(studio.id);
        continue;
      }
      if (run.rehearsal) {
        if (now - run.startedAt > REHEARSAL_MAX_MS) {
          this.close(run, { type: 'system' }, 'timeout');
        } else if (this.showNow() !== null) {
          this.close(run, { type: 'system' }, 'show');
        } else continue;
      } else if (now > this.showEnd(run) + RUN_CLOSE_AFTER_MS) {
        this.close(run, { type: 'system' }, 'timeout');
      } else continue;
      this.publish(studio.id);
    }
  }

  private onAirSwitchedOn(studioId: number): void {
    const run = this.repos.runs.findActive(studioId);
    if (!run?.rehearsal) return;
    this.close(run, { type: 'system' }, 'onair');
    this.publish(studioId);
  }

  /** « Clore l'émission » : propriétaire du conducteur, réalisateur ou admin. */
  closeRun(user: User, runId: number): void {
    const run = this.repos.runs.findById(runId);
    if (!run || run.rehearsal) throw notFound();
    if (run.endedAt !== null) throw conflict('run_closed');
    const rundown = this.repos.rundowns.findById(run.rundownId);
    if (!canDirect(user) && !(rundown && canWrite(user, rundown.ownerId))) throw forbidden();
    this.close(run, { type: 'user', id: user.id }, 'manual');
    this.publish(run.studioId);
  }

  // ---- Répétition (décisions 16 à 18) ------------------------------------------------

  startRehearsal(identity: Identity, rundownId: number): RunState {
    const studioId = studioOf(identity);
    const settings = this.repos.settings.get();
    if (identity.kind === 'device' && !settings.timeTracking.kioskRehearsal) {
      throw forbidden('rehearsal_kiosk_disabled');
    }
    const rundown = this.repos.rundowns.findById(rundownId);
    if (!rundown || rundown.deletedAt) throw notFound();
    const first = rundown.items[0];
    if (!first) throw badRequest('rundown_empty');
    // Jamais pendant une émission : ni On Air allumé, ni émission en cours, ni déroulé.
    const active = this.repos.runs.findActive(studioId);
    if (
      this.air.get(studioId).state.onAir.on ||
      this.showNow() !== null ||
      (active && !active.rehearsal)
    ) {
      throw conflict('rehearsal_on_air');
    }
    const actor: Actor =
      identity.kind === 'user'
        ? { type: 'user', id: identity.user.id }
        : { type: 'device', id: identity.device.id };
    if (active) this.close(active, actor, 'replaced');
    const now = this.now();
    const run = this.repos.runs.create({
      rundownId,
      studioId,
      rehearsal: true,
      startedAt: now,
      baseAt: now,
      endAt: this.rehearsalEnd(now, rundown),
      snapshot: this.snapshotOf(rundown),
    });
    this.repos.runs.pruneRehearsals(rundownId, REHEARSALS_KEPT);
    this.repos.audit.write(
      actor,
      'rehearsal.started',
      { runId: run.id, rundownId, title: rundown.title },
      studioId,
    );
    // L'écran affiche le premier élément : il est pointé au lancement.
    this.library.sendToPrompter(identity, { rundownId, itemUid: first.uid });
    return this.toState(this.repos.runs.findById(run.id)!);
  }

  stopRehearsal(identity: Identity): void {
    const studioId = studioOf(identity);
    const run = this.repos.runs.findActive(studioId);
    if (!run?.rehearsal) return;
    if (identity.kind === 'device' && !this.repos.settings.get().timeTracking.kioskRehearsal) {
      throw forbidden('rehearsal_kiosk_disabled');
    }
    this.close(
      run,
      identity.kind === 'user'
        ? { type: 'user', id: identity.user.id }
        : { type: 'device', id: identity.device.id },
      'manual',
    );
    this.publish(studioId);
  }

  // ---- Bilan ------------------------------------------------------------------------------

  private forReport(run: RunRecord): RunForReport {
    return {
      id: run.id,
      rehearsal: run.rehearsal,
      startedAt: run.startedAt,
      baseAt: run.baseAt,
      endAt: run.endAt,
      endedAt: run.endedAt,
      // Le dernier élément s'arrête à la sortie de l'écran du conducteur, sinon à la clôture.
      lastEnd: run.leftAt ?? run.endedAt,
      items: run.snapshot.items,
      removed: run.snapshot.removed,
      initialUids: run.snapshot.initialUids,
      passages: run.passages,
    };
  }

  /** Bilan du déroulé d'antenne d'un conducteur (null : jamais passé à l'antenne). */
  report(rundownId: number): { report: RunReport; active: boolean; runId: number } | null {
    const run = this.repos.runs.findAntenna(rundownId);
    if (!run) return null;
    return { report: runReport(this.forReport(run)), active: run.endedAt === null, runId: run.id };
  }

  /** Répétitions terminées : durées mesurées par élément. */
  rehearsals(rundownId: number): RehearsalSummary[] {
    return this.repos.runs.listRehearsals(rundownId).map((run) => {
      const r = runReport(this.forReport(run));
      return {
        runId: run.id,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        totalSeconds: Math.round(
          ((run.leftAt ?? run.endedAt ?? run.startedAt) - run.baseAt) / 1000,
        ),
        items: r.lines
          .filter((l) => !l.removed)
          .map((l) => ({
            uid: l.uid,
            title: l.title,
            plannedSeconds: l.plannedSeconds,
            measuredSeconds: l.actualSeconds,
          })),
      };
    });
  }
}
