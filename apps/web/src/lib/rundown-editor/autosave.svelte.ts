import { ApiRequestError, errorCode } from '../api.js';

const AUTOSAVE_MS = 1000;
const RETRY_MS = 5000;

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict';

/**
 * Enregistrement automatique d'un conducteur ou d'un modèle (même principe que l'éditeur de
 * scripts) : une seconde après la dernière modification, nouvel essai si le serveur est
 * injoignable, arrêt en cas de conflit de version.
 */
export class Autosave {
  status = $state<SaveStatus>('saved');
  dirty = false;
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    /** Envoie l'état complet ; lève une ApiRequestError en cas d'échec. */
    private readonly persist: () => Promise<void>,
    private readonly canSave: () => boolean,
    private readonly onerror: (code: string) => void,
  ) {}

  changed(): void {
    if (this.status === 'conflict' || !this.canSave()) return;
    this.dirty = true;
    this.status = 'pending';
    this.schedule(AUTOSAVE_MS);
  }

  /** Enregistre tout de suite ; vrai si tout est enregistré. */
  async save(): Promise<boolean> {
    clearTimeout(this.timer);
    if (!this.dirty || this.status === 'conflict') return !this.dirty;
    if (this.saving) {
      this.schedule(300);
      return false;
    }
    this.saving = true;
    this.dirty = false;
    this.status = 'saving';
    try {
      await this.persist();
      if (!this.dirty) this.status = 'saved';
      return true;
    } catch (e) {
      this.dirty = true;
      if (e instanceof ApiRequestError && e.code === 'version_conflict') {
        this.status = 'conflict';
      } else if (e instanceof ApiRequestError && e.status === 0) {
        this.status = 'offline';
        this.schedule(RETRY_MS);
      } else {
        this.status = 'pending';
        this.onerror(errorCode(e));
      }
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** Après un rechargement : plus rien à enregistrer. */
  reset(): void {
    clearTimeout(this.timer);
    this.dirty = false;
    this.status = 'saved';
  }

  /** « Garder ma version » après un conflit : la version a été mise à jour par l'appelant. */
  async force(): Promise<boolean> {
    this.status = 'pending';
    this.dirty = true;
    return this.save();
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), ms);
  }
}
