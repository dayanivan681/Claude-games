// ================= 3D characters (WebGL · Three.js) =================
// Presentation only: procedural, animated 3D models of the bombers (hero and rivals, one rig dressed by each
// palette) and of every enemy, drawn by fx3d.js in its layer through the board camera. The game's player and
// enemy objects are read each frame; nothing here changes game state (except winding down the cosmetic
// bomb-placing crouch timer, as the 2D painter did).
//
// Look: the hero's own design, not a cute chibi — a slim figure with a big helmet, a flat skin face plate with
// tall black eyes under thick determined brows, an open short-sleeved jacket, gold-buckled belt, striped
// knees and chunky cuffed gloves and boots. Enemies wear painted scowling faces (slanted brows, glowing pupils, teeth and fangs) that change as they hunt, get hit and die.
//
// The hero is the owner's Bomber (models/bomber.blend → models/bomber-animado.glb, rigged and animated by
// tools/rig_bomber.py); rivals wear the same model recoloured from their palette plus their accessories. Until it loads (or if it can't) a procedural rig stands in.
//
// Local model space: one unit per tile, feet on y = 0, the model faces +z (toward the camera) before yaw.
import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

export function makeChars(scene, env) {
  const C = new THREE.Color(), C2 = new THREE.Color(), V = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
  const sph = new THREE.SphereGeometry(1, 28, 20), sphLo = new THREE.SphereGeometry(1, 16, 12);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 18), cone = new THREE.ConeGeometry(1, 1, 16), box = new THREE.BoxGeometry(1, 1, 1);
  const cap = new THREE.CapsuleGeometry(0.5, 1, 6, 14);   // 2 tall, 1 wide: scale (2r, h/2, 2r)
  const ring = new THREE.TorusGeometry(1, 0.12, 8, 28);
  const blob = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(0,0,0,0.6)'); rg.addColorStop(0.6, 'rgba(0,0,0,0.3)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false });
  const TILT = 0.28, SCALE = 1.12;   // lean back toward the camera a little and stand taller, so faces read from above

  // ---------- materials ----------
  const mats = {};
  // The board's bright exposure and ACES curve wash colours out; deepen saturated ones a little so they stay vivid.
  const vivid = c => { const col = new THREE.Color(c), h = {}; col.getHSL(h); if (h.s > 0.15) col.setHSL(h.h, Math.min(1, h.s * 1.1), h.l * 0.8); return col; };
  const satin = (c, o = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color: vivid(c), roughness: 0.42, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.3, envMap: env, envMapIntensity: 0.8 }, o));
  const glossy = (c, o = {}) => satin(c, Object.assign({ roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 1 }, o));
  const matte = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: vivid(c), roughness: 0.65, metalness: 0, envMap: env, envMapIntensity: 0.45 }, o));
  const M = (key, make) => mats[key] || (mats[key] = make());
  const INK = M('ink', () => new THREE.MeshPhysicalMaterial({ color: '#0b0a12', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, envMap: env, envMapIntensity: 1 }));
  const SHINE = M('shine', () => new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const GOLD = M('gold', () => new THREE.MeshStandardMaterial({ color: '#ffcf3a', roughness: 0.22, metalness: 1, envMap: env, envMapIntensity: 1.3 }));

  // ---------- helpers ----------
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
  const capsule = (parent, mat, r, h, x, y, z) => mesh(cap, mat, parent, x, y, z, 2 * r, h / 2, 2 * r);
  // A point on an ellipsoid with radii R (Vector3): yaw a (around y, 0 = front), pitch b (up); and its outward normal.
  const onEllipsoid = (R, a, b) => { const u = new THREE.Vector3(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)); return { p: u.clone().multiply(R), n: new THREE.Vector3(u.x / R.x, u.y / R.y, u.z / R.z).normalize() }; };
  // A group sitting on a surface point, local +z pointing out of the surface and local +y kept upright.
  function decal(parent, R, a, b) {
    const { p, n } = onEllipsoid(R, a, b), g = new THREE.Group(); g.position.copy(p);
    const x = new THREE.Vector3().crossVectors(Y, n).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n)); parent.add(g); return g;
  }

  // ---------- the bomber's helmet ----------
  // A rounded superellipsoid (fuller than a sphere) a little wider than tall, broadening toward the cheeks and
  // flattened underneath. helmetR(d): distance from the head centre to the surface along the unit direction d.
  const HEAD_R = new THREE.Vector3(0.29, 0.272, 0.27);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function helmetR(d) {
    const low = sstep(0, -0.7, d.y), a = HEAD_R.x * (1 + 0.05 * low), b = HEAD_R.y * (1 - 0.1 * low), c = HEAD_R.z, P = 2.5;
    return 1 / Math.pow(Math.abs(d.x / a) ** P + Math.abs(d.y / b) ** P + Math.abs(d.z / c) ** P, 1 / P);
  }
  const helmetGeo = (() => {
    const g = new THREE.SphereGeometry(1, 48, 32), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); v.multiplyScalar(helmetR(v)); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g;
  })();
  // The face opening, in the 2D sprite's units (x right, y down, head centre at 0): a big rounded screen, set a
  // little high on the helmet because the game camera looks down on it. Mapped onto the helmet surface by angle.
  const FX = 0.225, FY0 = -0.155, FY1 = 0.175, FRR = 0.12, FACE_UP = 0.2;
  const FW = 0.26, FT = -0.19, FB = 0.21, FPX = 256 / (2 * FW);   // the painted canvas covers x ±FW, y FT..FB
  const faceDir = (xs, ys, out = new THREE.Vector3()) => { const a = xs / HEAD_R.x, b = FACE_UP - ys / HEAD_R.y; return out.set(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)); };
  const onHelmet = (d, lift) => d.multiplyScalar(helmetR(d) + lift);
  function stick(parent, d, lift) {   // a group on the helmet along direction d, local +z out of the surface
    const g = new THREE.Group(), n = d.clone(); g.position.copy(onHelmet(d.clone(), lift));
    const x = new THREE.Vector3().crossVectors(Y, n).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n)); parent.add(g); return g;
  }
  const faceDecal = (parent, xs, ys, lift = 0.01) => stick(parent, faceDir(xs, ys), lift);
  const helmetDecal = (parent, a, b, lift = 0.004) => stick(parent, new THREE.Vector3(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)), lift);
  const faceGeo = (() => {
    const g = new THREE.PlaneGeometry(1, 1, 40, 32), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { faceDir(-FW + (p.getX(i) + 0.5) * 2 * FW, FT + (0.5 - p.getY(i)) * (FB - FT), v); onHelmet(v, 0.003); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g;
  })();
  const rimGeo = (() => {   // the raised lip framing the face opening
    const pts = [], seg = (x0, y0, x1, y1) => { for (let i = 0; i < 12; i++) pts.push([x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12]); };
    const arc = (cx, cy, a0) => { for (let i = 0; i < 10; i++) { const a = a0 + i / 10 * Math.PI / 2; pts.push([cx + Math.cos(a) * FRR, cy + Math.sin(a) * FRR]); } };
    const x0 = -FX + FRR, x1 = FX - FRR, y0 = FY0 + FRR, y1 = FY1 - FRR;
    seg(x0, FY0, x1, FY0); arc(x1, y0, -Math.PI / 2); seg(FX, y0, FX, y1); arc(x1, y1, 0); seg(x1, FY1, x0, FY1); arc(x0, y1, Math.PI / 2); seg(-FX, y1, -FX, y0); arc(x0, y0, Math.PI);
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => onHelmet(faceDir(x, y), 0.002)), true);
    return new THREE.TubeGeometry(curve, 200, 0.02, 10, true);
  })();
  // ---------- enemy faces ----------
  // Painted like the bombers' faces (colour + relief + gloss, plus an emissive pass for glowing pupils) on a patch
  // of the body's surface, so they read at game size. Face coordinates: x ±1 across the face, y ±(h/w) top → bottom.
  // Expressions: idle, hunt (closing in: angrier eyes, open mouth), hurt (boss hit), dead.
  const ENEMY_FACES = {
    globo: { up: 0.55, w: 2.1, h: 1.47, eyes: 'angry', sep: 0.36, ey: -0.26, rx: 0.2, ry: 0.24, pupil: '#120f22', mouth: 'grin', my: 0.34, mw: 0.78, mh: 0.22, teeth: 6, fangs: true },
    gota: { up: 0.47, w: 2.1, h: 1.47, eyes: 'angry', sep: 0.36, ey: -0.24, rx: 0.19, ry: 0.22, pupil: '#120f22', mouth: 'frown', my: 0.34, mw: 0.52, mh: 0.2, teeth: 5 },
    murci: { up: 0.45, w: 2.51, h: 1.68, eyes: 'angry', sep: 0.38, ey: -0.2, rx: 0.2, ry: 0.2, pupil: '#ff2a1a', glow: true, mouth: 'grin', my: 0.32, mw: 0.48, mh: 0.17, teeth: 4, fangs: true },
    chispa: { up: 0.48, w: 2.32, h: 1.61, eyes: 'angry', sep: 0.36, ey: -0.22, rx: 0.2, ry: 0.19, pupil: '#120f22', mouth: 'grit', my: 0.32, mw: 0.56, mh: 0.2 },
    fantasma: { up: 0.42, w: 2.1, h: 1.61, eyes: 'hollow', sep: 0.36, ey: -0.24, rx: 0.2, ry: 0.13, pupil: '#9fe8ff', glow: true, mouth: 'maw', my: 0.34, mw: 0.42, mh: 0.36, teeth: 4 },
    diablo: { up: 0.52, w: 2.1, h: 1.47, eyes: 'angry', sep: 0.36, ey: -0.26, rx: 0.21, ry: 0.23, pupil: '#ffd23f', glow: true, mouth: 'grin', my: 0.34, mw: 0.8, mh: 0.24, teeth: 6, fangs: true },
    calavera: { up: 0.38, w: 2.22, h: 1.68, eyes: 'sockets', sep: 0.36, ey: -0.2, rx: 0.25, ry: 0.22, pupil: '#ff2a1a', glow: true, mouth: 'nose', my: 0.22 },
    jefe: { brow: '#ff3b3b', up: 0.3, w: 2.1, h: 1.47, eyes: 'angry', sep: 0.36, ey: -0.26, rx: 0.21, ry: 0.24, pupil: '#ff3b3b', glow: true, mouth: 'grin', my: 0.34, mw: 0.86, mh: 0.26, teeth: 7, fangs: true },
  };
  const ENEMY_MODES = ['idle', 'hunt', 'hurt', 'dead'];
  function drawEnemyFace(g, P, sp, mode, def) {
    const pick = (c, h, s, e) => P === 'col' ? c : P === 'h' ? h : P === 's' ? s : e;
    const ell = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); };
    const dead = mode === 'dead', hunt = mode === 'hunt', hurt = mode === 'hurt', INKC = '#14101c', GUM = '#2a0508';
    const browC = sp.brow || '#' + new THREE.Color(def.col).multiplyScalar(0.32).getHexString();
    // eyes
    for (const s of [-1, 1]) {
      const cx = s * sp.sep, cy = sp.ey, rx = sp.rx, ry = sp.ry;
      if (dead || hurt) {   // X eyes, or squeezed > <
        g.strokeStyle = pick(INKC, '#c0c0c0', '#ffffff', '#000'); g.lineWidth = 0.07; g.beginPath();
        if (dead) { g.moveTo(cx - rx * 0.7, cy - ry * 0.6); g.lineTo(cx + rx * 0.7, cy + ry * 0.6); g.moveTo(cx + rx * 0.7, cy - ry * 0.6); g.lineTo(cx - rx * 0.7, cy + ry * 0.6); }
        else { g.moveTo(cx + s * rx * 0.8, cy - ry * 0.55); g.lineTo(cx - s * rx * 0.55, cy); g.lineTo(cx + s * rx * 0.8, cy + ry * 0.55); }
        g.stroke(); continue;
      }
      if (sp.eyes !== 'angry') {   // hollow wraith eyes / skull sockets with a glowing point
        g.fillStyle = pick('#07060c', '#1a1a1a', '#ffffff', '#000'); ell(cx, cy, rx, ry, s * (sp.eyes === 'hollow' ? 0.45 : 0.25)); g.fill();
        const pr = hunt ? 0.075 : 0.055, px = cx - s * rx * 0.15, py = cy + ry * 0.1;
        g.fillStyle = pick(sp.pupil, '#909090', '#ffffff', sp.pupil); ell(px, py, pr, pr); g.fill();
        if (P === 'e') { g.globalAlpha = 0.45; ell(px, py, pr * 2.2, pr * 2.2); g.fill(); g.globalAlpha = 1; }
        continue;
      }
      // angry eye: drawn under a slanted brow line whose inner end dips (lower still when hunting)
      const kin = hunt ? -0.2 : 0.15, ox = cx + s * rx * 1.4, ix = cx - s * rx * 1.4, oy = cy - ry * 0.95, iy = cy - ry * kin;
      g.save(); g.beginPath(); g.moveTo(ox, oy); g.lineTo(ix, iy); g.lineTo(ix, cy + ry * 2); g.lineTo(ox, cy + ry * 2); g.closePath(); g.clip();
      let wf = '#fbf6ea';
      if (P === 'h') { wf = g.createRadialGradient(cx - rx * 0.2, cy - ry * 0.3, 0, cx, cy, ry * 1.2); wf.addColorStop(0, '#e8e8e8'); wf.addColorStop(1, '#787878'); }
      g.fillStyle = pick(wf, wf, '#ffffff', '#000'); ell(cx, cy, rx, ry); g.fill();
      if (P === 'col') { g.strokeStyle = INKC; g.lineWidth = 0.03; g.stroke(); }
      const pr = (hunt ? 0.5 : 0.64) * Math.min(rx, ry), px = cx - s * rx * 0.25, py = cy + ry * 0.18;
      g.fillStyle = pick(sp.pupil, '#ffffff', '#ffffff', sp.glow ? sp.pupil : '#000'); ell(px, py, pr * 0.85, pr); g.fill();
      if (sp.glow && P === 'col') { g.fillStyle = INKC; ell(px, py, pr * 0.2, pr * 0.75); g.fill(); }   // slit
      if (P === 'col' || P === 's') { g.fillStyle = 'rgba(255,255,255,0.9)'; ell(px - pr * 0.3, py - pr * 0.4, pr * 0.22, pr * 0.28); g.fill(); }
      g.restore();
      const bt = 0.085;   // the brow along that line, thicker toward the middle
      g.fillStyle = pick(browC, '#ffffff', '#c8c8c8', '#000'); g.beginPath();
      g.moveTo(ox + s * 0.03, oy - bt * 0.6); g.lineTo(ix - s * 0.03, iy - bt * 1.3); g.lineTo(ix - s * 0.03, iy + 0.015); g.lineTo(ox + s * 0.03, oy + 0.015); g.closePath(); g.fill();
    }
    // mouth
    const my = sp.my, mw = sp.mw || 0.5, mh = (sp.mh || 0.2) * (hunt ? 1.5 : 1), dark = pick(GUM, '#2a2a2a', '#888888', '#000'), tooth = pick('#fffbea', '#e0e0e0', '#ffffff', '#000');
    const teethRow = (y0, dir, n, len, fangs) => { for (let i = 0; i < n; i++) { const x = -mw * 0.42 + i * (mw * 0.84 / Math.max(1, n - 1)), f = fangs && (i === 0 || i === n - 1), l = len * (f ? 1.8 : 1), hw = mw / n * 0.42; g.beginPath(); g.moveTo(x - hw, y0); g.lineTo(x + hw, y0); g.lineTo(x, y0 + dir * l); g.closePath(); g.fill(); } };
    if (dead && sp.mouth !== 'nose') { g.fillStyle = dark; ell(0, my, mw * 0.22, mh * 0.9); g.fill(); return; }
    if (sp.mouth === 'grin') {
      const top = my - mh * 0.35;
      g.beginPath(); g.moveTo(-mw / 2, top); g.quadraticCurveTo(0, my - mh * 0.05, mw / 2, top); g.quadraticCurveTo(0, my + mh * 1.3, -mw / 2, top); g.closePath();
      g.fillStyle = dark; g.fill(); g.save(); g.clip(); g.fillStyle = tooth;
      teethRow(my - mh * 0.25, 1, sp.teeth || 5, mh * 0.45, sp.fangs); if (hunt) teethRow(my + mh * 0.75, -1, (sp.teeth || 5) - 1, mh * 0.3, false);
      g.restore();
    } else if (sp.mouth === 'frown') {
      g.beginPath(); g.moveTo(-mw / 2, my + mh * 0.5); g.quadraticCurveTo(0, my - mh * 1.1, mw / 2, my + mh * 0.5); g.quadraticCurveTo(0, my - mh * 0.1, -mw / 2, my + mh * 0.5); g.closePath();
      g.fillStyle = dark; g.fill(); g.save(); g.clip(); g.fillStyle = tooth; teethRow(my - mh * 0.45, 1, sp.teeth || 5, mh * 0.4, false); g.restore();
    } else if (sp.mouth === 'grit') {   // gritted teeth
      g.fillStyle = tooth; g.beginPath(); g.roundRect(-mw / 2, my - mh / 2, mw, mh, mh * 0.35); g.fill();
      g.strokeStyle = dark; g.lineWidth = 0.025; g.stroke(); g.beginPath(); g.moveTo(-mw / 2, my); g.lineTo(mw / 2, my);
      for (let i = 1; i < 6; i++) { const x = -mw / 2 + i * mw / 6; g.moveTo(x, my - mh / 2); g.lineTo(x, my + mh / 2); } g.stroke();
    } else if (sp.mouth === 'maw') {   // a gaping jagged hole
      ell(0, my, mw / 2, mh / 2); g.fillStyle = dark; g.fill(); g.save(); g.clip(); g.fillStyle = tooth;
      teethRow(my - mh / 2, 1, sp.teeth || 4, mh * 0.28, false); teethRow(my + mh / 2, -1, (sp.teeth || 4) - 1, mh * 0.24, false); g.restore();
    } else if (sp.mouth === 'nose') {   // skull: a dark nose hole and a few cracks
      g.fillStyle = dark; g.beginPath(); g.moveTo(-0.07, my - 0.06); g.lineTo(0.07, my - 0.06); g.lineTo(0, my + 0.08); g.closePath(); g.fill();
      g.strokeStyle = pick('#6a5a44', '#303030', '#666666', '#000'); g.lineWidth = 0.018; g.beginPath(); g.moveTo(0.12, -0.6); g.lineTo(0.18, -0.45); g.lineTo(0.14, -0.38); g.lineTo(0.2, -0.3); g.moveTo(-0.5, -0.5); g.lineTo(-0.42, -0.42); g.stroke();
    }
  }
  const enemyFaceCache = {}, enemyPatchCache = {};
  function enemyFaceTex(type, mode, def) {
    const key = type + '|' + mode;
    if (!enemyFaceCache[key]) {
      const sp = ENEMY_FACES[type], ar = sp.h / sp.w, W = 256, H = Math.round(256 * ar);
      const ctx = [0, 1, 2, 3].map(() => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c.getContext('2d'); });
      ['col', 'h', 's', 'e'].forEach((P, i) => {
        const g = ctx[i]; if (i) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
        g.setTransform(W / 2, 0, 0, W / 2, W / 2, H / 2); g.lineJoin = g.lineCap = 'round';
        drawEnemyFace(g, P, sp, mode, def);
      });
      enemyFaceCache[key] = ctx.map((g, i) => { const t = new THREE.CanvasTexture(g.canvas); if (i === 0 || i === 3) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
    }
    return enemyFaceCache[key];
  }
  // The face patch: a grid over yaw ±w/2 and pitch up ± h/2, laid on the body's ellipsoid (radii R) a hair above it.
  function enemyPatch(type, R) {
    if (enemyPatchCache[type]) return enemyPatchCache[type];
    const sp = ENEMY_FACES[type], g = new THREE.PlaneGeometry(1, 1, 24, 18), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i) * sp.w, b = sp.up + p.getY(i) * sp.h;
      v.set(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b));
      v.multiplyScalar(1 / Math.hypot(v.x / R.x, v.y / R.y, v.z / R.z) + 0.004); p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals(); return (enemyPatchCache[type] = g);
  }
  function enemyFace(o, parent, R, def) {
    if (!ENEMY_FACES[def.id]) return;
    const t = enemyFaceTex(def.id, 'idle', def);
    const m = o.mat(new THREE.MeshPhysicalMaterial({ map: t[0], bumpMap: t[1], bumpScale: 1.4, clearcoat: 1, clearcoatMap: t[2], clearcoatRoughness: 0.08, roughness: 0.5, metalness: 0,
      emissive: '#ffffff', emissiveMap: t[3], emissiveIntensity: 1.1, transparent: true, depthWrite: false, envMap: env, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    const fm = new THREE.Mesh(enemyPatch(def.id, R), m); fm.renderOrder = 2; parent.add(fm);   // after the (sometimes see-through) body
    o.face = { m, mode: 'idle' };
  }

  // ---------- bombers ----------
  function makeBomber(pal) {
    const style = pal.style || 'classic', root = new THREE.Group(), tilt = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(yaw); yaw.add(body); tilt.rotation.x = -TILT; root.scale.setScalar(SCALE);
    const white = M('suitWhite', () => satin('#f7f7fb'));
    const stripe = M('stripe', () => satin('#c6bff0'));
    const suit = M('suit' + pal.suit, () => satin(pal.suit, { side: THREE.DoubleSide })), shirt = M('shirt' + pal.shirt, () => satin(pal.shirt, { roughness: 0.55, clearcoat: 0.2 }));
    const glove = M('glove' + pal.glove, () => glossy(pal.glove)), boot = M('boot' + pal.boot, () => glossy(pal.boot));
    // legs: slim white with two stripes at the knee, chunky cuffed boots with a rounded toe
    const legs = [-1, 1].map(s => {
      const hip = new THREE.Group(); hip.position.set(s * 0.068, 0.37, 0); body.add(hip);
      capsule(hip, white, 0.048, 0.3, 0, -0.14, 0);
      for (const y of [-0.15, -0.18]) mesh(ring, stripe, hip, 0, y, 0, 0.049, 0.049, 0.06).rotation.x = Math.PI / 2;
      const foot = new THREE.Group(); foot.position.y = -0.3; hip.add(foot);
      mesh(cyl, boot, foot, 0, 0.035, 0, 0.068, 0.075, 0.068);
      mesh(ring, boot, foot, 0, 0.072, 0, 0.068, 0.068, 0.12).rotation.x = Math.PI / 2;
      mesh(sph, boot, foot, 0, 0.0, 0.05, 0.092, 0.066, 0.13);
      return hip;
    });
    // torso: shirt, open short-sleeved jacket, belt with a big gold buckle
    const torso = new THREE.Group(); torso.position.y = 0.52; body.add(torso);
    const classic = style === 'classic', bw = classic ? 0.142 : 0.112, bd = classic ? 0.122 : 0.092;
    if (classic) mesh(sph, suit, torso, 0, -0.005, 0, 0.165, 0.165, 0.142);   // the hero: a round, all-blue suit
    else {
      mesh(cap, shirt, torso, 0, 0.0, 0, 0.21, 0.12, 0.17);
      mesh(new THREE.CylinderGeometry(1, 1.06, 1, 24, 1, true, 0.62, Math.PI * 2 - 1.24), suit, torso, 0, 0.02, 0, 0.122, 0.2, 0.1);
      for (const s of [-1, 1]) { const lap = mesh(box, suit, torso, s * 0.05, 0.09, 0.093, 0.045, 0.06, 0.012); lap.rotation.set(-0.25, 0, s * 0.5); }   // collar flaps
    }
    mesh(cyl, INK, torso, 0, -0.1, 0, bw, 0.042, bd);
    mesh(box, GOLD, torso, 0, -0.1, bd + 0.002, 0.07, 0.05, 0.014); mesh(box, INK, torso, 0, -0.1, bd + 0.009, 0.038, 0.024, 0.006);
    mesh(sph, white, torso, 0, -0.15, 0, 0.1, 0.06, 0.085);
    // arms: short sleeve, slim white arm with a stripe, big cuffed boxing-glove mitten
    const arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.position.set(s * 0.14, 0.61, 0); body.add(sh);
      if (!classic) { mesh(new THREE.CylinderGeometry(1, 1.15, 1, 16, 1, true), suit, sh, 0, -0.03, 0, 0.05, 0.08, 0.05); mesh(sph, suit, sh, 0, 0.0, 0, 0.05); }
      capsule(sh, white, 0.032, 0.2, 0, -0.1, 0);
      mesh(ring, stripe, sh, 0, -0.12, 0, 0.033, 0.033, 0.05).rotation.x = Math.PI / 2;
      const hand = new THREE.Group(); hand.position.y = -0.22; sh.add(hand);
      mesh(cyl, glove, hand, 0, 0.03, 0, 0.05, 0.05, 0.05);
      mesh(sph, glove, hand, 0, -0.03, 0.012, 0.075, 0.08, 0.072);
      mesh(sph, glove, hand, -s * 0.06, -0.01, 0.04, 0.03, 0.035, 0.03);
      sh.rotation.z = s * 0.14;
      return { sh, hand };
    });
    // head: the helmet with its framed face opening; the sprite's face is painted inside, with relief (bump) and
    // gloss (clearcoat) maps so the eyes and brows catch the light like moulded, lacquered shapes
    const HR = HEAD_R, head = new THREE.Group(); head.position.y = 0.91; body.add(head);
    const helmetMat = M('helmet', () => glossy('#ffffff', { roughness: 0.3, clearcoat: 0.9, envMapIntensity: 0.9 }));
    mesh(helmetGeo, helmetMat, head); mesh(rimGeo, helmetMat, head);
    const face = faceTex(pal, style, 'normal');
    const faceMat = new THREE.MeshPhysicalMaterial({ map: face[0], bumpMap: face[1], bumpScale: 1.6, clearcoat: 1, clearcoatMap: face[2], clearcoatRoughness: 0.08, roughness: 0.6, metalness: 0, alphaTest: 0.5, envMap: env, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    head.add(new THREE.Mesh(faceGeo, faceMat));
    const eyes = [];
    let antenna = null;
    if (style === 'classic') {
      antenna = new THREE.Group(); antenna.position.y = HR.y - 0.03; head.add(antenna);
      mesh(cone, white, antenna, 0, 0.07, 0, 0.055, 0.16, 0.055);
      mesh(sph, M('ball' + pal.ball, () => glossy(pal.ball, { clearcoat: 1, emissive: pal.ball, emissiveIntensity: 0.2 })), antenna, 0, 0.2, 0, 0.075);
    } else if (style === 'punk') {
      antenna = new THREE.Group(); antenna.position.y = HR.y - 0.08; head.add(antenna);
      const crest = M('crest' + pal.ball, () => glossy(pal.ball));
      for (const [z, len, a] of [[0.12, 0.2, 0.5], [0.02, 0.27, 0.15], [-0.09, 0.26, -0.2], [-0.19, 0.2, -0.55]]) { const c = mesh(cone, crest, antenna, 0, 0.08, z, 0.045, len, 0.06); c.rotation.x = a; }
      const band = mesh(box, M('bandage', () => matte('#fff4e0')), faceDecal(head, 0.14, 0.1), 0, 0, 0, 0.08, 0.026, 0.008); band.rotation.z = -0.5;
      mesh(new THREE.TorusGeometry(1, 0.35, 10, 24), M('scarf' + pal.ball, () => satin(pal.ball)), body, 0, 0.66, 0, 0.11, 0.11, 0.1).rotation.x = Math.PI / 2;
    } else if (style === 'ninja') {
      const bandMat = M('band' + pal.band, () => matte(pal.band));
      const BB = 0.8, bd = new THREE.Vector3(0, Math.sin(BB), Math.cos(BB)), bp = onHelmet(bd.clone(), 0), br = bp.z * 1.01;   // band along the top of the visor
      mesh(new THREE.TorusGeometry(1, 0.07, 8, 36), bandMat, head, 0, bp.y, 0, br, br, br * HR.z / HR.x).rotation.x = Math.PI / 2;
      const plate = mesh(box, M('plate', () => new THREE.MeshStandardMaterial({ color: '#dfe6f0', roughness: 0.2, metalness: 1, envMap: env })), helmetDecal(head, 0, BB, 0.012), 0, 0, 0, 0.12, 0.06, 0.012);
      antenna = new THREE.Group(); antenna.position.set(0, bp.y, -br); head.add(antenna);
      for (const s of [-1, 1]) { const t = mesh(box, bandMat, antenna, s * 0.035, -0.04, -0.1, 0.035, 0.015, 0.2); t.rotation.set(0.5, s * 0.3, 0); }
    } else if (style === 'king') {
      antenna = new THREE.Group(); antenna.position.y = HR.y - 0.06; head.add(antenna);
      mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.08, 24, 1, true), GOLD, antenna, 0, 0.03, 0);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone, GOLD, antenna, Math.sin(a) * 0.14, 0.11, Math.cos(a) * 0.14, 0.032, 0.09, 0.032); mesh(sphLo, M('gem', () => glossy('#e0204a', { emissive: '#ff2050', emissiveIntensity: 0.3 })), antenna, Math.sin(a) * 0.148, 0.035, Math.cos(a) * 0.148, 0.022); }
      const mus = M('moustache', () => matte('#5e360c'));
      for (const s of [-1, 1]) { const m = mesh(sphLo, mus, faceDecal(head, s * 0.06, 0.13), 0, 0, 0, 0.065, 0.026, 0.02); m.rotation.z = s * 0.3; }
      const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, 0.42, 20, 4, true, Math.PI * 0.62, Math.PI * 0.76), M('cape' + pal.ball, () => satin(pal.ball, { side: THREE.DoubleSide, roughness: 0.6 })));
      cape.position.set(0, 0.42, -0.02); body.add(cape); antenna.userData.cape = cape;
    }
    const shield = new THREE.Mesh(sph, M('shield', () => new THREE.MeshPhysicalMaterial({ color: '#3df5ff', transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, envMap: env, emissive: '#3df5ff', emissiveIntensity: 0.25, depthWrite: false })));
    shield.position.y = 0.55; shield.scale.setScalar(0.66); shield.visible = false; body.add(shield);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.37, 40).rotateX(-Math.PI / 2), M('ring' + pal.trim, () => new THREE.MeshBasicMaterial({ color: pal.trim, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false })));
    halo.position.y = 0.015; root.add(halo);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.y = 0.012; shadow.scale.setScalar(0.6); root.add(shadow);
    scene.add(root);
    return { root, yaw, body, legs, arms, head, eyes, antenna, shield, ring: halo, shadow, style, mats: [faceMat], faceMat, faceMode: 'normal', yawNow: 0, lx: null, ly: 0, av: 0, ao: 0, mv: 0, bob: Math.random() * 6 };
  }
  // ---------- the hero model (glTF, rigged and animated) ----------
  // The bomber's face, painted with the 2D sprite's shapes (index.html drawBomber) into three canvases wrapped over
  // the face opening: colour, height (bump: eyes domed, brows raised) and gloss (clearcoat on eyes and brows).
  // Every expression is painted once per palette and kept: a face change (a blink, the worried look when a bomb
  // lands nearby) only swaps textures, instead of repainting and re-uploading three canvases mid-game.
  const faceCache = {}, FACE_MODES = ['normal', 'worried', 'blink', 'happy', 'dead'];
  function faceTex(pal, style, mode) {
    const key = style + '|' + (pal.ball || '') + '|' + mode;
    if (!faceCache[key]) { const f = makeFace(); paintFace(f, mode, pal, style); faceCache[key] = f.tex; }
    return faceCache[key];
  }
  function makeFace() {
    const ctx = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * (FB - FT) / (2 * FW)); return c.getContext('2d'); });
    const tex = ctx.map((g, i) => { const t = new THREE.CanvasTexture(g.canvas); if (!i) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
    return { col: ctx[0], h: ctx[1], s: ctx[2], tex };
  }
  function paintFace(f, mode, pal, style) {
    for (const pass of ['col', 'h', 's']) {
      const g = f[pass], c = g.canvas; g.setTransform(1, 0, 0, 1, 0, 0);
      if (pass === 'col') g.clearRect(0, 0, c.width, c.height); else { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
      g.setTransform(FPX, 0, 0, FPX, FW * FPX, -FT * FPX); g.lineJoin = g.lineCap = 'round';
      drawFace(g, pass, mode, pal, style);
    }
    for (const t of f.tex) t.needsUpdate = true;
  }
  function drawFace(g, P, mode, pal, style) {
    const OUT = '#1a1530', ninja = style === 'ninja', col = P === 'col';
    const pick = (c, h, s) => P === 'col' ? c : P === 'h' ? h : s;
    const ell = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
    const line = (pts, w) => { g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); };
    // skin (or the ninja's visor), darkening into the rim like a recessed plate
    g.beginPath(); g.roundRect(-FX, FY0, FX * 2, FY1 - FY0, FRR);
    let fill = '#606060';
    if (col) { fill = g.createLinearGradient(0, FY0, 0, FY1); if (ninja) { fill.addColorStop(0, '#2a3a52'); fill.addColorStop(1, '#070b14'); } else { fill.addColorStop(0, '#ffe2d6'); fill.addColorStop(1, '#f2b19c'); } }
    g.fillStyle = P === 's' ? (ninja ? '#fff' : '#000') : fill; g.fill();
    if (col) { g.save(); g.clip(); g.strokeStyle = ninja ? 'rgba(0,0,0,0.5)' : 'rgba(120,50,50,0.28)'; g.lineWidth = 0.07; g.stroke(); g.restore(); }
    const ey = 0.045;
    for (const ex of [-0.085, 0.085]) {
      const sg = Math.sign(ex);
      if (ninja) {                               // glowing visor slits
        g.fillStyle = g.strokeStyle = pick(pal.ball, '#909090', '#fff');
        if (mode === 'normal') { g.beginPath(); g.moveTo(ex + sg * 0.06, ey - 0.045); g.lineTo(ex - sg * 0.055, ey - 0.01); g.lineTo(ex - sg * 0.05, ey + 0.025); g.lineTo(ex + sg * 0.06, ey + 0.01); g.closePath(); g.fill(); }
        else if (mode === 'worried') { ell(ex, ey, 0.04, 0.045); g.fill(); }
        else if (mode === 'happy') { g.lineWidth = 0.03; g.beginPath(); g.arc(ex, ey + 0.025, 0.045, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
        else if (mode === 'blink') line([[ex - 0.045, ey], [ex + 0.045, ey]], 0.03);
        else { line([[ex - 0.035, ey - 0.035], [ex + 0.035, ey + 0.035]], 0.03); line([[ex + 0.035, ey - 0.035], [ex - 0.035, ey + 0.035]], 0.03); }
        continue;
      }
      g.fillStyle = g.strokeStyle = pick(OUT, '#c8c8c8', '#fff');
      if (mode === 'normal' || mode === 'worried') {
        const ry = mode === 'worried' ? 0.072 : 0.09, rx = mode === 'worried' ? 0.05 : 0.043;
        if (col) { g.fillStyle = 'rgba(110,40,40,0.25)'; ell(ex + 0.006, ey + 0.012, rx * 1.08, ry * 1.04); g.fill(); }   // soft contact shadow
        let eye = '#fff';
        if (P === 'h') { eye = g.createRadialGradient(ex - 0.01, ey - 0.02, 0, ex, ey, ry * 1.1); eye.addColorStop(0, '#ffffff'); eye.addColorStop(1, '#8a8a8a'); }
        g.fillStyle = col ? '#120f22' : eye; ell(ex, ey, rx, ry); g.fill();
        if (P !== 'h') { g.fillStyle = col ? 'rgba(255,255,255,0.9)' : '#fff'; ell(ex - 0.012, ey - ry * 0.45, 0.012, 0.022); g.fill(); }
        const brow = dy => { g.beginPath();        // thick tapered brow
          if (mode === 'normal') { g.moveTo(ex + sg * 0.075, ey - 0.16 + dy); g.lineTo(ex - sg * 0.055, ey - 0.11 + dy); g.lineTo(ex - sg * 0.05, ey - 0.088 + dy); g.lineTo(ex + sg * 0.07, ey - 0.135 + dy); }
          else { g.moveTo(ex + sg * 0.07, ey - 0.105 + dy); g.lineTo(ex - sg * 0.05, ey - 0.15 + dy); g.lineTo(ex - sg * 0.05, ey - 0.128 + dy); g.lineTo(ex + sg * 0.07, ey - 0.085 + dy); }
          g.closePath(); g.fill(); };
        if (col) { g.fillStyle = 'rgba(110,40,40,0.25)'; brow(0.012); }
        g.fillStyle = pick(OUT, '#d8d8d8', '#ccc'); brow(0);
      } else if (mode === 'happy') { g.lineWidth = 0.032; g.beginPath(); g.arc(ex, ey + 0.025, 0.045, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      else if (mode === 'blink') line([[ex - 0.04, ey], [ex + 0.04, ey]], 0.028);
      else { line([[ex - 0.035, ey - 0.035], [ex + 0.035, ey + 0.035]], 0.028); line([[ex + 0.035, ey - 0.035], [ex - 0.035, ey + 0.035]], 0.028); }
    }
    if (ninja && col) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(-0.17, -0.12); g.lineTo(-0.08, -0.12); g.lineTo(-0.15, 0.15); g.lineTo(-0.19, 0.1); g.fill(); }
  }
  // models/bomber-animado.glb: the owner's Bomber (models/bomber.blend) with the rig and clips added by
  // tools/rig_bomber.py — idle, caminar, correr, poner_bomba, victoria, dano, morir — played with an AnimationMixer.
  const HEAD_UP = -0.45;   // radians; negative lifts the face toward the camera
  const hq1 = new THREE.Quaternion(), hq2 = new THREE.Quaternion(), hq3 = new THREE.Quaternion(), hax = new THREE.Vector3();
  const GLB_SCALE = 0.31;   // model units (Blender metres, 5.5 tall) → tiles (about 1.7 tall, head ~0.65 wide)
  let heroTpl = null, heroClips = [], onReady = null;
  const MODEL_REV = 6;   // bump when the model changes, so no browser keeps a stale copy
  const loader = new GLTFLoader(), heroUrl = f => new URL('../models/' + f + '?v=' + MODEL_REV, import.meta.url).href;
  const onHero = g => {
    heroTpl = g.scene; heroClips = g.animations;
    heroTpl.traverse(m => {
      if (!m.isMesh || !m.material) return;
      const mt = m.material, dark = mt.color.r + mt.color.g + mt.color.b < 0.1;
      mt.envMap = env; mt.envMapIntensity = 0.75;
      if (dark) { mt.roughness = 0.85; mt.envMapIntensity = 0.05; if ('clearcoat' in mt) mt.clearcoat = 0; }   // inky eyes stay black, no sheen across them
      // Brows, eyes and glints sit a hair above the face plate; from the far game camera the depth buffer can't tell
      // them apart and the skin would stripe through. Draw them as decals that always win over the face.
      if (/^(Ceja|Ojo.negro|Reflejo.ojo)/.test(m.name)) {
        m.material = mt.clone(); Object.assign(m.material, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }); m.renderOrder = 1;
      }
    });
    if (onReady) onReady();
  };
  // .glb normally; hosts that won't serve .glb get the same model as embedded glTF JSON. Failing both, the procedural rig stays.
  // Off for now: the bombers are the 2D sprite's design built in 3D (makeBomber). Set true to use the Blender model.
  const HERO_GLB = false;
  if (HERO_GLB) loader.load(heroUrl('bomber-animado.glb'), onHero, undefined, () => loader.load(heroUrl('bomber-animado.json'), onHero, undefined, () => {}));
  const partOf = m => { for (let n = m; n; n = n.parent) { const k = /^(pierna|brazo|antena|cabeza|torso|cadera|bomba)/.exec(n.name); if (k) return k[1]; } return ''; };
  // Rivals: the Bomber's materials recoloured from their palette (pink → boots / gloves / antenna, blue → jacket…).
  function recolor(mat, pal, part) {
    const key = pal.name + '|' + mat.name + '|' + part;
    if (mats[key]) return mats[key];
    const m = mat.clone(), set = c => m.color.copy(vivid(c));
    switch (mat.name) {
      case 'Rosa caramelo': set(part === 'pierna' ? pal.boot : part === 'brazo' ? pal.glove : pal.ball); break;
      case 'Chaqueta azul': set(pal.suit); break;
      case 'Traje lavanda': set(pal.shirt); m.color.lerp(C2.copy(vivid(pal.suit)), 0.25); break;
    }
    return (mats[key] = m);
  }
  // Accessories are placed in model space (glTF metres, Y up, face toward +Z) and then handed to the bone they ride on.
  function accessory(model, bone, obj) { model.add(obj); model.updateMatrixWorld(true); bone.attach(obj); return obj; }
  function makeHeroGLB(pal) {
    const style = pal.style || 'classic', root = new THREE.Group(), tilt = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(yaw); yaw.add(body); tilt.rotation.x = -TILT;
    const model = heroTpl.clone(true);
    const bone = n => { let b = null; model.traverse(o => { if (!b && o.name.startsWith(n)) b = o; }); return b; };
    const head = bone('cabeza'), torso = bone('torso'), antenna = bone('antena');
    let extra = null;
    if (style !== 'classic') {
      model.traverse(m => {
        if (!m.isMesh) return;
        m.material = recolor(m.material, pal, partOf(m));
        if (style === 'ninja') {   // dark glass visor, glowing eye slits, no brows or eye glints
          if (m.name.startsWith('Placa_rostro') || m.name.startsWith('Placa rostro')) m.material = M('ninjaVisor', () => glossy('#141f33', { roughness: 0.18, clearcoat: 1 }));
          else if (/^Ojo.negro/.test(m.name)) m.material = M('ninjaEye' + pal.ball, () => new THREE.MeshBasicMaterial({ color: pal.ball, toneMapped: false }));
          else if (/^(Ceja|Reflejo.ojo)/.test(m.name)) m.visible = false;
        }
      });
      antenna.visible = false;
      extra = new THREE.Group();
      if (style === 'punk') {   // spiky crest along the helmet, scarf
        const crest = M('crest' + pal.ball, () => glossy(pal.ball));
        [[0.5, 0.75, 0.55], [0.15, 0.95, 0.18], [-0.2, 0.9, -0.2], [-0.52, 0.72, -0.6]].forEach(([z, len, a]) => { const c = mesh(cone, crest, extra, -0.1, 4.55 + len * 0.3, z, 0.18, len, 0.26); c.rotation.x = a; });
        accessory(model, head, extra);
        accessory(model, torso, mesh(new THREE.TorusGeometry(1, 0.3, 10, 28), M('scarf' + pal.ball, () => satin(pal.ball)), new THREE.Group(), 0, 2.86, 0.02, 0.46, 0.46, 0.38)).rotation.x = Math.PI / 2;
      } else if (style === 'ninja') {   // headband with a steel plate
        const bandMat = M('band' + pal.band, () => matte(pal.band)), g = new THREE.Group(); g.position.set(-0.08, 4.12, 0); g.scale.set(1.04, 1, 0.74); extra.add(g);
        mesh(new THREE.TorusGeometry(1, 0.07, 8, 40), bandMat, g).rotation.x = Math.PI / 2;
        mesh(box, M('plate', () => new THREE.MeshStandardMaterial({ color: '#dfe6f0', roughness: 0.2, metalness: 1, envMap: env })), extra, -0.07, 4.12, 0.74, 0.4, 0.18, 0.05);
        for (const s2 of [-1, 1]) { const t2 = mesh(box, bandMat, extra, -0.08 + s2 * 0.1, 4.0, -0.95, 0.1, 0.05, 0.55); t2.rotation.set(0.5, s2 * 0.3, 0); }
        accessory(model, head, extra);
      } else if (style === 'king') {   // gem-set crown, moustache, royal cape
        mesh(new THREE.CylinderGeometry(0.52, 0.48, 0.26, 28, 1, true), GOLD, extra, -0.12, 4.62, 0);
        const gem = M('gem', () => glossy('#e0204a', { emissive: '#ff2050', emissiveIntensity: 0.3 }));
        for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone, GOLD, extra, -0.12 + Math.sin(a) * 0.5, 4.88, Math.cos(a) * 0.5, 0.1, 0.28, 0.1); mesh(sphLo, gem, extra, -0.12 + Math.sin(a) * 0.53, 4.62, Math.cos(a) * 0.53, 0.065); }
        const mus = M('moustache', () => matte('#5e360c'));
        for (const s2 of [-1, 1]) { const m = mesh(sphLo, mus, extra, -0.06 + s2 * 0.2, 3.2, 0.74, 0.21, 0.075, 0.07); m.rotation.z = s2 * 0.3; }
        accessory(model, head, extra);
        const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.78, 1.25, 20, 4, true, Math.PI * 0.62, Math.PI * 0.76), M('cape' + pal.ball, () => satin(pal.ball, { side: THREE.DoubleSide, roughness: 0.6 })));
        cape.position.set(0, 2.25, -0.05); accessory(model, torso, cape);
      }
    }
    model.scale.setScalar(GLB_SCALE); body.add(model);
    const mixer = new THREE.AnimationMixer(model), acts = {};
    for (const c of heroClips) acts[c.name] = mixer.clipAction(c);
    for (const n of ['poner_bomba', 'dano', 'morir']) if (acts[n]) { acts[n].setLoop(THREE.LoopOnce); acts[n].clampWhenFinished = true; }
    const shield = new THREE.Mesh(sph, M('shield', () => new THREE.MeshPhysicalMaterial({ color: '#3df5ff', transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, envMap: env, emissive: '#3df5ff', emissiveIntensity: 0.25, depthWrite: false })));
    shield.position.y = 0.75; shield.scale.setScalar(0.85); shield.visible = false; body.add(shield);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.37, 40).rotateX(-Math.PI / 2), M('ring' + pal.trim, () => new THREE.MeshBasicMaterial({ color: pal.trim, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false })));
    halo.position.y = 0.015; root.add(halo);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.y = 0.012; shadow.scale.setScalar(0.6); root.add(shadow);
    scene.add(root);
    return { root, yaw, body, mixer, acts, head, cur: null, placeEnd: 0, lastPlace: 0, shield, ring: halo, shadow, style, glb: true, yawNow: 0, headRest: head ? head.quaternion.clone() : null };
  }
  // Which clip the game state calls for, cross-faded; walking and running play at the bomber's speed.
  function animateHero(o, p, st, dt) {
    const t = st.t;
    o.root.position.set(p.x + 0.5, 0, p.y + 0.5);
    if ((p.placeT || 0) > (o.lastPlace || 0)) o.placeEnd = t + 0.45;   // just set a bomb down
    o.lastPlace = p.placeT || 0;
    if (p.placeT > 0) p.placeT -= dt;   // cosmetic crouch timer (the 2D painter used to wind it down)
    const dance = p.winner || (st.phase === 'clear' && p.human);
    turn(o, dance ? 0 : FACE_YAW[p.face || 0], dt);
    const run = (p.speed || 3.3) > 4.3;
    const want = !p.alive ? 'morir' : dance ? 'victoria' : t < o.placeEnd ? 'poner_bomba' : p.moving ? (run ? 'correr' : 'caminar') : 'idle';
    const next = o.acts[want];
    if (next && want !== o.cur) {
      const prev = o.cur && o.acts[o.cur];
      next.reset().setEffectiveWeight(1).play();
      if (prev) next.crossFadeFrom(prev, want === 'poner_bomba' ? 0.08 : 0.16, false);
      o.cur = want;
    }
    if (next) next.setEffectiveTimeScale(want === 'caminar' ? (p.speed || 3.3) / 2.3 : want === 'correr' ? (p.speed || 5) / 3.6 : want === 'poner_bomba' ? 2.3 : 1);
    if (o.head) o.head.quaternion.copy(o.headRest);   // clips may not key the head, so the tilt below must not accumulate
    o.mixer.update(dt);
    // The game camera looks down steeply, which squashes the face until the brows sit on the eyes. Tip the head
    // back toward the camera, on top of whatever clip plays, so the face reads as it does in the front render.
    if (o.head) {   // about the body's own side-to-side axis, expressed in the head's parent space
      const inv = o.head.parent.getWorldQuaternion(hq1).invert();
      hax.set(1, 0, 0).applyQuaternion(o.body.getWorldQuaternion(hq2)).applyQuaternion(inv).normalize();
      o.head.quaternion.premultiply(hq3.setFromAxisAngle(hax, HEAD_UP));
    }
    let vis = !(p.alive && p.inv > 0 && Math.floor(t * 20) % 2);
    if (!p.alive && p.deadT > 1.7) vis = false;
    o.root.visible = vis;
    o.shield.visible = p.alive && p.shieldT > 0 && (p.shieldT > 3 || Math.floor(t * 10) % 2 === 0);
    if (o.shield.visible) o.shield.scale.setScalar(0.85 + Math.sin(t * 8) * 0.02);
    o.ring.visible = p.alive && p.human && st.mode !== 'demo'; o.ring.material.opacity = 0.45 + 0.2 * Math.sin(t * 4);
  }

  const FACE_YAW = [0, -Math.PI / 2, Math.PI / 2, Math.PI];   // DIRS order: down (+z), left, right, up
  const turn = (o, target, dt) => { let d = target - o.yawNow; d = Math.atan2(Math.sin(d), Math.cos(d)); o.yawNow += d * Math.min(1, dt * 14); o.yaw.rotation.y = o.yawNow; };
  function poseBomber(o, p, st, dt) {
    const t = st.t;
    o.root.position.set(p.x + 0.5, 0, p.y + 0.5);
    const vx = o.lx === null || dt <= 0 ? 0 : (p.x - o.lx) / dt, vz = o.lx === null || dt <= 0 ? 0 : (p.y - o.ly) / dt; o.lx = p.x; o.ly = p.y;
    if (p.placeT > 0) p.placeT -= dt;   // cosmetic crouch timer (the 2D painter used to wind it down)
    o.mv += ((p.moving ? 1 : 0) - o.mv) * Math.min(1, dt * 8);
    const dance = p.winner || (st.phase === 'clear' && p.human);
    turn(o, dance ? 0 : FACE_YAW[p.face || 0], dt);
    // antenna / crest spring: lags behind sudden moves
    const sp = Math.hypot(vx, vz);
    o.av += ((-Math.min(6, sp) * 0.06 - o.ao) * 170 - o.av * 9) * dt; o.ao = Math.max(-0.45, Math.min(0.45, o.ao + o.av * dt));
    if (o.antenna) { o.antenna.rotation.x = o.style === 'ninja' ? 0.3 + o.mv * 0.6 + Math.sin(t * 14) * 0.1 * o.mv : -o.ao; if (o.antenna.userData.cape) o.antenna.userData.cape.rotation.x = -o.mv * 0.35 - Math.sin(t * 9) * 0.04 * o.mv; }
    const ph = (p.moving ? p.walk : 0) * Math.PI, sw = Math.sin(ph), cw = Math.cos(ph);
    const crouch = p.placeT > 0 ? Math.sin(Math.max(0, p.placeT) / 0.22 * Math.PI) : 0;
    let bob = p.moving ? Math.abs(cw) * 0.04 : Math.sin(t * 2.6 + o.bob) * 0.008, armUp = 0;
    if (dance) { bob = Math.abs(Math.sin(t * 8 + o.bob)) * 0.2; armUp = 1; }
    o.body.position.y = bob - crouch * 0.06;
    o.body.scale.set(1 + crouch * 0.06, 1 - crouch * 0.1 + (p.moving ? 0 : Math.sin(t * 2.6 + o.bob) * 0.008), 1 + crouch * 0.06);
    o.body.rotation.x = p.moving ? 0.14 * o.mv : 0;   // lean into the run
    o.legs.forEach((l, i) => { const s = i ? 1 : -1; l.rotation.x = p.moving ? s * sw * 0.8 : 0; });
    o.arms.forEach((a, i) => {
      const s = i ? 1 : -1;
      a.sh.rotation.x = armUp ? -2.6 + Math.sin(t * 8 + s) * 0.3 : (p.moving ? -s * sw * 0.85 : Math.sin(t * 2.6 + o.bob) * 0.04) - crouch * 0.6;
      a.sh.rotation.z = s * (armUp ? 0.4 : o.armZ ?? 0.14);
    });
    o.head.rotation.y = !p.moving && !dance && p.alive ? Math.sin(t * 0.8 + o.bob) * 0.15 : 0;
    o.head.position.y = (o.headY ?? 0.91) + (p.moving ? cw * (o.headBob ?? 0.008) : 0);
    // eyes: blink, squint when dancing or dead
    const blink = Math.sin(t * 1.3 + o.bob * 3) > 0.985;
    if (o.faceMat) {   // the sprite's expressions: dead ×, happy arcs, worried when standing in a blast's path, blink
      let danger = false;
      if (p.alive && st.danger && !p.calm) { const j = Math.round(p.y) * st.cols + Math.round(p.x); danger = j >= 0 && j < st.danger.length && st.danger[j] < 1.2; }
      const mode = !p.alive ? 'dead' : dance ? 'happy' : danger ? 'worried' : blink ? 'blink' : 'normal';
      if (mode !== o.faceMode) { o.faceMode = mode; const t = faceTex(o.pal || {}, o.style, mode), m = o.faceMat; m.map = t[0]; m.bumpMap = t[1]; m.clearcoatMap = t[2]; }
    }
    // death: spin up and shrink away; invincibility blink; shield bubble
    let vis = true, sc = SCALE;
    if (!p.alive) { const k = p.deadT; if (k > 1.4) vis = false; o.yawNow += dt * 14; o.yaw.rotation.y = o.yawNow; sc = SCALE * Math.max(0, 1 - Math.max(0, k - 0.45) / 0.95); o.body.position.y += k * 0.5; }
    else if (p.inv > 0 && Math.floor(t * 20) % 2) vis = false;
    o.root.visible = vis; o.root.scale.setScalar(Math.max(0.0001, sc));
    o.shield.visible = p.alive && p.shieldT > 0 && (p.shieldT > 3 || Math.floor(t * 10) % 2 === 0);
    if (o.shield.visible) o.shield.scale.setScalar((o.glb ? 0.85 : 0.66) + Math.sin(t * 8) * 0.02);
    o.ring.visible = p.alive && p.human && st.mode !== 'demo'; o.ring.material.opacity = 0.45 + 0.2 * Math.sin(t * 4);
    o.shadow.scale.setScalar(0.6 * (1 - Math.min(0.5, bob)));
  }

  // ---------- enemies ----------
  // Each enemy: { root, yaw, body, mats (cloned, for the burn tint), face, anim(t, e) }. They scowl and bare teeth.
  const dark = (c, k) => new THREE.Color(c).multiplyScalar(k);
  const EN = {
    globo(o, c) {   // a sinister balloon: scowling eyes and a jagged grin
      const m = o.mat(glossy(c.col, { clearcoat: 1 })), R = new THREE.Vector3(0.29, 0.31, 0.28), g = new THREE.Group(); g.position.y = 0.3; o.body.add(g);
      o.float = 0.42; mesh(sph, m, g, 0, 0, 0, R.x, R.y, R.z);
      mesh(cone, m, o.body, 0, -0.01, 0, 0.05, 0.07, 0.05).rotation.x = Math.PI;
      o.body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0.04, -0.14, 0), new THREE.Vector3(-0.03, -0.26, 0.02), new THREE.Vector3(0.02, -0.36, 0)]), 12, 0.008, 5), o.mat(matte('#e9dcc6'))));
      enemyFace(o, g, R, c);
      o.anim = (t, e) => { o.body.rotation.z = Math.sin(t * 2 + e.bob) * 0.12; o.body.position.y = o.float + Math.sin(t * 3 + e.bob) * 0.05; };
    },
    gota(o, c) {   // a sullen drop with a heavy brow and a frown full of teeth
      const m = o.mat(glossy(c.col, { transparent: true, opacity: 0.9, clearcoat: 1, roughness: 0.1, envMapIntensity: 1.4 }));
      const pts = [];   // drop profile, bottom to tip: a round belly tapering to a point
      for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * 0.27), 0.3 - Math.cos(a) * 0.28)); }
      for (let i = 1; i <= 10; i++) { const u = i / 10; pts.push(new THREE.Vector2(Math.max(0.001, 0.27 * Math.pow(1 - u, 1.3)), 0.3 + u * 0.36)); }
      mesh(new THREE.LatheGeometry(pts, 28), m, o.body);
      const R = new THREE.Vector3(0.265, 0.27, 0.265), g = new THREE.Group(); g.position.y = 0.3; o.body.add(g);
      enemyFace(o, g, R, c);
      o.anim = (t, e) => { const s = Math.sin(t * 6 + e.bob); o.body.scale.set(1 + s * 0.06, 1 - s * 0.07, 1 + s * 0.06); };
    },
    murci(o, c) {   // a bat with blazing red eyes and long fangs
      const m = o.mat(glossy(c.col)), wing = o.mat(matte(dark(c.col, 0.5), { side: THREE.DoubleSide })), R = new THREE.Vector3(0.2, 0.19, 0.18);
      o.float = 0.5; mesh(sph, m, o.body, 0, 0, 0, R.x, R.y, R.z);
      for (const s of [-1, 1]) mesh(cone, m, o.body, s * 0.1, 0.18, 0, 0.05, 0.16, 0.04).rotation.z = -s * 0.3;
      const sh = new THREE.Shape(); sh.moveTo(0, 0.05); sh.quadraticCurveTo(0.2, 0.18, 0.44, 0.14); sh.lineTo(0.38, 0.0); sh.quadraticCurveTo(0.32, 0.04, 0.27, -0.05); sh.quadraticCurveTo(0.21, 0.0, 0.16, -0.07); sh.quadraticCurveTo(0.08, -0.02, 0, -0.05); sh.closePath();
      const wg = new THREE.ShapeGeometry(sh, 6);
      o.wings = [-1, 1].map(s => { const piv = new THREE.Group(); piv.position.set(s * 0.14, 0.02, -0.02); o.body.add(piv); const w = mesh(wg, wing, piv); w.scale.x = s; return piv; });
      enemyFace(o, o.body, R, c);
      o.anim = (t, e) => { const f = Math.sin(t * 18 + e.bob); o.wings.forEach((w, i) => { w.rotation.y = (i ? -1 : 1) * f * 0.7; w.rotation.x = 1.2; }); o.body.position.y = o.float + f * 0.03; };
    },
    chispa(o, c) {   // a crackling spark: spinning spikes, furious glare
      const m = o.mat(glossy(c.col, { emissive: c.col, emissiveIntensity: 0.25 })), R = new THREE.Vector3(0.21, 0.21, 0.21);
      o.float = 0.4; mesh(sph, m, o.body, 0, 0, 0, 0.21);
      o.spikes = new THREE.Group(); o.body.add(o.spikes);
      for (let i = 0; i < 12; i++) { const n = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(1 - 2 * (i + 0.5) / 12), i * 2.4); const s = mesh(cone, m, o.spikes, n.x * 0.24, n.y * 0.24, n.z * 0.24, 0.045, 0.18, 0.045); s.quaternion.setFromUnitVectors(Y, n); }
      enemyFace(o, o.body, R, c);
      o.anim = (t, e) => { o.spikes.rotation.y = t * 3; o.spikes.rotation.x = t * 1.7; o.body.position.y = o.float + Math.sin(t * 9 + e.bob) * 0.03; };
    },
    fantasma(o, c) {   // a wraith: hollow slanted eyes and a gaping jagged maw
      const m = o.mat(glossy(c.col, { transparent: true, opacity: 0.88, emissive: '#c9d4ff', emissiveIntensity: 0.3, roughness: 0.35 }));
      const pts = [new THREE.Vector2(0.29, 0.02), new THREE.Vector2(0.27, 0.2), new THREE.Vector2(0.255, 0.4)];   // hem → dome top
      for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * 0.255), 0.55 + Math.sin(a) * 0.26)); }
      const geo = new THREE.LatheGeometry(pts, 28), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.05) { const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, 0.02 + Math.sin(a * 7) * 0.05); }
      geo.computeVertexNormals(); o.float = 0.12; o.ghost = mesh(geo, m, o.body); o.body.scale.setScalar(0.9);
      const R = new THREE.Vector3(0.258, 0.258, 0.258), g = new THREE.Group(); g.position.y = 0.55; o.body.add(g);   // the dome's own centre and radius
      enemyFace(o, g, R, c);
      for (const s of [-1, 1]) mesh(sph, m, o.body, s * 0.27, 0.36, 0.05, 0.06, 0.05, 0.05);
      o.anim = (t, e) => { o.body.position.y = o.float + Math.sin(t * 2.5 + e.bob) * 0.06; o.ghost.rotation.y = Math.sin(t * 3) * 0.15; };
    },
    ojo(o, c) {   // a bloodshot eyeball under a heavy lid, slit pupil, tentacles
      o.float = 0.42; const ball = mesh(sph, o.mat(glossy('#f3eee2', { clearcoat: 1 })), o.body, 0, 0, 0, 0.27);
      const look = new THREE.Group(); look.rotation.x = -0.75; o.body.add(look);   // gazes up at the camera a little
      const iris = mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, 0.55), o.mat(glossy(c.col, { emissive: c.col, emissiveIntensity: 0.25 })), look, 0, 0, 0, 0.275); iris.rotation.x = Math.PI / 2;
      mesh(sphLo, INK, look, 0, 0, 0.27, 0.025, 0.08, 0.02);
      const lid = mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, 0.75), o.mat(glossy(dark(c.col, 0.55))), o.body, 0, 0, 0, 0.285); lid.rotation.x = -0.15;
      const veins = o.mat(new THREE.MeshBasicMaterial({ color: '#d0303a' }));
      for (let i = 0; i < 6; i++) { const a = (i - 2.5) * 0.35; const v = mesh(box, veins, decal(o.body, new THREE.Vector3(0.272, 0.272, 0.272), a * 1.4, -0.35 - Math.abs(a) * 0.2), 0, 0, 0, 0.006, 0.07, 0.004); v.rotation.z = a; }
      o.tent = [];
      for (let i = 0; i < 4; i++) { const tn = capsule(o.body, o.mat(glossy(dark(c.col, 0.6))), 0.035, 0.2, Math.sin(i * 1.57 + 0.78) * 0.12, -0.3, Math.cos(i * 1.57 + 0.78) * 0.12); tn.userData.i = i; o.tent.push(tn); }
      o.eyes = [];
      o.anim = (t, e) => { o.body.position.y = o.float + Math.sin(t * 2.2 + e.bob) * 0.05; o.tent.forEach(tn => { tn.rotation.x = Math.sin(t * 5 + tn.userData.i) * 0.3; }); look.rotation.y = Math.sin(t * 1.3) * 0.15; };
    },
    diablo(o, c) {   // a horned imp with a wicked fanged grin
      const m = o.mat(glossy(c.col)), horn = o.mat(glossy('#efe2c4')), R = new THREE.Vector3(0.25, 0.26, 0.24), g = new THREE.Group(); g.position.y = 0.3; o.body.add(g);
      o.float = 0.05; mesh(sph, m, g, 0, 0, 0, R.x, R.y, R.z);
      for (const s of [-1, 1]) { const h = mesh(cone, horn, g, s * 0.13, 0.25, 0, 0.055, 0.2, 0.055); h.rotation.z = -s * 0.45; }
      const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.2, -0.22), new THREE.Vector3(0, 0.12, -0.36), new THREE.Vector3(0.08, 0.24, -0.44), new THREE.Vector3(0.05, 0.36, -0.4)]), 16, 0.02, 6), m); o.body.add(tail);
      const tip = mesh(cone, m, o.body, 0.05, 0.4, -0.39, 0.05, 0.09, 0.02);
      enemyFace(o, g, R, c);
      for (const s of [-1, 1]) mesh(sph, o.mat(glossy(dark(c.col, 0.7))), o.body, s * 0.13, 0.03, 0.03, 0.07, 0.05, 0.09);
      o.anim = (t, e) => { o.body.position.y = o.float + Math.abs(Math.sin(t * 7 + e.bob)) * 0.06; tail.rotation.y = Math.sin(t * 4) * 0.3; tip.rotation.y = tail.rotation.y; };
    },
    calavera(o, c) {   // a floating skull: dark sockets with burning red points, clattering jaw
      const bone = o.mat(glossy('#ece2cc', { roughness: 0.5, clearcoat: 0.3 })), R = new THREE.Vector3(0.24, 0.22, 0.24);
      o.float = 0.38; const skull = new THREE.Group(); skull.position.y = 0.05; o.body.add(skull); mesh(sph, bone, skull, 0, 0, 0, R.x, R.y, R.z);
      const jaw = new THREE.Group(); jaw.position.set(0, -0.14, 0.04); o.body.add(jaw); mesh(box, bone, jaw, 0, 0, 0, 0.2, 0.07, 0.18);
      for (let i = 0; i < 5; i++) mesh(box, o.mat(glossy('#fffbea')), jaw, (i - 2) * 0.034, 0.045, 0.085, 0.026, 0.03, 0.02);
      enemyFace(o, skull, R, c);
      o.eyes = [];
      o.anim = (t, e) => { o.body.position.y = o.float + Math.sin(t * 3 + e.bob) * 0.05; jaw.position.y = -0.14 - Math.abs(Math.sin(t * 6)) * 0.035; };
    },
    jefe(o, c) {   // the Bomb King: a giant black bomb with a lit fuse, a gold band, a tilted crown and a furious face
      const m = o.mat(glossy('#1b1f38', { clearcoat: 1, clearcoatRoughness: 0.05, roughness: 0.28, metalness: 0.2, sheen: 0.35, sheenColor: c.col, envMapIntensity: 1.5 }));
      const R = new THREE.Vector3(0.33, 0.33, 0.33), g = new THREE.Group(); g.position.y = 0.36; o.body.add(g);
      o.float = 0.02; mesh(sph, m, g, 0, 0, 0, R.x, R.y, R.z);
      const band = mesh(ring, GOLD, g, 0, 0, 0, 0.332, 0.332, 0.5); band.rotation.x = Math.PI / 2; band.position.y = -0.1; band.scale.set(0.317, 0.317, 0.3);
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; mesh(sphLo, GOLD, band, Math.cos(a), Math.sin(a), 0, 0.07); }   // rivets
      mesh(cyl, GOLD, g, 0, 0.33, 0, 0.1, 0.1, 0.1);   // the fuse cap
      const fc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0.16, 0), new THREE.Vector3(0.15, 0.2, -0.04));
      const fuse = new THREE.Group(); fuse.position.set(0, 0.38, 0); g.add(fuse);
      fuse.add(new THREE.Mesh(new THREE.TubeGeometry(fc, 12, 0.025, 7, false), o.mat(matte('#f0cf96', { roughness: 0.85 }))));
      const spark = mesh(sphLo, o.mat(new THREE.MeshBasicMaterial({ color: '#fff3b0', toneMapped: false })), fuse, fc.getPoint(1).x, fc.getPoint(1).y, fc.getPoint(1).z, 0.05);
      const flare = mesh(sphLo, o.mat(new THREE.MeshBasicMaterial({ color: '#ff8a1e', transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false })), spark, 0, 0, 0, 1.9);
      const crown = new THREE.Group(); crown.position.set(-0.14, 0.29, 0.02); crown.rotation.z = 0.38; crown.scale.setScalar(1.45); g.add(crown);   // worn at a jaunty angle beside the fuse
      mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), o.mat(new THREE.MeshStandardMaterial({ color: '#ffcf3a', roughness: 0.22, metalness: 1, envMap: env, envMapIntensity: 1.3, side: THREE.DoubleSide })), crown, 0, 0, 0, 0.1, 0.06, 0.1);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone, GOLD, crown, Math.sin(a) * 0.095, 0.06, Math.cos(a) * 0.095, 0.03, 0.07, 0.03); mesh(sphLo, GOLD, crown, Math.sin(a) * 0.095, 0.1, Math.cos(a) * 0.095, 0.014); }
      mesh(sphLo, o.mat(glossy('#ff2a55', { emissive: '#ff2a55', emissiveIntensity: 0.4 })), crown, 0, 0.005, 0.1, 0.025);
      enemyFace(o, g, R, c);
      for (const s of [-1, 1]) mesh(sph, m, o.body, s * 0.14, 0.04, 0.04, 0.09, 0.06, 0.12);   // stubby feet
      o.anim = (t, e) => {
        o.body.position.y = o.float + Math.abs(Math.sin(t * 4 + e.bob)) * 0.05; o.body.rotation.z = Math.sin(t * 2) * 0.06;
        const f = 0.8 + 0.35 * Math.sin(t * 31) * Math.sin(t * 17 + 1); spark.scale.setScalar(0.05 * f); flare.material.opacity = 0.35 + 0.3 * f;
        fuse.rotation.z = Math.sin(t * 3) * 0.12;
      };
    },
  };
  function makeEnemy(e) {
    const def = e.def, root = new THREE.Group(), tilt = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(yaw); yaw.add(body); tilt.rotation.x = -TILT;
    const o = { root, tilt, yaw, body, mats: [], eyes: [], float: 0, yawNow: 0, anim: null };
    o.mat = m => { o.mats.push(m); m.userData.base = m.color.clone(); m.userData.op = m.opacity; return m; };
    (EN[def.id] || EN.globo)(o, def);
    const big = (def.boss ? 1.75 : 1) * SCALE; root.scale.setScalar(big); o.big = big;
    o.shadow = new THREE.Mesh(shadowGeo, shadowMat); o.shadow.position.y = 0.012; o.shadow.scale.setScalar(0.6); root.add(o.shadow);
    scene.add(root);
    return o;
  }
  function poseEnemy(o, e, st, dt) {
    const t = st.t;
    o.root.position.set(e.x + 0.5, 0, e.y + 0.5);
    // hunting: a player close by → turn on them, lean in and lunge (snapping when very close)
    let near = null, nd = 9;
    if (e.alive) for (const p of st.players) if (p.alive) { const d = Math.hypot(p.x - e.x, p.y - e.y); if (d < nd) { nd = d; near = p; } }
    o.hunt = (o.hunt || 0) + ((nd < 2.6 ? 1 : 0) - (o.hunt || 0)) * Math.min(1, dt * 6);
    turn(o, o.hunt > 0.5 && near ? Math.atan2(near.x - e.x, near.y - e.y) : FACE_YAW[e.di || 0], dt);
    if (o.anim) o.anim(t, e);
    const snap = nd < 1.4 ? Math.max(0, Math.sin(t * 11 + e.bob)) : 0;
    o.body.rotation.x = o.hunt * 0.26 + snap * 0.2 - (e.hitT > 0 ? Math.min(1, e.hitT / 0.5) * 0.45 : 0);   // a hit knocks the boss back
    o.body.position.z = o.hunt * 0.04 + snap * 0.08;
    if (o.face) {
      const mode = !e.alive ? 'dead' : e.hitT > 0 ? 'hurt' : o.hunt > 0.5 ? 'hunt' : 'idle';
      if (mode !== o.face.mode) { o.face.mode = mode; const tx = enemyFaceTex(e.def.id, mode, e.def), m = o.face.m; m.map = tx[0]; m.bumpMap = tx[1]; m.clearcoatMap = tx[2]; m.emissiveMap = tx[3]; }
    }
    let vis = true, sc = o.big;
    if (e.spawnT > 0) { sc *= Math.max(0.05, 1 - e.spawnT / 0.9); vis = Math.sin(t * 30) > -0.3; }
    if (e.hitT > 0 && Math.floor(t * 20) % 2) vis = false;
    // burning up: flash white, scorch orange → charcoal, shudder, then slump and crumble (fx3d adds fire and ash)
    if (!e.alive) {
      const k = e.deadT, flash = Math.max(0, 1 - k / 0.1), scorch = Math.min(1, Math.max(0, (k - 0.05) / 0.4)), crumble = Math.max(0, (k - 0.55) / 0.6);
      for (const m of o.mats) {
        C.copy(m.userData.base).lerp(C2.set(scorch < 0.5 ? '#ff6a14' : '#2a1d18'), scorch < 0.5 ? scorch * 1.6 : 0.8 + (scorch - 0.5) * 0.4);
        m.color.copy(C).lerp(C2.setRGB(3, 2.8, 2.4), flash);
        if (m.emissive) { m.emissive.set('#ff4a0a'); m.emissiveIntensity = scorch > 0.1 && scorch < 0.9 ? Math.sin(scorch * Math.PI) * 0.6 : 0; }
        if (crumble > 0.3) { m.transparent = true; m.opacity = (m.userData.op ?? 1) * Math.max(0, 1 - (crumble - 0.3) / 0.7); }
      }
      o.body.position.x = k > 0.08 && k < 0.6 ? Math.sin(k * 70) * 0.025 : 0;
      o.yaw.position.y = k < 0.3 ? Math.sin(k / 0.3 * Math.PI) * 0.18 : 0;   // jolts up as the blast hits
      o.body.scale.set(1 + crumble * 0.3, (1 - Math.min(0.1, k * 0.2)) * (1 - crumble * 0.85), 1 + crumble * 0.3);
      if (k > 1.15) vis = false;
    }
    o.root.visible = vis; o.root.scale.setScalar(Math.max(0.0001, sc));
    o.shadow.scale.setScalar(0.6 / Math.max(1, 1 + o.float));
  }
  function dispose(o) { scene.remove(o.root); for (const m of o.mats || []) m.dispose(); for (const x of o.tex || []) x.dispose(); }

  // ---------- frame ----------
  const bombers = new Map(), enemies = new Map();
  function update(st, dt) {
    const seenP = new Set(), seenE = new Set();
    for (const p of st.players) {
      let o = bombers.get(p); if (!o || o.pal !== p.pal || (heroTpl && !o.glb)) { if (o) dispose(o); o = heroTpl ? makeHeroGLB(p.pal) : makeBomber(p.pal); o.pal = p.pal; bombers.set(p, o); }
      seenP.add(p); if (o.glb) animateHero(o, p, st, dt); else poseBomber(o, p, st, dt);
    }
    for (const e of st.enemies) {
      let o = enemies.get(e); if (!o) { o = makeEnemy(e); enemies.set(e, o); }
      seenE.add(e); poseEnemy(o, e, st, dt);
    }
    for (const [p, o] of bombers) if (!seenP.has(p)) { dispose(o); bombers.delete(p); }
    for (const [e, o] of enemies) if (!seenE.has(e)) { dispose(o); enemies.delete(e); }
    return bombers.size + enemies.size > 0;
  }
  // One of each model, for shader warm-up (fx3d compiles them at stage start).
  function samples(pals, defs) {
    const out = [];
    for (const pal of pals) out.push(heroTpl ? makeHeroGLB(pal) : makeBomber(pal));
    for (const def of defs) { out.push(makeEnemy({ def, bob: 0 })); if (ENEMY_FACES[def.id]) for (const mode of ENEMY_MODES) enemyFaceTex(def.id, mode, def); }
    for (const pal of pals) for (const mode of FACE_MODES) faceTex(pal, pal.style || 'classic', mode);   // paint every expression up front
    return { remove: () => out.forEach(o => scene.remove(o.root)), dispose: () => out.forEach(dispose) };
  }
  return { update, samples, textures: () => [...Object.values(faceCache), ...Object.values(enemyFaceCache)].flat(), set onReady(f) { onReady = f; }, get ready() { return !!heroTpl; } };
}
