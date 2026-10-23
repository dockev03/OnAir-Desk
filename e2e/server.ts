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

  constructor(readonly port = 3199) {
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
