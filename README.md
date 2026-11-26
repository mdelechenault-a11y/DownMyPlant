# DownMyPlant

Application web (PWA) pour reconnaître ses plantes, les ajouter à son parc et
obtenir un diagnostic de leur état avec des conseils d'entretien.
Pensée pour l'iPhone via « Sur l'écran d'accueil », sans App Store ni compte développeur Apple.

## Fonctionnalités

- **Identifier** : photo (appareil photo ou photothèque) → espèce probable via
  [Pl@ntNet](https://my.plantnet.org/) (top 5 avec score de confiance, noms en français).
- **Mon parc** : ajout de la plante avec photo, surnom, espèce, emplacement, notes.
  Tout est stocké **sur l'appareil** (IndexedDB).
- **Journal par plante** : arrosages, engrais, rempotages, notes datées et photos de suivi,
  dans une chronologie avec les diagnostics. La fiche affiche « arrosée il y a X jours »,
  le rythme moyen d'arrosage, et signale quand un arrosage est peut-être dû.
- **Diagnostic à la demande** : une photo + ce que vous avez remarqué → état général,
  problèmes repérés (manque d'eau, excès d'eau, lumière, parasites, jaunissement…),
  actions conseillées, arrosage et exposition. Utilise le petit modèle vision
  `claude-haiku-5-5` d'Anthropic. Historique des diagnostics conservé par plante.
- **Sauvegarde** : export / import du parc (photos comprises) en fichier JSON.
- Fonctionne hors connexion pour consulter le parc (service worker).

## Coûts

| Service | Usage | Prix |
| --- | --- | --- |
| Pl@ntNet | Identification | Gratuit (500 identifications / jour) |
| Anthropic (Claude Haiku 5.5) | Diagnostic, uniquement quand vous le lancez | ≈ 0,1 à 0,3 centime par diagnostic |
| GitHub Pages | Hébergement | Gratuit (dépôt public) |

Les photos sont réduites à 1280 px avant envoi, ce qui limite les données et le coût.
Quelques diagnostics par semaine reviennent à quelques centimes par mois.

## Mise en route

### 1. Activer GitHub Pages

1. Sur GitHub, ouvrez le dépôt → **Settings** → **Pages**.
2. *Source* : **Deploy from a branch**, branche **main**, dossier **/ (root)** → **Save**.
3. Après une minute, l'app est en ligne sur
   `https://mdelechenault-a11y.github.io/DownMyPlant/` (l'adresse exacte s'affiche sur la page Pages).

### 2. Obtenir la clé Pl@ntNet (gratuite)

1. Créez un compte sur <https://my.plantnet.org/> puis connectez-vous.
2. Dans **Settings / API key**, copiez votre clé.
3. **Important (CORS)** : dans la même page, ajoutez le domaine
   `mdelechenault-a11y.github.io` aux **domaines autorisés** (« Authorized domains »).
   Sans cela, le navigateur bloque l'appel et l'app affiche « Impossible de joindre Pl@ntNet ».

### 3. Obtenir la clé Anthropic (pour le diagnostic)

1. Créez un compte sur <https://console.anthropic.com/>.
2. **Billing** : ajoutez un petit crédit (5 € suffisent pour des centaines de diagnostics).
   Vous pouvez aussi fixer une limite de dépense mensuelle dans **Limits**.
3. **API Keys** → **Create Key**, copiez la clé (`sk-ant-…`).

### 4. Installer sur l'iPhone

1. Ouvrez l'adresse GitHub Pages dans **Safari**.
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Lancez DownMyPlant depuis l'icône, allez dans **Réglages**, collez les deux clés, **Enregistrer**.

## Sécurité des clés

Les clés sont saisies dans l'app et stockées **uniquement sur votre appareil**
(stockage local du navigateur). Elles partent directement du téléphone vers Pl@ntNet et Anthropic.
C'est adapté à un usage personnel. Pour partager l'app avec d'autres personnes sans leur
donner vos clés, il faudrait ajouter un petit proxy (par exemple un
[Cloudflare Worker](https://workers.cloudflare.com/) gratuit) qui garde les clés côté serveur
et relaie les appels ; l'app appellerait alors le Worker au lieu des API.

Conseils : fixez une limite de dépense sur la console Anthropic, et révoquez la clé
si vous perdez le téléphone.

## Données

- Les plantes, photos et diagnostics sont dans IndexedDB, sur l'appareil.
  Rien n'est stocké sur un serveur.
- Supprimer l'icône de l'écran d'accueil ou les données de Safari efface le parc :
  utilisez **Réglages → Exporter** de temps en temps.

## Structure

```
index.html              page unique
styles.css              styles (thème clair / sombre)
manifest.webmanifest    manifeste PWA (nom, icônes, mode plein écran)
sw.js                   service worker (cache hors connexion)
js/app.js               écrans et navigation
js/db.js                stockage IndexedDB
js/journal.js           journal de suivi (événements, statistiques d'arrosage)
js/plantnet.js          appel Pl@ntNet
js/diagnose.js          diagnostic via Claude (prompt + schéma JSON de réponse)
js/image.js             compression des photos
js/settings.js          clés API locales
vendor/anthropic-sdk.js SDK officiel @anthropic-ai/sdk 1.7.0, regroupé en un fichier ESM
icons/                  icônes de l'app
```

Aucune étape de build : ce sont des fichiers statiques.
Pour tester en local : `python3 -m http.server 8000` puis <http://localhost:8000>.

### Publier une mise à jour

Modifiez `VERSION` dans `sw.js` (ex. `dmp-v2`) pour que les téléphones récupèrent
les nouveaux fichiers. Sur iPhone, fermez puis rouvrez l'app (parfois deux fois).

### Régénérer le SDK embarqué

```bash
npm i @anthropic-ai/sdk@1.7.0 esbuild
echo 'export { default as Anthropic } from "@anthropic-ai/sdk";' > entry.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --outfile=vendor/anthropic-sdk.js
```
