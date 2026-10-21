// Vérification de santé du conteneur (HEALTHCHECK du Dockerfile).
// Le certificat n'est pas vérifié : l'appel vise le conteneur lui-même, en local.
import http from 'node:http';
import https from 'node:https';

const port = Number(process.env.PORT ?? 8443);
const secure = (process.env.NODE_ENV ?? 'production') === 'production';
const client = secure ? https : http;

const req = client.get(
  { host: '127.0.0.1', port, path: '/api/health', timeout: 4000, rejectUnauthorized: false },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
