// ================= 3D board (WebGL · Three.js) =================
// Presentation only, like board.js: a lit 3D diorama of the arena built from the same world data
// (worlds.js) and level plan (levels.js). The game keeps every rule and still draws characters and effects in
// its 2D layer on top (bombs, blasts and power-ups go to the 3D layer in fx3d.js); project() tells it where each tile lands.
// The scene is re-rendered only when the board changes (a block breaks or falls), during those short
// animations, or on resize — an idle frame costs the GPU nothing.
//
// World space: one unit per tile; tile (x, y) covers x..x+1 and z = y..y+1; the floor's top is y = 0.
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';

// Soft focus: the arena stays sharp while the surroundings melt into a gentle blur (fake depth of field).
const FocusShader = {
  uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1, 1) }, rect: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, strength: { value: 3.5 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 texel; uniform vec4 rect; uniform float strength; varying vec2 vUv;
    void main() {
      vec2 d = abs(vUv - rect.xy) / rect.zw;
      float m = smoothstep(1.0, 1.45, max(d.x, d.y)) * strength;
      vec4 c = texture2D(tDiffuse, vUv);
      if (m > 0.05) {
        vec4 acc = c;
        for (int i = 0; i < 12; i++) { float a = float(i) * 2.39996; float r = sqrt(float(i) + 0.5) / 3.5; acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r * m * texel); }
        c = acc / 13.0;
      }
      gl_FragColor = c;
    }`,
};

const Board3D = (() => {
  let renderer = null, composer = null, bloom = null, focus = null, scene, camera, sun, fill, sky, canvas = null, onLost = null;
  let world = null, cfg = null, kit = null, worldGroup = null, levelGroup = null, plan = null;
  let soft = null, softAo = null, hardAo = null, pillars = null, dropping = null, prevGrid = null, lamps = [];
  let W = 1, H = 1, dirty = true, shakeCss = '';
  const VP = new THREE.Matrix4(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
  const kits = {};

  // ---------- helpers ----------
  const hsh = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function rng(seed) { let a = (seed * 2654435761) >>> 0 || 1; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; }; }
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lin = hex => new THREE.Color(hex);
  const mixC = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
  // Tileable value noise / fbm (period p lattice cells).
  function vnoise(x, y, p, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const g = (i, j) => hsh(((i % p) + p) % p, ((j % p) + p) % p, s);
    return (g(xi, yi) * (1 - u) + g(xi + 1, yi) * u) * (1 - v) + (g(xi, yi + 1) * (1 - u) + g(xi + 1, yi + 1) * u) * v;
  }
  function fbm(x, y, p, s, oct = 3) { let a = 0, amp = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { a += amp * vnoise(x * f, y * f, p * f, s + o * 17); n += amp; amp *= 0.5; f *= 2; } return a / n; }
  function cv(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }

  // ---------- procedural textures (albedo + height → normal map) ----------
  function tex(c, color, rep = 1) {
    const t = new THREE.CanvasTexture(c);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function normalFrom(hc, k) {
    const n = hc.width, src = hc.getContext('2d').getImageData(0, 0, n, n).data, out = cv(n), g = out.getContext('2d'), id = g.createImageData(n, n), d = id.data;
    const h = (x, y) => src[((((y + n) % n) * n) + ((x + n) % n)) * 4];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let nx = -(h(x + 1, y) - h(x - 1, y)) * k / 255, ny = (h(x, y + 1) - h(x, y - 1)) * k / 255, nz = 1;
      const l = Math.hypot(nx, ny, nz), i = (y * n + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (nz / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0); return out;
  }
  // pixel(u, v) → [r, g, b, height]; then optional canvas painting on top of both layers.
  function paint(n, pixel, strokes) {
    const a = cv(n), h = cv(n), ga = a.getContext('2d'), gh = h.getContext('2d'), ia = ga.createImageData(n, n), ih = gh.createImageData(n, n), o = [0, 0, 0, 0];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      pixel(x / n, y / n, o); const i = (y * n + x) * 4;
      ia.data[i] = o[0]; ia.data[i + 1] = o[1]; ia.data[i + 2] = o[2]; ia.data[i + 3] = 255;
      ih.data[i] = ih.data[i + 1] = ih.data[i + 2] = o[3]; ih.data[i + 3] = 255;
    }
    ga.putImageData(ia, 0, 0); gh.putImageData(ih, 0, 0);
    if (strokes) strokes(ga, gh, n);
    return [a, h];
  }
  const mix3 = (A, B, t, o) => { o[0] = A[0] + (B[0] - A[0]) * t; o[1] = A[1] + (B[1] - A[1]) * t; o[2] = A[2] + (B[2] - A[2]) * t; };
  function grassTex(f, v) {
    const lo = rgb('#3c7322'), hi = rgb('#78b845'), warm = rgb('#a9c94e');
    return paint(256, (u, w, o) => {
      const n = fbm(u * 4, w * 4, 4, 11 + v), m = fbm(u * 16, w * 16, 16, 5 + v, 2);
      mix3(lo, hi, n * 0.9 + m * 0.25, o); if (n > 0.62) mix3(o, warm, (n - 0.62) * 1.2, o);
      o[3] = 90 + m * 70;
    }, (ga, gh, n) => {
      const r = rng(31 + v * 7); ga.lineCap = gh.lineCap = 'round';
      for (let i = 0; i < 620; i++) {
        const x = r() * n, y = r() * n, a = r() * Math.PI * 2, l = 3 + r() * 6;
        ga.strokeStyle = r() < 0.35 ? '#2f5f1a' : f.blades[(r() * f.blades.length) | 0]; ga.globalAlpha = 0.8; ga.lineWidth = 1.4 + r();
        ga.beginPath(); ga.moveTo(x, y); ga.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ga.stroke();
        gh.strokeStyle = `rgb(${170 + r() * 80 | 0},0,0)`; gh.lineWidth = 1.6; gh.beginPath(); gh.moveTo(x, y); gh.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); gh.stroke();
      }
      ga.globalAlpha = 1;
      for (let i = 0; i < 5 + v; i++) {   // clover patches
        const cx = r() * n, cy = r() * n;
        for (let k = 0; k < 4; k++) {
          const ox = cx + (r() - 0.5) * 22, oy = cy + (r() - 0.5) * 22;
          for (let q = 0; q < 3; q++) { const aa = q * 2.1 + k; ga.fillStyle = f.clover[q === 2 ? 1 : 0]; ga.beginPath(); ga.arc(ox + Math.cos(aa) * 3.2, oy + Math.sin(aa) * 3.2, 3.4, 0, 7); ga.fill(); gh.fillStyle = '#d0d0d0'; gh.beginPath(); gh.arc(ox + Math.cos(aa) * 3.2, oy + Math.sin(aa) * 3.2, 3.4, 0, 7); gh.fill(); }
        }
      }
    });
  }
  function stoneTex(base, seed) {
    const lo = rgb(base[1]), hi = rgb(base[0]);
    return paint(256, (u, w, o) => {
      const n = fbm(u * 3, w * 3, 3, seed, 4), m = fbm(u * 14, w * 14, 14, seed + 9, 2), sp = hsh((u * 256) | 0, (w * 256) | 0, seed);
      mix3(lo, hi, n * 1.1 - 0.05 + (m - 0.5) * 0.3, o);
      if (sp > 0.985) { o[0] *= 0.7; o[1] *= 0.7; o[2] *= 0.7; } else if (sp < 0.012) { o[0] = Math.min(255, o[0] * 1.25); o[1] = Math.min(255, o[1] * 1.25); o[2] = Math.min(255, o[2] * 1.25); }
      o[3] = 120 + (n - 0.5) * 130 + (m - 0.5) * 70;
    }, (ga, gh, n) => {
      const r = rng(seed + 3); ga.lineCap = gh.lineCap = 'round'; ga.lineJoin = gh.lineJoin = 'round';
      for (let i = 0; i < 5; i++) {   // cracks
        let x = r() * n, y = r() * n, a = r() * 6.28; const pts = [[x, y]];
        for (let k = 0; k < 5; k++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * 11; y += Math.sin(a) * 11; pts.push([x, y]); }
        for (const [g, col, wdt] of [[ga, 'rgba(40,44,42,0.65)', 2], [gh, '#202020', 3]]) { g.strokeStyle = col; g.lineWidth = wdt; g.beginPath(); pts.forEach(([px, py], k) => k ? g.lineTo(px, py) : g.moveTo(px, py)); g.stroke(); }
        ga.strokeStyle = 'rgba(255,255,255,0.22)'; ga.lineWidth = 1; ga.beginPath(); pts.forEach(([px, py], k) => k ? ga.lineTo(px + 1.5, py + 1.5) : ga.moveTo(px + 1.5, py + 1.5)); ga.stroke();
      }
    });
  }
  function brickTex(b) {
    const rows = 4, per = 2, n = 256, cols = b.colors.map(rgb), mort = rgb(b.mortar);
    const [a, h] = paint(n, (u, w, o) => { const m = fbm(u * 8, w * 8, 8, 77, 2); o[0] = mort[0] * (0.82 + m * 0.25); o[1] = mort[1] * (0.82 + m * 0.25); o[2] = mort[2] * (0.82 + m * 0.25); o[3] = 30 + m * 30; });
    const ga = a.getContext('2d'), gh = h.getContext('2d'), rh = n / rows, bw = n / per, gap = 4, r = rng(5);
    for (let row = 0; row < rows; row++) for (let k = -1; k <= per; k++) {
      const x = (k + (row % 2 ? 0.5 : 0)) * bw + gap / 2, y = row * rh + gap / 2, w = bw - gap, hh = rh - gap, c = cols[(r() * cols.length) | 0], v = 0.9 + r() * 0.2;
      const g = ga.createLinearGradient(x, y, x + w * 0.3, y + hh);
      g.addColorStop(0, `rgb(${c.map(q => Math.min(255, q * v * 1.08) | 0).join(',')})`); g.addColorStop(1, `rgb(${c.map(q => q * v * 0.88 | 0).join(',')})`);
      ga.fillStyle = g; ga.beginPath(); ga.roundRect(x, y, w, hh, 5); ga.fill();
      for (let s2 = 0; s2 < 5; s2++) { gh.fillStyle = `rgb(${130 + s2 * 25},0,0)`; gh.beginPath(); gh.roundRect(x + s2 * 1.6, y + s2 * 1.6, w - s2 * 3.2, hh - s2 * 3.2, 5); gh.fill(); }
      ga.fillStyle = 'rgba(255,225,190,0.22)'; ga.fillRect(x + 5, y + 2, w - 10, 3);
      ga.fillStyle = 'rgba(70,20,4,0.25)'; ga.fillRect(x + 4, y + hh - 4, w - 8, 3);
      for (let p = 0; p < 14; p++) { const px = x + 4 + r() * (w - 8), py = y + 4 + r() * (hh - 8); ga.fillStyle = `rgba(${r() < 0.5 ? '90,30,8' : '255,210,170'},0.3)`; ga.beginPath(); ga.arc(px, py, 0.8 + r() * 1.4, 0, 7); ga.fill(); gh.fillStyle = '#808080'; gh.beginPath(); gh.arc(px, py, 1.2, 0, 7); gh.fill(); }
    }
    return [a, h];
  }
  function groundTex(o) {
    const lo = rgb(o.ground[1]), hi = rgb(o.ground[0]), dirt = rgb('#4a3b26');
    return paint(256, (u, w, out) => {
      const n = fbm(u * 6, w * 6, 6, 41, 3), m = fbm(u * 20, w * 20, 20, 43, 2);
      mix3(lo, hi, n * 1.2 - 0.1, out); if (m > 0.6) mix3(out, dirt, (m - 0.6) * 1.5, out);
      out[3] = 100 + m * 80;
    }, (ga, gh, n) => {
      const r = rng(9); ga.lineCap = 'round';
      for (let i = 0; i < 520; i++) { const x = r() * n, y = r() * n, a = -Math.PI / 2 + (r() - 0.5) * 1.6, l = 3 + r() * 5; ga.strokeStyle = o.tuft[(r() * o.tuft.length) | 0]; ga.lineWidth = 1.3; ga.beginPath(); ga.moveTo(x, y); ga.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ga.stroke(); }
      for (let i = 0; i < 60; i++) { const x = r() * n, y = r() * n, s = 1.5 + r() * 2.5; ga.fillStyle = `rgba(150,148,130,${0.4 + r() * 0.3})`; ga.beginPath(); ga.arc(x, y, s, 0, 7); ga.fill(); gh.fillStyle = '#e0e0e0'; gh.beginPath(); gh.arc(x, y, s, 0, 7); gh.fill(); }
    });
  }
  function barkTex(s) {
    const lo = rgb(s.bark[2]), hi = rgb(s.bark[0]);
    return paint(128, (u, w, o) => { const n = fbm(u * 10, w * 1.5, 10, 61, 3), m = vnoise(u * 40, w * 4, 40, 63); mix3(lo, hi, n * 0.8 + m * 0.4, o); o[3] = 60 + m * 160; });
  }
  function ringsTex(s) {
    const a = rgb(s.wood[0]), b = rgb(s.wood[2]);
    return paint(128, (u, w, o) => { const r = Math.hypot(u - 0.5, w - 0.5), n = fbm(u * 4, w * 4, 4, 71, 2), t = 0.5 + 0.5 * Math.sin(r * 70 + n * 5); mix3(a, b, t * 0.55 + (r > 0.47 ? 0.6 : 0), o); o[3] = 120 + t * 60; });
  }

  // ---------- geometry helpers ----------
  // Box with rounded edges: segments are packed into the rounded zones, normals are exact.
  function roundedBox(w, h, d, r, k = 3) {
    const S = 2 * k + 1, g = new THREE.BoxGeometry(w, h, d, S, S, S), p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv;
    r = Math.min(r, w / 2, h / 2, d / 2) * 0.999;
    const half = [w / 2, h / 2, d / 2], c = [0, 0, 0];
    const remap = (v, hf) => { const i = Math.round((v + hf) / (2 * hf) * S); return i <= k ? -hf + r * (i / k) : hf - r * ((S - i) / k); };
    // keep the texture spread evenly over each face once the segments are packed toward the edges
    const reuv = (t, hf) => { const i = Math.round(t * S); return i <= k ? r * i / k / (2 * hf) : 1 - r * (S - i) / k / (2 * hf); };
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), hu = ax > 0.5 ? half[2] : half[0], hv = ay > 0.5 ? half[2] : half[1];
      uv.setXY(i, reuv(uv.getX(i), hu), reuv(uv.getY(i), hv));
      c[0] = remap(p.getX(i), half[0]); c[1] = remap(p.getY(i), half[1]); c[2] = remap(p.getZ(i), half[2]);
      const ix = Math.max(-half[0] + r, Math.min(half[0] - r, c[0])), iy = Math.max(-half[1] + r, Math.min(half[1] - r, c[1])), iz = Math.max(-half[2] + r, Math.min(half[2] - r, c[2]));
      let dx = c[0] - ix, dy = c[1] - iy, dz = c[2] - iz; const l = Math.hypot(dx, dy, dz);
      if (l > 1e-6) { dx /= l; dy /= l; dz /= l; p.setXYZ(i, ix + dx * r, iy + dy * r, iz + dz * r); nr.setXYZ(i, dx, dy, dz); }
      else p.setXYZ(i, c[0], c[1], c[2]);
    }
    return g;
  }
  // Raise the middle of a box's top into a soft dome ("pillow" stone); normals follow the slope.
  function pillow(g, w, h, d, dome) {
    const p = g.attributes.position, nr = g.attributes.normal, top = h / 2;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = Math.max(-1, Math.min(1, x / (w / 2))), v = Math.max(-1, Math.min(1, z / (d / 2)));
      const wgt = Math.max(0, Math.min(1, (y - top * 0.35) / (top * 0.65))), f = (1 - u * u) * (1 - v * v);
      p.setY(i, y + dome * f * wgt * wgt);
      const gx = dome * -2 * u / (w / 2) * (1 - v * v) * wgt, gz = dome * -2 * v / (d / 2) * (1 - u * u) * wgt;
      V.set(nr.getX(i) - gx * Math.max(0, nr.getY(i)), nr.getY(i), nr.getZ(i) - gz * Math.max(0, nr.getY(i))).normalize(); nr.setXYZ(i, V.x, V.y, V.z);
    }
    return g;
  }
  // A hand-cut stone: rounded block with a slightly uneven, chipped surface.
  function cutStone(seed) {
    const g = roundedBox(1, 1, 1, 0.16, 2), p = g.attributes.position, nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.035 * Math.sin(x * 7.1 + seed) * Math.sin(y * 6.3 + seed * 2.1) * Math.sin(z * 8.7 + seed * 0.7) + 0.02 * Math.sin((x + z) * 15 + y * 9 + seed);
      p.setXYZ(i, x + nr.getX(i) * n, y + nr.getY(i) * n, z + nr.getZ(i) * n);
    }
    return g;
  }
  // Merge parts into one vertex-coloured geometry. part: [geometry, colour | (x,y,z,nx,ny,nz) => Color, matrix?]
  function merge(parts, withUv = false) {
    let n = 0;
    const list = parts.map(([g, col, m]) => { g = g.index ? g.toNonIndexed() : g.clone(); if (m) g.applyMatrix4(m); n += g.attributes.position.count; return [g, col]; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = withUv ? new Float32Array(n * 2) : null; let o = 0;
    for (const [g, cf] of list) {
      const P = g.attributes.position.array, Nn = g.attributes.normal.array, cnt = g.attributes.position.count;
      pos.set(P, o * 3); nor.set(Nn, o * 3); if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      for (let i = 0; i < cnt; i++) { const cc = typeof cf === 'function' ? cf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]) : cf; col[(o + i) * 3] = cc.r; col[(o + i) * 3 + 1] = cc.g; col[(o + i) * 3 + 2] = cc.b; }
      o += cnt; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere(); return out;
  }
  const mat4 = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  // Lumpy sphere with smooth radial normals (foliage, moss, rocks).
  function blob(r, detail, seed, amp = 0.12) {
    const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z), nx = x / l, ny = y / l, nz = z / l;
      const d = 1 + amp * (Math.sin(nx * 5.3 + seed) * Math.sin(ny * 4.1 + seed * 1.7) * Math.sin(nz * 6.2 + seed * 0.6) + 0.35 * Math.sin(nx * 11 + ny * 9 + seed));
      p.setXYZ(i, nx * r * d, ny * r * d, nz * r * d); nr.setXYZ(i, nx, ny, nz);
    }
    return g;
  }
  function inst(geo, mat, n, shadow = true) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.count = 0; m.frustumCulled = false;
    m.castShadow = shadow; m.receiveShadow = true; return m;
  }
  function put(mesh, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, color = null) {
    if (mesh.count >= mesh.instanceMatrix.count) return -1;   // full: never write past the buffer
    Q.setFromAxisAngle(V.set(0, 1, 0), ry); M4.compose(V.set(x, y, z), Q, S.set(sx, sy, sz));
    const i = mesh.count++; mesh.setMatrixAt(i, M4); if (color) mesh.setColorAt(i, color); return i;
  }

  // ---------- per-world kit: textures, materials, models ----------
  function makeKit(w) {
    const f = w.floor, k = { mats: {}, geo: {} }, sc = w.scene3d, o = w.outside;
    const std = (opt) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, opt));
    const pair = ([a, h], strength, rep = 1, extra = {}) => std(Object.assign({ map: tex(a, true, rep), normalMap: tex(normalFrom(h, strength), false, rep) }, extra));
    k.mats.grass = [0, 1, 2, 3].map(v => pair(grassTex(f, v), 3.2, 1, { roughness: 0.95, color: lin('#eef0e0') }));
    k.mats.pillar = pair(stoneTex(['#d6dad9', '#8a9192'], 13), 6, 1, { roughness: 0.74, color: lin('#dcdedb') });
    k.mats.wall = pair(stoneTex(['#b2b8b6', '#646c6a'], 29), 7, 1, { roughness: 0.82, color: lin('#b9bebb') });
    k.mats.paving = pair(stoneTex(f.paving, 47), 2.5, 1, { roughness: 0.88 });
    k.mats.brick = pair(brickTex(sc.brick), 4, 1, { roughness: 0.72 });
    k.mats.ground = pair(groundTex(o), 1.6, 14, { roughness: 1 });
    k.mats.bark = pair(barkTex(w.obstacle.stump), 3, 1);
    k.mats.rings = pair(ringsTex(w.obstacle.stump), 2, 1);
    k.mats.base = std({ color: lin('#1e3d12'), roughness: 1 });
    k.mats.vc = std({ vertexColors: true, roughness: 0.88 });
    k.mats.leaf = std({ vertexColors: true, roughness: 0.8 });
    k.mats.blade = std({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    k.mats.metal = std({ color: lin(o.lantern.metal), roughness: 0.45, metalness: 0.6 });
    k.mats.glass = std({ color: lin(o.lantern.light), emissive: lin(o.lantern.glow), emissiveIntensity: 6, roughness: 0.3 });
    k.mats.cobble = pair(stoneTex(o.path, 53), 2.5, 1, { roughness: 0.85 });
    const H = sc.heights;
    {
      const c = cv(128), g = c.getContext('2d');
      g.shadowColor = '#000'; g.shadowBlur = 22; g.fillStyle = '#000'; g.beginPath(); g.roundRect(30, 30, 68, 68, 14); g.fill(); g.fill();
      const t = new THREE.CanvasTexture(c);
      k.mats.ao = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.75, color: '#000' });
      k.geo.ao = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    }
    k.geo.slab = roundedBox(0.95, 0.16, 0.95, 0.05, 2);
    k.geo.pillar = pillow(roundedBox(0.9, H.pillar, 0.9, 0.13, 3), 0.9, H.pillar, 0.9, 0.07);
    k.geo.cut = [1, 2, 3].map(cutStone);
    k.geo.brick = roundedBox(0.9, H.brick, 0.9, 0.07, 2);
    k.geo.stone = roundedBox(1, 1, 1, 0.12);
    k.geo.cobble = roundedBox(1, 1, 1, 0.3, 1);
    k.geo.flag = roundedBox(1, 1, 1, 0.04, 1);
    // grass tuft: a fan of thin blades, dark at the root and bright at the tip
    {
      k.geo.tufts = [[14, 0.06, 0.05, 0.03], [9, 0.1, 0.09, 0.02]].map(([blades, h0, hv, spread], tv) => {
      const pos = [], col = [], nor = [], dark = lin(f.blades[3]), light = lin(f.blades[2]), r = rng(4 + tv * 9);
      for (let i = 0; i < blades; i++) {
        const a = i / blades * Math.PI * 2 + r(), lean = 0.25 + r() * 0.35, h = h0 + r() * hv, bx = Math.cos(a) * spread, bz = Math.sin(a) * spread, w = 0.012;
        const tx = bx + Math.cos(a) * h * lean, tz = bz + Math.sin(a) * h * lean, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, tx, h, tz);
        for (let q = 0; q < 3; q++) nor.push(0, 1, 0);
        const tip = mixC(light, lin(f.blades[0]), r());
        col.push(dark.r, dark.g, dark.b, dark.r, dark.g, dark.b, tip.r, tip.g, tip.b);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return g;
      });
      k.geo.tuft = k.geo.tufts[1];
    }
    // flower: five petals round a yellow heart
    {
      const parts = [], white = lin('#ffffff'), heart = lin('#ffc21f');
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; parts.push([new THREE.SphereGeometry(0.026, 5, 3), white, mat4(Math.cos(a) * 0.026, 0, Math.sin(a) * 0.026, 1, 0.3, 0.62, -a)]); }
      parts.push([new THREE.SphereGeometry(0.017, 5, 3), heart, mat4(0, 0.006, 0, 1, 0.6, 1)]);
      k.geo.flower = merge(parts);
    }
    {
      const parts = [], c0 = lin(f.clover[0]), c1 = lin(f.clover[2]);
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; parts.push([new THREE.SphereGeometry(0.034, 7, 4), (x, y) => y > 0.004 ? c1 : c0, mat4(Math.cos(a) * 0.032, 0, Math.sin(a) * 0.032, 1, 0.3, 1)]); }
      k.geo.clover = merge(parts);
    }
    {
      const m0 = lin(w.wall.moss[0]), m1 = lin(w.wall.moss[1]);
      const clump = [[0, 0, 0, 1], [0.7, -0.1, 0.3, 0.6], [-0.6, -0.1, 0.4, 0.55], [0.2, -0.15, -0.7, 0.5], [-0.3, 0.1, -0.4, 0.45]];
      k.geo.moss = merge(clump.map(([cx, cy, cz, r], i) => [blob(r, 1, i + 3, 0.3), (x, y, z, nx, ny) => mixC(m1, m0, ny * 0.7 + 0.3 + Math.sin(x * 9 + z * 7) * 0.2), mat4(cx, cy, cz)]));
    }
    // trees and bushes: clusters of lumpy spheres coloured dark below and sunlit on top
    const leaf = o.leaf.map(lin), trunk = o.trunk.map(lin), sunLeaf = lin('#bfdf74');
    const foliage = (cx, cy, cz, rad, sd, det = 2) => [blob(rad, det, sd, 0.14), (x, y, z, nx, ny, nz) => {
      const t = ny * 0.62 + 0.38 - nx * 0.18 - nz * 0.05 + 0.16 * Math.sin(x * 13 + y * 11 + z * 7 + sd);
      return t > 0.78 ? mixC(leaf[0], sunLeaf, (t - 0.78) * 3) : t > 0.55 ? mixC(leaf[1], leaf[0], (t - 0.55) * 4.3) : t > 0.3 ? mixC(leaf[2], leaf[1], (t - 0.3) * 4) : mixC(leaf[3], leaf[2], t * 3.3);
    }, mat4(cx, cy, cz)];
    k.geo.trees = [0, 1, 2].map(v => {
      const r = rng(17 + v * 5), Hh = 1.05 + v * 0.18, R = 0.78 + v * 0.1, parts = [];
      parts.push([new THREE.CylinderGeometry(0.09, 0.15, Hh, 8), (x, y) => mixC(trunk[1], trunk[0], y / Hh + 0.5), mat4(0, Hh / 2, 0)]);
      for (let i = 0; i < 4; i++) { const a = i * 1.7 + v; parts.push([blob(0.1, 1, i, 0.2), trunk[1], mat4(Math.cos(a) * 0.12, 0.03, Math.sin(a) * 0.12, 1.4, 0.5, 0.8, -a)]); }
      parts.push(foliage(0, Hh + R * 0.55, 0, R * 0.8, v, 2));
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + r(), el = 0.1 + r() * 0.7; parts.push(foliage(Math.cos(a) * R * 0.6 * Math.cos(el), Hh + R * 0.5 + Math.sin(el) * R * 0.5, Math.sin(a) * R * 0.6 * Math.cos(el), R * (0.42 + r() * 0.12), v * 10 + i, 2)); }
      for (let i = 0; i < 16; i++) { const a = r() * Math.PI * 2, el = -0.1 + r() * 1.3, rr = R * (0.82 + r() * 0.12); parts.push(foliage(Math.cos(a) * rr * Math.cos(el), Hh + R * 0.55 + Math.sin(el) * rr * 0.8, Math.sin(a) * rr * Math.cos(el), R * (0.16 + r() * 0.1), v * 40 + i, 1)); }
      return merge(parts);
    });
    k.geo.bush = merge([foliage(0, 0.2, 0, 0.3, 1, 1), foliage(0.22, 0.16, 0.05, 0.22, 2, 1), foliage(-0.2, 0.15, -0.04, 0.22, 3, 1), foliage(0.02, 0.33, -0.05, 0.2, 4, 1)]);
    const rk = w.obstacle.rock, rTop = lin(rk.top[0]), rSide = lin(rk.side[1]), rm = lin(rk.moss[0]), rm1 = lin(rk.moss[1]);
    k.geo.rock = merge([[blob(0.42, 3, 5, 0.18), (x, y, z, nx, ny) => ny > 0.62 ? mixC(rm1, rm, (ny - 0.62) * 3 + Math.sin(x * 20 + z * 17) * 0.2) : mixC(rSide, rTop, ny * 0.5 + 0.5 + Math.sin(x * 31 + y * 27) * 0.08), mat4(0, 0.22, 0, 1, 0.68, 1)]]);
    k.geo.rockSmall = merge([[blob(0.22, 2, 9, 0.2), (x, y, z, nx, ny) => ny > 0.6 ? rm : mixC(rSide, rTop, ny * 0.5 + 0.5), mat4(0, 0.08, 0, 1, 0.6, 1)]]);
    {   // mushroom
      const stem = lin('#f2e8d2'), cap = lin('#d8392a'), spot = lin('#fff6ea');
      k.geo.mushroom = merge([[new THREE.CylinderGeometry(0.035, 0.045, 0.16, 8), stem, mat4(0, 0.08, 0)], [new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), (x, y, z) => Math.sin(x * 60) * Math.sin(z * 60) > 0.55 ? spot : cap, mat4(0, 0.14, 0, 1, 0.75, 1)]]);
    }
    {   // barrel: staves, iron hoops and a lid
      const wood = lin(o.barrel[0]), dark = lin(o.barrel[1]), iron = lin(o.barrel[2]), prof = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(0.24 + Math.sin(t * Math.PI) * 0.05, t * 0.62)); }
      const parts = [[new THREE.LatheGeometry(prof, 18), (x, y, z) => { const a = Math.atan2(z, x); return mixC(dark, wood, 0.55 + 0.35 * Math.sin(a * 18) * 0.5 + 0.2 * Math.sin(y * 9)); }]];
      for (const y of [0.1, 0.52]) parts.push([new THREE.TorusGeometry(0.262 + Math.sin(y / 0.62 * Math.PI) * 0.05, 0.016, 6, 24), iron, mat4(0, y, 0, 1, 1, 1, 0, Math.PI / 2)]);
      parts.push([new THREE.CylinderGeometry(0.235, 0.235, 0.02, 18), dark, mat4(0, 0.615, 0)]);
      k.geo.barrel = merge(parts);
    }
    {   // lantern: stone foot, iron post, glass box under a pointed cap
      const iron = lin(o.lantern.metal), stone = lin('#6a675c');
      k.geo.lanternFrame = merge([
        [new THREE.BoxGeometry(0.26, 0.14, 0.26), stone, mat4(0, 0.07, 0)],
        [new THREE.CylinderGeometry(0.035, 0.045, 1.0, 8), iron, mat4(0, 0.62, 0)],
        [new THREE.BoxGeometry(0.3, 0.04, 0.3), iron, mat4(0, 1.13, 0)],
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [new THREE.BoxGeometry(0.03, 0.26, 0.03), iron, mat4(sx * 0.115, 1.28, sz * 0.115)]),
        [new THREE.ConeGeometry(0.21, 0.16, 4), iron, mat4(0, 1.49, 0, 1, 1, 1, Math.PI / 4)],
        [new THREE.SphereGeometry(0.035, 8, 6), iron, mat4(0, 1.6, 0)],
      ]);
      k.geo.lanternGlass = new THREE.BoxGeometry(0.2, 0.24, 0.2);
    }
    {   // tree stump: bark wall, ring-cut top, a few roots
      k.geo.stumpSide = new THREE.CylinderGeometry(0.33, 0.37, 0.5, 18, 1, true);
      k.geo.stumpTop = new THREE.CircleGeometry(0.33, 18);
      const bark = lin(w.obstacle.stump.bark[1]);
      k.geo.roots = merge([0, 1, 2, 3].map(i => [blob(0.12, 1, i, 0.2), bark, mat4(Math.cos(i * 1.7) * 0.33, 0.04, Math.sin(i * 1.7) * 0.33, 1.4, 0.45, 0.8, -i * 1.7)]));
    }
    // vines that hang from the walls: a stem with leaves on alternating sides
    {
      const vc = w.wall.vine.map(lin), parts = [];
      const strand = (x0, sway, len, sd) => {
        const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector3(x0 + Math.sin(t * 3 + sd) * sway, -t * len, 0.02 + Math.sin(t * Math.PI) * 0.03)); }
        const curve = new THREE.CatmullRomCurve3(pts);
        parts.push([new THREE.TubeGeometry(curve, 12, 0.012, 4), vc[0]]);
        for (let i = 1; i < 9; i++) { const p = curve.getPoint(i / 9), s = i % 2 ? 1 : -1; parts.push([new THREE.SphereGeometry(0.04, 6, 4), vc[i % 3 === 0 ? 2 : 1], mat4(p.x + s * 0.035, p.y, p.z + 0.012, 1, 0.55, 0.3, 0, 0, s * 0.6)]); }
      };
      strand(0, 0.05, 0.75, 1); strand(0.16, 0.04, 0.5, 2);
      k.geo.vine = merge(parts);
    }
    return k;
  }

  // ---------- static scenery around the arena (per world) ----------
  function buildWorld() {
    if (worldGroup) { scene.remove(worldGroup); worldGroup.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
    worldGroup = new THREE.Group(); scene.add(worldGroup);
    const k = kit, o = world.outside, sc = world.scene3d, cols = 15, rows = 13, Hh = sc.heights;
    // forest floor
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), k.mats.ground);
    ground.rotation.x = -Math.PI / 2; ground.position.set(7.5, -0.1, 6.5); ground.receiveShadow = true; worldGroup.add(ground);
    // arena base under the turf
    const base = new THREE.Mesh(new THREE.BoxGeometry(cols, 0.3, rows), k.mats.base); base.position.set(7.5, -0.2, 6.5); base.receiveShadow = true; worldGroup.add(base);
    // cobblestone path hugging the walls
    const cob = inst(k.geo.cobble, k.mats.cobble, 1600, false), r = rng(77);
    const inBoard = (x, z, m) => x > -m && x < cols + m && z > -m && z < rows + m;
    for (let z = -1.5; z < rows + 1.5; z += 0.34) for (let x = -1.5 + (Math.round(z / 0.34) & 1) * 0.17; x < cols + 1.5; x += 0.34) {
      if (inBoard(x + 0.17, z + 0.17, 0.02) || r() < 0.07) continue;
      const s = 0.82 + r() * 0.16, h = 0.06 + r() * 0.04, t = 0.75 + r() * 0.35;
      put(cob, x + 0.17 + (r() - 0.5) * 0.05, -0.1 + h / 2, z + 0.17 + (r() - 0.5) * 0.05, 0.3 * s, h, 0.3 * s * (0.85 + r() * 0.2), (r() - 0.5) * 0.5, C.setRGB(t, t * (r() < 0.12 ? 1.1 : 1), t));
    }
    worldGroup.add(cob);
    // border wall: two dressed stones per tile with moss and hanging vines
    const walls = k.geo.cut.map(g => inst(g, k.mats.wall, 260)), moss = inst(k.geo.moss, k.mats.vc, 360, false), vines = inst(k.geo.vine, k.mats.leaf, 40, false);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!(x === 0 || y === 0 || x === cols - 1 || y === rows - 1)) continue;
      const corner = (x === 0 || x === cols - 1) && (y === 0 || y === rows - 1), alongZ = (x === 0 || x === cols - 1) && !corner;
      // two courses of stones laid along the wall; the upper course is offset like real masonry
      const h1 = Hh.wall * (0.5 + hsh(x, y, 4) * 0.1), h2 = Hh.wall - h1 + (hsh(x, y, 5) - 0.5) * 0.06, s1 = 0.38 + hsh(x, y, 6) * 0.24, s2 = (s1 + 0.5) % 1 * 0.6 + 0.2;
      const courses = corner ? [[0, h1, [[0, 1]]], [h1, h2, [[0, 0.55], [0.55, 0.45]]]] : [[0, h1, [[0, s1], [s1, 1 - s1]]], [h1, h2, [[0, s2], [s2, 1 - s2]]]];
      let si = 0;
      for (const [y0, ch, pieces] of courses) for (const [a0, len] of pieces) {
        const sd = hsh(x * 7 + si, y * 5 + si, 21), gap = 0.035, t = 0.72 + sd * 0.36, depth = 0.86 + hsh(x, y + si, 22) * 0.12, off = (hsh(x + si, y, 23) - 0.5) * 0.06;
        const cx = alongZ ? x + 0.5 + off : x + a0 + len / 2, cz = alongZ ? y + a0 + len / 2 : y + 0.5 + off;
        const sx = alongZ ? depth : len - gap, sz = alongZ ? len - gap : depth, sh = ch - gap;
        put(walls[(si + x + y) % 3], cx, y0 + sh / 2 - 0.03, cz, sx, sh, sz, (sd - 0.5) * 0.12, C.setRGB(t, t * (0.97 + sd * 0.05), t * 0.94));
        if (y0 > 0 && sd < 0.55) for (let m = 0; m < 2; m++) { const s = 0.08 + hsh(x + m, y, si) * 0.09; put(moss, cx + (hsh(m, x, si) - 0.5) * sx * 0.6, y0 + sh - 0.04, cz + (hsh(si, y, m) - 0.5) * sz * 0.6, s, s * 0.45, s * 0.9, hsh(m, x, y) * 6); }
        si++;
      }
      if (y === 0 && !corner && hsh(x, y, 13) < 0.45) put(vines, x + 0.25 + hsh(x, 1, 1) * 0.4, Hh.wall - 0.04, 1.0, 1, 1, 1);
      if (y === rows - 1 && !corner && hsh(x, y, 14) < 0.35) put(vines, x + 0.25 + hsh(x, 2, 2) * 0.4, Hh.wall - 0.04, rows, 1, 1, 1);
    }
    const wallAo = inst(k.geo.ao, k.mats.ao, 60, false); wallAo.castShadow = false; wallAo.renderOrder = 1;
    for (let x = 1; x < cols - 1; x++) { put(wallAo, x + 0.5, 0.014, 0.85, 1.25, 1, 1.0); put(wallAo, x + 0.5, 0.014, rows - 0.85, 1.25, 1, 1.0); }
    for (let y = 1; y < rows - 1; y++) { put(wallAo, 0.85, 0.014, y + 0.5, 1.0, 1, 1.25); put(wallAo, cols - 0.85, 0.014, y + 0.5, 1.0, 1, 1.25); }
    worldGroup.add(...walls, moss, vines, wallAo);
    // trees, bushes, rocks and the rest — tall things never stand where they would hide the arena
    const trees = k.geo.trees.map(g => inst(g, k.mats.leaf, 120)), bush = inst(k.geo.bush, k.mats.leaf, 240), rock = inst(k.geo.rockSmall, k.mats.vc, 120), mush = inst(k.geo.mushroom, k.mats.vc, 80, false), flow = inst(k.geo.flower, k.mats.vc, 900, false);
    const r2 = rng(5);
    for (let gz = -7; gz < rows + 8; gz += 1.5) for (let gx = -8.5; gx < cols + 8.5; gx += 1.5) {
      const x = gx + r2() * 1.2, z = gz + r2() * 1.2, dx = Math.max(-x, x - cols, 0), dz = Math.max(-z, z - rows, 0), d = Math.hypot(dx, dz), roll = r2();
      if (d < 1.6) continue;
      const south = z > rows, tall = d > 2.4 && !(south && z < rows + 6.5) && roll < 0.6;
      if (tall) { const v = (r2() * 3) | 0, s = 0.85 + r2() * 0.45; put(trees[v], x, -0.1, z, s, s * (0.9 + r2() * 0.25), s, r2() * 6.28); }
      else if (roll < 0.82) { const s = 0.8 + r2() * 0.7; put(bush, x, -0.1, z, s, s, s, r2() * 6.28); }
      else if (roll < 0.92) { const s = 0.7 + r2() * 0.9; put(rock, x, -0.1, z, s, s, s, r2() * 6.28); }
      else put(mush, x, -0.1, z, 1, 1, 1, r2() * 6.28);
      if (r2() < 0.35) for (let i = 0; i < 3; i++) { const t = r2(); put(flow, x + (r2() - 0.5) * 0.9, -0.08, z + (r2() - 0.5) * 0.9, 1.3, 1.3, 1.3, r2() * 6, C.setRGB(1, 0.9 + t * 0.1, t < 0.4 ? 0.55 : 1)); }
    }
    for (const t of trees) worldGroup.add(t);
    worldGroup.add(bush, rock, mush, flow);
    // barrels by the path
    const barrel = inst(k.geo.barrel, k.mats.vc, 6);
    for (const [x, z, ry] of [[-1.1, 11.4, 0.3], [-1.05, 10.75, 1.2], [16.15, 1.2, 0.6], [16.05, 12.1, 2]]) put(barrel, x, -0.1, z, 1, 1, 1, ry);
    worldGroup.add(barrel);
    // lanterns framing the arena, each with a warm point light
    lamps = [];
    const frame = inst(k.geo.lanternFrame, k.mats.vc, 8), glass = inst(k.geo.lanternGlass, k.mats.glass, 8, false), L = sc.lamp;
    for (const [x, z] of [[-0.62, 3.5], [-0.62, 9.5], [cols + 0.62, 3.5], [cols + 0.62, 9.5], [-0.66, -0.66], [cols + 0.66, -0.66]]) {
      put(frame, x, -0.1, z, 1.3, 1.3, 1.3); put(glass, x, -0.1 + 1.28 * 1.3, z, 1.3, 1.3, 1.3);
      const pl = new THREE.PointLight(lin(L.color), L.intensity, L.distance, 1.6); pl.position.set(x, 1.55, z); worldGroup.add(pl);
      lamps.push(new THREE.Vector3(x, 1.56, z));
    }
    worldGroup.add(frame, glass);
    for (const m of worldGroup.children) if (m.isInstancedMesh) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // ---------- the arena for one level ----------
  function buildLevel(st) {
    if (levelGroup) { scene.remove(levelGroup); levelGroup.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
    levelGroup = new THREE.Group(); scene.add(levelGroup);
    const k = kit, { cols, rows, grid, HARD, SOFT } = st, n = cols * rows, Hh = world.scene3d.heights, pl = st.plan;
    const skin = j => (pl && pl.skins[j]) || 'pillar', paved = j => pl && pl.decals[j] === 'paving';
    // turf slabs (four texture variants) or flagstones on the plaza
    const slabs = k.mats.grass.map(m => inst(k.geo.slab, m, n, false)), flags = inst(k.geo.flag, k.mats.paving, n * 3, false);
    const tufts = inst(k.geo.tufts[1], k.mats.blade, n * 6, false), tufts2 = inst(k.geo.tufts[0], k.mats.blade, n * 6, false), flowers = inst(k.geo.flower, k.mats.vc, n, false), clovers = inst(k.geo.clover, k.mats.vc, n, false);
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const j = y * cols + x, hard = grid[j] === HARD;
      if (paved(j)) {
        const lay = [[[0, 0, 0.62, 0.62], [0.62, 0, 0.38, 1], [0, 0.62, 0.62, 0.38]], [[0, 0, 1, 0.45], [0, 0.45, 0.4, 0.55], [0.4, 0.45, 0.6, 0.55]], [[0, 0, 0.45, 1], [0.45, 0, 0.55, 0.55], [0.45, 0.55, 0.55, 0.45]]][(hsh(x, y, 1) * 3) | 0];
        for (const [fx, fz, fw, fd] of lay) { const t = 0.85 + hsh(x + fx * 7, y + fz * 7, 2) * 0.25; put(flags, x + fx + fw / 2, -0.06, y + fz + fd / 2, fw - 0.05, 0.12, fd - 0.05, (hsh(x, y, (fx * 10) | 0) < 0.5 ? 0 : Math.PI), C.setRGB(t, t * 0.97, t * 0.9)); }
        continue;
      }
      const v = (hsh(x, y, 1) * 4) | 0, t = (x + y) & 1 ? 0.9 : 1.02;
      put(slabs[v], x + 0.5, -0.08 + hsh(x, y, 3) * 0.008, y + 0.5, 1, 1, 1, ((hsh(x, y, 2) * 4) | 0) * Math.PI / 2, C.setRGB(t, t, t * 0.96));
      if (hard && skin(j) === 'pillar') continue;
      for (let i = 0; i < 6; i++) { const e = hsh(x, y, 20 + i), along = hsh(x, y, 30 + i), side = i % 4; const px = side < 2 ? x + 0.06 + along * 0.88 : x + (side === 2 ? 0.07 : 0.93), pz = side < 2 ? y + (side === 0 ? 0.07 : 0.93) : y + 0.06 + along * 0.88; if (e < 0.8) put(tufts, px, 0, pz, 1 + e * 0.8, 1 + e, 1 + e * 0.8, e * 6); }
      for (let i = 0; i < 6; i++) { const e = hsh(x, y, 40 + i); put(tufts2, x + 0.12 + hsh(x, y, 50 + i) * 0.76, 0, y + 0.12 + hsh(x, y, 60 + i) * 0.76, 0.9 + e * 0.6, 0.8 + e * 0.5, 0.9 + e * 0.6, e * 6); }
      if (hsh(x, y, 7) < world.floor.flowerRate * 1.3) for (let i = 0; i < 1 + ((hsh(x, y, 8) * 3) | 0); i++) { const c = world.floor.flowers[((hsh(x, y, 9) * world.floor.flowers.length) | 0)]; put(flowers, x + 0.2 + hsh(i, x, y) * 0.6, 0.005, y + 0.2 + hsh(x, i, y) * 0.6, 1, 1, 1, hsh(i, i, x) * 6, lin(c[0] === '#ffffff' ? '#ffffff' : c[0])); }
      if (hsh(x, y, 4) < world.floor.cloverRate) for (let i = 0; i < 3; i++) put(clovers, x + 0.25 + hsh(i, y, x + 1) * 0.5, 0.003, y + 0.25 + hsh(y, i, x + 2) * 0.5, 1, 1, 1, hsh(x, i, 5) * 6);
    }
    levelGroup.add(...slabs, flags, tufts, tufts2, flowers, clovers);
    // plaza centrepiece: a ring of dressed stone round a flower bed
    if (pl && pl.decals.some(d => d === 'paving')) {
      let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
      pl.decals.forEach((d, j) => { if (d === 'paving') { const x = j % cols, y = (j / cols) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
      const cx = (x0 + x1 + 1) / 2, cz = (y0 + y1 + 1) / 2, R = Math.min(x1 - x0 + 1, y1 - y0 + 1) * 0.36;
      const ring = inst(k.geo.stone, k.mats.paving, 24);
      for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; put(ring, cx + Math.cos(a) * R, 0.02, cz + Math.sin(a) * R, 0.5, 0.16, 0.26, -a + Math.PI / 2, C.setRGB(1.05, 1.02, 0.95)); }
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.12, R - 0.12, 0.1, 40), k.mats.grass[1]); bed.position.set(cx, -0.04, cz); bed.receiveShadow = true;
      const bf = inst(k.geo.flower, k.mats.vc, 40, false), bt = inst(k.geo.tuft, k.mats.blade, 60, false), rr = rng(3);
      for (let i = 0; i < 26; i++) { const a = rr() * 6.28, d = Math.sqrt(rr()) * (R - 0.25), c = world.floor.flowers[i % world.floor.flowers.length][0]; put(bf, cx + Math.cos(a) * d, 0.02, cz + Math.sin(a) * d, 1.3, 1.3, 1.3, rr() * 6, lin(c)); }
      for (let i = 0; i < 50; i++) { const a = rr() * 6.28, d = Math.sqrt(rr()) * (R - 0.2); put(bt, cx + Math.cos(a) * d, 0.01, cz + Math.sin(a) * d, 1, 1, 1, rr() * 6); }
      levelGroup.add(ring, bed, bf, bt);
    }
    // indestructible posts and obstacles
    pillars = inst(k.geo.pillar, k.mats.pillar, n);
    hardAo = inst(k.geo.ao, k.mats.ao, n, false); hardAo.renderOrder = 1;
    const rocks = inst(k.geo.rock, k.mats.vc, 16), stumpS = inst(k.geo.stumpSide, k.mats.bark, 16), stumpT = inst(k.geo.stumpTop, k.mats.rings, 16), roots = inst(k.geo.roots, k.mats.vc, 16), pmoss = inst(k.geo.moss, k.mats.vc, n * 2, false);
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const j = y * cols + x; if (grid[j] !== HARD) continue;
      const s = skin(j), ry = hsh(x, y, 3) * 6.28;
      put(hardAo, x + 0.5, 0.014, y + 0.5, s === 'pillar' ? 1.45 : 1.3, 1, s === 'pillar' ? 1.45 : 1.3);
      if (s === 'rock') put(rocks, x + 0.5, 0, y + 0.5, 1, 1, 1, ry);
      else if (s === 'stump') {
        put(stumpS, x + 0.5, 0.25, y + 0.5, 1, 1, 1, ry); put(roots, x + 0.5, 0, y + 0.5, 1, 1, 1, ry);
        Q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, ry)); M4.compose(V.set(x + 0.5, 0.5, y + 0.5), Q, S.set(1, 1, 1)); stumpT.setMatrixAt(stumpT.count++, M4);
      } else addPillar(x, y, pmoss);
    }
    levelGroup.add(pillars, hardAo, rocks, stumpS, stumpT, roots, pmoss);
    // destructible blocks: one slot per cell, shown or hidden by sync()
    soft = new THREE.InstancedMesh(k.geo.brick, k.mats.brick, n); soft.frustumCulled = false; soft.castShadow = soft.receiveShadow = true;
    softAo = new THREE.InstancedMesh(k.geo.ao, k.mats.ao, n); softAo.frustumCulled = false; softAo.renderOrder = 1; levelGroup.add(softAo);
    for (let j = 0; j < n; j++) soft.setColorAt(j, C.setRGB(1, 1, 1));
    levelGroup.add(soft);
    dropping = inst(k.geo.pillar, k.mats.pillar, 8);
    levelGroup.add(dropping);
    prevGrid = new Uint8Array(n).fill(255);
    for (const m of levelGroup.children) if (m.isInstancedMesh) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    dirty = true;
  }
  function addPillar(x, y, mossMesh) {
    const t = 0.88 + hsh(x, y, 5) * 0.2, h = world.scene3d.heights.pillar;
    put(pillars, x + 0.5, h / 2, y + 0.5, 1, 1, 1, ((hsh(x, y, 6) * 4) | 0) * Math.PI / 2, C.setRGB(t, t, t));
    pillars.instanceMatrix.needsUpdate = true; if (pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
    if (mossMesh && hsh(x, y, 8) < world.pillar.mossRate) {
      const c = hsh(x, y, 9) < 0.5 ? -1 : 1;
      put(mossMesh, x + 0.5 + c * 0.38, 0.06, y + 0.92, 0.13, 0.08, 0.1, hsh(x, 1, y) * 6);
      put(mossMesh, x + 0.5 + c * 0.2, 0.04, y + 0.94, 0.1, 0.06, 0.08, hsh(y, 2, x) * 6);
      if (hsh(x, y, 10) < 0.5) put(mossMesh, x + 0.5 - c * 0.3, h - 0.01, y + 0.15, 0.12, 0.05, 0.1, hsh(x, 3, y) * 6);
    }
  }

  // ---------- grid sync & animation ----------
  function sync(st) {
    const { grid, cols, rows, SOFT, HARD, BURN } = st, n = cols * rows, h = world.scene3d.heights.brick;
    let changed = false, anim = false;
    for (let j = 0; j < n; j++) {
      const c = grid[j]; if (c === prevGrid[j]) continue;
      const x = j % cols, y = (j / cols) | 0;
      if (c === SOFT || c === BURN) { put1(soft, j, x + 0.5, h / 2, y + 0.5, 1); soft.setColorAt(j, C.setRGB(1, 1, 1)); put1(softAo, j, x + 0.5, 0.014, y + 0.5, 1.4); }
      else { put1(soft, j, 0, -50, 0, 0.0001); put1(softAo, j, 0, -50, 0, 0.0001); }
      if (c === HARD && prevGrid[j] !== 255 && prevGrid[j] !== HARD) { addPillar(x, y, null); put(hardAo, x + 0.5, 0.014, y + 0.5, 1.45, 1, 1.45); hardAo.instanceMatrix.needsUpdate = true; }
      prevGrid[j] = c; changed = true;
    }
    for (const b of st.burning) {   // breaking blocks glow, swell, then crumble down
      const k = Math.min(1, b.t / st.burnTime), j = b.y * cols + b.x, s = k < 0.25 ? 1 + k * 0.3 : (1.075 - (k - 0.25) * 1.2);
      put1(soft, j, b.x + 0.5, h / 2 * Math.max(0.05, s), b.y + 0.5, Math.max(0.05, s));
      soft.setColorAt(j, C.setRGB(1 + 2.2 * (1 - k), 1 + 0.6 * (1 - k), 1 - 0.3 * k)); anim = true;
    }
    dropping.count = 0;
    for (const f of st.falling) {   // sudden death: a pillar drops from the sky
      const x = f.j % cols, y = (f.j / cols) | 0, k = Math.min(1, f.t / 0.35), ph = world.scene3d.heights.pillar;
      put(dropping, x + 0.5, ph / 2 + (1 - k * k) * 5, y + 0.5, 1, 1, 1, 0); anim = true;
    }
    dropping.instanceMatrix.needsUpdate = true;
    if (changed || anim) { soft.instanceMatrix.needsUpdate = true; soft.instanceColor.needsUpdate = true; softAo.instanceMatrix.needsUpdate = true; }
    return changed ? 2 : anim ? 1 : 0;
  }
  function put1(mesh, i, x, y, z, s) { M4.compose(V.set(x, y, z), Q.identity(), S.set(s, s, s)); mesh.setMatrixAt(i, M4); }

  // ---------- camera ----------
  // Fit the arena (optionally cropping the outer part of the side walls) inside the rectangle the
  // game reserves for it, keeping the world's camera angle; the lens is shifted to centre it there.
  // crop: how much of the outer wall may fall outside the rectangle ({ x, top, bottom } in tiles).
  // With zoom > 1 the canvas is rendered larger than the screen (covering every pan the lens can reach) and
  // panning is a CSS translate, so following the hero never re-renders the scene.
  let fitRect = null, crop = { x: 0, top: 0, bottom: 0 }, orient = 'portrait', unitT = 1, zoom = 1, box0 = null, panX = 0, panY = 0, follow = null;
  let DPR = 1, CW = 1, CH = 1, range = [0, 0, 0, 0], panT = 0;
  function fitCamera() {
    const base = world.scene3d.camera, c = Object.assign({}, base, base[orient] || {});
    const el = c.elevation * Math.PI / 180, center = new THREE.Vector3(7.5, 0, 6.5), dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    camera.fov = c.fov; camera.aspect = W / H; camera.clearViewOffset();
    const hw = world.scene3d.heights.wall, pts = [], all = [];
    for (const x of [crop.x, 15 - crop.x]) for (const z of [crop.top, 13 - crop.bottom]) for (const y of [0, hw]) pts.push(new THREE.Vector3(x, y, z));
    for (const x of [0, 15]) for (const z of [0, 13]) all.push(new THREE.Vector3(x, 0, z));
    let d = 26, box = null;
    for (let it = 0; it < 8; it++) {
      camera.position.copy(center).addScaledVector(dir, d); camera.lookAt(center); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      box = bounds(pts);
      d *= Math.max((box[2] - box[0]) / fitRect.w, (box[3] - box[1]) / fitRect.h);
    }
    d /= zoom;   // zoom > 1: closer view of part of the arena; the lens then pans to follow the hero
    camera.position.copy(center).addScaledVector(dir, d); camera.lookAt(center); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    scene.fog.near = d * 0.95; scene.fog.far = d * 2.3;
    camera.far = d * 4; camera.near = 0.5; camera.updateProjectionMatrix();
    box0 = bounds(pts);
    const b = box0, x0 = fitRect.x + fitRect.w - b[2], x1 = fitRect.x - b[0], y0 = fitRect.y + fitRect.h - b[3], y1 = fitRect.y - b[1];
    range = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    if (zoom <= 1) { const c = panFor(null); range = [c[0], c[0], c[1], c[1]]; }
    CW = Math.ceil(W + range[1] - range[0]); CH = Math.ceil(H + range[3] - range[2]);
    const pr = Math.min(DPR, 2.5, Math.sqrt(4.5e6 / (CW * CH)));   // keep the oversized canvas within a mobile memory budget
    renderer.setPixelRatio(pr); renderer.setSize(CW, CH, false);
    composer.setPixelRatio(pr); composer.setSize(CW, CH);
    canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
    focus.uniforms.texel.value.set(1 / CW, 1 / CH);
    // the canvas shows the screen window shifted by the largest pan; refocus in canvas space
    camera.setViewOffset(W, H, -range[1], -range[3], CW, CH); camera.updateProjectionMatrix();
    const fb = bounds(all, true);
    focus.uniforms.rect.value.set((fb[0] + fb[2]) / 2 / CW, 1 - (fb[1] + fb[3]) / 2 / CH, (fb[2] - fb[0]) / 2 / CW * 1.02, (fb[3] - fb[1]) / 2 / CH * 1.04);
    setPan(0, 0); const pan = panFor(follow); setPan(pan[0], pan[1]);
  }
  // Screen-space projection (used by the game's 2D layer) for a pan, and the CSS offset of the oversized canvas.
  function setPan(px, py) {
    panX = px; panY = py;
    camera.setViewOffset(W, H, -panX, -panY, W, H); camera.updateProjectionMatrix();
    VP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.setViewOffset(W, H, -range[1], -range[3], CW, CH); camera.updateProjectionMatrix();
    shakeCss = null;
  }
  // Lens shift that centres a board point (or the arena) in the fit rectangle without showing past the arena's edges.
  function panFor(pt) {
    const b = box0, cx = fitRect.x + fitRect.w / 2, cy = fitRect.y + fitRect.h / 2;
    let px = (b[0] + b[2]) / 2, py = (b[1] + b[3]) / 2;
    if (pt && zoom > 1) {
      const e = VP.elements, x = pt[0], z = pt[1], w = e[3] * x + e[11] * z + e[15];
      px = ((e[0] * x + e[8] * z + e[12]) / w + 1) * 0.5 * W - panX; py = (1 - (e[1] * x + e[9] * z + e[13]) / w) * 0.5 * H - panY;   // VP includes the current pan
    }
    const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
    return [clamp(cx - px, fitRect.x + fitRect.w - b[2], fitRect.x - b[0]), clamp(cy - py, fitRect.y + fitRect.h - b[3], fitRect.y - b[1])];
  }
  // Screen box of points under the camera's current projection (canvas pixels when `canvasSpace`).
  function bounds(pts, canvasSpace) {
    VP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const b = [1e9, 1e9, -1e9, -1e9], o = [0, 0], sx = canvasSpace ? CW / W : 1, sy = canvasSpace ? CH / H : 1;
    for (const p of pts) { toScreen(p.x, p.y, p.z, o); o[0] *= sx; o[1] *= sy; b[0] = Math.min(b[0], o[0]); b[1] = Math.min(b[1], o[1]); b[2] = Math.max(b[2], o[0]); b[3] = Math.max(b[3], o[1]); }
    return b;
  }
  function toScreen(x, y, z, o) {
    const e = VP.elements, w = e[3] * x + e[7] * y + e[11] * z + e[15];
    o[0] = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) * 0.5 * W;
    o[1] = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5 * H;
    return o;
  }
  const P0 = [0, 0], P1 = [0, 0], P2 = [0, 0];
  // Where a board point (in tiles) lands on screen: [x, y, pixels per tile across, depth foreshortening].
  function project(x, z) {
    toScreen(x, 0, z, P0); toScreen(x + 0.5, 0, z, P1); toScreen(x, 0, z + 0.5, P2);
    const across = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) * 2, deep = Math.hypot(P2[0] - P0[0], P2[1] - P0[1]) * 2;
    return [P0[0], P0[1], across, deep / across];
  }

  // ---------- public API ----------
  function init(cv, lost) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    } catch (e) { renderer = null; return false; }
    canvas = cv; onLost = lost;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;   // shadows are recomputed only when the board itself changes
    scene = new THREE.Scene(); scene.fog = new THREE.Fog('#000', 10, 60);
    camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
    sky = new THREE.HemisphereLight('#fff', '#000', 1); scene.add(sky);
    sun = new THREE.DirectionalLight('#fff', 3); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    const sc = sun.shadow.camera; sc.left = -15; sc.right = 15; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 60;
    scene.add(sun, sun.target);
    fill = new THREE.DirectionalLight('#fff', 0.4); scene.add(fill, fill.target);
    // post-processing: MSAA scene → bloom (lanterns, sunlit highlights) → soft focus around the arena → tone map
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.45, 1.15); composer.addPass(bloom);
    focus = new ShaderPass(FocusShader); composer.addPass(focus);
    composer.addPass(new OutputPass());
    document.addEventListener('visibilitychange', () => { dirty = true; });
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); renderer = null; if (onLost) onLost(); }, false);
    return true;
  }
  function setWorld(w) {
    if (!renderer || w === world) return;
    world = w; const sc = w.scene3d;
    kit = kits[w.id] || (kits[w.id] = makeKit(w));
    scene.background = lin(sc.fog); scene.fog.color = lin(sc.fog);
    renderer.toneMappingExposure = sc.exposure;
    sky.color = lin(sc.sky.color); sky.groundColor = lin(sc.sky.ground); sky.intensity = sc.sky.intensity;
    sun.color = lin(sc.sun.color); sun.intensity = sc.sun.intensity; sun.position.set(7.5 + sc.sun.from[0], sc.sun.from[1], 6.5 + sc.sun.from[2]); sun.target.position.set(7.5, 0, 6.5);
    fill.color = lin(sc.fill.color); fill.intensity = sc.fill.intensity; fill.position.set(14, 6, 22); fill.target.position.set(7.5, 0, 6.5);
    buildWorld(); plan = undefined; dirty = true;
  }
  function resize(o) {
    if (!renderer) return;
    W = o.W; H = o.H; unitT = o.T; fitRect = o.fit; crop = o.crop; orient = o.orient; zoom = o.zoom || 1; panX = panY = 0; DPR = o.DPR;
    if (world) fitCamera(); dirty = true;
  }
  function build(st) {
    if (!renderer || !world) return;
    if (st.plan !== plan || !soft) { plan = st.plan; buildLevel(st); }
    dirty = true;
  }
  function frame(st, shx, shy, focusPt) {
    if (!renderer || !soft) return;
    follow = focusPt || null;
    const now = performance.now(), dt = Math.min(0.1, (now - panT) / 1000); panT = now;
    if (zoom > 1 && box0) {   // glide the lens toward the hero (frame-rate independent)
      const t = panFor(follow), k = 1 - Math.exp(-dt * 7);
      if (Math.abs(t[0] - panX) > 0.05 || Math.abs(t[1] - panY) > 0.05) setPan(panX + (t[0] - panX) * k, panY + (t[1] - panY) * k);
    }
    const ox = panX - range[1] + (shx || 0), oy = panY - range[3] + (shy || 0);
    const css = ox || oy ? `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,0)` : '';
    if (css !== shakeCss) { canvas.style.transform = css; shakeCss = css; }
    const moved = sync(st);
    if (moved || dirty) {
      if (dirty || moved === 2) renderer.shadowMap.needsUpdate = true;   // animation frames reuse the last shadow map
      composer.render(); dirty = false;
    }
  }
  // Lantern flicker and drifting motes, handed to the game's additive glow pass in screen space.
  const AP = [0, 0];
  function ambient(t, emit) {
    if (!world) return;
    const M = world.light.motes, lc = world.outside.lantern.glow;
    lamps.forEach((l, i) => { toScreen(l.x, l.y, l.z, AP); const u = project(l.x, l.z)[2]; emit(AP[0], AP[1], u * (0.95 + 0.07 * Math.sin(t * 7 + i)), lc, 0.55 + 0.1 * Math.sin(t * 11 + i * 3) + 0.07 * Math.sin(t * 29 + i)); });
    for (let i = 0; i < M.count; i++) {
      const sp = 0.15 + hsh(i, 3, 77) * 0.25, x = 1 + hsh(i, 1, 77) * 13 + Math.sin(t * sp + i * 1.7) * 0.9, z = 1 + hsh(i, 2, 77) * 11 + Math.cos(t * sp * 0.8 + i) * 0.7, y = 0.35 + 0.3 * Math.sin(t * 0.5 + i);
      const a = Math.max(0, Math.sin(t * (0.5 + sp) + i * 2.3)) * 0.5;
      if (a > 0.03) { toScreen(x, y, z, AP); emit(AP[0], AP[1], project(x, z)[2] * 0.15, M.color, a); }
    }
  }
  // Board camera and lens pan, for layers drawn through the same view (fx3d.js).
  const view = () => (renderer && soft ? { camera, panX, panY, world } : null);
  return { init, setWorld, resize, build, frame, project, ambient, view, debug: () => ({ scene, camera, renderer, invalidate: () => { dirty = true; } }) };
})();

window.Board3D = Board3D;
window.dispatchEvent(new Event('board3d-ready'));
