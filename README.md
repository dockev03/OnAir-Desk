# OnAir-Desk

Écran studio pour radios, affiché dans un navigateur en mode kiosk, sur l'afficheur de votre choix : prompteur, conducteurs d'émission colorés, horloge à la seconde, titre en cours et à venir (depuis l'automation, RadioDJ en premier), météo et voyant On Air.

**Statut : étapes 1 (socle), 2 (scripts), 3 (écran studio) et 4 (conducteurs) réalisées.**

- Comptes, écrans kiosk, paramètres de la station, HTTPS, horloge synchronisée sur le serveur.
- Scripts : éditeur de texte enrichi avec repères, bibliothèque et dossiers, recherche, corbeille, historique, envoi au prompteur.
- Écran studio : navigation dans les dossiers à la souris, mode lecture avec bande de lecture, défilement molette ou automatique, Précédent / Suivant.

Les conducteurs et les intégrations (RadioDJ, On Air, météo) arrivent aux étapes suivantes (voir [`CLAUDE.md`](CLAUDE.md) §8).

- [`CLAUDE.md`](CLAUDE.md) : cahier des charges et décisions (fait foi).
- [`docs/plan-etape-1.md`](docs/plan-etape-1.md), [`docs/plan-etape-2.md`](docs/plan-etape-2.md), [`docs/plan-etape-3.md`](docs/plan-etape-3.md) : plans et bilans des étapes.
- [`docs/maquette-ecran-studio-v3.html`](docs/maquette-ecran-studio-v3.html) : maquette de l'écran studio (à ouvrir dans un navigateur).

---

## Installation (Debian + Docker + Portainer)

L'image est construite par Portainer directement depuis ce dépôt : aucun registre n'est nécessaire.

### 1. Jeton GitHub en lecture seule

Le dépôt étant privé, Portainer a besoin d'un accès en lecture :

1. GitHub → _Settings_ → _Developer settings_ → _Personal access tokens_ → **Fine-grained tokens** → _Generate new token_.
2. _Repository access_ : **Only select repositories** → `OnAir-Desk`.
3. _Permissions_ : **Contents : Read-only** (rien d'autre).
4. Choisir une **date d'expiration**, générer, copier le jeton.

Ce jeton n'est saisi que dans Portainer. Il ne doit jamais être écrit dans le dépôt.

### 2. Stack Portainer

_Stacks_ → _Add stack_ → **Repository** :

| Champ                | Valeur                                              |
| -------------------- | --------------------------------------------------- |
| Name                 | `onair-desk`                                        |
| Repository URL       | `https://github.com/dockev03/OnAir-Desk`            |
| Repository reference | `refs/heads/main` (ou la branche à déployer)        |
| Compose path         | `docker-compose.yml`                                |
| Authentication       | activée : votre nom d'utilisateur GitHub + le jeton |

Puis, dans _Environment variables_, renseigner au minimum `PUBLIC_ORIGIN` (voir [`.env.example`](.env.example)) :

| Variable        | Exemple                                       | Rôle                                                                          |
| --------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN` | `https://onair-desk.lan,https://192.168.1.20` | **Obligatoire.** Toutes les adresses utilisées par l'afficheur et les postes. |
| `TLS_HOSTNAMES` | _(vide)_                                      | Noms et IP du certificat ; par défaut ceux de `PUBLIC_ORIGIN`.                |
| `HOST_PORT`     | `443`                                         | Port publié sur la Debian.                                                    |
| `TZ`            | `Europe/Paris`                                | Fuseau du conteneur.                                                          |

_Deploy the stack_. La première construction prend quelques minutes.

### 3. Premier lancement

1. Portainer → _Containers_ → `onair-desk` → **Logs** : repérer le bloc « premier lancement » et son **code d'installation**.
2. Ouvrir `https://<adresse>/setup` (le navigateur signale un certificat inconnu : c'est normal tant que le certificat racine n'est pas installé, voir ci-dessous).
3. Saisir le code, le nom de la station, puis créer le compte administrateur.

Tant que l'installation n'est pas faite, un nouveau code est généré à chaque redémarrage. Une fois l'admin créé, la page d'installation est fermée définitivement.

### 4. Certificat racine (HTTPS)

OnAir-Desk crée sa propre autorité de certification au premier démarrage. Pour que les navigateurs lui fassent confiance, installez **une fois** son certificat racine sur chaque appareil. Il est téléchargeable à la fin de l'installation, ou dans _Paramètres_ (`https://<adresse>/api/tls/root-ca.crt`).

- **Windows** : double-clic sur `onair-desk-root-ca.crt` → _Installer le certificat_ → _Ordinateur local_ → _Placer tous les certificats dans le magasin suivant_ → **Autorités de certification racines de confiance**. Chrome et Edge l'utilisent aussitôt.
- **Linux (Debian, Ubuntu…)** (système) :
  ```bash
  sudo cp onair-desk-root-ca.crt /usr/local/share/ca-certificates/onair-desk.crt
  sudo update-ca-certificates
  ```
  Chromium sous Linux utilise en plus sa propre base (paquet `libnss3-tools`) :
  ```bash
  certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "OnAir-Desk" -i onair-desk-root-ca.crt
  ```
- **Firefox** : _Paramètres_ → _Vie privée et sécurité_ → _Certificats_ → _Afficher les certificats_ → _Autorités_ → _Importer_.

Le certificat serveur est renouvelé automatiquement ; la racine, valable 10 ans, ne change pas. Si vous ajoutez une adresse dans `PUBLIC_ORIGIN`, un nouveau certificat serveur est émis au redémarrage, sans rien réinstaller sur les postes.

Pour utiliser un certificat existant de la station, voir les lignes `TLS_CERT_FILE` / `TLS_KEY_FILE` commentées dans [`docker-compose.yml`](docker-compose.yml).

### 5. Écran studio (kiosk)

1. _Administration_ → **Écrans studio** → _Ajouter un écran_.
2. Copier l'adresse affichée (`https://<adresse>/studio#token=…`). **Elle n'est montrée qu'une fois.**
3. Sur l'afficheur, ouvrir cette adresse dans un navigateur en mode kiosk (par exemple Chromium avec `--kiosk`). Le matériel est au choix de la station. Le jeton, placé après le `#`, n'est jamais envoyé au serveur dans l'URL : la page l'échange contre un cookie sécurisé, puis le retire de la barre d'adresse.

Sur l'écran, tout se fait à la souris : choisir un dossier puis un script ouvre le **mode lecture** (molette, bouton **Auto**, vitesse −/+, taille A−/A+, Précédent / Suivant). Pour sortir, **maintenir** le bouton « Sortir » une seconde.

L'écran est en **lecture seule**, à une exception près : il peut choisir le script affiché. Il peut être **révoqué** (déconnexion immédiate) ou recevoir un **nouveau jeton** depuis la même page.

### Mise à jour

Portainer → _Stacks_ → `onair-desk` → **Pull and redeploy**. Les données restent dans le volume `onair-desk-data`. Avant d'appliquer une migration de base, le serveur en fait une copie dans `/data/backups/` (5 dernières conservées).

### Sauvegarde

Tout est dans le volume `onair-desk-data` : base SQLite, autorité de certification, sauvegardes automatiques. Arrêter la stack le temps de la copie, puis :

```bash
docker run --rm -v onair-desk_onair-desk-data:/data:ro -v "$PWD":/backup debian:trixie-slim \
  tar czf /backup/onair-desk-$(date +%F).tgz -C /data .
```

Le nom exact du volume est visible dans Portainer → _Volumes_. **La sauvegarde contient la clé privée de l'autorité de certification** : la conserver en lieu sûr.

---

## Sécurité

- **Réseau interne uniquement** : ne jamais publier le port d'OnAir-Desk sur Internet.
- **HTTPS obligatoire** en production (le serveur refuse de démarrer en HTTP).
- Mots de passe hachés en **Argon2id** ; sessions et jetons d'écran stockés **hachés** ; cookies `httpOnly`, `Secure`, `SameSite=Strict`.
- Protection **CSRF** (vérification de l'en-tête `Origin`), politique **CSP** stricte, limitation des tentatives de connexion.
- Conteneur durci : utilisateur non-root, système de fichiers en lecture seule (sauf `/data`), aucune capacité Linux, `no-new-privileges`.
- Journal des actions sensibles (connexions, comptes, écrans) dans la table `audit_log`.
- L'afficheur en kiosk ouvre une session sans intervention : il doit rester dans le studio, sur un réseau maîtrisé.

---

## Développement

Prérequis : Node.js 22 ou 24, et **npm 11.21.1** (utilisé pour le fichier de verrouillage et l'autorisation des scripts d'installation, champ `allowScripts`).

```bash
npx npm@11.21.1 install      # dépendances
npm run dev:server           # API sur http://localhost:8443 (HTTP en développement, données dans ./data)
npm run dev:web              # interface sur http://localhost:5173 (relaie /api vers le serveur)
```

Le code d'installation s'affiche dans le terminal du serveur.

| Commande            | Rôle                                            |
| ------------------- | ----------------------------------------------- |
| `npm run lint`      | ESLint + Prettier                               |
| `npm run typecheck` | TypeScript (serveur, interface, paquet partagé) |
| `npm test`          | Tests (Vitest)                                  |
| `npm run build`     | Construction de l'interface puis du serveur     |

### Organisation

```
apps/server     API Fastify (REST + WebSocket), HTTPS, SQLite ; sert aussi l'interface compilée
apps/web        Interface SvelteKit compilée en fichiers statiques (FR / EN)
packages/shared Schémas de validation et types communs
```

La CI GitHub Actions lance lint, typecheck, tests, build et construction de l'image Docker sur chaque push.

## Licence

À définir (dépôt privé en attendant).
