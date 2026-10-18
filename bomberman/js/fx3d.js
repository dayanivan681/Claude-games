// ================= 3D bombs, explosions and power-ups (WebGL · Three.js) =================
// Presentation only: a light transparent layer between the 3D board and the game's 2D layer. It reads the
// game's bombs, blasts and items each frame and draws them as lit 3D models seen through the board's camera,
// so the static diorama (board3d.js) never has to re-render for them. Nothing here changes game state.
//
// World space matches board3d.js: one unit per tile; tile (x, y) is centred at (x + 0.5, 0, y + 0.5).
import * as THREE from '../vendor/three.module.min.js';
import { makeChars } from './chars3d.js';

const Fx3D = (() => {
  let renderer = null, scene, camera, hemi, sun, fill, key, canvas = null, onLost = null, world = null;
  let W = 1, H = 1, pr = 1, drawn = false, shakeCss = '', lastT = 0, warm = false;
  const bombs = new Map(), cards = new Map(), icons = {}, sparks = [], lights = [];
  const V = new THREE.Vector3(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), C = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3();
  let K = null, chars = null;   // shared geometries and materials; the 3D characters (chars3d.js)
  const ICON_R = 0.32;   // half-size of the board area an item icon canvas covers (the card face is ±0.3)

  // Soft round blob used for contact shadows and floor glows.
  function blobTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  // A small studio environment (warm sky, dark forest floor, two soft boxes) for glossy reflections.
  function studioEnv() {
    const env = new THREE.Scene(), geo = new THREE.SphereGeometry(10, 32, 16), col = [];
    const top = new THREE.Color('#ffe9c8'), mid = new THREE.Color('#6f7d5c'), bot = new THREE.Color('#141c0e');
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 10; C.copy(y > 0 ? mid : bot).lerp(y > 0 ? top : mid, y > 0 ? y : 1 + y); col.push(C.r, C.g, C.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const box = (x, y, z, w, h, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.92, k * 0.8), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    box(-5, 7, -4, 5, 3, 7); box(6, 4, 5, 3, 2, 2.5);
    const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(env, 0.02);
    pm.dispose(); geo.dispose();
    return rt.texture;
  }
  // Rounded square (power-up card outline).
  function roundRect(s, r) {
    const h = s / 2, sh = new THREE.Shape();
    sh.moveTo(-h + r, -h); sh.lineTo(h - r, -h); sh.quadraticCurveTo(h, -h, h, -h + r); sh.lineTo(h, h - r); sh.quadraticCurveTo(h, h, h - r, h);
    sh.lineTo(-h + r, h); sh.quadraticCurveTo(-h, h, -h, h - r); sh.lineTo(-h, -h + r); sh.quadraticCurveTo(-h, -h, -h + r, -h);
    return sh;
  }

  const NOISE = `
    float h(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
    float n3(vec3 p) {
      vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
    }`;
  // Flames: additive shells shaded like real fire — a blackbody ramp (deep red → orange → yellow → pale core),
  // turbulent tongues licking upward, cooling to dull red as the blast dies. instanceColor: r = strength, g = age.
  // Alpha is left untouched (custom blending), so on the transparent canvas the fire adds light to the board.
  function flameMaterial(core) {
    return new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, core: { value: core } },
      vertexShader: `
        uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vC;
        ${NOISE}
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          float sc = length(instanceMatrix[1].xyz);
          float t = n3(wp.xyz * 2.6 + vec3(0.0, -time * 4.0, 0.0));
          wp.xyz += n * (t - 0.4) * 0.22 * sc;                       // boiling surface
          wp.y += max(0.0, n.y) * t * t * 0.55 * sc * (1.0 + instanceColor.g);   // tongues lick upward, taller as it burns out
          vP = wp.xyz; vC = instanceColor; vN = n;
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float time; uniform float core; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vC;
        ${NOISE}
        vec3 blackbody(float t) {
          vec3 c = mix(vec3(0.22, 0.015, 0.0), vec3(0.78, 0.12, 0.01), smoothstep(0.0, 0.25, t));
          c = mix(c, vec3(1.0, 0.3, 0.03), smoothstep(0.2, 0.5, t));
          c = mix(c, vec3(1.0, 0.56, 0.12), smoothstep(0.5, 0.8, t));
          return mix(c, vec3(1.0, 0.84, 0.55), smoothstep(0.84, 1.0, t));
        }
        void main() {
          float fr = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
          vec3 q = vP * vec3(3.0, 1.6, 3.0) - vec3(0.0, time * 3.2, 0.0);
          float n = n3(q) * 0.55 + n3(q * 2.3 + 7.1) * 0.3 + n3(q * 5.1 - 3.3) * 0.15;
          float heat = pow(fr, 1.6) * (0.36 + core * 0.46) + (n - 0.5) * 1.15 + 0.06;
          heat *= 1.0 - vC.g * 0.55;                                  // cools as the blast fades
          heat = clamp(heat, 0.0, 1.0);
          float a = smoothstep(0.0, 0.35, fr) * smoothstep(0.18, 0.5, n + fr * 0.3);
          gl_FragColor = vec4(blackbody(heat) * a * vC.r * (0.66 - core * 0.24), 1.0);   // layers add up: keep each one dim so the sum stays orange, not clipped yellow
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
  }
  // Soft billowing smoke and dust. instanceColor: r = brightness, g = opacity, b = warmth (lit from below by fire).
  function smokeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `
        varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vC;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vP = wp.xyz; vC = instanceColor; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vC;
        ${NOISE}
        void main() {
          float fr = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
          float n = n3(vP * 4.0 + vec3(0.0, -time * 0.6, time * 0.3)) * 0.6 + n3(vP * 9.0) * 0.4;
          float lit = 0.62 + 0.38 * clamp(vN.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = vec3(vC.r * lit) * vec3(1.0, 0.96, 0.92) + vec3(0.9, 0.35, 0.08) * vC.b * (1.0 - vN.y) * 0.5;
          float a = smoothstep(0.05, 0.75, fr) * (0.55 + 0.6 * n) * vC.g;
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }`,
      transparent: true, depthWrite: false,
    });
  }

  function makeKit() {
    const blob = blobTexture(), envMap = studioEnv();
    const k = { env: envMap };
    // bomb
    k.body = new THREE.SphereGeometry(0.33, 36, 24);
    k.bodyMat = () => new THREE.MeshPhysicalMaterial({ color: '#161a2c', roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06, envMap, envMapIntensity: 1.5, sheen: 0.3, sheenColor: '#5363a8', emissive: '#ff2a10', emissiveIntensity: 0 });
    k.seam = new THREE.TorusGeometry(0.332, 0.012, 8, 48, Math.PI * 0.9);
    k.cap = new THREE.CylinderGeometry(0.105, 0.13, 0.12, 24);
    k.metal = new THREE.MeshStandardMaterial({ color: '#d8b06a', roughness: 0.28, metalness: 1, envMap, envMapIntensity: 1.3 });
    const fc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.04, 0.17, -0.02), new THREE.Vector3(0.22, 0.15, -0.05));
    k.fuse = new THREE.TubeGeometry(fc, 14, 0.033, 7, false); k.fuseEnd = fc.getPoint(1);
    k.rope = new THREE.MeshStandardMaterial({ color: '#f0cf96', roughness: 0.85 });
    k.spark = new THREE.SphereGeometry(0.055, 10, 8);
    k.sparkMat = new THREE.MeshBasicMaterial({ color: '#fff6c8' });
    k.led = new THREE.SphereGeometry(0.035, 10, 8);
    // contact shadow and floor glow
    k.plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    k.shadowMat = new THREE.MeshBasicMaterial({ color: '#000', map: blob, transparent: true, opacity: 0.5, depthWrite: false });
    k.glowMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // power-up card: bevelled rounded square, the icon on its face
    k.card = new THREE.ExtrudeGeometry(roundRect(0.6, 0.13), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 3, curveSegments: 8 });
    k.card.translate(0, 0, -0.04);
    // flames: spheres (core, puffs, tips) and open cylinders (arms), two shells each
    k.puffGeo = new THREE.IcosahedronGeometry(1, 3);
    k.armGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).rotateZ(Math.PI / 2);   // along x
    k.flameOut = flameMaterial(0); k.flameIn = flameMaterial(1);
    const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); scene.add(m); return m; };
    k.puffOut = inst(k.puffGeo, k.flameOut, 320); k.puffIn = inst(k.puffGeo, k.flameIn, 320);
    k.armOut = inst(k.armGeo, k.flameOut, 96); k.armIn = inst(k.armGeo, k.flameIn, 96);
    k.puffIn.renderOrder = k.armIn.renderOrder = 2;
    // crumbling blocks: the brick model while it heats, then textured fragments (three UV crops of the brick face)
    k.chunks = [0, 1, 2].map(v => {
      const g = new THREE.BoxGeometry(1, 0.8, 0.9), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.12 + v * 0.27 + uv.getX(i) * 0.3, 0.2 + v * 0.2 + uv.getY(i) * 0.3);
      return g;
    });
    k.ember = new THREE.IcosahedronGeometry(1, 1);
    k.emberMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    k.smokeMat = smokeMaterial();
    k.ashGeo = new THREE.BoxGeometry(1, 0.35, 1);
    k.ashMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    k.embers = inst(k.ember, k.emberMat, 600); k.embers.renderOrder = 3;
    k.smoke = inst(k.puffGeo, k.smokeMat, 160); k.smoke.renderOrder = 4;
    k.ash = inst(k.ashGeo, k.ashMat, 400);
    k.inst = inst;
    return k;
  }

  // ---------- bombs ----------
  function makeBomb() {
    const g = new THREE.Group(), tilt = new THREE.Group(), roll = new THREE.Group(), mat = K.bodyMat();
    const body = new THREE.Mesh(K.body, mat); roll.add(body);
    const seam = new THREE.Mesh(K.seam, K.metal); seam.rotation.z = 0.5; roll.add(seam);   // a riveted seam shows the bomb rolling
    roll.position.y = 0.33; tilt.add(roll);
    const top = new THREE.Group(); top.position.y = 0.33 + 0.3; tilt.add(top);   // cap + fuse ride on top of the body (they don't roll)
    const cap = new THREE.Mesh(K.cap, K.metal); cap.position.y = 0.02; top.add(cap);
    const fuse = new THREE.Group(); fuse.position.y = 0.075; top.add(fuse);
    fuse.add(new THREE.Mesh(K.fuse, K.rope));
    const spark = new THREE.Mesh(K.spark, K.sparkMat); spark.position.copy(K.fuseEnd); fuse.add(spark);
    const led = new THREE.Mesh(K.led, new THREE.MeshBasicMaterial({ color: '#ff3b3b' })); led.position.set(0, 0.085, 0); top.add(led);
    const shadow = new THREE.Mesh(K.plane, K.shadowMat); shadow.position.y = 0.012; g.add(shadow);
    g.add(tilt); scene.add(g);
    return { g, tilt, roll, top, fuse, spark, led, shadow, mat, px: null, py: 0 };
  }
  function updateBombs(st) {
    const seen = new Set();
    for (const b of st.bombs) {
      let o = bombs.get(b); if (!o) { o = makeBomb(); bombs.set(b, o); }
      seen.add(b);
      const age = st.t - b.born, armed = st.armed(b), urg = armed ? 1 - b.timer / st.bombTime : 0.2;
      const pulse = 1 + Math.sin(st.t * (8 + urg * 20)) * (0.04 + urg * 0.05);
      const pop = age < 0.2 ? 1 + 0.3 * Math.sin(age / 0.2 * Math.PI) : 1;
      o.g.position.set(b.x + 0.5, 0, b.y + 0.5);
      o.tilt.scale.set(pulse * pop, pulse / pop, pulse * pop);
      // kicked bombs roll along the ground
      if (o.px !== null) {
        const dx = b.x - o.px, dz = b.y - o.py, d = Math.hypot(dx, dz);
        if (d > 1e-5) { AX.set(dz, 0, -dx).normalize(); Q.setFromAxisAngle(AX, d / 0.33); o.roll.quaternion.premultiply(Q); }
      }
      o.px = b.x; o.py = b.y;
      const hot = urg > 0.62 ? (urg - 0.62) * 1.3 * (0.55 + 0.45 * Math.sin(st.t * 32)) : 0;
      o.mat.emissiveIntensity = hot * 2.2;
      const fl = armed ? Math.max(0.25, b.timer / st.bombTime) : 1;
      o.fuse.scale.set(fl, 0.4 + 0.6 * fl, fl);
      o.spark.visible = armed; o.led.visible = !armed;
      if (!armed) o.led.material.color.set(Math.sin(st.t * 10) > 0 ? '#ff3b3b' : '#4a0d0d');
      o.shadow.scale.setScalar(0.78 * pulse);
      if (armed) {
        o.spark.scale.setScalar(0.8 + Math.random() * 0.7);
        o.spark.getWorldPosition(V); sparks.push([V.x, V.y, V.z, 1]);
      } else if (Math.sin(st.t * 10) > 0) { o.led.getWorldPosition(V); sparks.push([V.x, V.y, V.z, 2]); }
    }
    for (const [b, o] of bombs) if (!seen.has(b)) { scene.remove(o.g); o.mat.dispose(); o.led.material.dispose(); bombs.delete(b); }
  }

  // ---------- power-ups ----------
  function iconMat(type, st) {
    if (icons[type]) return icons[type];
    const tex = new THREE.CanvasTexture(st.icon(type, 256));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    tex.repeat.set(1 / (2 * ICON_R), 1 / (2 * ICON_R)); tex.offset.set(0.5, 0.5);   // the face's UVs are its outline coordinates
    const d = st.itemDefs[type];
    return (icons[type] = [
      new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.38 }),   // matte face: a flat glossy face would flash white as it sways
      new THREE.MeshPhysicalMaterial({ color: d.color, roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, envMap: K.env, envMapIntensity: 0.9 }),
      new THREE.Color(d.color),
    ]);
  }
  function makeCard(type, st) {
    const m = iconMat(type, st), g = new THREE.Group();
    const card = new THREE.Mesh(K.card, [m[0], m[1]]); g.add(card);
    const shadow = new THREE.Mesh(K.plane, K.shadowMat), halo = new THREE.Mesh(K.plane, K.glowMat.clone());
    halo.material.color.copy(m[2]); shadow.position.y = 0.011; halo.position.y = 0.013;
    scene.add(g, shadow, halo);
    return { g, card, shadow, halo, type };
  }
  function updateCards(st, tilt) {
    const seen = new Set(), { items, grid, EMPTY, cols } = st;
    for (let j = 0; j < items.length; j++) {
      const it = items[j]; if (!it || grid[j] !== EMPTY) continue;
      let o = cards.get(j);
      if (o && o.type !== it) { dropCard(j, o); o = null; }
      if (!o) { o = makeCard(it, st); cards.set(j, o); }
      seen.add(j);
      const x = j % cols, y = (j / cols) | 0, ph = st.t * 4 + x + y, bob = Math.sin(ph) * 0.05;
      o.g.position.set(x + 0.5, 0.42 + bob, y + 0.5 + 0.06);
      o.g.rotation.set(-tilt, Math.sin(st.t * 1.6 + x * 0.7 + y) * 0.42, 0, 'YXZ');
      o.shadow.position.set(x + 0.5, 0.011, y + 0.5); o.shadow.scale.setScalar(0.72 - bob * 1.2);
      o.halo.position.set(x + 0.5, 0.013, y + 0.5); o.halo.scale.setScalar(1.15); o.halo.material.opacity = 0.35 + 0.2 * Math.sin(st.t * 5 + x);
    }
    for (const [j, o] of cards) if (!seen.has(j)) dropCard(j, o);
  }
  // ---------- the exit portal: a disc on the floor with spinning arms, so characters walk over it ----------
  let portal = null; const portalTexs = {};
  function updatePortal(st) {
    const e = st.exit;
    if (!e) { if (portal) portal.g.visible = false; return; }
    if (!portal) {
      const flat = new THREE.CircleGeometry(0.5, 40).rotateX(-Math.PI / 2), mat = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      const g = new THREE.Group(), disc = new THREE.Mesh(flat, mat()), swirl = new THREE.Mesh(flat, mat());
      disc.position.y = 0.012; swirl.position.y = 0.016; disc.renderOrder = swirl.renderOrder = -1; g.add(disc, swirl); scene.add(g);
      portal = { g, disc, swirl, key: '' };
    }
    const key = e.accent + (e.open ? '1' : '0');
    if (key !== portal.key) {
      portal.key = key;
      const tx = sw => portalTexs[key + sw] || (portalTexs[key + sw] = (() => { const t = new THREE.CanvasTexture(st.portalTex(e.open, sw, e.accent, 256)); t.colorSpace = THREE.SRGBColorSpace; return t; })());
      portal.disc.material.map = tx(false); portal.swirl.material.map = tx(true); portal.disc.material.needsUpdate = portal.swirl.material.needsUpdate = true;
    }
    portal.g.visible = true; portal.g.position.set(e.x + 0.5, 0, e.y + 0.5);
    portal.swirl.rotation.y = -st.t * (e.open ? 5 : 1.2);
    const pulse = e.open ? 1 + 0.04 * Math.sin(st.t * 6) : 1; portal.g.scale.set(pulse, 1, pulse);
  }
  function dropCard(j, o) { scene.remove(o.g, o.shadow, o.halo); o.halo.material.dispose(); cards.delete(j); }

  // ---------- explosions ----------
  const DIRS = [[0, 1], [-1, 0], [1, 0], [0, -1]];
  function updateFlames(st) {
    const P = [K.puffOut, K.puffIn], A = [K.armOut, K.armIn], RAD = [0.44, 0.25], HY = 0.36;
    for (const m of P) m.count = 0; for (const m of A) m.count = 0;
    let li = 0;
    for (const ex of st.explosions) {
      const k = ex.t / ex.dur, w = Math.max(0, k < 0.1 ? 1 - Math.pow(1 - k / 0.1, 3) : k > 0.5 ? 1 - (k - 0.5) / 0.5 : 1);
      if (w <= 0) continue;
      const cx = ex.x + 0.5, cz = ex.y + 0.5, a = ex.arms, rise = k * 0.22;
      blastFx(ex, cx, cz, k);
      if (li < lights.length) { const L = lights[li++]; L.position.set(cx, 0.9, cz); L.intensity = 2.4 * w * (0.9 + 0.2 * Math.random()); L.distance = 2.5 + ex.power * 0.5; }
      for (let s = 0; s < 2; s++) {
        const R = RAD[s] * w, pm = P[s], am = A[s], fade = 0.35 + 0.65 * w;
        const puff = (x, y, z, r) => { if (pm.count >= pm.instanceMatrix.count) return; M4.compose(V.set(x, y + rise, z), Q.identity(), S.set(r, r * 0.9, r)); pm.setMatrixAt(pm.count, M4); pm.setColorAt(pm.count, C.setRGB(fade, k, 0)); pm.count++; };
        puff(cx, HY + 0.05, cz, R * (1.3 + 0.08 * Math.sin(st.t * 40)));
        for (let d = 0; d < 4; d++) {
          const L = a[d]; if (L <= 0) continue;
          const dx = DIRS[d][0], dz = DIRS[d][1];
          if (am.count < am.instanceMatrix.count) {
            Q.setFromUnitVectors(V.set(1, 0, 0), S.set(dx, 0, dz));
            M4.compose(V.set(cx + dx * L / 2, HY, cz + dz * L / 2), Q, S.set(L, R * 0.92, R * 0.92));
            am.setMatrixAt(am.count, M4); am.setColorAt(am.count, C.setRGB(fade, k, 0)); am.count++;
          }
          for (let i = 1; i <= Math.ceil(L); i++) {
            const f = Math.min(i, L), r = R * (1.02 + 0.13 * Math.sin(st.t * 30 + i * 2.1 + d + s));
            puff(cx + dx * f, HY, cz + dz * f, r);
          }
        }
      }
    }
    li = updateBurns(st, li);
    for (let i = li; i < lights.length; i++) lights[i].intensity = 0;
    for (const m of [...P, ...A]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    K.flameOut.uniforms.time.value = K.flameIn.uniforms.time.value = K.smokeMat.uniforms.time.value = st.t;
  }
  // One-off effects for a blast: a burst of embers as it goes off, a dark smoke plume as it dies.
  const blasts = new WeakMap();
  function blastFx(ex, cx, cz, k) {
    let o = blasts.get(ex); if (!o) { o = { boom: false, smoke: false }; blasts.set(ex, o); }
    if (!o.boom) {
      o.boom = true;
      for (let i = 0; i < 18; i++) { const a = Math.random() * 6.283, sp = 1.5 + Math.random() * 3.5; ember(cx, 0.4, cz, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, 0.5 + Math.random() * 0.6); }
    }
    if (!o.smoke && k > 0.45) {
      o.smoke = true;
      const tiles = [[cx, cz]];
      for (let d = 0; d < 4; d++) for (let i = 1; i <= Math.ceil(ex.arms[d]); i++) { const f = Math.min(i, ex.arms[d]); tiles.push([cx + DIRS[d][0] * f, cz + DIRS[d][1] * f]); }
      for (const [x, z] of tiles) if (Math.random() < 0.7) smoke(x, 0.45, z, 0.22, 0.16, 0.75, 0.3, 1.2 + Math.random() * 0.6);
    }
  }

  // ---------- particles: block fragments, embers, smoke, ash ----------
  const parts = [];   // { kind, x, y, z, vx, vy, vz, life, max, s, q, ax, w, v, ... }
  const R3 = () => Math.random() * 2 - 1;
  function ember(x, y, z, vx, vy, vz, life) { parts.push({ kind: 'ember', x, y, z, vx, vy, vz, life, max: life, s: 0.02 + Math.random() * 0.025, ph: Math.random() * 6 }); }
  function smoke(x, y, z, s0, shade, alpha, warm, life, delay = 0) { parts.push({ kind: 'smoke', x: x + R3() * 0.15, y, z: z + R3() * 0.15, vx: R3() * 0.15, vy: 0.45 + Math.random() * 0.4, vz: R3() * 0.15, life, max: life, s: s0, shade, alpha, warm, delay }); }
  function solid(kind, x, y, z, vx, vy, vz, s, life, v = 0) {
    const ax = new THREE.Vector3(R3(), R3(), R3()).normalize();
    parts.push({ kind, x, y, z, vx, vy, vz, s, life, max: life, v, q: new THREE.Quaternion().setFromAxisAngle(ax, Math.random() * 6), ax, w: 6 + Math.random() * 12, sx: 0.8 + Math.random() * 0.4, sz: 0.8 + Math.random() * 0.4 });
  }
  // A block shatters: textured fragments burst out and tumble, glowing at first and cooling to dusty brick, then
  // settle and sink away; dust and a few embers rise.
  function shatter(x, z, h) {
    for (let i = 0; i < 14; i++) {
      const ox = R3() * 0.32, oz = R3() * 0.32, sp = 1.4 + Math.random() * 2.2, l = Math.hypot(ox, oz) || 1;
      solid('chunk', x + ox, 0.1 + Math.random() * h * 0.8, z + oz, ox / l * sp, 2.2 + Math.random() * 3.4, oz / l * sp, 0.13 + Math.random() * 0.13, 1.0 + Math.random() * 0.6, i % 3);
    }
    for (let i = 0; i < 9; i++) ember(x + R3() * 0.3, 0.3, z + R3() * 0.3, R3() * 0.6, 0.8 + Math.random() * 1.4, R3() * 0.6, 0.6 + Math.random() * 0.7);
    for (let i = 0; i < 4; i++) smoke(x, 0.3, z, 0.2, 0.55, 0.8, 0.35, 1.1 + Math.random() * 0.6, 0.04 + i * 0.07);
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt; if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      if (p.kind === 'smoke') { const d = Math.exp(-1.2 * dt); p.vx *= d; p.vz *= d; p.vy *= Math.exp(-0.5 * dt); }
      else if (p.kind === 'ember') { p.vy += (1.2 - p.vy) * dt * 1.5; const d = Math.exp(-2 * dt); p.vx *= d; p.vz *= d; p.vx += Math.sin(p.ph + p.life * 9) * dt * 1.2; }
      else {
        const ash = p.kind === 'ash';
        p.vy -= (ash ? 3.5 : 15) * dt;
        if (ash) { const d = Math.exp(-2.5 * dt); p.vx *= d; p.vz *= d; p.vx += Math.sin(p.life * 11 + p.w) * dt * 1.5; }
        const floor = p.s * (ash ? 0.18 : 0.4);
        if (p.y < floor) { p.y = floor; if (p.vy < 0) p.vy *= -0.28; p.vx *= 0.55; p.vz *= 0.55; p.w *= 0.5; }
        Q.setFromAxisAngle(p.ax, p.w * dt); p.q.premultiply(Q);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
  }
  function drawParts() {
    const ch = K.chunkMeshes, em = K.embers, sm = K.smoke, as = K.ash;
    for (const m of ch) m.count = 0; em.count = sm.count = as.count = 0;
    for (const p of parts) {
      if (p.delay > 0) continue;
      const k = 1 - p.life / p.max;   // 0 → 1 over the particle's life
      if (p.kind === 'chunk' || p.kind === 'ash') {
        const m = p.kind === 'ash' ? as : ch[p.v]; if (m.count >= m.instanceMatrix.count) continue;
        const sink = p.life < 0.35 ? p.life / 0.35 : 1, s = p.s * sink;
        M4.compose(V.set(p.x, p.y - (1 - sink) * p.s * 0.5, p.z), p.q, S.set(s * p.sx, s, s * p.sz));
        m.setMatrixAt(m.count, M4);
        if (p.kind === 'ash') { const c = 0.16 + 0.1 * (1 - k); m.setColorAt(m.count, C.setRGB(c * 1.1, c, c * 0.95)); }
        else { const heat = Math.pow(Math.max(0, 1 - k * 2.6), 1.6), dust = 0.62 + 0.38 * (1 - k); m.setColorAt(m.count, C.setRGB(dust + heat * 2.6, dust * 0.92 + heat * 1.1, dust * 0.85 + heat * 0.25)); }
        m.count++;
      } else if (p.kind === 'ember') {
        if (em.count >= em.instanceMatrix.count) continue;
        const f = (1 - k) * (0.6 + 0.4 * Math.sin(p.ph + p.life * 25)), s = p.s * (0.6 + 0.4 * (1 - k));
        M4.compose(V.set(p.x, p.y, p.z), Q.identity(), S.set(s, s, s)); em.setMatrixAt(em.count, M4);
        em.setColorAt(em.count, C.setRGB(1.0 * f, (0.55 - k * 0.35) * f, 0.12 * f * (1 - k))); em.count++;
      } else {
        if (sm.count >= sm.instanceMatrix.count) continue;
        const s = p.s * (1 + k * 2.4), a = p.alpha * Math.min(1, k * 6) * (1 - k);
        M4.compose(V.set(p.x, p.y, p.z), Q.identity(), S.set(s, s * 0.85, s)); sm.setMatrixAt(sm.count, M4);
        sm.setColorAt(sm.count, C.setRGB(p.shade, a, p.warm * (1 - k))); sm.count++;
      }
    }
    for (const m of [...ch, em, sm, as]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }

  // ---------- breaking blocks ----------
  const burning = new WeakMap();
  function updateBlocks(st, view) {
    const bm = brickMesh(view); if (!bm) return;
    bm.count = 0;
    const h = view.brick.h;
    for (const b of st.burning) {
      let o = burning.get(b); if (!o) { o = { done: false }; burning.set(b, o); }
      if (o.done) continue;
      const x = b.x + 0.5, z = b.y + 0.5;
      if (b.t >= 0.12) { o.done = true; shatter(x, z, h); continue; }
      const k = b.t / 0.12, sw = 1 + k * 0.08;   // heats up and swells for a moment before it bursts
      M4.compose(V.set(x, h / 2 * sw, z), Q.identity(), S.set(sw, sw, sw)); bm.setMatrixAt(bm.count, M4);
      bm.setColorAt(bm.count, C.setRGB(1 + 0.9 * k, 1 + 0.25 * k, 1 - 0.15 * k)); bm.count++;
    }
    bm.instanceMatrix.needsUpdate = true; if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
  }
  let bricks = null, chunkMat = null;
  function brickMesh(view) {
    if (!view.brick) return null;
    if (!bricks || bricks.geometry !== view.brick.geo) {
      if (bricks) { scene.remove(bricks, ...K.chunkMeshes); warm = false; }   // a new world: compile its block shaders too
      bricks = K.inst(view.brick.geo, view.brick.mat, 48);
      K.chunkMeshes = K.chunks.map(g => K.inst(g, view.brick.mat, 160));
    }
    return bricks;
  }

  // ---------- enemies burning up ----------
  // A burning enemy: flames lick up around it, embers stream off, and as it crumbles it bursts into ash and smoke.
  const burns = new WeakMap();
  function updateBurns(st, li) {
    const P = [K.puffOut, K.puffIn];
    for (const e of st.burns) {
      let o = burns.get(e); if (!o) { o = { ash: false, last: e.deadT }; burns.set(e, o); }
      const big = e.burnBig || 1, x = e.x + 0.5, z = e.y + 0.5, t = e.deadT, dt = Math.max(0, t - o.last); o.last = t;
      if (t < 0.7) {
        const w = t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.62;
        for (let s = 0; s < 2; s++) {
          const pm = P[s];
          for (let i = 0; i < 3; i++) {
            if (pm.count >= pm.instanceMatrix.count) break;
            const a = i * 2.1 + t * 3, r = (s ? 0.14 : 0.24) * big * w * (0.85 + 0.25 * Math.sin(t * 30 + i));
            M4.compose(V.set(x + Math.cos(a) * 0.12 * big, (0.3 + i * 0.12) * big, z + Math.sin(a) * 0.1 * big), Q.identity(), S.set(r, r * 1.3, r));
            pm.setMatrixAt(pm.count, M4); pm.setColorAt(pm.count, C.setRGB(0.9, Math.min(1, t * 1.2), 0)); pm.count++;
          }
        }
        if (li < lights.length) { const L = lights[li++]; L.position.set(x, 0.8, z); L.intensity = 1.8 * w; L.distance = 2.2; }
        if (Math.random() < dt * 40) ember(x + R3() * 0.2 * big, 0.4 * big, z + R3() * 0.2 * big, R3() * 0.5, 0.8 + Math.random(), R3() * 0.5, 0.5 + Math.random() * 0.5);
      }
      if (!o.ash && t > 0.55) {
        o.ash = true;
        for (let i = 0; i < 18 * big; i++) solid('ash', x + R3() * 0.2 * big, (0.2 + Math.random() * 0.5) * big, z + R3() * 0.2 * big, R3() * 1.2, 0.4 + Math.random() * 1.6, R3() * 1.2, (0.04 + Math.random() * 0.05) * big, 0.9 + Math.random() * 0.7);
        for (let i = 0; i < 3; i++) smoke(x, 0.35 * big, z, 0.2 * big, 0.22, 0.85, 0.4, 1.2 + Math.random() * 0.5, i * 0.06);
      }
    }
    return li;
  }

  // ---------- public API ----------
  function init(cv, lost) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    } catch (e) { renderer = null; return false; }
    canvas = cv; onLost = lost;
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
    hemi = new THREE.HemisphereLight('#fff', '#000', 1); sun = new THREE.DirectionalLight('#fff', 3); fill = new THREE.DirectionalLight('#fff', 0.4);
    key = new THREE.DirectionalLight('#fff4e0', 1.6); key.position.set(3, 14, 18); key.target.position.set(7.5, 0, 6.5);   // studio key from the camera side: glossy highlights
    scene.add(hemi, sun, sun.target, fill, fill.target, key, key.target);
    for (let i = 0; i < 3; i++) { const L = new THREE.PointLight('#ff9a3a', 0, 4, 1.6); lights.push(L); scene.add(L); }
    K = makeKit(); chars = makeChars(scene, K.env);
    chars.onReady = () => { warm = false; };   // the hero model arrived: compile its shaders too
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); renderer = null; if (onLost) onLost(); }, false);
    return true;
  }
  function setWorld(w) {
    if (!renderer || w === world) return;
    world = w; const sc = w.scene3d;
    renderer.toneMappingExposure = sc.exposure;
    hemi.color.set(sc.sky.color); hemi.groundColor.set(sc.sky.ground); hemi.intensity = sc.sky.intensity * 1.1;
    sun.color.set(sc.sun.color); sun.intensity = sc.sun.intensity; sun.position.set(7.5 + sc.sun.from[0], sc.sun.from[1], 6.5 + sc.sun.from[2]); sun.target.position.set(7.5, 0, 6.5);
    fill.color.set(sc.fill.color); fill.intensity = sc.fill.intensity + 0.25; fill.position.set(14, 6, 22); fill.target.position.set(7.5, 0, 6.5);
  }
  function resize(w, h, dpr) {
    if (!renderer) return;
    W = w; H = h; pr = Math.min(dpr, 2);
    renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
    drawn = true;   // force a clear on the next frame
  }
  // st: { t, bombs, bombTime, armed(b), explosions, items, grid, EMPTY, cols, icon(type, px), itemDefs,
  //       burning (breaking blocks: x, y, t), burns (enemies burning up: x, y, deadT, burnBig),
  //       players, enemies, phase, mode, pals, enemyDefs (3D characters, chars3d.js) }
  // view: the board camera and current lens pan (Board3D.view()).
  function frame(st, view, shx, shy) {
    sparks.length = 0;
    if (!renderer || !view) return;
    if (view.world) setWorld(view.world);
    const bc = view.camera;
    camera.position.copy(bc.position); camera.quaternion.copy(bc.quaternion);
    camera.fov = bc.fov; camera.aspect = W / H; camera.near = bc.near; camera.far = bc.far;
    camera.setViewOffset(W, H, -view.panX, -view.panY, W, H); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const css = shx || shy ? `translate3d(${shx.toFixed(2)}px,${shy.toFixed(2)}px,0)` : '';
    if (css !== shakeCss) { canvas.style.transform = css; shakeCss = css; }
    const dt = Math.min(0.05, Math.max(0, st.t - lastT)); lastT = st.t;
    if (!warm) { updateBlocks(st, view); prewarm(st, view); }
    let busy = !!st.exit || st.players.length > 0 || st.enemies.length > 0 || st.bombs.length > 0 || st.explosions.length > 0 || st.burning.length > 0 || st.burns.length > 0 || parts.length > 0;
    if (!busy) for (let j = 0; j < st.items.length; j++) if (st.items[j] && st.grid[j] === st.EMPTY) { busy = true; break; }
    if (!busy) {
      if (bombs.size || cards.size || parts.length) { chars.update(st, dt); updateBombs(st); updateCards(st, 0); updateFlames(st); drawParts(); if (bricks) bricks.count = 0; }
      updatePortal(st); if (pillars) pillars.count = 0;
      if (drawn) { renderer.clear(); drawn = false; }
      return;
    }
    // cards lean back toward the camera, a little less than facing it so their bevel catches the light
    const el = Math.atan2(bc.position.y, Math.hypot(bc.position.z - 6.5, bc.position.x - 7.5));
    chars.update(st, dt); updateBombs(st); updateCards(st, el - 0.22); updateBlocks(st, view); updateFlames(st); updatePortal(st); updateFalling(st, view);
    stepParts(dt); drawParts();
    renderer.render(scene, camera); drawn = true;
  }
  // Compile every shader variant once (a bomb, a card, flames, fragments, smoke, the world's blocks) so the first
  // bomb, blast or crumble never stalls a frame on a shader compile. The samples are taken out of the scene but
  // their materials are kept alive: three.js frees a compiled program as soon as the last material using it is
  // disposed, so without them the next bomb after the last one exploded (or the next enemy, card…) would
  // recompile its shader mid-game — a visible hitch on phones.
  let warmKeep = null;
  function prewarm(st, view) {
    warm = true;
    const b = makeBomb(), c = makeCard('bomb', st), cs = chars.samples(st.pals, st.enemyDefs), pm = pillarMesh(view);
    const all = [K.puffOut, K.puffIn, K.armOut, K.armIn, K.embers, K.smoke, K.ash, ...(K.chunkMeshes || []), bricks, pm].filter(Boolean), keep = all.map(m => m.count);
    all.forEach(m => { m.count = Math.max(1, m.count); });
    // compile, upload every face, then really draw it all once: drivers (Safari's included) finish compiling a
    // shader only at its first draw. This frame's normal render paints over it before it is ever shown.
    try { renderer.compile(scene, camera); for (const t of chars.textures()) renderer.initTexture(t); const culled = []; scene.traverse(o => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } }); renderer.render(scene, camera); for (const o of culled) o.frustumCulled = true; } catch (e) { /* only an optimisation */ }
    all.forEach((m, i) => { m.count = keep[i]; });
    scene.remove(b.g, c.g, c.shadow, c.halo); cs.remove();
    if (warmKeep) warmKeep();   // the previous samples' programs are now held by the new ones
    warmKeep = () => { b.mat.dispose(); b.led.material.dispose(); c.halo.material.dispose(); cs.dispose(); };
  }
  // Sudden death: pillars dropping from the sky, and the ones already landed, are drawn here (this layer redraws
  // every frame anyway), so the heavy board never re-renders while the arena closes in.
  let pillars = null;
  function pillarMesh(view) {
    if (!view || !view.pillar) return null;
    if (!pillars || pillars.geometry !== view.pillar.geo) { if (pillars) scene.remove(pillars); pillars = K.inst(view.pillar.geo, view.pillar.mat, 200); }
    return pillars;
  }
  function updateFalling(st, view) {
    const pm = pillarMesh(view); if (!pm) return;
    pm.count = 0;
    const at = (j, drop) => { if (pm.count >= 200) return; M4.compose(V.set(j % st.cols + 0.5, view.pillar.h / 2 + drop, ((j / st.cols) | 0) + 0.5), Q.identity(), S.set(1, 1, 1)); pm.setMatrixAt(pm.count, M4); pm.setColorAt(pm.count++, C.setRGB(0.95, 0.95, 0.95)); };
    for (const j of st.landed || []) at(j, 0);
    for (const f of st.falling || []) { const k = Math.min(1, f.t / 0.35); at(f.j, (1 - k * k) * 5); }
    pm.instanceMatrix.needsUpdate = true; pm.instanceColor.needsUpdate = true;
  }
  // Screen points of lit fuses (kind 1) and blinking detonator lights (kind 2) from the last frame.
  const SP = new THREE.Vector3();
  function eachSpark(cb) {
    for (const s of sparks) { SP.set(s[0], s[1], s[2]).project(camera); cb((SP.x + 1) / 2 * W, (1 - SP.y) / 2 * H, s[3]); }
  }
  return { init, resize, frame, eachSpark, ICON_R };
})();

window.Fx3D = Fx3D;
window.dispatchEvent(new Event('fx3d-ready'));
