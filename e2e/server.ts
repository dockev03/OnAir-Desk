import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { request, type APIRequestContext } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
export const ADMIN = { username: 'admin', password: 'mot-de-passe-admin-solide' };

/**
 * Serveur OnAir-Desk compilé, lancé sur une base temporaire. Il peut être arrêté puis relancé
 * sur la même base et le même port (scénario de coupure).
 */
export class TestServer {
  readonly dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onair-e2e-'));
  readonly url: string;
  private proc: ChildProcess | null = null;
  private setupCode = '';

  constructor(
    readonly port = 3199,
    /** Variables d'environnement en plus (ex. CONNECTOR_HTTP_PORT). */
    private readonly env: Record<string, string> = {},
  ) {
    this.url = `http://localhost:${port}`;
  }

  async start(): Promise<void> {
    const proc = spawn(process.execPath, [path.join(ROOT, 'apps/server/dist/main.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(this.port),
        DATA_DIR: this.dataDir,
        WEB_DIR: path.join(ROOT, 'apps/web/build'),
        LOG_LEVEL: 'warn',
        ...this.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;
    let output = '';
    let exited = false;
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const code = /Code d'installation : ([A-Z0-9-]+)/.exec(output);
      if (code) this.setupCode = code[1]!;
    };
    proc.stdout!.on('data', collect);
    proc.stderr!.on('data', collect);
    proc.once('exit', () => (exited = true));
    // Prêt quand /api/health répond.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Serveur arrêté au démarrage :\n${output}`);
      const ok = await fetch(`${this.url}/api/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Serveur muet après 15 s :\n${output}`);
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
    });
    this.proc = null;
  }

  async dispose(): Promise<void> {
    await this.stop();
    fs.rmSync(this.dataDir, { recursive: true, force: true });
  }

  /** Installation (compte admin) puis client connecté en admin. */
  async setupAdmin(): Promise<APIRequestContext> {
    const api = await request.newContext({
      baseURL: this.url,
      extraHTTPHeaders: { origin: this.url },
    });
    const setup = await api.post('/api/setup', {
      data: {
        code: this.setupCode,
        station: { stationName: 'Radio Test', locale: 'fr', timezone: 'Europe/Paris' },
        admin: { ...ADMIN, displayName: 'Admin' },
      },
    });
    if (!setup.ok()) throw new Error(`Installation : ${setup.status()} ${await setup.text()}`);
    return api;
  }
}

/** Date AAAA-MM-JJ et heure HH:MM:SS à Paris (fuseau de la station de test), décalées. */
export function parisTime(offsetMs = 0): { date: string; time: string } {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(Date.now() + offsetMs));
  const [date, time] = s.split(' ') as [string, string];
  return { date, time };
}

/**
 * Conducteur « en cours » : commencé il y a 5 minutes, pour 2 heures. Sans émission en cours,
 * l'écran studio passe en veille (étape 8).
 */
export async function createShowNow(
  api: APIRequestContext,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const { date, time } = parisTime(-5 * 60_000);
  const res = await api.post('/api/rundowns', {
    data: {
      ownerId: null,
      title: 'Émission en cours',
      airDate: date,
      startTime: time,
      items: [
        {
          uid: 'emission',
          typeId: 'chronique',
          title: 'Émission',
          durationSeconds: 7200,
          notes: '',
          scriptId: null,
        },
      ],
      ...extra,
    },
  });
  if (!res.ok()) throw new Error(`Conducteur : ${res.status()} ${await res.text()}`);
  return (await res.json()).id as number;
}
