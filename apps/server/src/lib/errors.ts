/** Erreur métier renvoyée telle quelle au client, avec un code stable pour l'interface. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code = 'invalid_input', message?: string) =>
  new HttpError(400, code, message);
export const unauthorized = () => new HttpError(401, 'unauthorized');
export const forbidden = (code = 'forbidden') => new HttpError(403, code);
export const notFound = () => new HttpError(404, 'not_found');
export const conflict = (code: string) => new HttpError(409, code);
export const tooManyRequests = () => new HttpError(429, 'rate_limited');
