# Étape 2 — Scripts : plan détaillé

> **Statut : proposition, en attente de validation.** Aucun code n'est écrit avant l'accord explicite.
> Référence : `CLAUDE.md` §5 (écran studio), §8 étape 2. Branche : `feature/etape-2-scripts`.

## Objectif de l'étape

À la fin de l'étape 2, un animateur peut :
- **rédiger** ses scripts dans un éditeur de texte enrichi : gras, italique, souligné, couleurs, surlignage, **repères colorés** (`[JINGLE]`, `[PAUSE]`, `[LANCER TITRE]`…) ;
- les **ranger** dans une bibliothèque (ses dossiers et sous-dossiers, plus un dossier **Commun**), les rechercher, dupliquer, déplacer et supprimer ;
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
| `script_revisions` | id, script_id, version, title, content, saved_by, saved_at *(si l'historique est retenu, voir les questions)* |
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

## Droits (proposition, à valider)

| Action | Admin | Animateur | Écran kiosk |
|---|---|---|---|
| Lire tous les scripts (tous dossiers) | ✅ | ✅ *(lecture seule chez les autres)* | ✅ |
| Créer / modifier / supprimer **ses** scripts et dossiers | ✅ | ✅ | ❌ |
| Créer / modifier dans **Commun** | ✅ | ✅ | ❌ |
| Modifier les scripts **d'un autre** animateur | ✅ | ❌ (il peut les **dupliquer** chez lui) | ❌ |
| Envoyer au prompteur | ✅ | ✅ (n'importe quel script lisible) | à l'étape 3 |
| Paramétrer la liste des repères | ✅ | ❌ | ❌ |

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/library` | Arborescence : propriétaires, dossiers, scripts (sans contenu) |
| GET | `/api/scripts?q=` | Recherche plein texte |
| GET / POST / PATCH / DELETE | `/api/scripts[/:id]` | Lecture, création, enregistrement (avec `version`), suppression |
| POST | `/api/scripts/:id/duplicate` | Copie dans un dossier choisi |
| POST / PATCH / DELETE | `/api/folders[/:id]` | Dossiers : création, renommage, déplacement, suppression (vide uniquement) |
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
- **Paramètres** (admin) : liste des repères (libellé, couleur, ordre), vitesse par défaut, taille du texte sur l'écran studio.
- FR / EN pour tous les nouveaux textes.

## Tests prévus

- **Droits** : chaque ligne du tableau ci-dessus, kiosk compris.
- **Validation du contenu** : refus des blocs inconnus, des attributs non prévus, des couleurs hors palette, d'un contenu trop gros ou trop profond.
- **Modifications simultanées** : 409 sur une version périmée.
- **Recherche** : accents, plusieurs mots, scripts supprimés exclus.
- **Prompteur** : diffusion à l'envoi, à la modification et à la suppression ; état retrouvé après redémarrage.
- **Navigateur (Chromium)** : rédaction → enregistrement automatique → envoi → affichage sur le kiosk → modification visible en direct.

## Découpage en commits

1. Migration 2, dépôts SQL et recherche FTS5.
2. Schéma du contenu (liste blanche) et sa validation, dans `packages/shared`.
3. API scripts, dossiers et droits, avec leurs tests.
4. Prompteur : état, diffusion WebSocket, tests.
5. Paramètres : repères, vitesse par défaut, taille du texte.
6. Interface : bibliothèque.
7. Interface : éditeur TipTap (repères, palette, enregistrement automatique, durée).
8. Écran studio : moteur de rendu du script envoyé et défilement à la molette.
9. Documentation, bilan, tests navigateur.

## Questions avant de démarrer

1. **Droits** : le tableau ci-dessus te convient-il ? En particulier : tous les animateurs peuvent **lire** les scripts des autres et **modifier** le dossier Commun.
2. **Suppression** : définitive (avec confirmation), ou **corbeille** restaurable pendant 30 jours ? Je recommande la corbeille, c'est peu de travail en plus et ça évite les mauvaises surprises.
3. **Historique des versions** : conserver les 20 dernières versions de chaque script, avec restauration ? Recommandé si la corbeille est retenue ; sinon, peut attendre.
4. **Vitesse par défaut** : 150 mots/minute (débit radio courant), modifiable dans les paramètres et sur chaque script. Ça te va ?
