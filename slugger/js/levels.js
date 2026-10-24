"use strict";
// Biomes, level building blocks ("chunks") and the six missions. Layouts are seeded, so each mission
// is the same every time and can be learned and mastered.

const THEMES = {
  desert: { id: "desert", name: "DESERT", music: "desert", art: "desert", sky: ["#f08a4b", "#ffd9a0"], sun: "#fff1c4",
    far: "#d2935e", far2: "#b9774a", mid: "#9c6644", midWin: "#4e2c1e", near: "#5d7a32", trunk: "#7a5232",
    ground: "#c99c5c", groundTop: "#e6bf7d", dirt: "#a87c46", weather: "dust", wall: "#b8804e", wallD: "#7a4a2a", wallTop: "#e6bf7d",
    boss: "#8a7a44", dust: "#d8c8a0", night: 0 },
  jungle: { id: "jungle", name: "JUNGLE", music: "jungle", art: "jungle", sky: ["#4f9c94", "#cfe8b0"], sun: "#fffbe0",
    far: "#6a9a72", far2: "#527e5c", mid: "#3e6442", midWin: "#24402a", near: "#2c5426", trunk: "#4a3520",
    ground: "#6b5a34", groundTop: "#7ea43c", dirt: "#54452a", weather: "leaves", wall: "#7d7c64", wallD: "#4a4a3a", wallTop: "#8aa83a",
    boss: "#566a3e", dust: "#8a7a5a", night: 0 },
  snow: { id: "snow", name: "SNOW", music: "snow", art: "snow", sky: ["#141b38", "#4d6898"], sun: "#e8eeff",
    far: "#7f90b8", far2: "#62729a", mid: "#46527a", midWin: "#ffd36a", near: "#203242", trunk: "#3a2a24",
    ground: "#d4dcea", groundTop: "#ffffff", dirt: "#9aa8c0", weather: "snow", wall: "#6a4a3a", wallD: "#3e2a20", wallTop: "#ffffff",
    boss: "#5f7080", dust: "#ffffff", night: 0.15 },
  city: { id: "city", name: "NIGHT CITY", music: "city", art: "city", sky: ["#05060f", "#1e2448"], sun: "#e8eeff",
    far: "#141a30", far2: "#1c2340", mid: "#232a44", midWin: "#ffd36a", near: "#2a2e3a", trunk: "#3a3a44",
    ground: "#34343c", groundTop: "#5a5a64", dirt: "#26262c", weather: "rain", wall: "#4a4a58", wallD: "#2e2e38", wallTop: "#6a6a78",
    boss: "#3e4656", dust: "#6a6a74", night: 0.62 },
  harbor: { id: "harbor", name: "HARBOR", music: "harbor", art: "harbor", sky: ["#ff7a5a", "#ffd0a0"], sun: "#fff0c0",
    far: "#3a6a8a", far2: "#2a5470", mid: "#5a4a48", midWin: "#2a2224", near: "#3a2e28", trunk: "#5a3a24",
    ground: "#7a5a3a", groundTop: "#a07a50", dirt: "#5a4028", weather: "spray", wall: "#6a5040", wallD: "#3e2e24", wallTop: "#a07a50",
    boss: "#5a6676", dust: "#c8a878", night: 0 },
  fortress: { id: "fortress", name: "FORTRESS", music: "fortress", art: "fortress", sky: ["#1a0606", "#8a2a1a"], sun: "#ffb060",
    far: "#3a1612", far2: "#2a100e", mid: "#3e2a26", midWin: "#ff8a3a", near: "#24181a", trunk: "#3a2a24",
    ground: "#3a2a26", groundTop: "#5a4038", dirt: "#2a1e1a", weather: "ash", wall: "#5a4a44", wallD: "#3a2e2a", wallTop: "#7a6a62",
    boss: "#4e4e58", dust: "#6a5a54", night: 0.3 },
};
const theme = () => game.theme;

const MISSIONS = [
  { id: 1, name: "DESERT TOWN", theme: "desert", boss: "tank", par: 240, seed: 1101,
    chunks: ["start", "patrol", ["rooftops", { tag: true }], "camp", "cache", "flag", ["arena", 0], "garage", "patrol", "secret", "flag", "heli", ["cache", { tag: true }], "boss"] },
  { id: 2, name: "JUNGLE RUINS", theme: "jungle", boss: "walker", par: 270, seed: 2202,
    chunks: ["start", "patrol", "camp", ["rooftops", { tag: true }], "bunker", "flag", ["arena", 1], "cache", "bikes", "secret", "flag", "miniboss", "patrol", ["cache", { tag: true }], "boss"] },
  { id: 3, name: "FROZEN BASE", theme: "snow", boss: "bomber", par: 280, seed: 3303,
    chunks: ["start", "bunker", ["rooftops", { tag: true }], "camp", "garage", "flag", ["arena", 2], "patrol", "secret", "heli", "flag", "bikes", "rooftops", ["cache", { tag: true }], "boss"] },
  { id: 4, name: "NIGHT CITY", theme: "city", boss: "gunship", par: 300, seed: 4404,
    chunks: ["start", "rooftops", "patrol", "secret", "bikes", "flag", ["arena", 3], ["rooftops", { tag: true }], "camp", "bunker", "flag", "miniboss", "garage", ["cache", { tag: true }], "boss"] },
  { id: 5, name: "HARBOR", theme: "harbor", boss: "battleship", par: 300, seed: 5505,
    chunks: ["start", "cache", "bunker", ["rooftops", { tag: true }], "camp", "flag", ["arena", 4], "garage", "bikes", "secret", "flag", "heli", "patrol", ["rooftops", { tag: true }], "boss"] },
  { id: 6, name: "IRON FORTRESS", theme: "fortress", boss: "general", par: 330, seed: 6606,
    chunks: ["start", "bunker", "patrol", ["rooftops", { tag: true }], "camp", "flag", ["arena", 5], "garage", "miniboss", "secret", "flag", "bikes", "bunker", ["cache", { tag: true }], "flag", ["arena", 6], "boss"] },
];

// ---------- Builder ----------
function makeBuilder(rng) {
  const L = {
    r: rng, ri: (a, b) => a + Math.floor(rng() * (b - a + 1)), pick: a => a[Math.floor(rng() * a.length)],
    d: game.diff, tagIdx: 0,
    place(x, spawn) { placed.push({ x, spawn }); },
    enemy(type, x, o = {}) { L.place(x, () => mkEnemy(type, x, o)); },
    squad(x, n, o = {}) {
      const types = o.types;
      L.place(x, () => { for (let i = 0; i < n; i++) { const e = mkEnemy(types ? types[i % types.length] : pickType(), x + i * 16, { idle: o.idle, elite: o.elite || (L.d >= 3 && chance(0.15)), y: o.plat ? o.plat.y : GROUND, plat: o.plat }); if (o.idle) e.face = i % 2 ? -1 : 1; } });
    },
    crate(x, y = GROUND, item = null, o = {}) { crates.push({ x, y, w: 16, h: 16, vy: 0, hp: o.gold ? 6 : 4, flash: 0, item, gold: !!o.gold, tag: o.tag }); },
    stack(x, n, items = []) { for (let i = 0; i < n; i++) L.crate(x, GROUND + i * 16, items[i] || (rng() < 0.45 ? randItem(rng) : null)); },
    barrel(x) { barrels.push({ x, y: GROUND, w: 12, h: 16, hp: 3, flash: 0, fuse: 0, dead: false }); },
    cover(x, w = 26) { covers.push({ x, y: GROUND, w, h: 13 }); },
    pow(x, y = GROUND, item) { pows.push({ x, y, state: "tied", t: rng() * 3, face: -1, item: item || randItem(rng) }); game.powsTotal++; },
    building(x, w, h, o = {}) {
      const pl = { x, y: GROUND + h, w, h, look: o.look ?? L.ri(0, 2) };
      plats.push(pl);
      if (o.roof) L.squad(x + 14, o.roof, { types: o.roofTypes || ["rifle", "sniper", "grenadier"], idle: rng() < 0.4, plat: pl });
      if (o.pow) L.pow(x + w - 16, pl.y);
      if (o.crate) L.crate(x + 6, pl.y, o.crate);
      return pl;
    },
    tag(x, y = GROUND + 4) { const i = L.tagIdx++; game.tagsTotal++; return { kind: "tag", tag: i }; },
    secretWall(x, h = 30) {
      const loot = [L.tag(x), { kind: "gold" }, { kind: "gold" }];
      const pl = L.building(x, 64, h + 10, { look: 3 });
      walls.push({ x: x + 22, y: GROUND, w: 20, h: 24, hp: 8, cracked: true, loot, flash: 0 });
      return pl;
    },
    flag(x) { flags.push({ x, reached: false, t: 0 }); },
    hint(x, key, txt) { hints.push({ x, key, text: txt, shown: false }); },
    lock(x, waves) { game.locks.push({ x, waves }); },
    prop(x, kind) { props.push({ x, kind }); },
  };
  return L;
}
const waveSq = (n, side, o = {}) => Array.from({ length: n }, (_, i) => ({ type: o.types ? o.types[i % o.types.length] : pickType(), side, para: o.para, delay: i * 0.55, elite: o.elite }));
const drones = (n, side = "r") => Array.from({ length: n }, (_, i) => ({ type: "drone", side, delay: 0.4 + i * 0.8 }));
const ARENAS = [
  d => [waveSq(3, "r"), [{ type: "truck", delay: 0 }], waveSq(3, "l"), waveSq(3, "r", { para: true })],
  d => [waveSq(4, "r"), waveSq(3, "l", { types: ["knife", "shield"] }), [{ type: "heli", delay: 0 }, ...waveSq(2, "r", { para: true })]],
  d => [[{ type: "truck", delay: 0 }], waveSq(4, "r", { types: ["rifle", "bazooka", "grenadier"] }), [{ type: "heli", delay: 0 }], [...drones(2), ...waveSq(3, "l", { para: true })]],
  d => [waveSq(4, "r"), [{ type: "biker", delay: 0 }, { type: "biker", delay: 1.2 }], waveSq(3, "l", { types: ["shield", "knife"] }), [{ type: "heli", delay: 0 }, ...waveSq(3, "r", { para: true, elite: true })]],
  d => [[{ type: "truck", delay: 0 }], [...waveSq(4, "l"), ...drones(2)], [{ type: "jugg", delay: 0 }], waveSq(4, "r", { para: true })],
  d => [waveSq(5, "r", { elite: true }), [{ type: "heli", delay: 0 }, { type: "heli", delay: 4 }, ...drones(2, "l")], [{ type: "jugg", delay: 0 }, ...waveSq(3, "l")]],
  d => [[{ type: "truck", delay: 0 }, { type: "biker", delay: 2 }], waveSq(5, "r", { para: true, elite: true }), [{ type: "jugg", delay: 0 }, { type: "jugg", delay: 3 }]],
];

const CHUNKS = {
  start(L, x) {
    L.prop(x + 30, "sign");
    L.hint(x + 10, "move", isTouch ? "LEFT THUMB: MOVE · UP AIMS · DOWN CROUCHES" : "ARROWS MOVE · J FIRE · K JUMP · L GRENADE");
    if (autoFireOn()) L.hint(x + 70, "auto", "YOU FIRE AUTOMATICALLY AT ENEMIES");
    L.stack(x + 150, 1, [L.pick(["H", "S", "F"])]);
    L.hint(x + 120, "crate", "SHOOT CRATES FOR WEAPONS");
    L.squad(x + 280, 2, { idle: true, types: ["rifle", "rifle"] });
    L.prop(x + 220, "sandbag");
    return 360;
  },
  patrol(L, x) {
    L.cover(x + 160); L.barrel(x + 140);
    L.squad(x + 190, 2, { types: ["rifle", "grenadier"] });
    L.squad(x + 300, L.d >= 2 ? 3 : 2, { types: ["knife", "rifle", "shield"] });
    L.prop(x + 60, L.pick(["rock", "wreck"]));
    if (L.d >= 2) L.enemy("sniper", x + 330);
    return 360;
  },
  rooftops(L, x, o = {}) {
    const w1 = L.ri(70, 96), h1 = L.ri(38, 46);
    const b1 = L.building(x + 40, w1, h1, { roof: 1 + (L.d >= 3 ? 1 : 0), roofTypes: ["rifle", "sniper"] });
    const b2 = L.building(x + 40 + w1 + L.ri(50, 80), L.ri(70, 90), L.ri(40, 50), { roof: 1, roofTypes: ["grenadier", "rifle"], pow: true });
    if (o.tag) items.push({ x: b2.x + 12, y: b2.y, vy: 0, kind: "tag", tag: L.tag().tag, t: 0 });
    L.hint(x + 20, "roof", "JUMP ONTO ROOFS · DOWN + JUMP TO DROP");
    L.crate(b1.x + 8, b1.y, L.pick(["R", "S", "B"]));
    L.squad(x + 40 + w1 + 30, 1, { types: ["knife"] });
    return 40 + w1 + 80 + 100 + 60;
  },
  cache(L, x, o = {}) {
    L.stack(x + 60, 2); L.stack(x + 76, 1);
    L.crate(x + 150, GROUND, null, { gold: true });
    L.barrel(x + 200); L.barrel(x + 214);
    L.squad(x + 230, 3, { idle: true });
    if (o.tag) L.crate(x + 110, GROUND, "tag", { tag: L.tag().tag });
    L.prop(x + 280, "sandbag");
    return 320;
  },
  camp(L, x) {
    L.prop(x + 40, "tent");
    L.pow(x + 90); L.pow(x + 200);
    L.cover(x + 140);
    L.squad(x + 150, 2, { idle: true, types: ["rifle", "grenadier"] });
    L.squad(x + 240, 2, { types: ["rifle", "knife"] });
    L.hint(x + 60, "pow", "WALK INTO OR SHOOT PRISONERS TO FREE THEM");
    return 320;
  },
  flag(L, x) { L.flag(x + 40); return 90; },
  arena(L, x, k = 0) {
    L.lock(x, ARENAS[k](L.d));
    L.cover(x + Math.round(W * 0.3)); L.cover(x + Math.round(W * 0.7));
    L.crate(x + Math.round(W * 0.5), GROUND, L.pick(["H", "R", "S", "F", "L"]));
    return W + 40;
  },
  garage(L, x) {
    tank = mkTank(x + 120);
    L.hint(x + 60, "slug", "WALK INTO THE SLUG TO DRIVE IT");
    L.squad(x + 260, 3, { types: ["rifle", "bazooka", "knife"] });
    L.enemy("truck", x + 380);
    return 420;
  },
  bunker(L, x) {
    L.cover(x + 100);
    L.enemy("mgnest", x + 200);
    L.enemy("mortar", x + 290);
    L.squad(x + 120, 2, { types: ["rifle", "grenadier"] });
    L.hint(x + 60, "duck", "CROUCH UNDER HIGH FIRE · JUMP OVER LOW FIRE");
    return 340;
  },
  bikes(L, x) {
    L.cover(x + 120, 30);
    L.enemy("biker", x + 200); L.enemy("biker", x + 330);
    if (L.d >= 2) L.enemy("biker", x + 420);
    L.hint(x + 80, "bike", "JUMP OVER THE BIKES OR SHOOT THEM");
    return 360;
  },
  secret(L, x) {
    L.secretWall(x + 60);
    L.hint(x + 30, "wall", "SHOOT CRACKED WALLS TO FIND SECRETS");
    L.squad(x + 200, 2);
    return 280;
  },
  heli(L, x) {
    L.enemy("heli", x + 120, {});
    L.squad(x + 200, 2, { types: ["rifle", "grenadier"] });
    L.cover(x + 230);
    L.hint(x + 60, "up", "PUSH UP TO AIM AT THE SKY");
    return 320;
  },
  miniboss(L, x) { L.lock(x, [[{ type: "jugg", delay: 0 }], waveSq(3, "r", { para: true })]); L.cover(x + Math.round(W * 0.35)); return W + 40; },
  boss(L, x) { game.locks.push({ x, boss: true }); return W; },
};

function buildMission(g) {
  const m = g.m, L = makeBuilder(mulberry(m.seed));
  let x = 0;
  for (const ch of m.chunks) {
    const [name, arg] = Array.isArray(ch) ? ch : [ch];
    x += CHUNKS[name](L, x, arg);
  }
  g.len = x;
  for (let px = 120; px < g.len - W; px += 110 + (hash(px) * 140 | 0)) if (!props.some(p => Math.abs(p.x - px) < 40)) props.push({ x: px, kind: pick(PROP_KINDS[g.theme.id]) });
  if (g.theme.id === "city") for (let px = 60; px < g.len; px += 170) props.push({ x: px, kind: "lamp" });
  placed.sort((a, b) => a.x - b.x);
  props.sort((a, b) => a.x - b.x);
  buildLayers(g.theme, g.len);
}
const PROP_KINDS = {
  desert: ["sandbag", "rock", "wreck", "cactus", "skull"], jungle: ["rock", "stump", "fern", "statue"], snow: ["rock", "snowman", "wreck", "sandbag"],
  city: ["car", "hydrant", "bin", "sandbag"], harbor: ["bollard", "rope", "barrels", "net"], fortress: ["spikes", "wire", "skull", "rock"],
};

// ---------- Survival ----------
function buildSurvivalArena(g) {
  g.len = W;
  covers.push({ x: Math.round(W * 0.22), y: GROUND, w: 26, h: 13 }, { x: Math.round(W * 0.72), y: GROUND, w: 26, h: 13 });
  props.push({ x: Math.round(W * 0.5), kind: "sandbag" });
  buildLayers(g.theme, W);
}
function updateSurvival(dt) {
  if (game.waveLeft.length) {
    for (const s of game.waveLeft) s.delay -= dt;
    for (const s of game.waveLeft.filter(s => s.delay <= 0)) spawnWaveUnit(s);
    game.waveLeft = game.waveLeft.filter(s => s.delay > 0);
    return;
  }
  if (enemies.some(e => e.wave) || boss) return;
  game.waveT -= dt;
  if (game.waveT > 0) return;
  game.wave++;
  const w = game.wave;
  game.diff = Math.min(8, Math.floor((w - 1) / 3));
  if (w > 1) { addScore(250 * w); gainCoins(4 + w, camX + W / 2, GROUND + 80); }
  banner = { title: `WAVE ${w}`, sub: w % 10 === 0 ? "BOSS WAVE!" : w % 5 === 0 ? "HEAVY WAVE" : "", t: 0, dur: 1.8 };
  dailyMax("wave", w - 1);
  const list = [];
  if (w % 10 === 0) { spawnBoss(["tank", "walker", "bomber", "gunship"][(w / 10 - 1) % 4]); }
  else {
    const n = Math.min(3 + w, 14);
    for (let i = 0; i < n; i++) list.push({ type: pickType(), side: chance(0.5) ? "r" : "l", para: chance(0.2), delay: i * Math.max(0.35, 0.9 - w * 0.03), elite: w > 6 && chance(0.2) });
    if (w % 3 === 0) list.push({ type: "heli", delay: 2 });
    if (w % 4 === 0) list.push({ type: "biker", delay: 1 }, { type: "biker", delay: 3 });
    if (w % 5 === 0) list.push({ type: "jugg", delay: 1.5 });
    if (w % 7 === 0) list.push({ type: "truck", delay: 0.5 });
    if (w > 2 && w % 2 === 0) list.push(...drones(Math.min(1 + Math.floor(w / 4), 4), chance(0.5) ? "r" : "l"));
  }
  game.waveLeft = list.map(s => ({ ...s, side: s.side || "r" }));
  game.waveT = 2.5;
  dropItem(rand(W * 0.2, W * 0.8), H + 10, w % 3 === 0 ? "vest" : pick(["H", "R", "S", "F", "L", "B"]), { chute: true });
}

// ---------- Parallax layers (pre-rendered once per mission) ----------
let layers = null;
function buildLayers(th, len) {
  const mk = par => { const w = Math.ceil(len * par + W + 96); const c = document.createElement("canvas"); c.width = w; c.height = H; return { c, g: c.getContext("2d"), par, w }; };
  layers = { far: mk(0.12), mid: mk(0.38), near: mk(0.7), theme: th.id, len, h: H, c0w: W };
  const rng = mulberry(len * 7 + th.id.length * 131);
  ART[th.art](th, layers, rng);
}
const GY = () => H - GROUND;                 // ground top row in layer coordinates
function ridge(c, w, base, amp, color, rng, step = 1, sharp = false, cap = null) {
  const p = [rng() * 6, rng() * 6, rng() * 6], f = [0.004 + rng() * 0.004, 0.011 + rng() * 0.006, 0.027 + rng() * 0.01];
  c.fillStyle = color;
  for (let x = 0; x < w; x += step) {
    let n = Math.sin(x * f[0] + p[0]) * 0.55 + Math.sin(x * f[1] + p[1]) * 0.3 + Math.sin(x * f[2] + p[2]) * 0.15;
    if (sharp) n = 1 - Math.abs(n) * 1.6;
    const y = Math.round(base - (n * 0.5 + 0.5) * amp);
    c.fillStyle = color; c.fillRect(x, y, step, H - y);
    if (cap && y < base - amp * 0.55) { c.fillStyle = cap; c.fillRect(x, y, step, Math.round((base - amp * 0.55 - y) * 0.6) + 2); }
  }
}
function pineShape(c, x, base, h, w, color, snowCol) {
  for (let k = 0; k < 4; k++) {
    const ww = w * (1 - k * 0.2), yy = base - k * h / 4;
    for (let i = 0; i < h / 3; i++) { const half = Math.round(ww / 2 * (1 - i / (h / 3))); c.fillStyle = color; c.fillRect(Math.round(x - half), Math.round(yy - i), half * 2 + 1, 1); }
    if (snowCol) { c.fillStyle = snowCol; c.fillRect(Math.round(x - ww / 4), Math.round(yy - h / 7), Math.round(ww / 2), 2); }
  }
  c.fillStyle = "#3a2a24"; c.fillRect(Math.round(x - 1), base, 3, 5);
}
const ART = {
  desert(th, L, rng) {
    const gy = GY();
    ridge(L.far.g, L.far.w, gy - 40, 60, th.far, rng, 2);
    ridge(L.far.g, L.far.w, gy - 12, 34, th.far2, rng, 2);
    const c = L.mid.g;
    for (let x = -10; x < L.mid.w;) {
      const w = 26 + rng() * 34, h = 26 + rng() * 40, top = gy - h;
      c.fillStyle = th.mid; c.fillRect(Math.round(x), Math.round(top), Math.round(w), Math.round(h));
      for (let k = 0; k < w; k += 6) { const hh = Math.round(rng() * 9); c.fillRect(Math.round(x + k), Math.round(top - hh), 6, hh); }
      c.fillStyle = th.midWin;
      for (let i = 0; i < Math.floor((w - 6) / 10); i++) for (let j = 0; j < Math.floor((h - 12) / 13); j++) if (rng() < 0.7) c.fillRect(Math.round(x + 5 + i * 10), Math.round(top + 7 + j * 13), 5, 7);
      x += w + 6 + rng() * 40;
    }
    const n = L.near.g;
    for (let x = 30; x < L.near.w; x += 70 + rng() * 80) {
      const h = 46 + rng() * 32, lean = (rng() - 0.5) * 20;
      for (let s = 0; s < 10; s++) { const cx = Math.round(x + Math.sin(s / 10 * 1.3) * lean); n.fillStyle = s % 2 ? shade(th.trunk, -0.2) : th.trunk; n.fillRect(cx, Math.round(gy - (s + 1) * h / 10), 4, Math.ceil(h / 10) + 1); }
      const tx = Math.round(x + Math.sin(1.3) * lean) + 2, ty = Math.round(gy - h);
      for (let k = 0; k < 6; k++) { const a = -Math.PI + k * Math.PI / 5; for (let i = 0; i < 24; i++) { const t = i / 24; n.fillStyle = th.near; n.fillRect(Math.round(tx + Math.cos(a) * 24 * t), Math.round(ty - Math.sin(a) * 4 * t + 10 * t * t), 3, 2); } }
      pcirc(n, tx, ty + 2, 3, "#6a4a22");
    }
  },
  jungle(th, L, rng) {
    const gy = GY();
    ridge(L.far.g, L.far.w, gy - 30, 70, th.far, rng, 2);
    ridge(L.far.g, L.far.w, gy - 6, 40, th.far2, rng, 2);
    const c = L.mid.g;
    for (let x = 0; x < L.mid.w; x += 30 + rng() * 30) {
      const h = 30 + rng() * 40, w = 30 + rng() * 26;
      c.fillStyle = th.trunk; c.fillRect(Math.round(x + w / 2 - 2), Math.round(gy - h), 4, Math.round(h));
      pcirc(c, x + w / 2, gy - h, w * 0.55, th.mid); pcirc(c, x + w * 0.25, gy - h + 8, w * 0.35, th.mid); pcirc(c, x + w * 0.8, gy - h + 6, w * 0.35, th.mid);
    }
    for (let x = 40; x < L.mid.w; x += 160 + rng() * 120) {
      const w = 30 + rng() * 20, h = 36 + rng() * 20;
      c.fillStyle = "#6a6a52"; c.fillRect(Math.round(x), Math.round(gy - h), Math.round(w), Math.round(h));
      c.fillStyle = "#4a4a3a"; for (let r = 0; r < h; r += 6) c.fillRect(Math.round(x), Math.round(gy - h + r), Math.round(w), 1);
      c.fillStyle = "#2a2a20"; c.fillRect(Math.round(x + w / 2 - 4), Math.round(gy - 14), 8, 14);
    }
    const n = L.near.g;
    for (let x = 20; x < L.near.w; x += 80 + rng() * 90) {
      const h = 40 + rng() * 30;
      n.fillStyle = th.trunk; n.fillRect(Math.round(x), 0, 9, gy);
      n.fillStyle = shade(th.trunk, -0.3); n.fillRect(Math.round(x + 6), 0, 3, gy);
      pcirc(n, x + 4, gy - h - 50, 30, th.near); pcirc(n, x - 20, gy - h - 40, 20, th.near); pcirc(n, x + 28, gy - h - 42, 22, th.near);
      n.fillStyle = th.near; n.fillRect(Math.round(x + 18), Math.round(gy - h - 30), 1, 40 + Math.round(rng() * 30)); n.fillRect(Math.round(x - 12), Math.round(gy - h - 25), 1, 30 + Math.round(rng() * 20));
    }
  },
  snow(th, L, rng) {
    const gy = GY();
    ridge(L.far.g, L.far.w, gy - 30, 90, th.far, rng, 2, true, "#e8eeff");
    ridge(L.far.g, L.far.w, gy - 8, 36, th.far2, rng, 2);
    const c = L.mid.g;
    for (let x = 0; x < L.mid.w; x += 18 + rng() * 26) pineShape(c, x, gy - 4, 30 + rng() * 30, 22 + rng() * 10, th.mid, "#a8b4d0");
    for (let x = 60; x < L.mid.w; x += 200 + rng() * 160) {
      c.fillStyle = "#3a3048"; c.fillRect(Math.round(x), gy - 22, 34, 22);
      c.fillStyle = "#e8eeff"; for (let i = 0; i < 20; i++) c.fillRect(Math.round(x - 3 + i), gy - 22 - Math.min(i, 19 - i) / 2 - 3, 2, 3);
      c.fillStyle = th.midWin; c.fillRect(Math.round(x + 6), gy - 15, 6, 6); c.fillRect(Math.round(x + 22), gy - 15, 6, 6);
    }
    const n = L.near.g;
    for (let x = 30; x < L.near.w; x += 60 + rng() * 80) pineShape(n, x, gy, 50 + rng() * 30, 30 + rng() * 10, th.near, "#e8f0ff");
  },
  city(th, L, rng) {
    const gy = GY(), f = L.far.g;
    for (let x = 0; x < L.far.w;) {
      const w = 14 + rng() * 26, h = 40 + rng() * 80;
      f.fillStyle = th.far; f.fillRect(Math.round(x), Math.round(gy - h), Math.round(w), Math.round(h));
      f.fillStyle = "#6a6a40";
      for (let i = 2; i < w - 2; i += 3) for (let j = 4; j < h; j += 4) if (rng() < 0.18) f.fillRect(Math.round(x + i), Math.round(gy - h + j), 1, 1);
      if (rng() < 0.2) { f.fillStyle = "#ff3a3a"; f.fillRect(Math.round(x + w / 2), Math.round(gy - h - 4), 1, 2); }
      x += w + rng() * 4;
    }
    const c = L.mid.g;
    for (let x = 0; x < L.mid.w;) {
      const w = 34 + rng() * 40, h = 50 + rng() * 60, top = Math.round(gy - h);
      c.fillStyle = th.mid; c.fillRect(Math.round(x), top, Math.round(w), Math.round(h));
      for (let i = 4; i < w - 6; i += 8) for (let j = 6; j < h - 6; j += 10) { c.fillStyle = rng() < 0.35 ? th.midWin : "#141828"; c.fillRect(Math.round(x + i), top + j, 4, 5); }
      if (rng() < 0.4) { const col = pick(["#ff3a8a", "#3ae8ff", "#ffd34d"]); c.fillStyle = col; c.fillRect(Math.round(x + 4), top + 10, Math.round(w - 8), 6); c.fillStyle = "#141828"; for (let i = 0; i < w - 12; i += 6) c.fillRect(Math.round(x + 6 + i), top + 12, 3, 2); }
      x += w + 2 + rng() * 10;
    }
    const n = L.near.g;
    for (let x = 0; x < L.near.w; x += 100 + rng() * 80) {
      n.fillStyle = th.near; n.fillRect(Math.round(x), gy - 18, 70, 18);
      n.fillStyle = shade(th.near, 0.2); for (let i = 0; i < 70; i += 5) n.fillRect(Math.round(x + i), gy - 18, 1, 18);
    }
  },
  harbor(th, L, rng) {
    const gy = GY(), f = L.far.g;
    f.fillStyle = th.far; f.fillRect(0, gy - 40, L.far.w, 40);
    f.fillStyle = shade(th.far, 0.25); for (let x = 0; x < L.far.w; x += 7) f.fillRect(x, gy - 40 + Math.round(rng() * 38), 4, 1);
    for (let x = 30; x < L.far.w; x += 120 + rng() * 140) { f.fillStyle = "#2a3a4a"; f.fillRect(Math.round(x), gy - 48, 40, 8); f.fillRect(Math.round(x + 10), gy - 58, 14, 10); f.fillRect(Math.round(x + 16), gy - 66, 3, 8); }
    const c = L.mid.g;
    for (let x = 20; x < L.mid.w; x += 140 + rng() * 120) {
      c.fillStyle = "#c8562a"; c.fillRect(Math.round(x + 6), gy - 90, 4, 90); c.fillRect(Math.round(x - 20), gy - 92, 70, 4); c.fillRect(Math.round(x + 40), gy - 88, 1, 30);
      c.fillStyle = "#8a3a1a"; for (let j = 0; j < 90; j += 8) c.fillRect(Math.round(x + 6), gy - 90 + j, 4, 1);
    }
    for (let x = 0; x < L.mid.w; x += 36 + rng() * 40) {
      const stacks = 1 + Math.floor(rng() * 3);
      for (let s = 0; s < stacks; s++) { const col = pick(["#a83a2a", "#2a6a8a", "#c8962a", "#3a7a4a"]); c.fillStyle = col; c.fillRect(Math.round(x), gy - 14 - s * 14, 30, 13); c.fillStyle = shade(col, -0.25); for (let i = 2; i < 30; i += 4) c.fillRect(Math.round(x + i), gy - 14 - s * 14, 1, 13); }
    }
    const n = L.near.g;
    for (let x = 0; x < L.near.w; x += 50 + rng() * 40) { n.fillStyle = th.trunk; n.fillRect(Math.round(x), gy - 20, 6, 20); n.fillStyle = shade(th.trunk, 0.2); n.fillRect(Math.round(x), gy - 20, 6, 2); }
  },
  fortress(th, L, rng) {
    const gy = GY(), f = L.far.g;
    ridge(f, L.far.w, gy - 20, 90, th.far, rng, 2, true);
    for (let x = 40; x < L.far.w; x += 180 + rng() * 120) { f.fillStyle = "#ff6a2a"; for (let i = 0; i < 30; i++) f.fillRect(Math.round(x + Math.sin(i) * 3), gy - 100 + i * 3, 2, 3); }
    ridge(f, L.far.w, gy - 4, 30, th.far2, rng, 2);
    const c = L.mid.g;
    for (let x = 0; x < L.mid.w; x += 120 + rng() * 80) {
      const h = 60 + rng() * 40;
      c.fillStyle = th.mid; c.fillRect(Math.round(x), Math.round(gy - h), 60, Math.round(h));
      for (let i = 0; i < 5; i++) c.fillRect(Math.round(x + i * 13), Math.round(gy - h - 6), 8, 6);
      c.fillStyle = "#8a2a2a"; c.fillRect(Math.round(x + 22), Math.round(gy - h + 10), 14, 24);
      c.fillStyle = th.midWin; for (let i = 0; i < 3; i++) c.fillRect(Math.round(x + 6 + i * 18), Math.round(gy - h / 2), 5, 7);
      c.fillStyle = "#2a1e1c"; c.fillRect(Math.round(x + 70), Math.round(gy - h - 30), 10, Math.round(h + 30));
    }
    const n = L.near.g;
    for (let x = 0; x < L.near.w; x += 40 + rng() * 50) { n.fillStyle = th.near; n.fillRect(Math.round(x), gy - 16, 3, 16); n.fillRect(Math.round(x - 10), gy - 12, 24, 1); n.fillRect(Math.round(x - 10), gy - 7, 24, 1); }
  },
};
