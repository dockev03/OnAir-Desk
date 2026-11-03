import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ADMIN, TestServer } from '../e2e/server.js';

/**
 * Captures d'écran du README : base de démonstration (simulateur d'automation), puis une
 * image par écran dans docs/captures/. Lancer après `npm run build` : `npm run captures`.
 */
const OUT = path.resolve(import.meta.dirname, '../docs/captures');
const WEATHER_PORT = 3197;
// Météo de démonstration : faux Open-Meteo local (aucun appel à Internet).
const weather = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      current: { temperature_2m: 14.2, weather_code: 2, is_day: 1 },
      daily: { temperature_2m_max: [17.4], temperature_2m_min: [8.1] },
    }),
  );
});
const server = new TestServer(3198, { OPEN_METEO_URL: `http://127.0.0.1:${WEATHER_PORT}` });

type Inline = { type: 'text'; text: string; marks?: object[] } | { type: 'cue'; attrs: object };
const text = (t: string, ...marks: object[]): Inline => ({
  type: 'text',
  text: t,
  ...(marks.length ? { marks } : {}),
});
const cue = (cueId: string, label: string, seconds?: number): Inline => ({
  type: 'cue',
  attrs: { cueId, label, ...(seconds ? { seconds } : {}) },
});
const p = (...content: Inline[]) => ({ type: 'paragraph', content });
const bold = { type: 'bold' };
const color = (c: string) => ({ type: 'textStyle', attrs: { color: c } });
const hl = (c: string) => ({ type: 'highlight', attrs: { color: c } });

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise<void>((r) => weather.listen(WEATHER_PORT, '127.0.0.1', r));
  await server.start();
  const api = await server.setupAdmin();
  const ok = async (res: Awaited<ReturnType<typeof api.post>>) => {
    if (!res.ok()) throw new Error(`${res.url()} : ${res.status()} ${await res.text()}`);
    return res.json();
  };

  await ok(
    await api.put('/api/settings', {
      data: {
        stationName: 'Radio Démo',
        automationSource: 'simulator',
        weather: { provider: 'openmeteo', city: 'Ville démo', latitude: 45, longitude: 3 },
        liners: {
          items: [
            { id: 'station', text: 'Vous écoutez Radio Démo, la radio de la ville', active: true },
            { id: 'standard', text: 'Le standard : 01 23 45 67 89', active: true },
          ],
          rotationSeconds: 20,
        },
        regie: {
          messageTtlMinutes: 10,
          kioskSeen: true,
          orders: [
            { id: 'accelere', label: 'Accélère', urgent: false, active: true },
            { id: 'etire', label: 'Étire', urgent: false, active: true },
            { id: 'conclus', label: 'Conclus', urgent: true, active: true },
            { id: 'invite', label: 'Invité en ligne', urgent: false, active: true },
            { id: 'pub', label: 'Pub dans 1 min', urgent: false, active: true },
            { id: 'rends', label: "Rends l'antenne", urgent: true, active: true },
          ],
        },
      },
    }),
  );
  const claire = await ok(
    await api.post('/api/users', {
      data: {
        username: 'claire',
        displayName: 'Claire',
        role: 'animateur',
        password: 'mot-de-passe-claire-solide',
      },
    }),
  );
  await ok(
    await api.post('/api/users', {
      data: {
        username: 'marc',
        displayName: 'Marc',
        role: 'animateur',
        password: 'mot-de-passe-marc-solide',
      },
    }),
  );

  const edito = await ok(
    await api.post('/api/scripts', {
      data: {
        ownerId: claire.id,
        title: 'Ouverture de la matinale',
        speedWpm: 150,
        content: {
          type: 'doc',
          content: [
            p(cue('jingle', 'JINGLE', 8)),
            p(
              text('Bonjour à tous et bienvenue dans '),
              text('La Matinale', bold),
              text(' ! Il est sept heures, on se réveille ensemble jusqu’à neuf heures.'),
            ),
            p(
              text('Au programme ce matin : '),
              text('la fête du quartier des Ailes', color('#FAC775')),
              text(', notre invité en direct à 7 h 40, et bien sûr toute la musique.'),
            ),
            p(cue('pause', 'PAUSE')),
            p(
              text('Côté météo, ', bold),
              text('un ciel voilé ce matin', hl('#0C447C')),
              text(', des éclaircies cet après-midi et jusqu’à 16 degrés.'),
            ),
            p(text('On commence tout de suite avec un titre qui donne la pêche.')),
            p(cue('lancer-titre', 'LANCER TITRE')),
          ],
        },
      },
    }),
  );
  const agenda = await ok(
    await api.post('/api/scripts', {
      data: {
        ownerId: null,
        title: 'Agenda du week-end',
        content: {
          type: 'doc',
          content: [p(text('Ce week-end, ne manquez pas le marché de producteurs, samedi matin.'))],
        },
      },
    }),
  );

  const today = new Date().toISOString().slice(0, 10);
  const item = (
    uid: string,
    typeId: string,
    title: string,
    durationSeconds: number | null,
    scriptId: number | null = null,
    notes = '',
    details: object = {},
  ) => ({
    uid,
    typeId,
    title,
    durationSeconds,
    notes,
    scriptId,
    ...details,
  });
  const rundown = await ok(
    await api.post('/api/rundowns', {
      data: {
        ownerId: claire.id,
        title: 'La Matinale',
        airDate: today,
        startTime: '07:00',
        notes:
          'Prises d’antenne de 45 secondes à 1 minute.\nSi ça déborde : couper le titre marqué ✂.',
        items: [
          item('ouverture', 'chronique', 'Ouverture', null, edito.id),
          item('t1', 'titre', 'Lumière du matin', 210, null, 'Talk-up sur l’intro', {
            artist: 'Les Ondes Courtes',
            year: 1987,
            introSeconds: 14,
            tags: ['fr'],
          }),
          item('meteo', 'meteo', 'Météo locale', 90),
          item('t2', 'titre', 'Northern Lights', 195, null, '', {
            artist: 'The Paper Kites Orchestra',
            year: 2011,
            introSeconds: 9,
            cuttable: true,
          }),
          item('pub1', 'pub', 'Écran pub', 120),
          item('flash', 'flash', 'Flash infos', 180),
          item('agenda', 'chronique', 'Agenda du week-end', 120, agenda.id),
          item('itw', 'interview', 'Invité : comité des fêtes', 600, null, 'Appeler à 7 h 38'),
          item('jingle', 'jingle', 'Jingle station', 10),
        ],
      },
    }),
  );

  const { token } = await ok(await api.post('/api/devices', { data: { name: 'Studio A' } }));

  // CHROMIUM_PATH : navigateur déjà installé, si sa version diffère de celle de Playwright.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    // Champs date / heure natifs au format français.
    args: ['--lang=fr-FR'],
    env: { ...process.env, LANG: 'fr_FR.UTF-8', LANGUAGE: 'fr' },
  });
  const shot = async (page: import('@playwright/test').Page, name: string, fullPage = false) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
    console.log(`docs/captures/${name}.png`);
  };
  const context = {
    viewport: { width: 1600, height: 900 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  };

  // Écran studio (kiosk).
  const studio = await browser.newPage({ baseURL: server.url, ...context });
  await studio.goto(`/studio#token=${token}`);
  // Hors émission (la Matinale est à 7 h) et micro fermé : l'écran est en veille.
  await studio.getByTestId('standby-track').waitFor();
  await shot(studio, 'studio-veille');
  // Micro ouvert pour la suite : voyant ON AIR, chronomètre (et plus de veille).
  await ok(await api.post('/api/studio/onair', { data: { state: 'on' } }));
  await studio.getByTestId('now-title').filter({ hasText: /./ }).waitFor();
  await shot(studio, 'studio-navigation');
  await studio.getByText('La Matinale').click();
  await studio.getByText('Invité : comité des fêtes').waitFor();
  await shot(studio, 'studio-conducteur');
  await ok(
    await api.post('/api/prompter', { data: { rundownId: rundown.id, itemUid: 'ouverture' } }),
  );
  await studio.getByText('La Matinale', { exact: false }).first().waitFor();
  await shot(studio, 'studio-lecture');

  // Interface animateur.
  const ui = await browser.newPage({ baseURL: server.url, ...context });
  await ui.goto('/login');
  await ui.getByLabel(/utilisateur/i).fill(ADMIN.username);
  await ui.getByLabel(/mot de passe/i).fill(ADMIN.password);
  await ui.getByRole('button', { name: /connexion|se connecter/i }).click();
  await ui.waitForURL((u) => !u.pathname.startsWith('/login'));
  await ui.goto(`/scripts/${edito.id}`);
  await shot(ui, 'editeur-script');
  await ui.goto(`/rundowns/${rundown.id}`);
  await shot(ui, 'conducteur');
  await ui.goto(`/rundowns/${rundown.id}/print`);
  await ui.getByText('Lumière du matin').waitFor();
  await shot(ui, 'conducteur-impression');

  // Régie : disposition « Émission avec régie », duplex, ordre puis message, accusé « Vu ».
  const current = await ok(await api.get(`/api/rundowns/${rundown.id}`));
  await ok(
    await api.patch(`/api/rundowns/${rundown.id}`, {
      data: { version: current.version, layout: 'regie' },
    }),
  );
  const moulins = await ok(
    await api.post('/api/regie/duplex', { data: { name: 'Correspondant Moulins' } }),
  );
  await ok(await api.patch(`/api/regie/duplex/${moulins.id}`, { data: { state: 'ready' } }));
  await ok(await api.post('/api/regie/duplex', { data: { name: 'Invité tél. 1' } }));
  await ok(await api.post('/api/regie/order/accelere'));
  await ok(
    await api.post('/api/regie/message', {
      data: { text: 'Le comité des fêtes est en ligne, prêt pour 7 h 38', urgent: false },
    }),
  );
  await ok(
    await api.post('/api/regie/logbook', {
      data: { text: 'Duplex Moulins : son faible, rappelé' },
    }),
  );
  await studio.getByTestId('regie-message').waitFor();
  await shot(studio, 'studio-regie');
  // Chaque page au premier plan avant d'y agir (un onglet en arrière-plan peut se figer).
  await studio.bringToFront();
  await studio.getByTestId('regie-message').click();
  await ui.bringToFront();
  await ui.goto('/regie');
  await ui.getByTestId('regie-seen-at').waitFor();
  await ui.getByTestId('logbook').waitFor();
  await shot(ui, 'regie', true);

  await browser.close();
  await api.dispose();
  await server.dispose();
  weather.close();
}

main().catch(async (err) => {
  console.error(err);
  weather.close();
  await server.dispose();
  process.exit(1);
});
