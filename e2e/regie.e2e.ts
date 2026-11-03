import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { TestServer, parisTime } from './server.js';

/**
 * Étape 10 : régie. Un réalisateur (compte avec le droit) envoie messages et ordres, gère les
 * duplex et modifie le conducteur à l'antenne ; l'écran studio les affiche dans la zone fixe,
 * sans jamais recouvrir le texte du prompteur. Un animateur sans le droit n'a pas la page.
 */
let server: TestServer;
let admin: APIRequestContext;
let studio: Page;
let regie: Page;
let deviceToken: string;
let rundownId: number;
let version: number;
/** Connexions temps réel ouvertes par la page Régie (une seule attendue, sans coupure). */
let regieSockets = 0;

test.describe.configure({ mode: 'serial' });
// Deux pages (écran studio et console de régie) : chacune est mise au premier plan avant d'y
// cliquer (un onglet en arrière-plan peut suspendre ses animations, et Playwright attend qu'un
// élément soit stable), et l'une attend parfois que l'autre se rafraîchisse.
test.use({ actionTimeout: 20_000 });
expect.configure({ timeout: 15_000 });

const item = (uid: string, title: string, extra: Record<string, unknown> = {}) => ({
  uid,
  typeId: 'chronique',
  title,
  durationSeconds: 600,
  notes: '',
  scriptId: null,
  ...extra,
});

/** Page connectée avec un compte (les cookies vont dans le contexte du navigateur). */
async function signedIn(browser: Browser, username: string, password: string): Promise<Page> {
  const page = await browser.newPage({ baseURL: server.url });
  const res = await page.request.post('/api/auth/login', {
    data: { username, password },
    headers: { origin: server.url },
  });
  expect(res.ok()).toBe(true);
  return page;
}

test.beforeAll(async () => {
  server = new TestServer(3199);
  await server.start();
  admin = await server.setupAdmin();
  for (const [username, isDirector] of [
    ['paul', true],
    ['jean', false],
  ] as const) {
    const res = await admin.post('/api/users', {
      data: {
        username,
        displayName: username === 'paul' ? 'Paul' : 'Jean',
        role: 'animateur',
        isDirector,
        password: `${username}-mot-de-passe`,
      },
    });
    expect(res.status()).toBe(201);
  }
  await admin.put('/api/settings', {
    data: {
      regie: {
        messageTtlMinutes: 5,
        kioskSeen: true,
        orders: [{ id: 'conclus', label: 'Conclus', urgent: true, active: true }],
      },
    },
  });
  deviceToken = (await (await admin.post('/api/devices', { data: { name: 'Afficheur' } })).json())
    .token;

  // Émission en cours (disposition « Animateur seul »), avec un script à lire.
  const script = await (
    await admin.post('/api/scripts', {
      data: {
        ownerId: null,
        title: 'Lancement',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour à tous.' }] }],
        },
        speedWpm: 150,
      },
    })
  ).json();
  const { date, time } = parisTime(-5 * 60_000);
  const rundown = await (
    await admin.post('/api/rundowns', {
      data: {
        ownerId: null,
        title: 'Le direct',
        airDate: date,
        startTime: time,
        layout: 'solo',
        items: [
          item('ouverture', 'Ouverture', { scriptId: script.id }),
          item('chronique', 'Chronique'),
          item('invite', 'Invité'),
        ],
      },
    })
  ).json();
  rundownId = rundown.id;
  version = rundown.version;
});

test.afterAll(async () => {
  await studio?.close();
  await regie?.close();
  await admin?.dispose();
  await server?.dispose();
});

test('message régie : zone fixe au-dessus du texte, qui ne le recouvre jamais', async ({
  browser,
}) => {
  studio = await browser.newPage({ baseURL: server.url });
  await studio.goto(`/studio#token=${deviceToken}`);
  await expect(studio.getByTestId('last-sync')).toBeVisible();
  await admin.post('/api/prompter', { data: { rundownId, itemUid: 'ouverture' } });
  const reader = studio.locator('.reader');
  await expect(reader).toBeVisible();
  // « Animateur seul » : pas de zone tant qu'il n'y a rien à montrer.
  await expect(studio.getByTestId('regie-zone')).toHaveCount(0);

  regie = await signedIn(browser, 'paul', 'paul-mot-de-passe');
  regie.on('websocket', () => (regieSockets += 1));
  await regie.goto('/regie');
  // Première ouverture : chargement de l'interface et liaison temps réel.
  await expect(regie.getByTestId('layout-warning')).toBeVisible({ timeout: 15_000 });
  await regie.bringToFront();
  await regie.getByLabel('Message à l’animateur').fill('Accélère un peu');
  await regie.getByRole('button', { name: 'Envoyer', exact: true }).first().click();

  const zone = studio.getByTestId('regie-zone');
  await expect(studio.getByTestId('regie-message')).toContainText('Accélère un peu');
  await expect(studio.getByTestId('regie-message')).toContainText('Paul');
  const z = (await zone.boundingBox())!;
  const r = (await reader.boundingBox())!;
  expect(r.y).toBeGreaterThanOrEqual(z.y + z.height);
  await expect(regie.getByTestId('regie-preview')).toContainText('Accélère un peu');
});

test('accusé « Vu » : un clic sur l’écran studio, visible dans la console', async () => {
  await studio.bringToFront();
  await studio.getByTestId('regie-message').click();
  await expect(studio.getByTestId('regie-seen')).toBeVisible();
  await expect(regie.getByTestId('regie-seen-at')).toBeVisible({ timeout: 10_000 });
  // La page garde sa liaison : elle ne se reconnecte pas à chaque seconde ni à chaque mesure
  // de l'heure serveur.
  expect(regieSockets).toBe(1);
});

test('ordre urgent : agrandi quelques secondes en rouge, puis réduit', async () => {
  await regie.bringToFront();
  await regie.getByRole('button', { name: 'Conclus' }).click();
  const zone = studio.getByTestId('regie-zone');
  await expect(studio.getByTestId('regie-message')).toContainText('Conclus');
  await expect(zone).toHaveClass(/expanded/);
  await expect(zone).not.toHaveClass(/expanded/, { timeout: 8_000 });
  await expect(zone).toHaveClass(/urgent/);
  // Effacé par la régie : la zone disparaît (disposition « Animateur seul »).
  await regie.bringToFront();
  await expect(regie.getByTestId('regie-preview')).toContainText('Conclus');
  await regie.getByRole('button', { name: 'Effacer' }).click();
  await expect(studio.getByTestId('regie-zone')).toHaveCount(0);
});

test('duplex : ligne créée et passée « à l’antenne » depuis la console', async () => {
  await regie.bringToFront();
  await regie.getByLabel('Nom de la ligne').fill('Correspondant Moulins');
  await regie.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const row = regie.getByTestId('duplex-row');
  await expect(row).toContainText('Correspondant Moulins');
  const pill = studio.getByTestId('duplex-pill');
  await expect(pill).toContainText('En attente');
  await row.getByRole('button', { name: 'À l’antenne' }).click();
  await expect(pill).toHaveClass(/onair/);
  await expect(pill).toContainText('À l’antenne');
});

test('conducteur modifié en direct : souligné à l’écran, en lecture comme en liste', async () => {
  // Élément sans script : sa fiche est affichée, le conducteur est suivi.
  await admin.post('/api/prompter', { data: { rundownId, itemUid: 'chronique' } });
  const patch = async (items: ReturnType<typeof item>[]) => {
    const res = await regie.request.patch(`/api/rundowns/${rundownId}`, {
      headers: { origin: server.url },
      data: { version, items },
    });
    expect(res.status()).toBe(200);
    version = (await res.json()).version;
  };
  const base = [item('ouverture', 'Ouverture'), item('chronique', 'Chronique')];
  await patch([
    ...base,
    item('flash', 'Flash spécial', { durationSeconds: 120 }),
    item('invite', 'Invité'),
  ]);
  // En lecture : le bandeau de la zone régie signale la modification et son auteur.
  await expect(studio.getByTestId('live-change')).toContainText('Paul');

  // Retour à la liste (appui long) : l'émission reste « à l'antenne » d'après ses heures.
  await studio.bringToFront();
  await studio
    .getByRole('button', { name: /Conducteur/ })
    .first()
    .click({ delay: 1100 });
  await expect(studio.getByText('Flash spécial')).toBeVisible();
  await patch([...base, item('invite', 'Invité'), item('meteo', 'Météo locale')]);
  const touched = studio.locator('[data-touched]');
  // Ajouté : souligné ; « Flash spécial » retiré ; « Invité » n'a pas changé de place relative.
  await expect(touched).toHaveCount(1);
  await expect(touched).toContainText('Météo locale');
  await expect(studio.getByTestId('live-change-note')).toContainText('Paul');
  // Soulignement pendant 10 secondes seulement.
  await expect(touched).toHaveCount(0, { timeout: 20_000 });

  // Dans la main courante : la modification, le message, le duplex.
  await regie.bringToFront();
  await regie.getByRole('button', { name: 'Actualiser' }).click();
  const log = regie.getByTestId('logbook');
  await expect(log).toContainText('Conducteur modifié en direct');
  await expect(log).toContainText('Accélère un peu');
  await expect(log).toContainText('Correspondant Moulins');
});

test('animateur sans le droit : ni page Régie, ni envoi possible', async ({ browser }) => {
  const jean = await signedIn(browser, 'jean', 'jean-mot-de-passe');
  await jean.goto('/scripts');
  await expect(jean.getByRole('link', { name: 'Régie' })).toHaveCount(0);
  await jean.goto('/regie');
  await expect(jean.getByText('réservée aux réalisateurs')).toBeVisible();
  const res = await jean.request.post('/api/regie/message', {
    data: { text: 'x', urgent: false },
    headers: { origin: server.url },
  });
  expect(res.status()).toBe(403);
  await jean.close();
});
