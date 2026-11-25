# OnAir-Desk

Écran studio web pour radios (prompteur, conducteurs, horloge, titre en cours / à venir, météo, On Air), hébergé en interne, **générique** : tout ce qui est propre à une station passe par du paramétrage, seuls les connecteurs (`apps/server/src/connectors/`) contiennent du code spécifique.

**Statut : plan terminé (étapes 1 à 11 + conducteur enrichi). Ne rien développer d'une nouvelle étape sans validation explicite.**

## Documents (à lire seulement si la tâche le demande)
- `docs/cahier-des-charges.md` : **fait foi** pour le produit. §1-2 contexte et contraintes, §3 choix techniques, §4 architecture et droits (rôles, kiosk, réalisateur), §5 écran studio (principes d'affichage, alertes), §6 intégrations (RadioDJ, AzuraCast, On Air, météo), §7 idées (validées / non validées), §8 plan des étapes, §9 **risques identifiés**, §10 paramétrage et connecteurs, §11 nom et licence.
- `docs/plan-etape-N.md` (1 à 11), `docs/plan-conducteur-enrichi.md` : plan et bilan de chaque étape (décisions de détail).
- `docs/cadrage-radiodj.md` : constats RadioDJ (plugin, tables, limites).
- `docs/a-faire.md` : vérifications et décisions en attente, **à tenir à jour à chaque évolution**.
- `docs/plan-acces-distant.md` : proposition **non validée** d'accès extérieur.
- `docs/maquette-ecran-studio-v3.html` : maquette validée. `docs/transcription-cadrage.md` : archive.

## Stack
TypeScript partout : Node 24 + Fastify, WebSocket, SvelteKit statique (Svelte 5 runes), TipTap, SQLite (`better-sqlite3`, SQL direct), Argon2 + cookie httpOnly, HTTPS servi par Fastify (CA interne), une image Docker publiée sur GHCR par la CI (tag de version), déployée par une stack Portainer.

## Conventions de code
- Monorepo npm workspaces : `apps/server`, `apps/web`, `packages/shared` (schémas zod + types, importés en TS source).
- Installer avec `npx npm@11.21.1 install` (`allowScripts` du `package.json` = seuls paquets autorisés à lancer un script d'installation).
- Migration = **nouvelle entrée** dans `apps/server/src/db/migrations.ts` ; ne jamais modifier une migration livrée.
- Toute entrée validée par un schéma zod de `packages/shared` ; erreurs `{ error: 'code' }`, traduites côté web (`error.<code>`).
- Textes UI : clés dans `apps/web/src/lib/i18n/fr.ts` **et** `en.ts`.
- Contenu des scripts : liste blanche `packages/shared/src/content.ts` ; affichage via `apps/web/src/lib/content/`, **jamais de `{@html}`**.
- `/studio` (afficheur) n'importe pas TipTap : vérifier son poids après modification. Aucune ressource externe sur l'afficheur.
- Calculs de temps : fonctions pures dans `packages/shared`, jamais dupliquées. Nouvelle donnée temps réel : la brancher sur l'état antenne central versionné (par studio), pas sur le WebSocket.
- Connecteurs d'automation : implémenter `AutomationConnector` (`connectors/types.ts`), l'ajouter au gestionnaire, modèle = simulateur. Nouvelle action journalisée → catalogue `packages/shared/src/audit.ts`.
- Signal entrant d'un équipement : route sur l'écoute dédiée `connectors/ingest.ts`, jamais sur le serveur principal. SQL RadioDJ testé contre un vrai MariaDB (job CI `mariadb`, ou `MARIADB_TEST_URL` en local).
- Droits (réalisateur, kiosk…) contrôlés **côté serveur** sur chaque route et message WebSocket ; écritures sensibles tracées dans `audit_log`.
- Écran studio : orange = bientôt, rouge = maintenant (seul code couleur d'alerte) ; respecter `prefers-reduced-motion` ; jamais d'écran blanc en cas de coupure.
- Tests e2e : `e2e/*.e2e.ts` (Playwright, serveur compilé sur base temporaire) ; chaque évolution ajoute ses scénarios.
- Avant de pousser : `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, puis `npm run test:e2e`.
- **README à jour, captures comprises** : toute fonctionnalité ou interface modifiée met à jour `README.md` dans la même branche ; relancer `npm run captures` (après build), compléter `scripts/captures.ts` et la section « Aperçu » si un écran change. Base de démo seulement : aucune donnée réelle, jeton ou adresse interne.

## Versions et tags
- SemVer `vX.Y.Z`, tag annoté posé **sur `main`** après fusion ; il déclenche `.github/workflows/release.yml` (CI complète puis image `ghcr.io/dockev03/onair-desk:X.Y.Z`, `X.Y`, `latest`, amd64). Le tag doit égaler la version des `package.json` (racine + workspaces), sinon la publication échoue.
- Version montée **dans la branche de la livraison**, avant la PR : `npx npm@11.21.1 version X.Y.Z --workspaces --include-workspace-root --no-git-tag-version` (vérifier `package-lock.json`).
- Avant 1.0.0 : `MINOR` = étape ou fonctionnalité livrée, `PATCH` = correctif (`fix/…`), rien pour une branche `docs/…` seule. `1.0.0` = mise en service validée au studio (`docs/a-faire.md` §1). Après 1.0.0 : `MAJOR` = action manuelle à l'installation (variable renommée ou obligatoire, volume, retour arrière impossible), `MINOR` = fonctionnalité, `PATCH` = correctif.
- **Proposer de soi-même** une version et la commande de tag à la fin de toute branche `feature/…` ou `fix/…` qui change l'image (code, Dockerfile, dépendances) ; le tag n'est posé qu'après fusion et validation explicite.

## Règles de travail
- Branche dédiée, jamais de commit/push direct sur `main`, `master`, `staging`. Nom parlant en minuscules à tirets : `feature/etape-N-sujet`, `feature/sujet`, `fix/sujet`, `docs/sujet` ; jamais de nom généré ; une branche fusionnée n'est pas réutilisée.
- **Aucun commit ni push sans validation explicite** de l'utilisateur.
- Étapes courtes : 5-6 fonctionnalités max, regrouper ce qui touche au même code, ordonner par dépendances.
- Sécurité : validation des entrées, aucun secret en dur (variables d'environnement), pas d'exposition Internet par défaut, HTTPS.
- **Signaler tout changement à risque** (droits, exposition réseau, suppression de données) avant de le détailler, et l'ajouter aux risques du cahier des charges §9.
- Aucun identifiant de modèle d'IA dans les commits, PR ou fichiers du dépôt.
