# Cadrage technique RadioDJ (préalable à l'étape 7)

> **Statut : constats vérifiés sur une installation de test, aucun développement.**
> Référence : `CLAUDE.md` §6 (intégrations RadioDJ), §8 étape 7. Sert de base au futur `docs/plan-etape-7.md`.
> Version testée : **RadioDJ 3.0.0.5**, base **MariaDB 11.4** (`radiodj3`). Tests faits en octobre 2026.

## En bref

L'export Web du plugin n'envoie que `Artiste - Titre`. Il sert donc de **signal** (« un titre vient de démarrer »). Les données, elles, sont lues **en base, en lecture seule** : `history`, `songs`, `queuelist`. La base n'est plus un repli, elle est **indispensable** à 5 des 6 fonctionnalités de l'étape 7.

RadioDJ refuse le certificat HTTPS d'OnAir-Desk : le signal arrive donc sur un **port HTTP dédié aux connecteurs**, avec le jeton dans le champ Password du plugin.

## 1. Plugin « Metadata Export » (ex « Now Playing Info »)

En v3, le plugin s'appelle **Metadata Export** (fenêtre « Now Playing Info Exporter »). Il est livré avec RadioDJ et s'active dans Options → Plugins.

| Onglet | Rôle | Pour OnAir-Desk |
|---|---|---|
| Custom Title | Remplace le titre par un texte fixe | Laisser **vide** (titre automatique), encodage UTF8 |
| File | Écrit un fichier à partir d'un modèle (`NowPlaying.txt`, modèle `$autotitle$`) | Non utilisé. Personne ne lit ce fichier aujourd'hui. |
| **Web** | Requête HTTP à chaque titre | **Voie retenue**, comme signal |
| Streaming Server | Titre vers Icecast / Shoutcast | Non (relève de l'étape 8 si besoin) |
| Network | UDP / TCP brut à partir d'un modèle | Non : pas d'authentification possible |
| Serial | Liaison série | Non |
| Filters | Types de piste exportés | Voir plus bas |
| Advanced | Alterne le titre avec un autre texte | **Laisser désactivé** : enverrait de faux titres |

### Comportement constaté de l'export Web (3.0.0.5)

Testé avec un récepteur HTTP qui répond `200`.

| Point | Constat |
|---|---|
| Contenu envoyé, **Custom Data vide** | Formulaire encodé correctement : `title=<Artiste - Titre>` (ex. `title=C%C3%A9sar%20-%20Libert%C3%A0`) |
| Contenu envoyé, Custom Data remplie | `Artiste - Titre` en texte brut UTF-8 **non encodé**, malgré l'en-tête `Content-Type: application/x-www-form-urlencoded; charset=utf-8` |
| Custom Data | **Ignorée**, en POST comme en GET (elle ne fait que casser l'encodage) |
| Variables dans l'URL | **Non remplacées** (`$track_id$` arrive tel quel) |
| Password | Envoyé **dans le corps**, champ `xpwd`, **seulement si la Custom Data est vide** : `xpwd=test1234&title=C%C3%A9sar%20-%20Libert%C3%A0` |
| POST | URL intacte, données dans le corps |
| GET | RadioDJ ajoute `?<titre>` à l'URL, **même si elle contient déjà un `?`** |
| Chemin | Arrive intact (`/test/abc123`) |
| Répétition | Une seule requête par titre, pas de nouvel essai |
| En-têtes | `User-Agent: http_requester/0.1`, `Expect: 100-continue` (géré nativement par Node.js) |

Réglage retenu dans RadioDJ (onglet Web) : URL `http://<serveur>:<port-connecteurs>/api/connectors/radiodj`, **Password = jeton**, **Custom Data vide**, méthode **POST**.

Conséquences pour le connecteur :
- jeton lu dans le champ **`xpwd`** du corps : il n'apparaît pas dans l'URL ni dans les journaux ;
- corps lu comme un formulaire encodé (`xpwd`, `title`) ;
- le titre ne sert qu'en **mode dégradé** (base injoignable) : affiché sans temps restant. On ne le découpe pas sur ` - ` pour en tirer des données fiables.

Si une version future de RadioDJ honore la Custom Data, on pourra l'exploiter. Rien ne doit en dépendre.

### HTTPS : refusé par RadioDJ

Tests avec le certificat interne d'OnAir-Desk (ECDSA P-256, adresse IP dans le certificat), autorité installée dans les magasins « Utilisateur actuel » **et** « Ordinateur local », RadioDJ redémarré. Chrome et Edge acceptent ce certificat ; RadioDJ non :

| Configuration du serveur | Résultat |
|---|---|
| Défaut (TLS 1.3) | Rien n'arrive au serveur |
| TLS 1.2, AES-GCM | Négociation faite, puis `decryption failed or bad record mac` |
| TLS 1.2, AES-CBC | Négociation faite, puis **alerte TLS 42 « bad certificate » envoyée par RadioDJ** |

RadioDJ refuse donc le certificat lui-même. Causes non tranchées (abandonnées, jugées trop coûteuses à creuser) : clé ECDSA, adresse IP au lieu d'un nom DNS, ou vérification de révocation (l'autorité interne ne publie pas de liste de révocation).

**Décision de l'utilisateur : port HTTP dédié aux connecteurs**, comme envisagé dans `docs/plan-etape-1.md`. Le risque est faible, car la requête n'est qu'un signal : une fausse requête ne provoque qu'une relecture de la base. Conditions à détailler dans le plan de l'étape 7 :
- **désactivé par défaut**, activé par l'admin ;
- n'expose **que** les routes d'entrée des connecteurs, jamais l'interface ni les sessions ;
- **réseau interne uniquement** ;
- jeton dans `xpwd`. Il circule en clair sur le réseau local, et le titre affiché en mode dégradé pourrait être falsifié depuis ce réseau : limites acceptées.

C'est un **changement à risque d'exposition réseau** (`CLAUDE.md` §9).

### Filtres (types de piste)

Les numéros correspondent à la colonne `song_type` de la base : 0 Music, 1 Jingle, 2 Sweeper, 3 Voiceover, 4 Commercial, 5 InternetStream, 6 Other, 7 VDF, 8 Podcast, 9 Request, 10 News, 11 PlaylistEvent, 12 FileByDate, 13 NewestFromFolder, 14 Teaser.

Option retenue : **exporter presque tout** et laisser OnAir-Desk trier selon le type lu en base. Sinon, pendant une pub non exportée, l'écran garderait le titre précédent avec un compte à rebours faux. Laisser **Voiceover** (joué par-dessus un titre) et **PlaylistEvent** (pas de l'audio) décochés. Laisser aussi **Sweeper** décoché : un sweeper posé sur un titre déclenche un second signal juste après celui du titre, sans rien apporter. Le réglage exact sera fixé dans le plan de l'étape 7.

## 2. Base MariaDB, en lecture seule

Tables présentes : `carts`, `carts_list`, `category`, `events`, `events_categories`, `genre`, `history`, `playlists`, `playlists_list`, `queuelist`, `requests`, `rotations`, `rotations_list`, `settings`, `songs`, `subcategory`, `users`.

### `history` : titre en cours

- Une ligne est écrite **au démarrage** de chaque titre : `trackID`, `date_played`, `song_type`, `duration`, `artist`, `title`, `album`…
- Vérifié : *Summertime* a démarré à 15:11:46, avant son `ETA` (15:12:20), parce que le titre précédent a été coupé. `history` reflète donc ce qui passe réellement.
- ⚠️ **Les habillages ont aussi leur ligne.** Un sweeper posé sur un titre est inscrit avec son propre `song_type` (2), **dans la même seconde** que le titre et **juste après lui** (ID plus grand). Le titre en cours est donc la dernière ligne **qui n'est pas un habillage** (Sweeper 2, Voiceover 3), et non la dernière ligne tout court.
- Délai entre le signal et l'écriture : le signal et `date_played` tombent dans la même seconde. Prévoir quand même une relecture après un court délai si la ligne n'est pas encore là.

### `songs.cue_times` : repères

Chaîne de clés et de valeurs, en secondes depuis le début du fichier, par exemple :
`&sta=0.33&int=4.37&out=161.41&xta=164.32&end=164.62&fin=0&fou=0.29`

| Clé | Signification probable | Usage |
|---|---|---|
| `sta` | Début de lecture (cue in) | Point zéro du temps écoulé |
| `int` | Fin de l'intro | Talk-over (7.5) |
| `out` | Début de l'outro | Repère outro (7.4) |
| `xta` | Point de mix : le titre suivant démarre | **Moment du « À vous »** de l'alerte de fin (7.3) |
| `end` | Fin de lecture (cue out) | — |
| `fin` / `fou` | Durée du fondu d'entrée / de sortie | — |

- Les clés présentes varient d'un titre à l'autre : sur 3 titres testés, **un seul** avait un `int`. Sans repère, l'écran n'affiche pas de compte à rebours d'intro, plutôt qu'un chiffre faux. Marquer les intros est un travail de saisie côté station.
- L'alerte de fin doit viser `xta` et non la durée totale (jusqu'à 1,2 s d'écart constaté).
- Lien avec les autres tables : `history.trackID` = `queuelist.songID` = `songs.ID`.

### `songs.year` : année

- Vérifié sur la base de la station : `varchar(4)`, `NOT NULL`, **défaut `1900`**. `1900` veut donc dire « non renseignée » : l'année n'est reprise dans un conducteur que si elle est lisible et postérieure à 1900.

### `queuelist` : titres à venir

- Colonnes : `ID`, `songID`, `ETA`, `duration`, `artist`, `associated_artists`, `title`, `album`, `swID`, `swPlay`, `vtID`, `vtPlay`.
- **Tenue à jour en temps réel** (la question ouverte du §6 est réglée) et **sans le titre en cours** : un titre sort de la table quand il démarre.
- **Les `ID` sont renumérotés** à chaque réécriture : s'appuyer sur l'ordre et le `songID`, jamais sur `ID`.
- `ETA` est calculée par RadioDJ. Elle s'est révélée exacte en lecture normale (15:10:01 annoncée, 15:10:01 dans `history`), mais elle **n'est pas recalculée** quand on avance ou recule dans le titre en cours (constaté le 24/10/2026, voir § 4).
- `swID` / `vtID` : ID (`songs.ID`) du sweeper ou du voicetrack posé par-dessus le titre. Vu : `swID = 50` (un jingle), `swPlay = -20` ; sans voicetrack, `vtID = 0` et `vtPlay = -100` ; sans sweeper, `swID = -100`. Le sens de `swPlay` n'est pas établi : avec `-20`, le sweeper est parti au **début** du titre.
- La base ne prévient de rien : relire la file **à chaque signal** et **périodiquement** (quelques secondes), car l'animateur peut modifier la playlist sans changer de titre.

## 3. Répartition des fonctionnalités de l'étape 7

| Fonctionnalité | Source |
|---|---|
| 7.1 Titre en cours | Signal du plugin + `history` |
| 7.2 Titre à venir et heure de démarrage | `queuelist` (+ `songs.cue_times`) |
| 7.3 Alerte fin de titre | `history` + `songs.cue_times` (`xta`) |
| 7.4 Repères intro / outro | `songs.cue_times` |
| 7.5 Talk-over | `songs.cue_times` (`int`), quand il est renseigné |
| 7.6 Titres dans les conducteurs | `songs` / `queuelist` |

Heure de démarrage du titre suivant : la calculer dans `packages/shared` (heure de début reçue + `xta` − `sta`), sur l'horloge du serveur. `ETA` sert de contrôle. Cela répond à la question laissée ouverte au §5 : on tient compte du mix.

## 4. Points de vigilance

- **Horloge** : `date_played` et `ETA` sont à l'heure du PC RadioDJ, alors que la référence est le serveur. Un **NTP sur le PC RadioDJ** est indispensable si on s'en sert.
- **Exposition de MariaDB** (changement à risque) : l'ouvrir au réseau uniquement pour l'IP du serveur Debian (pare-feu Windows et compte SQL), avec un compte **`SELECT` seul** :
  ```sql
  CREATE USER 'onairdesk'@'<ip-du-debian>' IDENTIFIED BY '<mot-de-passe-fort>';
  GRANT SELECT ON radiodj3.* TO 'onairdesk'@'<ip-du-debian>';
  ```
  À restreindre ensuite aux tables utiles (`history`, `songs`, `queuelist`). Mot de passe en variable d'environnement, jamais en dur.
- **Port HTTP dédié aux connecteurs** (changement à risque) : voir « HTTPS : refusé par RadioDJ » plus haut.
- **Jeton** : transmis dans le champ `xpwd`. Il ne doit apparaître ni dans les journaux ni dans les traces d'audit.
- **Position de lecture inconnue** (limite acceptée, constatée le 24/10/2026) : si l'on avance, recule ou met en pause le titre en cours depuis RadioDJ, OnAir-Desk n'en est pas informé.
  - La base ne contient pas la position de lecture, et `queuelist.ETA` n'est pas recalculée après un déplacement dans le titre (requête relancée avant et après une avance de 30 s : même valeur).
  - Aucun plugin installé ne l'expose (liste en 5.0.0.0 : Aux Players, Folder Sync, History, Instant Players, Metadata Export, Playlist, Playlist Builder, Search, Song Details, Audio Processing, Tracks Manager, Utilities) : pas de serveur REST.
  - Conséquence : temps restant, alerte de fin, talk-over et heure de démarrage du titre suivant sont faux **jusqu'au titre suivant**, où le signal et `history` recalent tout.
  - Recalage manuel depuis la régie écarté (manipulation de plus en plein direct). Piste pour plus tard : un **plugin RadioDJ maison** (C#), dans un **projet à part**, qui enverrait position et état lecture / pause sur le port des connecteurs (idée non validée, `CLAUDE.md` §7).

## 5. Reste à vérifier

- Sens exact de `swPlay` / `vtPlay`, et comportement avec un **voicetrack** (non testé).
- Délai réel entre le signal du plugin et l'écriture dans `history`, à mesurer avec le vrai connecteur.

## Annexe : récepteur de test

Pour rejouer les tests sans le serveur OnAir-Desk : un petit serveur Node.js qui affiche chaque requête et répond `200`, lancé dans un conteneur jetable.

```powershell
docker run --rm -it -p 8099:8099 -v "${PWD}:/app:ro" node:24-alpine node /app/echo-radiodj.js
```

```js
// Récepteur de test pour l'export Web de RadioDJ : affiche chaque requête et répond 200.
const http = require('node:http');

const decode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const [path, ...query] = req.url.split('?');
      const time = new Date().toLocaleTimeString('fr-FR');

      console.log(`\n=== ${time}  ${req.method} ${path}  (depuis ${req.socket.remoteAddress})`);
      if (query.length) console.log(`  Query   : ${decode(query.join('?'))}`);
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        console.log(`  En-tête : ${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      console.log(`  Corps   : ${Buffer.byteLength(body)} octets`);
      if (body) {
        console.log(`  Brut    : ${body}`);
        console.log(`  Décodé  : ${decode(body)}`);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
  })
  .listen(8099, '0.0.0.0', () => console.log('En écoute sur le port 8099 (Ctrl+C pour arrêter)'));
```

Dans RadioDJ (onglet Web) : URL `http://127.0.0.1:8099/test`, méthode POST, cocher l'Enable de la ligne, ➕, l'Enable du bas, puis Save. Supprimer la ligne après le test.
