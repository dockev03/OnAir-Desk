// Construit le serveur en un seul fichier (le paquet partagé est inclus, les dépendances non).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts', 'src/healthcheck.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  // Le paquet partagé est en TypeScript : il doit être inclus dans le fichier produit.
  plugins: [
    {
      name: 'bundle-shared',
      setup(b) {
        b.onResolve({ filter: /^@onair-desk\/shared$/ }, () => ({
          path: new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
        }));
      },
    },
  ],
  sourcemap: true,
  logLevel: 'info',
});
