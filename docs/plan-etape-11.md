# Étape 11 — Suivi du temps : plan

> **Statut : réalisée (bilan en fin de document).**
> Référence : `CLAUDE.md` §5 (principes d'affichage : code couleur d'alerte unique, distance de lecture), §7 idées 2, 3, 6, 8, 10 et 13, §8 étape 11, §10 (horaires fixes paramétrables). Branche prévue : `feature/etape-11-suivi-du-temps`.
> 6 fonctionnalités. S'appuie sur les calculs de temps (`timing.ts`, étape 6), le conducteur suivi et ses heures de passage (étape 4), l'« émission en cours » (veille, étape 8), le conducteur modifié en direct et la main courante (étape 10), l'impression (étape 5).

## Objectif

1. **Compte à rebours vers un horaire fixe** (« Flash infos dans 4:12 », « Top horaire dans 1:05 »).
2. **Avance / retard** sur le conducteur (« +1:20 »).
3. **Minuteur de séquence** (« reste 0:45 », rouge en dépassement).
4. **Backtiming / heure de fin imposée** (temps restant jusqu'à la fin, ce qu'il reste à caser ou à couper).
5. **Mode répétition** (chronométrer un conducteur hors antenne).
6. **Bilan d'émission** (prévu / réel / écart par élément, main courante jointe, impression).

Les fonctionnalités 2, 3, 4 et 6 reposent toutes sur une même donnée qui n'existe pas encore : **l'heure réelle de passage de chaque élément**. Elle est posée une fois (le « déroulé », décisions 1 à 4), puis chaque fonctionnalité s'y branche.

## Existant sur lequel on s'appuie

- **Conducteur** : date, **heure de début** (`startTime`), éléments avec durée ; heures de passage, fin et total calculés par `rundownSchedule` (`packages/shared/src/timing.ts`). Pas d'heure de fin imposée. Élément « à couper » (conducteur enrichi).
- **Écran studio** : l'élément affiché est enregistré dans `prompter_state` (`rundown_id`, `item_uid`, `sent_at`) et chaque choix est tracé `prompter.sent` (écran ou poste). Le conducteur suivi est rafraîchi à chaque modification (`liveChange`, étape 10).
- **Émission en cours** : `showInProgress` (`standby.ts`) : début − 10 min ≤ maintenant ≤ fin calculée + 10 min.
- **Code couleur** : `alertLevel` / `formatCountdown` (`timing.ts`), seuils de l'alerte de fin de titre.
- **Main courante** : vue filtrée du journal (début − 15 min → fin + 30 min) et notes rattachées au conducteur (étape 10), reportée explicitement à cette étape pour l'impression et le bilan.
- **Impression** : page imprimable du conducteur (étape 5, conducteur enrichi).
- **Paramètres** : objet `settings` validé par zod ; pas encore d'horaires fixes.

## Décisions

Les décisions sont **validées** (y compris les questions ouvertes 3 et 16) ; la colonne « Alternative » garde trace des options écartées. ⚠️ = changement à risque (écriture depuis le kiosk).

### Le déroulé (heures réelles de passage)

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 1 | **Déroulé** | Un **déroulé** = un passage d'un conducteur à l'antenne (ou en répétition). Il **démarre seul** quand l'écran studio affiche un élément du **conducteur à l'antenne** (même règle qu'à l'étape 10 : suivi, ou émission en cours d'après ses heures). Un seul déroulé actif par studio. Un conducteur a **un seul déroulé d'antenne** : s'il est réaffiché plus tard dans sa fenêtre, le même déroulé reprend. | Bouton « Démarrer l'émission » obligatoire (un geste de plus en direct, souvent oublié). |
| 2 | **Heure réelle d'un élément** | Heure serveur à laquelle l'élément est **affiché** sur l'écran studio (clic dans la liste, Suivant / Précédent, ou envoi depuis un poste). Son heure de fin réelle = début de l'élément suivant affiché. Un élément **sauté** (jamais affiché) reste « non pointé » dans le bilan, sans heure réelle. Un élément affiché **avant l'heure de début** de l'émission (préparation) compte comme démarré **à l'heure de début**. | Allumage du On Air comme top de départ du premier élément (plus juste, mais le On Air n'est pas branché partout). |
| 3 | **Titres musicaux pointés par l'automation** | **Oui** (validé). Un élément « titre » rempli depuis RadioDJ (artiste + titre) est pointé **à l'heure de démarrage réelle du titre** quand l'automation le lance, sans changer ce qu'affiche le prompteur. Sinon, les titres (rarement cliqués à l'écran) seraient tous « non pointés ». Comparaison artiste + titre, sans tenir compte de la casse ni des accents ; seulement pour la source du direct. | Pointage par l'écran seulement : bilan des titres musicaux vide, avance / retard faux pendant les enchaînements musicaux. |
| 4 | **Fin du déroulé** | **Automatique** : un autre conducteur démarre son déroulé, ou la fenêtre de l'émission se ferme (fin calculée + 30 min, comme la main courante). **Manuelle** : « Clore l'émission » sur la page Régie (réalisateur, admin) et sur la page du bilan (propriétaire). Un déroulé clos ne se rouvre pas ; le bilan est figé. | Fin à l'affichage du dernier élément (le dernier élément n'aurait pas de durée réelle). |

### Affichage commun

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 5 | **Bande de temps** | Une **bande fixe** sur l'écran studio, entre le bandeau et la zone principale (au-dessus de la zone régie), en **lecture comme en conducteur**, jamais par-dessus le texte : à gauche le **minuteur de séquence**, au centre **avance / retard**, à droite **fin imposée** (backtiming), et le **prochain horaire fixe** quand il approche. Chaque case n'apparaît que si elle a quelque chose à dire ; bande entièrement vide : elle disparaît (le texte se décale une fois). Chiffres en grand (taille minimale de l'heure, §5). | Chaque information dans un bloc différent (bandeau déjà plein, lecture du coin de l'œil plus difficile). |
| 6 | **Code couleur** | Le code unique du §5 : **orange = bientôt**, **rouge = maintenant / dépassé**, rouge fixe (pas de pulsation pour ces compteurs, seule la fin de titre pulse). L'**avance** ne prend jamais d'alerte (texte neutre, « −0:45 »). Seuils paramétrables (décision 21). `prefers-reduced-motion` respecté. | Vert pour l'avance (couleur supplémentaire à apprendre, sans action attendue). |
| 7 | **Dispositions** | La bande existe dans les **trois dispositions** (le minuteur et le retard servent aussi à l'animateur seul). **Veille** : seul le prochain horaire fixe peut s'y afficher. Pas de bloc à cocher par disposition. | Bande réservée à « Émission avec régie ». |

### 1. Compte à rebours vers un horaire fixe

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 8 | **Horaires fixes** | Paramètres → **Horaires fixes** (admin) : **20** au plus ; chacun a un libellé (40 caractères), une **minute** (0–59), les **heures** concernées (cases 0 à 23, « toutes » par défaut), les **jours** de la semaine, un délai de **prévenance** (1 à 30 min, 5 par défaut), actif ou non. Exemples proposés à l'installation, **inactifs** : « Top horaire » (chaque heure, :00), « Flash infos » (7 h, 8 h, 12 h, 18 h, :00). Heures dans le fuseau de la station. | Horaires attachés à chaque conducteur (à ressaisir partout ; un top horaire est une règle de la station). |
| 9 | **Affichage** | Pendant la prévenance : « Flash infos dans 4:12 » ; **orange** à 1 min, **rouge** à 10 s, puis « Flash infos maintenant » 10 s. Deux horaires proches : le plus proche seulement. Calcul côté écran, à l'heure serveur (`nextFixedTime`, fonction pure). | Liste permanente des prochains horaires (bruit visuel). |

### 2. Avance / retard

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 10 | **Calcul** | Écart = heure réelle de début de l'élément en cours − heure de passage prévue, **plus** le dépassement de l'élément en cours s'il a déjà duré plus que prévu (le retard grandit seconde par seconde pendant un dépassement). Heures prévues = conducteur **actuel** (après une modification en direct, le nouveau plan fait foi). Fonction pure `rundownDrift`. | Écart sur l'élément en cours seulement, sans dépassement (le retard ne s'affiche qu'à l'élément suivant : trop tard). |
| 11 | **Affichage** | « Retard +1:20 » / « Avance −0:45 » ; retard **orange** à partir de 30 s, **rouge** à partir de 2 min (paramétrables) ; moins de 5 s d'écart : « À l'heure ». En vue conducteur, la colonne des heures montre aussi l'**heure réelle** des éléments passés et l'**heure recalculée** (prévue + écart) des suivants, en plus petit. | Heures prévues seulement (l'animateur fait le calcul de tête). |

### 3. Minuteur de séquence

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 12 | **Minuteur** | Pour l'élément en cours : « reste 0:45 » = durée prévue − temps écoulé depuis son heure réelle ; **orange** dans les 15 dernières secondes (paramétrable), **rouge** en dépassement : « +0:12 ». Élément sans durée (0) : simple chronomètre « 1:05 » sans alerte. Élément « titre » pointé par l'automation : le minuteur se tait (le bloc « Titre en cours » fait déjà ce travail). | Minuteur affiché seulement en lecture (l'animateur en vue conducteur le perd). |

### 4. Backtiming / heure de fin imposée

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 13 | **Heure de fin imposée** | Nouveau champ **facultatif** du conducteur **et du modèle** : `endTime` (« HH:MM:SS », après l'heure de début, même jour ; une émission passant minuit est hors périmètre). Repris lors de la création depuis un modèle et de la duplication. Il couvre aussi la « durée cible » laissée par le conducteur enrichi (durée cible = fin − début). | Durée cible (relative) au lieu d'une heure : moins parlant pour un journal ou un relais réseau à heure fixe. |
| 14 | **Dans l'éditeur et à l'impression** | Sous la liste : « Fin calculée 12:58:30 · fin imposée 13:00:00 · **à caser 1:30** » ou « **à couper 2:10** » (rouge), et le total des éléments « à couper » (« éléments à couper : 3:00 »). Même ligne sur la page imprimée. | Rien dans l'éditeur (le problème n'apparaîtrait qu'en direct). |
| 15 | **À l'antenne** | Case droite de la bande : « Fin 13:00 · reste 12:34 », et la projection : fin prévue = maintenant + reste de l'élément en cours + durée des éléments suivants ; « à caser 1:30 » (neutre) ou « à couper 2:10 » (**orange**, **rouge** à moins de 5 min de la fin). Si couper les éléments « à couper » restants suffit, le dire : « couper les éléments marqués suffit ». Le reste avant la fin passe **orange** à 5 min, **rouge** à 1 min (paramétrables). Fonction pure `backtime`. | Temps restant seul, sans projection (ne répond pas à « que dois-je couper ? », §7 idée 6). |

### 5. Mode répétition

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 16 | **Lancement** ⚠️ | Depuis l'**écran studio** (sur un conducteur de la barre latérale, bouton « Répéter », appui long) ou depuis un **poste** (page du conducteur, « Répéter sur l'écran studio », droits de lecture sur le conducteur). C'est une **nouvelle écriture permise au kiosk** (démarrer / arrêter une répétition), tracée au nom de l'écran, **désactivable** dans Paramètres. **Refusée** si le On Air est allumé ou si une émission est en cours (`rehearsal_on_air`). | Répétition depuis un poste seulement (l'animateur répète là où il lit : au studio). |
| 17 | **Déroulement** | Déroulé marqué **répétition** : l'écran affiche en permanence « RÉPÉTITION » dans la bande de temps ; heures de passage recalculées **à partir du lancement** (pas de l'heure prévue) ; minuteur, avance / retard et backtiming (fin imposée décalée d'autant) fonctionnent ; **On Air, horaires fixes, bilan d'émission et main courante ne sont pas touchés** ; pas de pointage par l'automation. Fin : « Arrêter la répétition » (écran ou poste), ou automatiquement au début d'une émission (fenêtre) ou à l'allumage du On Air. | Répétition sans horloge propre (heures de l'émission réelle : écarts dénués de sens hors horaire). |
| 18 | **Résultat** | Fiche « Répétition du 3/11 à 10:12 » rattachée au conducteur : durée mesurée par élément, total, écart avec la fin imposée. Bouton « **Reprendre les durées mesurées** » dans l'éditeur (cases à cocher élément par élément, droits d'écriture habituels, enregistrement normal avec version). **5 dernières** répétitions conservées par conducteur. | Pas de reprise des durées (on recopie à la main). |

### 6. Bilan d'émission

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 19 | **Contenu** | Page **Bilan** d'un conducteur (lien depuis le conducteur, la page Régie et la liste du jour) : pour chaque élément, **heure prévue, heure réelle, écart, durée prévue, durée réelle, écart de durée**, « non pointé » ou « ajouté / retiré en direct » ; totaux, fin prévue / réelle / imposée ; puis la **main courante** de l'émission (étape 10, déjà filtrée) à la suite. Prévu = conducteur **à la fin** du déroulé (modifications en direct comprises, signalées). Visible avec les droits de lecture du conducteur, et par les réalisateurs. | Prévu = conducteur au démarrage (plus « honnête », mais deux plans différents entre l'écran et le bilan). |
| 20 | **Impression et conservation** | **Impression / PDF** par la même mécanique que le conducteur (étape 5) : bilan + main courante. Les heures réelles sont **conservées avec le conducteur** (supprimées avec lui à la sortie de corbeille) ; le contenu des éléments est figé dans le déroulé (titres, types, durées) pour qu'une modification ultérieure du conducteur ne change pas un bilan clos. | Bilan calculé à la volée depuis le journal `prompter.sent` (pas de table, mais faux dès que le conducteur est modifié après coup, et pas de pointage par l'automation). |

### Paramètres

| # | Sujet | Proposition | Alternative |
|---|---|---|---|
| 21 | **Suivi du temps** | Paramètres → **Suivi du temps** : seuils de retard (orange 30 s, rouge 2 min), alerte de fin de séquence (15 s), alertes de fin imposée (5 min, 1 min), « À l'heure » (5 s), répétition depuis l'écran studio (oui / non). Paramètres → **Horaires fixes** (décision 8). | Seuils fixes dans le code (contraire au §10). |

## Serveur

- **Migration 12** (nouvelle entrée) : `rundowns.end_time` et `rundown_templates.end_time` (texte, null) ; table `rundown_runs` (conducteur, studio, répétition 0 / 1, début, fin, heure de référence, contenu figé du conducteur en JSON) ; table `rundown_run_items` (déroulé, `item_uid`, heure réelle de début et de fin, origine : écran / poste / automation). Aucune table existante recréée.
- **Commun** (`packages/shared`) :
  - `timing.ts` : `nextFixedTime`, `sequenceTimer`, `rundownDrift`, `backtime`, `runReport` (lignes du bilan), en fonctions pures testées ;
  - schémas : horaires fixes, paramètres de suivi du temps, `endTime` (conducteur, modèle), répétition ; état antenne complété par `run` (conducteur, répétition, début, élément en cours et son heure réelle, heures réelles des éléments passés).
- **Service `RunService`** : démarrage / reprise / clôture des déroulés, pointage à chaque changement d'élément de l'écran studio (branché sur `sendToPrompter`), pointage des titres par l'automation (décision 3), clôture automatique (minuterie), répétitions (refus si On Air ou émission en cours), état antenne, journal.
- **Routes** : `POST /api/rehearsal` et `DELETE /api/rehearsal` (session ou écran si autorisé), `POST /api/runs/:id/close` (propriétaire, réalisateur, admin), `GET /api/rundowns/:id/report`, `GET /api/rundowns/:id/rehearsals`. `endTime` dans les routes conducteur et modèle existantes.
- **Journal** : nouvelles actions au catalogue — `run.started`, `run.closed` (catégorie `antenne`), `rehearsal.started`, `rehearsal.stopped` (catégorie `antenne`, exclues de la main courante).

## Interface

- **Écran studio** : bande de temps (décisions 5 à 7) ; heures réelles et recalculées dans la vue conducteur ; « Répéter » / « Arrêter la répétition » (appui long) ; mention « RÉPÉTITION ». Poids de `/studio` à vérifier (calculs dans `packages/shared`, déjà importé).
- **Éditeur de conducteur et de modèle** : heure de fin imposée, ligne « à caser / à couper » (décision 14), « Reprendre les durées mesurées » ; impression complétée.
- **Page Bilan** (`/rundowns/:id/report`) et son impression ; liens depuis le conducteur et la page Régie (« Clore l'émission »).
- **Paramètres** : sections Horaires fixes et Suivi du temps.
- **Textes** : FR et EN. README (suivi du temps, bilan, répétition) et captures (écran studio avec la bande de temps en retard et fin imposée ; bilan ; éditeur avec fin imposée), données de démonstration complétées dans `scripts/captures.ts`.

## Changements à risque

- **Écriture depuis le kiosk** : démarrer / arrêter une répétition (décision 16), tracée, désactivable, refusée pendant une émission ou On Air allumé. À écarter si l'écran doit rester limité au choix de l'affichage, au On Air et au « Vu ».
- **Pointage automatique** (décision 3) : lecture seule de l'état antenne déjà reçu de l'automation ; aucune nouvelle connexion ni exposition réseau.
- Aucune nouvelle exposition réseau, aucune donnée supprimée (nouvelles colonnes facultatives, nouvelles tables).

## Hors périmètre de l'étape 11

- Part de chansons francophones et quotas Arcom (idée 21, non validée).
- Pointage manuel « fait » d'un élément (idée 20, non validée) : le pointage par l'écran et l'automation en couvre une partie.
- Statistiques sur plusieurs émissions (moyennes de retard, durées habituelles par type).
- Émission passant minuit avec heure de fin imposée ; plusieurs studios.
- Position de lecture RadioDJ (pause, avance) : limite connue du §6, le minuteur d'un titre peut donc être faux jusqu'au titre suivant.

## Tests prévus

- **Commun** : `nextFixedTime` (heures choisies, jours, fuseau, changement d'heure, minuit), `sequenceTimer` (reste, dépassement, durée nulle), `rundownDrift` (avance, retard, dépassement en cours, élément sauté, modification en direct), `backtime` (à caser, à couper, « couper les éléments marqués suffit »), `runReport` (non pointé, ajouté / retiré, préparation avant l'heure de début) ; schémas (`endTime` après le début, horaires fixes, seuils).
- **Serveur** : démarrage automatique et reprise du déroulé, un seul déroulé actif, clôture automatique et manuelle (droits), pointage par l'écran, par un poste et par l'automation (correspondance artiste + titre, source hors direct ignorée), répétition (refus On Air / émission en cours, kiosk autorisé / refusé, arrêt automatique, 5 dernières conservées, rien dans la main courante), bilan figé après modification du conducteur, migration 12 (conducteurs et modèles existants sans fin imposée), `endTime` repris par modèle et duplication.
- **Bout en bout (Playwright)** : horaire fixe approchant (orange puis rouge, horloge du serveur avancée) ; élément dépassé → minuteur rouge et retard qui grandit ; fin imposée → « à couper » ; répétition lancée sur l'écran (mention, heures recalculées, On Air intact) ; bilan après une émission (heures réelles, main courante jointe, page imprimable).

## Vérifications préalables

- Décisions 3 (pointage des titres par l'automation) et 16 (répétition lancée depuis l'écran studio, désactivable) : validées.
- À voir avec la station (non bloquant) : liste réelle des horaires fixes (top horaire, flashs, relais réseau), émissions à heure de fin imposée.
- Lisibilité de la bande de temps à 1,5–2 m : à vérifier sur l'afficheur réel après réalisation (`docs/a-faire.md`).

## Bilan de l'étape 11

### Réalisé

- **Commun** (`packages/shared`) :
  - `tracking.ts` : horaires fixes (20 au plus : libellé, minute, heures, jours, prévenance, actif ; deux exemples inactifs), seuils du suivi du temps, heure de fin imposée (`endTime`, après le début, même jour), types du déroulé (`RunState`, passages, lignes du bilan, répétitions) ;
  - `timing.ts`, fonctions pures testées : `nextFixedTime` (fuseau de la station, passage de minuit, changement d'heure), `runPlannedStarts`, `currentPassage`, `sequenceTimer`, `rundownDrift`, `backtime` (à caser / à couper, « couper les éléments marqués suffit »), niveaux d'alerte (`driftLevel`, `sequenceLevel`, `endLevel`, `balanceLevel`, `fixedTimeLevel`), `runReport`, `plannedBalance`, `cuttableSeconds`, `formatSigned` ;
  - état antenne complété par `run` (déroulé en cours) ; paramètres `fixedTimes` et `timeTracking` ; 4 actions au catalogue du journal (`run.started`, `run.closed`, `rehearsal.started`, `rehearsal.stopped`, catégorie `antenne`, répétitions exclues de la main courante).
- **Serveur** :
  - **migration 12** : `end_time` sur les conducteurs et les modèles, tables `rundown_runs` (déroulé, conducteur figé) et `rundown_run_items` (heure réelle de chaque élément, origine écran / automation) ;
  - fin imposée reprise par la duplication, « Enregistrer comme modèle », la création depuis un modèle et « Réappliquer le modèle » ; refus `end_before_start` ;
  - `RunService` : démarrage du déroulé à l'affichage d'un élément pendant l'émission (début − 10 min → fin + 10 min), pointage du premier passage seulement, préparation avant l'heure de début comptée à l'heure de début, sortie de l'écran (fin du dernier élément), pointage des titres par l'automation (artiste + titre sans casse ni accents, source du direct seulement), conducteur modifié en direct (éléments retirés après passage gardés pour le bilan), clôture automatique (autre conducteur, fin + 30 min) et manuelle ; répétition (refusée pendant une émission ou On Air allumé, arrêtée à l'allumage du On Air ou au début d'une émission, 4 h au plus, 5 dernières conservées) ;
  - routes `POST` / `DELETE /api/rehearsal` (comptes, et écran studio si autorisé), `POST /api/runs/:id/close` (propriétaire, réalisateur, admin), `GET /api/rundowns/:id/report` (bilan et main courante), `GET /api/rundowns/:id/rehearsals`.
- **Interface** :
  - écran studio : **bande de temps** (`TimingBand`) sous le bandeau, dans les trois dispositions : minuteur de séquence (orange en fin, rouge « +0:12 » en dépassement, chronomètre si durée nulle, masqué pour un titre pointé par l'automation), avance / retard (« À l'heure » sous le seuil, l'avance jamais en alerte), fin imposée (reste, « à caser » / « à couper », rouge à moins de 5 min), horaire fixe ; mention « RÉPÉTITION » et arrêt par appui long ; heure réelle / recalculée sous l'heure prévue dans la vue conducteur ; bouton « Répéter » (appui long) sur un conducteur ; horaire fixe sur l'écran de veille ;
  - éditeur de conducteur et de modèle : fin imposée, ligne « fin calculée · fin imposée · à caser / à couper » et durée des éléments à couper (aussi à l'impression), « Répéter sur l'écran studio », durées mesurées en répétition à reprendre (cases à cocher), lien « Bilan » ;
  - page **Bilan** (`/rundowns/:id/report`), imprimable : début / fins prévue, réelle, imposée, une ligne par élément (prévu, réel, écart, durées, non pointé, ajouté / retiré en direct, pointé par l'automation), main courante ; « Clore l'émission » (aussi sur la page Régie) ;
  - paramètres : sections **Horaires fixes** et **Suivi du temps** ; journal : nouvelles actions traduites ;
  - textes FR et EN ; README (statut, fonctionnalités, section 11, sécurité, captures `studio-suivi-temps.png` et `bilan.png`, fin imposée visible sur `conducteur.png`).

### Tests

- 334 tests unitaires (+43), dont :
  - commun (26) : horaires fixes (schéma, prévenance, « maintenant » 10 s, heures, minute, jours, minuit, changement d'heure, niveaux), seuils, fin imposée (conducteur, modèle, écart, à couper), déroulé (heures prévues, élément en cours, minuteur, retard avec dépassement, élément sauté, modification en direct, niveaux, format signé), backtiming (avant le début, à caser, à couper, éléments marqués, éléments passés), bilan (prévu / réel, ajouté, retiré, non pointé, déroulé en cours) ;
  - serveur (17) : fin imposée (conducteur, duplication, modèle, création), démarrage et préparation, premier passage, sortie et retour, pointage par l'automation et bascule active, modification en direct, conducteur suivant et non-réouverture, clôture automatique et manuelle (droits), bilan figé et main courante jointe, kiosk refusé sur le bilan, répétition (lancement depuis l'écran, durées mesurées, 5 conservées, absente du bilan et de la main courante, refus On Air / émission, arrêt à l'allumage et au début d'une émission, désactivable), migration 12.
- **Bout en bout (Chromium)**, 5 nouveaux scénarios : horaire fixe (veille puis bande), répétition lancée et arrêtée par appui long sur l'écran, émission en retard (minuteur dépassé, retard rouge, fin imposée, « à couper »), heures réelles dans la vue conducteur, bilan (non pointé, clôture, fin imposée dans l'éditeur). Les 28 scénarios passent.
- **Poids de `/studio`** : +6,1 Ko gzip (113,6 → 119,7 Ko, même méthode avant / après : entrée, mise en page racine et page, imports statiques), dont une partie de textes (dictionnaire FR + EN commun à toutes les pages) ; toujours sans l'éditeur.

### Écarts et limites connues

- **Calculs dans `timing.ts`, schémas et types dans `tracking.ts`** (nouveau module, comme `regie.ts`), pour ne pas mêler validation et calculs purs.
- **Pointage par l'écran** : seul le premier passage d'un élément compte (revenir relire un élément ne change rien) ; l'élément en cours est le dernier pointé. Un élément jamais affiché reste « non pointé ».
- **Fin du dernier élément** : à la sortie de l'écran du conducteur (retour à la liste ou autre affichage), sinon à la clôture.
- **Pas de déroulé sans affichage** : une émission dont l'écran studio n'affiche aucun élément n'a pas de bilan (le On Air seul ne démarre rien).
- **Élément retiré pendant qu'il est en cours** : minuteur et retard disparaissent jusqu'au passage suivant ; dans le bilan, les éléments retirés après passage sont listés à la fin.
- **Pointage par l'automation** : premier élément non encore pointé qui a le même artiste et le même titre ; les titres doivent être saisis comme dans RadioDJ (le choix dans la bibliothèque RadioDJ, étape 7, le garantit). Limite du §6 inchangée (pause / avance dans RadioDJ non répercutées).
- **Script modifié pendant l'émission** : la durée prévue d'un élément calculée depuis son script suit au prochain enregistrement du conducteur.
- **Répétition** : un affichage d'un autre conducteur pendant une répétition est ignoré ; horaires fixes masqués pendant une répétition ; arrêt automatique au bout de 4 h.
- **Main courante du bilan** : fenêtre de l'étape 10 étendue au déroulé réel ; visible de tous les comptes qui lisent le conducteur (décision 19), pas de l'écran studio. Les entrées « Envoi au prompteur » restent affichées avec leurs détails bruts (comme à l'étape 10).
- À vérifier à la mise en service : lisibilité de la bande de temps à 1,5–2 m, seuils, liste des horaires fixes (`docs/a-faire.md`).

