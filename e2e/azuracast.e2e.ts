import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { FakeAzuracastServer, LIVE, OFF_AIR } from '../apps/server/test/azuracast-fixtures.js';
import { SIMULATOR_PLAYLIST } from '../apps/server/src/connectors/simulator.js';
import { TestServer, createShowNow, parisTime } from './server.js';

/**
 * Étape 8 : connecteur AzuraCast (faux serveur HTTPS à certificat auto-signé, accepté par
 * AZURACAST_CA_FILE), bascule direct / hors direct, écran de veille, dispositions.
 */
let fake: FakeAzuracastServer;
let server: TestServer;
let api: APIRequestContext;
let token: string;
let page: Page;
let caDir: string;

/** Titre en cours qui vient de commencer (sinon effacé comme trop ancien). */
const fresh = <T extends typeof OFF_AIR>(np: T): T => ({
  ...np,
  now_playing: { ...np.now_playing, played_at: Math.floor(Date.now() / 1000) },
});
const simulatorTitles = new RegExp(`^(${SIMULATOR_PLAYLIST.map((t) => t.title).join('|')})$`);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fake = await FakeAzuracastServer.start();
  fake.np = fresh(OFF_AIR);
  caDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onair-e2e-ca-'));
  const caFile = path.join(caDir, 'azuracast.crt');
  fs.writeFileSync(caFile, fake.ca);
  server = new TestServer(3199, { AZURACAST_CA_FILE: caFile });
  await server.start();
  api = await server.setupAdmin();
  const settings = await api.put('/api/settings', {
    data: {
      simulatorSpeed: 1,
      azuracast: { url: fake.url, station: 'vichyradio', streamDelaySeconds: 0 },
      airSwitch: {
        enabled: true,
        liveSource: 'simulator',
        offAirSource: 'azuracast',
        force: 'auto',
      },
    },
  });
  expect(settings.ok(), await settings.text()).toBe(true);
  // Prochaine émission : demain matin.
  const tomorrow = parisTime(24 * 3600_000).date;
  const res = await api.post('/api/rundowns', {
    data: { ownerId: null, title: 'La matinale', airDate: tomorrow, startTime: '07:00:00' },
  });
  expect(res.ok()).toBe(true);
  token = (await (await api.post('/api/devices', { data: { name: 'Afficheur' } })).json()).token;
});

test.afterAll(async () => {
  await api?.dispose();
  await server?.dispose();
  await fake?.close();
  fs.rmSync(caDir, { recursive: true, force: true });
});

test('test de connexion : station publique, clé non nécessaire', async () => {
  const res = await api.post('/api/settings/azuracast/test', { data: {} });
  expect(await res.json()).toMatchObject({
    ok: true,
    auth: 'none',
    stationName: 'Vichy Radio',
    nowPlaying: 'Desireless - Voyage voyage',
    live: false,
  });
});

test('veille hors émission : horloge, titre d’AzuraCast, prochaine émission', async ({
  browser,
}) => {
  page = await browser.newPage({ baseURL: server.url });
  await page.goto(`/studio#token=${token}`);
  const standby = page.getByTestId('standby');
  await expect(standby).toBeVisible();
  await expect(standby.locator('.clock')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(page.getByTestId('standby-track')).toContainText('Voyage voyage');
  await expect(page.getByTestId('standby-next')).toHaveText(
    /^Prochaine émission : La matinale, le .+ à 07:00$/,
  );
});

test('bascule automatique : le DJ se connecte, le direct s’affiche, puis retour', async () => {
  fake.publish(LIVE);
  // En direct : plus de veille, titres de la source du direct (simulateur).
  await expect(page.getByTestId('standby')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('now-title')).toHaveText(simulatorTitles);
  const audit = await (await api.get('/api/audit?category=antenne')).json();
  expect(audit.entries.map((e: { action: string }) => e.action)).toContain('automation.switched');

  fake.publish(fresh(OFF_AIR));
  await expect(page.getByTestId('standby')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('standby-track')).toContainText('Voyage voyage');

  // Un clic quitte la veille : l'écran normal affiche le titre d'AzuraCast.
  await page.getByTestId('standby').click();
  await expect(page.getByTestId('standby')).toHaveCount(0);
  await expect(page.getByTestId('now-title')).toHaveText('Voyage voyage');
  await expect(page.getByTestId('next-title')).toHaveText("Ella, elle l'a (Remasterisé en 2004)");
});

test('dispositions : « Interview » réduit le bandeau, « Émission avec régie » réserve sa zone', async () => {
  const id = await createShowNow(api, { layout: 'interview' });
  await page.reload();
  await expect(page.locator('.studio')).toHaveAttribute('data-layout', 'interview');
  await expect(page.getByTestId('now-title')).toHaveText('Voyage voyage');
  await expect(page.getByTestId('next-title')).toHaveCount(0);
  await expect(page.getByTestId('regie-zone')).toHaveCount(0);

  const rundown = await (await api.get(`/api/rundowns/${id}`)).json();
  const res = await api.patch(`/api/rundowns/${id}`, {
    data: { version: rundown.version, layout: 'regie' },
  });
  expect(res.ok()).toBe(true);
  await page.reload();
  await expect(page.locator('.studio')).toHaveAttribute('data-layout', 'regie');
  await expect(page.getByTestId('regie-zone')).toBeVisible();
  await expect(page.getByTestId('next-title')).toBeVisible();
});
