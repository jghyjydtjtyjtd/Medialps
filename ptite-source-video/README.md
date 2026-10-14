# La P'tite Source Vidéo

Application web du webjournal **La P'tite Source** : on colle le lien de partage d'une vidéo Google Drive et on obtient une vraie page vidéo avec un lien court (`https://votre-domaine/v/aB12xY`), un QR code et un code d'intégration pour les articles.

---

## 1. Ce que fait (et ne fait pas) l'application

| Fait | Ne fait pas |
|---|---|
| Valide le lien côté serveur et extrait l'identifiant du fichier | Ne rend **jamais** un fichier public : l'application n'a aucun droit sur Drive |
| Vérifie si le fichier est accessible et s'il s'agit d'une vidéo | Ne télécharge pas, ne copie pas et ne ré-héberge pas la vidéo |
| Lit la vidéo avec le **lecteur officiel Google Drive** (`/file/d/ID/preview`) en iframe | Ne contourne pas les quotas ni les autorisations de Google |
| Crée une page dédiée, un identifiant court unique et un QR code | Ne supprime jamais le fichier Drive (supprimer une page ne touche que l'application) |

### Limites de Google Drive (à connaître)

- Le fichier doit être partagé en **« Tous les utilisateurs disposant du lien » → Lecteur**. Sinon, le visiteur voit un écran de connexion Google dans le lecteur.
- Juste après un dépôt, Drive **prépare** la vidéo (de quelques minutes à plus pour les longues vidéos) : le lecteur affiche « traitement en cours ».
- Google peut **limiter** temporairement un fichier très consulté, et certains réseaux d'établissement filtrent Drive.
- Le contenu de l'iframe Google est inaccessible au site (sécurité navigateur) : l'application ne peut pas détecter en direct une erreur *à l'intérieur* du lecteur. C'est pourquoi elle vérifie le fichier côté serveur (à la création, à la demande et périodiquement) et affiche une aide « La vidéo ne se lance pas ? ».
- Pour un usage intensif ou une fiabilité supérieure, un hébergeur vidéo dédié est préférable : l'architecture le permet (voir §6).

---

## 2. Architecture

- **Node.js 20+ / Express 5** : rendu HTML côté serveur (pas de framework frontend, pages rapides et accessibles), un petit fichier JS d'amélioration progressive.
- **SQLite** (better-sqlite3, mode WAL) : base persistante dans un seul fichier, à placer sur un volume persistant.
- **Authentification** : comptes en base, mots de passe hachés avec bcrypt, session dans un cookie signé `HttpOnly` / `SameSite=Lax` / `Secure` en production, jeton CSRF sur tous les formulaires, limitation des tentatives de connexion, sessions invalidées au changement de mot de passe.
- **QR codes** : générés à la volée (PNG jusqu'à 2048 px pour l'impression, SVG vectoriel) à partir de l'URL courte actuelle.
- **Sécurité** : en-têtes Helmet (CSP stricte, `frame-src` limité à Google Drive, `frame-ancestors 'none'` sauf pour le lecteur intégrable), échappement automatique de tout contenu affiché, aucune redirection vers une URL fournie par un visiteur, protection contre les redirections ouvertes, requêtes préparées SQL.
- **Anti-SSRF** : le serveur ne contacte **jamais** l'URL collée. Il en extrait un identifiant (`[A-Za-z0-9_-]{20,100}`), puis construit lui-même l'adresse de vérification vers deux hôtes fixes (`drive.google.com`, `www.googleapis.com`), en HTTPS, sans suivre les redirections, avec délai maximal et taille de réponse limitée.

```
src/
  server.js              démarrage, création du 1er admin, planificateur
  app.js                 Express, sécurité, sessions, erreurs
  config.js              variables d'environnement
  db.js                  schéma SQLite, migrations, dépôt (vidéos, alias, utilisateurs)
  providers/
    index.js             registre des hébergeurs + états de disponibilité
    googleDrive.js       analyse des liens, lecteur, vérification (anti-SSRF)
  services/availability.js   vérifications et revérification périodique
  routes/public.js       accueil, création, /v/:slug, QR, /e/:slug
  routes/admin.js        connexion, tableau de bord, gestion des vidéos, compte
  views/                 gabarits HTML (échappement automatique)
  lib/                   html, slug, qr, security
public/                  CSS, JS, favicon
scripts/create-admin.js  création / réinitialisation d'un compte
test/                    tests automatisés (node:test + supertest)
```

### Routes

| Route | Rôle |
|---|---|
| `/` | Accueil : champ « Transformer mon lien » |
| `/nouveau?lien=…` | Vérification du lien + formulaire titre/description (réservé à la rédaction par défaut) |
| `/v/:slug` | Page vidéo publique (404 si non publiée, sauf pour la rédaction) |
| `/v/:slug/qr.png`, `/v/:slug/qr.svg` | QR code (`?taille=1024&telecharger=1`) |
| `/e/:slug` | Lecteur seul, à intégrer en iframe dans un article |
| `/admin` | Tableau de bord (recherche, filtres, états) |
| `/healthz` | Sonde de santé |

### Base de données (table `videos`)

`id` (interne), `provider`, `source_id` (identifiant Google Drive), `source_key` (resourcekey éventuelle), `source_url`, `slug` (unique, insensible à la casse), `title`, `description`, `published`, `availability`, `availability_detail`, `mime_type`, `last_checked_at`, `created_at`, `updated_at`, `created_by`.
Table `slug_aliases` : quand on change un identifiant court, l'ancien redirige (301) vers le nouveau — les QR codes déjà imprimés continuent de fonctionner. Table `users` : comptes de la rédaction.

### États de disponibilité

| État | Signification | Lecteur affiché ? |
|---|---|---|
| `available` | Fichier public reconnu comme vidéo | oui |
| `unverified` | Fichier public mais type non confirmé (vérification sans clé API) | oui, avec aide |
| `private` | Accès refusé / connexion Google demandée | non → message + solution |
| `not_found` | Supprimé, dans la corbeille ou lien erroné | non |
| `not_video` | PDF, image, document… | non |
| `quota` | Google limite temporairement | oui, avec aide |
| `error` | Google injoignable | oui, avec aide |

Une vidéo privée peut être enregistrée par la rédaction, mais **uniquement en brouillon**.

---

## 3. Installation locale

Prérequis : **Node.js 20 ou plus récent**.

```bash
npm install
cp .env.example .env          # facultatif en local
npm run create-admin          # crée votre compte (identifiant + mot de passe ≥ 10 caractères)
npm start                     # http://localhost:3000
```

En développement, `SESSION_SECRET` et `PUBLIC_BASE_URL` ont des valeurs par défaut. Les variables d'environnement peuvent être passées directement : `PORT=4000 npm start`. (Le fichier `.env` n'est pas lu automatiquement par `npm start` ; il l'est par Docker Compose. Avec Node 20.6+ vous pouvez aussi lancer `node --env-file=.env src/server.js`.)

Tests : `npm test`.

---

## 4. Configuration

| Variable | Obligatoire | Rôle |
|---|---|---|
| `NODE_ENV=production` | prod | Active cookies `Secure`, HSTS, contrôles stricts |
| `PUBLIC_BASE_URL` | prod | URL exacte du site, utilisée pour les liens et QR codes (ne se fie jamais à l'en-tête `Host`) |
| `SESSION_SECRET` | prod | Clé de signature des sessions — `openssl rand -hex 32` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 1er démarrage | Crée le premier compte si la base n'en contient aucun |
| `DATABASE_PATH` | non | Fichier SQLite (défaut `./data/videos.db`) — **doit être sur un disque persistant** |
| `GOOGLE_API_KEY` | non | Vérification fiable du type MIME via l'API Drive (voir §5) |
| `PUBLIC_SUBMISSIONS` | non | `true` = les visiteurs peuvent créer des pages sans compte (limité à 20 vérifications / 10 min / IP) |
| `AUTO_PUBLISH` | non | Publication immédiate des pages créées par les visiteurs |
| `CHECK_INTERVAL_HOURS` | non | Revérification automatique (défaut 24 h, 0 = désactivé) |
| `EMBED_ALLOWED_ORIGINS` | non | Sites autorisés à intégrer `/e/:slug` (défaut `*`) — ex. `https://laptitesource.fr` |
| `TRUST_PROXY` | non | Nombre de proxys inverses (défaut 1 en production) |

Comptes supplémentaires ou mot de passe oublié : `npm run create-admin -- nom` (en Docker : `docker compose exec app node scripts/create-admin.js nom`).

---

## 5. Clé API Google (facultative mais recommandée)

Sans clé, l'application vérifie la page publique du fichier : elle détecte de façon fiable « privé » et « introuvable », mais le **type** du fichier n'est déduit que de son nom (état « non confirmée » sinon). Avec une clé, elle interroge l'API Drive v3 et obtient le type MIME exact.

Aucun OAuth n'est nécessaire : l'application ne lit que les métadonnées de fichiers déjà publics.

1. Ouvrez <https://console.cloud.google.com/> et créez un projet (ex. « ptite-source-video »).
2. **API et services → Bibliothèque** → recherchez **Google Drive API** → **Activer**.
3. **API et services → Identifiants → Créer des identifiants → Clé API**.
4. Cliquez sur la clé pour la **restreindre** :
   - *Restrictions relatives aux API* : cochez uniquement **Google Drive API** ;
   - *Restrictions relatives aux applications* : **Adresses IP** → l'adresse IP publique de votre serveur.
5. Placez la valeur dans `GOOGLE_API_KEY` (variable d'environnement serveur — jamais dans le code frontend) et redémarrez.

Au démarrage, le journal indique « Vérification via l'API Google Drive (clé configurée) ». Si la clé est refusée ou l'API désactivée, l'application bascule sur la vérification simplifiée et l'indique dans le détail de l'état.

---

## 6. Ajouter un autre hébergeur vidéo plus tard

Chaque hébergeur est un module de `src/providers/` exposant la même interface : `parse(url)`, `embedUrl(video)`, `openUrl(video)`, `thumbnailUrl(video)`, `createChecker()`. La base stocke déjà `provider` + `source_id` + `source_key`. Pour ajouter par exemple PeerTube, Vimeo ou un MP4 sur un stockage objet : créer le module, l'enregistrer dans `src/providers/index.js`, et brancher la détection du type de lien dans le formulaire de création. Les pages, les liens courts, les QR codes et l'administration ne changent pas.

---

## 7. Déploiement

L'application a besoin d'un **processus Node permanent** et d'un **disque persistant** pour SQLite. Les plateformes « serverless » sans disque (Vercel, Netlify Functions…) ne conviennent pas : la base serait perdue.

### Option A — VPS avec Docker (recommandé)

```bash
git clone <votre-dépôt> ptite-source-video && cd ptite-source-video
cp .env.example .env
nano .env    # PUBLIC_BASE_URL, SESSION_SECRET (openssl rand -hex 32), ADMIN_USERNAME, ADMIN_PASSWORD
docker compose up -d --build
docker compose logs -f app     # vérifiez « Compte administrateur … créé »
```

Puis retirez `ADMIN_PASSWORD` de `.env` et relancez `docker compose up -d`. La base est dans le volume `ptite-source-data` : elle survit aux redémarrages et aux mises à jour (`git pull && docker compose up -d --build`).

HTTPS avec **Caddy** (certificat automatique) — `/etc/caddy/Caddyfile` :

```
video.laptitesource.fr {
    reverse_proxy 127.0.0.1:3000
}
```

Sauvegarde : `docker compose exec app node -e "require('better-sqlite3')('/data/videos.db').backup('/data/sauvegarde.db')"` puis copiez le fichier hors du serveur (ou sauvegardez le volume).

### Option B — PaaS avec volume (Render, Railway, Fly.io…)

- Déployez avec le `Dockerfile` fourni.
- Attachez un **disque / volume persistant** monté sur `/data` (sur Render, un disque persistant nécessite une offre payante ; l'offre gratuite efface les fichiers).
- Variables : `NODE_ENV=production`, `PUBLIC_BASE_URL`, `SESSION_SECRET`, `DATABASE_PATH=/data/videos.db`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (à retirer ensuite).
- Sonde de santé : `/healthz`.
- Une seule instance (SQLite).

### Option C — Serveur sans Docker

```bash
npm ci --omit=dev
NODE_ENV=production PUBLIC_BASE_URL=https://… SESSION_SECRET=… DATABASE_PATH=/var/lib/ptite-source/videos.db npm start
```
Gérez le processus avec systemd ou pm2, derrière un proxy HTTPS.

---

## 8. Utilisation dans La P'tite Source

1. Dans Google Drive : clic droit sur la vidéo → **Partager** → *Accès général* : **Tous les utilisateurs disposant du lien** (Lecteur) → **Copier le lien**.
2. Sur le site : collez le lien → **Transformer mon lien** → vérifiez l'état et l'aperçu → titre, description → **Créer la page vidéo**.
3. Diffusez :
   - **lien court** : bouton « Copier le lien » ;
   - **QR code** : PNG 1024 px pour l'impression, SVG pour la mise en page ;
   - **intégration** dans un article : bouton « Intégrer » → code `<iframe>` vers `/e/:slug` (si votre outil de publication accepte les blocs HTML). Restreignez les sites autorisés avec `EMBED_ALLOWED_ORIGINS`.

---

## 9. Tests

`npm test` lance 68 tests (node:test + supertest), base en mémoire, **vérificateur Google simulé** :

- validation et extraction : 19 formats de liens acceptés, resourcekey, liens mal formés, autres domaines, sous-domaines piégés, ports, identifiants dans l'URL, dossiers, documents Google, identifiants altérés ;
- vérification de disponibilité (réponses Google simulées) : vidéo, en traitement, non-vidéo, corbeille, privé, introuvable, quota, clé invalide, délai dépassé, protection SSRF ;
- identifiants courts : unicité sur 2 000 créations, collisions forcées, casse, mots réservés, changement avec alias et conflits ;
- persistance après fermeture/réouverture de la base ;
- pages vidéo : publiée, inexistante, non publiée (public vs rédaction), vidéos inaccessibles, échappement XSS, redirections d'anciens identifiants ;
- QR codes : PNG décodé et comparé à l'URL courte, SVG, téléchargement, tailles bornées, QR qui suit un changement d'identifiant ;
- administration : accès refusé sans connexion (GET et POST), CSRF, connexion, limitation des tentatives, redirection ouverte, recherche/filtres, édition, publication, suppression sans appel à Drive, changement de mot de passe ;
- en-têtes de sécurité et règles d'intégration.

**Non testé automatiquement** : les réponses réelles des serveurs Google (l'environnement de développement n'avait pas d'accès réseau à Google) et le rendu du lecteur Drive dans l'iframe. Le `Dockerfile` n'a pas pu être construit dans cet environnement (pas de démon Docker) : `docker compose up -d --build` reste à valider sur votre serveur. Faites un essai réel après déploiement avec : une vidéo publique, une vidéo privée, un fichier supprimé et un PDF, et vérifiez l'état affiché pour chacun. Si Google modifie ses pages, la vérification sans clé peut dériver ; la vérification avec clé API repose sur une API documentée et stable.
