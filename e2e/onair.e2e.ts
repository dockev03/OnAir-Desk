import http from 'node:http';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { TestServer, createShowNow } from './server.js';

/**
 * Étape 9 : voyant ON AIR piloté par l'API (comme un bouton du Stream Deck) ou par appui long
 * sur l'écran studio, chronomètre micro ouvert, météo (faux Open-Meteo), cartes de liners.
 */
const CONNECTOR_PORT = 3198;
let weatherStatus = 200;
const weather = http.createServer((_req, res) => {
  res.writeHead(weatherStatus, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      current: { temperature_2m: 12.4, weather_code: 2, is_day: 1 },
      daily: { temperature_2m_max: [14.1], temperature_2m_min: [6.3] },
    }),
  );
});
let server: TestServer;
let api: APIRequestContext;
let page: Page;
let deviceToken: string;
let onAirToken: string;

const onAir = (state: string) =>
  fetch(`http://127.0.0.1:${CONNECTOR_PORT}/api/onair`, {
    method: 'POST',
    headers: { authorization: `Bearer ${onAirToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await new Promise<void>((r) => weather.listen(0, '127.0.0.1', r));
  const port = (weather.address() as { port: number }).port;
  server = new TestServer(3199, {
    CONNECTOR_HTTP_PORT: String(CONNECTOR_PORT),
    OPEN_METEO_URL: `http://127.0.0.1:${port}`,
  });
  await server.start();
  api = await server.setupAdmin();
  onAirToken = (await (await api.post('/api/settings/onair/token')).json()).token;
  deviceToken = (await (await api.post('/api/devices', { data: { name: 'Afficheur' } })).json())
    .token;
});

test.afterAll(async () => {
  // Page fermée : elle ne se reconnecterait pas au serveur du fichier de tests suivant.
  await page?.close();
  await api?.dispose();
  await server?.dispose();
  await new Promise<void>((r) => weather.close(() => r()));
});

test('API On Air : micro ouvert, plus de veille, voyant rouge et chronomètre', async ({
  browser,
}) => {
  page = await browser.newPage({ baseURL: server.url });
  await page.goto(`/studio#token=${deviceToken}`);
  // Aucune émission en cours : veille.
  await expect(page.getByTestId('standby')).toBeVisible();

  const res = await onAir('toggle');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ on: true });
  await expect(page.getByTestId('standby')).toHaveCount(0);
  const lamp = page.locator('.clock-card').getByTestId('onair-lamp');
  await expect(lamp).toHaveClass(/\bon\b/);
  await expect(page.locator('.clock-card').getByTestId('mic-timer')).toHaveText(/^0:0[1-9]$/, {
    timeout: 5_000,
  });

  // Extinction : dernière durée grisée, puis plus rien ; la veille revient.
  await onAir('off');
  await expect(lamp).not.toHaveClass(/\bon\b/);
  await expect(page.getByTestId('standby')).toBeVisible();
  // Jeton absent : refusé.
  const refused = await fetch(`http://127.0.0.1:${CONNECTOR_PORT}/api/onair`, { method: 'GET' });
  expect(refused.status).toBe(401);
});

test('appui long sur le voyant : un clic ne fait rien, 1 seconde allume', async () => {
  await createShowNow(api);
  await page.reload();
  const lamp = page.locator('.clock-card').getByTestId('onair-lamp');
  await expect(page.getByTestId('standby')).toHaveCount(0);
  await lamp.click();
  await page.waitForTimeout(1500);
  await expect(lamp).not.toHaveClass(/\bon\b/);

  const box = (await lamp.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();
  await expect(lamp).toHaveClass(/\bon\b/);
  const audit = await (await api.get('/api/audit?category=antenne')).json();
  expect(audit.entries[0]).toMatchObject({ action: 'onair.changed', actorName: 'Afficheur' });
  await onAir('off');
  await expect(lamp).not.toHaveClass(/\bon\b/);
});

test('météo : affichée sous l’heure, gardée pendant une panne', async () => {
  const res = await api.put('/api/settings', {
    data: { weather: { provider: 'openmeteo', city: 'Vichy', latitude: 46.13, longitude: 3.43 } },
  });
  expect(res.ok()).toBe(true);
  const line = page.locator('.clock-card').getByTestId('weather');
  await expect(line).toContainText('12 °C');
  await expect(line).toContainText('Éclaircies');
  await expect(line).toContainText('6° / 14°');

  // Panne du service : la dernière valeur (récente) reste affichée.
  weatherStatus = 500;
  const test = await (await api.post('/api/settings/weather/test', { data: {} })).json();
  expect(test).toMatchObject({ ok: false, error: 'weather_http' });
  await expect(line).toContainText('12 °C');
  weatherStatus = 200;
});

test('liners : rotation et clic pour passer à la carte suivante', async () => {
  const res = await api.put('/api/settings', {
    data: {
      liners: {
        items: [
          { id: 'a', text: 'Vous écoutez Radio Test', active: true },
          { id: 'b', text: 'Le standard : 04 70 00 00 00', active: true },
          { id: 'c', text: 'Carte inactive', active: false },
        ],
        rotationSeconds: 120,
      },
    },
  });
  expect(res.ok()).toBe(true);
  const liner = page.getByTestId('liner');
  await expect(liner).toBeVisible();
  const first = (await liner.locator('.text').textContent())!;
  expect(['Vous écoutez Radio Test', 'Le standard : 04 70 00 00 00']).toContain(first);
  await liner.click();
  await expect(liner.locator('.text')).not.toHaveText(first);
  await expect(liner).toContainText('2');
  await expect(page.getByText('Carte inactive')).toHaveCount(0);
});
