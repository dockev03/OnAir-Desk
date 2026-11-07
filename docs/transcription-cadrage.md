# Transcription de la conversation de cadrage

> Conversation d'origine (octobre 2026), avant la création du dépôt. Texte des échanges uniquement : les métadonnées de session et les chemins locaux ont été retirés. Archive de référence : en cas de divergence, `docs/cahier-des-charges.md` fait foi.

---

### 👤 Utilisateur
Avant que tu fasses quoi que ce soit, est-ce que tu penses que c'est possible grâce à toi de développer de A à Z un outil (que je pourrai héberger) qui sera accessible depuis un navigateur web.
Outil léger car ouvert en mode kiosk sur un RASP 3

Cet outil est destiné aux animateurs d'une radio.
Il devra faire office de prompteur.
Il devra aussi disposer des informations sur le titre en cours à l'antenne, l'heure à la seconde près.
Il faudrait qu'un animateur puisse se connecter à cet outil pour y inserer ses textes / scripts ...

Quel langage choisirais-tu ?

---

### 🤖 Assistant
Oui, c'est faisable de A à Z. Le projet est d'une taille raisonnable : une petite application web temps réel, avec une partie d'administration et un affichage en mode kiosk. La seule vraie inconnue n'est pas technique : c'est la source du titre en cours à l'antenne (voir plus bas).

## Le langage que je choisirais

**TypeScript partout : Node.js côté serveur, Svelte côté navigateur.**

| Brique | Choix | Pourquoi |
|---|---|---|
| Serveur | Node.js + Fastify | Léger, très bon support des WebSockets, un seul langage avec le front. |
| Temps réel | WebSocket | Pousse instantanément le titre en cours, les changements de script et les commandes de défilement vers le Pi. |
| Front | Svelte (ou SvelteKit) | Le code est compilé en JavaScript natif, sans framework lourd à exécuter. C'est ce qui compte sur un Pi 3 (1 Go de RAM, Chromium un peu juste). React ou Angular seraient trop lourds ici. |
| Base de données | SQLite | Un seul fichier, aucun serveur à administrer, largement suffisant pour des scripts et quelques comptes. |
| Authentification | Sessions avec cookie httpOnly, mots de passe hachés en Argon2 | Simple et solide. On peut ajouter un SSO plus tard si vous en avez un. |
| Déploiement | Docker (une image) | Vous l'hébergez où vous voulez. |

**Alternative valable :** Python avec FastAPI pour le serveur, et toujours Svelte pour le front, si votre équipe est plus à l'aise en Python. Je déconseille PHP ou un CMS, peu adaptés au temps réel.

## Architecture proposée

- **Le serveur** (hébergé chez vous) contient les scripts, les comptes et la récupération du titre en cours.
- **Le Pi 3 n'est qu'un écran.** Il affiche en kiosk une page `/prompteur/studio-1` qui ne fait qu'afficher, sans logique lourde. Le défilement passe par des animations CSS `transform`, accélérées par le GPU, pour rester fluide sur un Pi 3.
- **L'interface animateur**, accessible depuis un PC ou une tablette, permet de se connecter, d'écrire et organiser ses scripts, de les envoyer au prompteur et éventuellement de piloter le défilement à distance.

## Points d'attention

1. **Titre en cours (le point critique).** Tout dépend de votre logiciel d'automation : WinMedia, Zetta, mAirList, RadioDJ, Jazler… La plupart savent exporter le titre en cours sous forme de fichier XML/JSON, de requête HTTP ou de métadonnées Icecast. Il faut savoir lequel vous utilisez et ce qu'il sait exporter.
2. **L'heure à la seconde.** Elle ne viendra pas du réseau : elle sera affichée à partir de l'horloge du Pi. Le Pi n'a pas de pile RTC, donc il doit être synchronisé en NTP (chrony) sur un serveur de temps fiable. La page peut aussi corriger un éventuel décalage par rapport au serveur.
3. **Sécurité.** HTTPS, pas d'exposition publique sur Internet par défaut (réseau interne ou VPN), aucun secret écrit en dur dans le code (variables d'environnement), et une validation stricte des textes saisis pour éviter l'injection HTML sur l'écran prompteur.
4. **Robustesse à l'antenne.** Si la connexion tombe, le prompteur doit garder le script déjà affiché et se reconnecter tout seul, sans jamais afficher un écran blanc en direct.

## Avant de commencer, j'aurais besoin de savoir

- Quel est votre logiciel d'automation / de diffusion ?
- Combien de studios ou d'écrans prompteur y a-t-il ?
- Qui fait défiler le texte : l'animateur lui-même (clavier, pédale, télécommande USB), un réalisateur depuis un autre poste, ou un défilement automatique à vitesse réglable ?
- Où sera hébergé le serveur : sur une machine interne, ou ailleurs ?
- Faut-il du texte enrichi (gras, couleurs, repères comme « JINGLE » ou « PUB ») ou du texte simple suffit-il ?

Avec ces réponses, je peux vous proposer un plan détaillé puis développer l'outil.

---

### 👤 Utilisateur
Le logiciel pour le titre est RadioDJ en local dans le studio
Il y a 1 seul écran
Défilement : Manuel avec une souris/molette ou l'animateur peut aussi demander un défilement auto qu'il devra programmer sur chaque script/texte
Hebergé sur une machine interne
Oui si possible de mettre du texte enrichi.
En parlant de ça, il serait bien que cet outil puisse aussi stocker des conducteurs d'émissions, avec des couleurs, ...

---

### 🤖 Assistant
Avec ces réponses, tout est faisable, et RadioDJ simplifie la partie « titre en cours ». Le choix reste le même : TypeScript, avec Node.js + Fastify côté serveur, Svelte côté navigateur et SQLite pour les données, le tout dans Docker sur votre machine interne.

## Récupérer le titre en cours dans RadioDJ

Le plus propre est d'utiliser le plugin **Now Playing Info** de RadioDJ, avec son export web : à chaque changement de titre, RadioDJ envoie une requête HTTP à notre serveur, avec l'artiste, le titre et la durée. Le serveur la relaie immédiatement au prompteur.

Avec la durée, on peut afficher sur le prompteur un **compte à rebours de fin du titre**, très utile pour lancer sa prise d'antenne.

**Solution de repli :** lire directement la table d'historique dans la base MySQL/MariaDB de RadioDJ, en lecture seule.

**À vérifier :** les variables exactes disponibles (notamment la durée) dépendent de votre version de RadioDJ. On le confirmera sur votre installation avant de coder cette partie.

## Ce que l'outil ferait

**1. Le prompteur, sur le Pi en mode kiosk**
- Une horloge HH:MM:SS en grand.
- Le titre en cours et le temps restant.
- L'élément suivant du conducteur.
- La zone de texte qui défile :
  - **manuellement**, à la molette de la souris branchée sur le Pi ;
  - **automatiquement**, à la vitesse réglée sur chaque script ; un clic démarre ou met en pause, et la molette reste utilisable pour corriger.
- La taille de police est réglable, avec une ligne de lecture repère.

**2. Les scripts**
- Un éditeur de texte enrichi (TipTap, une bibliothèque maintenue et très utilisée) : gras, couleurs, surlignage et repères comme `[JINGLE]` ou `[PUB]`.
- Le contenu est stocké dans un format structuré (JSON), pas en HTML brut. Cela évite toute injection de code sur l'écran prompteur.
- Chaque script a sa propre vitesse de défilement automatique.
- Un bouton « Envoyer au prompteur ».

**3. Les conducteurs d'émission**
- Une émission contient une liste d'éléments qu'on réordonne par glisser-déposer : chronique, interview, titre, pub, jingle, etc.
- Chaque élément a un type, une **couleur**, une durée prévue et éventuellement un script associé.
- L'heure de passage de chaque élément est calculée automatiquement à partir de l'heure de début.
- Sur le prompteur, on avance dans le conducteur et le script de l'élément s'affiche tout seul.
- On peut dupliquer un conducteur pour une émission récurrente.

**4. Les comptes**
- Deux rôles : administrateur, qui gère les comptes, et animateur, qui gère ses scripts et conducteurs.
- Des sessions sécurisées et des mots de passe hachés.

## Plan de réalisation

1. **Socle :** projet, Docker, base de données, authentification et comptes.
2. **Scripts :** l'éditeur de texte enrichi et la bibliothèque de scripts.
3. **Prompteur :** l'écran kiosk, l'horloge, le temps réel, le défilement manuel et automatique.
4. **RadioDJ :** la réception du titre en cours et le compte à rebours.
5. **Conducteurs :** l'édition, les couleurs, les heures de passage et le lien avec le prompteur.
6. **Raspberry Pi :** le guide d'installation (Chromium en kiosk, démarrage automatique, synchronisation NTP).

Le travail se fera sur une branche dédiée, sans commit ni push sans votre validation.

**Points à risque, à valider de votre côté :**
- **Port réseau :** le serveur ouvre un port sur le réseau interne pour recevoir RadioDJ et servir le Pi. Ce port ne doit pas être exposé sur Internet.
- **Session automatique sur le Pi :** le mode kiosk implique une ouverture de session automatique. Le Pi doit donc être physiquement dans le studio et sur un réseau maîtrisé.

## Dernières questions avant de démarrer

1. **La machine interne :** Linux ou Windows, et Docker est-il disponible ?
2. **L'emplacement du projet :** le dossier actuel concerne Axapta. Je propose un nouveau dossier dédié, par exemple `Documents\Dev\prompteur-radio`, initialisé en dépôt git. Ça vous va ?
3. **Le compteur fin de titre :** RadioDJ et le serveur seront-ils sur le même réseau, pour que RadioDJ puisse appeler le serveur ?

Dès que j'ai ces réponses, je commence par l'étape 1 et je vous montre le résultat avant de passer à la suite.

---

### 👤 Utilisateur
Pour l'instant de fait rien du tout, c'est purement informatif.
Je voudrai aussi que l'animateur puisse selectionner son texte, conducteur sur l'écran du studio.
Donc faire comme un navigateur avec un dossier / utilisateur
Le PC en kiosk a un accès générique donc peut avoir accès aux textes de tous les animateurs, c'est pas grave

---

### 🤖 Assistant
Bien noté, je ne touche à rien. Voici comment ce besoin s'intègre dans ce qu'on a décrit.

## Naviguer depuis l'écran du studio

Le prompteur aurait deux modes : **navigation** et **lecture**.

**En mode navigation**, l'écran fonctionne comme un explorateur de fichiers simplifié :

```
Accueil
├── 📁 Animateur A
│   ├── 📋 Conducteurs   (triés par date, ceux du jour en premier)
│   └── 📄 Scripts       (éventuellement en sous-dossiers)
├── 📁 Animateur B
└── ...
```

- **Avec seulement une souris :** de grosses tuiles lisibles de loin, la molette pour parcourir les listes, un clic pour ouvrir, et un bouton « Retour » toujours au même endroit. Aucune saisie au clavier n'est nécessaire.
- **Pour aller plus vite :** une section « Aujourd'hui » en haut de l'accueil, avec les conducteurs prévus ce jour-là, et éventuellement les derniers éléments ouverts.
- **Ouvrir un conducteur** affiche sa liste colorée. Un clic sur un élément ouvre son script en mode lecture, et des boutons « Précédent » et « Suivant » permettent d'avancer dans l'émission.

**En mode lecture**, la molette sert uniquement au défilement du texte.

**Éviter les fausses manipulations en direct.** Comme la molette sert aux deux modes, il faut éviter qu'un mauvais clic fasse quitter le texte pendant l'antenne. Pour revenir au menu, on utiliserait un bouton discret dans un coin, avec un appui long ou une confirmation.

## Le compte générique du kiosk

C'est cohérent avec l'usage. Je le concevrais ainsi :

- **Pas d'écran de connexion sur le Pi :** le kiosk est identifié par un jeton d'appareil placé dans sa configuration.
- **Lecture seule :** ce jeton permet de lire tous les dossiers, mais pas de modifier ni de supprimer quoi que ce soit. Même si quelqu'un s'assoit devant le Pi, il ne peut rien abîmer.
- **Révocable :** l'administrateur peut le révoquer ou le régénérer depuis l'interface, par exemple en cas de remplacement du Pi.
- **Accès limité au réseau interne**, comme le reste de l'outil.

Les animateurs, eux, conservent leur compte personnel sur PC ou tablette pour écrire et organiser leurs textes. Les deux façons de faire coexistent : un animateur peut choisir son texte directement sur l'écran du studio, ou l'envoyer depuis son poste. Dans les deux cas, la dernière action l'emporte.

## Ce qui change dans le plan

Peu de choses :
- **Étape 3 (prompteur) :** elle intègre maintenant le mode navigation.
- **Étape 1 (socle) :** elle gère deux types d'accès, les comptes utilisateurs et le jeton d'appareil en lecture seule.
- **Le reste est inchangé.**

Quand vous voudrez passer à la réalisation, il me faudra encore les réponses aux trois questions précédentes : le système de la machine interne et la présence de Docker, l'emplacement du projet, et la communication réseau entre RadioDJ et le serveur.

---

### 👤 Utilisateur
Tu peux me générer une esquisse de ce que visuellement cela donnerai pour toi ?

---

### 🤖 Assistant
Voici une esquisse cliquable de l'écran du studio, en trois vues. On passe de l'une à l'autre avec les onglets du haut, ou en cliquant dans l'écran lui-même : le dossier d'un animateur, puis un élément du conducteur. L'horloge et le compte à rebours de fin de titre tournent, ce n'est pas une image figée.

**Ce qui est commun aux trois vues**
- Le bandeau du haut ne bouge jamais : l'heure à la seconde, le titre envoyé par RadioDJ et le temps restant du morceau en orange.
- L'écran est sombre, pour ne pas éblouir en studio et rester lisible de loin.

**1. Accueil**
- Le conducteur du jour est mis en avant tout en haut, accessible en un seul clic.
- En dessous, un dossier par animateur, plus un dossier « Commun » pour les textes partagés (météo, agenda…).

**2. Conducteur**
- Une couleur par type d'élément, et les heures de passage calculées automatiquement.
- L'icône de document indique qu'un script est attaché à l'élément ; un clic ouvre la lecture.

**3. Lecture**
- Le texte enrichi s'affiche en grand, avec des repères colorés comme `[JINGLE]` ou `[PAUSE]`.
- Une bande orange marque la ligne de lecture.
- On fait défiler à la molette en survolant le texte, ou on lance le défilement automatique avec le bouton « Auto ».
- En bas, « Précédent » et « Suivant » font avancer dans l'émission.

Cette maquette ne concerne que l'écran du studio. L'interface où les animateurs écrivent leurs textes et montent leurs conducteurs serait plus classique, en thème clair, avec l'éditeur de texte enrichi. Je peux en faire une esquisse aussi si vous voulez.

---

### 👤 Utilisateur
Je voudrai aussi afficher le titre à venir, sa durée, ...
Je voudrai 2 blocs "Titre en cours, titre à venir"
Est-il possible d'afficher la météo reliée à une API gratuite et ouverte pour Vichy
Je préférerai que les dossiers soient dans une barre latérale côté gauche

---

### 🤖 Assistant
Voici la version 2 de la maquette, avec vos quatre demandes :

- **Deux blocs « Titre en cours » et « Titre à venir ».** Le titre en cours affiche le temps restant et une barre de progression. Le titre à venir affiche sa durée et son heure de démarrage, calculée à partir du temps restant du titre en cours.
- **La météo de Vichy** est placée sous l'horloge.
- **Une barre latérale à gauche** contient les dossiers des animateurs. Quand on ouvre un script, elle se réduit automatiquement à une colonne d'icônes pour laisser toute la largeur au texte. Le bouton « Réduire » le fait aussi à la main.

Dans la maquette, la météo est une valeur fixe et non un vrai appel : l'aperçu n'a pas le droit de contacter un service extérieur.

## Le titre à venir dans RadioDJ

C'est faisable, mais je ne peux pas encore garantir comment.

- **Le plus probable :** lire la file d'attente que RadioDJ garde dans sa base MySQL/MariaDB (une table du type `queuelist`), en lecture seule, avec un compte dédié qui n'a aucun droit d'écriture.
- **À vérifier :** il est possible que le plugin Now Playing Info de votre version sache déjà envoyer le titre suivant. Je n'en suis pas certain.
- **Le point à confirmer sur votre installation :** que la file de la playlist est bien enregistrée en base et pas seulement affichée dans le lecteur. Si elle ne l'est pas, il faudra trouver une autre source pour le titre à venir.

## La météo pour Vichy

- **Ma recommandation : Open-Meteo.**
  - Il est gratuit, sans clé API, et la documentation est claire.
  - Il fournit température, vent, précipitations et un code météo (pour l'icône).
  - Vichy se trouve à environ 46,13° N et 3,43° E.
- **Attention à la licence.** La gratuité d'Open-Meteo vaut pour un usage non commercial. Une radio qui diffuse de la publicité peut être considérée comme un usage commercial, auquel cas il faut un abonnement payant. Je ne peux pas trancher à votre place : vérifiez leurs conditions selon le statut de la radio (associative ou commerciale).
- **L'alternative : Météo-France**, via son portail d'API publiques. C'est une source officielle et gratuite, mais il faut créer un compte et utiliser une clé. Cette clé serait stockée dans une variable d'environnement sur le serveur, jamais dans le code.
- **Dans les deux cas, c'est le serveur qui interroge la météo**, toutes les 15 à 30 minutes, et la diffuse au prompteur.
  - Le Pi n'a besoin d'aucun accès à Internet.
  - Si le service météo ne répond plus, l'écran garde la dernière valeur connue avec l'heure de mise à jour, plutôt qu'une erreur.

**À trancher plus tard :** l'écran du Pi est probablement en 1080p, donc bien plus large que cette maquette. On aura de la place pour ajouter, si vous le souhaitez, les prévisions de l'après-midi ou du lendemain, qui sont utiles pour les chroniques météo.

---

### 👤 Utilisateur
C'est super bien ça.
Déjà le visuel me plait bien.
Il faudrait que quand il reste peut de temps sur le titre en cours, que la couleur change, que ça clignote, afin que l'animateur sachant que c'est bientôt à lui.
Je voudrai aussi rajouter à un endroit un "On Air" (GRIS ou ROUGE), mais je ne sais pas encore comment l'activer, mais faut y penser. (peut-être une route où je ferai un POST vers OnAir = On ou OnAir=Off)

Tu penses que d'autre(s) chose(s) peuvent être utile pour un animateur / journaliste ?
Les radios utilisent bien un système de ce genre ?

---

### 🤖 Assistant
Voici la version 3. Les deux boutons au-dessus de l'écran servent à tester : le premier ramène le titre en cours à 35 secondes de la fin, le second allume ou éteint le « On Air ».

## L'alerte de fin de titre

Le bloc du titre en cours change en deux temps :
- **À 30 secondes de la fin :** il passe en orange, avec la mention « Bientôt à vous ».
- **À 10 secondes de la fin :** il pulse en rouge, avec un compte à rebours « À vous dans 9 s ».

Les deux seuils seront réglables. Le clignotement est volontairement lent, une pulsation par seconde : un clignotement rapide fatigue la vue et peut poser problème aux personnes photosensibles. Si le poste demande de réduire les animations, l'écran affiche simplement un rouge fixe.

J'ai aussi ajouté dans la maquette les durées d'**intro** et d'**outro** des titres (j'y reviens plus bas).

## Le voyant « On Air »

Il est placé au-dessus de l'horloge : gris quand le micro est fermé, rouge quand il est ouvert. Votre idée d'une route est la bonne base, par exemple :

```
POST /api/onair   {"state": "on"}   ou   {"state": "off"}
```

**Points de sécurité :**
- La route doit être protégée par un jeton dédié, stocké en variable d'environnement, et n'être accessible que depuis le réseau interne. Sinon, n'importe qui sur le réseau pourrait allumer ou éteindre le voyant.
- La valeur reçue doit être vérifiée strictement : seules `on` et `off` sont acceptées.

**Comment le déclencher :**
- **Depuis la console de mixage (la solution la plus fiable).** Beaucoup de consoles ont une sortie GPO, un simple contact qui se ferme à l'ouverture d'un fader micro. C'est souvent ce qui allume déjà la lampe « On Air » du studio. Ce contact peut être relié :
  - aux broches GPIO du Raspberry Pi, qui ferait lui-même l'appel `POST` ;
  - ou à un petit boîtier USB d'entrées/sorties.
- **Attention :** le Pi accepte au maximum 3,3 V sur ses broches. Il faut passer par un optocoupleur ou un relais et ne jamais brancher la console en direct. C'est une intervention électrique à confier à votre technicien.
- **Via RadioDJ ou un autre logiciel** qui appelle la route.
- **Avec un bouton manuel** dans l'interface, en solution de secours.

## Autres fonctions utiles pour un animateur ou un journaliste

Par ordre d'utilité, selon moi :

1. **Intro et outro des titres (le « talk-over »).** L'écran affiche le temps restant avant que le chanteur commence, pour que l'animateur puisse parler sur l'intro sans déborder. RadioDJ enregistre ces repères (points de cue) ; il faudra vérifier qu'on peut les lire.
2. **Compte à rebours vers un horaire fixe.** Par exemple « Flash infos dans 4:12 » ou « Top horaire dans 1:05 ». C'est indispensable pour tomber pile sur les rendez-vous.
3. **Avance ou retard sur le conducteur.** Par exemple « +1:20 » en rouge si l'émission prend du retard par rapport aux heures prévues.
4. **Messages de la régie.** Un réalisateur envoie un court message qui s'affiche en grand : « Auditeur en ligne 2 », « Invité arrivé », « Raccourcis ».
5. **Chronomètre micro ouvert.** Il démarre avec le « On Air » et mesure la durée de l'intervention en cours.
6. **Fiches pratiques attachées au conducteur.** La prononciation des noms difficiles, la fiche de l'invité, le numéro de téléphone d'un correspondant.
7. **Contenus locaux.** Saint du jour, éphéméride, agenda local, trafic routier ou titres d'un flux RSS de la presse locale. À vérifier pour chaque source : sa licence et sa fiabilité.

## Les radios utilisent-elles ce genre d'outil ?

Oui, c'est courant, mais souvent en morceaux séparés :
- **Les horloges de studio et écrans « On Air » :** ce sont des produits dédiés, commerciaux ou open source. Il existe par exemple un projet open source appelé OnAirScreen. Je vous conseille de regarder ces projets pour vous en inspirer, sans que cela engage le choix technique.
- **Les conducteurs et prompteurs :** dans les grandes rédactions, ils sont gérés par des logiciels de rédaction professionnels, plutôt orientés télévision et coûteux.
- **Les logiciels d'automation** (comme RadioDJ) proposent parfois un affichage du titre en cours ou à venir.

Votre idée de **tout réunir sur un seul écran simple** (horloge, titres, On Air, conducteur et prompteur) reste rare dans les petites et moyennes radios, qui jonglent souvent avec un écran par fonction, voire des conducteurs imprimés. L'outil a donc un vrai intérêt.

---

### 👤 Utilisateur
Je veux exporter tout ce qu'on s'est dit pour l'exporter vers un autre compte Claude.
Sans perdre tout ce qu'on s'est dit et ce que tu viens de faire

---

### 🤖 Assistant
Tout est exporté en trois fichiers, et rien n'a été envoyé où que ce soit : tout reste sur votre ordinateur.

**1. [CAHIER-DES-CHARGES.md](prompteur-radio-export/CAHIER-DES-CHARGES.md)** : c'est le fichier le plus important. Il résume toute la conversation :
- vos contraintes et les questions encore ouvertes ;
- les choix techniques ;
- l'écran studio validé, avec les blocs titre en cours / à venir, l'alerte de fin de titre, le On Air et la barre latérale ;
- les intégrations RadioDJ, météo et On Air, avec leurs points à vérifier ;
- les idées complémentaires et le plan de réalisation.

Il précise aussi en tête que rien ne doit être développé sans votre validation.

**2. [maquette-ecran-studio-v3.html](prompteur-radio-export/maquette-ecran-studio-v3.html)** : la dernière maquette, en page autonome. Elle s'ouvre dans n'importe quel navigateur, avec les boutons de test. Je l'ai ouverte pour vérifier : elle s'affiche correctement et l'horloge tourne. Il faut une connexion Internet pour voir les icônes.

**3. `(chemin local retiré)`** (598 Ko) : la conversation complète, mot pour mot, à garder en archive.

Les deux premiers fichiers sont dans le dossier `prompteur-radio-export`, que j'ai créé dans le dossier de travail actuel (le dossier Axapta). Vous pouvez le déplacer où vous voulez.

**Pour reprendre avec l'autre compte Claude :**
- **Dans Claude Code :** créez le dossier du futur projet, copiez-y le cahier des charges sous le nom `CLAUDE.md`, puis ajoutez la maquette. Claude le lira automatiquement au démarrage.
- **Sur claude.ai :** créez un projet et ajoutez ces deux fichiers à ses connaissances, ou joignez-les simplement au premier message.
- **Le zip** sert surtout d'archive : le cahier des charges suffit pour repartir.

Un dernier point : si l'autre compte n'appartient pas à votre organisation, par exemple un compte personnel, vérifiez que vos règles internes l'autorisent. Les fichiers ne contiennent ni secret ni donnée personnelle.

---

### 👤 Utilisateur
Comment appelerais-tu ce projet sur GitHub ?
Je veux en plus que cet outil soit viable pour n'importe quelle radio. Tout ce sera via du paramétrage, hormis quelques scripts qui touchent RadioDJ, ...

---

### 🤖 Assistant
## Le nom

Il faut un nom qui parle à n'importe quelle radio, donc plutôt en anglais, court et tiré du jargon radio. Mes propositions :

| Nom | Dépôt GitHub | Idée |
|---|---|---|
| **CueDeck** ⭐ | `cuedeck` | « Cue » est le repère de lancement d'un titre ou d'une prise d'antenne, « deck » évoque la platine et le tableau de bord. Court et facile à retenir. |
| **Talkover** | `talkover` | C'est le fait de parler sur l'intro d'un titre, l'esprit même de l'outil. |
| **OnAir Desk** | `onair-desk` | Très explicite, mais plus banal. |
| **StudioCue** | `studiocue` | Variante plus descriptive de CueDeck. |

Ma préférence va à **CueDeck**. Je ne peux pas vérifier d'ici que ces noms sont libres. Avant de choisir, vérifiez :
- **GitHub et npm** : qu'aucun projet connu ne porte déjà ce nom ;
- **les marques déposées** (INPI, EUIPO) : surtout si l'outil peut un jour être proposé à d'autres radios.

## Ce que change « viable pour n'importe quelle radio »

Le projet ne change pas de nature. Il faut seulement l'organiser dès le départ en **socle commun + paramétrage + connecteurs**. Ça demande peu d'effort au début, mais c'est très coûteux à rattraper plus tard.

**1. Tout ce qui est propre à une radio devient un réglage**, modifiable dans une page d'administration :
- l'identité : nom de la station, logo, couleurs ;
- la ville de la météo (nom et coordonnées) : Vichy n'est plus écrite en dur ;
- le fuseau horaire, la langue (français et anglais dès le départ) et le format de l'heure ;
- les seuils de l'alerte de fin de titre, ainsi que les types d'éléments de conducteur et leurs couleurs ;
- les horaires fixes (flash infos, top horaire…) ;
- les éléments affichés ou masqués sur l'écran studio : météo, titre à venir, On Air…

**2. Les logiciels extérieurs passent par des connecteurs interchangeables.** Le cœur de l'outil ne parle qu'à une interface commune, du type « donne-moi le titre en cours, le titre à venir, l'intro et l'outro ». On écrit ensuite un connecteur par source :
- **Logiciels d'automation :** RadioDJ en premier. Viendront ensuite un connecteur générique (le logiciel envoie une requête HTTP ou dépose un fichier à lire), puis éventuellement d'autres logiciels comme mAirList ou Rivendell.
- **Météo :** Open-Meteo, Météo-France, ou aucune.
- **On Air :** la route HTTP, les broches GPIO du Pi, ou un bouton manuel.

Les « quelques scripts qui touchent RadioDJ » deviennent ainsi le premier connecteur parmi d'autres, sans rien de spécifique dans le reste du code.

**3. Une installation à la portée d'une petite radio :**
- une image Docker et un fichier d'exemple de configuration ;
- un assistant de premier lancement (création du compte admin, nom de la station, choix du connecteur) ;
- une documentation d'installation du Raspberry Pi.

**4. La licence, à décider si vous publiez le code.** C'est un choix de votre organisation : vérifiez avec votre hiérarchie avant de rendre le dépôt public.
- **MIT :** très permissive, n'importe qui peut réutiliser le code, y compris dans un produit commercial fermé.
- **AGPL :** quiconque modifie l'outil et le propose en service doit publier ses modifications. Elle protège mieux contre une reprise commerciale fermée.

Par défaut, je garderais le dépôt **privé** jusqu'à cette décision.

Voulez-vous que j'ajoute le nom et ce principe de paramétrage et de connecteurs au cahier des charges exporté ?

---

### 👤 Utilisateur
Regarde ce dépôt https://github.com/dockev03/OnAir-Desk c'est bon ?

---

### 🤖 Assistant
Je n'ai pas pu regarder le dépôt : la politique de votre organisation bloque github.com dans le navigateur intégré. Je ne contourne pas ce blocage sans votre accord, et je préfère ne rien dire du dépôt sans l'avoir vu.

**Deux façons de faire :**
- **La commande `gh` ou un `git clone` en lecture seule**, si votre organisation autorise GitHub en ligne de commande. Je ne ferais que lire : aucune exécution de code, aucune modification.
- **Vous collez ici** le README et la liste des fichiers du dépôt.

**Ce que je regarderai :**
- **Ce qu'il fait réellement** par rapport à notre cahier des charges : prompteur, conducteurs, titre en cours et à venir, On Air, mode kiosk sur Pi.
- **Sa santé :** date du dernier commit, licence, nombre de contributeurs, issues ouvertes, technologies utilisées.
- **Le nom :** si ce dépôt est actif et fait la même chose que vous, le nom « OnAir Desk » est pris dans les faits. Ce serait une raison de plus de choisir CueDeck ou un autre nom.
- **La décision :** le reprendre ou s'en inspirer plutôt que tout développer.

---

### 👤 Utilisateur
Utilise la commande gh (ou git clone en lecture seule) pour lire le dépôt.

---

### 🤖 Assistant
Je n'ai pas pu lire le dépôt.

**Ce que j'ai tenté :**
- **`gh`** n'est pas installé sur ce poste.
- **`git clone` sans authentification** : GitHub a répondu « Repository not found ».
- **L'API publique de GitHub** : le compte `dockev03` existe, mais ses seuls dépôts publics sont `maciOs` et `NotificationHub`.

Le dépôt `OnAir-Desk` est donc très probablement **privé**, ou alors son nom est légèrement différent. Comme le clonage a échoué, aucune copie n'a été créée sur ce poste.

**Si c'est votre dépôt et que vous venez de le créer en privé, c'est le bon réglage.** Il vaut mieux qu'il reste privé tant que la licence et la publication ne sont pas décidées. Ne le rendez pas public juste pour que je puisse le lire.

**Pour que je puisse le lire :**
- **Le cloner vous-même** dans un dossier local, puis me donner son chemin. Je le lirai sans rien modifier.
- **Ou installer `gh` puis vous authentifier vous-même** avec `gh auth login`. L'authentification se fait dans le navigateur : ne collez jamais de jeton ici.

```bash
winget install --id GitHub.cli
```

Si le dépôt est vide parce que vous venez de le créer, dites-le-moi : on n'a pas besoin de le lire. On peut alors parler de ce qu'il faut y mettre en premier (README, licence, `.gitignore`, structure du projet), toujours sur une branche dédiée.

---

### 👤 Utilisateur
J'ai fait winget install --id GitHub.cli

---

### 🤖 Assistant
`gh` est bien installé (version 2.102.1), mais aucun compte GitHub n'y est connecté pour l'instant. La connexion est à faire de votre côté, dans un terminal :

```bash
gh auth login
```

Choisissez **GitHub.com**, puis **HTTPS**, puis **Login with a web browser** : vous validez dans votre navigateur avec un code à usage unique. Comme ça, aucun jeton ne transite par la conversation, et je n'ai pas à manipuler vos identifiants.

Une fois connecté, je lirai le dépôt en lecture seule, sans aucune modification, et je le comparerai à notre cahier des charges.

---

### 👤 Utilisateur
Faisons sans GITHub.
Refait moi tout l'export pour que je puisse l'importe dans un autre compte

