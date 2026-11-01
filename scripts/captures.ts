import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ADMIN, TestServer } from '../e2e/server.js';

/**
 * Captures d'écran du README : base de démonstration (simulateur d'automation), puis une
 * image par écran dans docs/captures/. Lancer après `npm run build` : `npm run captures`.
 */
const OUT = path.resolve(import.meta.dirname, '../docs/captures');
const server = new TestServer(3198);

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
  await server.start();
  const api = await server.setupAdmin();
  const ok = async (res: Awaited<ReturnType<typeof api.post>>) => {
    if (!res.ok()) throw new Error(`${res.url()} : ${res.status()} ${await res.text()}`);
    return res.json();
  };

  await ok(
    await api.put('/api/settings', {
      data: { stationName: 'Radio Démo', automationSource: 'simulator' },
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
  const shot = async (page: import('@playwright/test').Page, name: string) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
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
  // Hors émission (la Matinale est à 7 h) : l'écran est en veille ; un clic la quitte.
  await studio.getByTestId('standby-track').waitFor();
  await shot(studio, 'studio-veille');
  await studio.getByTestId('standby').click();
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

  await browser.close();
  await api.dispose();
  await server.dispose();
}

main().catch(async (err) => {
  console.error(err);
  await server.dispose();
  process.exit(1);
});
