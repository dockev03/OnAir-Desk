/**
 * Limite les échecs de connexion par identifiant (en complément de la limite par IP) :
 * après `maxFailures` échecs dans la fenêtre, l'identifiant est bloqué pour `lockMs`.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; first: number; until: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isLocked(key: string): boolean {
    const f = this.failures.get(key);
    return f !== undefined && f.until > this.now();
  }

  fail(key: string): void {
    const t = this.now();
    let f = this.failures.get(key);
    if (!f || t - f.first > this.windowMs) {
      f = { count: 0, first: t, until: 0 };
      this.failures.set(key, f);
    }
    f.count++;
    if (f.count >= this.maxFailures) f.until = t + this.lockMs;
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  /** Nettoyage périodique des entrées expirées. */
  prune(): void {
    const t = this.now();
    for (const [k, f] of this.failures) {
      if (f.until <= t && t - f.first > this.windowMs) this.failures.delete(k);
    }
  }
}
