# Accès distant — plan des deux options

> **Statut : proposition, non validée, à reprendre dans une future version.** Rien n'est développé.
> Référence : `docs/cahier-des-charges.md` §3 (déploiement, HTTPS), §4 (architecture, accès, état antenne, studio), §9 (règles de travail, risques), §10 (produit générique). Évolution **hors étape**.
> ⚠️ **Changement à risque (§9)** : dans les deux options, l'outil devient **joignable depuis Internet**. Il faudra l'inscrire dans les risques identifiés du cahier des charges (§9) avant de commencer.

## Besoin

Permettre aux animateurs (et plus tard à la régie) d'**utiliser l'interface depuis l'extérieur** du studio : écrire leurs scripts et monter leurs conducteurs depuis chez eux. Aujourd'hui, OnAir-Desk n'est joignable que sur le réseau interne.

## Contraintes communes

1. **L'écran studio ne dépend jamais d'Internet** (règle « jamais d'écran blanc », §9) : une coupure de la box du studio ne doit rien changer à l'antenne.
2. **La base RadioDJ n'est jamais exposée sur Internet** : elle reste lisible depuis le réseau du studio seulement, par un compte `SELECT` seul (§6).
3. **Aucun port entrant au studio** : c'est toujours le studio qui appelle le VPS, comme le connecteur AzuraCast aujourd'hui.
4. **Le kiosk et le port des connecteurs restent internes** : l'appairage d'un écran, le cookie d'appareil et `CONNECTOR_HTTP_PORT` ne sont jamais joignables depuis l'extérieur.
5. **Produit générique** (§10) : une station sans VPS doit pouvoir continuer à tout installer sur une seule machine, comme aujourd'hui.

## Comparaison

| | Option 1 : porte d'entrée sur le VPS | Option 2 : central sur le VPS + agent studio |
|---|---|---|
| Principe | OnAir-Desk reste **entier au studio** ; le VPS ne fait que relayer par un tunnel | L'édition passe sur le **VPS** ; un **agent** au studio garde l'antenne et le kiosk |
| Données sur le VPS | **Aucune** | Comptes, scripts, conducteurs, paramètres |
| Internet coupé au studio | Antenne ✅, accès extérieur ❌ | Antenne ✅, accès extérieur ✅ (mais régie distante sans effet au studio) |
| Plusieurs radios sur un même service | Non | **Oui** (un central, un agent par station) |
| Code à modifier | Peu (durcissement de la connexion, confiance au proxy) | Beaucoup (découpage, protocole, synchronisation, hors ligne) |
| Coût estimé | **Une fraction d'étape** | **Environ 3 étapes** (≈ étapes 6 + 7 + 8), plus un surcoût sur chaque étape suivante |
| Recommandation | **À faire en premier** si le besoin se confirme | Seulement si l'hébergement de **plusieurs radios** devient un objectif |

---

## Option 1 — Porte d'entrée sur le VPS (tunnel)

### Schéma

```
Animateur (Internet) ──HTTPS Let's Encrypt──► VPS : reverse proxy (Caddy ou Traefik) + CrowdSec
                                                │
                                tunnel WireGuard, ouvert depuis le studio
                                                │
Studio : OnAir-Desk (inchangé) ◄── kiosk sur le réseau local
         ├─ MariaDB RadioDJ (réseau local)
         └─ signal RadioDJ (port des connecteurs, réseau local)
```

### Décisions proposées

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **Tunnel** | **WireGuard** : la Debian du studio (ou un conteneur dédié) ouvre le tunnel vers le VPS, avec `PersistentKeepalive` pour traverser la box. Le VPS n'a accès qu'à l'**adresse et au port d'OnAir-Desk** à travers le tunnel (pare-feu côté studio), pas au reste du réseau. | Tailscale ou Headscale (plus simple à installer, mais un service tiers ou un composant de plus) ; redirection de port sur la box (port entrant au studio : rejeté). |
| 2 | **Reverse proxy sur le VPS** | **Caddy** (certificat Let's Encrypt automatique, configuration courte), ou le proxy déjà en place à côté d'AzuraCast s'il y en a un. Nom de domaine dédié (ex. `desk.<station>.fr`). | Traefik (plus adapté si d'autres conteneurs le partagent). |
| 3 | **HTTPS de bout en bout** | Le proxy présente le certificat Let's Encrypt aux postes extérieurs, puis appelle OnAir-Desk en **HTTPS à travers le tunnel**, en vérifiant le certificat avec l'**autorité interne** d'OnAir-Desk (copiée sur le VPS). Le HTTPS servi par Fastify ne change pas ; les postes internes et le kiosk continuent avec l'autorité interne. | HTTP dans le tunnel (le tunnel chiffre déjà, mais on perd l'authentification du serveur). |
| 4 | **Ce que le proxy laisse passer** | Liste blanche de chemins : l'interface et l'API des comptes, le WebSocket. **Refusés** : l'appairage d'un écran kiosk, toute requête portant le cookie d'appareil, `/studio`. Le port des connecteurs n'est **jamais** relayé. Contrôle **doublé côté serveur** (décision 6) : le proxy ne suffit pas. | Tout relayer (le kiosk deviendrait accessible depuis Internet). |
| 5 | **Adresse du client** | Option `trustProxy` de Fastify limitée à l'**adresse du VPS dans le tunnel** (nouvelle variable `TRUSTED_PROXY`, vide par défaut = comportement actuel). Sans elle, le journal d'audit et la limite de débit ne verraient qu'une seule adresse : celle du VPS. | `trustProxy: true` (n'importe quel client pourrait falsifier son adresse). |
| 6 | **Requêtes venues de l'extérieur** | Le serveur reconnaît une requête « extérieure » (passée par le proxy de confiance) et y **refuse** l'identité kiosk, l'appairage et les routes réservées au réseau interne. Erreur stable `external_forbidden`. | Se fier au seul proxy. |
| 7 | **Origines** | La nouvelle adresse publique s'ajoute à `PUBLIC_ORIGIN` (contrôle d'origine du WebSocket et des requêtes, déjà en place). Elle n'est **pas** ajoutée à `TLS_HOSTNAMES` (c'est Let's Encrypt qui la couvre). | — |
| 8 | **Durcissement de la connexion** | Le freinage des tentatives existe déjà (`auth/throttle.ts`) : vérifier ses seuils pour un accès Internet, ajouter un **verrouillage temporaire du compte** après plusieurs échecs, journalisé. **CrowdSec** (ou fail2ban) sur le VPS, alimenté par les journaux du proxy. | Rien de plus (insuffisant face aux robots d'Internet). |
| 9 | **Double authentification** | **TOTP** (application d'authentification), **obligatoire pour les admins** depuis l'extérieur, facultative pour les animateurs. Codes de secours à la mise en place. | Pas de double authentification (un mot de passe volé donne accès à tout depuis Internet) ; restriction des admins au réseau interne (plus simple, à garder en repli). |
| 10 | **Activation** | Tout est **désactivé par défaut** : sans `TRUSTED_PROXY`, OnAir-Desk se comporte exactement comme aujourd'hui. L'accès distant est un choix explicite de la station. | — |

### Fonctionnalités (une étape courte)

1. Variable `TRUSTED_PROXY` et reconnaissance des requêtes extérieures (décisions 5 et 6).
2. Refus du kiosk et des routes internes depuis l'extérieur (décisions 4 et 6).
3. Verrouillage temporaire des comptes, seuils de freinage revus (décision 8).
4. Double authentification TOTP (décision 9) — la plus longue des cinq.
5. Documentation d'installation : WireGuard, Caddy, CrowdSec, exemple de configuration dans `deploy/acces-distant/` (aucun secret), section du README.

### Tests

- Unitaires : reconnaissance du proxy de confiance, refus d'une adresse falsifiée, refus du kiosk depuis l'extérieur, verrouillage, TOTP.
- E2E : serveur lancé avec `TRUSTED_PROXY` ; requêtes simulées « via proxy » (connexion animateur acceptée, appairage kiosk refusé) et « directes » (comportement actuel inchangé).
- Sur l'installation réelle (à ajouter à `docs/a-faire.md`) : tunnel monté au démarrage de la Debian, reconnexion après coupure de la box, certificat Let's Encrypt renouvelé, scan des ports du VPS (seul le 443 ouvert, plus le port WireGuard).

### Risques et limites

- **Exposition Internet** : la surface d'attaque devient la page de connexion et l'API des comptes. Mitigations : décisions 4, 6, 8, 9, mises à jour régulières (image Docker et VPS).
- **Le VPS devient un point de passage** : s'il est compromis, il voit le trafic déchiffré. Il ne stocke aucune donnée, mais il doit être tenu à jour et réservé à cet usage (et à AzuraCast).
- **Internet coupé au studio** : plus d'accès extérieur. Accepté : l'antenne passe avant.

---

## Option 2 — Central sur le VPS + agent studio

### Principe : chaque donnée a un seul maître

| Donnée | Maître | Copie |
|---|---|---|
| Comptes, scripts, conducteurs, paramétrage, modèles, dispositions | **Central (VPS)** | Agent, en lecture seule |
| État antenne : titre en cours / à venir, On Air, élément affiché au prompteur | **Agent (studio)** | Central, en lecture |
| Heures réelles de passage, événements d'audit nés au studio | **Agent** | Envoyés au central dès qu'il est joignable |
| Secrets RadioDJ (base, jeton du signal) | **Agent seulement** | Jamais transmis au central |

Personne n'écrit jamais la donnée d'un autre : pas de fusion de conflits à gérer.

### Schéma de l'agent

```
┌──────────────────────────── Agent studio (Docker, réseau du studio) ───────────────────────────┐
│                                                                                                 │
│  Connecteurs locaux            Moteur état antenne         Serveur kiosk local                  │
│  ├─ RadioDJ (MariaDB)  ──────► (versionné, maître  ──────► ├─ sert le build /studio             │
│  ├─ signal (ingest.ts)          pour son studio)           └─ WebSocket local (protocole actuel)│
│  ├─ On Air (GPIO / HTTP)               │                          ▲                             │
│  └─ simulateur                         │                          │                             │
│                                        ▼                          │                             │
│  Réplique locale (SQLite) ◄──── Lien montant ───────────► File sortante (outbox, SQLite)        │
│  scripts, conducteurs,          client WebSocket          audit, heures réelles, sélections     │
│  paramètres, logo               sortant, mTLS             prompteur ; envoi idempotent + accusé │
│                                        │                                                        │
└────────────────────────────────────────┼────────────────────────────────────────────────────────┘
                                         │  WSS sortant seulement (aucun port entrant au studio)
                                         ▼
                         Central (VPS) : registre des agents + connecteur « relais »
```

### Briques de l'agent

1. **Connecteurs locaux** : le code actuel de `apps/server/src/connectors/` (RadioDJ, signal, AzuraCast, simulateur), déplacé sans changement de comportement.
2. **Moteur d'état antenne** : l'objet versionné de l'étape 6 ; l'agent en est le maître pour son studio.
3. **Serveur kiosk local** : sert `/studio` et le même WebSocket qu'aujourd'hui. L'écran studio ne voit aucune différence ; son appairage se fait sur l'agent.
4. **Réplique locale** : SQLite en lecture seule, alimentée par le central. **Toute la bibliothèque** (le kiosk parcourt tous les dossiers, §4), plus le logo et les paramètres utiles à l'écran.
5. **Lien montant** : un seul WebSocket sortant vers le central, reconnexion progressive, battement de cœur.
6. **File sortante (outbox)** : ce qui naît au studio pendant une coupure (audit, heures réelles du bilan, sélections au prompteur) est stocké, puis envoyé au retour avec une **clé d'idempotence** et un accusé de réception.
7. **Horloge** : la référence de l'écran studio devient **l'agent** (hôte synchronisé par NTP), plus le central : l'horloge doit fonctionner sans Internet.

### Protocole agent ↔ central

Messages validés par zod dans `packages/shared`, avec un champ `protocolVersion` : un agent et un central de versions voisines doivent pouvoir dialoguer pendant une mise à jour.

- **Central → agent, synchronisation du contenu** : le central tient un **journal des changements** numéroté (`seq`) à chaque écriture d'un script, d'un conducteur ou d'un paramètre. À la reconnexion, l'agent demande `since=<seq>` ; si ce `seq` n'est plus dans le journal, le central envoie un **instantané complet**.
- **Central → agent, commandes** : « Envoyer au prompteur » depuis un poste distant, On Air manuel, puis (étape 10) messages régie, ordres rapides, conducteur modifié en direct. Chaque commande attend un **accusé** ; elle est **refusée côté central si l'agent est hors ligne** (pas de vieux ordres régie empilés puis rejoués).
- **Agent → central** : changements de l'état antenne (rediffusés par le central aux écrans distants et à l'administration), contenu de l'outbox.

### Côté central

- **Connecteur `RelayConnector`** : implémente `AutomationConnector` et reçoit l'état antenne poussé par l'agent ; le reste du cœur ne fait pas la différence avec un connecteur local.
- **Registre des agents** (nouvelle table, nouvelle migration) : identifiant, studio, empreinte du certificat, dernière connexion, version.
- **Inscription d'un agent** (page d'administration) : l'admin génère un **code à usage unique** ; l'agent crée sa paire de clés ; le central signe son certificat avec son **autorité interne** (celle déjà générée au premier démarrage). **Révocation** en un clic. Nouvelles actions au catalogue d'audit (`agent.enrolled`, `agent.revoked`, `agent.connected`…).
- **Périmètre** : un agent n'a accès qu'à **son studio**, contrôlé côté serveur sur chaque message.
- **Accès extérieur** au central : mêmes protections que l'option 1 (décisions 8 et 9 : verrouillage, double authentification, CrowdSec), le central étant directement sur Internet.

### Modes de fonctionnement

| Situation | Écran studio | Titres | Scripts | Régie distante |
|---|---|---|---|---|
| Internet coupé au studio | ✅ | ✅ | ✅ (dernière copie) | ❌ |
| Central (VPS) en panne | ✅ | ✅ | ✅ (dernière copie) | ❌ |
| Agent en panne | Dernier affichage conservé, reconnexion seule | ❌ | ❌ | ❌ |

Question à trancher : un **poste régie au studio** peut-il parler directement à l'agent quand Internet est coupé ? Plus robuste pour le direct, mais il faut alors une authentification des comptes sur l'agent.

### Garder un seul produit

- **Une seule image Docker**, variable `ROLE=all | central | agent`.
- **`ROLE=all` (défaut) = l'installation actuelle** : central et agent dans le même processus, reliés par un **transport en mémoire** au lieu du WebSocket. Une station sans VPS ne change rien ; le protocole est testé en permanence.

### Organisation du dépôt

```
packages/shared      schémas, calculs de temps, protocole agent ↔ central
packages/antenne     moteur d'état antenne (extrait d'apps/server)
packages/connectors  RadioDJ, AzuraCast, simulateur, ingest
apps/server          central (et mode « all »)
apps/agent           agent (Fastify minimal)
apps/web             le build /studio est servi par les deux
```

### Découpage en étapes (5 à 6 fonctionnalités chacune)

1. **Préparation, sans changement visible** : extraction de `packages/antenne` et `packages/connectors`, protocole dans `packages/shared`, transport en mémoire, `ROLE=all` identique à aujourd'hui (tous les tests existants passent sans modification).
2. **Agent** : `ROLE=agent` et `ROLE=central`, lien montant, inscription mTLS, registre et révocation, connecteur relais.
3. **Hors ligne** : journal des changements et réplique, outbox, horloge de l'agent, tests e2e de coupure et de reprise (Internet coupé, central redémarré, agent redémarré).

### Place dans le plan et coût

- **Après l'étape 10** (régie) : les commandes régie sont ce qui pèse le plus sur la conception du lien. À défaut, **définir au moins le protocole avant l'étape 10**.
- **Précaution peu coûteuse dès l'étape 10**, que l'option 2 se fasse ou non : écrire les commandes régie comme des **messages validés par zod passant par l'état antenne**, jamais comme des appels directs.
- **Coût** : environ 3 étapes de développement ; ensuite, chaque fonctionnalité se teste dans les deux modes, la compatibilité de versions du protocole est à maintenir, et le diagnostic devient plus difficile (agent, central ou lien : journaux à corréler).

### Risques

- **Exposition Internet** du central (comptes, contenus) : mêmes mitigations que l'option 1.
- **Données sur le VPS** : scripts et comptes quittent le studio ; sauvegardes du central à prévoir, et une vérification RGPD minimale (comptes nominatifs).
- **Certificats d'agent** : à renouveler avant expiration ; un agent révoqué ne doit plus rien recevoir.
- **Désynchronisation** : une écriture faite au central pendant une coupure n'est vue au studio qu'au retour du lien ; l'écran doit l'indiquer discrètement (indicateur de connexion de l'étape 8).

---

## Recommandation

1. **Si le besoin d'accès extérieur se confirme : option 1**, en évolution hors étape (branche `feature/acces-distant`).
2. **Option 2 seulement si l'hébergement de plusieurs radios devient un objectif**, en 3 étapes, après l'étape 10.
3. Dans tous les cas, **pendant l'étape 10** : commandes régie en messages zod passant par l'état antenne.
