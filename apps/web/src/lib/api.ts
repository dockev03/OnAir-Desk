import type { ApiError } from '@onair-desk/shared';

/** Erreur renvoyée par l'API, avec son code stable (voir les messages error.*). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(method: Method, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : null,
    });
  } catch {
    throw new ApiRequestError(0, 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) throw new ApiRequestError(res.status, data.error ?? 'generic');
  return data;
}

export const errorCode = (e: unknown): string =>
  e instanceof ApiRequestError ? e.code : 'generic';
