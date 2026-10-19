// Offline cache: network first (always the latest build when online), cached copy when offline.
const CACHE = 'bomblast-v42';
const ASSETS = ['./', './index.html', './js/worlds.js', './js/levels.js', './js/board.js', './js/board3d.js', './js/fx3d.js', './js/chars3d.js', './models/bomber-animado.glb', './vendor/loaders/GLTFLoader.js', './vendor/utils/BufferGeometryUtils.js', './vendor/three.module.min.js', './vendor/postprocessing/EffectComposer.js', './vendor/postprocessing/RenderPass.js', './vendor/postprocessing/ShaderPass.js', './vendor/postprocessing/MaskPass.js', './vendor/postprocessing/Pass.js', './vendor/postprocessing/UnrealBloomPass.js', './vendor/postprocessing/OutputPass.js', './vendor/shaders/CopyShader.js', './vendor/shaders/LuminosityHighPassShader.js', './vendor/shaders/OutputShader.js', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  // one missing file (e.g. a host that won't serve .glb) must not block installing the update
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
