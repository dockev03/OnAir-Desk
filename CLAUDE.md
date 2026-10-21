# OnAir-Desk — Cahier des charges et décisions

> Écran studio pour radios : prompteur, conducteurs, horloge, titre en cours / à venir, météo, voyant On Air.
> Ce fichier fait foi. Il est lu automatiquement par Claude Code à chaque session.

Documents liés :
- `docs/maquette-ecran-studio-v3.html` : maquette cliquable de l'écran studio, **validée visuellement**.
- `docs/plan-etape-1.md` : plan détaillé de l'étape 1 (socle), **en attente de validation**.
- `docs/transcription-cadrage.md` : conversation de cadrage d'origine, pour archive.

**Statut : cadrage terminé, aucun code écrit. Ne rien développer sans validation explicite de l'étape.**

**Objectif produit : l'outil doit être utilisable par n'importe quelle radio.** Tout ce qui est propre à une station passe par du paramétrage ; seuls les connecteurs (RadioDJ, etc.) contiennent du code spécifique. Voir §10.

---

## 1. Contexte et objectif

Outil web, hébergé en interne, destiné aux animateurs et journalistes d'une radio. Il réunit sur **un seul écran studio** :
- un **prompteur** (textes / scripts à lire) ;
- les **conducteurs d'émission** (déroulés colorés) ;
- l'**heure à la seconde** ;
- le **titre en cours** et le **titre à venir** (depuis l'automation, RadioDJ pour la station de départ) ;
- la **météo** (Vichy pour la station de départ) ;
- un voyant **On Air**.

## 2. Contraintes (station de départ)

| Sujet | Réponse |
|---|---|
| Logiciel d'automation | **RadioDJ**, installé en local dans le studio |
| Réseau | RadioDJ et le serveur sont sur le **même réseau** (RadioDJ peut appeler le serveur) |
| Serveur d'hébergement | **Debian 13** avec **Docker** |
| Nombre d'écrans prompteur | **1 seul** |
| Matériel d'affichage | **Raspberry Pi 3** en mode kiosk (Chromium), souris branchée |
| Défilement | **Manuel** à la molette **ou automatique**, la vitesse étant programmée **sur chaque script** |
| Texte enrichi | **Oui** (gras, couleurs, surlignage, repères) |
| Conducteurs | **Oui**, avec couleurs |
| Accès kiosk | Compte **générique** ; il peut voir les textes de **tous** les animateurs (accepté) |
| Statut de la radio | **Non commerciale** → Open-Meteo utilisable gratuitement (§6) |
| Dépôt | `dockev03/OnAir-Desk`, **privé** tant que la licence n'est pas décidée |

Questions **encore ouvertes** :
1. Déclenchement du **On Air** : **à définir plus tard** (voir §6). La route HTTP et le bouton manuel sont prévus d'office.
2. Mise en place du **HTTPS** (reverse proxy existant ? certificat interne ?) : voir `docs/plan-etape-1.md`.
3. **Licence** (MIT / AGPL) : voir §11.

## 3. Choix techniques

**TypeScript de bout en bout.**

| Brique | Choix | Raison |
|---|---|---|
| Serveur | Node.js (LTS) + **Fastify** | Léger, bon support WebSocket, même langage que le front |
| Temps réel | **WebSocket** | Titre en cours, scripts, On Air, commandes et heure de référence poussés instantanément |
| Front | **Svelte / SvelteKit** | Compilé en JS natif, très léger : adapté au Pi 3 (1 Go RAM). React/Angular jugés trop lourds |
| Éditeur riche | **TipTap** (ProseMirror) | Maintenu, très utilisé ; contenu stocké en **JSON structuré** (pas de HTML brut → pas d'injection sur le prompteur) |
| Base | **SQLite** | Un fichier, zéro administration |
| Auth | Sessions cookie httpOnly + mots de passe **Argon2** | Simple et solide ; SSO possible plus tard |
| Déploiement | **Docker** (une image) sur Debian 13 | Hébergement interne |

Les choix de détail (bibliothèques, structure du dépôt) sont dans `docs/plan-etape-1.md`.

## 4. Architecture

- **Serveur interne** : scripts, conducteurs, comptes, récupération RadioDJ, météo, On Air.
- **Pi 3 = simple afficheur** : page kiosk, logique minimale, animations en CSS `transform` (GPU). **Aucune ressource externe** (polices, icônes) : tout est servi par le serveur, le Pi n'a pas besoin d'Internet.
- **Interface animateurs** (PC / tablette) : connexion personnelle, rédaction des scripts, montage des conducteurs, bouton **« Envoyer au prompteur »**.
- Les deux voies coexistent : sélection directe sur l'écran studio **ou** envoi depuis un poste ; la dernière action l'emporte.
- **Heure de référence = celle du serveur** : l'écran studio calcule un décalage avec l'heure serveur (via WebSocket) et l'applique à l'horloge et aux comptes à rebours. Le Pi 3 n'a pas de pile RTC ; NTP/chrony reste configuré en plus.

### Accès
- Rôles : **admin** (gère les comptes) et **animateur** (gère ses scripts/conducteurs).
- **Kiosk** : pas d'écran de login ; identifié par un **jeton d'appareil**, **lecture seule** sur tous les dossiers, **révocable / régénérable** par l'admin.

## 5. Écran studio (validé visuellement — voir maquette v3)

Thème sombre (lisibilité, pas d'éblouissement).

### Bandeau supérieur (toujours visible)
1. **Bloc horloge** : voyant **ON AIR** (gris = off, rouge = on) au-dessus, **heure HH:MM:SS**, **météo** dessous.
2. **Bloc « Titre en cours »** : titre, artiste, durée, outro, **temps restant**, **barre de progression**.
   - **Alerte fin de titre** : ≤ 30 s → **orange** + « Bientôt à vous » ; ≤ 10 s → **rouge pulsé** + « À vous dans N s ».
   - Seuils **paramétrables**. Pulsation lente (~1 Hz, pas de flash rapide). Respect de `prefers-reduced-motion` (rouge fixe).
3. **Bloc « Titre à venir »** : titre, artiste, durée, intro, **heure de démarrage calculée**.
   - ⚠️ À trancher à l'étape 4 : heure actuelle + temps restant (maquette), ou prise en compte du fondu/outro si RadioDJ enchaîne en mix.

### Barre latérale gauche
- « Aujourd'hui » (conducteurs du jour), puis **un dossier par animateur** (Conducteurs triés par date / Scripts, sous-dossiers possibles), plus un dossier **Commun** (météo, agenda…).
- Se **réduit automatiquement en icônes** en mode lecture ; bouton « Réduire » manuel.

### Zone principale — deux modes
- **Conducteur** : liste des éléments, **une couleur par type** (jingle, chronique, titre, pub, interview…), **heure de passage calculée**, durée, icône si un script est attaché ; clic → lecture.
- **Lecture (prompteur)** : texte riche en grand, **taille de police réglable**, repères colorés (`[JINGLE]`, `[PAUSE]`, `[LANCER TITRE]`), **bande de lecture** orange, défilement **molette** ou **Auto** (vitesse propre au script, ex. mots/min ; un clic démarre/met en pause, la molette reste utilisable pour corriger), boutons **Précédent / Suivant** dans le conducteur.
- Navigation 100 % souris : grandes zones cliquables, aucune saisie clavier. En lecture, la molette ne sert qu'au défilement ; sortie protégée contre les fausses manipulations (appui long ou confirmation).

## 6. Intégrations

### RadioDJ — titre en cours
- Plugin **Now Playing Info** → export web (HTTP) vers le serveur à chaque changement (artiste, titre, durée).
- Repli : lecture **en lecture seule** de la table d'historique MySQL/MariaDB de RadioDJ (compte dédié sans droit d'écriture).
- ⚠️ Variables disponibles (durée notamment) **à vérifier** sur la version installée, avant de coder cette partie.

### RadioDJ — titre à venir, intro/outro
- Probablement via la **file d'attente en base** (table du type `queuelist`), en lecture seule.
- Repères **intro/outro (cue points)** : RadioDJ les stocke ; lisibilité **à vérifier**.
- ⚠️ Confirmer que la playlist est persistée en base et pas seulement dans le lecteur.

### On Air — déclenchement à définir plus tard
- Route prévue : `POST /api/onair` avec `{"state":"on"}` / `{"state":"off"}`.
- Sécurité : **jeton dédié** (variable d'environnement), **réseau interne uniquement**, validation stricte (`on`/`off` seulement).
- **Bouton manuel** dans l'interface, en secours.
- Déclencheurs possibles plus tard : **GPO de la console** (contact à l'ouverture du fader micro) → **GPIO du Pi** ou boîtier USB I/O ; RadioDJ.
- ⚠️ GPIO du Pi = **3,3 V max** : passer par **optocoupleur ou relais**, jamais en direct. Intervention à confier à un technicien.

### Météo (station de départ : Vichy ≈ 46,13° N, 3,43° E)
- **Open-Meteo** (gratuit, sans clé) : retenu, la radio étant **non commerciale**. Données sous licence **CC BY 4.0** → afficher une **attribution** (« Météo : Open-Meteo.com ») dans l'interface (page « À propos » ou pied de page admin).
- Alternative pour d'autres stations : **Météo-France** (API publique, compte + clé en variable d'environnement).
- C'est le **serveur** qui interroge (toutes les 15–30 min) et diffuse ; le Pi n'a pas besoin d'Internet. En cas de panne : dernière valeur + heure de mise à jour.

## 7. Idées complémentaires (non encore validées)

Par ordre d'utilité estimée :
1. **Talk-over** : compte à rebours de l'intro du titre (parler jusqu'au chant).
2. **Compte à rebours vers horaire fixe** : « Flash infos dans 4:12 », « Top horaire dans 1:05 ».
3. **Avance / retard** sur le conducteur (ex. « +1:20 » en rouge).
4. **Messages régie → animateur** affichés en grand.
5. **Chronomètre micro ouvert** (lié au On Air).
6. **Fiches pratiques** attachées au conducteur (prononciation, fiche invité, contacts).
7. **Contenus locaux** : saint du jour, éphéméride, agenda, trafic, RSS presse locale (licence et fiabilité à vérifier par source).

Contexte marché : horloges studio / écrans On Air existent (produits dédiés, projets open source type OnAirScreen) ; conducteurs/prompteurs surtout dans des logiciels de rédaction pro coûteux. Tout réunir sur un écran simple reste rare dans les petites/moyennes radios.

## 8. Plan de réalisation

1. **Socle** : projet, Docker, SQLite, auth (comptes + jeton kiosk lecture seule), paramétrage minimal, assistant de premier lancement. → détail dans `docs/plan-etape-1.md`.
2. **Scripts** : éditeur TipTap, bibliothèque, vitesse de défilement par script, « Envoyer au prompteur ».
3. **Écran studio** : kiosk, navigation latérale, horloge, temps réel, défilement manuel/auto, alertes.
4. **RadioDJ** : titre en cours / à venir, compte à rebours, intro/outro.
5. **Conducteurs** : édition, couleurs, glisser-déposer, heures de passage, lien prompteur, duplication.
6. **On Air + météo**.
7. **Raspberry Pi** : guide d'installation (Chromium kiosk, démarrage auto, NTP/chrony).

## 9. Règles de travail à respecter

- Travail sur **branche dédiée** (feature/fix), jamais de commit/push direct sur `main`, `master` ou `staging`.
- **Aucun commit ni push sans validation explicite** de l'utilisateur à chaque étape.
- Pratiques sécurisées : validation des entrées, gestion d'erreurs, **aucun secret en dur** (variables d'environnement / coffre).
- Pas d'exposition sur Internet par défaut (réseau interne / VPN), HTTPS.
- Signaler les changements à risque (droits élevés, exposition réseau, suppression de données) avant de les détailler. Risques déjà identifiés :
  - **Port réseau** : le serveur ouvre un port sur le réseau interne (RadioDJ, Pi, postes). Il ne doit pas être exposé sur Internet.
  - **Session automatique du Pi** : le kiosk ouvre une session sans intervention ; le Pi doit rester physiquement dans le studio, sur un réseau maîtrisé.
- Robustesse antenne : en cas de coupure, le prompteur garde l'affichage et se reconnecte seul (jamais d'écran blanc).
- Aucun identifiant de modèle d'IA dans les commits, PR ou fichiers du dépôt.

## 10. Produit générique : paramétrage et connecteurs

L'exemple de départ (Vichy, RadioDJ, Pi 3) est **une configuration parmi d'autres**. Rien de spécifique à une station dans le cœur du code.

### Paramétrage (page d'administration)
- Identité : nom de la station, logo, couleurs.
- Ville météo (nom + coordonnées), fuseau horaire, langue (**FR + EN dès le départ**, i18n), format d'heure.
- Seuils d'alerte fin de titre, types d'éléments de conducteur et leurs couleurs.
- Horaires fixes (flash infos, top horaire…).
- Blocs affichés ou masqués sur l'écran studio (météo, titre à venir, On Air…).

### Connecteurs interchangeables
Le cœur ne connaît qu'une **interface commune** (ex. « titre en cours », « titre à venir », « intro/outro », « état On Air », « météo actuelle »). Un connecteur par source :
- **Automation** : RadioDJ (premier), puis connecteur **générique** (HTTP entrant / fichier XML-JSON surveillé), puis éventuellement mAirList, Rivendell, etc.
- **Météo** : Open-Meteo, Météo-France, aucun.
- **On Air** : route HTTP, GPIO du Pi, bouton manuel.

### Installation accessible à une petite radio
- Image Docker + fichier d'exemple de configuration (`.env.example`, sans aucun secret réel).
- **Assistant de premier lancement** : création du compte admin, nom de la station, choix des connecteurs.
- Documentation d'installation du Raspberry Pi (kiosk).

## 11. Nom, dépôt et licence

- Nom retenu : **OnAir-Desk** (dépôt `dockev03/OnAir-Desk`). Nom technique (packages, image Docker) : `onair-desk`.
- ⚠️ Disponibilité de la marque **non vérifiée** (INPI, EUIPO) : à contrôler avant une diffusion publique.
- Le dépôt reste **privé** tant que la licence n'est pas décidée.

### Licence (décision à prendre par l'organisation)
- **MIT** : très permissive, réutilisable même dans un produit commercial fermé.
- **AGPL** : toute version modifiée proposée en service doit publier ses modifications ; protège mieux contre une reprise fermée.
