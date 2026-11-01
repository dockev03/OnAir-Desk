/**
 * Protection contre l'usure de l'écran (voir docs/plan-etape-8.md, décision 12) : les éléments
 * fixes se décalent de quelques pixels, par paliers, en parcourant un petit cycle autour de leur
 * place. Appliqué par `transform` (GPU).
 */

/** Paliers successifs, en fractions de l'amplitude. */
const CYCLE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, -0.5],
  [1, 0.5],
  [-0.5, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
  [-1, 1],
];

/** Bandeau et barre latérale : ±4 px, un palier toutes les 2 minutes. */
export const FIXED_SHIFT = { periodMs: 2 * 60_000, amplitudePx: 4 };
/** Écran de veille : dérive plus ample, une fois par minute. */
export const STANDBY_DRIFT = { periodMs: 60_000, amplitudePx: 40 };

/** Décalage (px) à l'instant donné. */
export function burnInShift(
  now: number,
  { periodMs, amplitudePx }: { periodMs: number; amplitudePx: number },
): { x: number; y: number } {
  const [x, y] = CYCLE[Math.floor(now / periodMs) % CYCLE.length]!;
  return { x: x * amplitudePx, y: y * amplitudePx };
}

/** Valeur CSS `transform` d'un décalage. */
export const translate = (s: { x: number; y: number }) => `translate(${s.x}px, ${s.y}px)`;
