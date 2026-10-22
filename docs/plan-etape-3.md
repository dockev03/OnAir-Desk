# Étape 3 — Écran studio : plan

> **Statut : réalisée** (voir le bilan en fin de document).
> Référence : `CLAUDE.md` §5 (écran studio, maquette v3), §8 étape 3. Branche : `feature/etape-3-studio`.

## Objectif

L'écran studio (Raspberry Pi, souris seule) devient l'outil de lecture à l'antenne :
- **bandeau supérieur** : nom de la station et horloge à la seconde. L'état de la liaison est discret. Une place est réservée aux blocs On Air, météo et titres, qui arrivent aux étapes 4 et 6.
- **barre latérale** : un dossier par animateur, plus Commun, avec leurs sous-dossiers. Elle se **réduit automatiquement en icônes** en mode lecture ; un bouton « Réduire » permet aussi de le faire à la main.
- **navigation** : grandes zones cliquables, sans aucune saisie au clavier. Un clic sur un script ouvre le **mode lecture**.
- **mode lecture (prompteur)** :
  - texte en grand et **bande de lecture** orange ;
  - défilement à la **molette** ou **automatique** : la vitesse vient du script (mots/min), un clic lance ou met en pause, et la molette reste active pour corriger ;
  - réglage de la vitesse à la volée (−/+), sans modifier le script ;
  - taille du texte **A− / A+** ;
  - **Précédent / Suivant** ;
  - **sortie par appui long**.

## Décisions (validées)

| Sujet | Décision |
|---|---|
| Choix d'un script depuis le Pi | **Oui, exception limitée** : le Pi peut **uniquement** changer le script affiché (`POST /api/prompter`). Toutes ses autres écritures restent refusées. La dernière action l'emporte (Pi ou poste). |
| Sortie du mode lecture | **Appui long d'1 seconde**, avec un remplissage visible ; un clic accidentel ne fait rien. |
| Précédent / Suivant | **Scripts du même dossier**, par ordre alphabétique. Ils suivront l'ordre du conducteur à l'étape 5. |
| Taille du texte réglée sur l'écran | **Mémorisée sur le Pi** (stockage du navigateur), sans écriture côté serveur. La valeur des paramètres sert de point de départ. |

## ⚠️ Changement de sécurité à signaler

L'écran kiosk était en lecture seule stricte. Il obtient **une seule** autorisation d'écriture : choisir le script affiché ou vider l'écran.
- Le garde-fou côté serveur reste actif pour toutes les autres routes. Des tests vérifient que les autres écritures sont toujours refusées.
- L'auteur est tracé : le prompteur indique l'écran qui a choisi le script, et le journal d'audit enregistre l'action.

## Défilement automatique

- **Vitesse en pixels par seconde** = hauteur du texte ÷ durée de lecture (mots ÷ mots/min). Elle s'adapte donc à la taille du texte : à 150 mots/min, un script de 150 mots défile en une minute, quelle que soit la police.
- **Animation** par `transform: translateY` et `requestAnimationFrame`, prise en charge par le processeur graphique. C'est léger pour le Pi 3.
- **Bande de lecture** au tiers supérieur de l'écran. Le texte commence sur la bande et le défilement s'arrête quand la dernière ligne l'atteint.
- **Script modifié pendant la lecture** : la position est conservée. **Nouveau script** : on repart du début, défilement automatique arrêté.

## Serveur

- **Migration 3** : `prompter_state.sent_by_device`, pour l'écran qui a choisi le script. `PrompterState.sentByName` donne alors le nom de cet écran.
- **`POST /api/prompter`** : seule route ouverte au Pi en écriture, via `deviceMayWrite`.
- **Copie affichée** : elle contient aussi le dossier du script (`ownerId`, `folderId`), pour que Précédent / Suivant fonctionnent même quand le script a été envoyé depuis un poste.

## Interface (`/studio`)

- **Composants** : `StudioSidebar`, `StudioBrowser` (liste des sous-dossiers et scripts), `Reader` (prompteur), `HoldButton` (appui long).
- **Robustesse** :
  - au démarrage ou à la reconnexion, l'écran reprend le script affiché ;
  - pendant une coupure, le texte et l'horloge restent à l'écran et un bandeau « Liaison perdue » s'affiche ;
  - jamais d'écran blanc.
- **Poids** : aucun import de l'éditeur. Le poids de la page est vérifié après les changements.

## Tests prévus

- **Serveur** :
  - le Pi peut choisir ou vider le script affiché ;
  - le Pi reste refusé partout ailleurs ;
  - l'auteur (écran) est bien tracé ;
  - la migration 3 s'applique.
- **Navigateur (Chromium)** :
  - navigation dans les dossiers et ouverture d'un script ;
  - défilement à la molette et défilement automatique (la position avance) ;
  - un envoi depuis un poste fait basculer l'écran ;
  - Précédent / Suivant ;
  - A+ conservé après rechargement ;
  - un clic court sur « Sortir » ne fait rien, un appui long fait sortir ;
  - la barre latérale se réduit en lecture ;
  - une coupure n'efface pas l'écran.

## Bilan de l'étape 3

### Réalisé
- **Écran studio** : bandeau (station, horloge), barre latérale des dossiers, navigation à grandes zones cliquables, sans clavier.
- **Mode lecture** :
  - bande de lecture au tiers supérieur ;
  - défilement à la molette et défilement automatique calé sur la vitesse du script ;
  - vitesse réglable à la volée (−/+) ;
  - temps de lecture restant affiché ;
  - A− / A+ mémorisés sur le Pi ;
  - Précédent / Suivant dans le dossier ;
  - sortie par appui long d'1 s.
- **Barre latérale** réduite en icônes pendant la lecture, avec un bouton « Réduire ».
- **Le Pi choisit le script affiché** : c'est sa seule écriture autorisée. L'auteur (écran) est indiqué et journalisé ; la dernière action l'emporte entre Pi et postes.
- **Robustesse** :
  - au rechargement ou à la reconnexion, l'écran reprend le script affiché ;
  - un script modifié en direct garde sa position de lecture ;
  - pendant une coupure, le texte et l'horloge restent affichés, et le bandeau « Liaison perdue » ne décale pas le texte.

### Vérifications faites
- 88 tests automatisés. Nouveau : le Pi peut choisir ou vider le script affiché, mais reste refusé (`read_only_device`) sur toutes les autres écritures, et son action est journalisée.
- **Parcours complet dans Chromium, à la souris seule** :
  1. navigation Jean → Matinale, puis ouverture d'un script ;
  2. barre latérale réduite ;
  3. molette et défilement automatique (la position avance) ;
  4. vitesse +10 ;
  5. A+ conservé après rechargement ;
  6. Suivant / Précédent, désactivés aux extrémités ;
  7. un clic court sur « Sortir » sans effet, un appui long qui fait sortir ;
  8. un envoi depuis un poste fait basculer l'écran ;
  9. une modification en direct conserve la position ;
  10. une coupure du serveur laisse le texte affiché, puis reconnexion automatique.

  Aucune erreur dans la console.
- **Poids sur le Pi** : 182 Ko de JavaScript, sans l'éditeur.

### Hors périmètre (étapes suivantes)
- Section « Aujourd'hui » et ordre du conducteur pour Précédent / Suivant : **étape 5**.
- Blocs On Air, météo, titre en cours et titre à venir dans le bandeau : **étapes 4 et 6**.


## Évolution après test : durée des repères

Demandée après le premier test à l'antenne : après un `[JINGLE]` de 12 s, le texte continuait de défiler alors que la suite ne se lit qu'à la fin du jingle.

- **Durée facultative sur chaque repère** (`cue.attrs.seconds`, 1 s à 1 h, entier) : demandée à l'insertion dans l'éditeur (saisie `12` ou `1:30`, vide = pas d'arrêt), modifiable en cliquant sur le repère. Affichage `[JINGLE · 0:12]`. Aucune migration : le champ est facultatif dans le JSON du script.
- **Prompteur** : en défilement automatique, quand un repère avec durée atteint la bande de lecture, le texte s'arrête et un décompte s'affiche au-dessus de la bande (sur du texte déjà lu), puis le défilement reprend. Bouton **« Reprendre »** si l'élément se termine plus tôt. **Pause** pendant l'attente : l'élément est considéré comme passé. **Molette** : une correction vers le bas laisse le décompte continuer ; en remontant au-dessus du repère, il s'arrêtera de nouveau. Plusieurs repères sur la même ligne : un seul arrêt, durées additionnées.
- **Durées affichées** : le temps restant du prompteur et l'estimation de l'éditeur incluent les durées des repères. Les listes de la bibliothèque (calculées sur le nombre de mots enregistré) ne les incluent pas encore.
