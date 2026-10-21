import { hash, verify } from '@node-rs/argon2';

// Argon2id avec les paramètres recommandés par l'OWASP (19 Mio, 2 passes).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Vérification factice quand le compte n'existe pas : la réponse prend le même temps,
 * ce qui empêche de deviner les identifiants existants.
 */
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('onair-desk-dummy-password');
  await verifyPassword(await dummyHash, password);
  return false;
}
