# Conducteur enrichi : plan

> **Statut : réalisée (bilan en fin de document).**
> Évolution hors étape, validée par l'utilisateur pour passer avant l'étape 8 (AzuraCast pas encore disponible). Branche : `feature/conducteur-enrichi`.
> Point de départ : un conducteur d'émission musicale fait à la main en HTML (« Flashback »), à reproduire à l'écran et en PDF.

## Objectif

5 fonctionnalités, toutes sur le code des conducteurs (étapes 4 et 5) :

1. **Titre musical détaillé** : artiste, année et intro (talk-up) sur un élément ; l'artiste et l'intro sont repris de RadioDJ quand on choisit un titre dans sa bibliothèque.
2. **Étiquettes paramétrables** (ex. « FR ») posées sur les éléments, avec une couleur, gérées comme les types d'éléments.
3. **Élément « à couper si ça déborde »** (✂).
4. **Notes générales** d'un conducteur ou d'un modèle (consignes, règles de jeu), imprimées sous le tableau.
5. **Mise en page** : numéro des titres musicaux, position depuis le début (« +12:30 »), tableau à lignes teintées par type à l'impression, légende.

## Décisions

| # | Sujet | Choix | Alternative écartée |
|---|---|---|---|
| 1 | Titre numéroté | Un élément **avec un artiste** est un titre musical, numéroté dans l'ordre. Générique : aucun type n'est codé en dur. | Drapeau « musical » sur les types (paramètres existants à migrer). |
| 2 | Artiste choisi dans RadioDJ | Titre et artiste **séparés** (avant : « Artiste - Titre » dans le titre) ; intro reprise du repère `int` quand il existe. | — |
| 3 | Année depuis RadioDJ | **Saisie manuelle** : la colonne `songs.year` n'a pas été vérifiée sur RadioDJ 3.0.0.5 ; la lire sans vérification casserait la recherche. | Lecture de `songs.year` (à ajouter une fois la colonne vérifiée). |
| 4 | Étiquettes | Liste paramétrable (20 max, 5 par élément), mêmes couleurs que les types ; défaut : « FR ». Une étiquette retirée des paramètres reste acceptée sur un conducteur qui la portait déjà (comme les types). | Liste figée. |
| 5 | Notes générales | Texte simple, 2 000 caractères, sur le conducteur **et** le modèle ; copiées par la duplication, la création depuis un modèle, « Réappliquer le modèle » et « Enregistrer comme modèle ». | Notes sur le conducteur seul. |
| 6 | Écran studio | Numéro, artiste, étiquettes, intro et ✂ dans la liste ; artiste, année, intro et ✂ sur la grande carte. Les notes générales n'y sont pas (lecture à distance). | Tableau complet (illisible à 2 m). |
| 7 | Impression | Colonnes Année, Étiquettes et Intro imprimées **seulement si** un élément les renseigne ; lignes teintées (14 % de la couleur du type) avec filet à gauche, pastille et libellé gardés pour le noir et blanc. | Toutes les colonnes toujours. |
| 8 | Hors périmètre | Durée cible, écart, part de chansons francophones : **étape 11** (avance / retard, backtiming) et idée 21 (quotas, non validée). | Les faire ici, puis repasser dessus à l'étape 11. |

## Réalisation

- **Migration 8** : `rundown_items` et `rundown_template_items` reçoivent `artist`, `year`, `intro_seconds`, `tags` (JSON), `cuttable` ; `rundowns` et `rundown_templates` reçoivent `notes`. Valeurs par défaut : les conducteurs existants ne changent pas.
- **`packages/shared`** : champs facultatifs à la saisie (valeurs par défaut), `itemTagsSchema`, `songNumbers()`, `rundownSchedule()` renvoie aussi les positions (`offsets`).
- **Serveur** : contrôle des étiquettes connues (`unknown_item_tag`), notes recopiées partout où les éléments le sont, recherche RadioDJ avec `introMs`. Les copies de l'écran studio enregistrées avant la migration sont complétées à la lecture (jamais d'écran blanc).
- **Interface** : ligne « Détails » repliable dans l'éditeur (ouverte d'office si l'élément a des détails), bloc « Étiquettes des éléments » dans les Paramètres, composant commun `RundownNotes` (conducteur et modèle), page d'impression refaite.

## Bilan

Réalisé tel que prévu.

- Tests : `packages/shared` (numéros, positions, limites des nouveaux champs), serveur (aller-retour des champs, étiquette inconnue / retirée, duplication, modèle → conducteurs, ancienne copie de l'écran studio), RadioDJ (`introMs`), e2e `e2e/rundowns.e2e.ts` (écran studio : carte et liste ; impression : colonnes, légende, notes).
- Captures : `conducteur.png`, `studio-conducteur.png` mises à jour ; nouvelle `conducteur-impression.png`.
- À faire plus tard : lire l'année dans `songs.year` après vérification de la colonne sur la base RadioDJ de la station (`SHOW COLUMNS FROM songs LIKE 'year'`).
