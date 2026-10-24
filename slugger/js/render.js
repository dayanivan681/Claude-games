"use strict";
// Rendering: a low-res buffer scaled up by an exact integer (crisp pixels on every screen),
// pre-rendered parallax layers, all world objects, night lighting and weather.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const buf = document.createElement("canvas");
const g = buf.getContext("2d");
let OX = 0, OY = 0;

function measureSafe() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const r = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  probe.remove();
  return r;
}
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  const cw = window.innerWidth, ch = window.innerHeight;
  const devW = Math.max(1, Math.round(cw * DPR)), devH = Math.max(1, Math.round(ch * DPR));
  let k = Math.max(1, Math.floor(devH / 240)); // ~250-300 px tall: a wider view keeps enemies clear of the thumbs
  while (k > 1 && devW / k < 400) k--;
  while (devH / k > 300 && devW / (k + 1) >= 300) k++;
  if (k % 2 && k >= 3 && devH / (k - 1) <= 340) k--;   // prefer an even scale so the 2x detail layer stays crisp
  K = k; F = K % 2 === 0 ? 2 : 1; W = Math.floor(devW / k); H = Math.floor(devH / k);
  canvas.width = devW; canvas.height = devH;
  canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
  OX = Math.floor((devW - W * K) / 2); OY = Math.floor((devH - H * K) / 2);
  buf.width = W * F; buf.height = H * F;
  g.imageSmoothingEnabled = false;
  PT = DPR / K;
  const s = measureSafe();
  SAFE.t = Math.ceil(s.t * PT); SAFE.r = Math.ceil(s.r * PT); SAFE.b = Math.ceil(s.b * PT); SAFE.l = Math.ceil(s.l * PT);
  VPAD_TOUCH = matchMedia("(pointer: coarse)").matches ? Math.round(62 * PT + SAFE.b * 0.5) : 0;
  invalidateLayout();
  skyCache = null;
  if (game && layers && (layers.h !== H || layers.c0w !== W)) { buildLayers(game.theme, game.len); layers.c0w = W; }
  initWeather();
}
function present() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (OX || OY) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(buf, 0, 0, W * F, H * F, OX, OY, W * K, H * K);
  drawControlsHD(ctx);
}
let presentMs = 0;   // dev metric

// ---------- Sky, layers, ground ----------
let skyCache = null;
function drawSky(th) {
  if (!skyCache || skyCache.id !== th.id || skyCache.h !== H) {
    const gr = g.createLinearGradient(0, 0, 0, H - GROUND);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(1, th.sky[1]);
    skyCache = { id: th.id, h: H, gr };
  }
  g.fillStyle = skyCache.gr; g.fillRect(0, 0, W, H);
  const night = th.id === "snow" || th.id === "city" || th.id === "fortress";
  if (night) {
    g.fillStyle = "#ffffff";
    for (let i = 0; i < 50; i++) { const x = Math.round(hash(i) * W), y = Math.round(hash(i + 50) * (H - GROUND - 60)); if (Math.floor(realClock * 2 + i) % 7) g.fillRect(x, y, 1, 1); }
  }
  const sx0 = Math.round(W * 0.74), sy0 = Math.round((H - GROUND) * 0.25);
  if (th.id === "snow" || th.id === "city") { pcirc(g, sx0, sy0, 11, th.sun); pcirc(g, sx0 + 4, sy0 - 3, 10, th.sky[0]); }
  else if (th.id === "fortress") { g.globalAlpha = 0.5; pcirc(g, sx0, sy0 + 20, 26, "#ff6a2a"); g.globalAlpha = 1; pcirc(g, sx0, sy0 + 20, 16, "#ffb060"); }
  else { g.globalAlpha = 0.35; pcirc(g, sx0, sy0 + 10, 30, th.sun); g.globalAlpha = 1; pcirc(g, sx0, sy0 + 10, 19, th.sun); g.fillStyle = th.sky[1]; g.fillRect(sx0 - 24, sy0 + 12, 48, 2); g.fillRect(sx0 - 20, sy0 + 18, 40, 2); }
}
function drawLayers() {
  if (!layers) return;
  for (const k of ["far", "mid", "near"]) {
    const L = layers[k], off = Math.round(camX * L.par);
    g.drawImage(L.c, off, 0, Math.min(W, L.w - off), H, 0, 0, Math.min(W, L.w - off), H);
  }
}
function drawGround(th) {
  const gy = H - GROUND;
  g.fillStyle = th.ground; g.fillRect(0, gy, W, GROUND + VPAD);
  g.fillStyle = th.groundTop; g.fillRect(0, gy, W, 3);
  g.fillStyle = th.dirt;
  for (let wx = Math.floor(camX / 10) * 10; wx < camX + W + 10; wx += 10) {
    const h1 = hash(wx), h2 = hash(wx + 7);
    if (h1 < 0.6) g.fillRect(sx(wx + h1 * 9), gy + 5 + Math.round(h2 * (26 + VPAD)), 2 + Math.round(h2 * 2), 1);
    if (VPAD && h1 > 0.75) g.fillRect(sx(wx + h2 * 9), gy + GROUND + Math.round(h1 * VPAD) - 4, 3, 1);
    if (h2 < 0.3) g.fillRect(sx(wx + h2 * 9), gy + 3, 1, 1);
  }
  if (th.id === "city") { g.fillStyle = "#c8c050"; for (let wx = Math.floor(camX / 40) * 40; wx < camX + W + 40; wx += 40) g.fillRect(sx(wx), gy + 16, 18, 2); }
  if (th.id === "harbor") { g.fillStyle = shade(th.ground, -0.25); for (let wx = Math.floor(camX / 14) * 14; wx < camX + W + 14; wx += 14) g.fillRect(sx(wx), gy + 3, 1, GROUND + VPAD); }
  for (const d of decals) {
    const x = sx(d.x); if (x < -30 || x > W + 30) continue;
    if (d.blood) { g.fillStyle = "#9a0a0a"; g.fillRect(x - (d.w >> 1), gy, d.w, 2); if (d.w > 4) { g.fillStyle = "#6a0606"; g.fillRect(x - (d.w >> 2), gy + 2, d.w >> 1, 1); } continue; }
    g.fillStyle = "rgba(20,12,8,0.45)";
    { g.fillRect(x - d.w / 2, gy, d.w, 2); g.fillRect(x - d.w / 3, gy + 2, d.w * 2 / 3, 1); } }
}

// ---------- Props ----------
function drawProp(p) {
  const x = sx(p.x), y = H - GROUND, th = game.theme;
  if (x < -50 || x > W + 50) return;
  switch (p.kind) {
    case "sandbag":
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) { const bx = x + i * 10 + r * 5, by = y - 6 - r * 5; g.fillStyle = "#8a7a52"; g.fillRect(bx, by, 10, 6); g.fillStyle = "#c8b48a"; g.fillRect(bx + 1, by, 8, 5); g.fillStyle = "#e0d0a8"; g.fillRect(bx + 2, by + 1, 5, 1); }
      if (th.weather === "snow") { g.fillStyle = "#fff"; g.fillRect(x + 10, y - 17, 10, 2); }
      break;
    case "rock": pcirc(g, x + 8, y, 9, "#6e6a64"); pcirc(g, x + 5, y - 3, 5, "#8a867e"); break;
    case "wreck": g.fillStyle = "#3a2e28"; g.fillRect(x, y - 12, 36, 10); g.fillRect(x + 8, y - 20, 18, 8); g.fillStyle = "#6a3a20"; g.fillRect(x + 2, y - 10, 10, 3); pcirc(g, x + 8, y - 2, 4, "#1a1a1a"); pcirc(g, x + 28, y - 2, 4, "#1a1a1a"); break;
    case "sign": g.fillStyle = "#5a3a1a"; g.fillRect(x + 6, y - 20, 2, 20); g.fillStyle = "#8a5a2a"; g.fillRect(x, y - 24, 16, 8); g.fillStyle = "#e8e0c8"; g.fillRect(x + 2, y - 21, 10, 1); g.fillRect(x + 12, y - 22, 2, 3); break;
    case "cactus": g.fillStyle = "#4a7a32"; g.fillRect(x + 4, y - 22, 5, 22); g.fillRect(x, y - 16, 4, 3); g.fillRect(x, y - 20, 3, 6); g.fillRect(x + 9, y - 13, 4, 3); g.fillRect(x + 10, y - 18, 3, 6); g.fillStyle = "#6a9a4a"; g.fillRect(x + 5, y - 21, 1, 20); break;
    case "skull": g.fillStyle = "#e8e0c8"; g.fillRect(x, y - 5, 7, 5); g.fillRect(x + 1, y - 6, 5, 1); g.fillStyle = "#2a2020"; g.fillRect(x + 1, y - 4, 2, 2); g.fillRect(x + 4, y - 4, 2, 2); break;
    case "stump": g.fillStyle = "#4a3520"; g.fillRect(x, y - 8, 12, 8); g.fillStyle = "#7a5a3a"; g.fillRect(x + 1, y - 9, 10, 2); break;
    case "fern": g.fillStyle = "#3a7a2a"; for (let i = 0; i < 5; i++) g.fillRect(x + i * 3, y - 6 - (i % 2) * 4, 2, 6 + (i % 2) * 4); break;
    case "statue": g.fillStyle = "#7d7c64"; g.fillRect(x, y - 4, 16, 4); g.fillRect(x + 3, y - 22, 10, 18); g.fillRect(x + 5, y - 28, 6, 6); g.fillStyle = "#4a4a3a"; g.fillRect(x + 6, y - 26, 1, 1); g.fillRect(x + 9, y - 26, 1, 1); g.fillStyle = "#5a8a3a"; g.fillRect(x + 3, y - 12, 4, 2); break;
    case "snowman": pcirc(g, x + 6, y - 6, 6, "#ffffff"); pcirc(g, x + 6, y - 15, 4, "#ffffff"); g.fillStyle = "#ff8a1a"; g.fillRect(x + 9, y - 15, 3, 1); g.fillStyle = "#1a1010"; g.fillRect(x + 7, y - 17, 1, 1); g.fillRect(x + 3, y - 21, 7, 2); break;
    case "car": g.fillStyle = "#5a2a2a"; g.fillRect(x, y - 12, 40, 9); g.fillRect(x + 8, y - 19, 22, 7); g.fillStyle = "#6a8aa0"; g.fillRect(x + 11, y - 18, 7, 5); g.fillRect(x + 20, y - 18, 7, 5); pcirc(g, x + 9, y - 3, 4, "#151515"); pcirc(g, x + 31, y - 3, 4, "#151515"); g.fillStyle = "#ffd34d"; g.fillRect(x + 38, y - 10, 2, 2); break;
    case "hydrant": g.fillStyle = "#c83a2a"; g.fillRect(x + 1, y - 10, 6, 10); g.fillRect(x, y - 7, 8, 2); g.fillRect(x + 2, y - 12, 4, 2); break;
    case "bin": g.fillStyle = "#3a5a3a"; g.fillRect(x, y - 14, 12, 14); g.fillStyle = "#2a4a2a"; g.fillRect(x - 1, y - 15, 14, 2); break;
    case "bollard": g.fillStyle = "#2a2a30"; g.fillRect(x, y - 8, 7, 8); g.fillRect(x - 1, y - 10, 9, 3); break;
    case "rope": g.fillStyle = "#c8a060"; for (let i = 0; i < 3; i++) g.fillRect(x + i, y - 3 - i, 12 - i * 2, 2); break;
    case "barrels": for (let i = 0; i < 3; i++) { g.fillStyle = "#2a5a8a"; g.fillRect(x + i * 10, y - 14, 9, 14); g.fillStyle = "#1a3a5a"; g.fillRect(x + i * 10, y - 10, 9, 1); g.fillRect(x + i * 10, y - 4, 9, 1); } break;
    case "net": g.fillStyle = "#6a5a3a"; for (let i = 0; i < 6; i++) { g.fillRect(x + i * 3, y - 10, 1, 10); g.fillRect(x, y - 10 + i * 2, 16, 1); } break;
    case "spikes": g.fillStyle = "#5a5a62"; for (let i = 0; i < 5; i++) { g.fillRect(x + i * 5 + 2, y - 10, 1, 10); g.fillRect(x + i * 5 + 1, y - 6, 3, 6); } break;
    case "wire": g.fillStyle = "#4a3a34"; g.fillRect(x, y - 14, 2, 14); g.fillRect(x + 24, y - 14, 2, 14); g.fillStyle = "#8a8a92"; for (let i = 0; i < 24; i += 2) { g.fillRect(x + i, y - 12 + (i % 4 ? 1 : 0), 1, 1); g.fillRect(x + i, y - 7 + (i % 4 ? 0 : 1), 1, 1); } break;
    case "tent": g.fillStyle = "#6a6a3a"; for (let i = 0; i < 18; i++) g.fillRect(x + i, y - Math.min(i, 36 - i) - 1, 36 - i * 2 > 0 ? 1 : 1, Math.min(i, 36 - i) + 1); for (let i = 18; i < 36; i++) g.fillRect(x + i, y - (36 - i) - 1, 1, 36 - i + 1); g.fillStyle = "#3a3a20"; g.fillRect(x + 14, y - 10, 8, 10); break;
    case "lamp": g.fillStyle = "#2a2a32"; g.fillRect(x, y - 44, 2, 44); g.fillRect(x, y - 44, 10, 2); g.fillStyle = "#fff6c0"; g.fillRect(x + 7, y - 42, 4, 2); break;
  }
}
// Buildings with walkable roofs
function drawPlat(p) {
  const x = sx(p.x), top = H - p.y, w = p.w, h = p.h, th = game.theme;
  if (x + w < -6 || x > W + 6) return;
  const wall = p.look === 3 ? shade(th.wall, -0.1) : p.look === 1 ? shade(th.wall, 0.08) : th.wall;
  g.fillStyle = wall; g.fillRect(x, top, w, h);
  g.fillStyle = th.wallD;
  for (let r = 6; r < h; r += 6) g.fillRect(x, top + r, w, 1);
  for (let r = 0; r < h; r += 6) for (let c = (r / 6) % 2 ? 2 : 7; c < w; c += 10) g.fillRect(x + c, top + r, 1, 6);
  if (p.look !== 3) g.fillRect(x + (w >> 1) - 6, top + h - 18, 12, 18);
  g.fillRect(x + 6, top + 9, 10, 9); g.fillRect(x + w - 16, top + 9, 10, 9);
  if (th.night) { g.fillStyle = Math.floor(hash(p.x) * 3) ? th.midWin : "#141828"; g.fillRect(x + 7, top + 10, 8, 7); }
  g.fillStyle = shade(wall, 0.15); g.fillRect(x + 6, top + 9, 10, 2); g.fillRect(x + w - 16, top + 9, 10, 2);
  g.fillStyle = th.wallTop; g.fillRect(x - 3, top - 1, w + 6, 4);
  g.fillStyle = th.wallD; g.fillRect(x - 3, top + 3, w + 6, 1); g.fillRect(x - 1, top + 4, 2, 4); g.fillRect(x + w - 1, top + 4, 2, 4);
}
function drawWall(w) {
  const x = sx(w.x), top = H - w.y - w.h;
  if (x + w.w < -4 || x > W + 4) return;
  if (w.dead) { g.fillStyle = "#140c0a"; g.fillRect(x, top, w.w, w.h); return; }
  g.fillStyle = w.flash > 0 ? "#ffffff" : game.theme.wall; g.fillRect(x, top, w.w, w.h);
  g.fillStyle = game.theme.wallD;
  const cr = [[3, 2], [4, 3], [5, 4], [5, 5], [6, 6], [8, 7], [9, 8], [9, 9], [10, 10], [12, 11], [13, 12], [12, 13], [11, 14], [11, 15], [12, 16], [14, 17], [15, 18], [6, 7], [5, 8], [4, 9], [14, 9], [15, 8], [16, 7]];
  for (const [cx, cy] of cr) g.fillRect(x + cx, top + cy + 2, 1, 1);
  if (Math.floor(realClock * 2) % 3 === 0) { g.fillStyle = "#ffd34d"; g.fillRect(x + 9, top + 9, 1, 1); }
}
function drawCover(c) {
  const x = sx(c.x), y = H - GROUND;
  if (x + c.w < -4 || x > W + 4) return;
  const bags = Math.round(c.w / 9);
  for (let r = 0; r < 2; r++) for (let i = 0; i < bags - r; i++) {
    const bx = x + i * 9 + r * 4, by = y - 7 - r * 6;
    g.fillStyle = "#6a5a3a"; g.fillRect(bx, by, 9, 7); g.fillStyle = "#b8a47a"; g.fillRect(bx + 1, by, 7, 6); g.fillStyle = "#d8c8a0"; g.fillRect(bx + 2, by + 1, 4, 1);
  }
  if (game.theme.weather === "snow") { g.fillStyle = "#fff"; g.fillRect(x + 4, y - 14, c.w - 8, 2); }
}
function drawCrate(c) {
  const x = sx(c.x), y = H - c.y - 1;
  if (x < -20 || x > W + 20) return;
  spr(c.gold ? "crate_gold" : "crate", x, y);
  if (c.flash > 0) { g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(x, y - 15, 16, 16); }
}
function drawBarrel(b) {
  const x = sx(b.x), y = H - b.y - 1;
  if (x < -20 || x > W + 20) return;
  const j = b.fuse > 0 ? (chance(0.5) ? -1 : 1) : 0;
  spr("barrel", x + j, y);
  if (b.flash > 0 || b.fuse > 0) { g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(x + j, y - 15, 12, 16); }
}
function drawFlag(f) {
  const x = sx(f.x), y = H - GROUND - 1;
  if (x < -20 || x > W + 20) return;
  if (f.reached) { spr("flag", x, y); }
  else { g.fillStyle = "#9c9cac"; g.fillRect(x, y - 19, 1, 20); g.fillStyle = "#6a6a72"; g.fillRect(x + 1, y - 5, 8, 5); }
}
function drawItem(it) {
  if (it.t > 15 && it.kind !== "tag" && Math.floor(clock * 10) % 2) return;
  const x = sx(it.x), y = H - Math.round(it.y) - 1;
  if (x < -20 || x > W + 20) return;
  if (it.chute && it.vy < -1) spr("chute", x, y - 14);
  const bob = Math.round(Math.sin(clock * 4 + it.x) * 1);
  if (WEAPONS[it.kind] || it.kind === "B") {
    const c = ITEM_COLORS[it.kind];
    g.fillStyle = "#1a1410"; g.fillRect(x - 7, y - 13 + bob, 14, 14);
    g.fillStyle = c; g.fillRect(x - 6, y - 12 + bob, 12, 12);
    g.fillStyle = "#1a1410"; g.fillRect(x - 5, y - 11 + bob, 10, 10);
    text(it.kind, x - 3, y - 10 + bob, c, { shadow: false });
    return;
  }
  const id = { vest: "vest", food: "food", gold: "goldbar", medal: "medal", tag: "dogtag", life: "medal" }[it.kind];
  if (id) spr(id, x, y + bob);
  if (it.kind === "tag" && Math.floor(realClock * 4) % 2) { g.fillStyle = "#ffffff"; g.fillRect(x + 3, y - 8 + bob, 1, 1); }
  if (it.kind === "life") text("1UP", x - 11, y - 18, "#8ae06a");
}
function drawCoin(c) {
  const x = sx(c.x), y = H - Math.round(c.y);
  const f = Math.floor((realClock * 10 + c.v) % 4), w = [5, 3, 1, 3][f];
  g.fillStyle = "#8a5a10"; g.fillRect(x - (w >> 1) - 1, y - 3, w + 2, 6);
  g.fillStyle = "#ffd34d"; g.fillRect(x - (w >> 1), y - 3, w, 6);
  if (w > 2) { g.fillStyle = "#fff6c0"; g.fillRect(x - (w >> 1), y - 2, 1, 2); }
}

// ---------- Characters ----------
function heroPal() { return `hero${save.hero}_${heroSave().costume}`; }
function drawPlayer() {
  if (P.inTank) return;
  const x = sx(P.x), y = H - Math.round(P.y) - 1, look = HERO_LOOKS[save.hero];
  if (P.dead) {
    if (P.deadT > 1.2 && Math.floor(clock * 16) % 2) return;
    drawSoldier({ pal: heroPal(), head: look.head, torso: "t_hero", pose: P.deadT < 0.35 ? "jump" : "stand", arm: "flail", t: P.deadT }, x, y, P.face, { rot: P.deadT < 0.35 ? 0 : 3 });
    return;
  }
  if (P.inv > 0 && Math.floor(clock * 20) % 2) return;
  if (P.rollT > 0) {
    // tumble around the body centre (7 px above the feet)
    const r = Math.floor((1 - P.rollT / ROLL_T) * 4) % 4, off = [[0, 0], [-7, -7], [0, -14], [7, -7]][r];
    drawSoldier({ pal: heroPal(), head: look.head, torso: "t_hero", pose: "crouch", arm: "none" }, x + off[0] * P.face, y + off[1], P.face, { rot: r });
    return;
  }
  const pose = playerPose(), gun = P.weapon === "P" ? "pistol" : P.weapon;
  let arm = P.aim;
  if (P.knifeT > 0) arm = "knife"; else if (P.throwT > 0) arm = "throw";
  drawSoldier({ pal: heroPal(), head: look.head, torso: "t_hero", pose, t: P.runT, arm, gun, recoil: P.shootT > 0.05, bob: pose === "stand" }, x, y, P.face, { mode: hurtFlash > 0.15 ? "flash" : "normal" });
}
function drawPow(p) {
  const x = sx(p.x), y = H - Math.round(p.y) - 1;
  if (x < -30 || x > W + 30) return;
  if (p.state === "tied") {
    drawSoldier({ pal: "pow", head: "h_pow", torso: "t_pow", pose: "sit", arm: "tied", t: clock + p.t, bob: true }, x, y, p.face);
    if (Math.floor(realClock * 2 + p.x) % 4 === 0) text("HELP!", x - 18, y - 30, "#ffffff", { outline: true });
    return;
  }
  const pose = p.state === "walk" || p.state === "run" ? "run" : p.state === "free" && p.t < 0.25 ? "jump" : "stand";
  drawSoldier({ pal: "pow", head: "h_pow", torso: "t_pow", pose, t: p.t, arm: p.state === "salute" ? "salute" : "idle" }, x, y, p.face);
}
function drawCorpse(c) {
  const x = sx(c.x), y = H - Math.round(c.y) - 1;
  if (x < -40 || x > W + 40) return;
  if (c.kind === "heli") {
    const p = procCanvas(70, 30), cc = p.g;
    PR(cc, 23, 11, 22, 11, "#3a3f25"); PR(cc, 5, 14, 20, 3, "#3a3f25"); PR(cc, 41, 13, 7, 6, "#4a6068");
    procBlit(p, x - 35, y - 16, { flip: c.face < 0 });
    return;
  }
  const o = { pal: c.pal || "rebel_desert", head: c.head || "h_rebel", torso: c.torso || "t_rebel", pose: "stand", arm: "flail", t: c.t };
  if (c.kind === "burn") {
    if (c.t < 1) drawSoldier({ ...o, pose: "run" }, x, y, c.face, { mode: "burn" });
    else { g.fillStyle = "#2a2420"; g.fillRect(x - 6, y - 1, 12, 2); g.fillStyle = "#3a3430"; g.fillRect(x - 4, y - 3, 8, 2); }
    return;
  }
  if (c.kind === "fly") { drawSoldier({ ...o, pose: "jump" }, x, y, c.face, { rot: c.rot }); return; }
  // blood pool spreading under the body
  if (save.settings.gore && c.t > 0.2) { const w = Math.min(26, Math.round((c.t - 0.2) * 16)); g.fillStyle = "#8a0808"; g.fillRect(x - (w >> 1) - 2, y - 1, w, 2); if (w > 8) { g.fillStyle = "#b01010"; g.fillRect(x - (w >> 2) - 2, y - 1, w >> 1, 1); g.fillStyle = "#6a0606"; g.fillRect(x - (w >> 2) - 2, y + 1, w >> 1, 1); } }
  if (c.t < 0.15) drawSoldier(o, x, y, c.face, { mode: "flash" });
  else drawSoldier({ ...o, arm: "idle" }, x + 1, y - 5, c.face, { rot: 3 });
}
function drawTankEntity(t) {
  if (t.state === "doomed" && Math.floor(clock * 14) % 2) return;
  const p = procCanvas(56, 50), c = p.g, X = 28, Y = 48;
  const fl = t.flash > 0 && Math.floor(clock * 20) % 2;
  const body = fl ? "#ffffff" : "#7f8f9e", dark = "#56636f", light = "#a9b8c4";
  const R2 = (x, y, w, h, col) => PR(c, X + x, Y - y - h, w, h, col);
  R2(-20, 0, 40, 8, "#2b2b30");
  for (let i = 0; i < 5; i++) { R2(-17 + i * 8, 1, 6, 6, "#55555c"); R2(-15 + i * 8, 3, 2, 2, "#2b2b30"); }
  const off = ((Math.floor(t.tread * 24) % 4) + 4) % 4;
  for (let i = -20 + off; i < 20; i += 4) R2(i, 7, 2, 1, "#77777e");
  R2(-21, 8, 42, 8, body); R2(-21, 8, 42, 2, dark); R2(-19, 16, 36, 2, light);
  R2(15, 10, 5, 4, "#e8c03a"); R2(-19, 11, 9, 3, "#c8a63a");
  R2(-10, 18, 20, 9, body); R2(-10, 18, 20, 2, dark); R2(-8, 26, 14, 2, light);
  R2(8, 21, 17, 3, "#4a535c"); R2(24, 20, 2, 5, "#3a4148");
  if (t.aimUp) { R2(-1, 28, 2, 10, "#333"); R2(2, 28, 2, 10, "#333"); } else { R2(12, 17, 10, 1, "#333"); R2(12, 19, 10, 1, "#333"); R2(10, 16, 3, 5, "#4a535c"); }
  if (t.state === "driven") { const pal = PALS[heroPal()]; R2(-7, 27, 6, 4, pal.S); R2(-7, 30, 6, 1, pal.A); R2(-7, 31, 6, 1, pal.H); }
  R2(-9, 27, 10, 1, dark);
  procBlit(p, sx(t.x) - X, H - Math.round(t.y) - Y, { flip: t.face < 0 });
  if (t.state === "parked" && Math.floor(realClock * 3) % 2 && state === "play") text("SLUG", sx(t.x) - 15, H - t.y - 56, "#ffd34d", { outline: true });
  if (t.state !== "parked") {
    const hx = sx(t.x) - 12, hy = H - Math.round(t.y) - 42;
    g.fillStyle = "#000"; g.fillRect(hx, hy, 24, 3);
    g.fillStyle = t.hp > 2 ? "#5ad05a" : "#ff4a3a"; g.fillRect(hx + 1, hy + 1, Math.max(0, 22 * t.hp / t.maxHp), 1);
  }
}

// ---------- Projectiles and effects ----------
function drawBullet(b) {
  const x = sx(b.x), y = sy(b.y);
  switch (b.kind) {
    case "b": g.fillStyle = "#fff6a0"; if (b.vx) g.fillRect(x - 2, y - 1, 4, 2); else g.fillRect(x - 1, y - 2, 2, 4); break;
    case "hb": { const a = Math.atan2(-b.vy, b.vx); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = "#ff9a2a"; g.fillRect(-5, -1, 7, 2); g.fillStyle = "#fff6c0"; g.fillRect(-1, -1, 3, 2); g.restore(); break; }
    case "rocket": case "erocket": case "emissile": {
      const a = Math.atan2(-b.vy, b.vx);
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = b.kind === "rocket" || b.kind === "emissile" ? "#c8ccd0" : "#6b7738"; g.fillRect(-4, -1, 8, 3);
      g.fillStyle = "#c83a2a"; g.fillRect(3, -1, 2, 3);
      g.fillStyle = Math.floor(clock * 20) % 2 ? "#ffd34d" : "#ff7a2a"; g.fillRect(-7, -1, 3, 3);
      g.restore(); break;
    }
    case "flame": { const r = 3 + (0.55 - b.life) * 12; pcirc(g, x, y, r, "#ff5a1a"); pcirc(g, x, y, r * 0.65, "#ffaa28"); pcirc(g, x, y, r * 0.3, "#fff2b0"); break; }
    case "eflame": { const r = 3 + (0.75 - b.life) * 10; pcirc(g, x, y, r, "#ff3a1a"); pcirc(g, x, y, r * 0.6, "#ff9a28"); break; }
    case "gren": case "egren": { const s = Math.floor(b.spin || 0) % 2; g.fillStyle = b.kind === "gren" ? "#3c4a2a" : "#4a3a2a"; g.fillRect(x - 2, y - 2, s ? 4 : 3, s ? 3 : 4); g.fillStyle = "#8a8a6a"; g.fillRect(x - 1, y - 3, 2, 1); break; }
    case "tshell": g.fillStyle = "#8a9098"; g.fillRect(x - 3, y - 2, 6, 3); g.fillStyle = "#e8c03a"; g.fillRect(x + (b.vx > 0 ? 2 : -3), y - 2, 1, 3); break;
    case "eb":
      if (b.sniper) { g.fillStyle = "#ff3a3a"; const a = Math.atan2(-b.vy, b.vx); for (let i = 0; i < 6; i++) g.fillRect(Math.round(x - Math.cos(a) * i), Math.round(y + Math.sin(a) * i), 1, 1); }
      else { const a = Math.atan2(-b.vy, b.vx); g.globalAlpha = 0.45; g.fillStyle = "#ff7a3a"; for (let i = 2; i < 7; i++) g.fillRect(Math.round(x - Math.cos(a) * i), Math.round(y + Math.sin(a) * i), 1, 1); g.globalAlpha = 1; }   // tracer tail
      pcirc(g, x, y, 2, "#ff5a3a"); g.fillStyle = "#fff0c0"; g.fillRect(x - 1, y - 1, 2, 2); break;
    case "ebomb": g.fillStyle = "#2a2a2a"; g.fillRect(x - 2, y - 3, 4, 6); g.fillStyle = "#c83a2a"; g.fillRect(x - 2, y - 4, 4, 1); break;
    case "eshell": pcirc(g, x, y, 3.5, "#2a2a2a"); pcirc(g, x, y, 1.5, Math.floor(clock * 20) % 2 ? "#ff5a3a" : "#ffd34d"); break;
    case "mortar": {
      pcirc(g, x, y, 2.5, "#2a2a2a");
      if (Math.floor(clock * 10) % 2) { const tx = sx(b.tx), ty = H - GROUND; g.fillStyle = "#ff3a2a"; g.fillRect(tx - 8, ty - 1, 16, 1); g.fillRect(tx - 1, ty - 4, 2, 4); g.fillRect(tx - 6, ty - 3, 1, 2); g.fillRect(tx + 5, ty - 3, 1, 2); }
      break;
    }
    case "wave": { const dir = b.vx > 0 ? 1 : -1; for (let i = 0; i < 4; i++) { const h = 9 - i * 2; g.fillStyle = i % 2 ? game.theme.groundTop : "#ffffff"; g.fillRect(x - dir * i * 3 - 1, sy(GROUND + h), 3, h); } break; }
  }
}
function drawBeam(b) {
  const x0 = sx(b.x), y0 = sy(b.y), wob = Math.floor(clock * 60) % 2;
  const r = b.dx ? { x: b.dx > 0 ? x0 : x0 - b.len, y: y0 - 1 - wob, w: b.len, h: 3 + wob } : { x: x0 - 1 - wob, y: b.dy > 0 ? y0 - b.len : y0, w: 3 + wob, h: b.len };
  g.globalAlpha = 1 - b.t / 0.1;
  g.fillStyle = "#3aa0d8"; g.fillRect(r.x, r.y - (b.dx ? 1 : 0), r.w + (b.dx ? 0 : 2), r.h + (b.dx ? 2 : 0));
  g.fillStyle = "#e6f6ff"; g.fillRect(b.dx ? r.x : r.x + 1, b.dx ? r.y + 1 : r.y, b.dx ? r.w : 1, b.dx ? 1 : r.h);
  g.globalAlpha = 1;
}
function drawBlast(b) {
  const p = b.t / 0.22, x = sx(b.x), y = sy(b.y), len = 30 + p * 50, wid = 8 + p * 22;
  g.save(); g.translate(x, y); g.rotate(Math.atan2(-b.dy, b.dx)); g.globalAlpha = 1 - p;
  g.fillStyle = "#ffd34d"; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, -wid); g.lineTo(len + 8, 0); g.lineTo(len, wid); g.fill();
  g.fillStyle = "#fffbe0"; g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.7, -wid * 0.5); g.lineTo(len * 0.7, wid * 0.5); g.fill();
  g.restore();
}
// pixel ring (no anti-aliasing)
function pring(c, cx, cy, r, color) {
  c.fillStyle = color;
  const n = Math.max(12, Math.round(r * 6));
  for (let i = 0; i < n; i++) { const a = i / n * TAU; c.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1); }
}
function drawBoom(b) {
  // shockwave ring on bigger blasts
  if (b.size >= 0.8 && b.t < 0.3) { const p = b.t / 0.3; g.globalAlpha = 1 - p; pring(g, sx(b.x), sy(b.y + 4), b.size * 8 + p * b.size * 34, "#fff3c0"); g.globalAlpha = 1; }
  for (const bl of b.blobs) {
    const lt = b.t - bl.d; if (lt < 0) continue;
    const p = lt / b.dur; if (p > 1) continue;
    const r = bl.r * b.size * (0.45 + p * 0.75) * 0.75;
    const c = p < 0.15 ? "#fffbe0" : p < 0.35 ? "#ffd34d" : p < 0.6 ? "#ff8a1a" : p < 0.8 ? "#c8361a" : "#4a3a35";
    g.globalAlpha = p > 0.8 ? (1 - p) * 5 : 1;
    pcirc(g, sx(b.x + bl.dx), sy(b.y + bl.dy + p * 8), r, c);
    if (p < 0.6) pcirc(g, sx(b.x + bl.dx), sy(b.y + bl.dy + p * 8), r * 0.5, p < 0.3 ? "#ffffff" : "#ffd34d");
  }
  g.globalAlpha = 1;
}
function drawParts() {
  for (const p of parts) {
    const a = p.life / p.max;
    if (p.kind === "smoke") { g.globalAlpha = 0.55 * a; pcirc(g, sx(p.x), sy(p.y), p.s * (1 + (1 - a) * 1.6), p.c); }
    else if (p.kind === "blood") { g.globalAlpha = 1; g.fillStyle = p.c; g.fillRect(sx(p.x), sy(p.y), p.s, p.s); }
    else if (p.kind === "gib") {
      g.globalAlpha = Math.min(1, p.life); const w = p.s, h = p.h || p.s, x = sx(p.x) - (w >> 1), y = sy(p.y) - h;
      g.fillStyle = "#1a0a08"; g.fillRect(x - 1, y - 1, w + 2, h + 2);   // outline like the sprites
      g.fillStyle = p.c; g.fillRect(x, y, w, h);
      if (p.c2) { g.fillStyle = p.c2; g.fillRect(x, y + h - 1, w, 1); }   // bloody end
    }
    else if (p.kind === "flash") { g.globalAlpha = 1; const x = sx(p.x), y = sy(p.y), s = p.s >> 1; g.fillStyle = p.c; g.fillRect(x - s, y - 1, s * 2, 2); g.fillRect(x - 1, y - s, 2, s * 2); g.fillStyle = "#fff"; g.fillRect(x - 1, y - 1, 2, 2); }
    else { g.globalAlpha = Math.min(1, a * 2); g.fillStyle = p.c; g.fillRect(sx(p.x) - (p.s >> 1), sy(p.y) - (p.s >> 1), p.s, p.s); }
  }
  g.globalAlpha = 1;
}

// ---------- Lighting ----------
const lightCv = document.createElement("canvas"), lg = lightCv.getContext("2d");
function drawLighting(th) {
  if (!th.night) return;
  const LH = H + VPAD;
  if (lightCv.width !== W || lightCv.height !== LH) { lightCv.width = W; lightCv.height = LH; }
  lg.globalCompositeOperation = "source-over"; lg.clearRect(0, 0, W, LH);
  lg.fillStyle = `rgba(4,6,22,${th.night})`; lg.fillRect(0, 0, W, LH);
  lg.globalCompositeOperation = "destination-out";
  const hole = (x, y, r, a = 1) => { const gr = lg.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, "rgba(0,0,0,0)"); lg.fillStyle = gr; lg.fillRect(x - r, y - r, r * 2, r * 2); };
  if (P && !P.dead) {
    const px = sx(P.x), py = sy(P.y + 14);
    hole(px, py, 64, 0.9);
    lg.fillStyle = "rgba(0,0,0,0.55)"; lg.beginPath(); lg.moveTo(px + P.face * 4, py - 2); lg.lineTo(px + P.face * 150, py - 40); lg.lineTo(px + P.face * 150, py + 26); lg.closePath(); lg.fill();
  }
  for (const p of props) if (p.kind === "lamp") { const x = sx(p.x) + 9; if (x > -60 && x < W + 60) { hole(x, sy(GROUND + 40), 50, 0.85); } }
  for (const l of lights) hole(sx(l.x), sy(l.y), l.r, Math.min(1, l.life / l.max + 0.3));
  if (th.id === "fortress") hole(Math.round(W * 0.74), Math.round((H - GROUND) * 0.25) + 20, 60, 0.6);
  g.drawImage(lightCv, 0, 0);
  g.globalCompositeOperation = "lighter";
  for (const l of lights) { if (l.r < 30) continue; const x = sx(l.x), y = sy(l.y), gr = g.createRadialGradient(x, y, 0, x, y, l.r * 0.6); gr.addColorStop(0, "rgba(255,170,90,0.25)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - l.r, y - l.r, l.r * 2, l.r * 2); }
  g.globalCompositeOperation = "source-over";
}

// ---------- Weather ----------
let flakes = [], lastCam = 0;
function initWeather() { flakes = []; for (let i = 0; i < 70; i++) flakes.push({ x: rand(0, W), y: rand(0, H), s: rand(0.5, 1.5), p: rand(0, 6) }); }
function drawWeather(th, dt) {
  const w = th.weather;
  if (!w) return;
  const dc = camX - lastCam; lastCam = camX;
  for (const f of flakes) {
    f.x -= dc * (0.8 + f.s * 0.2);
    if (w === "snow") { f.y += (20 + f.s * 20) * dt; f.x += Math.sin(realClock + f.p) * 8 * dt; g.fillStyle = "#ffffff"; g.fillRect(Math.round(f.x), Math.round(f.y), f.s > 1 ? 2 : 1, f.s > 1 ? 2 : 1); }
    else if (w === "rain") { f.y += (260 + f.s * 80) * dt; f.x -= 40 * dt; g.fillStyle = "rgba(160,180,220,0.55)"; g.fillRect(Math.round(f.x), Math.round(f.y), 1, 5); }
    else if (w === "leaves") { if (f.p > 2) continue; f.y += 14 * dt; f.x += Math.sin(realClock * 2 + f.p * 3) * 16 * dt; g.fillStyle = "#6aa83a"; g.fillRect(Math.round(f.x), Math.round(f.y), 2, 1); }
    else if (w === "ash") { if (f.p > 3) continue; f.y += 10 * dt; f.x += Math.sin(realClock + f.p) * 6 * dt; g.fillStyle = f.p < 1 ? "#ff8a3a" : "#8a7a74"; g.fillRect(Math.round(f.x), Math.round(f.y), 1, 1); }
    else if (w === "spray") { if (f.p > 1.2) continue; f.x -= 20 * dt; f.y += Math.sin(realClock * 2 + f.p) * 4 * dt; g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(Math.round(f.x), Math.round(f.y), 1, 1); }
    else { if (f.p > 1.5) continue; f.x -= 30 * dt * f.s; f.y += Math.sin(realClock + f.p) * 3 * dt; g.fillStyle = "rgba(255,230,180,0.6)"; g.fillRect(Math.round(f.x), Math.round(f.y), 1, 1); }
    if (f.y > H + VPAD) { f.y = -4; f.x = rand(0, W); }
    if (f.x < -4) f.x += W + 8; if (f.x > W + 4) f.x -= W + 8;
  }
}

// ---------- World ----------
function drawWorld(dt) {
  const th = game.theme;
  g.save();
  if (shake > 0) g.translate(Math.round(rand(-shake, shake)), Math.round(rand(-shake, shake)));
  g.translate(0, -VPAD);
  drawSky(th); drawLayers(); drawGround(th);
  for (const p of props) drawProp(p);
  for (const p of plats) drawPlat(p);
  for (const w of walls) drawWall(w);
  for (const c of covers) drawCover(c);
  for (const f of flags) drawFlag(f);
  for (const b of barrels) drawBarrel(b);
  for (const c of crates) drawCrate(c);
  if (boss) drawBoss();
  if (tank && tank.state !== "driven") drawTankEntity(tank);
  for (const p of pows) drawPow(p);
  for (const it of items) drawItem(it);
  for (const c of corpses) drawCorpse(c);
  for (const e of enemies) if (e.type !== "heli") drawEnemy(e);
  drawPlayer();
  if (tank && tank.state === "driven") drawTankEntity(tank);
  for (const e of enemies) if (e.type === "heli") drawEnemy(e);
  for (const b of bullets) {
    // landing marker for lobbed shells, so you know where to step away from
    if (b.mark !== undefined && !b.dead && Math.floor(clock * 8) % 2) { const mx = sx(b.mark), my = H - GROUND; g.fillStyle = "#ff3020"; for (let i = -3; i <= 3; i++) { g.fillRect(mx + i, my - 1 + Math.abs(i) - 3, 1, 1); g.fillRect(mx + i, my - 1 - Math.abs(i) + 3, 1, 1); } }
    drawBullet(b);
  }
  for (const b of blasts) drawBlast(b);
  for (const b of beams) drawBeam(b);
  for (const b of booms) drawBoom(b);
  drawParts();
  for (const c of coins) drawCoin(c);
  for (const p of popups) text(p.text, sx(p.x), sy(p.y + p.t * 22), p.c, { align: "center", alpha: Math.min(1, (0.9 - p.t) * 4), outline: !!p.multi });
  drawLighting(th);
  drawWeather(th, dt);
  g.restore();
  if (hurtFlash > 0) { g.fillStyle = `rgba(255,30,30,${hurtFlash * 0.9})`; g.fillRect(0, 0, W, H); }
  if (whiteFlash > 0 && save.settings.shake) { g.fillStyle = `rgba(255,250,230,${whiteFlash * 4})`; g.fillRect(0, 0, W, H); }
  // last heart: pulsing red edges
  if (P && !P.dead && !P.inTank && P.hp === 1 && game.phase === "play") {
    const a = 0.18 + Math.sin(realClock * 6) * 0.1;
    g.fillStyle = `rgba(200,20,20,${a})`;
    for (let i = 0; i < 6; i++) { const t = 6 - i; g.globalAlpha = (i + 1) / 6; g.fillRect(0, 0, t, H); g.fillRect(W - t, 0, t, H); g.fillRect(0, 0, W, t); g.fillRect(0, H - t, W, t); }
    g.globalAlpha = 1;
  }
}
