import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { TestServer } from './server.js';

/**
 * Étape 7 : alerte de fin de titre (orange puis rouge), compte à rebours d'intro, et écoute
 * dédiée aux connecteurs (signal du plugin RadioDJ). Les alertes valent pour toute source :
 * elles sont vérifiées avec le simulateur.
 */
const CONNECTOR_PORT = 3198;
const server = new TestServer(3199, { CONNECTOR_HTTP_PORT: String(CONNECTOR_PORT) });
let api: APIRequestContext;
let token: string;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await server.start();
  api = await server.setupAdmin();
  token = (await (await api.post('/api/devices', { data: { name: 'Afficheur' } })).json()).token;
});

test.afterAll(async () => {
  await api?.dispose();
  await server.dispose();
});

test('talk-over : compte à rebours de l’intro, qui disparaît à la fin de l’intro', async ({
  browser,
}) => {
  // Temps réel : le premier titre du simulateur a 12 s d'intro.
  const res = await api.put('/api/settings', {
    data: { automationSource: 'simulator', simulatorSpeed: 1 },
  });
  expect(res.ok()).toBe(true);
  page = await browser.newPage({ baseURL: server.url });
  await page.goto(`/studio#token=${token}`);
  const nowBlock = page.locator('section.now');
  await expect(page.getByTestId('intro-left')).toHaveText(/^Intro 0:\d{2}$/);
  // Pendant l'intro, tout le bloc « Titre en cours » passe au bleu.
  await expect(nowBlock).toHaveClass(/\btalkover\b/);
  await expect(page.getByTestId('intro-left')).toHaveCount(0, { timeout: 15_000 });
  await expect(nowBlock).not.toHaveClass(/\btalkover\b/);
  // Repères intro et outro sur la barre de progression.
  await expect(page.locator('.bar .mark')).toHaveCount(2);
});

test('alerte de fin de titre : rien, puis orange « Bientôt à vous », puis rouge', async () => {
  // ×10 : titres de 15 à 27 s ; seuils réduits pour les voir passer.
  const res = await api.put('/api/settings', {
    data: { simulatorSpeed: 10, trackAlert: { soonSeconds: 12, nowSeconds: 5 } },
  });
  expect(res.ok()).toBe(true);
  const block = page.getByRole('region', { name: 'Titre en cours' });
  await expect(block).toHaveAttribute('data-alert', 'none', { timeout: 10_000 });
  await expect(page.getByTestId('track-alert')).toHaveCount(0);

  await expect(block).toHaveAttribute('data-alert', 'soon', { timeout: 30_000 });
  await expect(page.getByTestId('track-alert')).toHaveText('Bientôt à vous');

  await expect(block).toHaveAttribute('data-alert', 'now', { timeout: 10_000 });
  await expect(page.getByTestId('track-alert')).toHaveText(/^À vous dans [0-5] s$/);
  // Titre suivant : l'alerte retombe.
  await expect(block).toHaveAttribute('data-alert', 'none', { timeout: 10_000 });
});

test('écoute des connecteurs : seul le signal au bon jeton est accepté', async () => {
  const ingest = `http://127.0.0.1:${CONNECTOR_PORT}/api/connectors/radiodj`;
  const form = (body: Record<string, string>) =>
    fetch(ingest, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: new URLSearchParams(body).toString(),
    });

  expect((await form({ title: 'César - Libertà' })).status).toBe(401);

  const created = await (await api.post('/api/settings/radiodj/token')).json();
  expect((await form({ xpwd: 'faux', title: 'A - B' })).status).toBe(401);
  const ok = await form({ xpwd: created.token, title: 'César - Libertà' });
  expect(ok.status).toBe(200);
  // Source choisie : simulateur, le signal est reçu mais ignoré.
  expect(await ok.json()).toEqual({ ok: true, accepted: false });

  // L'interface n'est pas servie sur ce port, et la route n'existe pas sur le port principal.
  expect((await fetch(`http://127.0.0.1:${CONNECTOR_PORT}/studio`)).status).toBe(404);
  const main = await fetch(`${server.url}/api/connectors/radiodj`, {
    method: 'POST',
    headers: { origin: server.url },
  });
  expect(main.status).toBe(404);
});
