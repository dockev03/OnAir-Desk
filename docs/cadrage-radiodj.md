# Cadrage technique RadioDJ (préalable à l'étape 7)

> **Statut : constats vérifiés sur une installation de test, aucun développement.**
> Référence : `CLAUDE.md` §6 (intégrations RadioDJ), §8 étape 7. Sert de base au futur `docs/plan-etape-7.md`.
> Version testée : **RadioDJ 3.0.0.5**, base **MariaDB 11.4** (`radiodj3`). Tests faits en octobre 2026.

## En bref

L'export Web du plugin n'envoie que `Artiste - Titre`. Il sert donc de **signal** (« un titre vient de démarrer »). Les données, elles, sont lues **en base, en lecture seule** : `history`, `songs`, `queuelist`. La base n'est plus un repli, elle est **indispensable** à 5 des 6 fonctionnalités de l'étape 7.

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
| Contenu envoyé | Toujours `Artiste - Titre` (`$autotitle$`), en texte brut UTF-8 **non encodé**, malgré l'en-tête `Content-Type: application/x-www-form-urlencoded; charset=utf-8` |
| Custom Data | **Ignorée**, en POST comme en GET |
| Variables dans l'URL | **Non remplacées** (`$track_id$` arrive tel quel) |
| Password | **Envoyé nulle part** (ni en-tête, ni corps) |
| POST | URL intacte, titre dans le corps |
| GET | RadioDJ ajoute `?<titre>` à l'URL, **même si elle contient déjà un `?`** |
| Chemin | Arrive intact (`/test/abc123`) |
| Répétition | Une seule requête par titre, pas de nouvel essai |
| En-têtes | `User-Agent: http_requester/0.1`, `Expect: 100-continue` (géré nativement par Node.js) |

Conséquences pour le connecteur :
- méthode **POST** ;
- jeton **dans le chemin** (`/api/connectors/radiodj/<jeton>`), à **masquer dans les journaux** du serveur ;
- corps lu **en texte brut**, jamais avec le lecteur de formulaires (un titre contenant `&`, `=` ou `+` serait mal découpé) ;
- le corps ne sert qu'en **mode dégradé** (base injoignable) : titre affiché sans temps restant. On ne le découpe pas sur ` - ` pour en tirer des données fiables.

Si une version future de RadioDJ honore la Custom Data, on pourra l'exploiter. Rien ne doit en dépendre.

### Filtres (types de piste)

Les numéros correspondent à la colonne `song_type` de la base : 0 Music, 1 Jingle, 2 Sweeper, 3 Voiceover, 4 Commercial, 5 InternetStream, 6 Other, 7 VDF, 8 Podcast, 9 Request, 10 News, 11 PlaylistEvent, 12 FileByDate, 13 NewestFromFolder, 14 Teaser.

Option retenue : **exporter presque tout** et laisser OnAir-Desk trier selon le type lu en base. Sinon, pendant une pub non exportée, l'écran garderait le titre précédent avec un compte à rebours faux. Laisser **Voiceover** (joué par-dessus un titre) et **PlaylistEvent** (pas de l'audio) décochés. Le réglage exact sera fixé dans le plan de l'étape 7.

## 2. Base MariaDB, en lecture seule

Tables présentes : `carts`, `carts_list`, `category`, `events`, `events_categories`, `genre`, `history`, `playlists`, `playlists_list`, `queuelist`, `requests`, `rotations`, `rotations_list`, `settings`, `songs`, `subcategory`, `users`.

### `history` : titre en cours

- Une ligne est écrite **au démarrage** de chaque titre : `trackID`, `date_played`, `song_type`, `duration`, `artist`, `title`, `album`…
- Vérifié : *Summertime* a démarré à 15:11:46, avant son `ETA` (15:12:20), parce que le titre précédent a été coupé. `history` reflète donc ce qui passe réellement.
- Prévoir un **court délai** : le signal du plugin peut arriver avant l'écriture de la ligne.

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

### `queuelist` : titres à venir

- Colonnes : `ID`, `songID`, `ETA`, `duration`, `artist`, `associated_artists`, `title`, `album`, `swID`, `swPlay`, `vtID`, `vtPlay`.
- **Tenue à jour en temps réel** (la question ouverte du §6 est réglée) et **sans le titre en cours** : un titre sort de la table quand il démarre.
- **Les `ID` sont renumérotés** à chaque réécriture : s'appuyer sur l'ordre et le `songID`, jamais sur `ID`.
- `ETA` est calculée par RadioDJ et recalculée en continu. Elle s'est révélée exacte (15:10:01 annoncée, 15:10:01 dans `history`).
- `swID` / `vtID` : sweeper ou voicetrack posé par-dessus le titre (`-100` et `0` vus quand il n'y en a pas, à confirmer).
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
- **Jeton dans l'URL** : seul moyen d'authentifier le plugin. Il ne doit apparaître ni dans les journaux ni dans les traces d'audit.

## 5. Reste à vérifier

- **HTTPS** : le plugin accepte-t-il une URL `https://` avec le certificat interne d'OnAir-Desk (avec et sans le certificat racine installé sur le PC RadioDJ) ? À tester contre le vrai serveur. Sinon : port HTTP dédié aux connecteurs, désactivé par défaut (voir `docs/plan-etape-1.md`).
- Signification exacte de `swID = -100` et du comportement avec un sweeper ou un voicetrack.
- Délai réel entre le signal du plugin et l'écriture dans `history`.

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
