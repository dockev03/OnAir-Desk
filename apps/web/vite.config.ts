import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Navigateur récent sur l'afficheur : pas besoin de transpiler pour de vieux navigateurs.
    target: 'es2022',
  },
  server: {
    // En développement, l'API tourne à part (npm run dev:server) : on la relaie.
    proxy: {
      '/api': { target: 'http://localhost:8443', ws: true },
    },
  },
});
