// Service worker : l'app s'ouvre même hors connexion.
// À chaque mise en ligne : augmenter VERSION (même valeur que js/version.js).
const VERSION = '1.6.1';
const CACHE = `dmp-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/settings.js',
  'js/image.js',
  'js/plantnet.js',
  'js/diagnose.js',
  'js/journal.js',
  'js/version.js',
  'js/ui.js',
  'js/rooms.js',
  'js/light.js',
  'rooms.css',
  'fonts/fraunces.woff2',
  'fonts/fraunces-italic.woff2',
  'fonts/nunito-sans.woff2',
  'fonts/nunito-sans-italic.woff2',
  'vendor/anthropic-sdk.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Fichiers de l'app : réseau d'abord (pour recevoir les mises à jour), cache en secours.
// Les appels aux API (Pl@ntNet, Anthropic) ne passent pas par le cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    // no-cache : on revalide toujours auprès du serveur (évite le cache HTTP de 10 min de GitHub Pages).
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

// L'app peut demander la version du service worker installé.
self.addEventListener('message', (event) => {
  if (event.data === 'get-version' && event.ports[0]) event.ports[0].postMessage(VERSION);
});
