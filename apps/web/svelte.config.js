import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Application monopage : le serveur Fastify renvoie index.html pour toute URL hors /api.
    adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: true }),
    version: { pollInterval: 0 },
  },
};
