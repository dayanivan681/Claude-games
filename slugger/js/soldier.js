"use strict";
// HD soldiers: every soldier (hero, rebels, POWs, the juggernaut) is drawn from a small 2D skeleton at
// twice the world's pixel density, with shaded limbs, a rounded helmet or headgear, faces, two-handed
// weapons and a 1px outline. Poses are cached as bitmaps, so a frame only blits them. Keeps the same
// drawSoldier(o, sx, sy, face, blit) entry point as the old part-based sprites.

const HD = 2;                                           // soldier pixels per world pixel
const SW = COMP_W * HD, SH = COMP_H * HD, SCX = CX * HD, SBY = BY * HD;
const hdImg = new ImageData(SW, SH), hdPix = new Uint32Array(hdImg.data.buffer);
const hdScratch = document.createElement("canvas"); hdScratch.width = SW; hdScratch.height = SH;
const hdScratchG = hdScratch.getContext("2d");
const hdCache = new Map();
const LIGHT = [-0.55, 0.83];                            // light from the upper left (x right, y up)

const packCache = new Map();
function pack(hex) {
  let v = packCache.get(hex);
  if (v === undefined) { const [r, gg, b] = hexRgb(hex); v = (255 << 24 | b << 16 | gg << 8 | r) >>> 0; packCache.set(hex, v); }
  return v;
}
const rampCache = new Map();
function ramp(hex, k = 0) {   // [shadow, dark, base, light] packed; k darkens the whole ramp (far limbs)
  const key = hex + k;
  let r = rampCache.get(key);
  if (!r) { const b = k ? shade(hex, k) : hex; r = [pack(shade(b, -0.42)), pack(shade(b, -0.2)), pack(b), pack(shade(b, 0.22))]; rampCache.set(key, r); }
  return r;
}
function tone(r, nx, ny) { const d = nx * LIGHT[0] + ny * LIGHT[1]; return r[d > 0.5 ? 3 : d > 0.02 ? 2 : d > -0.5 ? 1 : 0]; }

// ---- raster helpers (local coords: x right, y up, origin between the feet) ----
function hp(x, y, c) { const px = Math.round(SCX + x), py = Math.round(SBY - y); if (px >= 0 && py >= 0 && px < SW && py < SH) hdPix[py * SW + px] = c; }
function disc(cx, cy, r, rp) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy > r * r + 0.3) continue;
    hp(x, y, Array.isArray(rp) ? tone(rp, dx / r, dy / r) : rp);
  }
}
function capsule(ax, ay, bx, by, r, rp) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
  for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.ceil(Math.max(ay, by) + r); y++)
    for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.ceil(Math.max(ax, bx) + r); x++) {
      const t = clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1), dx = x - (ax + vx * t), dy = y - (ay + vy * t);
      if (dx * dx + dy * dy > r * r + 0.25) continue;
      hp(x, y, tone(rp, dx / r, dy / r));
    }
}
function box(x0, y0, x1, y1, rp) {   // axis-aligned, lit from the top
  for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++)
    hp(x, y, y >= Math.round(y1) ? rp[3] : y <= Math.round(y0) ? rp[0] : x <= Math.round(x0) ? rp[1] : rp[2]);
}
function bend(a, b, L1, L2, down) {   // two-bone IK; down = elbow/knee below the line, else in front
  let dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 0.01;
  const maxd = L1 + L2 - 0.05;
  if (d > maxd) { b = [a[0] + dx / d * maxd, a[1] + dy / d * maxd]; dx = b[0] - a[0]; dy = b[1] - a[1]; d = maxd; }
  const p = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - p * p));
  let nx = -dy / d, ny = dx / d;
  if (down ? ny > 0 : nx < 0) { nx = -nx; ny = -ny; }
  return [[a[0] + dx * p / d + nx * h, a[1] + dy * p / d + ny * h], b];
}

// ---- skeleton ----
function skeleton(pose, t, bob) {
  const s = { lean: 0 };
  if (pose === "run") {
    const ph = (Math.floor(t * 12 * 1.5) % 12) / 12 * TAU;
    s.hip = [0, 17.5 + (1 - Math.cos(2 * ph)) * 1.2]; s.lean = 2;
    const foot = th => [9.5 * Math.cos(th), Math.max(0, -Math.sin(th)) * 8];
    s.near = { foot: foot(ph) }; s.far = { foot: foot(ph + Math.PI) };
    s.swing = Math.cos(ph);
  } else if (pose === "jump") { s.hip = [0, 19]; s.near = { foot: [6, 9] }; s.far = { foot: [-6, 6] }; }
  else if (pose === "fall") { s.hip = [0, 19]; s.near = { foot: [3, 1] }; s.far = { foot: [-6, 4] }; }
  else if (pose === "crouch") { s.hip = [0, 10]; s.near = { foot: [9, 0] }; s.far = { knee: [-3, 1.5], foot: [-13, 1.5] }; s.lean = 1; }
  else if (pose === "sit") { s.hip = [0, 6]; s.near = { knee: [8, 11], foot: [14, 0] }; s.far = { knee: [6, 9], foot: [12, 0] }; }
  else { s.hip = [0, 19 + bob]; s.near = { foot: [4, 0] }; s.far = { foot: [-4, 0] }; }
  const hx = s.hip[0], hy = s.hip[1];
  s.shoulder = [1 + s.lean, hy + 13]; s.fshoulder = [-2 + s.lean, hy + 13];
  s.head = [2.5 + s.lean * 1.2, hy + 23];   // big head, short legs: Metal Slug proportions
  return s;
}

// ---- weapons (hi px, grip at 0,0, x forward, y up): [x0, y0, x1, y1, color] ----
const GUNS = {
  pistol: { r: [[-1, 0, 8, 3, "#34343e"], [0, 3, 9, 4, "#565664"], [-1, -4, 2, 0, "#34343e"]], m: [9, 3], one: true },
  H: { r: [[-7, -1, -1, 3, "#34343e"], [-1, -1, 12, 4, "#34343e"], [0, 4, 10, 5, "#565664"], [12, 1, 21, 3, "#9c9cac"], [3, -6, 7, -1, "#565664"], [13, 0, 15, 4, "#34343e"]], m: [21, 2] },
  rifle: { r: [[-8, -1, -1, 2, "#6a4520"], [-1, 0, 11, 3, "#34343e"], [11, 1, 20, 2, "#34343e"], [3, -4, 6, 0, "#565664"]], m: [20, 1.5] },
  R: { r: [[-9, 0, 17, 5, "#5d6b32"], [15, -1, 18, 6, "#3e4822"], [-10, 1, -8, 4, "#3e4822"], [2, 5, 5, 7, "#34343e"], [1, -4, 3, 0, "#34343e"]], m: [18, 2.5] },
  F: { r: [[-2, 0, 14, 4, "#34343e"], [14, 1, 19, 3, "#c83a2a"], [0, -6, 8, 0, "#ff8a1a"], [1, 4, 11, 5, "#565664"]], m: [19, 2] },
  S: { r: [[-8, -1, -1, 2, "#6a4520"], [-1, 0, 7, 3, "#34343e"], [7, 1, 19, 3, "#565664"], [9, -2, 14, 0, "#a8743a"]], m: [19, 2] },
  L: { r: [[-3, -1, 12, 4, "#34343e"], [1, 1, 10, 3, "#8fd0e8"], [12, 0, 16, 4, "#9c9cac"], [16, 1, 17, 3, "#e6f6ff"], [2, -5, 5, -1, "#565664"]], m: [17, 2] },
  minigun: { r: [[-4, -3, 10, 5, "#34343e"], [10, -2, 26, 0, "#9c9cac"], [10, 1, 26, 3, "#9c9cac"], [0, -8, 8, -3, "#565664"], [24, -3, 27, 4, "#34343e"]], m: [27, 0] },
};
const rot = (aim, x, y) => aim === "u" ? [-y, x] : aim === "d" ? [y, -x] : [x, y];
function drawGun(id, gx, gy, aim) {
  const G = GUNS[id] || GUNS.pistol;
  for (const [x0, y0, x1, y1, c] of G.r) {
    const a = rot(aim, x0, y0), b = rot(aim, x1, y1);
    box(gx + Math.min(a[0], b[0]), gy + Math.min(a[1], b[1]), gx + Math.max(a[0], b[0]), gy + Math.max(a[1], b[1]), ramp(c));
  }
}
function gripFor(sk, aim, recoil, gun) {
  const s = sk.shoulder, k = recoil ? 2 : 0;
  if (aim === "u") return [s[0] + 3, s[1] + 8 - k];
  if (aim === "d") return [s[0] + 4, s[1] - 9 + k];
  return [s[0] + 9 - k, s[1] - 1];
}
// Muzzle in world px relative to the feet (x forward); shoot() spawns bullets here
function muzzleOf(pose, t, aim, gun) {
  const sk = skeleton(pose, t, 0), gp = gripFor(sk, aim, false, gun), m = (GUNS[gun] || GUNS.pistol).m, r = rot(aim, m[0], m[1]);
  return [(gp[0] + r[0]) / HD, (gp[1] + r[1]) / HD];
}

// ---- heads ----
function drawHead(id, pal, hx, hy, panic) {
  const skin = ramp(pal.S || "#e2b080"), hair = ramp(pal.H || "#3a2a1a"), gear = ramp(pal.A || "#66733a");
  capsule(hx - 1.5, hy - 8, hx - 0.5, hy - 5, 2.8, skin);           // neck
  if (id === "h_jugg") {
    disc(hx, hy, 8.5, gear); box(hx + 1, hy - 3, hx + 8, hy + 1, ramp("#34343e")); box(hx + 2, hy - 2, hx + 7, hy, ramp("#8fd0e8"));
    box(hx - 7, hy - 7, hx + 7, hy - 5, ramp(pal.A || "#5a6068", -0.15)); return;
  }
  disc(hx, hy, 8.4, skin);                                            // skull + face
  disc(hx - 5, hy - 0.5, 2, ramp(pal.s || "#c08050"));              // ear
  // face (facing right): big white eye with pupil, brow, nose, mouth
  const E = pack("#1a1010"), Wt = pack("#ffffff");
  hp(hx + 3, hy - 1, Wt); hp(hx + 4, hy - 1, Wt); hp(hx + 3, hy, Wt); hp(hx + 4, hy, Wt); hp(hx + 5, hy, E); hp(hx + 5, hy - 1, E); hp(hx + 4, hy + 1, Wt);
  for (let i = 2; i <= 6; i++) hp(hx + i, hy + 2, pack(shade(pal.H || "#3a2a1a", -0.25)));
  hp(hx + 8, hy - 2, skin[1]); hp(hx + 8, hy - 1, skin[2]); hp(hx + 8, hy - 3, skin[0]);
  if (panic) { box(hx + 3, hy - 6, hx + 6, hy - 3, ramp("#5a0a0a")); hp(hx + 4, hy - 4, pack("#ffffff")); }
  else { hp(hx + 3, hy - 5, skin[0]); hp(hx + 4, hy - 5, skin[0]); hp(hx + 5, hy - 5, skin[0]); }
  if (id === "h_rebel" || id === "h_jugg") {                          // rounded helmet with brim and strap
    for (let y = 0; y <= 10; y++) for (let x = -10; x <= 10; x++) { if (x * x + y * y * 1.2 <= 108) hp(hx + x, hy + 2 + y, tone(gear, x / 10, y / 9)); }
    box(hx - 10, hy + 1, hx + 12, hy + 2, ramp(pal.A || "#66733a", -0.18));   // round helmet + brim
    hp(hx - 3, hy - 1, gear[0]); hp(hx - 3, hy - 2, gear[0]); hp(hx - 2, hy - 3, gear[0]); hp(hx - 1, hy - 4, gear[0]);
  } else if (id === "h_beret") {
    for (let y = 0; y <= 5; y++) for (let x = -8; x <= 7; x++) { if (x * x / 64 + y * y / 30 <= 1) hp(hx + x - 1, hy + 3 + y, tone(gear, x / 8, y / 5)); }
    box(hx - 7, hy + 2, hx + 6, hy + 3, ramp(pal.A || "#b02a2a", -0.25));
  } else if (id === "h_pow") {
    for (let y = 2; y <= 8; y++) for (let x = -7; x <= 4; x++) if (x * x + (y - 2) * (y - 2) <= 40) hp(hx + x, hy + y, tone(hair, x / 7, (y - 2) / 6));
    for (let y = -8; y <= -1; y++) for (let x = -2; x <= 7; x++) if ((x - 2.5) * (x - 2.5) / 22 + (y + 3) * (y + 3) / 22 <= 1) hp(hx + x, hy + y, tone(hair, (x - 2.5) / 5, (y + 3) / 5));   // beard
    hp(hx + 4, hy + 1, pack("#1a1010"));
  } else {
    // heroes: hair + their signature headgear
    for (let y = 2; y <= 9; y++) for (let x = -9; x <= 6; x++) if (x * x + (y - 1) * (y - 1) <= 66) hp(hx + x, hy + y, tone(hair, x / 8, (y - 1) / 8));
    if (id === "h_rayo") { box(hx - 7, hy + 3, hx + 6, hy + 5, gear); capsule(hx - 8, hy + 4, hx - 13, hy + 1, 1.2, gear); capsule(hx - 8, hy + 4, hx - 12, hy - 1, 1, gear); }
    else if (id === "h_tania") { box(hx - 7, hy + 3, hx + 6, hy + 4, gear); capsule(hx - 7, hy + 2, hx - 11, hy - 6, 2, hair); }
    else if (id === "h_erika") { for (let y = 4; y <= 9; y++) for (let x = -8; x <= 6; x++) if (x * x / 64 + (y - 4) * (y - 4) / 30 <= 1) hp(hx + x, hy + y, tone(gear, x / 8, (y - 4) / 5)); box(hx, hy + 3, hx + 10, hy + 4, ramp(pal.A, -0.2)); capsule(hx - 7, hy + 1, hx - 9, hy - 6, 2, hair); }
    else if (id === "h_fito") { for (let y = 4; y <= 9; y++) for (let x = -8; x <= 6; x++) if (x * x / 64 + (y - 4) * (y - 4) / 30 <= 1) hp(hx + x, hy + y, tone(gear, x / 8, (y - 4) / 5)); box(hx, hy + 3, hx + 10, hy + 4, ramp(pal.A, -0.2)); box(hx + 1, hy, hx + 7, hy + 2, ramp("#1a1a24")); hp(hx + 5, hy + 1, pack("#8fd0e8")); }
  }
}

// ---- full soldier ----
function renderSoldier(o) {
  hdPix.fill(0);
  const pal = PALS[o.pal] || PALS.rebel_desert, pose = o.pose || "stand", t = o.t || 0;
  const bob = o.bob ? (Math.sin(t * 4) > 0.6 ? 1 : 0) : 0;
  const sk = skeleton(pose, t, bob), hip = sk.hip, arm = o.arm || "none";
  const jugg = o.torso === "t_jugg", hero = o.torso === "t_hero";
  const shirt = ramp(pal.C || "#7f8c46"), shirtFar = ramp(pal.C || "#7f8c46", -0.18);
  const pants = ramp(pal.P || "#6b7738"), pantsFar = ramp(pal.P || "#6b7738", -0.18);
  const boots = ramp(pal.B || "#3a2414"), skin = ramp(pal.S || "#e2b080");
  const leg = (L, rp, far) => {
    const [knee, foot] = L.knee ? [L.knee, L.foot] : bend(hip, L.foot, 9.6, 9.4, false);
    capsule(hip[0], hip[1], knee[0], knee[1], jugg ? 4.5 : 3.8, rp);
    capsule(knee[0], knee[1], foot[0], foot[1] + 3, jugg ? 4 : 3.2, rp);
    const bt = far ? ramp(pal.B || "#3a2414", -0.15) : boots;
    box(foot[0] - 3.5, foot[1], foot[0] + 6, foot[1] + 4.5, bt); box(foot[0] - 2.5, foot[1] + 4.5, foot[0] + 2.5, foot[1] + 6, bt);   // big boot + cuff
    box(foot[0] - 3.5, foot[1], foot[0] + 6, foot[1], ramp("#1a1210"));
  };
  const gunId = arm === "minigun" ? "minigun" : o.gun || "pistol";
  const aim = arm === "u" || arm === "d" ? arm : "f";
  const armed = arm === "f" || arm === "u" || arm === "d" || arm === "minigun";
  const grip = armed ? (arm === "minigun" ? [sk.shoulder[0] + 6, sk.shoulder[1] - 7] : gripFor(sk, aim, o.recoil, gunId)) : null;
  const limb = (sh, hand, rp, down = true) => {
    const [el, h] = bend(sh, hand, 6.8, 6.4, down);
    capsule(sh[0], sh[1], el[0], el[1], 3, rp); capsule(el[0], el[1], h[0], h[1], 2.6, rp); disc(h[0], h[1], 2.6, skin);
  };
  if (o.chute) blit2("chute", "fx", 0, hip[1] / HD + 8);
  // back arm: supports two-handed guns, or swings / waves
  const fs = sk.fshoulder;
  if (armed && !(GUNS[gunId] || GUNS.pistol).one) { const f = rot(aim, 8, 0); limb(fs, [grip[0] + f[0], grip[1] + f[1]], shirtFar); }
  else if (arm === "flail") limb(fs, [fs[0] - 3, fs[1] + 11 - (Math.floor(t * 10) % 2) * 2], shirtFar);
  else if (arm === "tied") limb(fs, [fs[0] - 5, fs[1] - 9], shirtFar);
  else if (pose === "run") limb(fs, [fs[0] - 6 * (sk.swing || 0), fs[1] - 9], shirtFar);
  else if (pose !== "sit") limb(fs, [fs[0] - 1, fs[1] - 11], shirtFar);
  // pack, legs, torso
  if (hero || o.torso === "t_rebel") box(hip[0] - 8 + sk.lean, hip[1] + 3, hip[0] - 3 + sk.lean, hip[1] + 12, ramp(pal.N || "#6d6a3a"));
  leg(sk.far, pantsFar, true);
  if (jugg) { capsule(hip[0], hip[1] + 2, sk.shoulder[0], sk.shoulder[1] - 1, 9, ramp(pal.A || "#5a6068")); box(hip[0] - 6, hip[1] + 4, hip[0] + 7, hip[1] + 6, ramp(pal.D || "#7a8088")); }
  else {
    capsule(hip[0], hip[1] + 2, sk.shoulder[0], sk.shoulder[1] - 1, 7, shirt);
    capsule(hip[0] + 1.5, hip[1] + 4, sk.shoulder[0] + 1.5, sk.shoulder[1] - 2, 3.5, ramp(pal.D || shade(pal.C || "#7f8c46", 0.15)));   // chest highlight
    if (hero || o.torso === "t_rebel") { capsule(sk.shoulder[0] - 4, sk.shoulder[1], hip[0] + 5, hip[1] + 3, 1, ramp(pal.c || "#5c6830", -0.1)); }   // strap
    box(hip[0] + 2, hip[1] + 6, hip[0] + 5, hip[1] + 8, ramp(pal.c || "#5c6830"));   // pocket
  }
  box(hip[0] - 6, hip[1], hip[0] + 6, hip[1] + 2, ramp(pal.K || "#5a3a1a"));        // belt
  hp(hip[0] + 2, hip[1] + 1, pack("#e8c050"));
  leg(sk.near, pants, false);
  drawHead(o.head || "h_rebel", pal, sk.head[0], sk.head[1], arm === "flail");
  // front arm + weapon
  const s = sk.shoulder;
  if (arm === "bazooka") { box(s[0] - 12, s[1] + 1, s[0] + 14, s[1] + 6, ramp("#5d6b32")); box(s[0] + 12, s[1], s[0] + 15, s[1] + 7, ramp("#3e4822")); limb(s, [s[0] + 6, s[1] - 1], shirt); }
  else if (armed) { drawGun(gunId, grip[0], grip[1], aim); limb(s, grip, shirt); }
  else if (arm === "knife") { limb(s, [s[0] + 11, s[1]], shirt); box(s[0] + 12, s[1], s[0] + 20, s[1] + 1, ramp("#e8e8f0")); box(s[0] + 9, s[1] - 1, s[0] + 12, s[1] + 1, ramp("#6a4520")); }
  else if (arm === "knifeIdle") { limb(s, [s[0] + 2, s[1] - 10], shirt); box(s[0] + 2, s[1] - 18, s[0] + 3, s[1] - 11, ramp("#e8e8f0")); }
  else if (arm === "throw") { limb(s, [s[0] - 6, s[1] + 8], shirt); disc(s[0] - 7, s[1] + 11, 2.5, ramp("#5d6b32")); }
  else if (arm === "flail") limb(s, [s[0] + 3, s[1] + 10 + (Math.floor(t * 10) % 2) * 2], shirt);
  else if (arm === "salute") limb(s, [sk.head[0] + 5, sk.head[1] + 2], shirt);
  else if (arm === "idle") limb(s, pose === "run" ? [s[0] + 6 * (sk.swing || 0), s[1] - 9] : [s[0] + 1, s[1] - 11], shirt);
  else if (arm === "hold" || arm === "shield") limb(s, [s[0] + 8, s[1] - 4], shirt);
  else if (arm === "tied") { limb(s, [s[0] - 4, s[1] - 9], shirt); box(s[0] - 7, s[1] - 10, s[0] - 2, s[1] - 9, ramp("#c8a45a")); }
  if (arm === "shield") { box(14 + (o.poke ? 6 : 0), 2, 22 + (o.poke ? 6 : 0), 42, ramp("#7a7a82")); box(16 + (o.poke ? 6 : 0), 20, 20 + (o.poke ? 6 : 0), 24, ramp("#ffd34d")); }
  // 1px outline around the whole silhouette
  const OUT = pack(OUTLINE);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = y * SW + x;
    if (hdPix[i]) continue;
    if ((x > 0 && hdPix[i - 1] && hdPix[i - 1] !== OUT) || (x < SW - 1 && hdPix[i + 1] && hdPix[i + 1] !== OUT) ||
        (y > 0 && hdPix[i - SW] && hdPix[i - SW] !== OUT) || (y < SH - 1 && hdPix[i + SW] && hdPix[i + SW] !== OUT)) hdPix[i] = OUT;
  }
  const cv = document.createElement("canvas"); cv.width = SW; cv.height = SH;
  cv.getContext("2d").putImageData(hdImg, 0, 0);
  return cv;
}
// copy an old 1x sprite into the HD image at 2x (used for the parachute canopy)
function blit2(id, palKey, lx, ly) {
  const s = SPR[id], pal = PALS[palKey] || {};
  for (let r = 0; r < s.h; r++) for (let q = 0; q < s.w; q++) {
    const ch = s.rows[r][q]; if (ch === ".") continue;
    const c = pack(pal[ch] || FIXED[ch]), x0 = (lx - s.ax + q) * HD, y0 = (ly + s.ay - r) * HD;
    for (let dy = 0; dy < HD; dy++) for (let dx = 0; dx < HD; dx++) hp(x0 + dx, y0 - dy, c);
  }
}

function soldierKey(o) {
  const pose = o.pose || "stand", t = o.t || 0;
  const fr = pose === "run" ? Math.floor(t * 12 * 1.5) % 12 : 0;
  const arm = o.arm || "none", flail = arm === "flail" ? Math.floor(t * 10) % 2 : 0;
  const bob = o.bob ? (Math.sin(t * 4) > 0.6 ? 1 : 0) : 0;
  return `${o.pal}|${o.head}|${o.torso}|${pose}|${fr}|${arm}|${o.gun}|${o.recoil ? 1 : 0}|${bob}|${o.chute ? 1 : 0}|${o.poke ? 1 : 0}|${flail}`;
}
function drawSoldier(o, sx, sy, face, blit = {}) {
  const key = soldierKey(o);
  let cv = hdCache.get(key);
  if (!cv) { cv = renderSoldier(o); hdCache.set(key, cv); if (hdCache.size > 700) hdCache.delete(hdCache.keys().next().value); }
  const mode = blit.mode || "normal";
  let src = cv;
  if (mode !== "normal") {
    hdScratchG.globalCompositeOperation = "source-over"; hdScratchG.clearRect(0, 0, SW, SH); hdScratchG.drawImage(cv, 0, 0);
    hdScratchG.globalCompositeOperation = "source-atop"; hdScratchG.fillStyle = mode === "flash" ? "rgba(255,255,255,0.85)" : "rgba(42,26,20,0.9)"; hdScratchG.fillRect(0, 0, SW, SH);
    hdScratchG.globalCompositeOperation = "source-over"; src = hdScratch;
  }
  g.save();
  if (blit.alpha !== undefined) g.globalAlpha = blit.alpha;
  g.translate(Math.round(sx), Math.round(sy));
  if (face < 0) g.scale(-1, 1);
  if (blit.rot) g.rotate(blit.rot * Math.PI / 2);
  g.drawImage(src, -CX, -BY, COMP_W, COMP_H);
  g.restore();
}
