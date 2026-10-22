# Étape 4 — Conducteurs : plan

> **Statut : plan validé, développement à venir.**
> Référence : `CLAUDE.md` §5 (zone principale, mode Conducteur), §8 étape 4, §10 (types et couleurs paramétrables). Branche : `feature/etape-4-conducteurs`.
> Étape passée avant RadioDJ (devenue étape 5) à la demande de l'utilisateur.

## Objectif

Un animateur monte le **déroulé de son émission** sur son poste, puis le suit à l'antenne sur l'écran studio :
- **conducteur** = titre, date de diffusion, heure de début, liste ordonnée d'éléments ;
- **élément** = type (couleur), titre, durée prévue, notes courtes, **script attaché** facultatif ;
- **heure de passage** de chaque élément calculée à partir de l'heure de début et des durées ;
- réordonnancement par **glisser-déposer** ;
- **duplication** (émission récurrente) ;
- sur l'écran studio : section **« Aujourd'hui »**, liste colorée, clic sur un élément → lecture, **Précédent / Suivant** dans l'ordre du conducteur.

## Décisions (validées)

Les 8 propositions ont été retenues ; la colonne « Alternative » garde trace des options écartées.

| # | Sujet | Décision | Alternative écartée |
|---|---|---|---|
| 1 | **Rangement** | Une section **« Conducteurs »** par propriétaire (animateur ou Commun), **triée par date** (les plus proches en premier), **sans sous-dossiers**. Mêmes droits que les scripts : je modifie les miens et ceux de Commun, je lis ceux des collègues. | Ranger les conducteurs dans les dossiers existants, mélangés aux scripts. |
| 2 | **Durée d'un élément avec script** | **Calculée** : lecture (mots ÷ vitesse) + durées des repères ; mise à jour automatique quand le script change. **Surcharge manuelle** possible (ex. interview de 8 min dont seul le lancement est écrit). | Toujours saisie à la main. |
| 3 | **Script attaché** | **Lien** vers un script existant (le sien, Commun ou un collègue : tout est lisible). Bouton « Créer le script » depuis l'élément, rangé dans le dossier du propriétaire du conducteur. Script supprimé → l'élément l'indique, sans bloquer. | Copie du script dans le conducteur (plus de lien). |
| 4 | **Duplication** | Copie le conducteur à une **nouvelle date** choisie, **avec les mêmes liens** vers les scripts (pas de copie des scripts). | Dupliquer aussi les scripts attachés. |
| 5 | **Éléments sans script** (titre, pub…) | Sur l'écran studio, Précédent / Suivant passent **par tous les éléments** ; un élément sans script s'affiche en **grande carte** (type, titre, durée, notes). L'animateur sait toujours ce qui suit. | Ne naviguer que sur les éléments qui ont un script. |
| 6 | **Types d'éléments** | **Paramétrables par l'admin** (libellé + couleur de fond, 20 max) comme les repères. Par défaut, d'après la maquette : Jingle, Chronique, Titre, Météo, Pub, Interview, Flash infos, Autre. | Liste fixe. |
| 7 | **Suppression / historique** | **Corbeille 30 jours**, comme les scripts. **Pas d'historique de versions** à cette étape. Contrôle de version (refus 409 si quelqu'un d'autre a modifié entre-temps). | Historique des versions comme les scripts. |
| 8 | **« Aujourd'hui »** | En tête de la barre latérale de l'écran studio : les conducteurs **datés du jour** (fuseau de la station), **tous animateurs**, par heure de début. | Uniquement ceux du dernier animateur choisi. |

## ⚠️ Changement de sécurité à signaler

L'écran kiosk peut aujourd'hui **uniquement** choisir le script affiché (`POST /api/prompter`). Cette même route accepterait aussi **« conducteur + élément »**, pour que Précédent / Suivant suivent l'émission depuis le Pi.
- Aucune nouvelle route d'écriture pour le Pi ; aucune modification de conducteur ou de script depuis le Pi.
- Le serveur vérifie que l'élément appartient bien au conducteur ; l'action reste tracée (écran + journal d'audit).

## Serveur

- **Migration 4** :
  - `rundowns` : propriétaire (null = Commun), titre, `air_date` (AAAA-MM-JJ), `start_time` (HH:MM:SS), version, auteurs, dates, corbeille (`deleted_at`, `deleted_by`) ;
  - `rundown_items` : conducteur, position, type, titre, durée manuelle (facultative), notes (500 caractères max), `script_id` (`ON DELETE SET NULL`) ;
  - `prompter_state` : `rundown_id`, `item_id` (conducteur et élément affichés) ;
  - `scripts.cue_seconds` : durée cumulée des repères, **remplie pour les scripts existants** par la migration (fonctions JSON de SQLite). Sert aux durées des éléments **et** corrige la limite laissée après le test (listes de la bibliothèque sans les durées des repères).
- **Enregistrement d'un conducteur en une fois** (en-tête + liste complète des éléments), dans une transaction : un glisser-déposer = un enregistrement. Validation zod (200 éléments max, types connus, scripts existants).
- **Routes** : liste par propriétaire, « aujourd'hui », lecture, création, enregistrement, duplication, corbeille / restauration / suppression définitive. Erreurs en codes stables (`{ error: 'code' }`).
- **Temps réel** : un conducteur affiché qui change (élément ajouté, script modifié, durée) est renvoyé à l'écran studio par WebSocket, sans perdre l'élément en cours.
- **Heures de passage** : calculées par une fonction commune (`packages/shared`), utilisée par le serveur, l'interface et l'écran studio.

## Interface animateurs (PC / tablette)

- **Bibliothèque** : onglet ou section « Conducteurs » à côté des scripts, par propriétaire, triée par date ; bouton « Nouveau conducteur ».
- **Éditeur de conducteur** :
  - en-tête : titre, date, heure de début, durée totale et heure de fin calculées ;
  - une ligne par élément, à la couleur de son type : heure de passage, type, titre, durée, icône de script ;
  - **glisser-déposer** par une poignée (événements pointeur : souris **et** tactile), plus boutons ↑ / ↓ ;
  - ajout d'un élément, choix ou création du script attaché, suppression ;
  - enregistrement automatique (même principe que l'éditeur de scripts : en attente / enregistré / conflit) ;
  - « Envoyer au prompteur » : affiche le conducteur sur l'écran studio, positionné sur l'élément choisi.
- **Paramètres (admin)** : types d'éléments (libellé, couleur) sur le modèle des repères.
- **Textes** : FR et EN.

## Écran studio (`/studio`)

- **Barre latérale** : « Aujourd'hui » en tête, puis par propriétaire **Conducteurs** (par date) et les dossiers de scripts.
- **Vue conducteur** (maquette v3) : lignes colorées à grandes zones cliquables, heure de passage, titre, durée, icône si un script est attaché ; l'élément affiché est mis en évidence.
- **Lecture depuis un conducteur** : bandeau « Conducteur · élément 3/12 », **Précédent / Suivant** dans l'ordre du conducteur, bouton de retour à la liste (appui long, comme la sortie).
- **Robustesse** : comme pour les scripts, en cas de coupure le conducteur et le texte restent affichés.
- **Poids** : toujours aucun import de l'éditeur ; le glisser-déposer n'existe que côté postes.

## Hors périmètre de l'étape 4

- **Avance / retard** sur le conducteur (« +1:20 ») : idée §7.3, à proposer après cette étape.
- Titres musicaux remplis automatiquement depuis RadioDJ : étape 5.
- Conducteurs récurrents automatiques (chaque lundi…) : la duplication suffit pour commencer.

## Tests prévus

- **Commun** : calcul des heures de passage et de la durée totale ; validation des conducteurs (types inconnus, trop d'éléments, heure invalide).
- **Serveur** :
  - droits (lecture pour tous, écriture : les siens et Commun, admin partout) ;
  - enregistrement complet et ordre des éléments ;
  - conflit de version ;
  - duplication ;
  - corbeille ;
  - script supprimé définitivement → élément sans script ;
  - « aujourd'hui » selon le fuseau de la station ;
  - le Pi peut choisir un élément d'un conducteur, rien d'autre ;
  - migration 4, y compris le remplissage de `cue_seconds`.
- **Navigateur (Chromium)** :
  - création d'un conducteur, ajout d'éléments, glisser-déposer, heures recalculées ;
  - envoi au prompteur ;
  - sur l'écran studio : « Aujourd'hui », ouverture d'un élément, Précédent / Suivant dans l'ordre du conducteur, carte d'un élément sans script ;
  - mise à jour en direct quand le conducteur est modifié depuis un poste.

## Vérifications avant de pousser

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, et contrôle du poids de `/studio`.
