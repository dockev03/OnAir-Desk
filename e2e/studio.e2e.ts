import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { TestServer, createShowNow, longPress } from './server.js';

/**
 * Écran studio, de bout en bout : appairage, titre en cours (simulateur accéléré), coupure du
 * serveur et reconnexion, sortie de lecture par appui long.
 */
const server = new TestServer();
let api: APIRequestContext;
let token: string;
let scriptId: number;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await server.start();
  api = await server.setupAdmin();
  // Simulateur ×60 : un titre dure 2,5 à 4,5 secondes.
  const settings = await api.put('/api/settings', {
    data: { automationSource: 'simulator', simulatorSpeed: 60 },
  });
  expect(settings.ok()).toBe(true);
  const script = await api.post('/api/scripts', {
    data: {
      ownerId: null,
      title: 'Édito',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour à tous.' }] }],
      },
    },
  });
  scriptId = (await script.json()).id;
  // Émission en cours : sinon l'écran est en veille.
  await createShowNow(api);
  token = (await (await api.post('/api/devices', { data: { name: 'Afficheur' } })).json()).token;
});

test.afterAll(async () => {
  await api?.dispose();
  await server.dispose();
});

let page: Page;

test('appairage par l’adresse du kiosk, horloge et titres', async ({ browser }) => {
  page = await browser.newPage({ baseURL: server.url });
  await page.goto(`/studio#token=${token}`);
  // Le jeton ne reste pas dans l'adresse.
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.locator('.link.online')).toBeVisible();
  await expect(page.locator('.clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(page.getByTestId('now-title')).not.toBeEmpty();
  await expect(page.getByTestId('next-title')).not.toBeEmpty();
  await expect(page.getByRole('progressbar')).toBeVisible();
});

test('le titre en cours change à la fin du titre', async () => {
  const first = await page.getByTestId('now-title').textContent();
  const next = await page.getByTestId('next-title').textContent();
  await expect(page.getByTestId('now-title')).not.toHaveText(first!, { timeout: 10_000 });
  // Le titre annoncé « à venir » est bien celui qui passe ensuite.
  await expect(page.getByTestId('now-title')).toHaveText(next!);
});

test('coupure du serveur : l’affichage reste, puis la liaison revient seule', async () => {
  // La coupure prolongée (30 s) est affichée en grand : le scénario dure plus d'une minute.
  test.setTimeout(120_000);
  await api.post('/api/prompter', { data: { scriptId } });
  await expect(page.getByText('Bonjour à tous.')).toBeVisible();
  await expect(page.getByTestId('last-sync')).toHaveText(/^synchro \d{2}:\d{2}:\d{2}$/);

  await server.stop();
  // Indicateur discret d'abord : point orange, pas de bandeau.
  await expect(page.locator('.link.online')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  // Jamais d'écran blanc : texte et titres restent affichés pendant la coupure.
  await expect(page.getByText('Bonjour à tous.')).toBeVisible();
  await expect(page.getByTestId('now-title')).not.toBeEmpty();
  // Coupure prolongée : affichée en grand, dans le bandeau.
  await expect(page.getByTestId('offline-banner')).toHaveText(/^Connexion perdue depuis 0:3\d$/, {
    timeout: 40_000,
  });
  await expect(page.getByText('Bonjour à tous.')).toBeVisible();

  await server.start();
  // Après 30 s de coupure, les essais de reconnexion sont espacés de 30 s au plus.
  await expect(page.locator('.link.online')).toBeVisible({ timeout: 35_000 });
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  // État antenne resynchronisé : le simulateur a redémarré au premier titre et avance.
  const after = await page.getByTestId('now-title').textContent();
  await expect(page.getByTestId('now-title')).not.toHaveText(after!, { timeout: 10_000 });
  await expect(page.getByText('Bonjour à tous.')).toBeVisible();
});

test('sortie de lecture : un clic ne fait rien, un appui long sort', async () => {
  const exit = page.getByRole('button', { name: /Sortir/ });
  await exit.click();
  await page.waitForTimeout(1500);
  await expect(page.getByText('Bonjour à tous.')).toBeVisible();

  await longPress(page, exit);
  await expect(page.getByText('Bonjour à tous.')).toHaveCount(0);
  // Retour à la navigation : le script reste disponible dans son dossier.
  await expect(page.getByText('Édito')).toBeVisible();
});
