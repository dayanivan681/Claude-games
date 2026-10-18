// ================= 3D characters (WebGL · Three.js) =================
// Presentation only: procedural, animated 3D models of the bombers (hero and rivals, one rig dressed by each
// palette) and of every enemy, drawn by fx3d.js in its layer through the board camera. The game's player and
// enemy objects are read each frame; nothing here changes game state (except winding down the cosmetic
// bomb-placing crouch timer, as the 2D painter did).
//
// Look: the hero's own design, not a cute chibi — a slim figure with a big helmet, a flat skin face plate with
// tall black eyes under thick determined brows, an open short-sleeved jacket, gold-buckled belt, striped
// knees and chunky cuffed gloves and boots. Enemies scowl: slanted brows, small pupils, teeth and fangs.
//
// The hero is the owner's own model (models/heroe.glb, exported by tools/heroe_juego.py from their Blender
// recreation, in a neutral pose with pivots for hips, legs, arms, head and antenna); rivals wear the same model
// recoloured from their palette plus their accessories. Until it loads (or if it can't) a procedural rig stands in.
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
  // Thick tapered brow (wide at the inner end), and a fang/tooth.
  const browGeo = (() => { const s = new THREE.Shape(); s.moveTo(-0.5, -0.18); s.lineTo(0.5, -0.5); s.lineTo(0.5, 0.5); s.lineTo(-0.5, 0.22); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }); g.translate(0, 0, -0.15); return g; })();
  const toothGeo = new THREE.ConeGeometry(1, 1, 4); toothGeo.rotateX(Math.PI);

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
  // Menacing eyes for enemies: squinting white, small pupil (optionally glowing), slanted brow over each.
  function scowl(parent, R, { sep = 0.32, up = 0.3, size = 0.06, pupil = INK, brow = INK, browTilt = 0.55, white = true } = {}) {
    const eyes = [];
    for (const s of [-1, 1]) {
      const g = decal(parent, R, s * sep, up);
      if (white) mesh(sphLo, M('eyeWhite', () => glossy('#fbf6ea')), g, 0, 0, 0, size * 1.25, size * 0.95, size * 0.45);
      const pu = mesh(sphLo, pupil, g, s * -size * 0.25, -size * 0.1, size * 0.3, size * 0.42, size * 0.55, size * 0.3);
      if (pupil === INK) mesh(sphLo, SHINE, pu, -0.3, 0.35, 0.9, 0.28, 0.28, 0.2);
      const b = mesh(browGeo, brow, g, s * size * 0.1, size * 1.05, size * 0.2, size * 2.7, size * 1.0, size * 0.5);
      b.rotation.z = s * browTilt; if (s > 0) b.rotation.y = Math.PI;
      eyes.push({ g, pupil: pu, base: pu.scale.y });
    }
    return eyes;
  }
  // A dark grimacing mouth with a row of teeth (and optional fangs) on a surface point.
  function teeth(parent, R, { up = 0.0, width = 0.16, n = 5, fangs = false, gums = '#2a0b0b' } = {}) {
    const g = decal(parent, R, 0, up);
    mesh(sphLo, M('mouth' + gums, () => matte(gums, { roughness: 0.5 })), g, 0, 0, -0.005, width / 2, width * 0.22, 0.02);
    const tooth = M('tooth', () => glossy('#fffbea', { clearcoat: 0.5 }));
    for (let i = 0; i < n; i++) { const x = (i / (n - 1) - 0.5) * width * 0.82, f = fangs && (i === 0 || i === n - 1); mesh(toothGeo, tooth, g, x, width * 0.06, 0.012, width * (f ? 0.07 : 0.05), width * (f ? 0.3 : 0.16), 0.012); }
    return g;
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
    mesh(cap, shirt, torso, 0, 0.0, 0, 0.21, 0.12, 0.17);
    mesh(new THREE.CylinderGeometry(1, 1.06, 1, 24, 1, true, 0.62, Math.PI * 2 - 1.24), suit, torso, 0, 0.02, 0, 0.122, 0.2, 0.1);
    for (const s of [-1, 1]) { const lap = mesh(box, suit, torso, s * 0.05, 0.09, 0.093, 0.045, 0.06, 0.012); lap.rotation.set(-0.25, 0, s * 0.5); }   // collar flaps
    mesh(cyl, INK, torso, 0, -0.1, 0, 0.112, 0.04, 0.092);
    mesh(box, GOLD, torso, 0, -0.1, 0.094, 0.07, 0.05, 0.014); mesh(box, INK, torso, 0, -0.1, 0.101, 0.038, 0.024, 0.006);
    mesh(sph, white, torso, 0, -0.15, 0, 0.1, 0.06, 0.085);
    // arms: short sleeve, slim white arm with a stripe, big cuffed boxing-glove mitten
    const arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.position.set(s * 0.14, 0.61, 0); body.add(sh);
      mesh(new THREE.CylinderGeometry(1, 1.15, 1, 16, 1, true), suit, sh, 0, -0.03, 0, 0.05, 0.08, 0.05);
      mesh(sph, suit, sh, 0, 0.0, 0, 0.05);
      capsule(sh, white, 0.032, 0.2, 0, -0.1, 0);
      mesh(ring, stripe, sh, 0, -0.12, 0, 0.033, 0.033, 0.05).rotation.x = Math.PI / 2;
      const hand = new THREE.Group(); hand.position.y = -0.22; sh.add(hand);
      mesh(cyl, glove, hand, 0, 0.03, 0, 0.05, 0.05, 0.05);
      mesh(sph, glove, hand, 0, -0.03, 0.012, 0.075, 0.08, 0.072);
      mesh(sph, glove, hand, -s * 0.06, -0.01, 0.04, 0.03, 0.035, 0.03);
      sh.rotation.z = s * 0.14;
      return { sh, hand };
    });
    // head: helmet with a flat skin face plate, tall black eyes, thick determined brows
    const HR = new THREE.Vector3(0.27, 0.285, 0.262), head = new THREE.Group(); head.position.y = 0.91; body.add(head);
    mesh(sph, M('helmet', () => glossy('#ffffff', { roughness: 0.35, clearcoat: 0.8, envMapIntensity: 0.9 })), head, 0, 0, 0, HR.x, HR.y, HR.z);
    const faceMat = style === 'ninja' ? M('ninjaVisor', () => glossy('#141f33', { roughness: 0.18, clearcoat: 1 })) : M('face', () => matte('#f0bf96', { roughness: 0.55 }));
    const face = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18, Math.PI / 2 - 0.78, 1.56, 1.06, 1.12), faceMat); face.scale.copy(HR).multiplyScalar(1.012); head.add(face);
    const faceR = HR.clone().multiplyScalar(1.02);
    let eyes;
    if (style === 'ninja') {
      const glow = M('ninjaEye' + pal.ball, () => new THREE.MeshBasicMaterial({ color: pal.ball, toneMapped: false }));
      eyes = [-1, 1].map(s => { const g = decal(head, faceR, s * 0.27, -0.02); const e = mesh(box, glow, g, 0, 0, 0, 0.1, 0.03, 0.012); e.rotation.z = s * -0.3; return { g, pupil: e, base: 0.03 }; });
    } else {
      eyes = [-1, 1].map(s => {
        const g = decal(head, faceR, s * 0.25, -0.08), e = mesh(sphLo, INK, g, 0, 0, 0, 0.036, 0.085, 0.016);
        mesh(sphLo, SHINE, e, -0.25, 0.5, 0.9, 0.25, 0.1, 0.2);
        const b = mesh(browGeo, INK, decal(head, faceR, s * 0.25, 0.2), 0, 0, 0, 0.13, 0.05, 0.02); b.rotation.z = s * 0.42; if (s > 0) b.rotation.y = Math.PI;
        return { g, pupil: e, base: 0.085 };
      });
    }
    let antenna = null;
    if (style === 'classic') {
      antenna = new THREE.Group(); antenna.position.y = HR.y - 0.03; head.add(antenna);
      mesh(cone, white, antenna, 0, 0.07, 0, 0.055, 0.16, 0.055);
      mesh(sph, M('ball' + pal.ball, () => glossy(pal.ball, { clearcoat: 1, emissive: pal.ball, emissiveIntensity: 0.2 })), antenna, 0, 0.2, 0, 0.075);
    } else if (style === 'punk') {
      antenna = new THREE.Group(); antenna.position.y = HR.y - 0.08; head.add(antenna);
      const crest = M('crest' + pal.ball, () => glossy(pal.ball));
      for (const [z, len, a] of [[0.12, 0.2, 0.5], [0.02, 0.27, 0.15], [-0.09, 0.26, -0.2], [-0.19, 0.2, -0.55]]) { const c = mesh(cone, crest, antenna, 0, 0.08, z, 0.045, len, 0.06); c.rotation.x = a; }
      const band = mesh(box, M('bandage', () => matte('#fff4e0')), decal(head, faceR, 0.4, -0.22), 0, 0, 0.005, 0.08, 0.026, 0.008); band.rotation.z = -0.5;
      mesh(new THREE.TorusGeometry(1, 0.35, 10, 24), M('scarf' + pal.ball, () => satin(pal.ball)), body, 0, 0.66, 0, 0.11, 0.11, 0.1).rotation.x = Math.PI / 2;
    } else if (style === 'ninja') {
      const bandMat = M('band' + pal.band, () => matte(pal.band));
      mesh(new THREE.TorusGeometry(1, 0.07, 8, 36), bandMat, head, 0, 0.06, 0, 0.264, 0.264, 0.26).rotation.x = Math.PI / 2;
      const plate = mesh(box, M('plate', () => new THREE.MeshStandardMaterial({ color: '#dfe6f0', roughness: 0.2, metalness: 1, envMap: env })), decal(head, faceR, 0, 0.36), 0, 0, 0.004, 0.12, 0.06, 0.012);
      antenna = new THREE.Group(); antenna.position.set(0, 0.1, -0.26); head.add(antenna);
      for (const s of [-1, 1]) { const t = mesh(box, bandMat, antenna, s * 0.035, -0.04, -0.1, 0.035, 0.015, 0.2); t.rotation.set(0.5, s * 0.3, 0); }
    } else if (style === 'king') {
      antenna = new THREE.Group(); antenna.position.y = HR.y - 0.06; head.add(antenna);
      mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.08, 24, 1, true), GOLD, antenna, 0, 0.03, 0);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone, GOLD, antenna, Math.sin(a) * 0.14, 0.11, Math.cos(a) * 0.14, 0.032, 0.09, 0.032); mesh(sphLo, M('gem', () => glossy('#e0204a', { emissive: '#ff2050', emissiveIntensity: 0.3 })), antenna, Math.sin(a) * 0.148, 0.035, Math.cos(a) * 0.148, 0.022); }
      const mus = M('moustache', () => matte('#5e360c'));
      for (const s of [-1, 1]) { const m = mesh(sphLo, mus, decal(head, faceR, s * 0.12, -0.38), 0, 0, 0, 0.065, 0.024, 0.02); m.rotation.z = s * 0.3; }
      const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, 0.42, 20, 4, true, Math.PI * 0.62, Math.PI * 0.76), M('cape' + pal.ball, () => satin(pal.ball, { side: THREE.DoubleSide, roughness: 0.6 })));
      cape.position.set(0, 0.42, -0.02); body.add(cape); antenna.userData.cape = cape;
    }
    const shield = new THREE.Mesh(sph, M('shield', () => new THREE.MeshPhysicalMaterial({ color: '#3df5ff', transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, envMap: env, emissive: '#3df5ff', emissiveIntensity: 0.25, depthWrite: false })));
    shield.position.y = 0.55; shield.scale.setScalar(0.66); shield.visible = false; body.add(shield);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.37, 40).rotateX(-Math.PI / 2), M('ring' + pal.trim, () => new THREE.MeshBasicMaterial({ color: pal.trim, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false })));
    halo.position.y = 0.015; root.add(halo);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.y = 0.012; shadow.scale.setScalar(0.6); root.add(shadow);
    scene.add(root);
    return { root, yaw, body, legs, arms, head, eyes, antenna, shield, ring: halo, shadow, style, yawNow: 0, lx: null, ly: 0, av: 0, ao: 0, mv: 0, bob: Math.random() * 6 };
  }
  // ---------- the hero model (glTF) ----------
  const GLB_SCALE = 0.24;   // model units (Blender metres, ~6.8 tall) → tiles
  let heroTpl = null, onReady = null;
  const loader = new GLTFLoader(), heroUrl = f => new URL('../models/' + f, import.meta.url).href;
  const onHero = g => {
    heroTpl = g.scene;
    heroTpl.traverse(m => {
      if (!m.isMesh || !m.material) return;
      const mt = m.material, dark = mt.color.r + mt.color.g + mt.color.b < 0.1;
      mt.envMap = env; mt.envMapIntensity = dark ? 0.12 : 0.75;   // inky eyes and brows stay black instead of mirroring the sky
      if (dark) { mt.roughness = 0.85; mt.envMapIntensity = 0.05; if ('clearcoat' in mt) mt.clearcoat = 0; }   // and no broad sheen across their flat faces
    });
    if (onReady) onReady();
  };
  // .glb normally; hosts that won't serve .glb get the same model as embedded glTF JSON. Failing both, the procedural rig stays.
  loader.load(heroUrl('heroe.glb'), onHero, undefined, () => loader.load(heroUrl('heroe.json'), onHero, undefined, () => {}));
  const PARTS = ['PiernaI', 'PiernaD', 'BrazoI', 'BrazoD', 'Antena', 'Cabeza', 'Cuerpo'];
  const partOf = m => { for (let n = m; n; n = n.parent) if (PARTS.includes(n.name)) return n.name.replace(/[ID]$/, ''); return ''; };
  // Rivals: the hero's materials recoloured from their palette (pink → boots / gloves / crest colour, blue → suit…).
  function recolor(mat, pal, part) {
    const key = pal.name + '|' + mat.name + '|' + part;
    if (mats[key]) return mats[key];
    let m = mat.clone();
    const set = c => m.color.copy(vivid(c));
    switch (mat.name) {
      case 'Rosa brillante': set(part === 'Pierna' ? pal.boot : part === 'Brazo' ? pal.glove : pal.ball); break;
      case 'Costuras rosas': set(part === 'Pierna' ? pal.boot2 : pal.glove2); break;
      case 'Chaqueta azul': set(pal.suit); break;
      case 'Costuras azules': set(pal.suit2); break;
      case 'Lavanda': set(pal.shirt); m.color.lerp(C2.copy(vivid(pal.suit)), 0.25); break;
      case 'Rostro melocotón': if (pal.style === 'ninja') { m = glossy('#141f33', { roughness: 0.18, clearcoat: 1 }); } break;
      case 'Ojos negros': if (pal.style === 'ninja') m = new THREE.MeshBasicMaterial({ color: pal.ball, toneMapped: false }); break;
    }
    return (mats[key] = m);
  }
  function makeHeroGLB(pal) {
    const style = pal.style || 'classic', root = new THREE.Group(), tilt = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
    root.add(tilt); tilt.add(yaw); yaw.add(body); tilt.rotation.x = -TILT;
    const model = heroTpl.clone(true); model.scale.setScalar(GLB_SCALE); body.add(model);
    const node = n => model.getObjectByName(n), head = node('Cabeza'), torso = node('Cuerpo');
    let antenna = node('Antena');
    if (style !== 'classic') {
      model.traverse(m => { if (m.isMesh) { m.material = recolor(m.material, pal, partOf(m)); if (style === 'ninja' && m.material.name === 'Cejas negras') m.visible = false; } });
      antenna.visible = false; antenna = new THREE.Group(); head.add(antenna);
      if (style === 'punk') {   // spiky crest along the helmet, scarf, cheek bandage
        antenna.position.set(0, 1.0, 0);
        const crest = M('crest' + pal.ball, () => glossy(pal.ball));
        [[0.6, 0.8, 0.6], [0.2, 1.05, 0.2], [-0.22, 1.0, -0.22], [-0.62, 0.8, -0.65]].forEach(([z, len, a]) => { const c = mesh(cone, crest, antenna, 0, len * 0.4, z, 0.2, len, 0.3); c.rotation.x = a; });
        mesh(new THREE.TorusGeometry(1, 0.32, 10, 28), M('scarf' + pal.ball, () => satin(pal.ball)), torso, 0, 1.3, 0.02, 0.38, 0.38, 0.34).rotation.x = Math.PI / 2;
        const band = mesh(box, M('bandage', () => matte('#fff4e0')), head, 0.42, -0.36, 0.93, 0.28, 0.09, 0.03); band.rotation.set(0, 0.35, -0.5);
      } else if (style === 'ninja') {   // headband with a steel plate; ties trail behind
        const bandMat = M('band' + pal.band, () => matte(pal.band)), g = new THREE.Group(); g.position.y = 0.62; g.scale.set(1.08, 1, 0.97); head.add(g);
        mesh(new THREE.TorusGeometry(1, 0.08, 8, 40), bandMat, g).rotation.x = Math.PI / 2;
        mesh(box, M('plate', () => new THREE.MeshStandardMaterial({ color: '#dfe6f0', roughness: 0.2, metalness: 1, envMap: env })), head, 0, 0.62, 0.95, 0.42, 0.2, 0.05);
        antenna.position.set(0, 0.62, -0.92);
        for (const s of [-1, 1]) { const t = mesh(box, bandMat, antenna, s * 0.12, -0.12, -0.32, 0.12, 0.05, 0.65); t.rotation.set(0.5, s * 0.3, 0); }
      } else if (style === 'king') {   // gem-set crown, curled moustache, royal cape
        antenna.position.set(0, 1.02, 0);
        mesh(new THREE.CylinderGeometry(0.56, 0.52, 0.28, 28, 1, true), GOLD, antenna, 0, 0.1, 0);
        const gem = M('gem', () => glossy('#e0204a', { emissive: '#ff2050', emissiveIntensity: 0.3 }));
        for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone, GOLD, antenna, Math.sin(a) * 0.53, 0.38, Math.cos(a) * 0.53, 0.11, 0.3, 0.11); mesh(sphLo, gem, antenna, Math.sin(a) * 0.56, 0.1, Math.cos(a) * 0.56, 0.07); }
        const mus = M('moustache', () => matte('#5e360c'));
        for (const s of [-1, 1]) { const m = mesh(sphLo, mus, head, s * 0.2, -0.42, 0.96, 0.22, 0.08, 0.07); m.rotation.z = s * 0.3; }
        const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.85, 1.3, 20, 4, true, Math.PI * 0.62, Math.PI * 0.76), M('cape' + pal.ball, () => satin(pal.ball, { side: THREE.DoubleSide, roughness: 0.6 })));
        cape.position.set(0, 0.62, -0.05); torso.add(cape); antenna.userData.cape = cape;
      }
    }
    const shield = new THREE.Mesh(sph, M('shield', () => new THREE.MeshPhysicalMaterial({ color: '#3df5ff', transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, envMap: env, emissive: '#3df5ff', emissiveIntensity: 0.25, depthWrite: false })));
    shield.position.y = 0.8; shield.scale.setScalar(0.85); shield.visible = false; body.add(shield);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.37, 40).rotateX(-Math.PI / 2), M('ring' + pal.trim, () => new THREE.MeshBasicMaterial({ color: pal.trim, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false })));
    halo.position.y = 0.015; root.add(halo);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.y = 0.012; shadow.scale.setScalar(0.62); root.add(shadow);
    scene.add(root);
    return { root, yaw, body, legs: [node('PiernaI'), node('PiernaD')], arms: [{ sh: node('BrazoI') }, { sh: node('BrazoD') }], head, headY: head.position.y, headBob: 0.035, armZ: 0, eyes: [], antenna, shield, ring: halo, shadow, style, glb: true, yawNow: 0, lx: null, ly: 0, av: 0, ao: 0, mv: 0, bob: Math.random() * 6 };
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
    const blink = Math.sin(t * 1.3 + o.bob * 3) > 0.985, ey = !p.alive ? 0.25 : dance ? 0.4 : blink ? 0.12 : 1;
    for (const e of o.eyes) e.pupil.scale.y = e.base * ey;
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
  // Each enemy: { root, yaw, body, mats (cloned, for the burn tint), eyes, anim(t, e) }. They scowl and bare teeth.
  const dark = (c, k) => new THREE.Color(c).multiplyScalar(k);
  const EN = {
    globo(o, c) {   // a sinister balloon: scowling eyes and a jagged grin
      const m = o.mat(glossy(c.col, { clearcoat: 1 })), R = new THREE.Vector3(0.29, 0.31, 0.28), g = new THREE.Group(); g.position.y = 0.3; o.body.add(g);
      o.float = 0.42; mesh(sph, m, g, 0, 0, 0, R.x, R.y, R.z);
      mesh(cone, m, o.body, 0, -0.01, 0, 0.05, 0.07, 0.05).rotation.x = Math.PI;
      o.body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0.04, -0.14, 0), new THREE.Vector3(-0.03, -0.26, 0.02), new THREE.Vector3(0.02, -0.36, 0)]), 12, 0.008, 5), o.mat(matte('#e9dcc6'))));
      o.eyes = scowl(g, R, { up: 0.72, size: 0.07, brow: o.mat(glossy(dark(c.col, 0.45))) });
      teeth(g, R, { up: 0.36, width: 0.2, n: 6, fangs: true });
      o.anim = (t, e) => { o.body.rotation.z = Math.sin(t * 2 + e.bob) * 0.12; o.body.position.y = o.float + Math.sin(t * 3 + e.bob) * 0.05; };
    },
    gota(o, c) {   // a sullen drop with a heavy brow and a frown full of teeth
      const m = o.mat(glossy(c.col, { transparent: true, opacity: 0.9, clearcoat: 1, roughness: 0.1, envMapIntensity: 1.4 }));
      const pts = [];   // drop profile, bottom to tip: a round belly tapering to a point
      for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(a) * 0.27), 0.3 - Math.cos(a) * 0.28)); }
      for (let i = 1; i <= 10; i++) { const u = i / 10; pts.push(new THREE.Vector2(Math.max(0.001, 0.27 * Math.pow(1 - u, 1.3)), 0.3 + u * 0.36)); }
      mesh(new THREE.LatheGeometry(pts, 28), m, o.body);
      const R = new THREE.Vector3(0.265, 0.27, 0.265), g = new THREE.Group(); g.position.y = 0.3; o.body.add(g);
      o.eyes = scowl(g, R, { up: 0.67, size: 0.062, brow: o.mat(glossy(dark(c.col, 0.4))) });
      teeth(g, R, { up: 0.27, width: 0.14, n: 5 });
      o.anim = (t, e) => { const s = Math.sin(t * 6 + e.bob); o.body.scale.set(1 + s * 0.06, 1 - s * 0.07, 1 + s * 0.06); };
    },
    murci(o, c) {   // a bat with blazing red eyes and long fangs
      const m = o.mat(glossy(c.col)), wing = o.mat(matte(dark(c.col, 0.5), { side: THREE.DoubleSide })), R = new THREE.Vector3(0.2, 0.19, 0.18);
      o.float = 0.5; mesh(sph, m, o.body, 0, 0, 0, R.x, R.y, R.z);
      for (const s of [-1, 1]) mesh(cone, m, o.body, s * 0.1, 0.18, 0, 0.05, 0.16, 0.04).rotation.z = -s * 0.3;
      const sh = new THREE.Shape(); sh.moveTo(0, 0.05); sh.quadraticCurveTo(0.2, 0.18, 0.44, 0.14); sh.lineTo(0.38, 0.0); sh.quadraticCurveTo(0.32, 0.04, 0.27, -0.05); sh.quadraticCurveTo(0.21, 0.0, 0.16, -0.07); sh.quadraticCurveTo(0.08, -0.02, 0, -0.05); sh.closePath();
      const wg = new THREE.ShapeGeometry(sh, 6);
      o.wings = [-1, 1].map(s => { const piv = new THREE.Group(); piv.position.set(s * 0.14, 0.02, -0.02); o.body.add(piv); const w = mesh(wg, wing, piv); w.scale.x = s; return piv; });
      o.eyes = scowl(o.body, R, { up: 0.74, sep: 0.4, size: 0.05, pupil: o.mat(new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false })), brow: o.mat(glossy(dark(c.col, 0.35))) });
      teeth(o.body, R, { up: 0.27, width: 0.12, n: 4, fangs: true });
      o.anim = (t, e) => { const f = Math.sin(t * 18 + e.bob); o.wings.forEach((w, i) => { w.rotation.y = (i ? -1 : 1) * f * 0.7; w.rotation.x = 1.2; }); o.body.position.y = o.float + f * 0.03; };
    },
    chispa(o, c) {   // a crackling spark: spinning spikes, furious glare
      const m = o.mat(glossy(c.col, { emissive: c.col, emissiveIntensity: 0.25 })), R = new THREE.Vector3(0.21, 0.21, 0.21);
      o.float = 0.4; mesh(sph, m, o.body, 0, 0, 0, 0.21);
      o.spikes = new THREE.Group(); o.body.add(o.spikes);
      for (let i = 0; i < 12; i++) { const n = new THREE.Vector3().setFromSphericalCoords(1, Math.acos(1 - 2 * (i + 0.5) / 12), i * 2.4); const s = mesh(cone, m, o.spikes, n.x * 0.24, n.y * 0.24, n.z * 0.24, 0.045, 0.18, 0.045); s.quaternion.setFromUnitVectors(Y, n); }
      o.eyes = scowl(o.body, R, { up: 0.72, size: 0.06, browTilt: 0.7 });
      teeth(o.body, R, { up: 0.30, width: 0.13, n: 5 });
      o.anim = (t, e) => { o.spikes.rotation.y = t * 3; o.spikes.rotation.x = t * 1.7; o.body.position.y = o.float + Math.sin(t * 9 + e.bob) * 0.03; };
    },
    fantasma(o, c) {   // a wraith: hollow slanted eyes and a gaping jagged maw
      const m = o.mat(glossy(c.col, { transparent: true, opacity: 0.88, emissive: '#c9d4ff', emissiveIntensity: 0.3, roughness: 0.35 }));
      const pts = [new THREE.Vector2(0.29, 0.02), new THREE.Vector2(0.27, 0.2), new THREE.Vector2(0.255, 0.4)];   // hem → dome top
      for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * 0.255), 0.55 + Math.sin(a) * 0.26)); }
      const geo = new THREE.LatheGeometry(pts, 28), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.05) { const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, 0.02 + Math.sin(a * 7) * 0.05); }
      geo.computeVertexNormals(); o.float = 0.12; o.ghost = mesh(geo, m, o.body); o.body.scale.setScalar(0.9);
      const R = new THREE.Vector3(0.26, 0.26, 0.26), g = new THREE.Group(); g.position.y = 0.52; o.body.add(g);
      const hollow = o.mat(new THREE.MeshBasicMaterial({ color: '#0a0b1c' }));
      o.eyes = [-1, 1].map(s => { const d = decal(g, R, s * 0.3, 0.62); const e = mesh(sphLo, hollow, d, 0, 0, 0, 0.06, 0.04, 0.02); e.rotation.z = s * 0.5; mesh(sphLo, o.mat(new THREE.MeshBasicMaterial({ color: '#9fe8ff', toneMapped: false })), e, -s * 0.2, -0.1, 0.6, 0.25, 0.35, 0.3); return { g: d, pupil: e, base: 0.04 }; });
      const maw = decal(g, R, 0, 0.27); mesh(sphLo, hollow, maw, 0, 0, 0, 0.09, 0.06, 0.02);
      for (let i = 0; i < 4; i++) mesh(toothGeo, o.mat(glossy('#ffffff')), maw, (i - 1.5) * 0.04, 0.045, 0.01, 0.012, 0.035, 0.01);
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
      o.eyes = scowl(g, R, { up: 0.70, size: 0.065, pupil: o.mat(new THREE.MeshBasicMaterial({ color: '#ffd23f', toneMapped: false })), browTilt: 0.65 });
      teeth(g, R, { up: 0.34, width: 0.2, n: 6, fangs: true });
      for (const s of [-1, 1]) mesh(sph, o.mat(glossy(dark(c.col, 0.7))), o.body, s * 0.13, 0.03, 0.03, 0.07, 0.05, 0.09);
      o.anim = (t, e) => { o.body.position.y = o.float + Math.abs(Math.sin(t * 7 + e.bob)) * 0.06; tail.rotation.y = Math.sin(t * 4) * 0.3; tip.rotation.y = tail.rotation.y; };
    },
    calavera(o, c) {   // a floating skull: dark sockets with burning red points, clattering jaw
      const bone = o.mat(glossy('#ece2cc', { roughness: 0.5, clearcoat: 0.3 })), red = o.mat(new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false })), R = new THREE.Vector3(0.24, 0.22, 0.24);
      o.float = 0.38; const skull = new THREE.Group(); skull.position.y = 0.05; o.body.add(skull); mesh(sph, bone, skull, 0, 0, 0, R.x, R.y, R.z);
      const jaw = new THREE.Group(); jaw.position.set(0, -0.14, 0.04); o.body.add(jaw); mesh(box, bone, jaw, 0, 0, 0, 0.2, 0.07, 0.18);
      for (let i = 0; i < 5; i++) mesh(box, o.mat(glossy('#fffbea')), jaw, (i - 2) * 0.034, 0.045, 0.085, 0.026, 0.03, 0.02);
      const sockets = o.mat(new THREE.MeshBasicMaterial({ color: '#050307' }));
      for (const s of [-1, 1]) { const d = decal(skull, R, s * 0.35, 0.62); const so = mesh(sphLo, sockets, d, 0, 0, 0, 0.075, 0.065, 0.03); so.rotation.z = s * 0.4; mesh(sphLo, red, d, 0, -0.005, 0.02, 0.022); }
      mesh(cone, sockets, decal(skull, R, 0, 0.34), 0, 0, 0, 0.022, 0.045, 0.01).rotation.x = Math.PI;
      o.eyes = [];
      o.anim = (t, e) => { o.body.position.y = o.float + Math.sin(t * 3 + e.bob) * 0.05; jaw.position.y = -0.14 - Math.abs(Math.sin(t * 6)) * 0.035; };
    },
    jefe(o, c) {   // the boss: a crowned brute with a furious glare and a mouthful of fangs
      const m = o.mat(glossy(c.col, { clearcoat: 1 })), R = new THREE.Vector3(0.3, 0.3, 0.28), g = new THREE.Group(); g.position.y = 0.32; o.body.add(g);
      o.float = 0.05; mesh(sph, m, g, 0, 0, 0, R.x, R.y, R.z);
      for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.35; const s = mesh(cone, GOLD, g, Math.sin(a) * 0.2, 0.28, Math.cos(a) * 0.05 - 0.02, 0.04, 0.14, 0.04); s.rotation.z = -a * 0.6; }
      o.eyes = scowl(g, R, { up: 0.68, size: 0.075, pupil: o.mat(new THREE.MeshBasicMaterial({ color: '#ff3b3b', toneMapped: false })), browTilt: 0.6 });
      teeth(g, R, { up: 0.34, width: 0.24, n: 7, fangs: true });
      for (const s of [-1, 1]) mesh(sph, m, o.body, s * 0.3, 0.25, 0.05, 0.08);
      o.anim = (t, e) => { o.body.position.y = o.float + Math.abs(Math.sin(t * 4 + e.bob)) * 0.05; o.body.rotation.z = Math.sin(t * 2) * 0.06; };
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
      let o = bombers.get(p); if (!o || o.pal !== p.pal || (heroTpl && !o.glb)) { if (o) dispose(o); o = heroTpl ? makeHeroGLB(p.pal) : makeBomber(p.pal); o.pal = p.pal; bombers.set(p, o); }
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
    for (const pal of pals) out.push(heroTpl ? makeHeroGLB(pal) : makeBomber(pal));
    for (const def of defs) out.push(makeEnemy({ def, bob: 0 }));
    return { remove: () => out.forEach(dispose) };
  }
  return { update, samples, set onReady(f) { onReady = f; }, get ready() { return !!heroTpl; } };
}
