import { buildApp } from './app.js';
import { buildIngestServer } from './connectors/ingest.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { openDatabase } from './db/index.js';
import {
  ensureInternalCertificates,
  loadProvidedCertificate,
  type TlsMaterial,
} from './tls/certificates.js';

const RENEW_CHECK_MS = 24 * 60 * 60_000;

async function loadTls(config: Config, log: (m: string) => void): Promise<TlsMaterial | null> {
  if (!config.tls) return null;
  if (config.tls.certFile && config.tls.keyFile) {
    return loadProvidedCertificate(config.tls.certFile, config.tls.keyFile);
  }
  const r = await ensureInternalCertificates(config.dataDir, config.tls.hostnames);
  if (r.created.includes('ca')) log('Autorité de certification interne créée.');
  if (r.created.length > 0) {
    log(`Certificat HTTPS émis pour : ${config.tls.hostnames.join(', ')}.`);
  }
  return r;
}

async function main() {
  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const bootLog: string[] = [];
  const db = openDatabase(config.dataDir, (m) => bootLog.push(m));
  let tls = await loadTls(config, (m) => bootLog.push(m));
  if (!config.tls) bootLog.push('HTTPS désactivé (mode développement).');

  const { app, ctx } = await buildApp({
    config,
    db,
    https: tls && { key: tls.key, cert: tls.cert },
    rootCaPem: () => tls?.rootCaPem ?? null,
  });
  for (const m of bootLog) app.log.info(m);

  const code = ctx.setup.ensure(ctx.repos.users.count() === 0);
  if (code) {
    // En texte brut (et non en JSON) pour être lisible tel quel dans les logs Portainer.
    process.stdout.write(
      [
        '',
        '===== OnAir-Desk : premier lancement =====',
        `Ouvrez ${config.allowedOrigins[0]}/setup`,
        `Code d'installation : ${code}`,
        "(nouveau code à chaque redémarrage tant que l'installation n'est pas faite)",
        '==========================================',
        '',
      ].join('\n') + '\n',
    );
    app.log.warn("Installation à faire : code d'installation affiché ci-dessus.");
  }

  // Renouvellement du certificat interne sans redémarrage.
  if (config.tls && !config.tls.certFile) {
    const tlsConfig = config.tls;
    setInterval(async () => {
      try {
        const r = await ensureInternalCertificates(config.dataDir, tlsConfig.hostnames);
        if (r.created.length > 0) {
          tls = r;
          (app.server as import('node:https').Server).setSecureContext({
            key: r.key,
            cert: r.cert,
          });
          app.log.info('Certificat HTTPS renouvelé.');
        }
      } catch (err) {
        app.log.error({ err }, 'Échec du renouvellement du certificat HTTPS.');
      }
    }, RENEW_CHECK_MS).unref();
  }

  // Écoute HTTP dédiée aux connecteurs entrants : fermée tant que CONNECTOR_HTTP_PORT est absent.
  const ingest = config.connectorHttpPort
    ? await buildIngestServer({
        tokens: ctx.repos.connectorTokens,
        automation: ctx.automation,
        onAir: ctx.onAir,
        settings: ctx.repos.settings,
        logger: { level: config.logLevel },
      })
    : null;

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} reçu, arrêt.`);
    await ingest?.close();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  if (ingest && config.connectorHttpPort) {
    await ingest.listen({ host: config.host, port: config.connectorHttpPort });
    app.log.warn(
      `Écoute HTTP des connecteurs ouverte sur le port ${config.connectorHttpPort} : réseau interne uniquement.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
