# Étape 8 — AzuraCast et écran de veille : plan

> **Statut : réalisée (bilan en fin de document).**
> Référence : `CLAUDE.md` §2 (question ouverte 3), §5 (principes d'affichage), §6 (AzuraCast), §7 idée 17 (écran de veille), §8 étape 8, §10 (connecteurs, dispositions). Branche : `feature/etape-8-azuracast`.
> 6 fonctionnalités. S'appuie sur le socle de l'étape 6 (état antenne, contrat des connecteurs) et sur le gestionnaire de l'étape 7.

## Objectif

1. **Connecteur AzuraCast** : titre en cours et titre à venir.
2. **Bascule de source** : RadioDJ en direct, AzuraCast le reste du temps.
3. **Écran de veille** hors émission.
4. **Protection contre l'usure** de l'écran.
5. **Dispositions toutes prêtes**, choisies par émission.
6. **Indicateur de connexion discret**.

## Rappel du cadrage (constats sur l'installation de la station de départ)

- AzuraCast **Rolling Release** `#b62d317` (2026-07-21), sur un **VPS distant** (pas sur le serveur OnAir-Desk). Station `vichyradio`, `is_public: true` : **aucune clé API nécessaire** pour lire l'état.
- Certificat HTTPS **auto-signé** à ce jour.
- `GET /api/nowplaying/vichyradio` répond, avec les champs utiles :
  - `now_playing` : `played_at` (secondes Unix), `duration` (entier, s), `elapsed`, `remaining`, `song.artist` / `song.title` / `song.text` ;
  - `playing_next` : rempli hors direct (`played_at` prévu, `duration` décimale) ;
  - `live` : `is_live`, `streamer_name`, `broadcast_start`.
- **Aucun repère intro / outro** dans l'API : ni talk-over ni repères sur la barre avec AzuraCast.
- Flux temps réel **SSE (Centrifugo 6.9)** `GET /api/live/nowplaying/sse` : connexion acceptée, pings réguliers. La publication au changement de titre reste à voir (à vérifier : voir « Vérifications restantes »).
- Le direct RadioDJ passe par AzuraCast, **en tant que DJ / streamer** (encodeur RadioDJ vers le port DJ). `live.is_live` doit donc passer à `true` pendant le direct (capture JSON en direct **non faite** : voir « Vérifications restantes »).
- Écart entre l'API et ce qu'on entend : **une dizaine de secondes**, à confirmer en production.
- Remarque : les URL renvoyées (`public_player_url`, pochettes) pointent vers `http://localhost:9080`, car l'« URL de base du site » n'est pas renseignée dans AzuraCast. Sans effet ici : OnAir-Desk n'utilise pas ces URL.

## Décisions

Les 16 décisions sont **validées** ; la colonne « Alternative » garde trace des options écartées.

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **Réception des données** | Flux **SSE** (une connexion sortante, maintenue, reconnexion automatique) **et** relecture de `GET /api/nowplaying/<shortcode>` **toutes les 30 s** en filet (et à chaque (re)connexion). Tout est **sortant** depuis le serveur : aucun port à ouvrir côté OnAir-Desk. | Webhook AzuraCast (le VPS devrait joindre le réseau interne : exposition inacceptable) ; relecture seule toutes les 5 s (charge inutile, jusqu'à 5 s de retard). |
| 2 | **Certificat auto-signé** ⚠️ | Vérification TLS **toujours active**. Deux voies documentées : (a) **recommandée** : certificat Let's Encrypt sur AzuraCast (intégré à AzuraCast, il faut un nom de domaine) ; (b) variable `AZURACAST_CA_FILE` : chemin d'un certificat PEM (monté dans le conteneur) ajouté aux autorités de confiance **pour ce connecteur seulement**. | Option « ignorer le certificat » (interdit : n'importe qui sur le chemin réseau pourrait injecter des titres). |
| 3 | **Paramètres** | Paramètres admin : **URL d'AzuraCast** (`https://…` uniquement) et **nom court de la station**. Bouton **« Tester la connexion »** (affiche le nom de la station et le titre en cours). Accès HTTP par le module `https` de Node : **aucune nouvelle dépendance**. | — |
| 3 bis | **Clé API** ⚠️ | **Prise en charge complète**, pour une station qui ne veut pas laisser son état lisible sans authentification (page publique désactivée dans AzuraCast) : <br>• clé en variable `AZURACAST_API_KEY` (aucun secret en base), envoyée dans l'en-tête `X-API-Key` sur **toutes** les requêtes (lecture et flux SSE), **jamais** dans l'adresse ; <br>• envoyée **uniquement en HTTPS avec certificat vérifié** (décision 2) : jamais à un serveur non authentifié ; <br>• jamais renvoyée par l'API, jamais journalisée, masquée dans les messages d'erreur ; <br>• erreur dédiée `azuracast_unauthorized` (clé absente, refusée ou expirée), affichée à l'admin et traduite ; « Tester la connexion » indique si la clé est **requise**, **acceptée** ou **refusée** ; <br>• README : créer dans AzuraCast un **compte dédié** à OnAir-Desk, **sans rôle d'administration** ni droit de gestion de station, et générer la clé sur ce compte (une clé AzuraCast hérite de **tous** les droits de son compte : jamais la clé d'un administrateur). Changer la clé = modifier la variable et redémarrer le conteneur. | Clé dans les paramètres en base (secret dans SQLite et les sauvegardes) ; pas de clé (état de la station lisible par tous). |
| 4 | **Titre en cours / à venir** | `now_playing` → `Track` : titre et artiste depuis `song.title` / `song.artist`, à défaut `song.text` en titre seul ; durée = `duration` ; **intro / outro : null**. `playing_next` → titre à venir, **seulement hors direct** (en direct, c'est la file de l'AutoDJ, pas ce qui passera). Le type `Track` **ne change pas**. Heure de démarrage du titre suivant : calcul du cœur, inchangé (`nextStartAt`). | Afficher `playing_next.played_at` (calcul différent de celui de RadioDJ). |
| 5 | **Heure de début et décalage** | Heure de début = `played_at` (horloge du VPS, synchronisée NTP) **+ un décalage paramétrable** « Retard du flux » (0 par défaut, de −30 à +30 s), pour coller à ce qu'on entend (~10 s constatées, à mesurer en production). Le décalage s'applique au titre en cours, donc au temps restant et à l'alerte de fin. | `played_at` brut (le temps restant affiché se termine ~10 s avant la fin réelle) ; `now − elapsed` (dépend de l'instant de calcul côté AzuraCast). |
| 6 | **Panne d'AzuraCast** | Contrat de l'étape 6 : `fail` → état « erreur », journal une fois, nouvel essai. Une coupure du seul flux SSE n'est **pas** une panne si la relecture répond. Titre effacé si la source est muette depuis plus de 2 min. | — |
| 7 | **Bascule de source : principe** | Nouveau paramètre **« Mode d'antenne »** : *source unique* (comportement actuel, défaut) ou *direct / hors direct*, avec une **source pour le direct** (ex. RadioDJ) et une **source hors direct** (ex. AzuraCast). En mode direct / hors direct, **les deux connecteurs tournent en même temps** ; l'état antenne affiche celui de la source active. | Un seul connecteur à la fois, redémarré à chaque bascule (plusieurs secondes sans titre au passage). |
| 8 | **Bascule : critère** | **Automatique** : direct quand AzuraCast indique `live.is_live = true` (le direct RadioDJ y arrive en streamer). **Forçage manuel** par l'admin (« Forcer le direct » / « Forcer hors direct » / « Automatique ») dans Paramètres ; il sera ouvert au réalisateur à l'étape 10. Critère proposé seulement quand la source hors direct est AzuraCast ; sinon, bascule manuelle seule. Chaque bascule est **tracée** au journal (`automation.switched` : source, cause auto / manuel, auteur). Cela tranche la question ouverte 3 du §2. | Bascule selon les horaires des conducteurs (fragile : émission en avance, en retard ou annulée). |
| 9 | **Bascule : secours** | En direct, si RadioDJ est en panne, l'écran affiche le titre fourni par AzuraCast (métadonnées envoyées par l'encodeur de RadioDJ), **sans minutage** si la durée est absente : même rendu que le mode dégradé de l'étape 7. Retour à RadioDJ dès qu'il répond. | Écran vide pendant la panne. |
| 10 | **Écran de veille : quand** | Affiché sur `/studio` quand **aucun conducteur n'est en cours** (conducteur du jour dont l'intervalle [début − 10 min ; fin calculée + 10 min] contient l'heure serveur) **et** que l'antenne n'est **pas en direct** (décision 8). À l'étape 9, la condition « On Air éteint » s'y ajoutera. Il disparaît **seul** dès qu'une émission commence ; un **clic** le quitte pour 10 min (pour préparer une émission). Le calcul vit dans `packages/shared` (fonction pure testée). | Veille à heures fixes paramétrées (double saisie avec les conducteurs). |
| 11 | **Écran de veille : contenu** | Nom et logo de la station, **horloge** en grand, voyant **On Air** (gris tant que l'étape 9 n'est pas faite), **titre en cours** (et à venir) de la source active, **prochaine émission** (titre et heure du prochain conducteur, aujourd'hui ou demain). | Horloge seule. |
| 12 | **Usure de l'écran** | Les éléments fixes (bandeau, barre latérale) se décalent de **quelques pixels** (±4 px) toutes les **2 minutes**, par `transform` (GPU), sans saut visible pendant la lecture. En veille, le bloc entier **dérive lentement** dans l'écran (toutes les minutes). Paramètre « Protection contre l'usure » : activée par défaut. Respect de `prefers-reduced-motion` (décalages sans transition). | Atténuation de la luminosité (illisible à 2 m sur certains afficheurs). |
| 13 | **Dispositions toutes prêtes** | Trois dispositions **figées dans le code** (pas de réglage bloc par bloc) : **« Animateur seul »** (tout le bandeau, comme aujourd'hui) ; **« Émission avec régie »** (bandeau, plus une **zone régie fixe réservée** sous le bandeau, vide jusqu'à l'étape 10) ; **« Interview »** (bandeau réduit : heure, On Air, temps restant ; plus de place au texte, barre latérale réduite d'office). Choisie **sur le modèle d'émission** et **sur le conducteur** (copiée du modèle à la création, modifiable). Disposition **par défaut** dans Paramètres, appliquée hors émission et aux conducteurs sans choix. Blocs météo et On Air : affichés par toutes les dispositions dès qu'ils existent (étape 9). | Dispositions configurables bloc par bloc (rejeté au §5). |
| 14 | **Indicateur de connexion** | Le point actuel devient : **vert** (connecté), **orange** (reconnexion en cours) + **heure de dernière synchronisation** en petit à côté. Coupure de plus de **30 s** : bandeau large « Connexion perdue depuis 0:42 », **sans masquer** le texte du prompteur (zone fixe, comme les messages régie). Un problème de **source** (AzuraCast ou RadioDJ en erreur) reste discret : petit libellé orange près du titre en cours, jamais en grand. | Point seul (pas d'information de temps). |
| 15 | **Tests sans AzuraCast** | Un **faux serveur AzuraCast** local (HTTPS avec certificat de test, `nowplaying` et SSE) joue les réponses réelles capturées au cadrage (hors direct) et une réponse « en direct » construite d'après la documentation, à remplacer par la capture réelle dès qu'elle est faite. | Tests contre le VPS de la station (dépendance réseau, données changeantes). |

## Serveur

- **Connecteur AzuraCast** (`apps/server/src/connectors/azuracast/`) :
  - client HTTPS (module `https`, autorité `AZURACAST_CA_FILE` facultative, clé `AZURACAST_API_KEY` facultative, délai 5 s) ;
  - analyse de la réponse `nowplaying` (schéma zod tolérant : champs inconnus ignorés) et conversion en `Track` (décisions 4 et 5) ;
  - flux SSE avec reconnexion progressive, relecture toutes les 30 s ;
  - indicateur « en direct » transmis au gestionnaire (décision 8).
- **Contrat des connecteurs** : `AutomationUpdate` reçoit un champ facultatif `live` (booléen ou absent) : seul AzuraCast le renseigne.
- **Gestionnaire** :
  - source `azuracast` ;
  - mode direct / hors direct : deux connecteurs, choix de la source active, secours (décision 9), forçage manuel, journal des bascules ;
  - le signal RadioDJ est transmis au connecteur RadioDJ même s'il n'est pas la source active.
- **État antenne** : nouveau champ `live` (direct ou non, cause auto / forcé). La veille n'y figure pas : l'écran la déduit des conducteurs et de `live` (décision 10).
- **Paramètres** : `automationSource` accepte `azuracast` ; nouveaux champs `azuracast` (URL, nom court, retard du flux), `airMode` (source unique / direct + hors direct, sources, forçage), `defaultLayout`, `burnInProtection` ; `POST /api/settings/azuracast/test`.
- **Migration 9** (nouvelle entrée) : colonne `layout` sur `rundowns` et `rundown_templates` (null = disposition par défaut).
- **Conducteurs** : prochain conducteur (aujourd'hui ou demain) exposé à l'écran studio pour la veille.
- **Journal** : nouvelle action `automation.switched` au catalogue ; changement du mode d'antenne et forçage tracés (`settings`).
- **Configuration** : `AZURACAST_API_KEY`, `AZURACAST_CA_FILE` dans `.env.example` (sans valeur), README (section AzuraCast : Let's Encrypt ou certificat à monter, station publique ou clé API, réglage du retard du flux).

## Interface

- **Écran studio** : bascule transparente de source ; écran de veille (décisions 10 et 11) ; décalage anti-usure (décision 12) ; dispositions (décision 13) ; indicateur de connexion (décision 14). Poids de `/studio` à vérifier.
- **Paramètres (admin)** : source AzuraCast (URL, nom court, retard du flux, « Tester la connexion ») ; mode d'antenne et forçage ; disposition par défaut ; protection contre l'usure.
- **Modèles d'émission et conducteurs** : choix de la disposition.
- **Textes** : FR et EN.

## Changements à risque

- **Connexion sortante vers Internet** : le serveur OnAir-Desk doit joindre le VPS AzuraCast en HTTPS (sortant seulement, aucun port entrant ouvert). À autoriser dans le pare-feu de la station si le serveur est filtré en sortie.
- **Certificat auto-signé** (décision 2) : jamais de vérification désactivée ; certificat à installer ou Let's Encrypt.
- **Clé API AzuraCast** (décision 3 bis) : secret en variable d'environnement, liée à un compte AzuraCast **sans droit d'administration** ; une clé d'administrateur divulguée donnerait la main sur toute l'instance AzuraCast.

## Hors périmètre de l'étape 8

- On Air, chronomètre micro, météo (étape 9) : la veille et les dispositions leur réservent seulement leur place.
- Contenu de la zone régie (étape 10).
- Pochettes d'album (ressource externe à l'afficheur, URL `localhost` à ce jour).
- Repères intro / outro avec AzuraCast (absents de l'API).

## Vérifications restantes (avant la fusion, ou à la mise en service)

1. **Capture `nowplaying` pendant un direct RadioDJ** : confirmer `live.is_live = true`, voir `streamer_name`, ce que montre `now_playing` (titre de l'encodeur RadioDJ ? durée ?) et `playing_next`. La décision 8 en dépend ; si `is_live` ne bouge pas, repli sur la bascule manuelle seule.
2. **Publication SSE au changement de titre** : laisser tourner la commande `curl` du cadrage jusqu'au titre suivant et vérifier qu'une ligne `{"pub": …}` contenant le nouveau titre arrive (sinon, la relecture toutes les 30 s suffit, au prix d'un peu de retard sur la veille).
3. **Retard réel du flux** (décision 5), mesuré au studio.
4. **Accès protégé par clé** (décision 3 bis) : désactiver la page publique de la station, puis vérifier **sans clé** que `nowplaying` et le flux SSE sont bien refusés, et **avec la clé du compte dédié** (`-H "X-API-Key: …"`) qu'ils répondent. Si le flux SSE reste lisible sans clé ou refuse la clé, le connecteur se contente de la relecture toutes les 30 s.

## Tests prévus

- **Commun** : validation des nouveaux paramètres (URL `https` seulement, nom court, retard borné, mode d'antenne cohérent) ; calcul « émission en cours / prochaine émission » (début, fin calculée, marges, minuit, aucun conducteur) ; dispositions.
- **Serveur** :
  - analyse de la réponse réelle capturée, champs absents ou vides, `song.text` seul, conversion en `Track` avec retard du flux ;
  - connecteur contre le faux serveur : SSE puis coupure SSE (relecture seule), panne puis retour, certificat inconnu refusé (et clé **jamais envoyée** dans ce cas), autorité `AZURACAST_CA_FILE` acceptée, clé API dans l'en-tête seulement si définie, sur la lecture comme sur le SSE, jamais journalisée ni renvoyée ; réponses 401 / 403 → `azuracast_unauthorized` ;
  - gestionnaire : bascule auto direct ↔ hors direct, forçage manuel, secours si RadioDJ en panne, journal des bascules, signal RadioDJ transmis en hors direct ;
  - migration 9 et disposition copiée du modèle au conducteur.
- **Bout en bout (Playwright)** : veille affichée sans conducteur puis quittée au démarrage d'une émission ; clic pour quitter la veille ; disposition « Interview » appliquée ; bandeau « Connexion perdue » après coupure prolongée puis retour ; bascule de source visible à l'écran (faux serveur AzuraCast passant en direct).

## Bilan de l'étape 8

### Réalisé

- **Commun** (`packages/shared`) :
  - source `azuracast`, `CONNECTED_SOURCES` ; état antenne complété d'un champ `live` (côté à l'antenne, forçage, état des deux sources) ;
  - paramètres `azuracast` (adresse `https://` sans identifiants, nom court, retard du flux de −30 à +30 s ; **aucune clé acceptée**), `airSwitch` (mode direct / hors direct, deux sources différentes, forçage `auto` / `live` / `offair`), `defaultLayout`, `burnInProtection` ; `sourcesInUse` ;
  - dispositions (`layout.ts`) : trois dispositions figées et leurs effets, `effectiveLayout` ; champ `layout` sur conducteurs et modèles ;
  - écran de veille (`standby.ts`) : fenêtre d'une émission dans le fuseau de la station, émission en cours (marge de 10 min), prochaine émission, `standbyActive` ;
  - `zonedToEpoch` et `addDays` déplacés dans `time.ts` (utilisés par l'écran studio sans charger les schémas) ; action `automation.switched` au journal.
- **Serveur** :
  - `connectors/azuracast/` : client HTTPS sans dépendance (module `https`, autorité `AZURACAST_CA_FILE` ajoutée aux autorités publiques, clé `AZURACAST_API_KEY` dans l'en-tête `X-API-Key`, délai 5 s, codes d'erreur stables), flux SSE Centrifugo (reconnexion de 1 à 60 s, silence de plus de 75 s = reconnexion), lecture tolérante de la réponse « Now Playing », connecteur (relecture au démarrage puis toutes les 30 s, publications SSE, titre fini depuis plus de 2 min effacé) ;
  - **gestionnaire réécrit** : une « source en service » par connecteur (état, panne, nouvel essai, mode dégradé RadioDJ), source unique ou **deux sources simultanées** ; bascule automatique sur l'indicateur « en direct » de la source hors direct (on reste où l'on est si elle ne répond pas), forçage sans redémarrage, **secours** (RadioDJ en panne en direct : titre relayé par AzuraCast, sinon titre signalé) ; chaque bascule journalisée (système, ou l'admin qui a forcé) ; le signal RadioDJ est transmis que RadioDJ soit à l'antenne ou non ;
  - route admin `POST /api/settings/azuracast/test` (station, titre en cours, direct, sort de la clé : non nécessaire / acceptée / refusée / requise) ; recherche de titres RadioDJ ouverte aussi en mode bascule ;
  - **migration 9** (la 8 est celle du conducteur enrichi) : colonne `layout` sur `rundowns` et `rundown_templates` ; disposition copiée du modèle aux conducteurs créés, à la duplication, à l'enregistrement comme modèle et à « Réappliquer le modèle » ;
  - configuration : `AZURACAST_API_KEY`, `AZURACAST_CA_FILE` (lu et vérifié au démarrage).
- **Interface** :
  - écran studio : **veille** (horloge, voyant On Air gris, titre en cours de la source active, prochaine émission ; un clic la quitte pour 10 min) ; **dispositions** (« Interview » : bandeau réduit et barre latérale réduite d'office ; « Émission avec régie » : zone régie fixe réservée) ; **anti-usure** (bandeau, zone régie et barre latérale décalés de ±4 px toutes les 2 min ; dérive de la veille toutes les minutes ; sans transition avec `prefers-reduced-motion`) ; **indicateur de connexion** (point vert / orange + heure de dernière synchronisation ; bandeau « Connexion perdue depuis m:ss » au-delà de 30 s, dans le bandeau supérieur) ;
  - Paramètres : mode d'antenne, sources du direct et hors direct, bascule (avec rappel du critère automatique), état de chaque source et côté à l'antenne, bloc AzuraCast + « Tester la connexion », disposition par défaut, protection contre l'usure ;
  - éditeurs de conducteur et de modèle : choix de la disposition ;
  - textes FR et EN.
- **Installation** : `docker-compose.yml` (variables AzuraCast), `.env.example`, README (sections AzuraCast, écran de veille et dispositions ; sécurité).

### Tests

- 228 tests unitaires (+34), dont :
  - réponse réelle relevée au cadrage (hors direct) et réponse « en direct » construite d'après la documentation ; texte brut seul, station hors ligne, réponse illisible ; messages SSE (`connect`, `pub`, ancien format) ;
  - client contre un **faux serveur AzuraCast en HTTPS** : certificat inconnu refusé **sans qu'aucune requête n'arrive** (la clé ne part jamais), certificat fourni accepté, clé seulement dans l'en-tête, 401 / 403 / 404 / 500 → codes stables sans la clé dans le message, serveur injoignable, flux SSE avec clé ;
  - connecteur : relecture puis flux, autre station ignorée, panne de relecture, réponse inattendue, titre trop ancien effacé ;
  - bascule : automatique dans les deux sens, forçage tracé au nom de l'admin sans redémarrage, AzuraCast en panne pendant le direct, secours RadioDJ, passage source unique ↔ aucune ;
  - routes : test de connexion (clé non nécessaire / acceptée / refusée / requise, jamais renvoyée ni journalisée, admin seul), validation (http refusé, identifiants dans l'adresse, sources identiques, retard hors bornes) ; dispositions (modèle → conducteurs, modification, valeur inconnue refusée, duplication, enregistrement comme modèle) ;
  - commun : émission en cours (marges, minuit), prochaine émission, veille, dispositions, schémas.
- **Bout en bout (Chromium)**, 4 nouveaux scénarios (11 au total), avec un faux AzuraCast à certificat auto-signé accepté par `AZURACAST_CA_FILE` : test de connexion ; veille (horloge, titre AzuraCast, prochaine émission) ; bascule automatique au direct puis retour, clic pour quitter la veille ; dispositions « Interview » et « Émission avec régie ». Scénario de coupure complété : point orange d'abord, bandeau après 30 s, reconnexion.
- **Poids de `/studio`** : +4,3 Ko gzip (90,8 → 95,1 Ko, même méthode avant / après), toujours sans l'éditeur.

### Écarts et limites connues

- **Veille** : elle ne s'affiche pas non plus pendant que le prompteur affiche un texte (sinon elle couvrirait un script en préparation au bout de 10 minutes).
- **Certificat auto-signé** : comme pour `TLS_CERT_FILE`, le volume `/certs` est commenté dans `docker-compose.yml` ; le décommenter demande de modifier la stack (le plus simple reste Let's Encrypt sur AzuraCast).
- « Clé acceptée » signifie que la requête avec clé a réussi : si la station est publique, AzuraCast répond même sans regarder la clé.
- Voyant On Air de la veille toujours gris jusqu'à l'étape 9 ; zone régie vide jusqu'à l'étape 10.
- Les tests existants de l'écran studio créent désormais une émission « en cours » : sans elle, l'écran est en veille.
- **Vérifications restantes** (voir plus haut), toujours à faire : capture pendant un direct RadioDJ, publication SSE au changement de titre, retard réel du flux, accès protégé par clé. Pour le flux SSE, le connecteur s'abonne au canal `station:<nom court>` (ici `station:vichyradio`) : la commande du cadrage, lancée avec `station:1`, n'a reçu aucune donnée, ce qui est normal sur un canal qui n'existe pas ; la refaire avec le nom court.
