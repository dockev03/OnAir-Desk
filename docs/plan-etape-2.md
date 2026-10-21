# Étape 2 — Scripts : plan détaillé

> **Statut : réalisée** (voir le bilan en fin de document).
> Référence : `CLAUDE.md` §5 (écran studio), §8 étape 2. Branche : `feature/etape-2-scripts`.

## Objectif de l'étape

À la fin de l'étape 2, un animateur peut :
- **rédiger** ses scripts dans un éditeur de texte enrichi : gras, italique, souligné, couleurs, surlignage, **repères colorés** (`[JINGLE]`, `[PAUSE]`, `[LANCER TITRE]`…) ;
- les **ranger** dans une bibliothèque (ses dossiers et sous-dossiers, plus un dossier **Commun**), les rechercher, dupliquer, déplacer et supprimer (**corbeille** restaurable 30 jours) ;
- consulter l'**historique** d'un script et restaurer une version précédente ;
- régler la **vitesse de lecture** de chaque script (mots/minute) et voir la **durée estimée** ;
- cliquer sur **« Envoyer au prompteur »** : le script s'affiche aussitôt sur l'écran studio.

L'écran studio affiche le script envoyé en grand, avec la molette pour défiler. Les éléments suivants arrivent à l'**étape 3** :
- le vrai mode lecture (bande de lecture, défilement automatique, Précédent / Suivant) ;
- la navigation dans les dossiers depuis le Pi.

Hors périmètre : conducteurs (étape 5), RadioDJ (étape 4).

## Modèle de données (migration 2)

| Table | Colonnes principales |
|---|---|
| `folders` | id, owner_id (**NULL = Commun**), parent_id (NULL = racine), name, created_at, updated_at |
| `scripts` | id, owner_id (**NULL = Commun**), folder_id (NULL = racine), title, content (JSON TipTap), content_text (texte brut, pour la recherche et le comptage des mots), word_count, speed_wpm, version, created_by, updated_by, created_at, updated_at, deleted_at |
| `script_revisions` | id, script_id, version, title, content, saved_by, saved_at (20 dernières par script) |
| `prompter_state` | une seule ligne : script affiché, envoyé par, envoyé à. Conservée après un redémarrage, pour que l'écran retrouve le texte en cours. |

- **Recherche** : index plein texte SQLite **FTS5** sur le titre et le texte, insensible aux accents.
- **Modifications simultanées** : chaque enregistrement porte le numéro de `version`. Si deux personnes modifient le même script, la seconde reçoit un conflit (409) au lieu d'écraser le travail de la première.

## Éditeur (TipTap)

- **TipTap** utilisé directement (`@tiptap/core`), sans surcouche. Il n'est chargé **que sur les pages de rédaction** : le Pi ne le télécharge jamais.
- **Extensions** :
  - gras, italique, souligné ;
  - titres (2 niveaux), listes, saut de ligne ;
  - couleur du texte et surlignage, **limités à une palette** lisible sur fond sombre (pas de couleur libre) ;
  - **repère** : élément propre au projet, insérable depuis la barre d'outils, affiché comme une pastille colorée.
- **Liste des repères paramétrable** par l'admin (libellé + couleur), conformément au §10. Valeurs par défaut : `JINGLE`, `PAUSE`, `LANCER TITRE`, `PUB`, `SON`, `MÉTÉO`.
- **Pas de liens ni d'images** dans les scripts : inutiles à l'antenne, et autant de risques en moins.
- **Enregistrement automatique** quelques secondes après la dernière frappe, avec un indicateur « Enregistré / Enregistrement… / Hors ligne ».
- **Durée estimée** = nombre de mots ÷ vitesse, affichée en direct (ex. « 214 mots · 1:26 à 150 mots/min »). Elle servira aux conducteurs à l'étape 5.

## Sécurité du contenu

- Le contenu est stocké en **JSON structuré**, jamais en HTML.
- **Validation côté serveur** par une liste blanche stricte :
  - seuls les types de blocs, de marques et d'attributs prévus sont acceptés ;
  - les couleurs doivent appartenir à la palette ;
  - le contenu est limité à 200 Ko et à une profondeur maximale.

  Tout le reste est refusé.
- **Affichage sur le prompteur** par un petit moteur de rendu Svelte qui construit les éléments un par un (**aucun `{@html}`**). Il est léger pour le Pi et ne peut pas injecter de code.

## Envoyer au prompteur

- `POST /api/prompter` `{ scriptId }`. Le serveur enregistre l'état et le diffuse par WebSocket aux écrans studio.
- **La dernière action l'emporte**, que l'envoi vienne d'un poste ou, à l'étape 3, de l'écran studio lui-même.
- Si le script affiché est **modifié**, l'écran reçoit la nouvelle version en direct, sans perdre sa position de défilement si possible.
- Si le script affiché est **supprimé**, l'écran **garde le texte** avec une mention discrète. Jamais d'écran blanc à l'antenne.

## Droits (validés)

| Action | Admin | Animateur | Écran kiosk |
|---|---|---|---|
| Lire tous les scripts (tous dossiers) | ✅ | ✅ *(dossiers des collègues en lecture seule, pour dupliquer)* | ✅ |
| Créer / modifier / supprimer **ses** scripts et dossiers | ✅ | ✅ | ❌ |
| Créer / modifier dans **Commun** | ✅ | ✅ | ❌ |
| Modifier les scripts **d'un autre** animateur | ✅ | ❌ (il peut les **dupliquer** chez lui) | ❌ |
| Envoyer au prompteur | ✅ | ✅ (n'importe quel script lisible) | à l'étape 3 |
| Paramétrer la liste des repères | ✅ | ❌ | ❌ |

## Corbeille (validée)

- Supprimer un script le place dans la **corbeille** (`deleted_at`) : il disparaît de la bibliothèque, de la recherche et de l'écran studio, mais reste **restaurable pendant 30 jours**.
- Page **Corbeille** : chacun voit les scripts supprimés de son dossier et de Commun, l'admin voit tout. Actions : **Restaurer** (dans son dossier d'origine, ou à la racine si le dossier n'existe plus) et **Supprimer définitivement**.
- Purge automatique quotidienne des scripts supprimés depuis plus de 30 jours (avec leur historique).
- Un dossier ne peut être supprimé que s'il est vide (ses scripts étant d'abord envoyés à la corbeille) : pas de suppression en cascade par erreur.

## Historique des versions (validé)

- Les **20 dernières versions** de chaque script sont conservées.
- Avec l'enregistrement automatique, garder chaque frappe n'aurait pas de sens. Une version est donc conservée :
  - quand une autre personne commence à modifier le script ;
  - lorsqu'au moins 10 minutes se sont écoulées depuis la dernière version ;
  - avant une restauration ou une mise à la corbeille.
- Page **Historique** dans l'éditeur : liste des versions (date, auteur, nombre de mots), **aperçu** et **Restaurer**. La restauration crée elle-même une nouvelle version, donc rien n'est jamais perdu.

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/library` | Arborescence : propriétaires, dossiers, scripts (sans contenu) |
| GET | `/api/scripts?q=` | Recherche plein texte |
| GET / POST / PATCH / DELETE | `/api/scripts[/:id]` | Lecture, création, enregistrement (avec `version`), suppression |
| POST | `/api/scripts/:id/duplicate` | Copie dans un dossier choisi |
| POST / PATCH / DELETE | `/api/folders[/:id]` | Dossiers : création, renommage, déplacement, suppression (vide uniquement) |
| GET | `/api/trash` | Scripts dans la corbeille |
| POST / DELETE | `/api/trash/:id` | Restaurer / supprimer définitivement |
| GET | `/api/scripts/:id/revisions[/:rev]` | Historique / aperçu d'une version |
| POST | `/api/scripts/:id/revisions/:rev/restore` | Restaurer une version |
| GET / POST | `/api/prompter` | Script affiché / envoyer un script |
| GET / PUT | `/api/settings/cues` | Liste des repères (lecture pour tous, modification admin) |

## Interface

- **Bibliothèque** `/scripts`, avec deux colonnes :
  - à gauche, l'arborescence : Mes scripts, Commun, puis les autres animateurs ;
  - à droite, la liste des scripts, la recherche et les actions (nouveau, dupliquer, déplacer, supprimer).
- **Éditeur** `/scripts/:id` :
  - titre, barre d'outils, vitesse, durée estimée et état de l'enregistrement ;
  - bouton **« Envoyer au prompteur »** ;
  - **aperçu** dans le style sombre du prompteur.
- **Écran studio** : quand un script est envoyé, il s'affiche en grand sous un bandeau avec l'heure. La taille du texte est réglée dans les paramètres de la station, et la molette sert à défiler.
- **Corbeille** `/trash` et **Historique** (panneau de l'éditeur).
- **Paramètres** (admin) : liste des repères (libellé, couleur, ordre), vitesse par défaut (150 mots/min), taille du texte sur l'écran studio.
- FR / EN pour tous les nouveaux textes.

## Tests prévus

- **Droits** : chaque ligne du tableau ci-dessus, kiosk compris.
- **Validation du contenu** : refus des blocs inconnus, des attributs non prévus, des couleurs hors palette, d'un contenu trop gros ou trop profond.
- **Modifications simultanées** : 409 sur une version périmée.
- **Recherche** : accents, plusieurs mots, scripts supprimés exclus.
- **Corbeille** : restauration (dossier d'origine ou racine), suppression définitive, purge après 30 jours, droits.
- **Historique** : règles de conservation, limite de 20, restauration qui crée une version.
- **Prompteur** : diffusion à l'envoi, à la modification et à la suppression ; état retrouvé après redémarrage.
- **Navigateur (Chromium)** : rédaction → enregistrement automatique → envoi → affichage sur le kiosk → modification visible en direct.

## Découpage en commits

1. Migration 2, dépôts SQL et recherche FTS5.
2. Schéma du contenu (liste blanche) et sa validation, dans `packages/shared`.
3. API scripts, dossiers et droits, avec leurs tests.
4. Corbeille et historique, avec leurs tests.
5. Prompteur : état, diffusion WebSocket, tests.
6. Paramètres : repères, vitesse par défaut, taille du texte.
7. Interface : bibliothèque et corbeille.
8. Interface : éditeur TipTap (repères, palette, enregistrement automatique, durée, historique).
9. Écran studio : moteur de rendu du script envoyé et défilement à la molette.
10. Documentation, bilan, tests navigateur.

## Décisions prises

1. **Droits** : un animateur modifie son dossier et Commun ; il voit les dossiers des collègues **en lecture seule**, uniquement pour dupliquer chez lui. Le Pi voit tout, en lecture.
2. **Suppression** : corbeille restaurable 30 jours.
3. **Historique** : 20 dernières versions par script, avec restauration.
4. **Vitesse par défaut** : 150 mots/minute, modifiable dans les paramètres et sur chaque script.

## Bilan de l'étape 2

### Réalisé
- **Bibliothèque** : mon dossier, Commun, puis les collègues en lecture seule ; sous-dossiers (6 niveaux au plus) ; recherche plein texte insensible aux accents, avec extraits ; duplication chez soi ; déplacement ; envoi au prompteur.
- **Éditeur TipTap** :
  - gras, italique, souligné, titres, listes ;
  - palette de 6 couleurs de texte et 5 couleurs de surlignage ;
  - repères paramétrables ;
  - annuler / rétablir.
- **Enregistrement automatique** : indicateur d'état, nouvelle tentative hors ligne, conflit signalé avec le choix « recharger » ou « garder ma version ».
- **Durée de lecture estimée** en direct (mots ÷ vitesse) ; vitesse réglable par script, 150 mots/min par défaut.
- **Corbeille** restaurable 30 jours, avec purge quotidienne. **Historique** des 20 dernières versions, avec aperçu et restauration sans perte.
- **Écran studio** :
  - le script envoyé s'affiche en grand (taille réglable dans les paramètres) et défile à la molette ;
  - ses modifications arrivent en direct ;
  - s'il est supprimé, le texte reste affiché avec la mention « Script supprimé ».
- **Sécurité** :
  - contenu validé par liste blanche côté serveur, nettoyé côté éditeur avant envoi ;
  - affichage construit élément par élément, sans aucun HTML interprété ;
  - l'écran studio reste en lecture seule.

### Vérifications faites
- 87 tests automatisés, dont 25 pour l'étape 2 : droits, contenu, conflits, dossiers, recherche, corbeille, historique, prompteur, WebSocket.
- **Parcours complet dans Chromium**, à trois utilisateurs et un écran kiosk :
  1. rédaction avec gras, couleur et repère, puis enregistrement automatique ;
  2. envoi au prompteur et affichage sur le kiosk ;
  3. modification reçue en direct ;
  4. conflit avec l'admin, résolu par « garder ma version » ;
  5. historique (2 versions) ;
  6. recherche « meteo » qui trouve « météo » ;
  7. lecture seule et duplication par un collègue ;
  8. mise à la corbeille : le kiosk garde le texte avec « Script supprimé », puis restauration ;
  9. repère renommé dans les paramètres et appliqué en direct sur le kiosk.

  Aucune erreur dans la console, en dehors du 409 attendu du scénario de conflit.
- **Poids sur le Pi** : la page studio charge 170 Ko de JavaScript, sans TipTap. L'éditeur (environ 400 Ko) n'est téléchargé que sur les postes de rédaction.

### Corrigé grâce aux tests navigateur
- La barre d'outils prenait le focus : quelques caractères tapés juste après un clic pouvaient être perdus. Les boutons ne prennent plus le focus, et la sélection est conservée.
- Les boutons de la barre d'outils n'avaient pas de nom accessible (lecteurs d'écran). Ils ont maintenant un `aria-label`, et la barre se nomme « Mise en forme ».

### Écarts par rapport au plan

| Plan | Réalisé | Raison |
|---|---|---|
| Route `/api/settings/cues` | Repères inclus dans les paramètres (`PUT /api/settings` accepte maintenant une modification partielle) | Une seule source de paramètres, déjà poussée aux écrans par WebSocket. |
| — | Un compte qui possède des scripts ne peut plus être supprimé : il faut le désactiver | Éviter la perte de ses scripts (les clés étrangères l'empêchent aussi). |
| Taille du texte « réglable » sur l'écran | Réglée dans les paramètres de la station | Le réglage depuis l'écran lui-même (souris) arrive avec le mode lecture de l'étape 3. |

