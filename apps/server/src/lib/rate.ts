/**
 * Limite de débit par clé (compte) sur une fenêtre glissante d'une minute : contre les erreurs
 * de manipulation et les abus (voir docs/plan-etape-10.md, décision 4).
 */
export class RateCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Compte un envoi ; faux si la limite est atteinte (l'envoi est alors refusé). */
  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
