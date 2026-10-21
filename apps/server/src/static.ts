import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/** Empreintes CSP des scripts en ligne de la page (le démarrage de SvelteKit en contient un). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.push(`'sha256-${createHash('sha256').update(m[1]!, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/** Page d'entrée de l'interface compilée, ou null si l'interface n'a pas été construite. */
export function readIndexHtml(webDir: string): string | null {
  const indexFile = path.join(webDir, 'index.html');
  return fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : null;
}

/** Sert l'interface compilée. Toute URL hors /api renvoie index.html (application monopage). */
export async function registerStatic(
  app: FastifyInstance,
  webDir: string,
  indexHtml: string | null,
): Promise<void> {
  if (indexHtml === null) {
    app.log.warn(`Interface non trouvée dans ${webDir} : seule l'API est servie.`);
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
    return;
  }

  await app.register(fastifyStatic, {
    root: webDir,
    index: false,
    wildcard: false,
    setHeaders(res, file) {
      // Les fichiers de _app/immutable ont un nom qui change à chaque version.
      res.header(
        'cache-control',
        file.includes(`${path.sep}immutable${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });

  // @fastify/static (wildcard: false) n'enregistre que les fichiers présents au démarrage.
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url === '/api') {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(indexHtml);
  });
}
