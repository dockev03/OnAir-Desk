# Étape 7 — RadioDJ : plan

> **Statut : réalisée (bilan en fin de document).**
> Référence : `CLAUDE.md` §5 (bandeau supérieur, alertes), §6 (RadioDJ), §7 idée 1 (talk-over), §8 étape 7, §10 (connecteurs). Constats techniques : `docs/cadrage-radiodj.md`. Branche : `feature/etape-7-radiodj`.
> 6 fonctionnalités. S'appuie sur le socle de l'étape 6 (état antenne, contrat des connecteurs, calculs de temps, journal).

## Objectif

1. **Titre en cours** depuis RadioDJ.
2. **Titre à venir** et heure de démarrage calculée.
3. **Alerte fin de titre** : orange / rouge pulsé, seuils paramétrables.
4. **Repères intro / outro**.
5. **Talk-over** (les repères intro sont lisibles : vérifié au cadrage).
6. **Titres musicaux remplis automatiquement dans les conducteurs** : choix dans la bibliothèque RadioDJ (décision 12).

## Rappel du cadrage

- Le plugin *Metadata Export* (onglet Web) n'envoie que `xpwd=<jeton>&title=<Artiste - Titre>` : c'est un **signal** « un titre démarre ».
- Les données viennent de la **base RadioDJ, en lecture seule** : `history` (titre en cours), `songs.cue_times` (repères), `queuelist` (à venir).
- RadioDJ refuse le certificat HTTPS : le signal arrive sur un **port HTTP dédié aux connecteurs**.

## Décisions

Les 14 décisions sont **validées** ; la colonne « Alternative » garde trace des options écartées.

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **Source de vérité** | La **base** fait foi. Le signal du plugin déclenche une relecture **immédiate** ; une relecture **toutes les 5 s** sert de filet si un signal se perd (et rattrape les modifications de playlist sans changement de titre). Le plugin est donc **recommandé mais pas indispensable**. | Signal seul (aucune donnée exploitable) ; base seule sans signal (jusqu'à 5 s de retard au changement de titre). |
| 2 | **Titre en cours** | Dernière ligne de `history` **qui n'est pas un habillage** (`song_type` 2 Sweeper et 3 Voiceover exclus), jointe à `songs` par `trackID` pour les repères. Les jingles, pubs, flashs… (autres types) sont affichés : ils passent à l'antenne et le compte à rebours doit les suivre. | Ne suivre que la musique (compte à rebours faux pendant les pubs). |
| 3 | **Heure de début** | Si le signal est reçu au moment où la nouvelle ligne apparaît (moins de 10 s d'écart) : **heure de réception du signal**, sur l'horloge serveur. Sinon (titre découvert par la relecture) : `date_played` converti avec le **fuseau de la station** (précision à la seconde, dépend du NTP du PC RadioDJ). | Toujours `date_played` (dépend entièrement de l'horloge du PC RadioDJ). |
| 4 | **Durées et repères** | Calculés par le connecteur à partir de `cue_times`, en secondes **relatives à `sta`** (début de lecture) : durée affichée = `xta` (point de mix) − `sta`, à défaut `end` − `sta`, à défaut `duration` ; intro = `int` − `sta` (si présent) ; outro = fin − `out` (si présent). Le type `Track` de l'étape 6 **ne change pas** : la durée vaut « jusqu'au départ du titre suivant ». | Ajouter un champ « point de mix » à `Track` (tous les calculs et écrans à reprendre). |
| 5 | **Heure de démarrage du titre suivant** | Inchangée : heure actuelle + temps restant (`nextStartAt`). Comme la durée s'arrête au point de mix (décision 4), **le fondu est pris en compte**. Cela tranche la question du §5. `ETA` de RadioDJ n'est pas utilisée (horloge du PC RadioDJ, à la seconde). | Afficher `ETA` (heure du PC RadioDJ, pas celle du serveur). |
| 6 | **Titre à venir** | Première ligne de `queuelist` dans l'ordre (`ID` croissant, jamais l'`ID` lui-même comme clé), jointe à `songs` par `songID` pour l'intro et la durée. | — |
| 7 | **Port HTTP dédié aux connecteurs** ⚠️ | Variable d'environnement `CONNECTOR_HTTP_PORT` : **absente = port fermé** (défaut). Quand elle est renseignée, un second serveur HTTP n'expose **que** `POST /api/connectors/radiodj` (aucune interface, aucune session, aucun cookie), avec une limite de débit (60 requêtes / minute). Le port est à publier dans la stack (`docker-compose.yml`, commenté par défaut). Réseau interne uniquement. | Ouvrir l'interface entière en HTTP (inacceptable) ; renoncer au signal (décision 1 le permet, au prix de 5 s de retard). |
| 8 | **Jeton du plugin** | Généré par l'admin dans Paramètres (comme le jeton du kiosk) : affiché **une seule fois**, stocké **haché**, **régénérable** (l'ancien cesse aussitôt de fonctionner). Lu dans le champ `xpwd`. Jamais écrit dans les journaux. Une requête au mauvais jeton : `401`, journal serveur limité (pas d'entrée d'audit à chaque essai). | Jeton en variable d'environnement (moins accessible à une petite radio, redémarrage pour le changer). |
| 9 | **Accès à la base RadioDJ** | Paramètres admin : hôte, port (3306), nom de la base (`radiodj`), utilisateur. **Mot de passe en variable d'environnement** `RADIODJ_DB_PASSWORD` (règle « aucun secret en dur »), jamais renvoyé par l'API. Bibliothèque **`mysql2`** (pur JavaScript, aucun script d'installation). Connexion en **lecture seule** côté OnAir-Desk aussi (requêtes `SELECT` uniquement), délai de connexion court (5 s). Bouton **« Tester la connexion »**. | Mot de passe dans les paramètres en base (secret stocké dans SQLite, visible dans les sauvegardes). |
| 10 | **Panne de la base** | Le contrat de l'étape 6 s'applique (`fail` → état « erreur », nouvel essai, journal une fois). **Mode dégradé** : si un signal arrive alors que la base est injoignable, le titre reçu (`Artiste - Titre`) est affiché tel quel, **sans** temps restant, durée ni alerte. | Écran vide tant que la base est injoignable. |
| 11 | **Alerte fin de titre** | Sur le temps restant du titre en cours, **quelle que soit la source** (simulateur compris) : ≤ seuil « bientôt » → bloc **orange** + « Bientôt à vous » ; ≤ seuil « maintenant » → **rouge pulsé** (~1 Hz) + « À vous dans N s ». `prefers-reduced-motion` : rouge fixe. Seuils dans Paramètres : **30 s et 10 s** par défaut, « maintenant » < « bientôt », 1 à 120 s. Fonction `alertLevel` de l'étape 6. Pas d'alerte en mode dégradé. | Alerte réservée à RadioDJ. |
| 12 | **Titres dans les conducteurs** | **Option A, retenue.** Dans l'éditeur de conducteur, un élément de type « titre » peut être **choisi dans la bibliothèque RadioDJ** (recherche par artiste / titre dans `songs`) : titre, artiste et durée (décision 4) sont remplis, la durée compte dans les heures de passage. Seulement si RadioDJ est la source configurée. | **B.** Bouton « Importer la file RadioDJ » : ajoute au conducteur un élément par titre de `queuelist`. **C.** Pendant l'émission, les éléments « titre » affichent ce qui passe réellement (proche du bilan d'émission de l'étape 11). |
| 13 | **Repères et talk-over à l'écran** | Bloc « Titre en cours » : pendant l'intro, compte à rebours **« Intro 0:07 »** (couleur neutre, hors code d'alerte), qui disparaît à la fin de l'intro ; repères **intro et outro** marqués sur la barre de progression. Sans repère `int`, rien n'est affiché (pas de chiffre faux). | Talk-over en orange / rouge (confusion avec l'alerte de fin). |
| 14 | **Tests sans RadioDJ** | Le connecteur lit la base à travers une petite interface (« lecteur RadioDJ ») : tests unitaires avec un faux lecteur. Les **requêtes SQL** sont testées contre un **MariaDB 11.4 réel** dans un nouveau job CI (service conteneur), sur un schéma réduit reproduisant `history`, `songs`, `queuelist` ; en local, ces tests ne tournent que si `MARIADB_TEST_URL` est défini. | Pas de test SQL (erreurs de requête découvertes seulement au studio). |

## Serveur

- **Connecteur RadioDJ** (`apps/server/src/connectors/radiodj/`) :
  - lecteur de base (`mysql2`, `SELECT` uniquement) : dernier titre de `history` hors habillages, première ligne de `queuelist`, repères de `songs` ;
  - analyse de `cue_times` (clés absentes, valeurs invalides ignorées) ;
  - conversion en `Track` (décision 4), heure de début (décision 3) ;
  - relecture sur signal et toutes les 5 s ; mode dégradé (décision 10).
- **Gestionnaire** : `radiodj` ajouté aux sources ; redémarrage quand ses paramètres changent ; le signal reçu est transmis au connecteur actif du studio.
- **Écoute connecteurs** (décision 7) : second serveur Fastify minimal, démarré seulement si `CONNECTOR_HTTP_PORT` est défini ; corps lu comme formulaire (`xpwd`, `title`), validé par zod.
- **Paramètres** : `automationSource` accepte `radiodj` ; nouveaux champs `radiodj` (hôte, port, base, utilisateur) et `trackAlert` (seuils) ; `POST /api/settings/radiodj/test` (test de connexion) ; génération du jeton du plugin.
- **Migration 7** (nouvelle entrée) : stockage du jeton haché du connecteur (table ou paramètre, selon l'existant des jetons d'appareil).
- **Journal** : nouvelles actions au catalogue — jeton du connecteur généré / régénéré (`securite`). Panne et retour de la source : actions existantes de l'étape 6.
- **Configuration** : `CONNECTOR_HTTP_PORT`, `RADIODJ_DB_PASSWORD` dans `.env.example` (sans valeur réelle), port commenté dans `docker-compose.yml`, README (section RadioDJ : réglage du plugin, compte MariaDB `SELECT` seul, filtres conseillés, NTP).

## Interface

- **Écran studio** : alerte de fin de titre (décision 11), compte à rebours d'intro et repères sur la barre (décision 13), mode dégradé (titre seul). Poids de `/studio` à vérifier.
- **Paramètres (admin)** : source « RadioDJ » ; accès à la base + « Tester la connexion » ; jeton du plugin (générer / régénérer, affiché une fois, avec le réglage à recopier dans RadioDJ) ; seuils d'alerte.
- **Conducteurs** : élément « titre » choisi dans la bibliothèque RadioDJ (recherche artiste / titre), titre, artiste et durée remplis (décision 12).
- **Textes** : FR et EN.

## Changements à risque

- **Port HTTP supplémentaire** (décision 7) : fermé par défaut ; seule la route du connecteur ; réseau interne ; jeton en clair sur le réseau local (accepté : la requête n'est qu'un signal).
- **Accès réseau à MariaDB** (côté station) : compte `SELECT` seul, limité à l'IP du serveur. Fait par la station, documenté dans le README.

## Hors périmètre de l'étape 7

- AzuraCast, bascule direct / hors direct, écran de veille (étape 8).
- Voicetracks : non testés au cadrage ; ignorés comme les sweepers (décision 2).
- Lecture de la file au-delà du premier titre à venir.

## Tests prévus

- **Commun** : seuils d'alerte (déjà couverts) ; validation des nouveaux paramètres (seuils cohérents, accès base).
- **Serveur** :
  - analyse de `cue_times` (complet, sans `int`, sans `xta`, valeurs invalides) et conversion en `Track` ;
  - connecteur avec faux lecteur : titre en cours hors habillages, titre à venir, heure de début (signal / sans signal, fuseau), relecture périodique, panne puis retour, mode dégradé ;
  - écoute connecteurs : fermée par défaut, seule route exposée, jeton valide / invalide / absent, limite de débit, jeton absent des journaux ;
  - jeton : génération, hachage, régénération (l'ancien refusé), admin seul ;
  - requêtes SQL contre MariaDB réel (job CI dédié).
- **Bout en bout (Playwright)** : passage **orange puis rouge** de l'alerte de fin avec le simulateur accéléré ; compte à rebours d'intro ; signal du plugin refusé sans jeton.

## Bilan de l'étape 7

### Réalisé

- **Commun** (`packages/shared`) :
  - source d'automation `radiodj` ; paramètres `radiodj` (hôte, port, base, utilisateur ; **aucun mot de passe** accepté) et `trackAlert` (seuils 1 à 120 s, « maintenant » < « bientôt », 30 s / 10 s par défaut) ;
  - `isTimed` (titre minuté ou mode dégradé), `trackAlertLevel` (jamais d'alerte sans titre minuté) ; `nextStartAt` ignore un titre non minuté ;
  - types d'API (jeton du connecteur, test de connexion, titre de la bibliothèque) ; action `connector.token_generated` au journal.
- **Serveur** :
  - `connectors/radiodj/` : analyse de `cue_times` et conversion en `Track` (durée jusqu'au point de mix, intro, outro, artistes associés « ; » → « , ») ; lecteur MariaDB `mysql2` (SELECT uniquement, dates rendues telles quelles) ; connecteur (relecture au signal puis à +0,5 / 1,5 / 3 s, et toutes les 5 s ; heure de début = signal reçu dans les 10 s, sinon `date_played` converti avec le fuseau de la station ; titre fini depuis plus de 30 s effacé ; mise à jour seulement si quelque chose change) ;
  - gestionnaire : source `radiodj`, redémarrage si l'accès ou le fuseau change, signal transmis au connecteur, **mode dégradé** (titre brut, 10 minutes au plus) quand la base est en panne, erreurs explicites (`radiodj_not_configured`, `radiodj_no_password`…) ;
  - **écoute dédiée aux connecteurs** (`connectors/ingest.ts`) : serveur Fastify séparé, démarré seulement si `CONNECTOR_HTTP_PORT` est défini, une seule route `POST /api/connectors/radiodj`, formulaire `xpwd` / `title`, 60 requêtes / minute, 4 Ko au plus ;
  - **migration 7** : table `connector_tokens` (jeton haché) ; routes admin `GET/POST /api/settings/radiodj/token`, `POST /api/settings/radiodj/test` ; `GET /api/radiodj/songs` (comptes connectés, RadioDJ choisi comme source) ;
  - configuration : `CONNECTOR_HTTP_PORT` (différent de `PORT`), `RADIODJ_DB_PASSWORD` (jamais journalisé ni renvoyé).
- **Interface** :
  - écran studio : alerte de fin de titre (bloc orange + « Bientôt à vous », puis rouge pulsé à ~1 Hz + « À vous dans N s », rouge fixe avec `prefers-reduced-motion`), compte à rebours **« Intro 0:07 »** en couleur neutre, repères intro / outro sur la barre de progression, mode dégradé (titre seul, sans temps restant) ;
  - Paramètres : source RadioDJ, accès à la base + « Tester la connexion » (accès saisi, même non enregistré), jeton du plugin (générer / régénérer, montré une fois, réglage à recopier dans RadioDJ), seuils d'alerte ; erreurs du connecteur traduites ;
  - conducteurs : bouton **« Choisir dans RadioDJ »** sur chaque élément (si RadioDJ est la source) : recherche artiste / titre, titre « Artiste - Titre », durée jusqu'au point de mix, type « Titre » s'il existe ;
  - textes FR et EN.
- **Installation** : `docker-compose.yml`, `.env.example` et README (section RadioDJ : compte SELECT seul, exposition de MariaDB, NTP, variables, réglage du plugin et des filtres).
- **CI** : nouveau job `mariadb` (service MariaDB 11.4) pour les requêtes SQL.

### Tests

- 199 tests unitaires (dont 6 contre MariaDB, joués en CI ou si `MARIADB_TEST_URL` est défini), dont :
  - repères réels relevés au cadrage (avec et sans intro, sans repère, repère hors du titre), conversion d'heure du PC RadioDJ (heure d'été / d'hiver) ;
  - connecteur avec fausse base : habillage ignoré, signal avant l'écriture de la ligne, signal trop ancien, relecture périodique, même titre rejoué, RadioDJ arrêté, panne ;
  - gestionnaire : accès incomplet sans ouverture de la base, redémarrage seulement si l'accès change, signal ignoré hors source RadioDJ, mode dégradé puis retour ;
  - écoute dédiée : bon / mauvais / absent jeton, jeton dans l'adresse ignoré, aucune autre route, limite de débit ; jeton haché, régénérable, absent du journal ; test de connexion et recherche (mot de passe jamais renvoyé, erreurs codées) ;
  - SQL réel : titre en cours hors habillages, file dans l'ordre, tables vides, recherche limitée à la musique, jokers `%` / `_` neutralisés, accents, mauvais mot de passe, base ou table absente.
  - Vérifié aussi à la main : un compte MariaDB avec le seul droit `SELECT` suffit, et toute écriture lui est refusée.
- **Bout en bout (Chromium)**, 3 nouveaux scénarios (7 au total) : compte à rebours d'intro puis disparition, repères sur la barre ; alerte rien → orange → rouge → rien ; écoute des connecteurs (jeton requis, interface absente de ce port, route absente du port principal).
- **Poids de `/studio`** : +2,3 Ko gzip (mesure avant / après avec la même méthode), toujours sans l'éditeur.

### Écarts et limites connues

- **Port des connecteurs dans la stack** : le plan prévoyait une ligne commentée dans `docker-compose.yml`, mais une stack Portainer « Repository » ne se modifie pas sans changer le dépôt. Le port est donc piloté par des variables : publié par défaut sur `127.0.0.1` seulement (injoignable du réseau), et l'application ne l'écoute que si `CONNECTOR_HTTP_PORT` est renseigné ; `CONNECTOR_BIND` choisit l'adresse de publication.
- Le compte à rebours de talk-over n'existe que pour les titres dont l'intro est marquée dans RadioDJ.
- Pendant l'heure répétée du passage à l'heure d'hiver, l'heure de début tirée de `date_played` (sans signal) peut être décalée d'une heure.
- Voicetracks non testés au cadrage : ignorés comme les sweepers.
- La recherche de titres ouvre une connexion à chaque requête (saisie temporisée à 300 ms) : suffisant sur le réseau local.
- Réglages faits sur une installation de test ; à vérifier au studio : délai réel entre le signal et l'écriture dans `history`, et comportement avec un voicetrack.
