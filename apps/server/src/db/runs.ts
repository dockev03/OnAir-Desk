import type { Passage, PassageSource, RunItem } from '@onair-desk/shared';
import type { Db } from './database.js';

/** Conducteur figé dans un déroulé : le bilan ne change plus après la clôture. */
export interface RunSnapshot {
  title: string;
  airDate: string;
  startTime: string;
  endTime: string | null;
  items: RunItem[];
  /** Éléments retirés du conducteur après leur passage (gardés pour le bilan). */
  removed: RunItem[];
  /** Éléments présents au début du déroulé. */
  initialUids: string[];
}

export interface RunRecord {
  id: number;
  rundownId: number;
  studioId: number;
  rehearsal: boolean;
  startedAt: number;
  baseAt: number;
  endAt: number | null;
  endedAt: number | null;
  /** L'écran a quitté le conducteur (fin du dernier élément), sauf s'il y est revenu. */
  leftAt: number | null;
  snapshot: RunSnapshot;
  passages: Passage[];
}

interface Row {
  id: number;
  rundown_id: number;
  studio_id: number;
  rehearsal: 0 | 1;
  started_at: number;
  base_at: number;
  end_at: number | null;
  ended_at: number | null;
  left_at: number | null;
  snapshot: string;
}

const EMPTY_SNAPSHOT: RunSnapshot = {
  title: '',
  airDate: '',
  startTime: '00:00:00',
  endTime: null,
  items: [],
  removed: [],
  initialUids: [],
};

/** Déroulés (passages à l'antenne et répétitions) et heures réelles de passage. */
export class RunRepo {
  constructor(private readonly db: Db) {}

  private toRecord(r: Row): RunRecord {
    let snapshot = EMPTY_SNAPSHOT;
    try {
      snapshot = { ...EMPTY_SNAPSHOT, ...(JSON.parse(r.snapshot) as Partial<RunSnapshot>) };
    } catch {
      // Contenu illisible : le déroulé reste lisible, sans ses éléments.
    }
    const passages = (
      this.db
        .prepare(
          'SELECT uid, started_at, source FROM rundown_run_items WHERE run_id = ? ORDER BY started_at, rowid',
        )
        .all(r.id) as { uid: string; started_at: number; source: PassageSource }[]
    ).map((p) => ({ uid: p.uid, at: p.started_at, source: p.source }));
    return {
      id: r.id,
      rundownId: r.rundown_id,
      studioId: r.studio_id,
      rehearsal: r.rehearsal === 1,
      startedAt: r.started_at,
      baseAt: r.base_at,
      endAt: r.end_at,
      endedAt: r.ended_at,
      leftAt: r.left_at,
      snapshot,
      passages,
    };
  }

  findById(id: number): RunRecord | undefined {
    const r = this.db.prepare('SELECT * FROM rundown_runs WHERE id = ?').get(id) as Row | undefined;
    return r && this.toRecord(r);
  }

  /** Déroulé en cours sur ce studio (un seul à la fois). */
  findActive(studioId: number): RunRecord | undefined {
    const r = this.db
      .prepare(
        'SELECT * FROM rundown_runs WHERE studio_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
      )
      .get(studioId) as Row | undefined;
    return r && this.toRecord(r);
  }

  /** Déroulé d'antenne d'un conducteur (le plus récent). */
  findAntenna(rundownId: number): RunRecord | undefined {
    const r = this.db
      .prepare(
        'SELECT * FROM rundown_runs WHERE rundown_id = ? AND rehearsal = 0 ORDER BY id DESC LIMIT 1',
      )
      .get(rundownId) as Row | undefined;
    return r && this.toRecord(r);
  }

  /** Répétitions terminées d'un conducteur, la plus récente d'abord. */
  listRehearsals(rundownId: number): RunRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM rundown_runs WHERE rundown_id = ? AND rehearsal = 1
             AND ended_at IS NOT NULL ORDER BY id DESC`,
        )
        .all(rundownId) as Row[]
    ).map((r) => this.toRecord(r));
  }

  create(run: {
    rundownId: number;
    studioId: number;
    rehearsal: boolean;
    startedAt: number;
    baseAt: number;
    endAt: number | null;
    snapshot: RunSnapshot;
  }): RunRecord {
    const info = this.db
      .prepare(
        `INSERT INTO rundown_runs (rundown_id, studio_id, rehearsal, started_at, base_at, end_at,
                                   snapshot)
         VALUES (@rundownId, @studioId, @rehearsal, @startedAt, @baseAt, @endAt, @snapshot)`,
      )
      .run({
        ...run,
        rehearsal: run.rehearsal ? 1 : 0,
        snapshot: JSON.stringify(run.snapshot),
      });
    return this.findById(Number(info.lastInsertRowid))!;
  }

  updateSnapshot(id: number, snapshot: RunSnapshot, baseAt: number, endAt: number | null): void {
    this.db
      .prepare('UPDATE rundown_runs SET snapshot = ?, base_at = ?, end_at = ? WHERE id = ?')
      .run(JSON.stringify(snapshot), baseAt, endAt, id);
  }

  /** Premier passage d'un élément ; un passage déjà enregistré ne change pas. */
  addPassage(id: number, uid: string, at: number, source: PassageSource): boolean {
    return (
      this.db
        .prepare(
          'INSERT OR IGNORE INTO rundown_run_items (run_id, uid, started_at, source) VALUES (?, ?, ?, ?)',
        )
        .run(id, uid, at, source).changes > 0
    );
  }

  /** Efface les passages (préparation avant l'heure de début : seul le dernier compte). */
  clearPassages(id: number): void {
    this.db.prepare('DELETE FROM rundown_run_items WHERE run_id = ?').run(id);
  }

  setLeft(id: number, at: number | null): void {
    this.db.prepare('UPDATE rundown_runs SET left_at = ? WHERE id = ?').run(at, id);
  }

  close(id: number, at: number): void {
    this.db
      .prepare('UPDATE rundown_runs SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
      .run(at, id);
  }

  /** Ne garde que les `keep` dernières répétitions d'un conducteur. */
  pruneRehearsals(rundownId: number, keep: number): void {
    this.db
      .prepare(
        `DELETE FROM rundown_runs WHERE rundown_id = ? AND rehearsal = 1 AND id NOT IN (
           SELECT id FROM rundown_runs WHERE rundown_id = ? AND rehearsal = 1
            ORDER BY id DESC LIMIT ?)`,
      )
      .run(rundownId, rundownId, keep);
  }
}
