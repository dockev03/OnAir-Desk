# Étape 10 — Régie : plan

> **Statut : réalisée (bilan en fin de document).**
> Référence : `CLAUDE.md` §4 (Accès, rôle « Réalisateur »), §5 (principes d'affichage : zone fixe, code couleur d'alerte), §7 idées 4, 9, 11, 12 et 14, §8 étape 10. Branche : `feature/etape-10-regie`.
> 6 fonctionnalités. S'appuie sur l'état antenne et le journal d'audit (étape 6), les dispositions et la zone régie réservée (étape 8), le rafraîchissement du conducteur suivi (étape 4).

## Objectif

1. **Rôle « Réalisateur »**.
2. **Messages régie** envoyés depuis un autre PC, dans une zone fixe de l'écran studio.
3. **Ordres rapides**.
4. **État des duplex** et liaisons extérieures.
5. **Conducteur modifié en direct**.
6. **Main courante** de l'émission (vue du journal d'audit).

## Existant sur lequel on s'appuie

- **Rôles** : une seule valeur par compte, `admin` ou `animateur` (contrainte `CHECK` dans la table `users`, migration 1).
- **Disposition « Émission avec régie »** (`packages/shared/src/layout.ts`) : `regieZone: true`, zone vide déjà réservée sous le bandeau (`apps/web/src/routes/studio/+page.svelte`).
- **Conducteur suivi** : l'écran studio garde une copie ; toute modification du conducteur la rafraîchit et la diffuse (`Library.rundownRefresh`). L'enregistrement est déjà protégé par un numéro de version (`version_conflict`).
- **WebSocket** : messages client limités à `ping` et `air.sync` ; un compte connecté peut déjà s'abonner (studio par défaut).
- **Journal** : catégorie `regie` déjà prévue dans `AUDIT_CATEGORIES`, inutilisée.
- **Interface** : pas de liaison temps réel aujourd'hui (le bouton On Air relit l'état toutes les 15 s).

## Décisions

Les décisions sont **validées** (y compris les deux questions ouvertes et les points ⚠️ des décisions 8, 9 et 11) ; la colonne « Alternative » garde trace des options écartées. ⚠️ = changement à risque (droits, écriture depuis le kiosk).

### Rôle et droits

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **Forme du rôle** ⚠️ | Un **droit « Réalisateur » à part**, case à cocher sur le compte (`is_director`, migration 11), **cumulable** avec `animateur`. L'admin a d'office tous les droits du réalisateur. La colonne `role` et sa contrainte ne changent pas (pas de table recréée). Changement tracé par l'action existante `user.updated` (ancien et nouvel état). | Troisième valeur de `role` (`realisateur`) : interdit le cumul animateur + réalisateur demandé au §4, et oblige à recréer la table `users`. |
| 2 | **Rattachement (question ouverte)** | **Au studio** : un réalisateur agit sur le studio par défaut (le seul aujourd'hui). Le jour où plusieurs studios existeront, l'admin cochera les studios de chaque réalisateur (table prévue dans le plan correspondant, pas maintenant). | Rattachement **par émission** : il n'existe pas d'objet « émission » (seulement des conducteurs et des modèles) ; il faudrait le créer et le tenir à jour pour chaque date. Trop lourd pour une petite radio. |
| 3 | **Contrôle côté serveur** ⚠️ | Nouveau garde `requireDirector` (admin ou réalisateur, compte actif) sur **chaque route** de la régie ; le kiosk et un animateur sans le droit reçoivent `403 { error: 'forbidden' }`. Tous les envois passent par des **routes HTTP** (validation zod, protections existantes) ; le WebSocket **reste en lecture** : tout autre type de message client est ignoré, et un test le vérifie. | Envois par WebSocket (deuxième chemin d'écriture à sécuriser, sans gain réel de latence sur le réseau interne). |
| 4 | **Limitation du débit** | Par compte : **20 envois / minute** pour messages, ordres et duplex ; **30 / minute** pour les notes de main courante ; au-delà, `429 { error: 'rate_limited' }`, traduit dans l'interface. Compteur en mémoire (comme `LoginThrottle`). | Limite par adresse IP (plusieurs réalisateurs peuvent partager un poste). |

### Messages et ordres

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 5 | **Message régie** | Texte libre de **200 caractères** au plus, texte brut (aucun HTML, affiché sans `{@html}`), une **priorité** : normal ou urgent. **Un seul message affiché à la fois** : un nouvel envoi remplace le précédent. Il reste affiché jusqu'à ce que la régie l'efface, qu'un autre le remplace, ou au bout d'une **durée de vie** (5 min par défaut, réglable de 1 à 30 min dans Paramètres). | File de plusieurs messages (l'animateur ne lit pas une file en direct). |
| 6 | **Ordres rapides** | Liste paramétrable par l'admin (Paramètres → Régie) : **24 ordres** au plus, libellé de 40 caractères, priorité normal / urgent, ordre d'affichage, actif ou non. Exemples proposés à l'installation, inactifs : « Accélère », « Étire », « Conclus », « Invité en ligne », « Pub dans 1 min », « Rends l'antenne ». Un clic dans la console = un message régie (même affichage, même règle de remplacement), tracé comme ordre. | Ordres propres à chaque réalisateur (plus de paramétrage, pas de besoin connu). |
| 7 | **Affichage sur l'écran studio** | Dans la **zone fixe** sous le bandeau, jamais par-dessus le texte : libellé « Régie », texte en grand, heure d'envoi et auteur en petit. **Normal** : texte clair sur fond neutre. **Urgent** : la zone grandit (environ le double) pendant **5 secondes**, fond **rouge** fixe (rouge = « maintenant », code couleur du §5), puis reprend sa taille avec un liseré rouge. Pas de clignotement ; `prefers-reduced-motion` : pas de transition de taille. | Fenêtre par-dessus le prompteur (exclu par le §5). |
| 8 | **Dispositions** | La zone existe en « Émission avec régie » (toujours réservée, vide hors message). En « Animateur seul » et « Interview », elle **apparaît** à l'arrivée d'un message et disparaît à son effacement : le texte du prompteur se décale une fois, sans jamais être recouvert. Jamais sur la veille (la veille cède la place si un message arrive). La console avertit quand la disposition en cours n'est pas « Émission avec régie ». | Messages visibles **seulement** en « Émission avec régie » (un message envoyé pendant une émission en « Animateur seul » serait perdu sans que la régie le sache). |
| 9 | **Accusé « Vu »** ⚠️ | L'animateur peut toucher la zone pour marquer le message **vu** (simple clic, la zone ne sert à rien d'autre) : la console de régie affiche « Vu à 14:32 ». C'est une **nouvelle écriture permise au kiosk** (`POST /api/studio/regie/seen`, identifiant du message seulement), tracée au nom de l'écran, **désactivable** dans Paramètres. Le message reste affiché après « Vu » (seule la régie l'efface). | Pas d'accusé : le kiosk reste strictement en lecture pour la régie, conforme à la lettre du §4 (« le kiosk ne peut rien envoyer ») ; la régie regarde l'animateur à travers la vitre. |
| 10 | **Envoi d'un liner** | Dans la console, chaque carte de liner active a un bouton « Envoyer » : elle part comme message normal. Pas de mécanisme à part (point reporté de l'étape 9). | Ne pas le faire (bande de liners en rotation seulement). |

### Duplex

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 11 | **Lignes de duplex** | Créées par le réalisateur **dans la console**, pour le studio : **6 lignes** au plus, nom de 40 caractères (« Correspondant Moulins », « Invité tél. 1 »), supprimables. Conservées en base (migration 11) : un redémarrage du serveur pendant l'émission ne les perd pas. Bouton « Tout effacer » en fin d'émission. | Lignes déclarées dans le conducteur (plus juste, mais oblige à modifier l'éditeur de conducteur et à préparer chaque émission). |
| 12 | **États et couleurs** | Quatre états, un clic pour changer : **en attente** (gris), **prêt** (vert), **à l'antenne** (bleu vif, icône micro), **coupé** (gris barré). Aucun ne prend l'orange ni le rouge, réservés aux alertes (§5). Chaque changement est tracé (`duplex.changed`). | Rouge pour « à l'antenne » (convention du voyant, mais confusion avec l'alerte « maintenant »). |
| 13 | **Affichage** | Pastilles compactes à droite de la zone régie (nom + état), visibles dans les trois dispositions dès qu'une ligne existe ; l'état « à l'antenne » met la pastille en avant. Aucune ligne : rien n'est affiché. | Bloc séparé dans le bandeau supérieur (déjà plein). |

### Conducteur modifié en direct

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 14 | **Périmètre (question ouverte)** ⚠️ | Le réalisateur peut modifier **le conducteur suivi sur l'écran studio** (« à l'antenne »), quel que soit son propriétaire ; pour les autres conducteurs, il garde ses droits d'animateur. Il ne peut ni le supprimer, ni changer son propriétaire, ni modifier les scripts attachés (il modifie les éléments : ajouter, déplacer, supprimer, changer durée, titre, type, notes, « à couper »). | Tous les conducteurs du jour, ou tous les conducteurs : droit d'écriture beaucoup plus large que le besoin du direct. |
| 15 | **Mécanisme d'édition** | **L'éditeur de conducteur existant**, ouvert depuis la console (« Modifier le conducteur à l'antenne »), avec la protection par version déjà en place : si l'animateur enregistre en même temps, le second reçoit `version_conflict` et recharge. Le serveur vérifie le droit au moment de l'enregistrement (le conducteur doit toujours être suivi à l'écran). | Opérations unitaires dédiées (insérer / déplacer / supprimer par requête) : plus fin en cas d'édition simultanée, mais un deuxième éditeur à écrire. |
| 16 | **Signalement à l'écran** | À chaque rafraîchissement du conducteur suivi, le serveur compare l'ancienne et la nouvelle copie : éléments **ajoutés**, **modifiés**, **déplacés**, nombre de **supprimés**. L'écran studio les **souligne 10 secondes** (liseré et mention « Modifié par Paul ») dans la vue conducteur et, en lecture, un court bandeau dans la zone régie (« Conducteur modifié : 2 éléments »). Heures de passage recalculées (déjà le cas). Couleur du soulignement : neutre (ni orange ni rouge). L'élément en cours de lecture n'est **jamais** changé d'office ; s'il est supprimé, le texte reste affiché (jamais d'écran blanc) avec la mention « retiré du conducteur ». | Aucun signalement (l'animateur ne voit pas ce qui a bougé). |
| 17 | **Traçage** | Modification d'un conducteur suivi par un réalisateur ou l'admin : `rundown.live_edited` (catégorie `regie`), avec le résumé des changements (titres, pas le contenu des notes). Une modification par son propriétaire reste non tracée, comme aujourd'hui. | Tracer toute modification de conducteur (journal très bavard). |

### Main courante

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 18 | **Notes** | Le réalisateur saisit une note (300 caractères, texte brut) : heure serveur automatique, **heure corrigible** (« c'était à 14:05 ») dans la limite des 2 dernières heures. Tracée `logbook.note` (catégorie `regie`), avec le conducteur suivi à ce moment. Une note n'est ni modifiable ni supprimable (c'est un journal) ; on ajoute une note rectificative. | Notes modifiables (contraire à l'esprit d'une main courante). |
| 19 | **Vue « main courante »** | Dans la console de régie, pour le conducteur à l'antenne (ou un conducteur choisi parmi ceux du jour et de la veille) : **entrées des catégories `regie` et `antenne` du studio**, entre l'heure de début du conducteur moins 15 min et son heure de fin calculée plus 30 min, plus les notes rattachées à ce conducteur. Ordre chronologique, heure à la seconde. Rien de nouveau en base : c'est une **vue filtrée** du journal (§4). Les actions y sont **traduites** (libellés lisibles, pas les codes techniques). | Table de main courante séparée (double saisie avec le journal). |
| 20 | **Rétention** | Celle du journal (365 jours). Impression / PDF et rattachement au bilan : **étape 11** (bilan d'émission). | Export dès cette étape. |

### Console de régie

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 21 | **Page « Régie »** | Nouvelle page de l'interface (`/regie`), visible des réalisateurs et de l'admin seulement : aperçu de ce qu'affiche la zone régie de l'écran, saisie du message (normal / urgent, Envoyer, Effacer, « Vu à… »), grille des ordres rapides (grands boutons), liners, duplex, accès au conducteur à l'antenne, main courante (saisie et liste). Pensée pour un écran de PC de régie, utilisable à la tablette. | Fonctions réparties dans les pages existantes. |
| 22 | **Temps réel dans l'interface** | La page Régie ouvre le **WebSocket** existant (déjà accepté pour un compte) : état antenne, messages, duplex, « Vu » et conducteur à jour sans relecture périodique. Les autres pages ne changent pas. | Relecture toutes les quelques secondes (comme le bouton On Air). |

## Serveur

- **Migration 11** (nouvelle entrée) : `users.is_director` (0 / 1, défaut 0) ; table `studio_regie` (par studio : message affiché en JSON, lignes de duplex en JSON, mise à jour) ; aucune table existante recréée.
- **Commun** (`packages/shared`) : `regie.ts` (schémas zod : message, ordre, ligne et état de duplex, note de main courante ; limites) ; état antenne complété par `regie: { message, duplex }` ; `PrompterState` complété par `liveChange` (éléments ajoutés / modifiés / déplacés, supprimés, auteur, heure) ; fonction pure de comparaison de deux conducteurs ; filtre de la main courante (fenêtre de temps) ; paramètres `regie` (durée de vie des messages, accusé « Vu » autorisé, ordres rapides).
- **Service `RegieService`** : envoi, effacement, expiration (minuterie), « Vu », duplex, notes ; persistance, état antenne, journal, limitation du débit.
- **Routes** (sessions, `requireDirector`) : `POST /api/regie/message`, `DELETE /api/regie/message`, `POST /api/regie/order/:id`, `POST/PATCH/DELETE /api/regie/duplex[/:id]`, `POST /api/regie/logbook`, `GET /api/regie/logbook?rundownId=`. Kiosk : `POST /api/studio/regie/seen` (si autorisé). Comptes : `is_director` dans la création / modification par l'admin.
- **Conducteurs** : droit d'écriture étendu au conducteur suivi pour un réalisateur (décision 14) ; calcul de `liveChange` dans `refreshRundownSnapshot` ; action `rundown.live_edited`.
- **Journal** : nouvelles actions au catalogue — `regie.message_sent`, `regie.message_cleared`, `regie.order_sent`, `regie.message_seen`, `duplex.changed`, `rundown.live_edited`, `logbook.note` (toutes `regie`).

## Interface

- **Écran studio** : zone régie (message normal / urgent, agrandissement de 5 s, « Vu »), pastilles de duplex, soulignement des changements du conducteur ; apparition de la zone hors disposition « régie » ; veille interrompue par un message. Poids de `/studio` à vérifier.
- **Page Régie** (décision 21) ; lien dans la barre de navigation pour les réalisateurs et l'admin.
- **Admin → Comptes** : case « Réalisateur » ; libellé du rôle affiché « Animateur · Réalisateur ».
- **Paramètres → Régie** : durée de vie des messages, accusé « Vu » sur l'écran studio (oui / non), ordres rapides (liste, ordre, actifs, priorité).
- **Journal** : filtre « Régie » ; libellés traduits pour les nouvelles actions (et, au passage, les actions de la vue main courante).
- **Textes** : FR et EN. README (rôle Réalisateur, page Régie) et captures (écran studio avec message et duplex ; page Régie).

## Changements à risque

- **Nouveau droit d'écriture** : le réalisateur modifie un conducteur dont il n'est pas propriétaire (seulement celui suivi à l'écran) et envoie des messages affichés à l'antenne. Contrôle côté serveur sur chaque route ; tout est tracé.
- **Écriture depuis le kiosk** : accusé « Vu » (décision 9), identifiant du message seulement, tracé, désactivable. À écarter si la règle « le kiosk ne peut rien envoyer » doit rester stricte.
- **Contenu affiché à l'antenne** : texte brut uniquement, longueur bornée, aucun HTML.
- Aucune nouvelle exposition réseau : tout passe par le serveur principal (HTTPS), rien sur l'écoute des connecteurs.

## Hors périmètre de l'étape 10

- Rattachement d'un réalisateur à plusieurs studios (avec le multi-studio, plus tard).
- Bilan d'émission, impression de la main courante, minuteur de séquence, avance / retard : **étape 11**.
- Messages de l'animateur vers la régie (au-delà de « Vu »), signal sonore, messages programmés.
- Déclaration des duplex dans le conducteur ou les modèles.

## Tests prévus

- **Commun** : schémas (longueurs, priorités, états de duplex, heure de note corrigée dans la limite), comparaison de conducteurs (ajout, suppression, déplacement, modification, rien), fenêtre de la main courante, dispositions (zone affichée à l'arrivée d'un message).
- **Serveur** :
  - droits : admin, réalisateur, animateur sans le droit, kiosk, compte désactivé, sur **chaque** route de la régie ; message WebSocket d'écriture ignoré ;
  - messages : envoi, remplacement, effacement, expiration, « Vu » autorisé / refusé, journal ; débit dépassé (`429`) ;
  - duplex : création (limite de 6), changements d'état, suppression, persistance après redémarrage ;
  - conducteur en direct : réalisateur autorisé sur le conducteur suivi, refusé sur un autre, refusé après changement de conducteur suivi ; conflit de version ; `liveChange` diffusé ; `rundown.live_edited` ;
  - main courante : note, heure corrigée, filtre par conducteur et fenêtre ; migration 11 (comptes existants sans le droit).
- **Bout en bout (Playwright)** : réalisateur envoie un message → affiché dans la zone fixe, texte du prompteur non recouvert ; ordre urgent → agrandi puis réduit ; « Vu » sur l'écran → visible dans la console ; duplex passé « à l'antenne » ; modification en direct → élément souligné puis heure recalculée ; animateur sans le droit : pas de page Régie et `403` sur la route.

## Vérifications préalables

- À voir avec la station (non bloquant) : qui tient la régie et sur quel poste. L'accusé « Vu » est retenu, désactivable dans Paramètres.
- Lisibilité de la zone régie et des pastilles de duplex à 1,5–2 m : à vérifier sur l'afficheur réel après réalisation (`docs/a-faire.md`).

## Bilan de l'étape 10

### Réalisé

- **Commun** (`packages/shared`) :
  - `regie.ts` : schémas du message (texte brut de 200 caractères, sans caractère de contrôle, normal ou urgent), des ordres rapides, des duplex (4 états), de la note de main courante (300 caractères, heure corrigée facultative) ; paramètres `regie` (durée de vie des messages de 1 à 30 min, accusé « Vu », 24 ordres au plus) ;
  - calculs purs : message encore actif, phase « agrandie » d'un urgent (5 s), zone régie visible, comparaison de deux versions d'un conducteur (ajoutés, modifiés, déplacés au sens de la plus longue suite restée dans l'ordre, nombre de supprimés), soulignement de 10 s, fenêtre de la main courante ;
  - état antenne complété : `regie` (message affiché, lignes de duplex) et `liveChange` (dernière modification du conducteur à l'antenne) ; droit `isDirector` sur les comptes et `canDirect` ; 7 actions au catalogue du journal (catégorie `regie`).
- **Serveur** :
  - **migration 11** : `users.is_director`, table `studio_regie` (message et duplex par studio, conservés en base) ;
  - garde `requireDirector` sur chaque route de la régie (kiosk et animateur sans le droit : 403) ; le WebSocket reste en lecture (tout message d'écriture est ignoré, testé) ;
  - `RegieService` : envoi (remplace le précédent), effacement, expiration programmée (et au redémarrage), accusé « Vu » de l'écran studio (une fois, désactivable), duplex (6 lignes), notes ; débit limité par compte (20 envois / min, 30 notes / min, `429 rate_limited`) ; journal ;
  - routes `/api/regie/message`, `/order/:id`, `/liner/:id`, `/duplex[/:id]`, `/logbook` ; `/api/studio/regie/seen` pour l'écran studio ;
  - conducteur modifié en direct : un réalisateur modifie **les éléments seulement** (`live_edit_items_only` sinon) du conducteur à l'antenne ; le serveur compare les versions, publie le changement dans l'état antenne et trace `rundown.live_edited` quand l'auteur n'est pas le propriétaire ; protection par version inchangée (`version_conflict`) ;
  - main courante : vue filtrée du journal (catégories régie et antenne du studio, début − 15 min → fin + 30 min) et notes rattachées au conducteur, triées à leur heure (corrigée le cas échéant).
- **Interface** :
  - écran studio : composant `RegieZone` (message en grand, heure et auteur, rouge agrandi 5 s pour un urgent puis liseré rouge, « Vu » au clic, pastilles des duplex, bandeau « Conducteur modifié » en lecture) ; zone toujours réservée en « Émission avec régie », apparition à la demande ailleurs ; la veille cède devant un message ; éléments ajoutés / modifiés / déplacés soulignés 10 s dans la liste du conducteur, copie rechargée si elle n'est pas celle du prompteur ; élément retiré pendant la lecture : texte conservé, mention « Élément retiré du conducteur » ;
  - page **Régie** (`/regie`, temps réel par le WebSocket) : conducteur à l'antenne et élément en cours, avertissement de disposition, message (aperçu, « Vu à… », Effacer), ordres rapides, liners, duplex, notes et main courante par émission ; lien dans la barre pour les réalisateurs et l'admin ;
  - éditeur de conducteur : mode « modification en direct » (éléments seulement, bandeau explicatif) ;
  - comptes : case « Réalisateur » (création et liste) ; paramètres : section Régie ; journal : actions traduites (toutes, plus les codes techniques) ;
  - textes FR et EN ; README (section Régie, sécurité, captures `studio-regie.png` et `regie.png`).

### Tests

- 291 tests unitaires (+29), dont :
  - commun : schémas (texte, contrôle, longueurs, ordres, duplex, notes), droit cumulable, message actif, urgent agrandi, zone visible, comparaison de conducteurs (rien, ajout / suppression / modification, déplacement minimal), soulignement, fenêtre ;
  - serveur : droits sur **chaque** route (animateur, kiosk, anonyme, compte désactivé), envoi / remplacement / effacement / journal, texte refusé, ordres et liners actifs seulement, expiration et redémarrage, « Vu » (écran seulement, une fois, désactivable, tracé au nom de l'écran), débit par compte, duplex (limite, états, suppression, tout effacer, journal), persistance et migration 11, modification en direct (refusée hors antenne, éléments seulement, conflit de version, changement de conducteur suivi, propriétaire non tracé, émission en cours non suivie), main courante (heure corrigée bornée, fenêtre, note rattachée), WebSocket en lecture.
- **Bout en bout (Chromium)**, 6 nouveaux scénarios : message dans la zone fixe au-dessus du texte du prompteur (jamais par-dessus) ; « Vu » depuis l'écran, visible dans la console ; ordre urgent agrandi puis réduit, effacement ; duplex passé « à l'antenne » ; conducteur modifié en lecture puis en liste (souligné 10 s), main courante ; animateur sans le droit (ni lien, ni page, 403).
- **Poids de `/studio`** : +6,6 Ko gzip (102,0 → 108,6 Ko, même méthode avant / après), dont +4,5 Ko de textes (le dictionnaire FR + EN est commun à toutes les pages : régie et libellés traduits du journal) ; toujours sans l'éditeur.

### Écarts et limites connues

- **Conducteur « à l'antenne »** : suivi sur l'écran studio **ou** émission en cours d'après ses heures (même règle que la veille, marge de 10 min). Le plan ne parlait que du conducteur suivi ; or l'écran ne suit plus le conducteur dès que l'animateur revient à la liste des éléments, ce qui aurait retiré le droit de modification en pleine émission. La console de régie applique la même règle.
- **Signal de modification** : publié dans l'état antenne (`liveChange`) plutôt que dans l'état du prompteur, pour être vu aussi quand le conducteur est affiché en liste. Il n'est pas conservé en base (un redémarrage l'efface : il ne sert que 10 secondes).
- **Duplex** : renommage prévu par l'API (`PATCH` avec `name`), pas encore proposé dans la page Régie (supprimer puis recréer).
- **Main courante** : pour le studio par défaut (un seul studio aujourd'hui) ; impression et rattachement au bilan à l'étape 11.
- Le réalisateur ne peut pas créer de script dans le dossier d'un collègue depuis l'éditeur de conducteur (droits de la bibliothèque inchangés) : il attache un script existant ou en crée un dans son dossier.
- À vérifier à la mise en service : lisibilité de la zone régie et des pastilles de duplex à 1,5–2 m ; qui tient la régie, sur quel poste (`docs/a-faire.md`).
