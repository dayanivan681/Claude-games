// ================= 3D characters (WebGL · Three.js) =================
// Presentation only: procedural, animated 3D models of the bombers (hero and rivals, one rig dressed by each
// palette) and of every enemy, drawn by fx3d.js in its layer through the board camera. The game's player and
// enemy objects are read each frame; nothing here changes game state (except winding down the cosmetic
// bomb-placing crouch timer, as the 2D painter did).
//
// Local model space: one unit per tile, feet on y = 0, the model faces +z (toward the camera) before yaw.
import * as THREE from '../vendor/three.module.min.js';

export function makeChars(scene, env) {
  const C = new THREE.Color(), C2 = new THREE.Color(), V = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  const sph = new THREE.SphereGeometry(1, 28, 20), sphLo = new THREE.SphereGeometry(1, 16, 12);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14), cone = new THREE.ConeGeometry(1, 1, 16);
  const cap = new THREE.CapsuleGeometry(0.5, 1, 6, 14);   // 2 tall, 1 wide: scale (2r, h/2, 2r)
  const blob = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(0,0,0,0.6)'); rg.addColorStop(0.6, 'rgba(0,0,0,0.3)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false });
  const TILT = 0.3, SCALE = 1.18;   // lean back toward the camera and stand a little taller, so faces read from above

  // ---------- materials ----------
  const mats = {};
  // The board's bright exposure and ACES curve wash colours out; deepen saturated ones a little so they stay vivid.
  const vivid = c => { const col = new THREE.Color(c), h = {}; col.getHSL(h); if (h.s > 0.15) col.setHSL(h.h, Math.min(1, h.s * 1.1), h.l * 0.8); return col; };
  const glossy = (c, o = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color: vivid(c), roughness: 0.32, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.12, envMap: env, envMapIntensity: 0.9 }, o));
  const matte = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: vivid(c), roughness: 0.6, metalness: 0, envMap: env, envMapIntensity: 0.5 }, o));
  const M = (key, make) => mats[key] || (mats[key] = make());
  const INK = M('ink', () => new THREE.MeshStandardMaterial({ color: '#120f22', roughness: 0.25, envMap: env, envMapIntensity: 0.6 }));
  const SHINE = M('shine', () => new THREE.MeshBasicMaterial({ color: '#ffffff' }));

  // ---------- helpers ----------
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
  // A point on a sphere of radius r: yaw a (around y, 0 = front), pitch b (up).
  const onSphere = (r, a, b) => new THREE.Vector3(Math.sin(a) * Math.cos(b) * r, Math.sin(b) * r, Math.cos(a) * Math.cos(b) * r);
  const faceOut = (m, n) => m.quaternion.setFromUnitVectors(Z, V.copy(n).normalize());
  // Two glossy cartoon eyes on a sphere of radius r: black ovals with a highlight (white sclera optional).
  function eyePair(parent, r, sep, up, size, white) {
    const out = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group(), n = onSphere(r, s * sep, up); g.position.copy(n); faceOut(g, n); parent.add(g);
      if (white) mesh(sphLo, M('white', () => glossy('#ffffff')), g, 0, 0, 0, size * 1.25, size * 1.4, size * 0.5);
      const pupil = mesh(sphLo, INK, g, 0, 0, white ? size * 0.35 : 0, white ? size * 0.62 : size * 0.62, white ? size * 0.78 : size, size * 0.45);
      mesh(sphLo, SHINE, pupil, -0.3, 0.38, 0.9, 0.3, 0.3, 0.2);
      out.push({ g, pupil });
    }
    return out;
  }
  const capsule = (parent, mat, r, h, x, y, z) => mesh(cap, mat, parent, x, y, z, 2 * r, h / 2, 2 * r);

  // ---------- bombers ----------
  function makeBomber(pal) {
    const style = pal.style || 'classic', root = new THREE.Group(), tilt = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(yaw); yaw.add(body); tilt.rotation.x = -TILT; root.scale.setScalar(SCALE);
    const white = M('suitWhite', () => glossy('#f6f6ff', { clearcoat: 0.5 }));
    const suit = M('suit' + pal.suit, () => glossy(pal.suit)), shirt = M('shirt' + pal.shirt, () => matte(pal.shirt));
    const glove = M('glove' + pal.glove, () => glossy(pal.glove)), boot = M('boot' + pal.boot, () => glossy(pal.boot));
    const gold = M('gold', () => new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.25, metalness: 1, envMap: env, envMapIntensity: 1.2 }));
    // legs + boots
    const legs = [-1, 1].map(s => {
      const hip = new THREE.Group(); hip.position.set(s * 0.075, 0.33, 0); body.add(hip);
      capsule(hip, white, 0.062, 0.25, 0, -0.125, 0);
      mesh(sph, boot, hip, 0, -0.26, 0.035, 0.092, 0.07, 0.125);
      return hip;
    });
    // torso: jacket, shirt front, belt and buckle
    const torso = new THREE.Group(); torso.position.y = 0.47; body.add(torso);
    mesh(sph, suit, torso, 0, 0, 0, 0.165, 0.15, 0.135);
    mesh(sph, shirt, torso, 0, 0.01, 0.075, 0.075, 0.115, 0.07);
    mesh(cyl, INK, torso, 0, -0.085, 0, 0.152, 0.04, 0.124);
    mesh(new THREE.BoxGeometry(1, 1, 1), gold, torso, 0, -0.085, 0.125, 0.07, 0.05, 0.02);
    mesh(sph, white, torso, 0, -0.12, 0, 0.11, 0.06, 0.09);
    // arms: short sleeve, white arm, big mitten
    const arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.position.set(s * 0.155, 0.555, 0); body.add(sh);
      mesh(sph, suit, sh, 0, -0.02, 0, 0.065, 0.06, 0.06);
      capsule(sh, white, 0.042, 0.17, 0, -0.09, 0);
      const hand = mesh(sph, glove, sh, s * 0.01, -0.17, 0.01, 0.078, 0.075, 0.078);
      sh.rotation.z = s * 0.18;
      return { sh, hand };
    });
    // head: glossy helmet, face visor, eyes, and the style's signature piece
    const head = new THREE.Group(); head.position.y = 0.86; body.add(head);
    const helmet = mesh(sph, M('helmet', () => glossy('#ffffff', { clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 })), head, 0, 0, 0, 0.3, 0.285, 0.29);
    const visorMat = style === 'ninja' ? M('ninjaVisor', () => glossy('#16233a', { clearcoat: 1, roughness: 0.2 })) : M('visor', () => matte('#ffdcc0', { roughness: 0.5 }));
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.296, 32, 16, Math.PI / 2 - 0.78, 1.56, 1.2, 0.86), visorMat); visor.scale.set(1, 0.97, 1.03); head.add(visor);
    let eyes;
    if (style === 'ninja') {
      const glow = M('ninjaEye' + pal.ball, () => new THREE.MeshBasicMaterial({ color: pal.ball, toneMapped: false }));
      eyes = [-1, 1].map(s => { const g = new THREE.Group(), n = onSphere(0.3, s * 0.27, 0.0); g.position.copy(n); faceOut(g, n); head.add(g); const e = mesh(new THREE.BoxGeometry(1, 1, 1), glow, g, 0, 0, 0, 0.1, 0.035, 0.02); e.rotation.z = s * -0.25; return { g, pupil: e }; });
    } else eyes = eyePair(head, 0.3, 0.27, 0.0, 0.07, false);
    let antenna = null;
    if (style === 'classic') {
      antenna = new THREE.Group(); antenna.position.y = 0.26; head.add(antenna);
      mesh(cone, white, antenna, 0, 0.08, 0, 0.05, 0.2, 0.05);
      mesh(sph, M('ball' + pal.ball, () => glossy(pal.ball, { clearcoat: 1, emissive: pal.ball, emissiveIntensity: 0.25 })), antenna, 0, 0.24, 0, 0.09);
    } else if (style === 'punk') {
      antenna = new THREE.Group(); antenna.position.y = 0.2; head.add(antenna);
      const crest = M('crest' + pal.ball, () => glossy(pal.ball, { emissive: pal.ball, emissiveIntensity: 0.15 }));
      for (const [a, len] of [[-0.6, 0.26], [0, 0.32], [0.6, 0.26]]) { const c = mesh(cone, crest, antenna, Math.sin(a) * 0.12, 0.1, -0.02, 0.07, len, 0.05); c.rotation.z = -a; }
      const band = mesh(new THREE.BoxGeometry(1, 1, 1), M('bandage', () => matte('#fff4e0')), head, 0.15, -0.09, 0.25, 0.08, 0.03, 0.01); band.rotation.set(-0.2, 0.5, -0.5);
      mesh(new THREE.TorusGeometry(1, 0.32, 10, 24), M('scarf' + pal.ball, () => glossy(pal.ball)), body, 0, 0.6, 0, 0.13, 0.13, 0.13).rotation.x = Math.PI / 2;
    } else if (style === 'ninja') {
      const bandMat = M('band' + pal.band, () => matte(pal.band));
      const ring = mesh(new THREE.TorusGeometry(1, 0.08, 8, 36), bandMat, head, 0, 0.1, 0, 0.27, 0.27, 0.27); ring.rotation.x = Math.PI / 2;
      const plate = mesh(new THREE.BoxGeometry(1, 1, 1), M('plate', () => new THREE.MeshStandardMaterial({ color: '#dfe6f0', roughness: 0.2, metalness: 1, envMap: env })), head, 0, 0.1, 0.272, 0.13, 0.07, 0.02); plate.rotation.x = -0.35;
      antenna = new THREE.Group(); antenna.position.set(0, 0.1, -0.3); head.add(antenna);
      for (const s of [-1, 1]) { const t = mesh(new THREE.BoxGeometry(1, 1, 1), bandMat, antenna, s * 0.04, -0.04, -0.1, 0.04, 0.02, 0.2); t.rotation.set(0.5, s * 0.3, 0); }
    } else if (style === 'king') {
      antenna = new THREE.Group(); antenna.position.y = 0.2; head.add(antenna);
      const g = mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.09, 24, 1, true), gold, antenna, 0, 0.03, 0); g.material = gold;
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone, gold, antenna, Math.sin(a) * 0.16, 0.12, Math.cos(a) * 0.16, 0.035, 0.1, 0.035); mesh(sphLo, M('gem', () => glossy('#ff4d6d', { emissive: '#ff4d6d', emissiveIntensity: 0.3 })), antenna, Math.sin(a) * 0.165, 0.035, Math.cos(a) * 0.165, 0.024); }
      const mus = M('moustache', () => matte('#7a4a12'));
      for (const s of [-1, 1]) { const m = mesh(sphLo, mus, head, s * 0.06, -0.13, 0.27, 0.06, 0.026, 0.03); m.rotation.z = s * 0.3; }
      const capeMat = M('cape' + pal.ball, () => new THREE.MeshStandardMaterial({ color: pal.ball, roughness: 0.55, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.5 }));
      const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.26, 0.42, 20, 4, true, Math.PI * 0.62, Math.PI * 0.76), capeMat); cape.position.set(0, 0.38, -0.02); body.add(cape);
      antenna.userData.cape = cape;
    }
    const shield = new THREE.Mesh(sph, M('shield', () => new THREE.MeshPhysicalMaterial({ color: '#3df5ff', transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, envMap: env, emissive: '#3df5ff', emissiveIntensity: 0.25, depthWrite: false })));
    shield.position.y = 0.5; shield.scale.setScalar(0.62); shield.visible = false; body.add(shield);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.37, 40).rotateX(-Math.PI / 2), M('ring' + pal.trim, () => new THREE.MeshBasicMaterial({ color: pal.trim, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false })));
    ring.position.y = 0.015; root.add(ring);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.y = 0.012; shadow.scale.setScalar(0.62); root.add(shadow);
    scene.add(root);
    return { root, yaw, body, legs, arms, head, eyes, antenna, shield, ring, shadow, style, yawNow: 0, lx: null, ly: 0, av: 0, ao: 0, mv: 0, bob: Math.random() * 6 };
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
    let bob = p.moving ? Math.abs(cw) * 0.045 : Math.sin(t * 2.6 + o.bob) * 0.01, armUp = 0;
    if (dance) { bob = Math.abs(Math.sin(t * 8 + o.bob)) * 0.22; armUp = 1; }
    o.body.position.y = bob - crouch * 0.06;
    o.body.scale.set(1 + crouch * 0.08, 1 - crouch * 0.1 + (p.moving ? 0 : Math.sin(t * 2.6 + o.bob) * 0.012), 1 + crouch * 0.08);
    o.body.rotation.x = p.moving ? 0.12 * o.mv : 0;   // lean into the run
    o.legs.forEach((l, i) => { const s = i ? 1 : -1; l.rotation.x = p.moving ? s * sw * 0.75 : 0; });
    o.arms.forEach((a, i) => {
      const s = i ? 1 : -1;
      a.sh.rotation.x = armUp ? -2.6 + Math.sin(t * 8 + s) * 0.3 : (p.moving ? -s * sw * 0.7 : Math.sin(t * 2.6 + o.bob) * 0.04) - crouch * 0.5;
      a.sh.rotation.z = s * (armUp ? 0.4 : 0.18);
    });
    o.head.rotation.y = !p.moving && !dance && p.alive ? Math.sin(t * 0.8 + o.bob) * 0.18 : 0;
    o.head.position.y = 0.86 + (p.moving ? cw * 0.01 : 0);
    // eyes: blink, happy squint, worried wide, X when dead
    const blink = Math.sin(t * 1.3 + o.bob * 3) > 0.985, ey = !p.alive ? 0.25 : dance ? 0.35 : blink ? 0.12 : p.worried ? 1.15 : 1;
    for (const e of o.eyes) e.pupil.scale.y = (o.style === 'ninja' ? 0.035 : 0.07) * ey;
    // death: spin up and shrink away; invincibility blink; shield bubble
    let vis = true, sc = SCALE;
    if (!p.alive) { const k = p.deadT; if (k > 1.4) vis = false; o.yawNow += dt * 14; o.yaw.rotation.y = o.yawNow; sc = SCALE * Math.max(0, 1 - Math.max(0, k - 0.45) / 0.95); o.body.position.y += k * 0.5; }
    else if (p.inv > 0 && Math.floor(t * 20) % 2) vis = false;
    o.root.visible = vis; o.root.scale.setScalar(Math.max(0.0001, sc));
    o.shield.visible = p.alive && p.shieldT > 0 && (p.shieldT > 3 || Math.floor(t * 10) % 2 === 0);
    if (o.shield.visible) o.shield.scale.setScalar(0.62 + Math.sin(t * 8) * 0.02);
    o.ring.visible = p.alive && p.human && st.mode !== 'demo'; o.ring.material.opacity = 0.45 + 0.2 * Math.sin(t * 4);
    o.shadow.scale.setScalar(0.62 * (1 - Math.min(0.5, bob)));
  }

  // ---------- enemies ----------
  // Each enemy: { root, yaw, body, mats (cloned, for the burn tint), eyes, anim(o, t, e) }
  const EN = {
    globo(o, c) {
      const m = o.mat(glossy(c.col, { clearcoat: 1, envMapIntensity: 1.1 }));
      o.float = 0.42; mesh(sph, m, o.body, 0, 0.3, 0, 0.29, 0.31, 0.28);
      mesh(cone, m, o.body, 0, -0.01, 0, 0.05, 0.07, 0.05).rotation.x = Math.PI;
      const str = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0.04, -0.14, 0), new THREE.Vector3(-0.03, -0.26, 0.02), new THREE.Vector3(0.02, -0.36, 0)]), 12, 0.008, 5), o.mat(matte('#f5e6d0'))); o.body.add(str);
      o.eyes = eyePair(o.body, 0.29, 0.3, 0.42, 0.068, true); o.eyes.forEach(e => { e.g.position.y += 0.3; });
      const smile = mesh(new THREE.TorusGeometry(0.08, 0.016, 6, 16, Math.PI), INK, o.body, 0, 0.36, 0.26); smile.rotation.set(-0.5, 0, Math.PI);
      o.anim = (t, e) => { o.body.rotation.z = Math.sin(t * 2 + e.bob) * 0.12; o.body.position.y = o.float + Math.sin(t * 3 + e.bob) * 0.05; };
    },
    gota(o, c) {
      const m = o.mat(glossy(c.col, { transparent: true, opacity: 0.88, clearcoat: 1, roughness: 0.08, envMapIntensity: 1.4 }));
      const pts = [];   // drop profile, bottom to tip: a round belly tapering to a point
      for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * 0.27), 0.3 - Math.cos(a) * 0.28)); }
      for (let i = 1; i <= 10; i++) { const u = i / 10; pts.push(new THREE.Vector2(Math.max(0.001, 0.27 * Math.pow(1 - u, 1.3)), 0.3 + u * 0.36)); }
      mesh(new THREE.LatheGeometry(pts, 28), m, o.body);
      o.eyes = eyePair(o.body, 0.25, 0.32, 0.4, 0.062, true); o.eyes.forEach(e => { e.g.position.y += 0.26; });
      o.anim = (t, e) => { const s = Math.sin(t * 6 + e.bob); o.body.scale.set(1 + s * 0.06, 1 - s * 0.07, 1 + s * 0.06); };
    },
    murci(o, c) {
      const m = o.mat(glossy(c.col)), wing = o.mat(matte(new THREE.Color(c.col).multiplyScalar(0.6), { side: THREE.DoubleSide }));
      o.float = 0.5; mesh(sph, m, o.body, 0, 0, 0, 0.2, 0.19, 0.18);
      for (const s of [-1, 1]) mesh(cone, m, o.body, s * 0.1, 0.18, 0, 0.05, 0.14, 0.04).rotation.z = -s * 0.3;
      const sh = new THREE.Shape(); sh.moveTo(0, 0.05); sh.quadraticCurveTo(0.2, 0.18, 0.42, 0.12); sh.lineTo(0.36, 0.0); sh.quadraticCurveTo(0.3, 0.04, 0.26, -0.04); sh.quadraticCurveTo(0.2, 0.0, 0.15, -0.06); sh.quadraticCurveTo(0.08, -0.02, 0, -0.05); sh.closePath();
      const wg = new THREE.ShapeGeometry(sh, 6);
      o.wings = [-1, 1].map(s => { const piv = new THREE.Group(); piv.position.set(s * 0.14, 0.02, -0.02); o.body.add(piv); const w = mesh(wg, wing, piv); w.scale.x = s; return piv; });
      o.eyes = eyePair(o.body, 0.19, 0.38, 0.45, 0.05, true);
      for (const s of [-1, 1]) mesh(cone, o.mat(matte('#ffffff')), o.body, s * 0.04, -0.07, 0.165, 0.015, 0.04, 0.015).rotation.x = Math.PI;
      o.anim = (t, e) => { const f = Math.sin(t * 18 + e.bob); o.wings.forEach((w, i) => { w.rotation.y = (i ? -1 : 1) * f * 0.7; w.rotation.x = 1.2; }); o.body.position.y = o.float + f * 0.03; };
    },
    chispa(o, c) {
      const m = o.mat(glossy(c.col, { emissive: c.col, emissiveIntensity: 0.22 }));
      o.float = 0.4; mesh(sph, m, o.body, 0, 0, 0, 0.21);
      o.spikes = new THREE.Group(); o.body.add(o.spikes);
      for (let i = 0; i < 10; i++) { const n = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(1 - 2 * (i + 0.5) / 10), i * 2.4); const s = mesh(cone, m, o.spikes, n.x * 0.24, n.y * 0.24, n.z * 0.24, 0.05, 0.16, 0.05); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); }
      o.eyes = eyePair(o.body, 0.205, 0.32, 0.42, 0.055, true);
      for (const s of [-1, 1]) { const b = mesh(new THREE.BoxGeometry(1, 1, 1), INK, o.body, s * 0.07, 0.17, 0.12, 0.08, 0.02, 0.02); b.rotation.set(-0.9, 0, s * 0.45); }
      o.anim = (t, e) => { o.spikes.rotation.y = t * 3; o.spikes.rotation.x = t * 1.7; o.body.position.y = o.float + Math.sin(t * 9 + e.bob) * 0.03; };
    },
    fantasma(o, c) {
      const m = o.mat(glossy(c.col, { transparent: true, opacity: 0.93, emissive: '#dfe6ff', emissiveIntensity: 0.45, roughness: 0.35 }));
      const pts = [new THREE.Vector2(0.29, 0.02), new THREE.Vector2(0.27, 0.2), new THREE.Vector2(0.255, 0.4)];   // hem → dome top
      for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * 0.255), 0.55 + Math.sin(a) * 0.26)); }
      const geo = new THREE.LatheGeometry(pts, 28);
      const p = geo.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.05) { const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, 0.02 + Math.sin(a * 7) * 0.04); }
      geo.computeVertexNormals(); o.float = 0.12; o.ghost = mesh(geo, m, o.body);
      o.eyes = eyePair(o.body, 0.255, 0.3, 0.35, 0.075, false); o.eyes.forEach(e => { e.g.position.y += 0.55; });
      o.body.scale.setScalar(0.88);
      for (const s of [-1, 1]) mesh(sph, m, o.body, s * 0.27, 0.36, 0.05, 0.06, 0.05, 0.05);
      o.anim = (t, e) => { o.body.position.y = o.float + Math.sin(t * 2.5 + e.bob) * 0.06; o.ghost.rotation.y = Math.sin(t * 3) * 0.15; };
    },
    ojo(o, c) {
      o.float = 0.42; const ball = mesh(sph, o.mat(glossy('#f8f6f0', { clearcoat: 1 })), o.body, 0, 0, 0, 0.27);
      const iris = mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, 0.55), o.mat(glossy(c.col, { emissive: c.col, emissiveIntensity: 0.2 })), o.body, 0, 0, 0, 0.275); iris.rotation.x = Math.PI / 2 - 0.6;   // looks up at the camera a little
      mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, 0.26), INK, iris, 0, 0.005, 0, 1.01);
      for (let i = 0; i < 4; i++) { const tn = capsule(o.body, o.mat(glossy(new THREE.Color(c.col).multiplyScalar(0.7))), 0.035, 0.2, Math.sin(i * 1.57 + 0.78) * 0.12, -0.3, Math.cos(i * 1.57 + 0.78) * 0.12); tn.userData.i = i; (o.tent = o.tent || []).push(tn); }
      o.eyes = [];
      o.anim = (t, e) => { o.body.position.y = o.float + Math.sin(t * 2.2 + e.bob) * 0.05; o.tent.forEach(tn => { tn.rotation.x = Math.sin(t * 5 + tn.userData.i) * 0.3; }); ball.rotation.y = Math.sin(t * 1.3) * 0.1; };
    },
    diablo(o, c) {
      const m = o.mat(glossy(c.col)), horn = o.mat(glossy('#fff1d6'));
      o.float = 0.05; mesh(sph, m, o.body, 0, 0.3, 0, 0.25, 0.26, 0.24);
      for (const s of [-1, 1]) { const h = mesh(cone, horn, o.body, s * 0.13, 0.55, 0, 0.05, 0.16, 0.05); h.rotation.z = -s * 0.5; }
      const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.2, -0.22), new THREE.Vector3(0, 0.12, -0.36), new THREE.Vector3(0.08, 0.24, -0.44), new THREE.Vector3(0.05, 0.36, -0.4)]), 16, 0.02, 6), m); o.body.add(tail);
      const tip = mesh(cone, m, o.body, 0.05, 0.4, -0.39, 0.05, 0.09, 0.02); o.tail = tail;
      o.eyes = eyePair(o.body, 0.25, 0.3, 0.4, 0.062, true); o.eyes.forEach(e => { e.g.position.y += 0.3; });
      for (const s of [-1, 1]) { const b = mesh(new THREE.BoxGeometry(1, 1, 1), INK, o.body, s * 0.08, 0.5, 0.16, 0.09, 0.022, 0.02); b.rotation.set(-0.8, 0, s * 0.45); }
      const grin = mesh(new THREE.TorusGeometry(0.09, 0.016, 6, 16, Math.PI), INK, o.body, 0, 0.34, 0.22); grin.rotation.set(-0.5, 0, Math.PI);
      for (const s of [-1, 1]) for (const fx of [0.4]) mesh(sph, o.mat(glossy(new THREE.Color(c.col).multiplyScalar(0.7))), o.body, s * 0.13, 0.03, 0.03, 0.07, 0.05, 0.09);
      o.anim = (t, e) => { o.body.position.y = o.float + Math.abs(Math.sin(t * 7 + e.bob)) * 0.06; tail.rotation.y = Math.sin(t * 4) * 0.3; tip.rotation.y = tail.rotation.y; };
    },
    calavera(o, c) {
      const bone = o.mat(glossy('#f3ead8', { roughness: 0.45, clearcoat: 0.4 })), red = o.mat(new THREE.MeshBasicMaterial({ color: '#ff3b3b', toneMapped: false }));
      o.float = 0.38; mesh(sph, bone, o.body, 0, 0.05, 0, 0.24, 0.22, 0.24);
      const jaw = mesh(new THREE.BoxGeometry(1, 1, 1), bone, o.body, 0, -0.14, 0.06, 0.24, 0.08, 0.2); o.jaw = jaw;
      for (const s of [-1, 1]) { const g = new THREE.Group(), n = onSphere(0.24, s * 0.35, 0.35); g.position.copy(n).add(new THREE.Vector3(0, 0.05, 0)); faceOut(g, n); o.body.add(g); mesh(sphLo, INK, g, 0, 0, 0, 0.075, 0.08, 0.04); mesh(sphLo, red, g, 0, 0, 0.02, 0.03); }
      mesh(cone, INK, o.body, 0, -0.04, 0.235, 0.025, 0.05, 0.01).rotation.x = Math.PI;
      o.eyes = [];
      o.anim = (t, e) => { o.body.position.y = o.float + Math.sin(t * 3 + e.bob) * 0.05; jaw.position.y = -0.14 - Math.abs(Math.sin(t * 6)) * 0.03; };
    },
    jefe(o, c) {
      const m = o.mat(glossy(c.col, { clearcoat: 1 })), gold = o.mat(new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.25, metalness: 1, envMap: env }));
      o.float = 0.05; mesh(sph, m, o.body, 0, 0.32, 0, 0.3, 0.3, 0.28);
      for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.35; const s = mesh(cone, gold, o.body, Math.sin(a) * 0.2, 0.6, Math.cos(a) * 0.05 - 0.02, 0.04, 0.14, 0.04); s.rotation.z = -a * 0.6; }
      o.eyes = eyePair(o.body, 0.29, 0.3, 0.38, 0.072, true); o.eyes.forEach(e => { e.g.position.y += 0.32; });
      for (const s of [-1, 1]) { const b = mesh(new THREE.BoxGeometry(1, 1, 1), INK, o.body, s * 0.09, 0.55, 0.2, 0.1, 0.025, 0.02); b.rotation.set(-0.8, 0, s * 0.45); }
      const mouth = mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 16, Math.PI), INK, o.body, 0, 0.34, 0.27); mouth.rotation.set(-0.5, 0, Math.PI);
      for (const s of [-1, 1]) mesh(sph, m, o.body, s * 0.3, 0.25, 0.05, 0.08);
      o.anim = (t, e) => { o.body.position.y = o.float + Math.abs(Math.sin(t * 4 + e.bob)) * 0.05; o.body.rotation.z = Math.sin(t * 2) * 0.06; };
    },
  };
  function makeEnemy(e) {
    const def = e.def, root = new THREE.Group(), tilt = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(yaw); yaw.add(body); tilt.rotation.x = -TILT * 0.8;
    const o = { root, tilt, yaw, body, mats: [], eyes: [], float: 0, yawNow: 0, anim: null };
    o.mat = m => { o.mats.push(m); m.userData.base = m.color.clone(); m.userData.op = m.opacity; m.userData.tr = m.transparent; return m; };
    (EN[def.id] || EN.globo)(o, def);
    const big = (def.boss ? 1.75 : 1) * SCALE; root.scale.setScalar(big); o.big = big;
    o.shadow = new THREE.Mesh(shadowGeo, shadowMat); o.shadow.position.y = 0.012; o.shadow.scale.setScalar(0.6); root.add(o.shadow);
    scene.add(root);
    return o;
  }
  function poseEnemy(o, e, st, dt) {
    const t = st.t;
    o.root.position.set(e.x + 0.5, 0, e.y + 0.5);
    turn(o, FACE_YAW[e.di || 0], dt);
    if (o.anim) o.anim(t, e);
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
      o.body.scale.set(1 + crumble * 0.3, (1 - Math.min(0.1, k * 0.2)) * (1 - crumble * 0.85), 1 + crumble * 0.3);
      if (k > 1.15) vis = false;
    }
    o.root.visible = vis; o.root.scale.setScalar(Math.max(0.0001, sc));
    o.shadow.scale.setScalar(0.6 / Math.max(1, 1 + o.float));
  }
  function dispose(o) { scene.remove(o.root); for (const m of o.mats || []) m.dispose(); }

  // ---------- frame ----------
  const bombers = new Map(), enemies = new Map();
  function update(st, dt) {
    const seenP = new Set(), seenE = new Set();
    for (const p of st.players) {
      let o = bombers.get(p); if (!o || o.pal !== p.pal) { if (o) dispose(o); o = makeBomber(p.pal); o.pal = p.pal; bombers.set(p, o); }
      seenP.add(p); poseBomber(o, p, st, dt);
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
    for (const pal of pals) out.push(makeBomber(pal));
    for (const def of defs) out.push(makeEnemy({ def, bob: 0 }));
    return { remove: () => out.forEach(dispose) };
  }
  return { update, samples };
}
