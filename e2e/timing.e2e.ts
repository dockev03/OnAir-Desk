import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { TestServer, parisTime } from './server.js';

/**
 * Étape 11 : suivi du temps. Bande de temps de l'écran studio (horaire fixe, minuteur de
 * séquence, avance / retard, fin imposée), répétition lancée depuis l'écran, bilan d'émission.
 */
let server: TestServer;
let admin: APIRequestContext;
let studio: Page;
let deviceToken: string;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });
expect.configure({ timeout: 15_000 });

const item = (uid: string, title: string, durationSeconds: number, extra = {}) => ({
  uid,
  typeId: 'chronique',
  title,
  durationSeconds,
  notes: '',
  scriptId: null,
  ...extra,
});

test.beforeAll(async () => {
  server = new TestServer(3199);
  await server.start();
  admin = await server.setupAdmin();
  deviceToken = (await (await admin.post('/api/devices', { data: { name: 'Afficheur' } })).json())
    .token;
  // Horaire fixe dans 2 minutes : la prévenance (5 min) a commencé.
  const minute = (Number(parisTime().time.slice(3, 5)) + 2) % 60;
  const res = await admin.put('/api/settings', {
    data: {
      fixedTimes: [
        {
          id: 'flash',
          label: 'Flash infos',
          minute,
          hours: Array.from({ length: 24 }, (_, h) => h),
          days: [1, 2, 3, 4, 5, 6, 7],
          warnMinutes: 5,
          active: true,
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(200);
});

test.afterAll(async () => {
  await studio?.close();
  await admin?.dispose();
  await server?.dispose();
});

test('horaire fixe : compte à rebours, jusque sur l’écran de veille', async ({ browser }) => {
  studio = await browser.newPage({ baseURL: server.url });
  await studio.goto(`/studio#token=${deviceToken}`);
  await expect(studio.getByTestId('standby-fixed')).toContainText('Flash infos dans');
  await studio.getByTestId('standby').click();
  await expect(studio.getByTestId('timing-fixed')).toContainText('Flash infos dans');
});

test('répétition depuis l’écran : appui long, mention, On Air intact, arrêt', async () => {
  // Conducteur du jour hors de son horaire (pas d'émission en cours).
  const { date, time } = parisTime();
  const startTime = Number(time.slice(0, 2)) < 20 ? '23:00:00' : '00:30:00';
  const created = await admin.post('/api/rundowns', {
    data: {
      ownerId: null,
      title: 'Soirée à répéter',
      airDate: date,
      startTime,
      items: [item('r1', 'Ouverture', 90), item('r2', 'Chronique', 120)],
    },
  });
  expect(created.status()).toBe(201);
  await studio.reload();
  // La veille s'affiche (aucune émission en cours) : on la quitte d'un clic.
  await studio.getByTestId('standby').click();
  await studio.getByRole('button', { name: /Soirée à répéter/ }).click();
  const hold = studio.getByRole('button', { name: /Répéter/ });
  await hold.dispatchEvent('pointerdown', { button: 0 });
  await studio.waitForTimeout(1200);
  await expect(studio.getByTestId('timing-rehearsal')).toContainText('RÉPÉTITION');
  // Le premier élément est affiché ; minuteur de séquence en route.
  await expect(studio.getByTestId('timing-sequence')).toContainText('reste');
  await expect(studio.locator('.lamp.on')).toHaveCount(0);
  // Horaires fixes masqués pendant une répétition.
  await expect(studio.getByTestId('timing-fixed')).toHaveCount(0);
  const stop = studio.getByRole('button', { name: /Arrêter la répétition/ });
  await stop.dispatchEvent('pointerdown', { button: 0 });
  await studio.waitForTimeout(1200);
  await expect(studio.getByTestId('timing-rehearsal')).toHaveCount(0);
});

let showId: number;

test('émission en cours : retard, minuteur dépassé, fin imposée « à couper »', async () => {
  // Commencée il y a 5 minutes, fin imposée dans 1 min 30 : on démarre avec 5 min de retard.
  const start = parisTime(-5 * 60_000);
  const end = parisTime(90_000);
  const created = await admin.post('/api/rundowns', {
    data: {
      ownerId: null,
      title: 'Journal',
      airDate: start.date,
      startTime: start.time,
      endTime: end.date === start.date ? end.time : '23:59:59',
      items: [
        item('court', 'Titres', 2),
        item('long', 'Reportage', 120),
        item('coupe', 'Météo', 60, { cuttable: true }),
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  showId = (await created.json()).id;
  await admin.post('/api/prompter', { data: { rundownId: showId, itemUid: 'court' } });

  const drift = studio.getByTestId('timing-drift');
  await expect(drift).toContainText('Retard +5:');
  await expect(drift).toHaveAttribute('data-level', 'now');
  // « Titres » (2 s) dépasse : minuteur rouge, « +0:0… ».
  const seq = studio.getByTestId('timing-sequence');
  await expect(seq).toHaveAttribute('data-level', 'now', { timeout: 10_000 });
  await expect(seq).toContainText('+0:0');
  // Fin imposée dans 1 min 30 (orange : moins de 5 min), 3 min de programme : « à couper »,
  // rouge à moins de 5 minutes de la fin.
  await expect(studio.getByTestId('timing-end')).toHaveAttribute('data-level', 'soon');
  const balance = studio.getByTestId('timing-balance');
  await expect(balance).toContainText('à couper');
  await expect(balance).toHaveAttribute('data-level', 'now');
});

test('vue conducteur : heure réelle des éléments passés', async () => {
  await admin.post('/api/prompter', { data: { rundownId: showId, itemUid: 'long' } });
  await admin.post('/api/prompter', { data: { scriptId: null } });
  await studio.reload();
  await studio
    .getByRole('button', { name: /Journal/ })
    .first()
    .click();
  await expect(studio.getByTestId('row-subtime').first()).toContainText('réel');
});

test('bilan : heures réelles, clôture, version imprimable', async ({ browser }) => {
  const page = await browser.newPage({ baseURL: server.url });
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: 'mot-de-passe-admin-solide' },
    headers: { origin: server.url },
  });
  expect(login.ok()).toBe(true);
  await page.goto(`/rundowns/${showId}/report`);
  await expect(page.getByTestId('report-line')).toHaveCount(3);
  await expect(page.getByTestId('report-line').nth(2)).toContainText('non pointé');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('report-close').click();
  await expect(page.getByTestId('report-close')).toHaveCount(0);
  // Le bilan est figé : la bande de temps de l'écran studio disparaît (hors horaire fixe).
  await expect(studio.getByTestId('timing-drift')).toHaveCount(0);
  // Éditeur : fin imposée et « à couper ».
  await page.goto(`/rundowns/${showId}`);
  await expect(page.getByTestId('planned-balance')).toContainText('à couper');
  await page.close();
});
