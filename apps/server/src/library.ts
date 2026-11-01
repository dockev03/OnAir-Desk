import {
  countWords,
  cueSeconds,
  docToText,
  emptyDoc,
  type LibraryOwner,
  type PrompterRundown,
  type PrompterScript,
  type PrompterSendInput,
  type PrompterState,
  type Script,
  type ScriptDoc,
} from '@onair-desk/shared';
import { studioOf, type Identity } from './auth/identity.js';
import type { Repos, RundownRecord, ScriptRecord, User } from './db/index.js';
import { badRequest, conflict, forbidden, notFound } from './lib/errors.js';
import type { Hub } from './ws/hub.js';

/** Profondeur maximale des dossiers (dossier racine = 1). */
export const MAX_FOLDER_DEPTH = 6;
/** Durée au-delà de laquelle un enregistrement conserve une nouvelle version. */
export const REVISION_INTERVAL_MS = 10 * 60_000;

/**
 * Règles de la bibliothèque (validées avec l'utilisateur) :
 * - tout le monde lit tout (comptes et écran studio) ;
 * - un animateur modifie son dossier et Commun (ownerId null) ;
 * - un admin modifie tout.
 */
export function canWrite(user: User, ownerId: number | null): boolean {
  return user.role === 'admin' || ownerId === null || ownerId === user.id;
}

export class Library {
  constructor(
    private readonly repos: Repos,
    private readonly hub: Hub,
  ) {}

  owners(identity: Identity): LibraryOwner[] {
    const me = identity.kind === 'user' ? identity.user : null;
    const others = this.repos.users
      .list()
      .filter((u) => u.isActive && u.id !== me?.id)
      .map((u) => ({
        id: u.id,
        name: u.displayName,
        isMe: false,
        canWrite: me ? canWrite(me, u.id) : false,
      }));
    return [
      ...(me ? [{ id: me.id, name: me.displayName, isMe: true, canWrite: true }] : []),
      { id: null, name: '', isMe: false, canWrite: me !== null },
      ...others,
    ];
  }

  assertWrite(user: User, ownerId: number | null): void {
    if (ownerId !== null && !this.repos.users.findById(ownerId)) throw badRequest('unknown_owner');
    if (!canWrite(user, ownerId)) throw forbidden('read_only_folder');
  }

  /** Vérifie qu'un dossier existe et appartient au propriétaire donné. */
  assertFolder(folderId: number | null | undefined, ownerId: number | null): void {
    if (folderId === null || folderId === undefined) return;
    const folder = this.repos.folders.findById(folderId);
    if (!folder || folder.ownerId !== ownerId) throw badRequest('bad_folder');
  }

  /** Script hors corbeille, ou 404. */
  getLive(id: number): ScriptRecord {
    const s = this.repos.scripts.findById(id);
    if (!s || s.deletedAt) throw notFound();
    return s;
  }

  toScript(record: ScriptRecord, identity: Identity): Script {
    const { contentText: _t, createdAt: _c, updatedBy: _u, deletedAt: _d, ...rest } = record;
    return {
      ...rest,
      canWrite: identity.kind === 'user' && canWrite(identity.user, record.ownerId),
    };
  }

  contentFields(content: ScriptDoc) {
    const contentText = docToText(content);
    return {
      content,
      contentText,
      wordCount: countWords(contentText),
      cueSeconds: cueSeconds(content),
    };
  }

  createScript(
    user: User,
    input: {
      ownerId: number | null;
      folderId?: number | null;
      title: string;
      content?: ScriptDoc;
      speedWpm?: number;
    },
  ): ScriptRecord {
    this.assertWrite(user, input.ownerId);
    this.assertFolder(input.folderId, input.ownerId);
    return this.repos.scripts.create({
      ownerId: input.ownerId,
      folderId: input.folderId ?? null,
      title: input.title,
      ...this.contentFields(input.content ?? emptyDoc()),
      speedWpm: input.speedWpm ?? this.repos.settings.get().defaultSpeedWpm,
      userId: user.id,
    });
  }

  /**
   * Enregistrement d'un script. L'état précédent est conservé comme version quand une autre
   * personne reprend le script, ou si la dernière version date de plus de 10 minutes.
   */
  saveScript(
    user: User,
    id: number,
    input: {
      version: number;
      title?: string;
      content?: ScriptDoc;
      speedWpm?: number;
      folderId?: number | null;
    },
  ): ScriptRecord {
    return this.repos.db.transaction(() => {
      const current = this.getLive(id);
      this.assertWrite(user, current.ownerId);
      if (input.version !== current.version) throw conflict('version_conflict');
      if (input.folderId !== undefined) this.assertFolder(input.folderId, current.ownerId);

      const changesText = input.title !== undefined || input.content !== undefined;
      if (changesText && this.shouldSnapshot(current, user.id)) {
        this.repos.scripts.snapshot(current, current.updatedBy);
      }
      const updated = this.repos.scripts.update(id, user.id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? this.contentFields(input.content) : {}),
        ...(input.speedWpm !== undefined ? { speedWpm: input.speedWpm } : {}),
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      });
      this.prompterRefresh(updated);
      return updated;
    })();
  }

  private shouldSnapshot(current: ScriptRecord, userId: number): boolean {
    // Script jamais rempli : rien qui mérite d'être conservé.
    if (current.wordCount === 0 && current.version === 1) return false;
    if (current.updatedBy !== userId) return true;
    const last = this.repos.scripts.lastRevisionAt(current.id) ?? current.createdAt;
    return Date.now() - Date.parse(last) >= REVISION_INTERVAL_MS;
  }

  restoreRevision(user: User, id: number, revisionId: number, version: number): ScriptRecord {
    return this.repos.db.transaction(() => {
      const current = this.getLive(id);
      this.assertWrite(user, current.ownerId);
      if (version !== current.version) throw conflict('version_conflict');
      const revision = this.repos.scripts.findRevision(id, revisionId);
      if (!revision) throw notFound();
      // L'état actuel est toujours conservé : une restauration ne fait rien perdre.
      this.repos.scripts.snapshot(current, current.updatedBy);
      const updated = this.repos.scripts.update(id, user.id, {
        title: revision.title,
        ...this.contentFields(revision.content),
      });
      this.prompterRefresh(updated);
      return updated;
    })();
  }

  trashScript(user: User, id: number): void {
    this.repos.db.transaction(() => {
      const current = this.getLive(id);
      this.assertWrite(user, current.ownerId);
      this.repos.scripts.snapshot(current, current.updatedBy);
      this.repos.scripts.trash(id, user.id);
    })();
    // Le texte reste affiché (jamais d'écran blanc), signalé comme supprimé.
    this.prompterRefresh(this.repos.scripts.findById(id)!);
  }

  restoreFromTrash(user: User, id: number): ScriptRecord {
    const s = this.repos.scripts.findById(id);
    if (!s?.deletedAt) throw notFound();
    this.assertWrite(user, s.ownerId);
    this.repos.scripts.restore(id);
    const restored = this.repos.scripts.findById(id)!;
    this.prompterRefresh(restored);
    return restored;
  }

  deleteForever(user: User, id: number): void {
    const s = this.repos.scripts.findById(id);
    if (!s?.deletedAt) throw notFound();
    this.assertWrite(user, s.ownerId);
    const followed = this.studioIds().map((studio) => this.repos.prompter.get(studio).rundownId);
    this.repos.scripts.delete(id);
    // Les éléments qui l'utilisaient perdent leur script : copie du conducteur à jour.
    for (const rundownId of new Set(followed))
      if (rundownId !== null) this.rundownRefresh(rundownId);
  }

  // ---- Prompteur ------------------------------------------------------------------

  private studioIds(): number[] {
    return this.repos.studios.list().map((s) => s.id);
  }

  prompterState(studioId: number): PrompterState {
    const { scriptId: _s, rundownId: _r, ...state } = this.repos.prompter.get(studioId);
    return state;
  }

  /**
   * Affiche un script, un élément de conducteur, ou vide l'écran du studio de l'appelant ;
   * possible depuis un compte ou un écran kiosk.
   */
  sendToPrompter(identity: Identity, input: PrompterSendInput): PrompterState {
    const studioId = studioOf(identity);
    const by =
      identity.kind === 'user' ? { userId: identity.user.id } : { deviceId: identity.device.id };
    if ('rundownId' in input) {
      const rundown = this.repos.rundowns.findById(input.rundownId);
      if (!rundown || rundown.deletedAt) throw notFound();
      const item = rundown.items.find((i) => i.uid === input.itemUid);
      if (!item) throw badRequest('unknown_item');
      // Élément sans script (titre, pub…) ou script mis à la corbeille : carte seule.
      const record =
        item.scriptId === null ? undefined : this.repos.scripts.findById(item.scriptId);
      const script = record && !record.deletedAt ? toPrompterScript(record) : null;
      this.repos.prompter.send(studioId, script, by, {
        rundown: toPrompterRundown(rundown),
        itemUid: item.uid,
      });
    } else {
      const script =
        input.scriptId === null ? null : toPrompterScript(this.getLive(input.scriptId));
      this.repos.prompter.send(studioId, script, by);
    }
    this.broadcastPrompter(studioId);
    return this.prompterState(studioId);
  }

  /** Si le script est affiché ou dans le conducteur suivi, l'écran reçoit la nouvelle version. */
  private prompterRefresh(record: ScriptRecord): void {
    for (const studioId of this.studioIds()) {
      const state = this.repos.prompter.get(studioId);
      let changed = false;
      if (state.scriptId === record.id) {
        this.repos.prompter.refresh(studioId, toPrompterScript(record), record.deletedAt !== null);
        changed = true;
      }
      // Les durées du conducteur dépendent du script (nombre de mots, repères, vitesse).
      if (state.rundown?.items.some((i) => i.scriptId === record.id)) {
        changed = this.refreshRundownSnapshot(studioId, state.rundownId) || changed;
      }
      if (changed) this.broadcastPrompter(studioId);
    }
  }

  /** Si le conducteur est suivi sur un écran studio, cet écran reçoit sa nouvelle version. */
  rundownRefresh(rundownId: number): void {
    for (const studioId of this.studioIds()) {
      if (this.refreshRundownSnapshot(studioId, rundownId)) this.broadcastPrompter(studioId);
    }
  }

  private refreshRundownSnapshot(studioId: number, rundownId: number | null): boolean {
    if (rundownId === null || this.repos.prompter.get(studioId).rundownId !== rundownId) {
      return false;
    }
    const rundown = this.repos.rundowns.findById(rundownId);
    if (!rundown) return false;
    this.repos.prompter.refreshRundown(studioId, toPrompterRundown(rundown));
    return true;
  }

  broadcastPrompter(studioId: number): void {
    this.hub.broadcastStudio(studioId, {
      type: 'prompter',
      prompter: this.prompterState(studioId),
    });
  }

  /** Purge quotidienne de la corbeille (scripts, conducteurs et modèles). */
  purgeTrash(): number {
    return (
      this.repos.scripts.purgeTrash().length +
      this.repos.rundowns.purgeTrash().length +
      this.repos.templates.purgeTrash().length
    );
  }
}

const toPrompterScript = (r: ScriptRecord): PrompterScript => ({
  id: r.id,
  title: r.title,
  content: r.content,
  speedWpm: r.speedWpm,
  version: r.version,
  ownerId: r.ownerId,
  folderId: r.folderId,
});

const toPrompterRundown = (r: RundownRecord): PrompterRundown => ({
  id: r.id,
  ownerId: r.ownerId,
  title: r.title,
  airDate: r.airDate,
  startTime: r.startTime,
  layout: r.layout,
  items: r.items,
});
