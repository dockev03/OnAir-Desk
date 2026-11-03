# Étape 9 — On Air, météo et liners : plan

> **Statut : plan validé, réalisation à venir.**
> Référence : `CLAUDE.md` §2 (question ouverte 1), §5 (bandeau supérieur, principes d'affichage), §6 (On Air, météo), §7 idées 5 et 7, §8 étape 9, §10 (connecteurs, paramétrage). Branche : `feature/etape-9-onair-meteo-liners`.
> 6 fonctionnalités. S'appuie sur l'état antenne (étape 6), l'écoute dédiée aux connecteurs (étape 7), la veille et les dispositions (étape 8).

## Objectif

1. Route **`POST /api/onair`** protégée par jeton.
2. **Bouton manuel** et **voyant ON AIR**.
3. **Chronomètre micro ouvert**.
4. **Connecteur météo Open-Meteo**, interrogé par le serveur, avec repli en cas de panne.
5. **Attribution** « Météo : Open-Meteo.com ».
6. **Cartes de liners**.

## Rappel

- **Déclencheur retenu à la station de départ** : un bouton du **Stream Deck** et / ou un bouton de la **console**, qui appelle l'API d'OnAir-Desk pour allumer / éteindre le On Air. La route doit donc être simple à appeler depuis ce type de logiciel (requête HTTP avec un jeton). Le déclencheur matériel (GPO de la console, GPIO) reste possible plus tard, avec la même route.
- Open-Meteo : gratuit, sans clé, licence CC BY 4.0 (attribution obligatoire), autorisé pour une radio non commerciale.
- L'afficheur n'a pas besoin d'Internet : c'est le serveur qui interroge la météo et diffuse le résultat.

## Décisions

Les décisions sont **validées** ; la colonne « Alternative » garde trace des options écartées.

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **État On Air** | Ajouté à l'**état antenne** du studio : `onAir: { on, since, source }` (`source` : `http` ou `manuel` ; `since` : heure serveur du dernier passage). **Conservé en base** (migration 10) : un redémarrage du serveur pendant le direct ne l'éteint pas. La dernière action l'emporte, d'où qu'elle vienne. | État en mémoire seulement (voyant éteint après un redémarrage, même micro ouvert). |
| 2 | **Où écoute la route** ⚠️ | `POST /api/onair` sur l'**écoute dédiée aux connecteurs** (`CONNECTOR_HTTP_PORT`), comme le signal RadioDJ : c'est la règle du `CLAUDE.md` pour tout signal envoyé par un équipement, et un petit boîtier GPIO ou un script ne gère pas forcément le certificat interne. Rien n'est ajouté au serveur principal. | Route sur le serveur principal en HTTPS (le boîtier doit installer l'autorité interne ; écart à la règle des connecteurs entrants). |
| 3 | **Jeton** ⚠️ | Comme le jeton du plugin RadioDJ : **généré par l'admin** dans Paramètres, montré une seule fois, stocké **haché**, régénérable. Envoyé dans l'en-tête `Authorization: Bearer …`. Jamais journalisé. 60 requêtes / minute. Écart assumé avec le `CLAUDE.md` §6, qui prévoyait une variable d'environnement : même niveau de sécurité, plus simple pour une petite radio (changer de jeton sans redéployer). La table des jetons est recréée pour accepter `onair` (migration 10, données reprises). | Jeton en variable d'environnement (`ONAIR_TOKEN`, redéploiement pour le changer). |
| 4 | **Requêtes acceptées** | `POST /api/onair`, corps JSON strict : `{"state":"on"}`, `{"state":"off"}` ou **`{"state":"toggle"}`** (un seul bouton qui alterne, sans connaître l'état). Réponse : l'état obtenu (`{"on":true,"since":…}`). **`GET /api/onair`** (même jeton) renvoie l'état, pour que le logiciel tiers allume son bouton en rouge quand le micro est ouvert. Tout autre corps : `400`. Un même état renvoyé deux fois ne change rien (ni `since`, ni journal). Chaque passage est **tracé** (`onair.changed` : état, source, auteur ou « logiciel / équipement »). | Seulement `on` / `off` (le logiciel tiers devrait mémoriser l'état) ; accepter aussi `1` / `0`, `true` / `false` (aucun besoin connu). |
| 4 bis | **Appel simple (adresse seule)** ⚠️ | Certains déclencheurs ne savent ouvrir qu'une adresse (action « Site web » native du Stream Deck, macros réseau de certaines consoles) : ni `POST`, ni en-tête. Variante **désactivée par défaut**, activable dans Paramètres : `GET /api/onair/on`, `/off`, `/toggle` avec le jeton dans l'adresse (`?token=…`). L'adresse n'est **jamais journalisée** (le jeton y figure), même débit limité. Le Stream Deck avec un plugin de requêtes HTTP (ex. « API Ninja ») ou Bitfocus Companion utilise la voie normale (`POST` + en-tête), qui permet aussi d'afficher l'état sur le bouton (`GET /api/onair`). | Pas de variante (le bouton de la console ne pourrait peut-être pas appeler l'API) ; variante toujours active (jeton plus exposé : historique, captures réseau). |
| 5 | **Bouton manuel** ⚠️ | Dans l'**interface** (comptes connectés, admin et animateurs) : bouton « On Air » dans la barre du haut, avec confirmation. Sur l'**écran studio** (kiosk) : bouton sous le voyant, **appui long d'1 seconde**, comme « Sortir » : l'animateur seul en studio n'a souvent que la souris de l'afficheur. C'est une **nouvelle écriture permise au kiosk** (après le choix du script affiché), tracée au nom de l'écran ; elle peut être désactivée dans Paramètres. | Kiosk en lecture seule pour le On Air (le secours passe par un poste connecté). |
| 6 | **Voyant ON AIR** | En haut du bloc horloge (maquette v3) : gris éteint, **rouge allumé**, fixe (pas de clignotement). Aussi sur l'écran de veille (aujourd'hui toujours gris). Le rouge du voyant est celui de la convention radio ; il ne déclenche aucune alerte. **Veille** : la condition « On Air éteint » s'ajoute (étape 8, décision 10) : micro ouvert, pas de veille. | Voyant séparé du bloc horloge. |
| 7 | **Chronomètre micro ouvert** | À côté du voyant allumé : temps écoulé depuis `since` (`m:ss`, puis `h:mm:ss`), calculé sur l'heure serveur, fonction pure dans `packages/shared`. Couleur neutre, sans seuil d'alerte. À l'extinction, la dernière durée reste affichée **10 secondes**, grisée, puis disparaît. | Seuil d'alerte (ex. orange après 5 min de micro ouvert) : à décider plus tard si le besoin apparaît. |
| 8 | **Paramètres météo** | Fournisseur : *aucun* (défaut) ou *Open-Meteo* ; **ville** (nom affiché), **latitude**, **longitude** (bornées, 4 décimales). Rien de propre à Vichy dans le code : la station de départ saisit ses coordonnées. Bouton **« Tester »** (affiche la météo obtenue). Un connecteur météo commun (`WeatherConnector`) permettra d'ajouter Météo-France plus tard. | Recherche de la ville par nom (API de géocodage d'Open-Meteo : une dépendance de plus). |
| 9 | **Interrogation** | Le serveur interroge Open-Meteo **toutes les 20 minutes** (et au démarrage, et à chaque changement de paramètres) : température actuelle, code météo (WMO), jour / nuit, minimale et maximale du jour, dans le fuseau de la station. Délai 10 s. Adresse de l'API modifiable par variable (`OPEN_METEO_URL`) pour les tests seulement. | Toutes les 15 min (plus de requêtes pour une donnée qui bouge peu) ; 30 min. |
| 10 | **Repli en cas de panne** | Dernière valeur **conservée en base** (migration 10) et affichée avec son heure : « 12 °C · à 14:20 » dès qu'elle a plus de 45 minutes ; au-delà de 6 heures, plus rien n'est affiché (donnée trop ancienne). Panne et retour tracés une fois au journal (`weather.error` / `weather.recovered`), comme les connecteurs d'automation. | Effacer la météo dès la première panne. |
| 11 | **Affichage météo** | Sous l'heure, dans le bloc horloge : **pictogramme**, température, libellé court (« Éclaircies »), min / max. Pictogrammes **SVG servis par le serveur** (environ 10, regroupant les codes WMO), aucune ressource externe. Aussi sur l'écran de veille. Affichée dans toutes les dispositions. | Température seule. |
| 12 | **Attribution** | « Météo : Open-Meteo.com » (lien) dans le **pied de page de l'interface** dès qu'Open-Meteo est choisi, et dans la section météo des Paramètres. Pas sur l'écran studio (affichage interne, place réservée à l'antenne). | Page « À propos » dédiée. |
| 13 | **Liners : contenu** | Liste paramétrable dans Paramètres (admin) : jusqu'à **30 cartes**, texte de 200 caractères au plus, actives ou non, dans un ordre choisi. Exemples proposés à l'installation : nom de la station, fréquence, standard, slogan (à adapter). | Bibliothèque de liners par animateur (plus de droits à gérer). |
| 14 | **Liners : affichage** | Bande fixe **en bas de la zone principale** de l'écran studio, jamais par-dessus le texte du prompteur ; rotation toutes les **20 secondes** (réglable, 10 à 120 s), fondu léger (`prefers-reduced-motion` : sans transition). **À la demande** : un clic sur la bande passe à la carte suivante, **sur cet écran seulement** (aucune écriture serveur). Dispositions : affichée en « Animateur seul » et « Émission avec régie », masquée en « Interview » ; jamais sur la veille. Aucun liner actif : pas de bande. | Envoi d'un liner précis depuis un poste (relève de la régie, étape 10). |

## Serveur

- **État antenne** : champ `onAir` ; météo ajoutée aussi à l'état antenne (`weather` : valeur, heure, état de la source), diffusée comme le reste.
- **On Air** : service `OnAirService` (passage d'état, journal, persistance) ; routes `POST /api/onair` et `GET /api/onair` sur l'écoute dédiée (décisions 2 à 4) ; route du bouton manuel `POST /api/studio/onair` (sessions, et kiosk si autorisé, décision 5) ; jeton : `GET/POST /api/settings/onair/token`.
- **Météo** : `connectors/weather/` (interface `WeatherConnector`, connecteur Open-Meteo, correspondance codes WMO → pictogramme et libellé), gestionnaire avec relecture périodique, repli et journal (décisions 8 à 10) ; `POST /api/settings/weather/test`.
- **Migration 10** (nouvelle entrée) : état On Air par studio ; dernière météo ; table des jetons de connecteurs recréée pour accepter `onair` (données reprises).
- **Paramètres** : `onAirKiosk` (bouton sur l'écran studio), `onAirSimpleCall` (appel simple, décision 4 bis), `weather` (fournisseur, ville, coordonnées), `liners` (cartes, durée de rotation).
- **Journal** : nouvelles actions au catalogue — `onair.changed` (`antenne`), `weather.error` et `weather.recovered` (`systeme`) ; jeton On Air : action existante `connector.token_generated`.
- **Configuration** : `OPEN_METEO_URL` (tests), README (route On Air et exemple d'appel, réglage de la météo, liners).

## Interface

- **Écran studio** : voyant ON AIR et chronomètre, bouton On Air à appui long, météo dans le bloc horloge, bande de liners ; veille : voyant réel et météo. Poids de `/studio` à vérifier (pictogrammes SVG chargés à part).
- **Interface** : bouton On Air dans la barre du haut ; pied de page avec l'attribution météo.
- **Paramètres** : jeton On Air (générer / régénérer, avec l'exemple d'appel), bouton On Air sur l'écran studio (oui / non), météo (fournisseur, ville, coordonnées, « Tester »), liners (liste, ordre, actives, durée de rotation).
- **Textes** : FR et EN. README et captures (bloc horloge avec voyant, chronomètre et météo ; liners).

## Changements à risque

- **Écoute des connecteurs** : une deuxième route (`/api/onair`) y est ajoutée ; même protection que le signal RadioDJ (jeton haché, débit limité, réseau interne). Toujours fermée par défaut.
- **Écriture depuis le kiosk** : allumer / éteindre le On Air depuis l'écran studio (appui long, tracé, désactivable).
- **Connexion sortante vers Internet** : le serveur interroge `api.open-meteo.com` en HTTPS ; à autoriser si la Debian est filtrée en sortie.

## Hors périmètre de l'étape 9

- Déclencheur matériel du On Air (câblage, GPIO, boîtier) et voyants micros invités.
- Météo-France et vigilance (idée 22, non validée).
- Envoi d'un liner précis depuis la régie (étape 10).

## Vérifications préalables

- ✅ Accès sortant de la Debian vers Open-Meteo : vérifié (`curl` sur l'API, réponse correcte).
- À vérifier à la mise en service (non bloquant) : ce que savent envoyer le **Stream Deck** (plugin de requêtes HTTP ou action « Site web ») et la **console** (requête `POST` avec en-tête, ou adresse seule) : la décision 4 bis couvre les deux cas.

## Tests prévus

- **Commun** : chronomètre (secondes, heures, extinction), validation du corps On Air, paramètres météo (coordonnées bornées) et liners (nombre, longueur, durée), codes WMO → pictogrammes, fraîcheur de la météo (récente, ancienne, trop ancienne), dispositions (liners masqués en « Interview »), veille avec On Air allumé.
- **Serveur** :
  - route On Air : fermée par défaut, jeton valide / invalide / absent, `on` / `off` / `toggle`, lecture de l'état, appel simple refusé par défaut puis accepté une fois activé (adresse jamais journalisée), corps invalide, même état renvoyé, journal, débit, jeton jamais journalisé ;
  - bouton manuel : compte, kiosk autorisé / refusé, journal au nom de l'écran ;
  - persistance après redémarrage ; migration 10 (jeton RadioDJ conservé) ;
  - Open-Meteo contre un faux serveur : réponse réelle, panne puis retour, valeur ancienne puis trop ancienne, changement de paramètres.
- **Bout en bout (Playwright)** : On Air allumé par la route (`toggle`) → voyant rouge et chronomètre, puis éteint ; appui long sur l'écran studio ; météo affichée puis repli ; rotation et clic sur les liners ; veille masquée micro ouvert.
