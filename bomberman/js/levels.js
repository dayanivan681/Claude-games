'use strict';
// ================= level generator =================
// Game logic only: turns a world's level rules, a stage and a seed into a level plan — the logical grid
// (EMPTY / HARD / SOFT) plus presentation hints the renderer may use (obstacle skins, floor decals).
// Nothing here draws, and the renderer never changes the grid.

// Small seeded RNG (mulberry32): the same seed always builds the same level.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LevelGen = (() => {
  // How each layout shapes the arena. extra: [min, max] scattered obstacles; clump: how unevenly blocks
  // spread (thickets and clearings); plaza: half-size of an open paved square in the middle.
  const LAYOUTS = {
    classic: { extra: [0, 0], clump: 0.15 },
    grove: { extra: [3, 6], clump: 0.25 },
    clearings: { extra: [0, 2], clump: 0.75 },
    plaza: { extra: [0, 2], clump: 0.2, plaza: 2 },
  };
  const weighted = (list, rng) => { let s = 0; for (const [, w] of list) s += w; let r = rng() * s; for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[0][0]; };
  const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const k = (rng() * (i + 1)) | 0; [a[i], a[k]] = [a[k], a[i]]; } return a; };

  // Smooth value noise in [0,1] on a coarse lattice: big soft blobs that become thickets and clearings.
  function noiseField(cols, rows, rng, cell = 4) {
    const gw = Math.ceil(cols / cell) + 2, gh = Math.ceil(rows / cell) + 2, lat = Array.from({ length: gw * gh }, rng);
    const s = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = s(fx - x0), ty = s(fy - y0);
      const v = (i, j) => lat[(y0 + j) * gw + x0 + i];
      return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
    };
  }

  // Every open cell must stay reachable from the first spawn, or a level could become unwinnable.
  function connected(grid, cols, HARD, start) {
    const n = grid.length, seen = new Uint8Array(n), q = [start]; seen[start] = 1; let reached = 1, open = 0;
    while (q.length) {
      const j = q.pop(), x = j % cols;
      for (const k of [j - cols, j + cols, x > 0 ? j - 1 : -1, x < cols - 1 ? j + 1 : -1]) if (k >= 0 && k < n && !seen[k] && grid[k] !== HARD) { seen[k] = 1; reached++; q.push(k); }
    }
    for (let j = 0; j < n; j++) if (grid[j] !== HARD) open++;
    return reached === open;
  }

  // opts: { cols, rows, codes: { EMPTY, HARD, SOFT }, rules: world.levels, rng, density, protect: [[x, y], …], layout? }
  // → { layout, grid, skins, decals }. protect[0] is the main spawn; protected cells never get blocks.
  function create(opts) {
    const { cols, rows, rules, rng, density, protect } = opts, { EMPTY, HARD, SOFT } = opts.codes;
    const name = opts.layout || weighted(rules.layouts, rng), L = LAYOUTS[name] || LAYOUTS.classic;
    const n = cols * rows, grid = new Uint8Array(n).fill(EMPTY), skins = new Array(n).fill(null), decals = new Array(n).fill(null);
    const at = (x, y) => y * cols + x, mx = (cols - 1) / 2, my = (rows - 1) / 2;
    const prot = new Set(protect.map(([x, y]) => at(x, y))), near = new Set();
    for (const [x, y] of protect) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.add(at(x + dx, y + dy));
    const inPlaza = (x, y) => !!L.plaza && Math.abs(x - mx) <= L.plaza && Math.abs(y - my) <= L.plaza;

    // 1. border wall and the classic posts (left out of the plaza)
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const j = at(x, y);
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) { grid[j] = HARD; skins[j] = 'wall'; }
      else if (x % 2 === 0 && y % 2 === 0 && !inPlaza(x, y)) { grid[j] = HARD; skins[j] = 'pillar'; }
      if (inPlaza(x, y)) decals[j] = 'paving';
    }
    // 2. scattered obstacles: never beside a spawn, never splitting the arena
    const want = L.extra[0] + Math.floor(rng() * (L.extra[1] - L.extra[0] + 1));
    if (want > 0) {
      const cand = [];
      for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) { const j = at(x, y); if (grid[j] === EMPTY && !near.has(j) && !inPlaza(x, y)) cand.push(j); }
      let placed = 0;
      for (const j of shuffle(cand, rng)) {
        if (placed >= want) break;
        grid[j] = HARD;
        if (connected(grid, cols, HARD, at(protect[0][0], protect[0][1]))) { skins[j] = weighted(rules.obstacleSkins, rng); placed++; }
        else grid[j] = EMPTY;
      }
    }
    // 3. destructible blocks: denser in thickets, thinner in clearings and on the plaza
    const noise = noiseField(cols, rows, rng);
    for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
      const j = at(x, y); if (grid[j] !== EMPTY || prot.has(j)) continue;
      let p = density * (1 + L.clump * (noise(x, y) * 2 - 1) * 1.3);
      if (inPlaza(x, y)) p *= 0.35;
      if (rng() < Math.max(0.04, Math.min(0.92, p))) grid[j] = SOFT;
    }
    return { layout: name, grid, skins, decals };
  }

  // Cells of one type in random (seeded) order.
  function cellsOf(plan, type, rng) { const out = []; for (let j = 0; j < plan.grid.length; j++) if (plan.grid[j] === type) out.push(j); return shuffle(out, rng); }

  // Enemy roster for an adventure stage (tiers index the game's enemy table): more and tougher foes as stages climb.
  function roster(stage, rules, rng) {
    const r = rules.enemies, count = Math.min(r.base + Math.ceil(stage * r.perStage), r.max), top = Math.min(r.maxTier, Math.floor(stage / r.tierEvery)), out = [];
    for (let i = 0; i < count; i++) out.push(Math.max(0, top - Math.floor(Math.pow(rng(), 1.6) * (top + 1))));
    return out;
  }

  return { create, cellsOf, roster, shuffle, weighted, LAYOUTS };
})();
