import { defineConfig, devices } from '@playwright/test';

/**
 * Tests de bout en bout de l'écran studio (Chromium). Chaque fichier lance le serveur compilé
 * sur une base temporaire (voir server.ts) : `npm run build` d'abord.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  // Un seul serveur à la fois (port fixe, scénarios de coupure).
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  // Chemins relatifs à ce fichier : rapports à la racine du dépôt (artefacts de la CI).
  outputDir: '../test-results',
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    locale: 'fr-FR',
    trace: 'retain-on-failure',
  },
});
