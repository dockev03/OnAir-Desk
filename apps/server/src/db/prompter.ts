import type { PrompterRundown, PrompterScript, PrompterState } from '@onair-desk/shared';
import type { Db } from './database.js';
import { nowIso } from '../lib/time.js';

interface Row {
  script_id: number | null;
  snapshot: string | null;
  deleted: 0 | 1;
  sent_at: string | null;
  sent_by_name: string | null;
  rundown_id: number | null;
  item_uid: string | null;
  rundown_snapshot: string | null;
}

/** Auteur d'un affichage : un compte ou un écran kiosk. */
export type PrompterSender = { userId: number } | { deviceId: number };

/** Élément de conducteur affiché : copie du conducteur et uid de l'élément. */
export interface PrompterRundownChoice {
  rundown: PrompterRundown;
  itemUid: string;
}

/**
 * Script (et éventuellement conducteur) affiché sur l'écran de chaque studio, conservé en
 * base pour survivre à un redémarrage.
 */
export class PrompterRepo {
  constructor(private readonly db: Db) {}

  /** La ligne du studio est créée au premier usage (studio ajouté après la migration). */
  private ensure(studioId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO prompter_state (studio_id) VALUES (?)').run(studioId);
  }

  get(studioId: number): PrompterState & { scriptId: number | null; rundownId: number | null } {
    this.ensure(studioId);
    const r = this.db
      .prepare(
        `SELECT p.*, COALESCE(u.display_name, d.name) AS sent_by_name
           FROM prompter_state p
           LEFT JOIN users u ON u.id = p.sent_by
           LEFT JOIN devices d ON d.id = p.sent_by_device
          WHERE p.studio_id = ?`,
      )
      .get(studioId) as Row;
    return {
      scriptId: r.script_id,
      rundownId: r.rundown_id,
      script: r.snapshot ? (JSON.parse(r.snapshot) as PrompterScript) : null,
      rundown: r.rundown_snapshot ? (JSON.parse(r.rundown_snapshot) as PrompterRundown) : null,
      itemUid: r.item_uid,
      deleted: r.deleted === 1,
      sentAt: r.sent_at,
      sentByName: r.sent_by_name,
    };
  }

  /**
   * Affiche un script (ou vide l'écran avec null). Avec un conducteur : l'élément choisi,
   * dont le script peut être absent (titre, pub…).
   */
  send(
    studioId: number,
    script: PrompterScript | null,
    by: PrompterSender,
    choice: PrompterRundownChoice | null = null,
  ): void {
    this.ensure(studioId);
    this.db
      .prepare(
        `UPDATE prompter_state
            SET script_id = ?, snapshot = ?, deleted = 0, sent_by = ?, sent_by_device = ?,
                sent_at = ?, rundown_id = ?, item_uid = ?, rundown_snapshot = ?
          WHERE studio_id = ?`,
      )
      .run(
        script?.id ?? null,
        script ? JSON.stringify(script) : null,
        'userId' in by ? by.userId : null,
        'deviceId' in by ? by.deviceId : null,
        nowIso(),
        choice?.rundown.id ?? null,
        choice?.itemUid ?? null,
        choice ? JSON.stringify(choice.rundown) : null,
        studioId,
      );
  }

  /** Met à jour la copie du conducteur suivi (élément ajouté, durée modifiée…). */
  refreshRundown(studioId: number, rundown: PrompterRundown): void {
    this.db
      .prepare('UPDATE prompter_state SET rundown_snapshot = ? WHERE studio_id = ?')
      .run(JSON.stringify(rundown), studioId);
  }

  /** Met à jour la copie affichée (modification du script, restauration…). */
  refresh(studioId: number, script: PrompterScript, deleted: boolean): void {
    this.db
      .prepare('UPDATE prompter_state SET snapshot = ?, deleted = ? WHERE studio_id = ?')
      .run(JSON.stringify(script), deleted ? 1 : 0, studioId);
  }
}
