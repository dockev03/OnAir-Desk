# OnAir-Desk — Cahier des charges et décisions

> Écran studio pour radios : prompteur, conducteurs, horloge, titre en cours / à venir, météo, voyant On Air.
> Ce fichier fait foi. Il est lu automatiquement par Claude Code à chaque session.

Documents liés :
- `docs/maquette-ecran-studio-v3.html` : maquette cliquable de l'écran studio, **validée visuellement**.
- `docs/plan-etape-1.md` : plan détaillé et **bilan** de l'étape 1 (socle), réalisée.
- `docs/plan-etape-2.md` : plan détaillé et **bilan** de l'étape 2 (scripts), réalisée.
- `docs/plan-etape-3.md` : plan et **bilan** de l'étape 3 (écran studio), réalisée.
- `docs/plan-etape-4.md` : plan et **bilan** de l'étape 4 (conducteurs), réalisée.
- `docs/plan-etape-5.md` : plan et **bilan** de l'étape 5 (compléments conducteurs), réalisée.
- `docs/plan-etape-6.md` : plan et **bilan** de l'étape 6 (socle antenne), réalisée.
- `docs/cadrage-radiodj.md` : constats techniques sur RadioDJ (plugin, base), préalables à l'étape 7.
- `docs/plan-etape-7.md` : plan et **bilan** de l'étape 7 (RadioDJ), réalisée.
- `docs/plan-conducteur-enrichi.md` : plan et **bilan** du conducteur enrichi (évolution hors étape, avant l'étape 8), réalisée.
- `docs/plan-etape-8.md` : plan et **bilan** de l'étape 8 (AzuraCast et écran de veille), réalisée.
- `docs/plan-etape-9.md` : plan et **bilan** de l'étape 9 (On Air, météo et liners), réalisée.
- `docs/plan-etape-10.md` : plan et **bilan** de l'étape 10 (régie), réalisée.
- `docs/plan-etape-11.md` : plan et **bilan** de l'étape 11 (suivi du temps), réalisée.
- `docs/plan-acces-distant.md` : **proposition non validée** d'accès depuis l'extérieur (option 1 : tunnel vers un VPS ; option 2 : central sur VPS + agent studio), à reprendre dans une future version.
- `docs/a-faire.md` : vérifications sur l'installation réelle, décisions et limites en attente, **non bloquantes** ; à tenir à jour à chaque étape.
- `docs/transcription-cadrage.md` : conversation de cadrage d'origine, pour archive.

**Statut : étapes 1 (socle), 2 (scripts), 3 (écran studio), 4 (conducteurs), 5 (compléments conducteurs), 6 (socle antenne), 7 (RadioDJ), 8 (AzuraCast et écran de veille), 9 (On Air, météo et liners), 10 (régie) et 11 (suivi du temps) réalisées, ainsi que le conducteur enrichi (hors étape) : le plan de réalisation est terminé. Ne rien développer d'une nouvelle étape sans validation explicite.**

**Objectif produit : l'outil doit être utilisable par n'importe quelle radio.** Tout ce qui est propre à une station passe par du paramétrage ; seuls les connecteurs (RadioDJ, etc.) contiennent du code spécifique. Voir §10.

---

## 1. Contexte et objectif

Outil web, hébergé en interne, destiné aux animateurs et journalistes d'une radio. Il réunit sur **un seul écran studio** :
- un **prompteur** (textes / scripts à lire) ;
- les **conducteurs d'émission** (déroulés colorés) ;
- l'**heure à la seconde** ;
- le **titre en cours** et le **titre à venir** (depuis l'automation : pour la station de départ, RadioDJ en direct et AzuraCast le reste du temps, 24 h/24) ;
- la **météo** (Vichy pour la station de départ) ;
- un voyant **On Air**.

## 2. Contraintes (station de départ)

| Sujet | Réponse |
|---|---|
| Logiciel d'automation | **RadioDJ**, installé en local dans le studio, utilisé **pour le direct** ; **AzuraCast** assure l'antenne **24 h/24** le reste du temps |
| Réseau | RadioDJ et le serveur sont sur le **même réseau** (RadioDJ peut appeler le serveur) |
| Serveur d'hébergement | **Debian 13** avec **Docker** |
| Nombre d'écrans prompteur | **1 seul** |
| Matériel d'affichage | **Hors spécifications** : chaque station choisit son afficheur ; seule exigence, un **navigateur en mode kiosk**, souris branchée |
| Défilement | **Manuel** à la molette **ou automatique**, la vitesse étant programmée **sur chaque script** |
| Texte enrichi | **Oui** (gras, couleurs, surlignage, repères) |
| Conducteurs | **Oui**, avec couleurs |
| Accès kiosk | Compte **générique** ; il peut voir les textes de **tous** les animateurs (accepté) |
| Statut de la radio | **Non commerciale** → Open-Meteo utilisable gratuitement (§6) |
| Dépôt | `dockev03/OnAir-Desk`, **privé** tant que la licence n'est pas décidée |

Questions **encore ouvertes** :
1. ~~Déclenchement du On Air~~ : tranché à l'étape 9 : bouton du **Stream Deck** et / ou de la **console** appelant l'API d'OnAir-Desk ; boutons de secours dans l'interface et sur l'écran studio. Câblage matériel (GPO / GPIO) possible plus tard, avec la même API.
2. **Licence** (MIT / AGPL) : voir §11.
3. ~~Bascule RadioDJ / AzuraCast~~ : tranchée à l'étape 8 (indicateur « live » d'AzuraCast, le direct RadioDJ y arrivant en DJ / streamer, et forçage manuel). À confirmer par une capture pendant un direct (`docs/plan-etape-8.md`).

## 3. Choix techniques

**TypeScript de bout en bout.**

| Brique | Choix | Raison |
|---|---|---|
| Serveur | Node.js **24 LTS** + **Fastify** | Léger, bon support WebSocket, même langage que le front |
| Temps réel | **WebSocket** | Titre en cours, scripts, On Air, commandes et heure de référence poussés instantanément |
| Front | **Svelte / SvelteKit** | Compilé en JS natif, très léger : adapté à un afficheur modeste. React/Angular jugés trop lourds |
| Éditeur riche | **TipTap** (ProseMirror) | Maintenu, très utilisé ; contenu stocké en **JSON structuré** (pas de HTML brut → pas d'injection sur le prompteur) |
| Base | **SQLite** | Un fichier, zéro administration |
| Auth | Sessions cookie httpOnly + mots de passe **Argon2** | Simple et solide ; SSO possible plus tard |
| Déploiement | **Docker** (une image) sur Debian 13, via une **stack Portainer qui construit l'image** depuis le dépôt | Hébergement interne, pas de registre |
| HTTPS | Servi **directement par Fastify** (pas de reverse proxy), autorité de certification interne générée au premier démarrage | Le certificat racine est à installer sur l'afficheur et les postes |

Les choix de détail (bibliothèques, structure du dépôt) sont dans `docs/plan-etape-1.md`.

### Conventions de code (établies à l'étape 1)
- Monorepo **npm workspaces** : `apps/server` (Fastify), `apps/web` (SvelteKit statique, Svelte 5 runes), `packages/shared` (schémas zod + types communs, importés en TypeScript source).
- Utiliser **npm 11.21.1** (`npx npm@11.21.1 install`) : le champ `allowScripts` du `package.json` liste les seuls paquets autorisés à exécuter un script d'installation.
- Base : SQL direct avec `better-sqlite3` ; **nouvelle migration = nouvelle entrée** dans `apps/server/src/db/migrations.ts`, ne jamais modifier une migration livrée.
- Toute entrée est validée par un schéma zod de `packages/shared` ; erreurs renvoyées sous forme de code stable (`{ error: 'code' }`), traduit côté interface (`error.<code>`).
- Textes de l'interface : clés dans `apps/web/src/lib/i18n/fr.ts` **et** `en.ts` (le typage impose les deux).
- Contenu des scripts : liste blanche dans `packages/shared/src/content.ts` (validation serveur, nettoyage éditeur). L'affichage passe par `apps/web/src/lib/content/` : **jamais de `{@html}`**.
- La page `/studio` (afficheur) ne doit pas importer l'éditeur TipTap : vérifier son poids après toute modification.
- Avant de pousser : `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` (après le build).
- **README à jour, captures comprises** : toute fonctionnalité ou interface ajoutée ou modifiée met à jour le `README.md` dans la même branche (statut, liste des fonctionnalités, installation si besoin) et ses captures d'écran :
  - relancer `npm run captures` (après le build) et vérifier les images de `docs/captures/` ;
  - écran nouveau ou modifié visiblement : compléter les données de démonstration et les captures dans `scripts/captures.ts`, puis l'image et sa légende dans la section « Aperçu » du README ;
  - captures sur la base de démonstration seulement : jamais de données réelles d'une station, ni de jeton ou d'adresse interne visibles.
- Tests de bout en bout dans `e2e/` (`*.e2e.ts`, Playwright) : le serveur compilé y est lancé sur une base temporaire ; chaque étape ajoute ses scénarios.
- Connecteurs d'automation dans `apps/server/src/connectors/` : implémenter `AutomationConnector` (`types.ts`) et l'ajouter au gestionnaire ; le simulateur sert de modèle. Toute nouvelle action journalisée s'ajoute au catalogue `packages/shared/src/audit.ts`.
- Connecteurs entrants (signal envoyé par l'automation) : route sur l'écoute dédiée `connectors/ingest.ts`, jamais sur le serveur principal. Requêtes SQL RadioDJ testées contre un vrai MariaDB : job CI `mariadb`, ou en local avec `MARIADB_TEST_URL`.

## 4. Architecture

- **Serveur interne** : scripts, conducteurs, comptes, récupération RadioDJ, météo, On Air.
- **Afficheur du studio = simple navigateur** : page kiosk, logique minimale, animations en CSS `transform` (GPU). **Aucune ressource externe** (polices, icônes) : tout est servi par le serveur, l'afficheur n'a pas besoin d'Internet.
- **Interface animateurs** (PC / tablette) : connexion personnelle, rédaction des scripts, montage des conducteurs, bouton **« Envoyer au prompteur »**.
- Les deux voies coexistent : sélection directe sur l'écran studio **ou** envoi depuis un poste ; la dernière action l'emporte.
- **Heure de référence = celle du serveur** : l'écran studio calcule un décalage avec l'heure serveur (via WebSocket) et l'applique à l'horloge et aux comptes à rebours. L'heure locale de l'afficheur n'est jamais supposée fiable.

### Accès
- Rôles : **admin** (gère les comptes) et **animateur** (gère ses scripts/conducteurs).
- **Rôle « Réalisateur »** (réalisé à l'étape 10, `docs/plan-etape-10.md`) : droit à part, case sur le compte (`is_director`), cumulable avec animateur ; **seuls** le réalisateur et l'admin peuvent envoyer des messages régie et des ordres rapides, changer l'état des duplex, modifier un conducteur en direct et tenir la main courante. Pas n'importe qui :
  - le kiosk ne peut rien envoyer, et un animateur sans ce rôle non plus ;
  - le rôle est attribué par l'admin, compte par compte ; une même personne peut cumuler animateur et réalisateur ;
  - contrôle **côté serveur** sur chaque route et chaque message WebSocket (masquer un bouton ne suffit pas) ;
  - chaque envoi est **tracé** (auteur, heure) dans la main courante ;
  - limitation du débit d'envoi, contre les erreurs et les abus ;
  - tranché à l'étape 10 : rattachement **au studio** ; modification en direct limitée **au conducteur à l'antenne** (suivi sur l'écran studio, ou émission en cours d'après ses heures), éléments seulement.
  - seule écriture du kiosk pour la régie : l'accusé « Vu » d'un message (désactivable).
- **Kiosk** : pas d'écran de login ; identifié par un **jeton d'appareil**, **lecture seule** sur tous les dossiers, **révocable / régénérable** par l'admin. **Seule écriture permise** (décidé à l'étape 3) : choisir le script affiché (`POST /api/prompter`), étendu à l'étape 4 au choix d'un élément de conducteur, et à l'étape 11 au lancement / arrêt d'une répétition (appui long, désactivable). Taille du texte réglée sur l'écran : mémorisée sur l'afficheur.
- **Bibliothèque** (décidé à l'étape 2) : un animateur modifie **son dossier et Commun** ; il voit les dossiers des collègues **en lecture seule** (pour dupliquer chez lui) ; l'admin modifie tout. Suppression = **corbeille 30 jours** ; **historique** des 20 dernières versions.

### Décisions d'architecture (validées, mises en place à l'étape 6)
- **État antenne central** côté serveur : un seul objet d'état **versionné** (titre en cours / à venir, On Air, météo, messages, duplex, minuteurs…). À la connexion, l'écran reçoit l'état complet, puis seulement les changements. Chaque nouvelle fonctionnalité s'y branche sans retoucher le WebSocket.
- **Notion de « studio »** dès maintenant, même avec un seul studio : état antenne, prompteur et messages sont rattachés à un studio (un studio par défaut).
- **Simulateur d'automation** : faux connecteur qui joue une playlist fictive (titres, intros, outros), pour développer et tester sans RadioDJ ni AzuraCast ; sert aussi de démonstration et de modèle de connecteur.
- **Calculs de temps dans `packages/shared`** : heure de démarrage, talk-over, avance / retard, backtiming, minuteur… en fonctions pures testées, utilisées par le serveur et par l'écran. Jamais dupliquées.
- **Journal d'audit commun** : la table d'événements existante (`audit_log`, étape 1), étendue (qui, quoi, quand) pour les connexions, envois de la régie, changements de rôles, On Air… La main courante en est une vue filtrée.
- **Tests de bout en bout de l'écran studio** (Playwright) : passages d'alerte, reconnexion après coupure, appui long. Chaque étape ajoute les siens.

## 5. Écran studio (validé visuellement — voir maquette v3)

Thème sombre (lisibilité, pas d'éblouissement).

### Principes d'affichage (validés, à appliquer à chaque étape)
- **Distance de lecture** : l'animateur lit à 1,5–2 m, souvent du coin de l'œil. Tailles minimales fixées pour l'heure, le temps restant et les alertes, vérifiées sur l'écran réel.
- **Un seul code couleur d'alerte** pour tout l'écran : **orange = bientôt**, **rouge = maintenant** (fin de titre, minuteur, backtiming, retard). Les couleurs des types d'éléments de conducteur évitent ces deux teintes.
- **Messages régie dans une zone fixe**, jamais en fenêtre par-dessus le texte du prompteur. Seul un ordre urgent prend plus de place, quelques secondes.
- **Dispositions toutes prêtes** (« Animateur seul », « Émission avec régie », « Interview »…), choisies par émission, plutôt qu'un paramétrage bloc par bloc.
- **Usure de l'écran** : léger décalage périodique des éléments fixes, et écran de veille hors émission.
- **Indicateur de connexion discret** (point vert / orange + heure de dernière synchronisation) ; affiché en grand seulement en cas de coupure prolongée.

### Bandeau supérieur (toujours visible)
1. **Bloc horloge** : voyant **ON AIR** (gris = off, rouge = on) au-dessus, **heure HH:MM:SS**, **météo** dessous.
2. **Bloc « Titre en cours »** : titre, artiste, durée, outro, **temps restant**, **barre de progression**.
   - **Alerte fin de titre** : ≤ 30 s → **orange** + « Bientôt à vous » ; ≤ 10 s → **rouge pulsé** + « À vous dans N s ».
   - Seuils **paramétrables**. Pulsation lente (~1 Hz, pas de flash rapide). Respect de `prefers-reduced-motion` (rouge fixe).
3. **Bloc « Titre à venir »** : titre, artiste, durée, intro, **heure de démarrage calculée**.
   - Tranché à l'étape 7 : heure actuelle + temps restant, la durée d'un titre s'arrêtant au **point de mix** quand il est connu (le fondu est donc pris en compte).

### Barre latérale gauche
- « Aujourd'hui » (conducteurs du jour), puis **un dossier par animateur** (Conducteurs triés par date / Scripts, sous-dossiers possibles), plus un dossier **Commun** (météo, agenda…).
- Se **réduit automatiquement en icônes** en mode lecture ; bouton « Réduire » manuel.

### Zone principale — deux modes
- **Conducteur** : liste des éléments, **une couleur par type** (jingle, chronique, titre, pub, interview…), **heure de passage calculée**, durée, icône si un script est attaché ; clic → lecture.
- **Lecture (prompteur)** : texte riche en grand, **taille de police réglable**, repères colorés (`[JINGLE]`, `[PAUSE]`, `[LANCER TITRE]`), **bande de lecture** orange, défilement **molette** ou **Auto** (vitesse propre au script, ex. mots/min ; un clic démarre/met en pause, la molette reste utilisable pour corriger), boutons **Précédent / Suivant** dans le conducteur.
- Navigation 100 % souris : grandes zones cliquables, aucune saisie clavier. En lecture, la molette ne sert qu'au défilement ; sortie protégée contre les fausses manipulations (appui long ou confirmation).

## 6. Intégrations

Constats vérifiés sur RadioDJ 3.0.0.5 / MariaDB 11.4 : voir `docs/cadrage-radiodj.md`.

### RadioDJ — titre en cours
- Plugin **Metadata Export** (ex « Now Playing Info »), onglet Web, en **POST** : il n'envoie que `Artiste - Titre` (Custom Data, variables et mot de passe ignorés en 3.0.0.5). Il sert donc de **signal** « un titre démarre » ; jeton d'authentification dans le champ **Password** du plugin (envoyé dans le corps, champ `xpwd`, si la Custom Data est vide).
- RadioDJ **refuse le certificat HTTPS** d'OnAir-Desk : le signal arrive sur un **port HTTP dédié aux connecteurs** (`CONNECTOR_HTTP_PORT`, fermé par défaut, route du signal seulement, réseau interne). Voir `docs/plan-etape-7.md`.
- Données lues **en lecture seule** dans la base MySQL/MariaDB de RadioDJ (compte dédié `SELECT` seul) : table `history` (titre en cours, heure de début, type de piste). La base n'est plus un repli : elle est indispensable.

### RadioDJ — titre à venir, intro/outro
- **File d'attente en base** (`queuelist`), vérifiée tenue à jour en temps réel, sans le titre en cours.
- Repères **intro/outro (cue points)** : lisibles dans `songs.cue_times` (`int` = fin d'intro, `xta` = point de mix…) ; l'intro n'est pas toujours renseignée.

### RadioDJ — limite acceptée : position de lecture
- Avancer, reculer ou mettre en pause le titre en cours depuis RadioDJ **n'est pas répercuté** : ni la base (`queuelist.ETA` non recalculée) ni les plugins installés ne donnent la position. Temps restant, alertes, talk-over et heure du titre suivant restent faux jusqu'au titre suivant, qui recale tout. Détail : `docs/cadrage-radiodj.md` §4.

### AzuraCast — titre en cours hors direct (24 h/24)
- AzuraCast fournit une **API « Now Playing »** (HTTP JSON, et notifications en temps réel / webhooks) : titre en cours, titre suivant, durée, temps écoulé.
- Sert à afficher le titre en cours **sur l'écran de veille** et hors des émissions en direct.
- Constats (étape 8) : AzuraCast Rolling sur un VPS distant, station publique, certificat auto-signé ; le direct RadioDJ passe par AzuraCast en DJ / streamer. Connexions **sortantes** seulement (flux SSE + relecture toutes les 30 s), certificat toujours vérifié (`AZURACAST_CA_FILE` ou Let's Encrypt), clé API facultative (`AZURACAST_API_KEY`, compte sans droit d'administration). Voir `docs/plan-etape-8.md`.

### On Air — réalisé à l'étape 9 (`docs/plan-etape-9.md`)
- API sur l'**écoute dédiée aux connecteurs** : `POST /api/onair` avec `{"state":"on"}`, `{"state":"off"}` ou `{"state":"toggle"}`, `GET /api/onair` pour l'état ; appel simple (`GET /api/onair/toggle?token=…`) désactivé par défaut.
- Sécurité : **jeton dédié** généré dans les Paramètres (stocké haché, régénérable ; écart assumé avec la variable d'environnement prévue d'abord), **réseau interne uniquement**, validation stricte.
- **Boutons de secours** : barre de l'interface (confirmation) et écran studio (appui long, désactivable).
- Déclencheur de la station de départ : bouton du **Stream Deck** et / ou de la **console**.
- Déclencheurs possibles plus tard : **GPO de la console** (contact à l'ouverture du fader micro) → entrée **GPIO** ou boîtier USB I/O ; RadioDJ.
- ⚠️ Les GPIO acceptent souvent **3,3 V max** : passer par **optocoupleur ou relais**, jamais en direct. Intervention à confier à un technicien.

### Météo (station de départ : Vichy ≈ 46,13° N, 3,43° E)
- **Open-Meteo** (gratuit, sans clé) : retenu, la radio étant **non commerciale**. Données sous licence **CC BY 4.0** → afficher une **attribution** (« Météo : Open-Meteo.com ») dans l'interface (page « À propos » ou pied de page admin).
- Alternative pour d'autres stations : **Météo-France** (API publique, compte + clé en variable d'environnement).
- C'est le **serveur** qui interroge (toutes les 15–30 min) et diffuse ; l'afficheur n'a pas besoin d'Internet. En cas de panne : dernière valeur + heure de mise à jour.

## 7. Idées complémentaires

### Validées (étapes 5 à 11 du plan)
1. **Talk-over** : compte à rebours de l'intro du titre (parler jusqu'au chant). Repères intro lisibles dans RadioDJ (vérifié) : réalisé à l'étape 7, pour les titres dont l'intro est marquée.
2. **Compte à rebours vers horaire fixe** : « Flash infos dans 4:12 », « Top horaire dans 1:05 ».
3. **Avance / retard** sur le conducteur (ex. « +1:20 » en rouge).
4. **Messages régie → animateur** affichés en grand. Le message doit pouvoir être **envoyé depuis un autre PC** (poste de la régie, connecté avec un compte).
5. **Chronomètre micro ouvert** (lié au On Air).
6. **Backtiming / heure de fin imposée** : pour une émission dont la fin est fixe (journal, relais réseau), afficher le temps restant jusqu'à cette heure et ce qu'il reste à caser ou à couper dans le conducteur.
7. **Cartes de liners** : phrases d'identification à dire régulièrement (nom de la station, fréquence, numéro du standard, slogan, partenaires), affichées en rotation ou à la demande ; contenu paramétrable par la station.
8. **Bilan d'émission** : pour chaque élément du conducteur, heure prévue, heure réelle et écart, pour ajuster les conducteurs suivants. S'appuie sur l'avance / retard ; l'heure réelle vient du passage d'un élément à l'autre sur l'écran studio.
9. **Ordres rapides de la régie** : boutons prédéfinis sur le poste du réalisateur (« Accélère », « Étire », « Conclus », « Invité en ligne », « Pub dans 1 min »…), affichés en grand sur l'écran studio en un clic. Liste paramétrable par la station.
10. **Minuteur de séquence** : compte à rebours de l'élément en cours par rapport à sa durée prévue (ex. « reste 0:45 »), rouge en cas de dépassement. Alimente le bilan d'émission.
11. **Conducteur modifié en direct** : le réalisateur insère, déplace ou supprime un élément pendant l'émission ; l'écran studio se met à jour, recalcule les heures de passage et signale brièvement ce qui a changé.
12. **État des duplex et liaisons extérieures** : le réalisateur indique d'un clic l'état d'un correspondant ou d'un invité au téléphone (« en attente », « prêt », « à l'antenne », « coupé ») ; affiché sur l'écran studio.
13. **Mode répétition** : dérouler un conducteur hors antenne pour le chronométrer avant l'émission, sans toucher au On Air ni au bilan d'émission.
14. **Main courante de l'émission** : le réalisateur note les incidents en direct (coupure, retard d'invité, problème de son) avec l'heure ; elle est jointe au bilan d'émission.
15. **Modèles d'émission récurrente** : enregistrer une émission comme modèle (jours de diffusion, période, exclusions), puis en créer les conducteurs en un clic. La création reste **manuelle**, faite par l'animateur.
16. **Impression / PDF du conducteur** : version papier de secours pour la régie, et archive.
17. **Écran de veille hors émission** : horloge, On Air, prochaine émission, et **titre en cours** quand même (via AzuraCast hors direct, §6).

### Non encore validées
18. **Fiches pratiques** attachées au conducteur (prononciation, fiche invité, contacts).
19. **Contenus locaux** : saint du jour, éphéméride, agenda, trafic, RSS presse locale (licence et fiabilité à vérifier par source).
20. **Pointage « fait »** d'un élément du conducteur, avec l'heure réelle de passage (trace des éléments obligatoires).
21. **Compteur de quotas de chanson francophone** (Arcom) depuis l'historique RadioDJ : obligations selon la catégorie de la radio, à vérifier.
22. **Vigilance Météo-France** du département à côté de la météo (API Météo-France, compte + clé).
23. **Voyants micros invités** (un par micro ouvert) : câblage matériel, comme le On Air.
24. **Plugin RadioDJ maison** (C#, **projet à part**) : envoyer à OnAir-Desk la position de lecture et l'état lecture / pause, sur le port des connecteurs, pour lever la limite du §6. Préalable : vérifier qu'un kit de développement de plugins existe pour RadioDJ 3.0.0.5 et donne accès à la position du lecteur.

### Hors de cet outil (autres outils, plus tard)
- **Alerte blanc d'antenne** (détection de silence) : peut-être dans un outil de **supervision** séparé, sous Docker.
- **Standard / file des auditeurs** : dans un autre outil, plus tard.

Contexte marché : horloges studio / écrans On Air existent (produits dédiés, projets open source type OnAirScreen) ; conducteurs/prompteurs surtout dans des logiciels de rédaction pro coûteux. Tout réunir sur un écran simple reste rare dans les petites/moyennes radios.

## 8. Plan de réalisation

1. ✅ **Socle** : projet, Docker, SQLite, auth (comptes + jeton kiosk lecture seule), paramétrage minimal, assistant de premier lancement. → détail et bilan dans `docs/plan-etape-1.md`.
2. ✅ **Scripts** : éditeur TipTap, bibliothèque, vitesse de défilement par script, « Envoyer au prompteur », corbeille, historique. → détail et bilan dans `docs/plan-etape-2.md`.
3. ✅ **Écran studio** : kiosk, navigation latérale, horloge, temps réel, défilement manuel/auto, Précédent / Suivant, sortie par appui long. → détail et bilan dans `docs/plan-etape-3.md`. (Les alertes de fin de titre arrivent avec RadioDJ, étape 7.)
4. ✅ **Conducteurs** : édition, couleurs, glisser-déposer, heures de passage, lien prompteur, duplication. → détail et bilan dans `docs/plan-etape-4.md`. Passée avant RadioDJ à la demande de l'utilisateur : elle ne dépend que du code existant.
5. ✅ **Compléments conducteurs** (étape courte, 3 fonctionnalités) → détail et bilan dans `docs/plan-etape-5.md` :
   1. modèles d'émission récurrente (création des conducteurs **manuelle**, par l'animateur) ;
   2. impression / PDF du conducteur ;
   3. logo de la station (en plus du nom).
6. ✅ **Socle antenne** (6 fonctionnalités, décisions d'architecture du §4) → détail et bilan dans `docs/plan-etape-6.md` :
   1. état antenne central versionné, rattaché à un studio (studio par défaut) ;
   2. interface commune des connecteurs d'automation ;
   3. simulateur d'automation ;
   4. calculs de temps dans `packages/shared` ;
   5. journal d'audit commun (la table `audit_log` existe depuis l'étape 1 : la compléter et en faire la base de la main courante) ;
   6. tests de bout en bout de l'écran studio (mise en place et premiers scénarios).
7. ✅ **RadioDJ** (6 fonctionnalités) → détail et bilan dans `docs/plan-etape-7.md` :
   1. titre en cours ;
   2. titre à venir et heure de démarrage calculée ;
   3. alerte fin de titre (orange / rouge pulsé, seuils paramétrables) ;
   4. repères intro / outro ;
   5. talk-over, si les tables RadioDJ le permettent (§7) ;
   6. titres musicaux remplis automatiquement dans les conducteurs.
   - ✅ **Conducteur enrichi** (évolution hors étape, avant l'étape 8, AzuraCast n'étant pas encore disponible) : titres numérotés avec artiste, année et intro, étiquettes paramétrables, élément à couper, notes générales, tableau coloré à l'écran et à l'impression. → `docs/plan-conducteur-enrichi.md`. Durée cible, écart et part de chansons francophones restent à l'étape 11.
8. ✅ **AzuraCast et écran de veille** (6 fonctionnalités) → détail et bilan dans `docs/plan-etape-8.md` :
   1. connecteur AzuraCast (titre en cours / à venir) ;
   2. bascule de source : RadioDJ en direct, AzuraCast le reste du temps ;
   3. écran de veille hors émission ;
   4. protection contre l'usure de l'écran ;
   5. dispositions toutes prêtes ;
   6. indicateur de connexion discret.
9. ✅ **On Air, météo et liners** (6 fonctionnalités) → détail et bilan dans `docs/plan-etape-9.md` :
   1. route `POST /api/onair` protégée par jeton ;
   2. bouton manuel et voyant ON AIR ;
   3. chronomètre micro ouvert ;
   4. connecteur météo Open-Meteo interrogé par le serveur, avec repli en cas de panne ;
   5. attribution « Météo : Open-Meteo.com » ;
   6. cartes de liners.
10. ✅ **Régie** (6 fonctionnalités) → détail et bilan dans `docs/plan-etape-10.md` :
    1. rôle « Réalisateur » (§4) ;
    2. messages régie envoyés depuis un autre PC, dans une zone fixe de l'écran ;
    3. ordres rapides ;
    4. état des duplex et liaisons extérieures ;
    5. conducteur modifié en direct ;
    6. main courante de l'émission (vue du journal d'audit).
11. ✅ **Suivi du temps** (6 fonctionnalités) → détail et bilan dans `docs/plan-etape-11.md` :
    1. compte à rebours vers un horaire fixe ;
    2. avance / retard sur le conducteur ;
    3. minuteur de séquence ;
    4. backtiming / heure de fin imposée ;
    5. mode répétition ;
    6. bilan d'émission (reprend la main courante de l'étape 10).

Regroupements choisis pour ne pas repasser sur du code :
- les compléments conducteurs passent d'abord, sur un code encore frais (étape 4) ;
- le socle antenne précède tous les connecteurs : état central, studio, calculs de temps et audit sont posés une fois ;
- le talk-over va avec RadioDJ (mêmes repères intro), le chronomètre micro avec le On Air (même état) ;
- écran de veille, dispositions, usure et indicateur de connexion vont avec AzuraCast : tous touchent à l'affichage hors direct ;
- le rôle Réalisateur ouvre l'étape régie (tout le reste en dépend), et le bilan arrive en dernier.

Pas d'étape ni de guide pour le matériel d'affichage : il est **hors spécifications techniques**, chaque station fait comme elle veut (un navigateur en mode kiosk suffit).

## 9. Règles de travail à respecter

- Travail sur **branche dédiée**, jamais de commit/push direct sur `main`, `master` ou `staging`.
- **Nom de branche parlant**, en minuscules et avec des tirets, qui dit ce que contient la branche :
  - `feature/etape-N-sujet` pour une étape du plan (ex. `feature/etape-4-conducteurs`) ;
  - `feature/sujet` pour une évolution hors étape (ex. `feature/duree-reperes`) ;
  - `fix/sujet` pour une correction (ex. `fix/reconnexion-kiosk`) ;
  - `docs/sujet` pour la documentation seule.
  - Jamais de nom généré sans rapport avec le contenu (ex. `claude/bold-gates-kwk0yg`). Une branche fusionnée n'est pas réutilisée : nouvelle évolution = nouvelle branche.
- **Aucun commit ni push sans validation explicite** de l'utilisateur à chaque étape.
- **Étapes courtes**, pour ne pas épuiser les jetons Claude :
  - **5 ou 6 fonctionnalités** par étape au maximum ; au-delà, découper en plusieurs étapes ;
  - **regrouper** ce qui touche au même code (même table, même connecteur, même écran), pour ne pas repasser plus tard sur du code qui aurait pu être fait avant ;
  - ordonner les étapes selon leurs dépendances : ce dont les autres ont besoin d'abord.
- Pratiques sécurisées : validation des entrées, gestion d'erreurs, **aucun secret en dur** (variables d'environnement / coffre).
- Pas d'exposition sur Internet par défaut (réseau interne / VPN), HTTPS.
- Signaler les changements à risque (droits élevés, exposition réseau, suppression de données) avant de les détailler. Risques déjà identifiés :
  - **Port réseau** : le serveur ouvre un port sur le réseau interne (RadioDJ, afficheur, postes). Il ne doit pas être exposé sur Internet.
  - **Session automatique de l'afficheur** : le kiosk ouvre une session sans intervention ; l'afficheur doit rester physiquement dans le studio, sur un réseau maîtrisé.
  - **Port HTTP des connecteurs** (étape 7) : fermé par défaut ; ouvert, il n'expose que la route du signal RadioDJ (jeton en clair sur le réseau local, la base faisant foi).
  - **Base RadioDJ** : ouverte au réseau par la station, pour la seule adresse du serveur, avec un compte `SELECT` seul.
  - **API On Air** (étape 9) : sur l'écoute des connecteurs (fermée par défaut), jeton haché ; l'appel simple met le jeton dans l'adresse (désactivé par défaut). Le kiosk peut allumer / éteindre le On Air (appui long, tracé, désactivable).
  - **Météo** (étape 9) : connexion **sortante** du serveur vers Open-Meteo.
  - **Suivi du temps** (étape 11) : l'écran studio peut lancer / arrêter une répétition (appui long, tracé, désactivable), jamais pendant une émission ni On Air allumé.
  - **Régie** (étape 10) : nouveaux droits d'écriture (envoi à l'écran studio, modification du conducteur à l'antenne d'un collègue) réservés à l'admin et aux réalisateurs, vérifiés côté serveur et tracés ; accusé « Vu » depuis le kiosk (désactivable).
  - **AzuraCast** (étape 8) : connexion **sortante** du serveur vers le VPS AzuraCast (HTTPS, certificat toujours vérifié) ; clé API éventuelle liée à un compte AzuraCast **sans droit d'administration**.
- Robustesse antenne : en cas de coupure, le prompteur garde l'affichage et se reconnecte seul (jamais d'écran blanc).
- Aucun identifiant de modèle d'IA dans les commits, PR ou fichiers du dépôt.

## 10. Produit générique : paramétrage et connecteurs

L'exemple de départ (Vichy, RadioDJ, AzuraCast) est **une configuration parmi d'autres**. Rien de spécifique à une station dans le cœur du code.

### Paramétrage (page d'administration)
- Identité : nom de la station, logo, couleurs.
- Ville météo (nom + coordonnées), fuseau horaire, langue (**FR + EN dès le départ**, i18n), format d'heure.
- Seuils d'alerte fin de titre, types d'éléments de conducteur et leurs couleurs.
- Horaires fixes (flash infos, top horaire…).
- Blocs affichés ou masqués sur l'écran studio (météo, titre à venir, On Air…), via des **dispositions toutes prêtes**.
- Source d'automation selon le moment (direct / hors direct).

### Connecteurs interchangeables
Le cœur ne connaît qu'une **interface commune** (ex. « titre en cours », « titre à venir », « intro/outro », « état On Air », « météo actuelle »). Un connecteur par source :
- **Automation** : RadioDJ (premier), **AzuraCast**, puis connecteur **générique** (HTTP entrant / fichier XML-JSON surveillé), puis éventuellement mAirList, Rivendell, etc.
- **Météo** : Open-Meteo, Météo-France, aucun.
- **On Air** : route HTTP, GPIO, bouton manuel.

### Installation accessible à une petite radio
- Image Docker + fichier d'exemple de configuration (`.env.example`, sans aucun secret réel).
- **Assistant de premier lancement** : création du compte admin, nom de la station, choix des connecteurs.

## 11. Nom, dépôt et licence

- Nom retenu : **OnAir-Desk** (dépôt `dockev03/OnAir-Desk`). Nom technique (packages, image Docker) : `onair-desk`.
- ⚠️ Disponibilité de la marque **non vérifiée** (INPI, EUIPO) : à contrôler avant une diffusion publique.
- Le dépôt reste **privé** tant que la licence n'est pas décidée.

### Licence (décision à prendre par l'organisation)
- **MIT** : très permissive, réutilisable même dans un produit commercial fermé.
- **AGPL** : toute version modifiée proposée en service doit publier ses modifications ; protège mieux contre une reprise fermée.
