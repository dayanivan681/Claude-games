'use strict';
// ================= board renderer =================
// Presentation only. Paints a world (worlds.js) for a level plan (levels.js) and never touches game state:
// it reads the grid, the plan's skins/decals and the view metrics the game hands in. Everything static
// (scenery, floor, walls, posts, lighting) is baked into the background canvas once per level or resize;
// per frame it only blits cached block sprites and emits a few ambient lights.
//
// view: { T, FX, FY, BW, BH, DPR, cols, rows, grid, plan, HARD, SOFT }  (FX/FY = top-left of the 15×13 board)
const Board = (() => {
  let world = null, key = '', lamps = [];
  const spr = {};
  const TOP = 0.69;   // where a block's top face meets its front face (fraction of a tile)

  // ---------- helpers ----------
  const hsh = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const rgb = c => c[0] === '#' ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  const shade = (c, k) => k >= 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k);
  const alpha = (c, a) => `rgba(${rgb(c).join(',')},${a})`;
  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function rrSub(g, x, y, w, h, r) { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const ell = (g, x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, Math.max(1e-4, rx), Math.max(1e-4, ry), rot, 0, Math.PI * 2); };
  const dot = (g, x, y, r) => { g.beginPath(); g.arc(x, y, Math.max(1e-4, r), 0, Math.PI * 2); };
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  // A sprite canvas of k×k tiles at s device px per tile, drawn in tile units.
  function unit(s, k = 1) { const c = canvas(s * k, s * k), g = c.getContext('2d'); g.scale(s, s); return [c, g]; }
  // Soft shadow of a shape: the path is drawn far away and only its blurred shadow lands in place.
  // px = device pixels per drawing unit (shadow offsets/blur ignore the transform).
  function softShadow(g, path, color, blurPx, px) {
    const off = 10000;
    g.save(); g.shadowColor = color; g.shadowBlur = blurPx; g.shadowOffsetX = off * px; g.translate(-off, 0);
    g.fillStyle = '#000'; path(g); g.fill(); g.restore();
  }
  function speckle(g, x, y, w, h, n, seed, light, dark, r0 = 0.007, r1 = 0.018) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = hsh(i, 9, seed) < 0.5 ? light : dark;
      dot(g, x + hsh(i, 1, seed) * w, y + hsh(i, 2, seed) * h, r0 + hsh(i, 3, seed) * (r1 - r0)); g.fill();
    }
  }
  function crack(g, x, y, len, ang, seed, col) {
    const pts = [[x, y]]; let a = ang, px = x, py = y;
    for (let i = 0; i < 4; i++) { a += (hsh(i, 5, seed) - 0.5) * 1.3; px += Math.cos(a) * len / 4; py += Math.sin(a) * len / 4; pts.push([px, py]); }
    const line = (dx, dy) => { g.beginPath(); g.moveTo(pts[0][0] + dx, pts[0][1] + dy); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 0.013; line(0.008, 0.011); g.stroke();
    g.strokeStyle = alpha(col, 0.75); g.lineWidth = 0.017; line(0, 0); g.stroke();
  }
  // Moss clumps: dark underneath, lit on top-left.
  function moss(g, x, y, w, h, n, seed, m, r0 = 0.022, r1 = 0.05) {
    for (let i = 0; i < n; i++) {
      const bx = x + hsh(i, 11, seed) * w, by = y + hsh(i, 12, seed) * h, r = r0 + hsh(i, 13, seed) * (r1 - r0);
      g.fillStyle = m[1]; dot(g, bx, by + r * 0.2, r); g.fill();
      g.fillStyle = m[0]; dot(g, bx - r * 0.18, by - r * 0.12, r * 0.72); g.fill();
      g.fillStyle = 'rgba(235,255,180,0.35)'; dot(g, bx - r * 0.35, by - r * 0.35, r * 0.28); g.fill();
    }
  }
  function grad(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c)); return gr; }

  // ---------- block sprites (one tile, drawn in tile units) ----------
  function pillarSprite(s, m, seed) {
    const [c, g] = unit(s), L = 0.03, R = 0.97, B = 0.975, r = 0.15;
    rr(g, L, L, R - L, B - L, r); g.save(); g.clip();
    g.fillStyle = grad(g, 0, TOP, 0, B, [m.side[0], m.side[1]]); g.fillRect(0, TOP - 0.05, 1, 1);
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 0.014; g.beginPath();
    for (const fx of [0.28 + hsh(1, 1, seed) * 0.12, 0.62 + hsh(2, 1, seed) * 0.1]) { g.moveTo(fx, TOP + 0.04); g.lineTo(fx + 0.012, B); }
    g.stroke();
    speckle(g, L, TOP, R - L, B - TOP, 12, seed + 7, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.2)');
    if (hsh(seed, 3, 3) < m.mossRate) { const mx = 0.08 + hsh(seed, 3, 5) * 0.5; moss(g, mx, B - 0.07, 0.3, 0.05, 6, seed, m.moss, 0.025, 0.05); }
    rr(g, L, L, R - L, TOP - L + 0.01, r);
    const tg = g.createRadialGradient(0.3, 0.2, 0.02, 0.45, 0.38, 0.78);
    tg.addColorStop(0, shade(m.top[0], 0.22)); tg.addColorStop(0.45, m.top[0]); tg.addColorStop(1, m.top[1]);
    g.fillStyle = tg; g.fill();
    g.save(); g.clip();
    speckle(g, L, L, R - L, TOP, 30, seed, 'rgba(255,255,255,0.32)', 'rgba(60,64,62,0.22)');
    if (hsh(seed, 4, 4) < 0.8) crack(g, 0.16 + hsh(seed, 5, 1) * 0.4, 0.14 + hsh(seed, 6, 1) * 0.25, 0.22 + hsh(seed, 10, 1) * 0.3, hsh(seed, 7, 1) * 6.28, seed, m.crack);
    if (hsh(seed, 8, 2) < 0.4) crack(g, 0.62, 0.48, 0.2, -2.4, seed + 3, m.crack);
    if (hsh(seed, 9, 2) < m.mossRate * 0.6) moss(g, 0.05, 0.04, 0.24, 0.12, 4, seed + 1, m.moss, 0.02, 0.04);
    g.restore();
    rr(g, L + 0.022, L + 0.022, R - L - 0.044, TOP - L - 0.03, r * 0.8);
    g.strokeStyle = grad(g, 0.1, 0.05, 0.9, 0.65, ['rgba(255,255,255,0.8)', 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.22)']); g.lineWidth = 0.034; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(L + 0.07, TOP, R - L - 0.14, 0.014);
    g.fillStyle = grad(g, 0, B - 0.08, 0, B, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']); g.fillRect(0, B - 0.08, 1, 0.08);
    g.restore();
    g.strokeStyle = 'rgba(18,22,20,0.8)'; g.lineWidth = 0.03; rr(g, L, L, R - L, B - L, r); g.stroke();
    return c;
  }
  // Courses of bricks with bevelled edges and a little colour variation.
  function courses(g, x, y, w, h, rows, per, c0, c1, seed) {
    const rh = h / rows, bw = w / per, gap = 0.024;
    for (let r = 0; r < rows; r++) for (let k = -1; k <= per; k++) {
      const bx = x + (k + (r % 2 ? 0.5 : 0)) * bw, by = y + r * rh, v = (hsh(r, k, seed) - 0.5) * 0.14;
      if (bx + bw < x || bx > x + w) continue;
      g.fillStyle = grad(g, bx, by, bx + bw * 0.4, by + rh, [shade(c0, v + 0.05), shade(c1, v)]);
      rr(g, bx + gap / 2, by + gap / 2, bw - gap, rh - gap, 0.03); g.fill();
      g.fillStyle = 'rgba(255,236,205,0.4)'; rr(g, bx + gap, by + gap * 0.6, bw - gap * 2, 0.02, 0.01); g.fill();
      g.fillStyle = 'rgba(80,25,5,0.28)'; g.fillRect(bx + gap, by + rh - gap / 2 - 0.018, bw - gap * 2, 0.018);
      g.fillStyle = 'rgba(90,30,8,0.25)';
      for (let i = 0; i < 3; i++) { dot(g, bx + gap + hsh(i, r * 9 + k, seed + 5) * (bw - gap * 2), by + gap + hsh(i, r * 7 + k, seed + 6) * (rh - gap * 2), 0.008); g.fill(); }
    }
  }
  function brickSprite(s, m) {
    const [c, g] = unit(s), L = 0.035, R = 0.965, B = 0.97, r = 0.1;
    rr(g, L, L, R - L, B - L, r); g.fillStyle = m.shade; g.fill();
    g.save(); rr(g, L, L, R - L, B - L, r); g.clip();
    g.fillStyle = shade(m.mortar, -0.45); g.fillRect(0, TOP, 1, 1);
    courses(g, L, TOP + 0.005, R - L, B - TOP, 2, 3, m.side[0], m.side[1], 1);
    g.fillStyle = grad(g, 0, B - 0.07, 0, B, ['rgba(40,10,0,0)', 'rgba(40,10,0,0.35)']); g.fillRect(0, B - 0.07, 1, 0.07);
    rr(g, L, L, R - L, TOP - L, r); g.fillStyle = shade(m.mortar, -0.06); g.fill();
    g.save(); g.clip();
    courses(g, L, L, R - L, TOP - L, 3, 2, m.top[0], m.top[1], 2);
    const sh = g.createRadialGradient(0.22, 0.12, 0.02, 0.3, 0.2, 0.75); sh.addColorStop(0, 'rgba(255,240,200,0.4)'); sh.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = sh; g.fillRect(0, 0, 1, TOP);
    g.restore();
    g.fillStyle = 'rgba(255,225,190,0.55)'; g.fillRect(L + 0.05, TOP - 0.012, R - L - 0.1, 0.016);
    g.restore();
    g.strokeStyle = 'rgba(70,24,6,0.72)'; g.lineWidth = 0.03; rr(g, L, L, R - L, B - L, r); g.stroke();
    return c;
  }
  function rockSprite(s, m, seed) {
    const [c, g] = unit(s), pts = [];
    for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2, rj = 0.4 + hsh(i, 1, seed) * 0.06; pts.push([0.5 + Math.cos(a) * rj, Math.min(0.95, 0.55 + Math.sin(a) * rj * 0.95)]); }
    const blob = () => {
      g.beginPath();
      for (let i = 0; i <= pts.length; i++) { const p = pts[i % pts.length], q = pts[(i + 1) % pts.length], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; i ? g.quadraticCurveTo(p[0], p[1], mx, my) : g.moveTo(mx, my); }
      g.closePath();
    };
    blob(); g.fillStyle = m.side[1]; g.fill();
    g.save(); blob(); g.clip();
    g.fillStyle = grad(g, 0, 0.1, 0, 0.95, [m.top[0], m.top[1], m.side[0], m.side[1]]); g.fillRect(0, 0, 1, 1);
    const hl = g.createRadialGradient(0.36, 0.3, 0.02, 0.4, 0.35, 0.45); hl.addColorStop(0, 'rgba(255,255,255,0.5)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.fillRect(0, 0, 1, 1);
    g.fillStyle = grad(g, 0, 0.66, 0, 0.96, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']); g.fillRect(0, 0.66, 1, 0.34);
    speckle(g, 0.1, 0.12, 0.8, 0.8, 26, seed, 'rgba(255,255,255,0.28)', 'rgba(30,34,36,0.25)');
    crack(g, 0.55, 0.3, 0.3, 1.9, seed, '#3a4042');
    ell(g, 0.48, 0.2, 0.3, 0.11); g.fillStyle = m.moss[1]; g.fill();
    moss(g, 0.24, 0.12, 0.5, 0.12, 9, seed, m.moss, 0.03, 0.055);
    g.restore();
    blob(); g.strokeStyle = 'rgba(20,24,26,0.62)'; g.lineWidth = 0.028; g.stroke();
    return c;
  }
  function stumpSprite(s, m, seed) {
    const [c, g] = unit(s), cx = 0.5, top = 0.36, rx = 0.36, ry = 0.17, base = 0.84;
    g.fillStyle = m.bark[1];
    for (const [dx, w] of [[-0.36, 0.13], [0.34, 0.12], [0.02, 0.1]]) { ell(g, cx + dx, base + 0.04, w, 0.07, dx * 0.6); g.fill(); }
    g.beginPath(); g.moveTo(cx - rx, top); g.lineTo(cx - rx - 0.03, base); g.ellipse(cx, base, rx + 0.03, ry * 0.8, 0, Math.PI, 0, true); g.lineTo(cx + rx, top); g.closePath();
    g.fillStyle = grad(g, cx - rx, 0, cx + rx, 0, [m.bark[0], shade(m.bark[0], 0.12), m.bark[1], m.bark[2]]); g.fill();
    g.save(); g.clip();
    g.strokeStyle = alpha(m.bark[2], 0.6); g.lineWidth = 0.018; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) { const x = cx - rx + 0.06 + i * 0.1 + hsh(i, 2, seed) * 0.03; g.beginPath(); g.moveTo(x, top + 0.08); g.quadraticCurveTo(x + (hsh(i, 3, seed) - 0.5) * 0.06, top + 0.3, x - 0.01, base + 0.12); g.stroke(); }
    moss(g, cx - rx, base - 0.12, 0.3, 0.1, 6, seed, m.moss, 0.02, 0.045);
    g.restore();
    ell(g, cx, top, rx, ry); g.fillStyle = grad(g, cx - rx, top - ry, cx + rx, top + ry, [m.wood[0], m.wood[1]]); g.fill();
    g.lineWidth = 0.03; g.strokeStyle = m.bark[1]; g.stroke();
    g.strokeStyle = alpha(m.wood[2], 0.55); g.lineWidth = 0.012;
    for (const k of [0.74, 0.5, 0.27]) { ell(g, cx + 0.01, top + 0.005, rx * k, ry * k); g.stroke(); }
    g.fillStyle = m.wood[2]; dot(g, cx + 0.01, top + 0.005, 0.02); g.fill();
    g.strokeStyle = alpha(m.bark[2], 0.7); g.lineWidth = 0.014; g.beginPath(); g.moveTo(cx + 0.02, top); g.lineTo(cx + 0.2, top + 0.07); g.stroke();
    g.fillStyle = 'rgba(255,248,225,0.35)'; ell(g, cx - 0.12, top - 0.06, 0.12, 0.04, -0.2); g.fill();
    // a little mushroom growing on the side
    if (hsh(seed, 9, 9) < 0.7) {
      const mx = cx + rx - 0.04, my = base - 0.08;
      g.fillStyle = '#f4ead6'; g.fillRect(mx - 0.015, my - 0.05, 0.03, 0.06);
      g.fillStyle = '#e8473a'; ell(g, mx, my - 0.055, 0.06, 0.035); g.fill();
      g.fillStyle = '#fff'; dot(g, mx - 0.02, my - 0.065, 0.01); g.fill(); dot(g, mx + 0.02, my - 0.06, 0.008); g.fill();
    }
    g.strokeStyle = 'rgba(30,16,6,0.6)'; g.lineWidth = 0.026;
    g.beginPath(); g.moveTo(cx - rx, top); g.lineTo(cx - rx - 0.03, base); g.ellipse(cx, base, rx + 0.03, ry * 0.8, 0, Math.PI, 0, true); g.lineTo(cx + rx, top); g.stroke();
    return c;
  }
  // Grass turf tile: a slightly raised square of lawn sitting in darker grout.
  function turfSprite(s, f, base, seed) {
    const [c, g] = unit(s);
    g.fillStyle = f.grout; g.fillRect(0, 0, 1, 1);
    rr(g, 0.022, 0.022, 0.956, 0.956, 0.09);
    g.fillStyle = grad(g, 0, 0, 1, 1, [shade(base[0], 0.08), base[0], base[1]]); g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 7; i++) {
      g.fillStyle = hsh(i, 1, seed) < 0.5 ? 'rgba(255,255,200,0.07)' : 'rgba(0,40,0,0.08)';
      ell(g, hsh(i, 2, seed), hsh(i, 3, seed), 0.12 + hsh(i, 4, seed) * 0.2, 0.08 + hsh(i, 5, seed) * 0.14); g.fill();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 54; i++) {
      const x = hsh(i, 6, seed) * 1.04 - 0.02, y = hsh(i, 7, seed) * 1.04, len = 0.045 + hsh(i, 8, seed) * 0.06, lean = (hsh(i, 9, seed) - 0.5) * 0.07;
      g.strokeStyle = f.blades[i % f.blades.length]; g.lineWidth = 0.016 + hsh(i, 10, seed) * 0.008;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.2, y - len * 0.6, x + lean, y - len); g.stroke();
    }
    g.restore();
    g.lineWidth = 0.02; g.strokeStyle = 'rgba(255,255,210,0.22)'; g.beginPath(); g.moveTo(0.1, 0.035); g.lineTo(0.9, 0.035); g.moveTo(0.035, 0.1); g.lineTo(0.035, 0.9); g.stroke();
    g.strokeStyle = 'rgba(10,40,0,0.22)'; g.beginPath(); g.moveTo(0.1, 0.965); g.lineTo(0.9, 0.965); g.moveTo(0.965, 0.1); g.lineTo(0.965, 0.9); g.stroke();
    return c;
  }
  // Plaza paving: irregular flagstones (one big slab and two small ones per tile, layout varies) with grass in the joints.
  const FLAGS = [[[0, 0, 0.62, 0.62], [0.62, 0, 0.38, 1], [0, 0.62, 0.62, 0.38]], [[0, 0, 1, 0.45], [0, 0.45, 0.4, 0.55], [0.4, 0.45, 0.6, 0.55]], [[0, 0, 0.45, 1], [0.45, 0, 0.55, 0.55], [0.45, 0.55, 0.55, 0.45]]];
  function pavingSprite(s, f, seed) {
    const [c, g] = unit(s), p = f.paving;
    g.fillStyle = f.grout; g.fillRect(0, 0, 1, 1);
    g.strokeStyle = f.blades[1]; g.lineWidth = 0.016; g.lineCap = 'round';
    for (let i = 0; i < 16; i++) { const x = hsh(i, 1, seed), y = hsh(i, 2, seed); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.01, y - 0.04); g.stroke(); }
    FLAGS[seed % FLAGS.length].forEach(([fx, fy, fw, fh], k) => {
      const gap = 0.045, x = fx + gap / 2, y = fy + gap / 2, w = fw - gap, h = fh - gap, v = (hsh(k, 6, seed) - 0.5) * 0.14, r = Math.min(w, h) * 0.2;
      rr(g, x, y, w, h, r); g.fillStyle = grad(g, x, y, x + w, y + h, [shade(p[0], v + 0.08), shade(p[0], v), shade(p[1], v)]); g.fill();
      g.save(); g.clip(); speckle(g, x, y, w, h, 14, seed * 7 + k, 'rgba(255,255,255,0.3)', 'rgba(60,50,30,0.2)');
      if (hsh(k, 8, seed) < 0.3) crack(g, x + w * 0.3, y + h * 0.4, Math.min(w, h) * 0.5, 0.5, seed + k, p[2]);
      g.restore();
      g.strokeStyle = 'rgba(255,255,240,0.5)'; g.lineWidth = 0.016; g.beginPath(); g.moveTo(x + r, y + 0.012); g.lineTo(x + w - r, y + 0.012); g.moveTo(x + 0.012, y + r); g.lineTo(x + 0.012, y + h - r); g.stroke();
      g.strokeStyle = alpha(p[2], 0.55); g.beginPath(); g.moveTo(x + r, y + h - 0.012); g.lineTo(x + w - r, y + h - 0.012); g.stroke();
    });
    return c;
  }
  // The plaza's centrepiece: a ring of dressed stone with a flower bed, framed by a worn border.
  function paintPlaza(g, v) {
    const { T, FX, FY, cols, plan } = v, f = world.floor, p = f.paving;
    let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
    plan.decals.forEach((d, j) => { if (d !== 'paving') return; const x = j % cols, y = (j / cols) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    if (x1 < 0) return;
    const cx = FX + (x0 + x1 + 1) / 2 * T, cy = FY + (y0 + y1 + 1) / 2 * T, R = Math.min(x1 - x0 + 1, y1 - y0 + 1) * T * 0.36;
    g.save();
    g.strokeStyle = alpha(p[2], 0.5); g.lineWidth = T * 0.06; rr(g, FX + x0 * T + T * 0.06, FY + y0 * T + T * 0.06, (x1 - x0 + 1) * T - T * 0.12, (y1 - y0 + 1) * T - T * 0.12, T * 0.3); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.25)'; dot(g, cx + T * 0.06, cy + T * 0.08, R + T * 0.2); g.fill();
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2 + 0.03, a1 = (i + 1) / n * Math.PI * 2 - 0.03, vv = (hsh(i, 3, 7) - 0.5) * 0.12;
      g.beginPath(); g.arc(cx, cy, R + T * 0.18, a0, a1); g.arc(cx, cy, R - T * 0.08, a1, a0, true); g.closePath();
      g.fillStyle = grad(g, cx - R, cy - R, cx + R, cy + R, [shade(p[0], vv + 0.15), shade(p[1], vv)]); g.fill();
      g.strokeStyle = 'rgba(255,255,240,0.35)'; g.lineWidth = T * 0.012; g.stroke();
    }
    g.fillStyle = grad(g, cx, cy - R, cx, cy + R, [world.floor.turf[0][0], world.floor.turf[1][1]]); dot(g, cx, cy, R - T * 0.1); g.fill();
    g.translate(cx, cy); g.scale(T, T);
    const rr2 = (R - T * 0.1) / T;
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; daisy(g, Math.cos(a) * rr2 * 0.72, Math.sin(a) * rr2 * 0.72, 0.06, f.flowers[i % f.flowers.length]); }
    g.save(); dot(g, 0, 0, rr2); g.clip();
    g.lineCap = 'round';
    for (let i = 0; i < 260 * rr2 * rr2; i++) {
      const x = (hsh(i, 1, 99) * 2 - 1) * rr2, y = (hsh(i, 2, 99) * 2 - 1) * rr2, len = 0.05 + hsh(i, 3, 99) * 0.06;
      g.strokeStyle = f.blades[i % f.blades.length]; g.lineWidth = 0.018; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x, y - len * 0.6, x + (hsh(i, 4, 99) - 0.5) * 0.06, y - len); g.stroke();
    }
    const rim = g.createRadialGradient(0, 0, rr2 * 0.75, 0, 0, rr2); rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(10,30,0,0.35)');
    g.fillStyle = rim; g.fillRect(-rr2, -rr2, rr2 * 2, rr2 * 2);
    g.restore();
    moss(g, -rr2 * 0.4, -rr2 * 0.4, rr2 * 0.8, rr2 * 0.8, 10, 5, f.clover, 0.04, 0.08);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - 1.57; daisy(g, Math.cos(a) * rr2 * 0.3, Math.sin(a) * rr2 * 0.3, 0.07, f.flowers[(i + 1) % f.flowers.length]); }
    g.restore();
  }
  // Destructible block with its cast shadow baked in (1.4 tiles square): one blit per block per frame.
  // Blocks are drawn row by row, so a neighbour drawn later covers the shadow exactly where it should.
  function litBrick(s, brick, sh) {
    const [c, g] = unit(s, 1.4);
    softShadow(g, gg => rr(gg, sh.dx + 0.03, sh.dy + 0.03, 0.94, 0.9, 0.16), sh.color, sh.blur * s, s);
    g.drawImage(brick, 0, 0, 1, 1);
    return c;
  }

  // Build (or reuse) every sprite for a world at s device px per tile.
  function prepare(w, s) {
    world = w;
    if (key === w.id + ':' + s) return;
    key = w.id + ':' + s;
    const f = w.floor;
    spr.turf = [0, 1].map(k => [0, 1, 2].map(v => turfSprite(s, f, f.turf[k], 11 + k * 7 + v * 31)));
    spr.paving = [0, 1, 2, 3, 4, 5].map(v => pavingSprite(s, f, v));
    spr.pillar = [0, 1, 2, 3, 4].map(v => pillarSprite(s, w.pillar, 3 + v * 17));
    spr.rock = [0, 1].map(v => rockSprite(s, w.obstacle.rock, 7 + v * 19));
    spr.stump = [0, 1].map(v => stumpSprite(s, w.obstacle.stump, 2 + v * 23));
    spr.brick = brickSprite(s, w.brick);
    spr.burn = canvas(s, s); const b = spr.burn.getContext('2d'); b.drawImage(spr.brick, 0, 0);
    b.globalCompositeOperation = 'source-atop'; b.fillStyle = 'rgba(255,110,30,0.65)'; b.fillRect(0, 0, s, s);
    spr.lit = litBrick(s, spr.brick, w.light.shadow);
  }
  function hardSprite(skin, x, y) {
    const v = hsh(x, y, 5);
    if (skin === 'rock') return spr.rock[v < 0.5 ? 0 : 1];
    if (skin === 'stump') return spr.stump[v < 0.5 ? 0 : 1];
    return spr.pillar[Math.floor(v * spr.pillar.length)];
  }

  // ---------- scenery outside the arena ----------
  function tree(g, sd, o) {
    const R = 0.55 + sd * 0.32, cy = -0.5 - R * 0.75;
    g.fillStyle = 'rgba(0,0,0,0.34)'; ell(g, 0.32, 0.05, R * 1.05, R * 0.36); g.fill();
    g.fillStyle = grad(g, -0.1, 0, 0.1, 0, [o.trunk[0], o.trunk[1]]);
    g.beginPath(); g.moveTo(-0.13, 0.03); g.quadraticCurveTo(-0.06, -0.2, -0.07, -0.55); g.lineTo(0.07, -0.55); g.quadraticCurveTo(0.06, -0.2, 0.13, 0.03); g.closePath(); g.fill();
    const layer = (n, rad, spread, dx, dy, col, sd2) => {
      g.fillStyle = col;
      const k = Math.floor(sd * 1000);
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + hsh(i, sd2, k); dot(g, dx + Math.cos(a) * spread * R, cy + dy + Math.sin(a) * spread * R * 0.85, R * rad * (0.85 + hsh(i, sd2, k + 1) * 0.3)); g.fill(); }
    };
    layer(8, 0.5, 0.58, 0.06, 0.08, o.leaf[3], 1);
    dot(g, 0.04, cy + 0.04, R * 0.78); g.fill();
    layer(7, 0.42, 0.46, -0.03, -0.03, o.leaf[2], 2);
    layer(5, 0.31, 0.38, -0.12, -0.13, o.leaf[1], 3);
    layer(4, 0.15, 0.36, -0.2, -0.24, o.leaf[0], 4);
    g.fillStyle = 'rgba(255,255,210,0.3)';
    for (let i = 0; i < 6; i++) { dot(g, -0.25 * R + hsh(i, 7, sd * 99) * R * 0.5, cy - R * 0.45 + hsh(i, 8, sd * 99) * R * 0.4, R * 0.05); g.fill(); }
  }
  function bush(g, sd, o) {
    const R = 0.3 + sd * 0.15, cy = -R * 0.55;
    g.fillStyle = 'rgba(0,0,0,0.3)'; ell(g, 0.12, 0.04, R * 1.1, R * 0.35); g.fill();
    g.fillStyle = o.leaf[3]; for (const [dx, dy, k] of [[-0.5, 0.1, 0.62], [0.5, 0.12, 0.6], [0, 0, 0.8]]) { dot(g, dx * R, cy + dy * R, R * k); g.fill(); }
    g.fillStyle = o.leaf[2]; for (const [dx, dy, k] of [[-0.45, -0.02, 0.5], [0.35, 0, 0.5], [-0.05, -0.2, 0.62]]) { dot(g, dx * R, cy + dy * R, R * k); g.fill(); }
    g.fillStyle = o.leaf[1]; for (const [dx, dy, k] of [[-0.35, -0.2, 0.3], [0, -0.38, 0.36]]) { dot(g, dx * R, cy + dy * R, R * k); g.fill(); }
    g.fillStyle = o.leaf[0]; dot(g, -0.2 * R, cy - 0.5 * R, R * 0.15); g.fill();
    if (sd > 0.6) { g.fillStyle = '#ff6a8a'; for (let i = 0; i < 4; i++) { dot(g, (hsh(i, 1, sd * 50) - 0.5) * R * 1.4, cy + (hsh(i, 2, sd * 50) - 0.6) * R, R * 0.07); g.fill(); } }
  }
  function boulder(g, sd, w) {
    const m = w.obstacle.rock, r = 0.22 + sd * 0.16;
    g.fillStyle = 'rgba(0,0,0,0.3)'; ell(g, 0.1, 0.03, r * 1.2, r * 0.4); g.fill();
    ell(g, 0, -r * 0.55, r, r * 0.7); g.fillStyle = grad(g, 0, -r * 1.2, 0, 0, [m.top[0], m.side[1]]); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; ell(g, -r * 0.35, -r * 0.85, r * 0.3, r * 0.15, -0.3); g.fill();
    moss(g, -r * 0.6, -r * 1.15, r * 1.1, r * 0.3, 5, sd * 31, m.moss, 0.03, 0.06);
  }
  function flowers(g, sd, w) {
    const f = w.floor;
    for (let i = 0; i < 6; i++) {
      const x = (hsh(i, 1, sd * 70) - 0.5) * 0.6, y = (hsh(i, 2, sd * 70) - 0.5) * 0.35, c = f.flowers[(i + Math.floor(sd * 9)) % f.flowers.length];
      g.strokeStyle = w.outside.leaf[2]; g.lineWidth = 0.02; g.beginPath(); g.moveTo(x, y + 0.08); g.lineTo(x, y); g.stroke();
      daisy(g, x, y, 0.045, c);
    }
  }
  function mushroom(g, sd) {
    const k = 0.7 + sd * 0.5;
    g.fillStyle = 'rgba(0,0,0,0.28)'; ell(g, 0.05, 0.02, 0.16 * k, 0.05 * k); g.fill();
    g.fillStyle = '#f2e8d2'; rr(g, -0.04 * k, -0.18 * k, 0.08 * k, 0.19 * k, 0.03 * k); g.fill();
    ell(g, 0, -0.2 * k, 0.16 * k, 0.1 * k); g.fillStyle = grad(g, 0, -0.3 * k, 0, -0.12 * k, ['#ff6a50', '#b8241c']); g.fill();
    g.fillStyle = '#fff6ea'; for (const [x, y, r] of [[-0.07, -0.24, 0.025], [0.05, -0.25, 0.02], [0.09, -0.18, 0.016]]) { dot(g, x * k, y * k, r * k); g.fill(); }
  }
  function barrel(g, o) {
    const b = o.barrel;
    g.fillStyle = 'rgba(0,0,0,0.32)'; ell(g, 0.1, 0.03, 0.3, 0.09); g.fill();
    g.beginPath(); g.moveTo(-0.2, -0.52); g.quadraticCurveTo(-0.26, -0.26, -0.2, 0); g.lineTo(0.2, 0); g.quadraticCurveTo(0.26, -0.26, 0.2, -0.52); g.closePath();
    g.fillStyle = grad(g, -0.24, 0, 0.24, 0, [shade(b[0], 0.15), b[0], b[1]]); g.fill();
    g.strokeStyle = alpha(b[1], 0.8); g.lineWidth = 0.012; for (const x of [-0.1, 0, 0.1]) { g.beginPath(); g.moveTo(x, -0.5); g.lineTo(x, -0.02); g.stroke(); }
    g.strokeStyle = b[2]; g.lineWidth = 0.035; for (const y of [-0.42, -0.1]) { g.beginPath(); g.moveTo(-0.23, y); g.quadraticCurveTo(0, y + 0.03, 0.23, y); g.stroke(); }
    ell(g, 0, -0.52, 0.2, 0.06); g.fillStyle = shade(b[0], -0.15); g.fill(); g.strokeStyle = b[2]; g.lineWidth = 0.025; g.stroke();
  }
  function lantern(g, o) {
    const l = o.lantern;
    g.fillStyle = 'rgba(0,0,0,0.32)'; ell(g, 0.16, 0.03, 0.24, 0.07); g.fill();
    g.fillStyle = '#5d5b52'; rr(g, -0.13, -0.13, 0.26, 0.15, 0.04); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-0.1, -0.12, 0.2, 0.03);
    g.fillStyle = grad(g, -0.04, 0, 0.04, 0, ['#55545c', l.metal]); g.fillRect(-0.035, -1.12, 0.07, 1.0);
    g.fillStyle = l.metal; rr(g, -0.15, -1.16, 0.3, 0.05, 0.02); g.fill();
    const lg = g.createRadialGradient(0, -1.3, 0.01, 0, -1.3, 0.16); lg.addColorStop(0, '#fffbe6'); lg.addColorStop(0.5, l.light); lg.addColorStop(1, l.glow);
    g.fillStyle = lg; rr(g, -0.11, -1.4, 0.22, 0.24, 0.03); g.fill();
    g.strokeStyle = l.metal; g.lineWidth = 0.025; g.beginPath(); for (const x of [-0.11, 0, 0.11]) { g.moveTo(x, -1.4); g.lineTo(x, -1.16); } g.stroke();
    g.fillStyle = l.metal; g.beginPath(); g.moveTo(-0.17, -1.39); g.lineTo(0, -1.54); g.lineTo(0.17, -1.39); g.closePath(); g.fill();
    dot(g, 0, -1.56, 0.03); g.fill();
  }
  function daisy(g, x, y, r, c) {
    g.fillStyle = c[0];
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ell(g, x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.55, r * 0.34, a); g.fill(); }
    g.fillStyle = c[1]; dot(g, x, y, r * 0.38); g.fill();
  }

  function paintOutside(g, v) {
    const { T, FX, FY, BW, BH, cols, rows } = v, o = world.outside;
    const x0 = FX, y0 = FY, x1 = FX + cols * T, y1 = FY + rows * T, pw = T * 0.72;
    const gr = g.createRadialGradient((x0 + x1) / 2, (y0 + y1) / 2, T * 2, (x0 + x1) / 2, (y0 + y1) / 2, Math.max(BW, BH) * 0.8);
    gr.addColorStop(0, o.ground[0]); gr.addColorStop(1, o.ground[1]); g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
    const outsideBy = (px, py, m) => px < x0 - m || px > x1 + m || py < y0 - m || py > y1 + m;
    // ground texture on a lattice anchored to the board, so it never shifts between rebuilds
    const st = T * 0.5, gx0 = Math.floor(-FX / st) - 1, gy0 = Math.floor(-FY / st) - 1;
    g.lineCap = 'round';
    for (let gy = gy0; FY + gy * st < BH + st; gy++) for (let gx = gx0; FX + gx * st < BW + st; gx++) {
      const px = FX + (gx + hsh(gx, gy, 1)) * st, py = FY + (gy + hsh(gx, gy, 2)) * st;
      if (!outsideBy(px, py, pw * 0.8)) continue;
      const r = hsh(gx, gy, 3);
      if (r < 0.22) { g.fillStyle = o.dirt; ell(g, px, py, st * (0.4 + r), st * 0.25); g.fill(); }
      else if (r < 0.9) {
        g.strokeStyle = o.tuft[Math.floor(hsh(gx, gy, 4) * o.tuft.length)]; g.lineWidth = Math.max(1, T * 0.035);
        for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(px + k * T * 0.04, py); g.lineTo(px + k * T * 0.07, py - T * (0.08 + hsh(gx + k, gy, 5) * 0.06)); g.stroke(); }
      } else { g.fillStyle = 'rgba(160,160,140,0.45)'; dot(g, px, py, T * 0.04); g.fill(); }
    }
    // cobblestone path hugging the arena
    g.save();
    rr(g, x0 - pw, y0 - pw, x1 - x0 + pw * 2, y1 - y0 + pw * 2, pw * 0.9); g.fillStyle = o.path[2]; g.fill(); g.clip();
    const ps = T * 0.36;
    for (let py = y0 - pw; py < y1 + pw; py += ps) for (let px = x0 - pw - (Math.round((py - y0) / ps) & 1) * ps * 0.5; px < x1 + pw; px += ps) {
      if (!outsideBy(px + ps / 2, py + ps / 2, -ps * 0.3)) continue;
      const i = Math.round((px - x0) / ps), j = Math.round((py - y0) / ps), h = hsh(i, j, 8);
      if (h < 0.05) continue;
      const sx = px + ps * 0.06 + h * ps * 0.06, sy = py + ps * 0.06, sw = ps * (0.84 - h * 0.08), sh = ps * 0.84, v = (hsh(i, j, 9) - 0.5) * 0.18;
      rr(g, sx, sy, sw, sh, ps * 0.22); g.fillStyle = grad(g, sx, sy, sx + sw, sy + sh, [shade(o.path[0], v + 0.08), shade(o.path[1], v)]); g.fill();
      g.fillStyle = 'rgba(255,255,240,0.22)'; g.fillRect(sx + sw * 0.2, sy + ps * 0.05, sw * 0.6, Math.max(1, ps * 0.07));
      if (hsh(i, j, 10) < 0.18) { g.save(); g.translate(sx, sy); g.scale(T, T); moss(g, 0, 0, sw / T, sh / T * 0.6, 2, i * 31 + j, world.wall.moss, 0.02, 0.035); g.restore(); }
    }
    g.restore();
    // props on a coarser lattice, kept off the path; drawn back to front
    const props = [], st2 = T * 1.15, hx0 = Math.floor(-FX / st2) - 2, hy0 = Math.floor(-FY / st2) - 2;
    for (let gy = hy0; FY + gy * st2 < BH + st2 * 2; gy++) for (let gx = hx0; FX + gx * st2 < BW + st2; gx++) {
      if (hsh(gx, gy, 21) < 0.28) continue;
      const kind = pickBy(o.props, hsh(gx, gy, 22)), px = FX + (gx + 0.2 + hsh(gx, gy, 23) * 0.6) * st2, py = FY + (gy + 0.2 + hsh(gx, gy, 24) * 0.6) * st2;
      const [hw, up] = EXTENT[kind];
      if (!(px + hw * T < x0 - pw || px - hw * T > x1 + pw || py + T * 0.1 < y0 - pw || py - up * T > y1 + pw)) continue;
      props.push({ kind, px, py, sd: hsh(gx, gy, 25) });
    }
    // lanterns stand on the path, framing the arena
    lamps = [];
    for (const [lx, ly] of [[-0.42, 2.6], [-0.42, rows - 3.2], [cols + 0.42, 2.6], [cols + 0.42, rows - 3.2], [-0.45, -0.25], [cols + 0.45, -0.25]]) {
      props.push({ kind: 'lantern', px: FX + lx * T, py: FY + ly * T, sd: 0 });
      lamps.push({ x: lx, y: ly - 1.28, s: lx * 3 + ly });
    }
    props.sort((a, b) => a.py - b.py);
    g.save(); g.beginPath(); g.rect(0, 0, BW, BH); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip('evenodd');
    for (const p of props) {
      if (p.px < -T * 2 || p.px > BW + T * 2 || p.py < -T || p.py > BH + T * 2.5) continue;
      g.save(); g.translate(p.px, p.py); g.scale(T, T);
      if (p.kind === 'tree') tree(g, p.sd, o);
      else if (p.kind === 'bush') bush(g, p.sd, o);
      else if (p.kind === 'rock') boulder(g, p.sd, world);
      else if (p.kind === 'flowers') flowers(g, p.sd, world);
      else if (p.kind === 'mushroom') mushroom(g, p.sd);
      else if (p.kind === 'barrel') barrel(g, o);
      else if (p.kind === 'lantern') lantern(g, o);
      g.restore();
    }
    g.restore();
  }
  // half-width and height above the base of each prop, in tiles (keeps props off the path)
  const EXTENT = { tree: [0.95, 2.25], bush: [0.5, 0.75], rock: [0.45, 0.55], flowers: [0.35, 0.25], mushroom: [0.25, 0.45], barrel: [0.32, 0.62] };
  // weighted pick driven by a fixed number in [0,1) (scenery must be deterministic)
  function pickBy(list, r) { let s = 0; for (const [, w] of list) s += w; r *= s; for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[0][0]; }

  // ---------- the arena ----------
  function paintFloor(g, v) {
    const { T, FX, FY, cols, rows, grid, plan, HARD } = v, f = world.floor;
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const j = y * cols + x, px = FX + x * T, py = FY + y * T, paved = plan && plan.decals[j] === 'paving';
      const sp = paved ? spr.paving[Math.floor(hsh(x, y, 2) * spr.paving.length)] : spr.turf[(x + y) & 1][Math.floor(hsh(x, y, 1) * 3)];
      g.drawImage(sp, px, py, T, T);
      if (paved || (grid[j] === HARD && (!plan || !plan.skins[j] || plan.skins[j] === 'pillar'))) continue;
      g.save(); g.translate(px, py); g.scale(T, T);
      if (hsh(x, y, 3) < f.cloverRate) {
        const cx = 0.2 + hsh(x, y, 4) * 0.6, cy = 0.25 + hsh(x, y, 5) * 0.55, n = 2 + Math.floor(hsh(x, y, 6) * 3);
        for (let i = 0; i < n; i++) {
          const ox = cx + (hsh(i, x, y) - 0.5) * 0.22, oy = cy + (hsh(y, i, x) - 0.5) * 0.16, r = 0.03 + hsh(i, y, x) * 0.012;
          for (let k = 0; k < 3; k++) { const a = k * 2.1 + i; g.fillStyle = f.clover[k === 2 ? 1 : 0]; dot(g, ox + Math.cos(a) * r, oy + Math.sin(a) * r * 0.8, r); g.fill(); }
          g.fillStyle = f.clover[2]; dot(g, ox - r * 0.3, oy - r * 0.4, r * 0.45); g.fill();
        }
      }
      if (hsh(x, y, 7) < f.flowerRate) {
        const n = 1 + Math.floor(hsh(x, y, 8) * 3), c = f.flowers[Math.floor(hsh(x, y, 9) * f.flowers.length)];
        for (let i = 0; i < n; i++) daisy(g, 0.2 + hsh(i, x, y + 3) * 0.6, 0.2 + hsh(x + 5, i, y) * 0.6, 0.045 + hsh(i, i, x + y) * 0.015, c);
      }
      g.restore();
    }
    if (plan) paintPlaza(g, v);
  }
  function paintWalls(g, v) {
    const { T, FX, FY, cols, rows } = v, m = world.wall, F = TOP - 0.01;
    const isWall = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && (x === 0 || y === 0 || x === cols - 1 || y === rows - 1);
    g.save(); rr(g, FX, FY, cols * T, rows * T, T * 0.3); g.clip();
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!isWall(x, y)) continue;
      const front = !isWall(x, y + 1), th = front ? F : 1, vertical = (x === 0 || x === cols - 1) && !front, sp = 0.4 + hsh(x, y, 31) * 0.2;
      g.save(); g.translate(FX + x * T, FY + y * T); g.scale(T, T);
      g.fillStyle = m.seam; g.fillRect(0, 0, 1.002, th + 0.002);
      const stones = vertical ? [[0, 0, 1, sp], [0, sp, 1, 1 - sp]] : [[0, 0, sp, th], [sp, 0, 1 - sp, th]];
      stones.forEach(([sx, sy, sw, sh], i) => {
        const gap = 0.034, bx = sx + gap / 2, by = sy + gap / 2, bw = sw - gap, bh = sh - gap, sd = hsh(x * 3 + i, y, 17), vv = (sd - 0.5) * 0.16, r = Math.min(bw, bh) * 0.24;
        rr(g, bx, by, bw, bh, r); g.fillStyle = grad(g, bx, by, bx + bw, by + bh, [shade(m.top[0], vv + 0.1), shade(m.top[0], vv), shade(m.top[1], vv)]); g.fill();
        g.save(); g.clip();
        speckle(g, bx, by, bw, bh, 9, sd * 1e3, 'rgba(255,255,255,0.3)', 'rgba(40,46,40,0.22)');
        if (sd < 0.3) crack(g, bx + bw * 0.3, by + bh * 0.3, Math.min(bw, bh) * 0.6, 0.7, sd * 1e3, m.seam);
        g.restore();
        g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(bx + r, by + 0.012); g.lineTo(bx + bw - r, by + 0.012); g.moveTo(bx + 0.012, by + r); g.lineTo(bx + 0.012, by + bh - r); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(bx + r, by + bh - 0.012); g.lineTo(bx + bw - r, by + bh - 0.012); g.stroke();
      });
      if (hsh(x, y, 41) < 0.45) { const mx = 0.05 + hsh(x, y, 46) * 0.6, my = front ? th - 0.2 : 0.1 + hsh(x, y, 47) * 0.6; moss(g, mx, my, 0.3, 0.16, 5 + Math.floor(hsh(x, y, 42) * 4), x * 13 + y, m.moss, 0.03, 0.06); }
      if (front) {
        g.fillStyle = grad(g, 0, th, 0, 1, [m.side[0], m.side[1]]); g.fillRect(0, th, 1.002, 1 - th);
        g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 0.016; g.beginPath(); g.moveTo(sp, th); g.lineTo(sp, 1); g.moveTo(0, th + (1 - th) * 0.5); g.lineTo(1, th + (1 - th) * 0.5); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(0, th, 1.002, 0.012);
        if (hsh(x, y, 48) < 0.5) moss(g, hsh(x, y, 49) * 0.7, th - 0.01, 0.25, 0.03, 4, x * 7 + y * 3, m.moss, 0.022, 0.04);
        g.fillStyle = grad(g, 0, 1 - 0.06, 0, 1, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)']); g.fillRect(0, 0.94, 1.002, 0.06);
        if (hsh(x, y, 43) < 0.45) vine(g, 0.2 + hsh(x, y, 44) * 0.6, th, (y === 0 ? 0.52 : 0.4) + hsh(x, y, 45) * 0.25, x * 17 + y, m.vine);
      }
      g.restore();
    }
    g.restore();
  }
  function vine(g, x, y, len, seed, c) {
    const sway = (hsh(seed, 1, 1) - 0.5) * 0.16;
    g.strokeStyle = c[0]; g.lineWidth = 0.022; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y - 0.04); g.bezierCurveTo(x + sway, y + len * 0.3, x - sway, y + len * 0.6, x + sway * 0.5, y + len); g.stroke();
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.6) / 6.2, lx = x + Math.sin(t * 3 + seed) * sway * 0.6, ly = y + len * t, side = i % 2 ? 1 : -1;
      g.fillStyle = c[i % 3 === 0 ? 2 : 1]; ell(g, lx + side * 0.035, ly, 0.032, 0.02, side * 0.6); g.fill();
    }
  }
  // Light pass: shade the surroundings, warm sun from the top-left, cool shade bottom-right, light rays, lantern pools.
  function paintLight(g, v) {
    const { T, FX, FY, BW, BH, cols, rows } = v, L = world.light;
    const x0 = FX, y0 = FY, x1 = FX + cols * T, y1 = FY + rows * T;
    g.save();
    g.beginPath(); g.rect(0, 0, BW, BH); rr(g, x0 - T * 0.72, y0 - T * 0.72, x1 - x0 + T * 1.44, y1 - y0 + T * 1.44, T * 0.65); g.fillStyle = L.outsideDim; g.fill('evenodd');
    g.globalCompositeOperation = 'soft-light';
    let gr = g.createRadialGradient(x0 + T * 2, y0 + T * 1.5, T, x0 + T * 2, y0 + T * 1.5, T * 15);
    gr.addColorStop(0, L.sun); gr.addColorStop(1, 'rgba(255,198,112,0)'); g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
    g.globalCompositeOperation = 'multiply';
    gr = g.createRadialGradient(x1, y1, T, x1, y1, T * 11); gr.addColorStop(0, L.shade); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
    g.globalCompositeOperation = 'screen';
    for (const [a, w] of [[0.15, 1.6], [0.42, 1.0], [0.7, 2.2]]) {
      const sx = x0 + (x1 - x0) * a - T * 4, run = (y1 - y0) * 0.75 + T * 2;
      g.save(); g.translate(sx, y0 - T * 2); g.transform(1, 0, run / (y1 - y0 + T * 3), 1, 0, 0);
      const rg = g.createLinearGradient(-w * T, 0, w * T * 2, 0); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.5, L.rays); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(-w * T, 0, w * T * 3, y1 - y0 + T * 3); g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rad = Math.hypot(x1 - x0, y1 - y0) / 2;
    gr = g.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad * 1.35); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, L.vignette);
    g.fillStyle = gr; g.fillRect(0, 0, BW, BH);
    g.globalCompositeOperation = 'lighter';
    for (const l of lamps) {
      const lx = FX + l.x * T, ly = FY + l.y * T;
      gr = g.createRadialGradient(lx, ly, 0, lx, ly + T * 0.6, T * 2.2); gr.addColorStop(0, alpha(world.outside.lantern.glow, 0.3)); gr.addColorStop(1, alpha(world.outside.lantern.glow, 0));
      g.fillStyle = gr; g.fillRect(lx - T * 2.5, ly - T * 2, T * 5, T * 5);
    }
    g.restore();
  }
  function shadowPath(v, filter) {
    const { T, FX, FY, cols, rows, grid, HARD } = v, sh = world.light.shadow;
    return g => {
      g.beginPath();
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const j = y * cols + x; if (grid[j] !== HARD || !filter(x, y)) continue;
        const wall = x === 0 || y === 0 || x === cols - 1 || y === rows - 1, px = FX + (x + sh.dx) * T, py = FY + (y + sh.dy) * T;
        if (wall) g.rect(px, py, T, T); else rrSub(g, px + T * 0.03, py + T * 0.03, T * 0.94, T * 0.9, T * 0.18);
      }
    };
  }
  function drawHardCell(g, v, x, y) {
    const j = y * v.cols + x, skin = v.plan && v.plan.skins[j];
    g.drawImage(hardSprite(skin, x, y), v.FX + x * v.T, v.FY + y * v.T, v.T, v.T);
  }

  // Bake the whole static scene into the background canvas (g is set to CSS-pixel units).
  function paintBackground(g, v) {
    const { T, FX, FY, cols, rows, grid, HARD, DPR } = v, sh = world.light.shadow;
    paintOutside(g, v);
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = T * 0.5 * DPR; g.shadowOffsetY = T * 0.18 * DPR;
    rr(g, FX, FY, cols * T, rows * T, T * 0.3); g.fillStyle = world.floor.grout; g.fill(); g.restore();
    paintFloor(g, v);
    g.save(); rr(g, FX - T, FY - T, (cols + 2) * T, (rows + 2) * T, T); g.clip();
    softShadow(g, shadowPath(v, () => true), sh.color, sh.blur * T * DPR, DPR);
    g.restore();
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) if (grid[y * cols + x] === HARD) drawHardCell(g, v, x, y);
    paintWalls(g, v);
    paintLight(g, v);
  }
  // A block that appears mid-round (sudden death) is painted straight into the baked background.
  function paintHard(g, v, x, y) {
    const sh = world.light.shadow;
    softShadow(g, shadowPath(v, (cx, cy) => cx === x && cy === y), sh.color, sh.blur * v.T * v.DPR, v.DPR);
    drawHardCell(g, v, x, y);
  }
  // Destructible blocks change every frame, so they are blitted from cached sprites.
  function drawSoft(ctx, v) {
    const { T, FX, FY, cols, rows, grid, SOFT } = v, n = cols * rows;
    for (let j = cols; j < n - cols; j++) if (grid[j] === SOFT) ctx.drawImage(spr.lit, FX + (j % cols) * T, FY + ((j / cols) | 0) * T, T * 1.4, T * 1.4);
  }
  // Living light: lantern flicker and drifting motes, emitted through the game's additive glow pass.
  function ambient(v, t, emit) {
    const { T, FX, FY, cols, rows } = v, M = world.light.motes, lc = world.outside.lantern.glow;
    for (const l of lamps) emit(FX + l.x * T, FY + l.y * T, T * (1.05 + 0.07 * Math.sin(t * 7 + l.s)), lc, 0.5 + 0.1 * Math.sin(t * 11 + l.s * 3) + 0.07 * Math.sin(t * 29 + l.s));
    for (let i = 0; i < M.count; i++) {
      const sp = 0.15 + hsh(i, 3, 77) * 0.25;
      const x = 1 + hsh(i, 1, 77) * (cols - 2) + Math.sin(t * sp + i * 1.7) * 0.9;
      const y = 1 + hsh(i, 2, 77) * (rows - 2) + Math.cos(t * sp * 0.8 + i) * 0.7;
      const a = Math.max(0, Math.sin(t * (0.5 + sp) + i * 2.3)) * 0.5;
      if (a > 0.03) emit(FX + x * T, FY + y * T, T * 0.15, M.color, a);
    }
  }
  const sprite = name => name === 'burn' ? spr.burn : name === 'brick' ? spr.brick : spr.pillar[0];

  return { prepare, paintBackground, paintHard, drawSoft, ambient, sprite };
})();
