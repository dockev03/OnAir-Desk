import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { TestServer, longPress } from './server.js';

/**
 * Conducteur enrichi, de bout en bout : numéro des titres, artiste, année, intro, étiquettes,
 * élément à couper et notes générales, sur l'écran studio et à l'impression.
 */
const server = new TestServer();
let api: APIRequestContext;
let token: string;
let rundownId: number;

test.describe.configure({ mode: 'serial' });

const item = (uid: string, over: object) => ({
  uid,
  typeId: 'titre',
  title: uid,
  durationSeconds: 200,
  notes: '',
  scriptId: null,
  ...over,
});

test.beforeAll(async () => {
  await server.start();
  api = await server.setupAdmin();
  const res = await api.post('/api/rundowns', {
    data: {
      ownerId: null,
      title: 'Flashback',
      airDate: '2026-10-27',
      startTime: '20:00',
      notes: 'Prises d’antenne entre 45 secondes et 1 minute.',
      items: [
        item('jingle', { typeId: 'jingle', title: 'Jingle d’ouverture', durationSeconds: 10 }),
        item('t1', {
          title: 'One More Time',
          artist: 'Daft Punk',
          year: 2000,
          introSeconds: 12,
          durationSeconds: 235,
        }),
        item('t2', {
          title: 'Freed from Desire',
          artist: 'Gala',
          year: 1996,
          tags: ['fr'],
          cuttable: true,
        }),
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  rundownId = (await res.json()).id;
  token = (await (await api.post('/api/devices', { data: { name: 'Afficheur' } })).json()).token;
});

test.afterAll(async () => {
  await api?.dispose();
  await server.dispose();
});

let page: Page;

test('écran studio : détails sur la carte de l’élément, puis dans la liste', async ({
  browser,
}) => {
  page = await browser.newPage({ baseURL: server.url });
  await page.goto(`/studio#token=${token}`);
  await expect(page.locator('.link.online')).toBeVisible();
  const sent = await api.post('/api/prompter', { data: { rundownId, itemUid: 't1' } });
  expect(sent.ok()).toBe(true);

  await expect(page.getByText('Daft Punk · 2000')).toBeVisible();
  await expect(page.getByText('intro 0:12')).toBeVisible();
  await expect(page.getByText('20:00:10')).toBeVisible();

  // Appui long sur « Conducteur » : retour à la liste.
  const back = page.getByRole('button', { name: /Conducteur/ });
  await longPress(page, back);

  const row = page.locator('.row', { hasText: 'Freed from Desire' });
  await expect(row).toBeVisible();
  await expect(row.locator('.num')).toHaveText('2');
  await expect(row).toContainText('Gala');
  await expect(row.locator('.tag')).toHaveText('FR');
  await expect(row.locator('.cut')).toBeVisible();
  // Le jingle n'est pas un titre musical : pas de numéro.
  await expect(page.locator('.row', { hasText: 'Jingle' }).locator('.num')).toHaveText('');
});

test('impression : colonnes de détail, légende et notes générales', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: server.url,
    storageState: await api.storageState(),
    ignoreHTTPSErrors: true,
  });
  const print = await context.newPage();
  await print.goto(`/rundowns/${rundownId}/print`);
  const row = print.locator('tbody tr', { hasText: 'One More Time' });
  await expect(row).toContainText('Daft Punk');
  await expect(row).toContainText('2000');
  await expect(row).toContainText('+0:10');
  await expect(row).toContainText('0:12');
  await expect(print.locator('tbody tr', { hasText: 'Freed' }).locator('.tag')).toHaveText('FR');
  await expect(print.getByText('✂ à couper si ça déborde')).toBeVisible();
  await expect(print.getByText('Prises d’antenne entre 45 secondes et 1 minute.')).toBeVisible();
  await context.close();
});
