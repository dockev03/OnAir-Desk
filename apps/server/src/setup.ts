import { normalizeCode, readableCode, safeEqual } from './auth/tokens.js';

/**
 * Code d'installation à usage unique. Tant qu'aucun compte n'existe, il est régénéré
 * à chaque démarrage et affiché uniquement dans les logs du conteneur.
 */
export class SetupState {
  private code: string | null = null;

  /** Génère un code si nécessaire et le renvoie (null si l'installation est faite). */
  ensure(needsSetup: boolean): string | null {
    if (!needsSetup) {
      this.code = null;
      return null;
    }
    this.code ??= readableCode();
    return this.code;
  }

  check(candidate: string): boolean {
    return this.code !== null && safeEqual(normalizeCode(candidate), normalizeCode(this.code));
  }

  complete(): void {
    this.code = null;
  }
}
