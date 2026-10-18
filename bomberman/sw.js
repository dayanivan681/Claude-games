// Offline cache: serve from cache instantly, refresh in the background (stale-while-revalidate).
const CACHE = 'bomblast-v23';
const ASSETS = ['./', './index.html', './js/worlds.js', './js/levels.js', './js/board.js', './js/board3d.js', './js/fx3d.js', './js/chars3d.js', './models/bomber-animado.glb', './vendor/loaders/GLTFLoader.js', './vendor/utils/BufferGeometryUtils.js', './vendor/three.module.min.js', './vendor/postprocessing/EffectComposer.js', './vendor/postprocessing/RenderPass.js', './vendor/postprocessing/ShaderPass.js', './vendor/postprocessing/MaskPass.js', './vendor/postprocessing/Pass.js', './vendor/postprocessing/UnrealBloomPass.js', './vendor/postprocessing/OutputPass.js', './vendor/shaders/CopyShader.js', './vendor/shaders/LuminosityHighPassShader.js', './vendor/shaders/OutputShader.js', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
