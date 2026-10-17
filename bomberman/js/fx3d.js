// ================= 3D bombs, explosions and power-ups (WebGL · Three.js) =================
// Presentation only: a light transparent layer between the 3D board and the game's 2D layer. It reads the
// game's bombs, blasts and items each frame and draws them as lit 3D models seen through the board's camera,
// so the static diorama (board3d.js) never has to re-render for them. Nothing here changes game state.
//
// World space matches board3d.js: one unit per tile; tile (x, y) is centred at (x + 0.5, 0, y + 0.5).
import * as THREE from '../vendor/three.module.min.js';

const Fx3D = (() => {
  let renderer = null, scene, camera, hemi, sun, fill, key, canvas = null, onLost = null, world = null;
  let W = 1, H = 1, pr = 1, drawn = false, shakeCss = '';
  const bombs = new Map(), cards = new Map(), icons = {}, sparks = [], lights = [];
  const V = new THREE.Vector3(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), C = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3();
  let K = null;   // shared geometries and materials
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

  // Flames: additive fresnel shells with rolling noise — white-hot core, yellow, orange, smoky red rim.
  // Alpha is left untouched (custom blending), so on the transparent canvas the fire adds light to the board.
  function flameMaterial(core) {
    return new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, core: { value: core } },
      vertexShader: `
        varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vC;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vP = wp.xyz; vC = instanceColor;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float time; uniform float core; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vC;
        float h(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
        float n3(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {
          float fr = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
          float n = n3(vP * 3.2 + vec3(0.0, -time * 3.5, time * 1.3)) * 0.65 + n3(vP * 7.0 - vec3(time * 2.0, time * 4.0, 0.0)) * 0.35;
          float heat = clamp(pow(fr, 1.2) * (0.42 + core * 0.45) + (n - 0.5) * 0.75 + 0.08, 0.0, 1.0);
          vec3 col = mix(vec3(0.55, 0.06, 0.02), vec3(1.0, 0.36, 0.05), smoothstep(0.0, 0.35, heat));
          col = mix(col, vec3(1.0, 0.82, 0.25), smoothstep(0.35, 0.7, heat));
          col = mix(col, vec3(1.0, 0.97, 0.85), smoothstep(0.8, 1.0, heat));
          float a = smoothstep(0.0, 0.3, fr) * (0.7 + 0.5 * n);
          gl_FragColor = vec4(col * a * vC.r * (0.8 - core * 0.15), 1.0);
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
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
      const cx = ex.x + 0.5, cz = ex.y + 0.5, a = ex.arms;
      if (li < lights.length) { const L = lights[li++]; L.position.set(cx, 0.9, cz); L.intensity = 6 * w * (0.9 + 0.2 * Math.random()); L.distance = 2.5 + ex.power * 0.5; }
      for (let s = 0; s < 2; s++) {
        const R = RAD[s] * w, pm = P[s], am = A[s], fade = 0.35 + 0.65 * w;
        const puff = (x, y, z, r) => { if (pm.count >= pm.instanceMatrix.count) return; M4.compose(V.set(x, y, z), Q.identity(), S.set(r, r * 0.9, r)); pm.setMatrixAt(pm.count, M4); pm.setColorAt(pm.count, C.setRGB(fade, 0, 0)); pm.count++; };
        puff(cx, HY + 0.05, cz, R * (1.3 + 0.08 * Math.sin(st.t * 40)));
        for (let d = 0; d < 4; d++) {
          const L = a[d]; if (L <= 0) continue;
          const dx = DIRS[d][0], dz = DIRS[d][1];
          if (am.count < am.instanceMatrix.count) {
            Q.setFromUnitVectors(V.set(1, 0, 0), S.set(dx, 0, dz));
            M4.compose(V.set(cx + dx * L / 2, HY, cz + dz * L / 2), Q, S.set(L, R * 0.92, R * 0.92));
            am.setMatrixAt(am.count, M4); am.setColorAt(am.count, C.setRGB(fade, 0, 0)); am.count++;
          }
          for (let i = 1; i <= Math.ceil(L); i++) {
            const f = Math.min(i, L), r = R * (1.02 + 0.13 * Math.sin(st.t * 30 + i * 2.1 + d + s));
            puff(cx + dx * f, HY, cz + dz * f, r);
          }
        }
      }
    }
    for (let i = li; i < lights.length; i++) lights[i].intensity = 0;
    for (const m of [...P, ...A]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    K.flameOut.uniforms.time.value = K.flameIn.uniforms.time.value = st.t;
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
    K = makeKit();
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
  // st: { t, bombs, bombTime, armed(b), explosions, items, grid, EMPTY, cols, icon(type, px), itemDefs }
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
    let busy = st.bombs.length > 0 || st.explosions.length > 0;
    if (!busy) for (let j = 0; j < st.items.length; j++) if (st.items[j] && st.grid[j] === st.EMPTY) { busy = true; break; }
    if (!busy) {
      if (bombs.size || cards.size) { updateBombs(st); updateCards(st, 0); updateFlames(st); }
      if (drawn) { renderer.clear(); drawn = false; }
      return;
    }
    // cards lean back toward the camera, a little less than facing it so their bevel catches the light
    const el = Math.atan2(bc.position.y, Math.hypot(bc.position.z - 6.5, bc.position.x - 7.5));
    updateBombs(st); updateCards(st, el - 0.22); updateFlames(st);
    renderer.render(scene, camera); drawn = true;
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
