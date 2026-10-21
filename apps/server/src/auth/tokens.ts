import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Secret aléatoire (session, jeton d'appareil), encodé en base64url. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Haché stocké en base : un vol de la base ne donne pas accès aux sessions ni aux appareils. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** Comparaison à temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Sans caractères ambigus (0/O, 1/I/L) : le code est recopié à la main depuis les logs.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code d'installation lisible, ex. « K7QM-2XRP-9HWD ». */
export function readableCode(groups = 3, size = 4): string {
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let s = '';
    for (let i = 0; i < size; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    parts.push(s);
  }
  return parts.join('-');
}

export const normalizeCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
