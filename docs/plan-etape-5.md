# Étape 5 — Compléments conducteurs : plan

> **Statut : réalisée (bilan en fin de document).**
> Référence : `CLAUDE.md` §7 (idées 15 et 16), §8 étape 5, §10 (identité de la station : logo). Branche prévue : `feature/etape-5-complements-conducteurs`.
> Étape courte (3 fonctionnalités), sur le code des conducteurs de l'étape 4 et des paramètres.

## Objectif

1. **Modèles d'émission récurrente** : enregistrer une émission comme **modèle** (heure de début, éléments, scripts attachés, jours de diffusion), puis **créer en un clic** ses conducteurs sur une période choisie. La création reste **une action de l'animateur** : il prépare ses émissions lui-même. La duplication de l'étape 4 reste disponible.
2. **Impression / PDF du conducteur** : une version papier propre, pour la régie en secours et pour l'archive.
3. **Logo de la station** : en plus du nom, un logo envoyé par l'admin, affiché dans l'interface et sur les impressions.

## Décisions

Les 13 décisions sont **validées** (3, 4, 10, 11 et 13 ajustées par l'utilisateur) ; la colonne « Alternative » garde trace des options écartées.

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **Nature d'un modèle** | Un objet **à part**, sans date : titre, heure de début, éléments, jours de diffusion. Rangé dans une section **« Modèles »** de chaque propriétaire, sous les conducteurs. | Un conducteur ordinaire marqué « modèle » (mélange daté / non daté dans les listes). |
| 2 | **Création d'un modèle** | Deux voies : **« Enregistrer comme modèle »** depuis un conducteur existant (copie de ses éléments), ou **« Nouveau modèle »** vide. | Uniquement depuis un conducteur. |
| 3 | **Récurrence** | **Jours de la semaine** cochés (lun → dim), avec une **période facultative** (du / au, ex. saison septembre → juin), un interrupteur **actif / suspendu** et des **exclusions** : dates ou plages sans émission (jour férié, vacances, retransmission). | Règles avancées (« 1er lundi du mois », une semaine sur deux) : hors périmètre. |
| 4 | **Création des conducteurs** | **Manuelle**, par l'animateur : bouton **« Créer les conducteurs »** sur le modèle, avec une période (par défaut la semaine suivante, 3 mois max). Le serveur crée un conducteur par jour coché de la période, hors exclusions et hors période de validité, puis affiche le résumé : créés, déjà existants, ignorés. **Aucune création automatique.** | Création automatique N jours à l'avance par le serveur (écartée : les animateurs ne prépareraient plus leurs émissions). |
| 5 | **Pas de doublon, pas de résurrection** | Un conducteur généré garde le lien vers son modèle ; **un seul par modèle et par date**. S'il est supprimé (corbeille) ou déplacé à une autre date, il **n'est pas recréé**. | Recréer tout conducteur manquant. |
| 6 | **Modèle modifié après génération** | Les conducteurs **déjà générés ne changent pas** (ils ont pu être retouchés) ; seuls les suivants suivent le modèle. Un bouton **« Réappliquer le modèle »** sur un conducteur généré permet de le remettre à jour, avec confirmation. | Propager automatiquement (risque d'écraser des retouches). |
| 7 | **Scripts attachés** | Les conducteurs générés reprennent **les mêmes liens** vers les scripts, comme la duplication de l'étape 4 (ex. le script « Météo » de Commun, mis à jour chaque jour). | Créer un script vierge par génération. |
| 8 | **Droits et suppression** | Mêmes droits que les conducteurs : je modifie mes modèles et ceux de Commun, je lis ceux des collègues (et peux les dupliquer chez moi), l'admin modifie tout. Suppression = **corbeille 30 jours**. Les conducteurs générés **restent** quand on supprime le modèle. | Supprimer aussi les conducteurs générés à venir. |
| 9 | **Impression** | **Page d'impression** dédiée et **feuille de style d'impression** ; « Imprimer » ouvre la boîte du navigateur, qui propose aussi **« Enregistrer en PDF »**. **Aucune bibliothèque PDF** ni navigateur embarqué dans l'image Docker. | Génération du PDF par le serveur (dépendance lourde, image plus grosse). |
| 10 | **Contenu imprimé** | En-tête : station, **logo**, titre, date, heures de début et de fin, durée totale. Tableau : heure de passage, type (pastille de couleur **et** libellé, lisible en noir et blanc), titre, durée, notes, script attaché. Option **« Inclure le texte des scripts »** à la suite. Pied : date d'impression, numéro de page. Format A4. | Tableau seul, sans les textes. |
| 11 | **Format du logo** | **PNG, JPEG ou WebP**, **3 Mo max**, type vérifié sur le contenu du fichier (pas seulement l'extension). **SVG refusé** : il peut contenir du code exécutable. Pas de redimensionnement côté serveur (pas de bibliothèque d'image) : l'affichage limite la hauteur. | Accepter le SVG en le nettoyant (risque d'injection, nettoyage délicat). |
| 12 | **Stockage et diffusion** | Stocké **dans la base SQLite** (un seul fichier à sauvegarder), envoyé en JSON (base64) depuis la page Paramètres : **aucune nouvelle dépendance** (pas de module d'envoi de fichiers). Limite de taille de requête relevée (≈ 4,5 Mo) **pour cette seule route**. Servi par `GET /api/station/logo`, **sans connexion** (page de connexion, écran studio), avec cache et `X-Content-Type-Options: nosniff`. Remplacer ou retirer le logo est tracé au journal d'audit. | Fichier dans le volume de données, envoi en `multipart` (nouvelle dépendance). |
| 13 | **Où l'afficher** | En-tête de l'interface postes, page de connexion, assistant de premier lancement (facultatif), impressions. **Écran studio** : petit logo en haut de la barre latérale, **masqué quand elle est réduite et en mode prompteur** (lecture). | Interface postes et impressions seulement. |

## Serveur

- **Migration 5** (nouvelle entrée, aucune migration livrée modifiée) :
  - `rundown_templates` : propriétaire (null = Commun), titre, `start_time`, jours (masque lun → dim), `valid_from` / `valid_until` facultatifs, `active`, version, auteurs, dates, corbeille ;
  - `rundown_template_items` : mêmes colonnes que `rundown_items` (position, type, titre, durée manuelle, notes, `script_id` en `ON DELETE SET NULL`) ;
  - `rundown_template_exclusions` : modèle, date de début, date de fin (une date seule = début et fin identiques), libellé facultatif ;
  - `rundowns.template_id` (facultatif, `ON DELETE SET NULL`) et `rundowns.template_date` : date d'origine de la création ; **index unique** (`template_id`, `template_date`), qui empêche doublon et résurrection même après déplacement ou mise à la corbeille ;
  - `station_logo` : une seule ligne, image (BLOB), type, empreinte (pour le cache), date de mise à jour.
- **Création des conducteurs** : à la demande, pour une période ; insertion idempotente (contrainte unique) dans une transaction ; réponse avec les dates créées, déjà existantes et ignorées (exclusion, hors période) ; tracée au journal d'audit (`rundown.created_from_template`, acteur = l'animateur).
- **Routes** : `/api/templates` (liste par propriétaire, lecture, création, enregistrement complet avec contrôle de version, duplication, corbeille / restauration / suppression définitive), `POST /api/templates/:id/create-rundowns` (période), `POST /api/rundowns/:id/save-as-template`, `POST /api/rundowns/:id/reapply-template`, `PUT` / `DELETE /api/settings/logo` (admin), `GET /api/station/logo` (public). Erreurs en codes stables (`{ error: 'code' }`).
- **Validation** : schémas zod dans `packages/shared` (mêmes règles que les éléments de conducteur : 200 max, types connus, scripts existants ; au moins un jour coché ; période et exclusions cohérentes, 100 exclusions max ; période de création de 3 mois max ; logo : type et taille).
- **Calcul des dates** : fonction pure dans `packages/shared` (jours de diffusion entre deux dates selon jours cochés, période de validité et exclusions), testée seule.

## Interface postes (PC / tablette)

- **Menu Conducteurs** : section **« Modèles »** par propriétaire (titre, jours, heure, actif / suspendu), bouton « Nouveau modèle ».
- **Éditeur de modèle** : même liste d'éléments que l'éditeur de conducteur (couleurs, durées, glisser-déposer, script attaché, enregistrement automatique). L'éditeur d'éléments est **extrait en composant commun** pour servir aux deux, sans dupliquer le code. En-tête : titre, heure de début, jours, période, actif, **exclusions** (ajout d'une date ou d'une plage). Bouton **« Créer les conducteurs »** : choix de la période, aperçu des dates concernées, puis résumé.
- **Éditeur de conducteur** : boutons « Enregistrer comme modèle », « Imprimer », et pour un conducteur généré, le nom du modèle d'origine et « Réappliquer le modèle ».
- **Page d'impression** (`/rundowns/[id]/print`) : mise en page A4, case « Inclure le texte des scripts » ; textes rendus par `apps/web/src/lib/content/` (**jamais de `{@html}`**).
- **Paramètres (admin)** : **logo** (aperçu, remplacer, retirer).
- **Logo** affiché dans l'en-tête de l'interface et sur la page de connexion.
- **Textes** : FR et EN.

## Écran studio

- Un conducteur créé depuis un modèle est un conducteur comme un autre : il apparaît dans « Aujourd'hui ».
- Logo en haut de la barre latérale, masqué quand elle est réduite et en mode prompteur (image servie par le serveur, aucune ressource externe).
- Le poids de `/studio` ne doit presque pas bouger (ni modèles, ni impression importés).

## Hors périmètre de l'étape 5

- Récurrences avancées (« 1er lundi du mois », une semaine sur deux) et jours fériés automatiques.
- Impression depuis l'écran studio.
- Envoi du PDF par mail ou archivage automatique.
- Création automatique des conducteurs par le serveur (décision 4).
- Couleurs de la station (identité, §10) : plus tard.

## Tests prévus

- **Commun** : calcul des dates de diffusion (jours cochés, période, exclusions, changement d'heure, fin de mois) ; validation des modèles.
- **Serveur** :
  - migration 5 ;
  - création depuis un modèle : bon nombre de conducteurs, exclusions respectées, idempotence (deux clics = aucun doublon), pas de résurrection après corbeille ou déplacement, modèle suspendu ou hors période → rien, période trop longue refusée ;
  - modèle modifié → seuls les nouveaux conducteurs changent ; « Réappliquer le modèle » ;
  - droits (lecture pour tous, écriture : les siens et Commun, admin partout), conflit de version, corbeille ;
  - « Enregistrer comme modèle » depuis un conducteur ;
  - logo : admin seul, types refusés (SVG, faux PNG), taille max, lecture publique avec le bon type et le cache.
- **Navigateur (Chromium)** :
  - création d'un modèle depuis un conducteur, jours cochés, exclusion, « Créer les conducteurs » et résumé, conducteurs visibles dans les listes et dans « Aujourd'hui » de l'écran studio ;
  - suspension d'un modèle ;
  - envoi du logo, affichage dans l'en-tête, la connexion et l'impression ;
  - page d'impression : contenu, option des textes, aperçu en PDF.

## Vérifications avant de pousser

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, et contrôle du poids de `/studio`.

---

## Bilan de l'étape 5

### Réalisé

- **Commun** (`packages/shared/src/template.ts`) : jours de diffusion (1 = lundi … 7 = dimanche, masque en base), schémas zod des modèles (au moins un jour, période cohérente, 100 exclusions max, mêmes règles d'éléments que les conducteurs), période de création de 3 mois max (92 jours), et la fonction pure `templateDates` (jours cochés, période de validité, exclusions), utilisée par le serveur **et** par l'aperçu de l'interface. `addDays` y est déplacé (l'interface l'importait en double).
- **Migration 5** : `rundown_templates`, `rundown_template_items`, `rundown_template_exclusions`, `rundowns.template_id` / `template_date` avec index unique (ni doublon, ni résurrection), `station_logo`. Aucune migration livrée modifiée.
- **Serveur** :
  - routes `/api/templates` (liste, lecture, création, enregistrement avec contrôle de version, duplication, corbeille / restauration / suppression définitive), `POST /api/templates/:id/create-rundowns`, `POST /api/rundowns/:id/save-as-template`, `POST /api/rundowns/:id/reapply-template` ;
  - lecture et écriture des éléments mises en commun entre conducteurs et modèles (`readItems` / `writeItems`) ;
  - corbeille commune scripts + conducteurs + modèles, purge à 30 jours ; les conducteurs créés restent quand le modèle est supprimé ;
  - journal d'audit : `rundown.created_from_template`, `template.*`, `rundown.template_reapplied`, `logo.updated` / `logo.removed` ;
  - logo : `PUT` / `DELETE /api/settings/logo` (admin), `GET /api/station/logo` public, type vérifié sur les premiers octets (PNG, JPEG, WebP ; SVG et faux PNG refusés), 3 Mo max, limite de requête relevée à 4,5 Mo **pour cette seule route**, `ETag`, `nosniff`, cache long quand l'URL porte l'empreinte (`?v=`).
  - L'**empreinte du logo** (`logoHash`) est ajoutée aux paramètres, en lecture seule : elle part avec la diffusion WebSocket des paramètres, l'écran studio recharge donc le logo sans code nouveau.
- **Interface postes** :
  - menu **Conducteurs** : section **Modèles** par propriétaire (jours, heure, nombre d'éléments, durée, « suspendu »), « Nouveau modèle » (du lundi au vendredi par défaut), duplication, corbeille ;
  - **éditeur de modèle** (`/rundowns/templates/[id]`) : titre, heure, jours, période de validité, actif, exclusions (date seule ou plage, motif), éléments, enregistrement automatique ; **« Créer les conducteurs »** avec période (semaine suivante par défaut), aperçu des dates et résumé (créés avec liens, déjà existants, ignorés et pourquoi) ;
  - **éditeur de conducteur** : « Imprimer », « Enregistrer comme modèle » (chez soi pour le conducteur d'un collègue), modèle d'origine et « Réappliquer le modèle » avec confirmation ;
  - l'éditeur d'éléments (`lib/rundown-editor/ItemsEditor.svelte`) et l'enregistrement automatique (`autosave.svelte.ts`) sont **extraits en composants communs** aux deux éditeurs ;
  - **page d'impression** (`/rundowns/[id]/print`) : feuille A4, logo, station, titre, date, heures de début et de fin, durée ; tableau (heure, pastille **et** libellé du type, titre, durée, notes, script) ; option « Inclure le texte des scripts » (rendu par `lib/content`, jamais de `{@html}`) ; pied de page « Imprimé le … » et « Page n / N » (marges `@page`) ;
  - **Paramètres** : logo (aperçu, envoyer / remplacer, retirer) ;
  - **logo** dans l'en-tête (avec le nom de la station à la place de « OnAir-Desk ») et sur la page de connexion ;
  - textes FR et EN.
- **Écran studio** : logo en haut de la barre latérale, masqué quand elle est réduite et en lecture ; les conducteurs créés depuis un modèle apparaissent dans « Aujourd'hui » comme les autres.
- **Correction au passage** : supprimer un compte qui possède des conducteurs (ou des modèles) provoquait une erreur 500 (contrainte `RESTRICT`) ; c'est maintenant le refus prévu `user_has_content`.

### Tests

- 141 tests au total (45 en commun, 96 serveur), dont : calcul des dates (jours, période, exclusions, changement d'heure, fins de mois, année complète), validation ; migration 5 (conducteurs existants conservés, unicité modèle + date) ; création (nombre, exclusions, hors période, idempotence, pas de résurrection après corbeille ou déplacement, modèle suspendu, période trop longue), modèle modifié puis « Réappliquer », droits, conflit de version, corbeille, « Enregistrer comme modèle », compte avec modèles ; logo (admin seul, SVG, faux PNG, taille, 3 Mo pile accepté, lecture publique, type, cache, 304, empreinte non modifiable par les paramètres, audit).
- **Navigateur (Chromium)**, 26 vérifications : « Enregistrer comme modèle », jours cochés, exclusion du 11 novembre, enregistrement automatique, « Créer les conducteurs » sur 3 semaines (14 créés, 1 exclu), second clic sans doublon, suspension, liste des modèles, conducteur généré et « Réappliquer », logo (SVG et faux PNG refusés, PNG accepté), en-tête, page de connexion, impression (logo, tableau, texte des scripts, en-tête masqué, PDF A4 avec pied de page), écran studio (conducteur du jour, logo masqué en lecture), aucune erreur JavaScript.
- **Poids de `/studio`** : +3,4 Ko gzip (70,3 → 73,7 Ko, entrées et mise en page comprises), dont ~1,9 Ko de nouveaux textes FR/EN (dictionnaire unique) et ~0,7 Ko de schémas zod des modèles ; toujours sans l'éditeur.

### Écarts et limites connues

- **Assistant de premier lancement** : pas d'envoi de logo (décision 13 : facultatif) ; il se fait dans Paramètres.
- Un conducteur généré mis à la corbeille puis **purgé** (30 jours) libère sa date : elle pourrait être recréée par une nouvelle demande sur cette période (en pratique une date passée).
- La date d'impression du pied de page est celle de l'ouverture de la page d'impression.

