import type { PrompterScript, PrompterState } from '@onair-desk/shared';
import type { Db } from './database.js';
import { nowIso } from '../lib/time.js';

interface Row {
  script_id: number | null;
  snapshot: string | null;
  deleted: 0 | 1;
  sent_at: string | null;
  sent_by_name: string | null;
}

/** Auteur d'un affichage : un compte ou un écran kiosk. */
export type PrompterSender = { userId: number } | { deviceId: number };

/** Script affiché sur l'écran studio, conservé en base pour survivre à un redémarrage. */
export class PrompterRepo {
  constructor(private readonly db: Db) {}

  get(): PrompterState & { scriptId: number | null } {
    const r = this.db
      .prepare(
        `SELECT p.*, COALESCE(u.display_name, d.name) AS sent_by_name
           FROM prompter_state p
           LEFT JOIN users u ON u.id = p.sent_by
           LEFT JOIN devices d ON d.id = p.sent_by_device
          WHERE p.id = 1`,
      )
      .get() as Row;
    return {
      scriptId: r.script_id,
      script: r.snapshot ? (JSON.parse(r.snapshot) as PrompterScript) : null,
      deleted: r.deleted === 1,
      sentAt: r.sent_at,
      sentByName: r.sent_by_name,
    };
  }

  /** Affiche un script (ou vide l'écran avec null). */
  send(script: PrompterScript | null, by: PrompterSender): void {
    this.db
      .prepare(
        `UPDATE prompter_state
            SET script_id = ?, snapshot = ?, deleted = 0, sent_by = ?, sent_by_device = ?, sent_at = ?
          WHERE id = 1`,
      )
      .run(
        script?.id ?? null,
        script ? JSON.stringify(script) : null,
        'userId' in by ? by.userId : null,
        'deviceId' in by ? by.deviceId : null,
        nowIso(),
      );
  }

  /** Met à jour la copie affichée (modification du script, restauration…). */
  refresh(script: PrompterScript, deleted: boolean): void {
    this.db
      .prepare('UPDATE prompter_state SET snapshot = ?, deleted = ? WHERE id = 1')
      .run(JSON.stringify(script), deleted ? 1 : 0);
  }

  markDeleted(): void {
    this.db.prepare('UPDATE prompter_state SET deleted = 1 WHERE id = 1').run();
  }
}
