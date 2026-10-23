"use strict";
// Pixel art drawn in code. Sprites are rows of role letters; a palette maps roles to colors, so the same
// drawing serves every soldier, costume and biome. Characters are assembled from parts (procedural legs,
// torso, head, arm, gun) into a scratch canvas and blitted with a 1px dark outline.

// Fixed colors shared by every palette
const FIXED = {
  E: "#1a1010", W: "#ffffff", M: "#34343e", m: "#565664", L: "#9c9cac", w: "#6a4520", u: "#a8743a", T: "#c8945a",
  R: "#c83a2a", r: "#7a2014", Y: "#ffd34d", y: "#c8962a", O: "#ff8a1a", G: "#8fd0e8", V: "#5d6b32", v: "#3e4822",
  X: "#000000", Z: "#7a7a82", z: "#4a4a52", Q: "#e8e0c8", q: "#b8ae94", F: "#fff6c0",
};
const OUTLINE = "#140c0a";

// ---------- Palettes ----------
const PALS = {};
function defPal(key, p) { PALS[key] = p; }
const basePal = { S: "#f3c48f", s: "#d39560", H: "#5a3418", h: "#3a1e0c", A: "#d8282c", a: "#941418", C: "#c9a45a", c: "#937238", D: "#e2c47e",
  P: "#3d5ca8", p: "#2b4380", B: "#3a2414", b: "#6a4a30", K: "#5a3a1a", N: "#6d6a3a", n: "#4a4826" };
// Heroes: base look + 3 costumes unlocked by level
const HERO_LOOKS = [
  { head: "h_rayo", costumes: ["STANDARD", "DESERT", "URBAN", "GOLD"], pals: [
    {}, { C: "#d8c08a", c: "#a88e5a", D: "#ecd8a8", P: "#a08050", p: "#7a5e38" },
    { C: "#7a7f88", c: "#555a62", D: "#9aa0aa", P: "#3a3f48", p: "#262a32", A: "#2a2a2a", a: "#141414" },
    { C: "#e8b830", c: "#b08418", D: "#ffe070", P: "#8a6a20", p: "#644c14", A: "#ffffff", a: "#c8c8c8" }] },
  { head: "h_tania", costumes: ["STANDARD", "NAVY", "CRIMSON", "GOLD"], pals: [
    { S: "#e8b080", s: "#c08050", H: "#2a1a14", h: "#140a06", A: "#3a8a3a", a: "#2a6a2a", C: "#5a7a3a", c: "#3e5a28", D: "#7a9a54", P: "#7a6a4a", p: "#5a4e36" },
    { S: "#e8b080", s: "#c08050", H: "#2a1a14", h: "#140a06", A: "#e8e8e8", a: "#b0b0b0", C: "#3a4a7a", c: "#28345a", D: "#5a6a9a", P: "#2a3048", p: "#1c2034" },
    { S: "#e8b080", s: "#c08050", H: "#2a1a14", h: "#140a06", A: "#2a2a2a", a: "#141414", C: "#8a2a2a", c: "#621c1c", D: "#aa4a4a", P: "#3a2a2a", p: "#261a1a" },
    { S: "#e8b080", s: "#c08050", H: "#2a1a14", h: "#140a06", A: "#ffffff", a: "#c8c8c8", C: "#e8b830", c: "#b08418", D: "#ffe070", P: "#8a6a20", p: "#644c14" }] },
  { head: "h_erika", costumes: ["STANDARD", "PINK", "SHADOW", "GOLD"], pals: [
    { S: "#f6cfa0", s: "#d6a070", H: "#f0d060", h: "#c8a030", A: "#3a5aa8", a: "#2a4080", C: "#d8d0b8", c: "#aaa290", D: "#f0ead8", P: "#4a6a3a", p: "#344c28" },
    { S: "#f6cfa0", s: "#d6a070", H: "#f0d060", h: "#c8a030", A: "#d85a9a", a: "#a83a72", C: "#f0d8e4", c: "#c8aab8", D: "#fff0f6", P: "#5a4a6a", p: "#40344e" },
    { S: "#f6cfa0", s: "#d6a070", H: "#f0d060", h: "#c8a030", A: "#2a2a2a", a: "#141414", C: "#3a3a3a", c: "#262626", D: "#555555", P: "#2a2a30", p: "#1a1a20" },
    { S: "#f6cfa0", s: "#d6a070", H: "#f0d060", h: "#c8a030", A: "#ffffff", a: "#c8c8c8", C: "#e8b830", c: "#b08418", D: "#ffe070", P: "#8a6a20", p: "#644c14" }] },
  { head: "h_fito", costumes: ["STANDARD", "JUNGLE", "ARCTIC", "GOLD"], pals: [
    { H: "#3a2414", h: "#24160a", A: "#c8a45a", a: "#94743a", C: "#8a6a3a", c: "#64482a", D: "#a88a5a", P: "#3a4a6a", p: "#2a364e" },
    { H: "#3a2414", h: "#24160a", A: "#4a6a3a", a: "#344c28", C: "#5a7a3a", c: "#3e5a28", D: "#7a9a54", P: "#4a4a32", p: "#343424" },
    { H: "#3a2414", h: "#24160a", A: "#e8ecf0", a: "#b8c0c8", C: "#d8dee8", c: "#a8b4c4", D: "#ffffff", P: "#8a96a8", p: "#68748a" },
    { H: "#3a2414", h: "#24160a", A: "#ffffff", a: "#c8c8c8", C: "#e8b830", c: "#b08418", D: "#ffe070", P: "#8a6a20", p: "#644c14" }] },
];
HERO_LOOKS.forEach((h, i) => h.pals.forEach((p, c) => defPal(`hero${i}_${c}`, { ...basePal, ...p })));
// Rebel army per biome (+ elite red berets)
const REBEL_COLORS = {
  desert: { A: "#66733a", a: "#4a5428", C: "#7f8c46", c: "#5c6830", D: "#9aa85a", P: "#6b7738", p: "#4f5a28" },
  jungle: { A: "#4a6a2a", a: "#344c1c", C: "#5a7a32", c: "#405a22", D: "#76984a", P: "#4a6428", p: "#344a1c" },
  snow: { A: "#e0e6ee", a: "#a8b4c4", C: "#d8dee8", c: "#a8b4c4", D: "#ffffff", P: "#c8d0dc", p: "#98a4b4" },
  city: { A: "#4a5262", a: "#323846", C: "#5a6272", c: "#3e4654", D: "#76808e", P: "#3e4654", p: "#2a303c" },
  harbor: { A: "#2e3e5a", a: "#1e2a40", C: "#3e5070", c: "#2a3850", D: "#5a6e90", P: "#2a3850", p: "#1c263a" },
  fortress: { A: "#5a2a22", a: "#3e1c16", C: "#6a3a2e", c: "#4a241c", D: "#8a5444", P: "#3a2a24", p: "#261a16" },
};
for (const [k, c] of Object.entries(REBEL_COLORS)) {
  defPal(`rebel_${k}`, { ...basePal, S: "#e2b080", s: "#b8865a", H: "#3a2a1a", h: "#24180c", B: "#2e2618", b: "#4a3e2a", K: "#3a3020", N: c.c, n: c.p, ...c });
  defPal(`elite_${k}`, { ...PALS[`rebel_${k}`], A: "#b02a2a", a: "#781a1a" });
  defPal(`jugg_${k}`, { ...PALS[`rebel_${k}`], A: "#5a6068", a: "#3a4048", C: "#5a6068", c: "#3a4048", D: "#7a8088" });
}
defPal("pow", { ...basePal, S: "#f0c49a", s: "#c89870", H: "#6a4628", h: "#4a2e18", C: "#eae2cc", c: "#c8bea6", D: "#ffffff", P: "#8a6a44", p: "#6a5034", K: "#6a5034" });
defPal("fx", {});

// ---------- Sprite definitions ----------
const SPR = {};
function defSprite(id, rows, ax = 0, ay = 0, meta = {}) {
  const w = Math.max(...rows.map(r => r.length));
  SPR[id] = { rows: rows.map(r => r.padEnd(w, ".")), w, h: rows.length, ax, ay, ...meta };
}
// Rotate a sprite by 90 degrees (dir 1 = counter-clockwise: right-facing becomes up-facing). Exact on pixels.
function rotRows(rows, dir) {
  const h = rows.length, w = rows[0].length, out = [];
  if (dir === 1) for (let x = w - 1; x >= 0; x--) { let s = ""; for (let y = 0; y < h; y++) s += rows[y][x]; out.push(s); }
  else for (let x = 0; x < w; x++) { let s = ""; for (let y = h - 1; y >= 0; y--) s += rows[y][x]; out.push(s); }
  return out;
}
const rotPt = (x, y, w, h, dir) => dir === 1 ? [y, w - 1 - x] : [h - 1 - y, x];

// Heads: neck anchor at (7, 9)
defSprite("h_rayo", [
  "....hhhhh...", "...hHHHHHh..", "..hHHHHHHHh.", "aAAAAAAAAAA.", ".aAhSSSSSSS.",
  "...hSSSSESS.", "...hSSSSSSS.", "....sSSSSSs.", ".....sSSSs..", "......sss..."], 7, 9);
defSprite("h_tania", [
  "....hhhhh...", "...hHHHHHh..", "..hHHHHHHHh.", "..AAAAAAAAA.", "hhhHSSSSSSS.",
  "hHhhSSSSESS.", ".h.hSSSSSSS.", "....sSSSSSs.", ".....sSSSs..", "......sss..."], 7, 9);
defSprite("h_erika", [
  "....AAAAA...", "...AAAAAAA..", "..aAAAAAAAA.", "..aaaaaaaaaa", "..HHSSSSSSS.",
  ".HHHSSSSESS.", ".HHhSSSSSSS.", ".HH.sSSSSSs.", ".H...sSSSs..", "......sss..."], 7, 9);
defSprite("h_fito", [
  "....AAAAA...", "...AAAAAAA..", "..aAAAAAAAA.", "..aaaaaaaaaa", "..hHSSSSSSS.",
  "..hHSSEEEEE.", "..hhSSEGEGE.", "...hsSSSSSs.", ".....sSSSs..", "......sss..."], 7, 9);
defSprite("h_rebel", [
  "....aAAAa...", "...aAAAAAa..", "..aAAAAAAAa.", ".aAAAAAAAAAa", ".aaaaaaaaaaa",
  "...hSSSSESS.", "...hSSSSSSS.", "....sSSSSSs.", ".....sSSSs..", "......sss..."], 7, 9);
defSprite("h_beret", [
  "...AAAAAA...", "..AAAAAAAAa.", ".aAAAAAAAAa.", "..aaaaaaaa..", "...hSSSSSSS.",
  "...hSSSSESS.", "...hSSSSSSS.", "....sSSSSSs.", ".....sSSSs..", "......sss..."], 7, 9);
defSprite("h_pow", [
  "....hhhh....", "...hHHHHh...", "..hHHHHHHh..", "..hHSSSSSS..", "..hHSSSSES..",
  "..HSSSSSSS..", "..HHHHHHHH..", "...HHHHHHH..", "....HHHHH...", "......hh...."], 7, 9);
defSprite("h_jugg", [
  "...aAAAAa...", "..aAAAAAAa..", ".aAAAAAAAAa.", ".aAAAAAAAAAa", ".aAAMMGGGGMa",
  ".aAAMGGGGGM.", "..aAMMMMMMM.", "...aMmMMmM..", "....MMMMM...", ".....mmm...."], 7, 9);

// Torsos: belt anchor (5, 8); neck sits at column 6 of row 0, shoulder at (7, 2)
defSprite("t_hero", [
  "....cCCC..", "...cCCDDC.", "NNNcCCDDCC", "NnNcCCCCCC", "NnNcCCCCCC",
  "NnNcCCcCCC", "NNNcCCCCCC", ".NncCCCCCC", "...KKKKKKK"], 5, 8);
defSprite("t_rebel", [
  "....cCCC..", "...cCCCCC.", "...cCDCCCC", "...cCCCCCC", "...cCKKCCC",
  "...cCKKCCC", "...cCCCCCC", "...cCCCCCC", "...KKKKKKK"], 5, 8);
defSprite("t_pow", [
  "....cCCC..", "...cCCCCC.", "...cCDCCCC", "...cCCCCCC", "...cCCCCCC",
  "...cCCCCCC", "...cCCCCCC", "...cCCCCCC", "...KKKKKKK"], 5, 8);
defSprite("t_jugg", [
  "....aAAAAAa...", "..aAAAAAAAAAa.", ".aAADDDDAAAAAa", "aAAAAAAAAAAAAa", "aAAAaAAAAaAAAa",
  "aAAAAAAAAAAAAa", "aAAAaAAAAaAAAa", "aAAAAAAAAAAAAa", ".aAAAAAAAAAAa.", "..KKKKKKKKKK..", "..KKKYYKKKKK.."], 7, 10);

// Arms: anchor = shoulder, meta.grip = where the hand holds the weapon
defSprite("a_f", ["cCC...", "cCCCSS", ".cc.SS"], 0, 0, { grip: [4, 1] });
defSprite("a_u", [".SS", ".SS", "cCC", "cCC", "cC.", "cC."], 0, 5, { grip: [1, 0] });
defSprite("a_d", ["cC.", "cCC", "cCC", ".CC", ".SS", ".SS"], 0, 0, { grip: [1, 5] });
defSprite("a_throw", ["YY...", "MMS..", "..SC.", "...Cc", "...cC", "....c"], 4, 5);
defSprite("a_knife", ["cCCC......", "cCCCSSWWWW", ".cc.SS...."], 0, 0);
defSprite("a_flail0", ["S...", "SS..", ".C..", ".CC.", "..Cc", "..cc"], 2, 5);
defSprite("a_flail1", ["...S", "..SS", "..C.", ".CC.", "Cc..", "cc.."], 1, 5);
defSprite("a_salute", ["..SS.", ".SS..", ".C...", ".C...", "cC...", "cc..."], 0, 5);
defSprite("a_idle", ["cC", "cC", "cC", "cC", "SS", "SS"], 0, 0);
defSprite("a_hold", ["cC.", "cCC", ".CCS", "..SS"], 0, 0);

// Guns, right-facing; meta.grip = grip pixel, meta.muzzle = muzzle pixel
defSprite("g_pistol", ["MMMMMML", "MmM....", ".mm...."], 1, 1, { muzzle: [7, 0] });
defSprite("g_H", ["..mmmmm.....", "MMMMMMMMMMML", "MmmLLLLLLMMM", "..MM..mm....", "..mm..mm...."], 2, 2, { muzzle: [12, 1] });
defSprite("g_R", ["..VVVVVVVVVVR", "MVVVVVVVVVVVV", "MvvvvvvvvvvvM", "...mm........"], 3, 2, { muzzle: [13, 1] });
defSprite("g_F", ["..OO.......", "MMMMMMMMMRR", "MOOmmmmmmMM", ".OO.mm....."], 2, 2, { muzzle: [11, 1] });
defSprite("g_L", ["..GGGG......", "MMMMMMMMMMGW", "MmmGGGGGGMMG", "..mm........"], 2, 2, { muzzle: [12, 1] });
defSprite("g_S", ["MMMMMMMMMMML", "wwwwMmmmmmmm", "ww.mm......."], 3, 1, { muzzle: [12, 0] });
defSprite("g_rifle", ["....MMMMMMML", "wwwwwMmmm...", "ww..mm......"], 3, 1, { muzzle: [12, 0] });
defSprite("g_bazooka", [".VVVVVVVVVVVVVV.", "MVVVVVVVVVVVVVVM", "MvvvvvvvvvvvvvvM", ".......mm......."], 7, 3, { muzzle: [16, 1] });
defSprite("g_minigun", ["...MMMMMMMMMMM", "..MmLLLLLLLLLm", "MMMMMMMMMMMMMM", "MmmMmLLLLLLLLm", "..mm....MMMMMM"], 3, 2, { muzzle: [14, 2] });
defSprite("g_knife", ["WWWWw"], 0, 0);
for (const id of ["g_pistol", "g_H", "g_R", "g_F", "g_S", "g_L", "g_rifle"]) {
  const s = SPR[id];
  for (const dir of [1, -1]) {
    const tag = dir === 1 ? "_u" : "_d";
    const g = rotPt(s.ax, s.ay, s.w, s.h, dir), m = rotPt(s.muzzle[0], s.muzzle[1], s.w, s.h, dir);
    defSprite(id + tag, rotRows(s.rows, dir), g[0], g[1], { muzzle: m });
  }
}
defSprite("shield", ["LLLL", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LzzZ", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "LZZz", "zzzz"], 0, 19);
// Canopy with risers that run down to the shoulders (anchor bottom middle = harness)
defSprite("chute", [
  "........QQQQQQQQQQ........", ".....QQQQRRQQQQRRQQQQ.....", "...QQQQQRRRQQQQRRRQQQQQ...", ".QQQQQQRRRQQQQQQRRRQQQQQQ.", "QQQQQQRRRRQQQQQQRRRRQQQQQQ", "qqqqqqqqqqqqqqqqqqqqqqqqqq", "..q.....q........q.....q..", "..q.....q........q.....q..", "...q.....q.......q....q...", "....q....q.......q....q...", "....q....q.......q...q....", ".....q...q.......q...q....", "......q...q.....q...q.....", ".......q..q.....q...q.....", ".......q..q.....q..q......", "........q.q.....q..q......", ".........q.q....q.q.......", ".........q.q....q.q.......", "..........qq....qq........"], 13, 18);

// POW tied up, sitting (anchor bottom middle)
defSprite("pow_tied", [
  "....hhhh.....", "...hHHHHh....", "..hHHHHHHh...", "..hHSSSSSS...", "..hHSSSSES...", "..HSSSSSSS...",
  "..HHHHHHHH...", "..cHHHHHHC...", ".cCTTTTTTC...", ".cCCCCCCCC...", ".cTTTTTTTT...", ".cCCCCCCCC...",
  ".PPPPPPPPPPb.", ".pPPPPPPPPBB.", "BB......BBB.."], 5, 14);

// Props and items (fixed colors)
defSprite("crate", [
  "wwwwwwwwwwwwwwww", "wTTTTTTTTTTTTTTw", "wTwuuuuuuuuuuwTw", "wTuwuuuuuuuuwuTw", "wTuuwuuuuuuwuuTw", "wTuuuwuuuuwuuuTw",
  "wTuuuuwuuwuuuuTw", "wTuuuuuwwuuuuuTw", "wTuuuuuwwuuuuuTw", "wTuuuuwuuwuuuuTw", "wTuuuwuuuuwuuuTw", "wTuuwuuuuuuwuuTw",
  "wTuwuuuuuuuuwuTw", "wTwuuuuuuuuuuwTw", "wTTTTTTTTTTTTTTw", "wwwwwwwwwwwwwwww"], 0, 15);
defSprite("crate_gold", [
  "yyyyyyyyyyyyyyyy", "yYYYYYYYYYYYYYYy", "yYyuuuuuuuuuuyYy", "yYuyuuuuuuuuyuYy", "yYuuyuuuuuuyuuYy", "yYuuuyuuuuyuuuYy",
  "yYuuuuyuuyuuuuYy", "yYuuuuuyyuuuuuYy", "yYuuuuuyyuuuuuYy", "yYuuuuyuuyuuuuYy", "yYuuuyuuuuyuuuYy", "yYuuyuuuuuuyuuYy",
  "yYuyuuuuuuuuyuYy", "yYyuuuuuuuuuuyYy", "yYYYYYYYYYYYYYYy", "yyyyyyyyyyyyyyyy"], 0, 15);
defSprite("barrel", [
  "..RRRRRRRR..", ".RQRRRRRRRR.", "RRQRRRRRRRRR", "RQRRRRRRRRrR", "rrrrrrrrrrrr", "RQRRRRRRRRRR", "RQRYYYYYRRrR", "RQYYXXYYYRrR",
  "RQYYXXYYYRrR", "RQRYYYYYRRrR", "RQRRRRRRRRrR", "rrrrrrrrrrrr", "RQRRRRRRRRRR", "RRQRRRRRRRrR", ".RRRRRRRRRR.", "..rrrrrrrr.."], 0, 15);
defSprite("goldbar", ["..YYYYYY", ".YFFYYYy", "YYYYYYyy", "yyyyyyy."], 4, 3);
defSprite("dogtag", [".ZZZZ.", "ZLLLLZ", "ZLzzLZ", "ZLLLLZ", "ZLzzLZ", "ZLLLLZ", ".ZZZZ.", "..z...", ".z...."], 3, 8);
defSprite("vest", [".VV..VV.", "VVVVVVVV", "VvVVVVvV", "VVVYYVVV", "VvVVVVvV", "VVVVVVVV", ".vvvvvv."], 4, 6);
defSprite("food", ["....QQ...", "...QQqQ..", ".uuuQQ...", "uTTTuu...", "uTTTTu...", ".uuuu...."], 4, 5);
defSprite("medal", ["RR.RR", ".RRR.", "..R..", ".yYy.", "yYFYy", "yYYYy", ".yyy."], 2, 6);
defSprite("flag", [
  "LRRRRRRR...", "LRRRRRRRR..", "LRRYYRRRRR.", "LRRYYRRRRR.", "LRRRRRRRR..", "LRRRRRRR...", "L..........",
  "L..........", "L..........", "L..........", "L..........", "L..........", "L..........", "L..........",
  "L..........", "L..........", "L..........", "L..........", "zLz........", "zzzz......."], 1, 19);

// ---------- Procedural legs ----------
const LEG_GRID_W = 22, LEG_GRID_H = 14, LEG_OX = 11, LEG_BY = 13;
const LEG_POSES = {};
function ik(hip, foot, L1, L2) {
  let dx = foot[0] - hip[0], dy = foot[1] - hip[1], d = Math.hypot(dx, dy);
  const maxd = L1 + L2 - 0.05;
  if (d > maxd) { foot = [hip[0] + dx / d * maxd, hip[1] + dy / d * maxd]; dx = foot[0] - hip[0]; dy = foot[1] - hip[1]; d = maxd; }
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  let px = -dy / d, py = dx / d;
  if (px < 0) { px = -px; py = -py; }
  return [[hip[0] + dx * a / d + px * h, hip[1] + dy * a / d + py * h], foot];
}
function legRows(hipY, near, far) {
  const grid = Array.from({ length: LEG_GRID_H }, () => Array(LEG_GRID_W).fill("."));
  const plot = (x, y, ch) => {
    const c = Math.round(LEG_OX + x), r = Math.round(LEG_BY - y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const rr = r + dy, cc = c + dx;
      if (rr >= 0 && rr < LEG_GRID_H && cc >= 0 && cc < LEG_GRID_W) grid[rr][cc] = ch;
    }
  };
  const seg = (a, b, ch) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2) + 1; for (let i = 0; i <= n; i++) plot(lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n), ch); };
  const boot = f => {
    const c = Math.round(LEG_OX + f[0]), r = Math.round(LEG_BY - f[1]);
    for (let x = -1; x <= 1; x++) if (grid[r - 1]?.[c + x] !== undefined) grid[r - 1][c + x] = "b";
    for (let x = -1; x <= 3; x++) if (grid[r]?.[c + x] !== undefined) grid[r][c + x] = "B";
  };
  const hip = [0, hipY];
  for (const [leg, ch] of [[far, "p"], [near, "P"]]) {
    const [knee, foot] = leg.knee ? [leg.knee, leg.foot] : ik(hip, leg.foot, 5.5, 5);
    seg(hip, knee, ch); seg(knee, foot, ch); boot(foot);
  }
  return grid.map(r => r.join(""));
}
function defLegs(id, hipY, near, far) { defSprite(id, legRows(hipY, near, far), LEG_OX, LEG_BY, { hipY }); LEG_POSES[id] = hipY; }
defLegs("l_stand", 10, { foot: [2, 0] }, { foot: [-2, 0] });
for (let i = 0; i < 8; i++) {
  const ph = i / 8 * TAU, hipY = 9 + Math.round((1 - Math.cos(2 * ph)) / 2);
  const leg = th => ({ foot: [4.6 * Math.cos(th), Math.max(0, -Math.sin(th)) * 4] });
  defLegs("l_run" + i, hipY, leg(ph), leg(ph + Math.PI));
}
defLegs("l_jump", 10, { foot: [2.5, 4] }, { foot: [-3, 3] });
defLegs("l_fall", 10, { foot: [1.5, 0.5] }, { foot: [-2.5, 1.5] });
defLegs("l_crouch", 5, { foot: [4, 0] }, { knee: [-2, 1], foot: [-6.5, 1] });
defLegs("l_sit", 3, { knee: [4, 5], foot: [7, 0] }, { knee: [3, 4], foot: [6, 0] });

// ---------- Baking ----------
const bakeCache = new Map();
function bake(id, palKey = "fx") {
  const key = id + "|" + palKey;
  let c = bakeCache.get(key);
  if (c) return c;
  const s = SPR[id], pal = PALS[palKey] || {};
  c = document.createElement("canvas"); c.width = s.w; c.height = s.h;
  const x = c.getContext("2d"), img = x.createImageData(s.w, s.h);
  for (let r = 0; r < s.h; r++) for (let q = 0; q < s.w; q++) {
    const ch = s.rows[r][q];
    if (ch === ".") continue;
    const [R, G, B] = hexRgb(pal[ch] || FIXED[ch] || "#ff00ff");
    const o = (r * s.w + q) * 4;
    img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  bakeCache.set(key, c);
  return c;
}
// Draw a sprite straight onto the buffer (no outline), anchor at (x, y) screen px, optional flip
function spr(id, x, y, palKey = "fx", flip = false) {
  const s = SPR[id], c = bake(id, palKey);
  if (!flip) g.drawImage(c, Math.round(x - s.ax), Math.round(y - s.ay));
  else { g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1); g.drawImage(c, -s.ax, Math.round(y - s.ay)); g.restore(); }
}

// ---------- Composite + outline ----------
// Local coordinates: x right, y up, (0,0) = bottom row of the feet. Scratch pixel = (CX + x, BY - y).
const COMP_W = 72, COMP_H = 84, CX = 36, BY = 76;
const comp = document.createElement("canvas"); comp.width = COMP_W; comp.height = COMP_H;
const cg = comp.getContext("2d");
const sil = document.createElement("canvas"); sil.width = COMP_W; sil.height = COMP_H;
const sg = sil.getContext("2d");
function compBegin() { cg.clearRect(0, 0, COMP_W, COMP_H); }
function compPart(id, palKey, lx, ly) {
  const s = SPR[id];
  cg.drawImage(bake(id, palKey), Math.round(CX + lx - s.ax), Math.round(BY - ly - s.ay));
}
function tintSil(src, w, h, color) {
  sg.globalCompositeOperation = "source-over"; sg.clearRect(0, 0, w, h); sg.drawImage(src, 0, 0);
  sg.globalCompositeOperation = "source-in"; sg.fillStyle = color; sg.fillRect(0, 0, w, h);
  sg.globalCompositeOperation = "source-over";
}
// Blit the scratch with a 1px outline. (sx, sy) = screen pixel of local (0,0); rot = quarter turns.
// mode: "normal" | "flash" (white) | "burn" (charred)
function compBlit(sx, sy, face = 1, o = {}) {
  const mode = o.mode || "normal";
  tintSil(comp, COMP_W, COMP_H, o.outline || OUTLINE);
  g.save();
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  g.translate(Math.round(sx), Math.round(sy));
  if (face < 0) g.scale(-1, 1);
  if (o.rot) g.rotate(o.rot * Math.PI / 2);
  const ox = -CX, oy = -BY;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.drawImage(sil, ox + dx, oy + dy);
  if (mode === "normal") g.drawImage(comp, ox, oy);
  else { tintSil(comp, COMP_W, COMP_H, mode === "flash" ? "#ffffff" : "#2a1a14"); g.drawImage(sil, ox, oy); }
  g.restore();
}

// Leg frame for a pose
function legsFor(pose, t) {
  if (pose === "run") return "l_run" + (Math.floor(t * 12) % 8);
  return { stand: "l_stand", jump: "l_jump", fall: "l_fall", crouch: "l_crouch", sit: "l_sit" }[pose] || "l_stand";
}
// Shoulder point (local) for a pose
function shoulderOf(pose, t, bob = 0) { const hipY = SPR[legsFor(pose, t)].hipY; return [2, hipY + 7 + bob]; }
// Muzzle point (local) for a soldier pose: aim f|u|d, gun id suffix
function muzzleOf(pose, t, aim, gun) {
  const [shx, shy] = shoulderOf(pose, t);
  const arm = SPR[aim === "u" ? "a_u" : aim === "d" ? "a_d" : "a_f"];
  const hx = shx + arm.grip[0] - arm.ax, hy = shy - (arm.grip[1] - arm.ay);
  const gs = SPR["g_" + gun + (aim === "u" ? "_u" : aim === "d" ? "_d" : "")];
  if (!gs) return [hx + 6, hy];
  return [hx + gs.muzzle[0] - gs.ax, hy - (gs.muzzle[1] - gs.ay)];
}

// Assemble a soldier. o: pal, head, torso, pose, t, arm (f|u|d|throw|knife|flail|salute|idle|bazooka|shield|none), gun, chute
function composeSoldier(o) {
  compBegin();
  const pal = o.pal, pose = o.pose || "stand", t = o.t || 0;
  const legs = legsFor(pose, t), hipY = SPR[legs].hipY;
  const bob = o.bob ? (Math.sin(t * 4) > 0.6 ? 1 : 0) : 0;
  const tx = 0, ty = hipY + 1 + bob;                       // torso belt
  const torso = o.torso || "t_rebel", head = o.head || "h_rebel";
  const sh = [2, ty + 6];                                   // shoulder
  if (o.chute) compPart("chute", "fx", 0, ty + 7);
  compPart(legs, pal, 0, 0);
  compPart(torso, pal, tx, ty);
  if (o.arm === "bazooka") compPart("g_bazooka", "fx", sh[0], sh[1] + 2);
  compPart(head, pal, tx + 1, ty + 8);
  const arm = o.arm || "none";
  if (arm === "f" || arm === "u" || arm === "d") {
    const a = SPR[arm === "u" ? "a_u" : arm === "d" ? "a_d" : "a_f"];
    const hx = sh[0] + a.grip[0] - a.ax, hy = sh[1] - (a.grip[1] - a.ay);
    const gid = "g_" + (o.gun || "pistol") + (arm === "u" ? "_u" : arm === "d" ? "_d" : "");
    if (SPR[gid]) compPart(gid, "fx", hx + (o.recoil ? (arm === "f" ? -1 : 0) : 0), hy - (o.recoil && arm === "u" ? 1 : 0));
    compPart(arm === "u" ? "a_u" : arm === "d" ? "a_d" : "a_f", pal, sh[0], sh[1]);
  } else if (arm === "knife") compPart("a_knife", pal, sh[0], sh[1]);
  else if (arm === "throw") compPart("a_throw", pal, sh[0], sh[1]);
  else if (arm === "flail") compPart(Math.floor(t * 10) % 2 ? "a_flail1" : "a_flail0", pal, sh[0], sh[1] + 4);
  else if (arm === "salute") compPart("a_salute", pal, sh[0], sh[1] + 4);
  else if (arm === "idle") compPart("a_idle", pal, sh[0] - 1, sh[1]);
  else if (arm === "bazooka" || arm === "shield" || arm === "hold") compPart("a_hold", pal, sh[0], sh[1]);
  else if (arm === "knifeIdle") { compPart("a_idle", pal, sh[0] - 1, sh[1]); compPart("g_knife", "fx", sh[0] - 1, sh[1] - 6); }
  else if (arm === "minigun") { compPart("g_minigun", "fx", sh[0] + 2, sh[1] - 1); compPart("a_f", pal, sh[0], sh[1]); }
  if (arm === "shield") compPart("shield", "fx", 7 + (o.poke ? 3 : 0), 1);
}
function drawSoldier(o, sx, sy, face, blit = {}) { composeSoldier(o); compBlit(sx, sy, face, blit); }

// ---------- Procedural big sprites (vehicles, bosses) with outline ----------
const procPool = new Map();
function procCanvas(w, h) {
  const key = w + "x" + h;
  let p = procPool.get(key);
  if (!p) { const c = document.createElement("canvas"); c.width = w; c.height = h; p = { c, g: c.getContext("2d"), s: document.createElement("canvas") }; p.s.width = w; p.s.height = h; p.sg = p.s.getContext("2d"); procPool.set(key, p); }
  p.g.clearRect(0, 0, w, h);
  return p;
}
// Rect helper in a procedural canvas
function PR(ctx, X, Y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(X), Math.round(Y), Math.round(w), Math.round(h)); }
// Blit a procedural canvas with outline; (sx, sy) = screen top-left; flip mirrors around the canvas center
function procBlit(p, sx, sy, o = {}) {
  const w = p.c.width, h = p.c.height;
  p.sg.globalCompositeOperation = "source-over"; p.sg.clearRect(0, 0, w, h); p.sg.drawImage(p.c, 0, 0);
  p.sg.globalCompositeOperation = "source-in"; p.sg.fillStyle = OUTLINE; p.sg.fillRect(0, 0, w, h); p.sg.globalCompositeOperation = "source-over";
  g.save();
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  g.translate(Math.round(sx), Math.round(sy));
  if (o.flip) { g.translate(w, 0); g.scale(-1, 1); }
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.drawImage(p.s, dx, dy);
  g.drawImage(p.c, 0, 0);
  if (o.flash) { p.sg.globalCompositeOperation = "source-in"; p.sg.fillStyle = "#ffffff"; p.sg.fillRect(0, 0, w, h); p.sg.globalCompositeOperation = "source-over"; g.globalAlpha *= 0.5; g.drawImage(p.s, 0, 0); }
  g.restore();
}
// Pixel-crisp filled circle (no anti-aliasing) on any context
function pcirc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy); r = Math.max(0.5, r);
  for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    if (r * r - y * y < 0) continue;
    ctx.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}
