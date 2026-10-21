# Étape 1 — Socle : plan détaillé

> **Statut : questions tranchées, en attente du feu vert pour démarrer.** Aucun code n'est écrit avant l'accord explicite.
> Référence : `CLAUDE.md` §8, étape 1.

## Objectif de l'étape

À la fin de l'étape 1, on a une application **installable avec Docker sur la Debian 13**, qui :
- démarre avec un **assistant de premier lancement** (création du compte admin, nom de la station, langue, fuseau horaire) ;
- permet à l'admin de **gérer les comptes** (admin / animateur) ;
- permet à l'admin de **créer, révoquer et régénérer un jeton kiosk** ;
- affiche sur le Pi une **page studio minimale** : nom de la station + horloge HH:MM:SS **synchronisée sur l'heure du serveur** par WebSocket, avec reconnexion automatique.

Cette page minimale ne fait pas partie de l'écran final. Elle sert à vérifier dès l'étape 1 toute la chaîne : Docker → serveur → WebSocket → kiosk sur le Pi.

Hors périmètre : scripts, conducteurs, RadioDJ, météo, On Air (étapes suivantes).

## Structure du dépôt

Un seul dépôt avec des espaces de travail npm (**npm workspaces**), sans outil supplémentaire à installer :

```
OnAir-Desk/
├── CLAUDE.md
├── README.md
├── .env.example            # aucune valeur secrète réelle
├── Dockerfile
├── docker-compose.yml      # exemple prêt pour Portainer
├── package.json            # workspaces + scripts globaux (lint, test, build)
├── apps/
│   ├── server/             # Fastify (API REST + WebSocket + sert le front compilé)
│   │   └── src/
│   │       ├── app.ts          # construction de l'app (testable sans écouter de port)
│   │       ├── main.ts         # démarrage
│   │       ├── config.ts       # lecture + validation des variables d'environnement
│   │       ├── db/             # schéma, migrations, accès SQLite
│   │       ├── auth/           # sessions, mots de passe, jeton kiosk, garde-fous
│   │       ├── routes/         # setup, auth, users, devices, settings, health
│   │       └── ws/             # WebSocket (heure serveur pour l'instant)
│   └── web/                # SvelteKit compilé en fichiers statiques (adapter-static)
│       └── src/routes/
│           ├── setup/          # assistant de premier lancement
│           ├── login/
│           ├── admin/          # comptes, appareils kiosk, paramètres
│           └── studio/         # page kiosk (minimale à cette étape)
├── packages/
│   └── shared/             # types et schémas de validation communs front/serveur
└── docs/
```

**Pourquoi le front est compilé en fichiers statiques et servi par Fastify :** un seul processus et un seul port dans le conteneur. Le Pi ne télécharge que du JS/CSS précompilé, sans rendu côté serveur à gérer.

## Bibliothèques proposées

| Besoin | Choix | Remarque |
|---|---|---|
| Runtime | Node.js **24 LTS** | Image officielle `node:24-trixie-slim` (même base que le serveur Debian 13). Node 26 ne passe LTS que fin octobre 2026 : on y migrera quand les modules natifs (`better-sqlite3`, `@node-rs/argon2`) auront leurs binaires précompilés pour lui. Node 24 reste maintenu jusqu'en avril 2028 |
| Serveur HTTP | `fastify` + `@fastify/websocket`, `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`, `@fastify/helmet` | |
| Validation | `zod` (+ `fastify-type-provider-zod`) | Mêmes schémas côté front et serveur (`packages/shared`) |
| SQLite | `better-sqlite3` + **Drizzle ORM** | Migrations versionnées dans le dépôt, appliquées au démarrage |
| Mots de passe | `@node-rs/argon2` (Argon2id) | Binaires précompilés, pas de compilation dans l'image |
| Front | SvelteKit + `adapter-static` | |
| i18n | **Paraglide JS** | Traductions compilées, très léger ; FR + EN dès le départ |
| Icônes | Tabler Icons **intégrées au build** | Pas de CDN : le Pi n'a pas besoin d'Internet |
| Tests | `vitest` (unitaires + routes via `fastify.inject`) | |
| Qualité | ESLint + Prettier + `tsc --noEmit` | |
| Logs | `pino` (intégré à Fastify) | Pas de mot de passe ni de jeton dans les logs |

## Base de données (étape 1)

| Table | Colonnes principales |
|---|---|
| `users` | id, username (unique), display_name, password_hash, role (`admin`/`animateur`), locale, is_active, created_at, updated_at |
| `sessions` | id_hash (SHA-256 de l'identifiant de session), user_id, created_at, expires_at, last_seen_at |
| `devices` | id, name (ex. « Pi studio 1 »), token_hash, created_at, last_seen_at, revoked_at |
| `settings` | key, value (JSON) : nom de la station, langue, fuseau horaire, format d'heure… |
| `audit_log` | id, at, actor (user/device), action (connexion, échec, création de compte, jeton créé/révoqué…), details |

Le fichier SQLite est dans un **volume Docker** (`/data`), en mode WAL. La sauvegarde consiste à copier ce volume (procédure documentée).

## Sécurité

### Comptes et sessions
- Mots de passe en **Argon2id** ; longueur minimale de 12 caractères.
- Identifiant de session aléatoire (32 octets), **stocké haché** en base. Cookie `httpOnly`, `Secure`, `SameSite=Strict`, expiration glissante (ex. 12 h d'inactivité).
- **Protection CSRF** : `SameSite=Strict` + vérification de l'en-tête `Origin` sur toutes les requêtes qui modifient des données.
- **Limitation des tentatives** de connexion (par IP et par identifiant), journalisées dans `audit_log`.
- Dernier admin actif : impossible de le supprimer ou de le désactiver.

### Assistant de premier lancement
- Risque : tant qu'aucun admin n'existe, la première personne qui ouvre la page pourrait le créer.
- Parade : au premier démarrage, le serveur génère un **code d'installation à usage unique** et l'affiche **uniquement dans les logs du conteneur** (visibles dans Portainer). L'assistant le demande. La route `/setup` est désactivée définitivement dès que l'admin est créé.

### Jeton kiosk (appareil en lecture seule)
1. L'admin crée un appareil dans l'interface : le jeton (32 octets aléatoires) est **affiché une seule fois** et stocké **haché** en base.
2. Le Pi ouvre au démarrage l'URL `https://<serveur>/studio#token=<jeton>`. Le jeton est placé **après le `#`** : le navigateur ne l'envoie jamais au serveur dans l'URL, il n'apparaît donc pas dans les logs HTTP.
3. La page lit le jeton, l'échange contre un **cookie d'appareil** `httpOnly`, puis retire le jeton de l'URL.
4. Le cookie d'appareil ne donne droit qu'à la **lecture** (un garde-fou côté serveur refuse toute écriture, quelle que soit la route).
5. Révocation par l'admin → le Pi est déconnecté immédiatement, WebSocket compris.

### WebSocket
- Authentifié par le même cookie (session ou appareil), avec vérification de l'`Origin`.
- Message `time` périodique : le client calcule le décalage avec l'heure serveur.
- Reconnexion automatique avec délai croissant. Pendant une coupure, l'horloge continue sur l'heure locale corrigée et un **petit indicateur** signale la perte de liaison : **jamais d'écran blanc**.

### Docker
- Image multi-étapes ; image finale sans outils de compilation.
- Exécution en **utilisateur non-root**, système de fichiers en lecture seule sauf `/data`.
- `HEALTHCHECK` sur `GET /api/health`.
- Variables d'environnement (`.env.example`) :

| Variable | Rôle | Exemple |
|---|---|---|
| `HOST_PORT` | Port publié sur la Debian (lu par le `docker-compose.yml`) | `443` |
| `PUBLIC_ORIGIN` | URL d'accès, pour la vérification `Origin` et les cookies | `https://onair-desk.lan` |
| `TLS_HOSTNAMES` | Noms et IP inscrits dans le certificat généré | `onair-desk.lan,192.168.1.20` |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | Facultatif : certificat fourni par la station | *(vide)* |
| `DATA_DIR` | Dossier de la base, des certificats et des sauvegardes | `/data` |
| `TZ` | Fuseau horaire par défaut du conteneur | `Europe/Paris` |
| `LOG_LEVEL` | Niveau de logs | `info` |

Aucun secret n'est à fournir à l'étape 1 : identifiants de session et jetons sont générés et stockés hachés en base, et la clé de l'autorité interne est générée dans le volume. Le jeton `POST /api/onair` arrivera à l'étape 6.

## HTTPS sans reverse proxy (décidé)

Il n'y a pas de reverse proxy : **Fastify sert lui-même le HTTPS**.

- **Au premier démarrage**, le serveur crée dans `/data/tls/` :
  - une **autorité de certification interne** propre à l'installation (clé privée qui ne quitte jamais le volume) ;
  - un **certificat serveur** signé par cette autorité, pour le nom et l'adresse IP indiqués dans `TLS_HOSTNAMES`.
- **Certificat fourni par la station** : si `TLS_CERT_FILE` et `TLS_KEY_FILE` sont renseignés, ils remplacent la génération automatique.
- Le **certificat racine** (public) est téléchargeable depuis l'assistant de premier lancement et la page admin. Il faut l'installer **une fois** sur le Pi et sur chaque poste animateur, sinon le navigateur affiche une alerte. La procédure pour le Pi est dans le guide de l'étape 7 ; celle des postes sera dans le README.
- Le certificat serveur est **renouvelé automatiquement** avant expiration, sans toucher à l'autorité.
- **Le mode HTTP simple n'existe pas en production.** Il n'est accepté qu'avec `NODE_ENV=development`.

⚠️ **Point à surveiller pour l'étape 4 :** le plugin *Now Playing Info* de RadioDJ peut ne pas accepter un certificat interne, voire ne pas savoir appeler une adresse en HTTPS. Si c'est le cas, on ajoutera un **port HTTP dédié aux connecteurs**, désactivé par défaut. Il n'accepterait que les routes d'entrée des connecteurs, protégées par jeton, et jamais l'interface ni les sessions. Ce sera vérifié sur ton installation RadioDJ avant d'écrire le connecteur.

## Déploiement : stack Portainer qui construit tout (décidé)

- La stack est créée dans Portainer en mode **« Repository »** : Portainer clone le dépôt, **construit l'image** à partir du `Dockerfile` (`build:` dans le `docker-compose.yml`) et lance le conteneur. Aucun registre, aucune image préconstruite.
- **Le dépôt est privé** : Portainer a besoin d'un accès en lecture. Je recommande un **jeton GitHub à grain fin** limité à ce seul dépôt, en lecture seule (*Contents: Read*), avec une date d'expiration. Il est saisi dans Portainer uniquement, jamais dans le dépôt.
- **Mise à jour** : bouton « Pull and redeploy » dans Portainer (ou mise à jour automatique en option). La base reste dans le volume `onair-desk-data`, elle n'est pas touchée par une reconstruction.
- **Migrations** : appliquées automatiquement au démarrage, après une **copie de sauvegarde** du fichier SQLite dans `/data/backups/` (les 5 dernières sont conservées).
- **Port** : le conteneur écoute sur 8443 (utilisateur non-root) ; le `docker-compose.yml` le publie sur le **port 443** de la Debian. Le port est modifiable par variable.
- Le conteneur est construit sur la Debian elle-même : prévoir environ **1 Go de disque libre** pour la construction (étapes intermédiaires nettoyées automatiquement).

## Qualité et CI

- Scripts : `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- **GitHub Actions** sur chaque push / PR : lint + typecheck + tests + construction de l'image Docker (sans publication).
- Tests minimum : connexion OK/KO, limitation des tentatives, rôle animateur interdit sur l'admin, appareil kiosk refusé en écriture, révocation d'un appareil, assistant fermé après création de l'admin, validation des variables d'environnement.

## Découpage en commits (sur la branche dédiée, chacun validé avant push)

1. Squelette : workspaces, TypeScript, lint, tests, CI.
2. Serveur : config, SQLite + migrations, `/api/health`.
3. Auth : comptes, sessions, assistant de premier lancement.
4. Appareils kiosk : jetons, garde-fou lecture seule.
5. Front : setup, login, admin (comptes, appareils, paramètres), FR/EN.
6. Page studio minimale + WebSocket heure serveur + reconnexion.
7. HTTPS : génération de l'autorité interne et du certificat, renouvellement, téléchargement du certificat racine.
8. Dockerfile, `docker-compose.yml` (stack Portainer), `.env.example`, README d'installation (Portainer + certificat racine sur les postes).

## Décisions prises

1. **HTTPS** : pas de reverse proxy → HTTPS servi par Fastify, autorité interne générée au premier démarrage.
2. **Node.js** : 24 LTS (`node:24-trixie-slim`), migration vers 26 LTS plus tard.
3. **Déploiement** : stack Portainer en mode « Repository » qui construit l'image.
