# Étape 6 — Socle antenne : plan

> **Statut : réalisée (bilan en fin de document).**
> Référence : `docs/cahier-des-charges.md` §4 (décisions d'architecture), §5 (bandeau supérieur), §8 étape 6, §10 (connecteurs interchangeables). Branche prévue : `feature/etape-6-socle-antenne`.
> 6 fonctionnalités. Aucune intégration réelle (RadioDJ, AzuraCast, On Air, météo) : elles se brancheront sur ce socle aux étapes 7 à 9.

## Objectif

Poser une fois pour toutes ce dont toutes les étapes suivantes ont besoin :

1. **État antenne central** versionné, rattaché à un **studio** (un studio par défaut).
2. **Interface commune des connecteurs d'automation** (titre en cours, titre à venir, intro / outro).
3. **Simulateur d'automation** : faux connecteur qui joue une playlist fictive, pour développer, tester et faire des démonstrations sans RadioDJ ni AzuraCast.
4. **Calculs de temps** dans `packages/shared`, en fonctions pures testées.
5. **Journal d'audit commun** : compléter `audit_log` et le rendre consultable (base de la future main courante).
6. **Tests de bout en bout de l'écran studio** (Playwright) : mise en place et premiers scénarios.

## Décisions

Les 13 décisions sont **validées** ; la colonne « Alternative » garde trace des options écartées.

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **Contenu de l'état antenne** | Un objet par studio : `version`, `nowPlaying`, `next`, `source` (connecteur actif, état, dernière mise à jour). Les étapes suivantes y **ajoutent des champs** (On Air, météo, messages, duplex, minuteurs) sans toucher au transport. | Un message WebSocket dédié par fonctionnalité (ce qui existe pour le prompteur). |
| 2 | **Diffusion** | À la connexion, le message `hello` contient l'état **complet** ; ensuite, des messages `air` ne portent que les **champs modifiés** (remplacement par clé de premier niveau) et le nouveau numéro de version. Si l'écran constate un **trou de version**, il redemande l'état complet. | Renvoyer l'état complet à chaque changement (simple mais plus lourd, et moins propre quand les minuteurs arriveront). |
| 3 | **Persistance de l'état antenne** | **En mémoire** : il est reconstruit par les connecteurs au démarrage. Seul ce qui doit survivre à un redémarrage (prompteur, déjà en base ; On Air à l'étape 9) est stocké. | Tout persister en base à chaque changement (écritures inutiles, plusieurs par seconde avec les minuteurs). |
| 4 | **Studio** | Table `studios` (id, nom), avec un **studio par défaut** créé par la migration. Chaque écran kiosk est rattaché à un studio (studio par défaut), chaque connexion WebSocket ne reçoit que l'état de **son** studio. Aucune interface de gestion des studios pour l'instant (un seul studio). | Attendre d'avoir un deuxième studio (il faudrait alors repasser sur tout le temps réel). |
| 5 | **Prompteur et studio** | `prompter_state` passe d'une ligne unique à **une ligne par studio** (nouvelle table remplie depuis l'ancienne par la migration 6, l'ancienne est supprimée). Les routes et messages actuels restent identiques : ils visent le studio par défaut. | Garder la ligne unique et repousser le rattachement (contraire à la décision d'architecture du §4). |
| 6 | **Interface des connecteurs** | Le cœur ne connaît qu'un contrat : un connecteur se **démarre** / **s'arrête** et **émet** `{ nowPlaying, next }`, chaque titre portant titre, artiste, durée, **heure de début (horloge serveur)**, intro et outro facultatives. Le cœur calcule seul temps restant et heure de démarrage du suivant. Un connecteur signale aussi son état (`ok`, `erreur`, `arrêté`). | Laisser chaque connecteur envoyer un temps restant (dérive d'un connecteur à l'autre, calculs dupliqués). |
| 7 | **Choix du connecteur** | Paramètre admin **« Source d'automation »** : *aucune* (défaut) ou *simulateur* ; RadioDJ et AzuraCast s'ajouteront à la liste. Changer de source est **tracé** au journal. La bascule direct / hors direct reste à l'étape 8. | Variable d'environnement (moins accessible à une petite radio). |
| 8 | **Simulateur** | Playlist **fictive intégrée** (une douzaine de titres inventés, durées 2:30 à 4:30, intros et outros), jouée en boucle. Option **« accéléré »** (durées divisées, ex. ×10) pour les démonstrations et les tests de bout en bout. Il sert de **modèle** pour écrire un vrai connecteur. | Playlist paramétrable par l'admin (inutile pour un outil de test). |
| 9 | **Affichage sur l'écran studio** | Les blocs **« Titre en cours »** (titre, artiste, durée, temps restant, barre de progression) et **« Titre à venir »** (titre, artiste, durée, heure de démarrage) de la maquette v3 apparaissent dans le bandeau, alimentés par l'état antenne ; masqués si la source est *aucune*. **Sans** les alertes orange / rouge (étape 7.3). | Ne rien afficher avant RadioDJ (rien à vérifier visuellement à cette étape). |
| 10 | **Calculs de temps** | Nouveau module `packages/shared/src/timing.ts` : temps restant et progression d'un titre, heure de démarrage du suivant (heure actuelle + temps restant, comme la maquette ; le cas du fondu est tranché à l'étape 7), niveau d'alerte selon des seuils (`aucun` / `bientôt` / `maintenant`, fonction prête pour l'étape 7), temps d'intro restant (talk-over). Les calculs existants (heures de passage du conducteur, décalage d'horloge) y sont **regroupés**. Les calculs des étapes 11 (avance / retard, backtiming, minuteur de séquence, compte à rebours) seront ajoutés **dans ce même module** avec leurs fonctionnalités. | Écrire dès maintenant tous les calculs de l'étape 11 (code sans utilisateur pendant plusieurs étapes). |
| 11 | **Journal d'audit** | Migration : colonnes `category` (`securite`, `contenu`, `antenne`, `regie`, `systeme`), `actor_name` (nom figé au moment de l'action, lisible même si le compte est supprimé) et `studio_id` (facultatif) ; index (`category`, `at`). Un seul point d'écriture typé (la liste des actions et leur catégorie dans `packages/shared`). Les entrées existantes reçoivent leur catégorie par la migration. | Une table séparée pour la main courante (deux journaux à tenir à jour). |
| 12 | **Consultation du journal** | Page admin **« Journal »** : liste paginée, filtres par catégorie, compte et période. Lecture seule. Conservation **1 an**, purge quotidienne (comme la corbeille). Aucun mot de passe ni jeton n'y est jamais écrit (règle existante). | Pas de consultation avant l'étape 10 (journal invisible, donc peu vérifié). |
| 13 | **Tests de bout en bout** | `@playwright/test` en **dépendance de développement** (version fixée), dossier `e2e/`, commande `npm run test:e2e` **séparée** de `npm test`. Le serveur compilé est lancé sur une base temporaire, simulateur accéléré. Nouveau job CI `e2e` (Chromium seul). Premiers scénarios : appairage et affichage ; titre en cours qui change ; **coupure du serveur → l'écran garde l'affichage, se reconnecte seul et resynchronise l'état** ; sortie de lecture par **appui long**. | Garder les vérifications navigateur manuelles des étapes 3 à 5 (non rejouables). |

## Serveur

- **Migration 6** (nouvelle entrée) :
  - `studios` (id, nom, dates) + studio par défaut ;
  - `devices.studio_id` (studio par défaut pour les écrans existants) ;
  - `prompter_state` recréée avec `studio_id` en clé (données reprises) ;
  - `audit_log` : `category`, `actor_name`, `studio_id`, index ; catégorie remplie pour les entrées existantes.
- **`AirState`** (`apps/server/src/air/`) : état par studio, version, application d'un changement → diffusion du différentiel aux connexions de ce studio.
- **Connecteurs** (`apps/server/src/connectors/`) : contrat commun, registre des connecteurs disponibles, démarrage / arrêt selon le paramètre, simulateur. Une erreur de connecteur ne fait jamais tomber le serveur : état `erreur` affiché, nouvel essai.
- **WebSocket** : `hello` enrichi (`studio`, état antenne complet) ; message `air` ; message client `air.sync` (demande d'état complet), limité en débit.
- **Paramètres** : `automationSource` (`none` / `simulator`) et `simulatorSpeed` ; validés par zod.
- **Journal** : `GET /api/audit` (admin, pagination et filtres validés), purge à 1 an.

## Interface

- **Écran studio** : blocs « Titre en cours » / « Titre à venir » dans le bandeau ; heure et temps restant calculés avec l'**heure serveur** (décalage déjà en place) ; affichage conservé pendant une coupure.
- **Paramètres (admin)** : section « Source d'automation » (aucune / simulateur, vitesse du simulateur), avec l'état du connecteur (en marche, erreur, dernière mise à jour).
- **Administration** : page « Journal ».
- **Textes** : FR et EN.

## Hors périmètre de l'étape 6

- RadioDJ, AzuraCast, bascule direct / hors direct (étapes 7 et 8).
- Alertes de fin de titre et leurs seuils paramétrables (étape 7) ; seule la fonction de calcul est posée.
- On Air, météo (étape 9) ; rôle Réalisateur et main courante (étape 10).
- Gestion de plusieurs studios dans l'interface (une seule station, un seul studio pour l'instant).

## Tests prévus

- **Commun** : temps restant et progression (début, milieu, fin, dépassement), heure de démarrage du suivant (passage de minuit), niveaux d'alerte aux seuils exacts, intro restante ; non-régression des heures de passage du conducteur après regroupement.
- **Serveur** :
  - migration 6 (prompteur et écrans existants rattachés au studio par défaut, catégories du journal) ;
  - état antenne : version croissante, différentiel limité aux champs modifiés, état complet sur `hello` et `air.sync`, isolation par studio ;
  - simulateur (horloge simulée) : enchaînement des titres, titre à venir, arrêt propre ; changement de source à chaud ;
  - connecteur en erreur : état `erreur`, serveur toujours debout ;
  - journal : catégories, filtres, pagination, admin seul, purge à 1 an.
- **Bout en bout (Playwright)** : les 4 scénarios de la décision 13.

## Vérifications avant de pousser

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, et contrôle du poids de `/studio`.

## Changements à signaler

- **Nouvelle dépendance de développement** : `@playwright/test` (pas dans l'image Docker). Les navigateurs ne sont pas téléchargés à l'installation (`allowScripts` inchangé) ; la CI installe Chromium dans son propre job.
- **Format du WebSocket** modifié (`hello` enrichi, message `air`) : serveur et écran sont livrés ensemble dans la même image, sans incidence pour l'utilisateur.
- Aucune nouvelle exposition réseau : le simulateur n'ouvre aucun port et n'appelle rien à l'extérieur.

---

## Bilan de l'étape 6

### Réalisé

- **Commun** (`packages/shared`) :
  - `timing.ts` : calculs existants regroupés (décalage d'horloge, durées et heures de passage du conducteur) et nouveaux calculs du titre en cours : temps écoulé / restant, progression, heure de démarrage du suivant, intro restante (talk-over), niveau d'alerte (`none` / `soon` / `now`, prêt pour l'étape 7), compte à rebours arrondi à la seconde supérieure ;
  - `air.ts` : types de l'état antenne (titre, source, studio), messages `air` et `air.sync`, application d'un message côté écran avec détection d'une version manquante ;
  - `audit.ts` : catalogue des actions et de leur catégorie (une action inconnue ne compile pas), filtres du journal ;
  - paramètres `automationSource` (`none` / `simulator`) et `simulatorSpeed` (1 à 60).
- **Migration 6** : table `studios` et studio par défaut ; `devices.studio_id` ; `prompter_state` recréée avec une ligne par studio (données reprises) ; `audit_log` complétée (`category`, `actor_name`, `studio_id`, index) avec les catégories et noms des entrées existantes. `devices.studio_id` est facultative (null = studio par défaut) : SQLite refuse une valeur par défaut non nulle sur une colonne liée ajoutée après coup.
- **Serveur** :
  - `air/state.ts` : état par studio, en mémoire, versionné ; seuls les champs réellement modifiés sont diffusés, et seulement aux connexions du studio ;
  - `connectors/` : contrat commun (`start` / `stop`, `update` / `fail`, heures sur l'horloge serveur), gestionnaire (redémarrage seulement si la configuration change, appels d'un ancien connecteur ignorés, erreur affichée et journalisée une fois, nouvel essai toutes les 30 s, retour journalisé), simulateur (12 titres inventés, enchaînement calculé sur l'heure de fin théorique, sans dérive) ;
  - prompteur et WebSocket rattachés au studio de la connexion (écran : son studio ; compte : studio par défaut) ; `hello` enrichi (studio, état antenne complet), message `air`, `air.sync` limité à une demande par seconde ;
  - `GET /api/air` (état du connecteur pour la page Paramètres), `GET /api/audit` (admin, filtres et pagination par 50) ;
  - journal : écriture typée, nom de l'auteur figé, changement de source tracé (`automation.source_changed`), purge quotidienne à 1 an.
- **Interface** :
  - écran studio : blocs **Titre en cours** (titre, artiste, temps restant en grand, barre de progression animée par `transform`, durée, outro) et **Titre à venir** (titre, artiste, durée, intro, heure de démarrage), calculés sur l'heure serveur, masqués si la source est « aucune », conservés pendant une coupure ;
  - Paramètres : section **Source d'automation** (aucune / simulateur, accélération) avec l'état du connecteur ;
  - page admin **Journal** : filtres catégorie, auteur, période ; pagination ; heures dans le fuseau de la station ;
  - textes FR et EN.
- **Tests de bout en bout** : `@playwright/test` 1.56.1 en dépendance de développement, dossier `e2e/` (serveur compilé lancé sur une base temporaire, arrêtable et relançable), `npm run test:e2e`, job CI `e2e` (Chromium, rapport conservé en cas d'échec). `npm run typecheck` couvre aussi `e2e/`.

### Tests

- 160 tests unitaires (55 en commun, 105 serveur), dont : calculs de temps (début, milieu, fin, dépassement, passage de minuit, seuils exacts), application des messages `air` (ordre, trou de version, doublon) ; migration 6 (écran, prompteur et journal existants) ; état antenne (version, différentiel, isolation par studio) ; simulateur (enchaînement sans dérive, arrêt, changement de source) ; connecteur en erreur (état, journal une seule fois, nouvel essai, retour) ; WebSocket (`hello`, différentiel, `air.sync` limité) ; prompteur et état antenne isolés entre deux studios ; journal (admin seul, catégories, nom figé après renommage, filtres, pagination, purge).
- **Bout en bout (Chromium)**, 4 scénarios, stables sur trois passages : appairage par l'adresse du kiosk (jeton retiré de l'adresse) et affichage ; titre en cours qui change (le titre annoncé « à venir » est bien le suivant) ; **coupure du serveur** (texte et titres conservés, bandeau de coupure, reconnexion seule, état resynchronisé) ; sortie de lecture (un clic ne fait rien, l'appui long sort).
- **Poids de `/studio`** : +2,5 Ko gzip (73,7 → 76,2 Ko, entrées et mise en page comprises), toujours sans l'éditeur.

### Écarts et limites connues

- En cas d'erreur du connecteur, titre en cours et titre à venir sont effacés (on ne sait plus ce qui passe) : le bloc affiche « Source d'automation indisponible » jusqu'au retour.
- Après un redémarrage du serveur, le simulateur repart du premier titre (état en mémoire, décision 3).
- Les filtres de dates du journal sont en UTC (une heure ou deux d'écart en bord de journée) ; l'affichage, lui, est dans le fuseau de la station.
- Les actions du journal sont affichées par leur code technique (`script.trashed`…), avec leur catégorie traduite.

