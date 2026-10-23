import type { LOGO_TYPES } from '@onair-desk/shared';

/**
 * Type d'une image d'après son contenu (signature des premiers octets), jamais d'après le nom
 * ou le type annoncé. Seuls PNG, JPEG et WebP sont reconnus : le SVG, qui peut contenir du
 * code, est toujours refusé.
 */
export function detectImageType(data: Buffer): (typeof LOGO_TYPES)[number] | null {
  const starts = (bytes: number[], offset = 0) =>
    data.length >= offset + bytes.length && bytes.every((b, i) => data[offset + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  // « RIFF » + taille sur 4 octets + « WEBP ».
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}
