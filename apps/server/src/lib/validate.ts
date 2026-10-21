import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Valide une entrée avec un schéma zod ; lève une erreur 400 sans détail interne sinon. */
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw badRequest('invalid_input', fields ? `Champs invalides : ${fields}` : undefined);
  }
  return r.data;
}
