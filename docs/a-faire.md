# Reste à faire hors développement

> Vérifications, tests et décisions en attente qui **ne bloquent pas** les étapes suivantes.
> Cocher au fur et à mesure ; un écart constaté donne une branche `fix/…`.
> Dernière mise à jour : après l'étape 11.

## 1. Vérifications sur l'installation réelle

### AzuraCast (étape 8, `docs/plan-etape-8.md`)

- [ ] **Capture `nowplaying` pendant un direct RadioDJ** : vérifier que `live.is_live` passe à `true`, voir `streamer_name`, et ce que montrent `now_playing` (titre de l'encodeur, durée) et `playing_next`. La bascule automatique en dépend ; sinon, repli sur la bascule forcée.
- [ ] **Publication SSE au changement de titre**, sur le bon canal (`station:vichyradio`, pas `station:1`) : laisser tourner jusqu'au titre suivant et vérifier qu'une ligne `{"pub": …}` arrive.
  ```bash
  curl -sN "https://<adresse>/api/live/nowplaying/sse?cf_connect=%7B%22subs%22%3A%7B%22station%3Avichyradio%22%3A%7B%7D%7D%7D"
  ```
- [ ] **Retard réel du flux** (environ 10 s estimé) : le mesurer au studio et le régler dans Paramètres → AzuraCast.
- [ ] **Accès par clé API** : désactiver la page publique, vérifier qu'AzuraCast refuse sans clé et répond avec la clé d'un compte dédié **sans droit d'administration**.
- [ ] **Certificat** : installer un certificat Let's Encrypt sur AzuraCast (recommandé), ou fournir le certificat auto-signé via `AZURACAST_CA_FILE`.
- [ ] Renseigner l'**URL de base du site** dans AzuraCast (les adresses qu'il renvoie pointent vers `http://localhost:9080`) : sans effet sur OnAir-Desk, utile pour les auditeurs.

### RadioDJ (étape 7, `docs/plan-etape-7.md`, `docs/cadrage-radiodj.md` §5)

- [ ] Délai réel entre le signal du plugin et l'écriture dans `history`.
- [ ] Comportement avec un **voicetrack** (et sens exact de `swPlay` / `vtPlay`).
- [ ] Horloge du PC RadioDJ réglée par **NTP**.

### On Air et météo (étape 9, `docs/plan-etape-9.md`)

- [ ] Régler le bouton On Air du **Stream Deck** : plugin de requêtes HTTP (voie normale, avec affichage de l'état) ou action « Site web » (appel simple, à activer dans Paramètres).
- [ ] Vérifier ce que sait envoyer la **console** (requête `POST` avec en-tête, ou adresse seule).
- [ ] Ouvrir l'écoute des connecteurs (`CONNECTOR_HTTP_PORT`, `CONNECTOR_BIND`) si ce n'est pas déjà fait pour RadioDJ, puis générer le jeton On Air.
- [ ] Renseigner la **météo** (Open-Meteo, ville et coordonnées de la station) et les **cartes de liners** (les exemples fournis sont inactifs, à adapter).

### Régie (étape 10, `docs/plan-etape-10.md`)

- [ ] Donner le droit **Réalisateur** aux comptes concernés (_Comptes_) et choisir le poste de la régie.
- [ ] Relire et activer les **ordres rapides** (_Paramètres_ → Régie : proposés inactifs) ; régler la durée d'affichage des messages.
- [ ] Choisir la disposition **« Émission avec régie »** pour les émissions avec réalisateur (conducteur ou modèle).

### Suivi du temps (étape 11, `docs/plan-etape-11.md`)

- [ ] Saisir les **horaires fixes** réels (top horaire, flashs, relais réseau) : _Paramètres_ → Horaires fixes (exemples proposés inactifs).
- [ ] Renseigner la **fin imposée** des émissions concernées (journal, relais réseau), sur les modèles d'émission.
- [ ] Relire les **seuils** du suivi du temps (retard 30 s / 2 min, fin de séquence 15 s, fin imposée 5 / 1 min) avec les animateurs.
- [ ] Vérifier le **pointage des titres par RadioDJ** pendant un direct (titres choisis dans la bibliothèque RadioDJ, bascule sur la source du direct).
- [ ] Décider si la **répétition depuis l'écran studio** reste permise (_Paramètres_ → Suivi du temps).

### Écran studio

- [ ] **Tailles minimales** (heure, temps restant, alertes) vérifiées sur l'afficheur réel, à 1,5–2 m (`CLAUDE.md` §5).
- [ ] Veille, dispositions et décalage anti-usure regardés sur l'afficheur réel (lisibilité, aucun saut gênant pendant la lecture).
- [ ] Voyant ON AIR, chronomètre, météo et bande de liners lisibles à 1,5–2 m.
- [ ] Zone régie (message normal et urgent) et pastilles de duplex lisibles à 1,5–2 m ; agrandissement d'un urgent non gênant pendant la lecture.
- [ ] Bande de temps (minuteur, retard, fin imposée, horaire fixe) lisible à 1,5–2 m ; place restante pour le texte avec la zone régie et la bande de liners.

## 2. Décisions à prendre

- [ ] **Licence** : MIT ou AGPL (`CLAUDE.md` §11). Le dépôt reste privé d'ici là.
- [ ] **Marque « OnAir-Desk »** : disponibilité à vérifier (INPI, EUIPO) avant toute diffusion publique.
- [ ] **Certificat AzuraCast dans la stack Portainer** : le volume `/certs` est commenté dans `docker-compose.yml`, et une stack « Repository » ne se modifie pas sans changer le dépôt. Soit Let's Encrypt sur AzuraCast (rien à changer), soit rendre ce volume paramétrable par variable.
- [ ] **Idées non encore validées** (`CLAUDE.md` §7, n° 18 à 24) : fiches pratiques, contenus locaux, pointage « fait », quotas de chanson francophone, vigilance Météo-France, voyants micros invités, plugin RadioDJ maison.
- [ ] **Plugin RadioDJ maison** (projet à part) : préalable, vérifier qu'un kit de développement de plugins existe pour RadioDJ 3.0.0.5 et donne la position du lecteur.
- [ ] **Déclenchement matériel du On Air** (GPO de la console, GPIO, boîtier USB), si le bouton du Stream Deck ou de la console ne suffit pas : même API ; câblage avec optocoupleur ou relais, à confier à un technicien.
- [ ] **Alerte de micro ouvert trop longtemps** (seuil orange / rouge sur le chronomètre) : écartée à l'étape 9, à reprendre si le besoin apparaît.


## 3. Limites acceptées, améliorations possibles

Rien d'obligatoire : à reprendre si le besoin se confirme à l'usage.

- Position de lecture RadioDJ (avance, recul, pause) non répercutée jusqu'au titre suivant : voir le plugin maison ci-dessus.
- Heure de début d'un titre RadioDJ décalée d'une heure possible pendant l'heure répétée du passage à l'heure d'hiver (sans signal du plugin).
- Journal : filtres de dates en UTC (les actions sont traduites depuis l’étape 10).
- Simulateur : repart du premier titre après un redémarrage du serveur.
- AzuraCast : pas de talk-over (aucun repère intro / outro dans son API) ; en direct, titre de l'encodeur sans temps restant.
- « Clé acceptée » au test de connexion AzuraCast : une station publique répond même sans regarder la clé.
- Régie : renommer une ligne de duplex depuis la page Régie (l'API le permet déjà) ; main courante du seul studio par défaut.
- Bouton On Air de la barre de l'interface : toujours relu toutes les 15 s (la page Régie, elle, est en temps réel).
- Suivi du temps : seul le premier passage d'un élément compte ; pas de bilan pour une émission dont l'écran n'a affiché aucun élément ; durée d'un élément calculée depuis un script modifié en direct mise à jour au prochain enregistrement du conducteur ; détails bruts des « Envois au prompteur » dans la main courante.
- Idées non validées liées : pointage manuel « fait » (n° 20), part de chansons francophones (n° 21), statistiques sur plusieurs émissions.
