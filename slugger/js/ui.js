"use strict";
// Interface: HUD, touch controls, title, menus (map, armory, soldiers, awards, records, settings,
// layout editor), pause, results and mission-failed screens. Immediate-mode: every frame each screen
// draws its widgets and registers their hit areas.

let state = "boot", screen = "main", paused = false, prevScreen = null;
const UIC = { bg: "#20161a", bg2: "#2c2024", line: "#5a4636", gold: "#ffd34d", ink: "#f4e9d8", dim: "#9a8a76", green: "#8ae06a", red: "#ff5a4a", blue: "#7ad0ff", orange: "#ff9a4a" };
let uiHits = [], uiHitsPrev = [], uiPress = null, uiFocus = -1, uiScroll = {}, uiDrag = null, screenT = 0, briefId = 0, confirmReset = false;
let resT = 0, resSkip = false, resSfx = {}, menuCam = 0, toastShown = null;

// ---------- Screen flow ----------
function openScreen(name) {
  uiPress = null; uiDrag = null; uiFocus = -1; screenT = 0;
  if (name === "results") { state = "results"; resT = 0; resSkip = false; resSfx = {}; setupMenuScene(); return; }
  if (name === "failed") { state = "failed"; return; }
  if (name === "title") { state = "title"; setupMenuScene(); playMusic("menu"); return; }
  if (state !== "menu") { setupMenuScene(); playMusic("menu"); }
  state = "menu"; screen = name; uiScroll[name] = 0;
  if (name === "main") ensureDaily();
}
function backFromScreen() {
  sfx.back();
  if (state === "play" && (screen === "settings" || screen === "layout")) { screen = screen === "layout" ? "settings" : "pause"; persist(); invalidateLayout(); return; }
  const parent = { map: "main", brief: "map", armory: "main", soldiers: "main", awards: "main", records: "main", settings: "main", layout: "settings" }[screen];
  if (parent) { screen = parent; screenT = 0; uiFocus = -1; persist(); invalidateLayout(); }
}
function setupMenuScene() {
  const ids = MISSIONS.filter(m => save.missions[m.id]?.done).map(m => m.theme);
  const th = THEMES[ids.length ? ids[ids.length - 1] : "desert"];
  menuScene = th;
  buildLayers(th, 2600);
}
let menuScene = null;
function beginMission(id, fromCheckpoint = null) {
  initAudio();
  state = "play"; paused = false; musicPaused = false; screen = "pause"; syncZoom();
  startMission(id, fromCheckpoint);
  releaseAllTouches(); clearInputEdges();
}
function beginSurvival() { initAudio(); state = "play"; paused = false; musicPaused = false; screen = "pause"; syncZoom(); startSurvival(); releaseAllTouches(); clearInputEdges(); }
function setPaused(v) {
  if (state !== "play") return;
  paused = v; musicPaused = v; screen = "pause"; uiFocus = -1; screenT = 0;
  releaseAllTouches();
  if (v) persist();
}

// ---------- Widgets ----------
function frame(x, y, w, h, fill = UIC.bg, border = UIC.line) {
  g.fillStyle = "#000"; g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle = border; g.fillRect(x, y, w, h);
  g.fillStyle = fill; g.fillRect(x + 1, y + 1, w - 2, h - 2);
}
function hit(id, x, y, w, h, onTap, o = {}) { uiHits.push({ id, x, y, w, h, onTap, enabled: o.enabled !== false, sound: o.sound }); }
function isPressed(id) { return uiPress && uiPress.id === id && uiPress.inside; }
function isFocused(id) { const f = uiHitsPrev.filter(h => h.enabled)[uiFocus]; return f && f.id === id; }
function button(id, x, y, w, h, label, onTap, o = {}) {
  x = Math.round(x); y = Math.round(y);
  const en = o.enabled !== false, pr = isPressed(id), fo = isFocused(id);
  const fill = !en ? "#1a1416" : pr ? (o.color || UIC.gold) : o.fill || UIC.bg2;
  frame(x, y + (pr ? 1 : 0), w, h, fill, fo || pr ? UIC.gold : o.border || UIC.line);
  if (!pr && en) { g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(x + 1, y + 1, w - 2, 1); }
  const col = !en ? "#5a4a46" : pr ? "#20161a" : o.textColor || UIC.ink;
  const lines = String(label).split("\n");
  const sc = o.scale || 1, lh = 10 * sc;
  const ty = y + Math.round((h - lines.length * lh) / 2) + 1 + (pr ? 1 : 0);
  lines.forEach((l, i) => text(l, x + w / 2, ty + i * lh, i === 0 ? col : (en ? UIC.dim : col), { align: "center", scale: i === 0 ? sc : 1, shadow: !pr }));
  hit(id, x, y, w, h, onTap, { enabled: en, sound: o.sound });
}
function iconCoin(x, y) { g.fillStyle = "#8a5a10"; g.fillRect(x - 1, y, 8, 8); g.fillStyle = "#ffd34d"; g.fillRect(x, y, 6, 8); g.fillStyle = "#fff6c0"; g.fillRect(x + 1, y + 1, 1, 3); g.fillStyle = "#c8962a"; g.fillRect(x + 3, y + 2, 1, 4); }
function coinsLabel(x, y, n, align = "right") {
  const s = fmtNum(n), w = textW(s) + 11;
  const x0 = align === "right" ? x - w : x;
  iconCoin(x0, y); text(s, x0 + 11, y, UIC.gold);
  return w;
}
function bar(x, y, w, h, frac, col, bg = "#140c0e") { g.fillStyle = "#000"; g.fillRect(x - 1, y - 1, w + 2, h + 2); g.fillStyle = bg; g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x, y, Math.round(w * clamp(frac, 0, 1)), h); }
function starsRow(x, y, stars, scale = 1) { stars.forEach((s, i) => text(s ? "★" : "☆", x + i * 9 * scale, y, s ? UIC.gold : "#5a4a46", { scale, shadow: true })); }
// A menu toast takes the title's place while it shows, so the two never overlap.
function title(s, y = SAFE.t + 6) { if (toastShown && state !== "play" && state !== "results") return; text(s, W / 2, y, UIC.gold, { align: "center", scale: 2, outline: true }); }
function backButton() { button("back", SAFE.l + 6, SAFE.t + 6, 54, 20, "← BACK", () => backFromScreen()); }
function topCoins() { coinsLabel(W - SAFE.r - 8, SAFE.t + 12, save.coins); }
function dim(a = 0.55) { g.fillStyle = `rgba(10,6,8,${a})`; g.fillRect(0, 0, W, H); }
function heroSprite(i, x, y, scale = 2, costume = save.heroes[i].costume, run = null) {
  g.save(); g.translate(x, y); g.scale(scale, scale);
  drawSoldier({ pal: `hero${i}_${costume}`, head: HERO_LOOKS[i].head, torso: "t_hero", pose: run !== null ? "run" : "stand", t: run ?? realClock, arm: "f", gun: "H", bob: run === null }, 0, 0, 1);
  g.restore();
}
// Scrollable region: returns the scroll offset; content drawn by the caller translated by -offset
function scrollArea(id, x, y, w, h, contentH) {
  const max = Math.max(0, contentH - h);
  uiScroll[id] = clamp(uiScroll[id] || 0, 0, max);
  uiHits.push({ id: "scroll:" + id, x, y, w, h, scroll: true, max, enabled: false });
  if (max > 0) { const th = Math.max(12, h * h / contentH); g.fillStyle = "#3a2c30"; g.fillRect(x + w - 3, y, 2, h); g.fillStyle = UIC.dim; g.fillRect(x + w - 3, y + Math.round((h - th) * (uiScroll[id] / max)), 2, Math.round(th)); }
  return uiScroll[id];
}

// ---------- Pointer + keys for menus ----------
function hitAt(p, list = uiHitsPrev) { for (let i = list.length - 1; i >= 0; i--) { const h = list[i]; if (!h.scroll && h.enabled && p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h; } return null; }
function scrollAt(p) { return uiHitsPrev.find(h => h.scroll && p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h); }
function uiPointerDown(p, id) {
  if (state === "results" && !resultsDone()) { resSkip = true; return; }
  if (state === "title") { initAudio(); sfx.ui(); openScreen("main"); return; }
  if (screen === "layout" && layoutDown(p, id)) return;
  const h = hitAt(p);
  uiPress = h ? { id: h.id, pid: id, inside: true, x: p.x, y: p.y } : null;
  const s = scrollAt(p);
  uiDrag = s ? { pid: id, area: s.id.slice(7), y: p.y, start: uiScroll[s.id.slice(7)] || 0, moved: false } : null;
}
function uiPointerMove(p, id) {
  if (screen === "layout" && layoutMove(p, id)) return;
  if (uiDrag && uiDrag.pid === id) {
    const dy = p.y - uiDrag.y;
    if (Math.abs(dy) > 5) { uiDrag.moved = true; if (uiPress) uiPress.inside = false; }
    if (uiDrag.moved) uiScroll[uiDrag.area] = uiDrag.start - dy;
  }
  if (uiPress && uiPress.pid === id && !uiDrag?.moved) { const h = hitAt(p); uiPress.inside = !!h && h.id === uiPress.id; }
}
function uiPointerUp(p, id) {
  if (screen === "layout" && layoutUp(id)) return;
  if (uiPress && uiPress.pid === id && uiPress.inside) {
    const h = uiHitsPrev.find(h => h.id === uiPress.id);
    if (h && h.enabled) { if (h.sound !== false) sfx.ui(); hapticTap(false); h.onTap(); }
  }
  uiPress = null; if (uiDrag?.pid === id) uiDrag = null;
}
function uiPointerCancel(id) { if (uiPress?.pid === id) uiPress = null; if (uiDrag?.pid === id) uiDrag = null; }
function uiWheel(dy) { const a = uiHitsPrev.find(h => h.scroll); if (a) uiScroll[a.id.slice(7)] = (uiScroll[a.id.slice(7)] || 0) + dy * 0.3; }
// controller / keyboard focus starts on the first real choice, not on the BACK button in the corner
function defaultFocus() {
  const list = uiHitsPrev.filter(h => h.enabled);
  if (!list.length) return -1;
  for (const id of ["start", "rnext", "resume", "fre", "rretry", "play"]) { const i = list.findIndex(h => h.id === id); if (i >= 0) return i; }
  const i = list.findIndex(h => h.id !== "back");
  return i < 0 ? 0 : i;
}
function uiKey(k) {
  if (state === "title") { initAudio(); sfx.ui(); openScreen("main"); return; }
  if (state === "results" && !resultsDone()) { resSkip = true; return; }
  if (k === "back") {
    if (state === "play") { if (screen === "pause") setPaused(false); else backFromScreen(); return; }
    if (state === "menu" && screen !== "main") backFromScreen();
    return;
  }
  const list = uiHitsPrev.filter(h => h.enabled);
  if (!list.length) return;
  if (uiFocus < 0 || uiFocus >= list.length) { uiFocus = defaultFocus(); if (k !== "ok") return; }
  if (k === "ok") { const h = list[uiFocus]; if (h) { sfx.ui(); hapticTap(false); h.onTap(); } return; }
  const cur = list[uiFocus], cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
  const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[k];
  let best = -1, bd = Infinity;
  list.forEach((h, i) => {
    if (i === uiFocus) return;
    const dx = h.x + h.w / 2 - cx, dy = h.y + h.h / 2 - cy, along = dx * dir[0] + dy * dir[1];
    if (along <= 2) return;
    const d = along + Math.abs(dx * dir[1] + dy * dir[0]) * 2;
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0) { uiFocus = best; sfx.tick(); const h = list[best], a = uiHitsPrev.find(s => s.scroll && h.y >= s.y - 200); if (a && (h.y < a.y || h.y + h.h > a.y + a.h)) uiScroll[a.id.slice(7)] += h.y < a.y ? h.y - a.y - 4 : h.y + h.h - (a.y + a.h) + 4; }
}

// ---------- Main per-frame UI ----------
// In a mission the logical grid is coarse (big soldiers), so the interface is drawn on the finer
// buffer grid instead: same on-screen size as in the menus, and nothing overflows. Pointer input
// for the interface goes through the same mapping.
function uiScale() { return ZOOM && F === 2 ? 2 : 1; }
function withUIScale(fn, transform) {
  const u = uiScale();
  if (u === 1) return fn();
  const sv = { W, H, PT, l: SAFE.l, r: SAFE.r, t: SAFE.t, b: SAFE.b, lc: layoutCache, gen: layoutGen };
  W *= u; H *= u; PT *= u; SAFE.l *= u; SAFE.r *= u; SAFE.t *= u; SAFE.b *= u; layoutCache = null;
  if (transform) g.setTransform(F / u, 0, 0, F / u, 0, 0);
  try { return fn(); } finally {
    W = sv.W; H = sv.H; PT = sv.PT; SAFE.l = sv.l; SAFE.r = sv.r; SAFE.t = sv.t; SAFE.b = sv.b;
    layoutCache = layoutGen === sv.gen ? sv.lc : null;
    if (transform) g.setTransform(F, 0, 0, F, 0, 0);
  }
}
function drawUI(dt) { withUIScale(() => drawUIInner(dt), true); }
function drawUIInner(dt) {
  uiHitsPrev = uiHits; uiHits = [];
  screenT += dt;
  if (state === "title") drawTitle();
  else if (state === "menu") { drawMenuBackdrop(dt); drawMenuScreen(); }
  else if (state === "play") { drawHUD(); if (paused) { if (screen === "settings") { dim(0.75); drawSettings(); } else if (screen === "layout") drawLayoutEditor(); else drawPause(); } }
  else if (state === "results") { drawResults(dt); }
  else if (state === "failed") { drawFailed(); }
  drawFocusRing();
  drawToasts(dt);
}
function drawFocusRing() {   // controller / keyboard focus, visible on every kind of widget
  if (touchUI || uiFocus < 0) return;
  const f = uiHitsPrev.filter(h => h.enabled)[uiFocus];
  if (!f || f.scroll) return;
  const a = 0.55 + 0.45 * Math.sin(realClock * 7);
  g.globalAlpha = a; g.strokeStyle = UIC.gold; g.lineWidth = 1;
  g.strokeRect(Math.round(f.x) - 1.5, Math.round(f.y) - 1.5, Math.round(f.w) + 3, Math.round(f.h) + 3);
  g.globalAlpha = 1;
}
function drawMenuBackdrop(dt, dimA = 0.5) {
  if (!menuScene) setupMenuScene();
  menuCam = (menuCam + dt * 14) % 1800;
  const saveCam = camX; camX = menuCam;
  drawSky(menuScene); drawLayers(); drawGround(menuScene);
  camX = saveCam;
  dim(dimA);
}
function drawMenuScreen() {
  switch (screen) {
    case "main": return drawMain();
    case "map": return drawMap();
    case "brief": drawMap(); return drawBrief();
    case "armory": return drawArmory();
    case "soldiers": return drawSoldiers();
    case "awards": return drawAwards();
    case "records": return drawRecords();
    case "settings": return drawSettings();
    case "layout": return drawLayoutEditor();
  }
}

// ---------- Title ----------
function drawTitle() {
  drawMenuBackdrop(1 / 60, 0.12);
  const cy = Math.round(H * 0.3);
  const s = "SLUGGER";
  text(s, W / 2, cy, "#8a3a10", { align: "center", scale: 4, outline: true });
  g.save(); g.beginPath(); g.rect(0, 0, W, cy + 16); g.clip();
  text(s, W / 2, cy, UIC.gold, { align: "center", scale: 4, shadow: false });
  g.restore();
  g.save(); g.beginPath(); g.rect(0, 0, W, cy + 8); g.clip();
  text(s, W / 2, cy, "#fff6c0", { align: "center", scale: 4, shadow: false });
  g.restore();
  text("RUN · GUN · RESCUE", W / 2, cy + 40, UIC.ink, { align: "center" });
  if (Math.floor(realClock * 2.5) % 2) text(isTouch ? "TAP TO START" : "PRESS ENTER", W / 2, Math.round(H * 0.68), UIC.gold, { align: "center", outline: true });
  heroSprite(save.hero, Math.round(W * 0.2), H - GROUND - 1, 2, undefined, realClock);
  drawSoldier({ pal: "pow", head: "h_pow", torso: "t_pow", pose: "run", t: realClock * 1.1, arm: "idle" }, Math.round(W * 0.2) - 40, H - GROUND - 1, 1);
  if (window.SLUGGER_APP && !isInstalled()) text(/iPhone|iPad|iPod/.test(navigator.userAgent) ? "INSTALL: SHARE → ADD TO HOME SCREEN" : "INSTALL: BROWSER MENU → INSTALL APP", W / 2, H - SAFE.b - 12, UIC.dim, { align: "center" });
  coinsLabel(W - SAFE.r - 8, SAFE.t + 8, save.coins);
}
const isInstalled = () => NATIVE || matchMedia("(display-mode: fullscreen)").matches || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// ---------- Main menu ----------
function drawMain() {
  const L = SAFE.l + 8, R = W - SAFE.r - 8, T = SAFE.t + 6, B = H - SAFE.b - 6;
  text("SLUGGER", L, T + 2, UIC.gold, { scale: 2, outline: true });
  topCoins();
  const h = save.heroes[save.hero];
  text(`${HERO_INFO[save.hero].name}  LV ${h.level}`, R, T + 22, UIC.ink, { align: "right" });
  // hero + play
  const bw = Math.min(150, Math.round((R - L) * 0.36));
  heroSprite(save.hero, L + 40, B - 40, 2);
  button("play", L + 76, T + 40, bw, 48, "PLAY", () => openScreen("map"), { scale: 2, fill: "#5a2a1a", border: UIC.gold });
  const sOk = !!save.missions[1]?.done;
  button("surv", L + 76, T + 94, bw, 30, sOk ? `SURVIVAL\nBEST WAVE ${save.survival.best}` : "SURVIVAL\n🔒 CLEAR MISSION 1", () => beginSurvival(), { enabled: sOk });
  // daily panel
  ensureDaily();
  const px = L + 82 + bw, pw = R - px, py = T + 34;
  frame(px, py, pw, 96);
  text("DAILY TASKS", px + 6, py + 6, UIC.green);
  text(`STREAK ${save.daily.streak}`, px + pw - 6, py + 6, UIC.orange, { align: "right" });
  save.daily.tasks.forEach((t, i) => {
    const def = DAILY_POOL.find(d => d.id === t.id), y = py + 20 + i * 25, prog = dailyProgress(t);
    const lines = wrapText(def.text(t.n), pw - 12);
    text(lines[0], px + 6, y, t.done ? UIC.dim : UIC.ink);
    bar(px + 6, y + 11, pw - 46, 4, prog / t.n, t.done ? UIC.green : UIC.gold);
    text(t.done ? "✓" : `${def.reward} ¤`, px + pw - 6, y + 9, t.done ? UIC.green : UIC.gold, { align: "right" });
  });
  // bottom row
  const items = [["armory", "ARMORY"], ["soldiers", "SOLDIERS"], ["awards", "AWARDS"], ["records", "RECORDS"], ["settings", "SETTINGS"]];
  const gap = 4, w = Math.floor((R - L - gap * (items.length - 1)) / items.length), y = B - 26;
  items.forEach(([id, label], i) => {
    let lab = label;
    if (id === "armory" && ARMORY.some(a => armoryCost(a.id) !== null && save.coins >= armoryCost(a.id))) lab = label + " !";
    if (id === "awards") lab = `${label} ${Object.keys(save.achievements).length}/${ACHIEVEMENTS.length}`;
    button(id, L + i * (w + gap), y, w, 24, lab, () => openScreen(id));
  });
}

// ---------- Map + briefing ----------
const MAP_COLORS = { desert: "#c99c5c", jungle: "#4a7a3a", snow: "#d4dcea", city: "#3a3e52", harbor: "#2a5a7a", fortress: "#6a2a1e" };
function mapNodes() {
  const L = SAFE.l + 46, R = W - SAFE.r - 46, T = SAFE.t + 52, B = H - SAFE.b - 48;
  return MISSIONS.map((m, i) => ({ m, x: Math.round(lerp(L, R, i / 5)), y: Math.round(i % 2 ? lerp(T, B, 0.75) : lerp(T, B, 0.2)) }));
}
function drawMap() {
  title("WORLD MAP"); backButton(); topCoins();
  const nodes = mapNodes();
  const band = (W - SAFE.l - SAFE.r) / 6;
  nodes.forEach((n, i) => { g.globalAlpha = 0.35; g.fillStyle = MAP_COLORS[n.m.theme]; g.fillRect(Math.round(SAFE.l + i * band), SAFE.t + 34, Math.ceil(band), H - SAFE.t - SAFE.b - 40); g.globalAlpha = 1; });
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1], n = 18;
    for (let k = 0; k <= n; k += 2) { g.fillStyle = save.unlocked > i + 1 ? UIC.gold : "#5a4a46"; g.fillRect(Math.round(lerp(a.x, b.x, k / n)), Math.round(lerp(a.y, b.y, k / n)), 2, 2); }
  }
  for (const n of nodes) {
    const id = n.m.id, locked = id > save.unlocked, rec = save.missions[id];
    const sz = 32;
    button("m" + id, n.x - sz / 2, n.y - sz / 2, sz, sz, locked ? "🔒" : String(id), () => { briefId = id; screen = "brief"; screenT = 0; uiFocus = -1; }, { enabled: !locked, scale: 2, fill: locked ? "#1a1416" : "#3a2420", border: rec?.done ? UIC.gold : UIC.line });
    const nl = n.m.name.split(" ");
    g.fillStyle = "rgba(20,14,16,0.45)"; g.fillRect(n.x - Math.max(...nl.map(s => textW(s))) / 2 - 3, n.y + 18, Math.max(...nl.map(s => textW(s))) + 6, nl.length * 9 + 2);
    nl.forEach((w, k) => text(w, n.x, n.y + 20 + k * 9, locked ? "#8a7a72" : UIC.ink, { align: "center" }));
    if (!locked) starsRow(n.x - 13, n.y + 21 + nl.length * 9, rec?.stars || [false, false, false]);
    if (rec?.rank) text(rec.rank, n.x + 14, n.y - 26, UIC.orange, { outline: true });
  }
  if (save.hardUnlocked) button("hard", W - SAFE.r - 98, H - SAFE.b - 26, 90, 20, save.hard ? "HARD: ON" : "HARD: OFF", () => { save.hard = !save.hard; persist(); }, { fill: save.hard ? "#6a1a1a" : UIC.bg2 });
}
function drawBrief() {
  dim(0.6);
  const m = MISSIONS[briefId - 1], rec = save.missions[briefId] || {};
  const w = Math.min(320, W - SAFE.l - SAFE.r - 20), h = Math.min(176, H - 20), x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
  frame(x, y, w, h, UIC.bg, UIC.gold);
  text(`MISSION ${m.id}`, x + 10, y + 8, UIC.dim);
  text(m.name, x + 10, y + 20, UIC.gold, { scale: 2 });
  text(`BOSS: ${BOSSES[m.boss].name}`, x + 10, y + 40, UIC.red);
  const st = rec.stars || [false, false, false];
  const labels = ["FREE EVERY PRISONER", "LOSE NO LIVES", `FINISH UNDER ${fmtTime(m.par)}`];
  labels.forEach((l, i) => { text(st[i] ? "★" : "☆", x + 10, y + 58 + i * 12, st[i] ? UIC.gold : "#6a5a56"); text(l, x + 22, y + 58 + i * 12, st[i] ? UIC.ink : UIC.dim); });
  const tags = (rec.tags || []).filter(Boolean).length;
  text(`DOG TAGS ${tags}/3`, x + 10, y + 98, UIC.blue);
  text(`BEST ${rec.bestScore ? fmtNum(rec.bestScore) : "-"}`, x + w - 10, y + 58, UIC.ink, { align: "right" });
  text(`TIME ${rec.bestTime ? fmtTime(rec.bestTime) : "-"}`, x + w - 10, y + 70, UIC.ink, { align: "right" });
  if (rec.rank) text(`RANK ${rec.rank}`, x + w - 10, y + 82, UIC.orange, { align: "right" });
  if (save.hard) text("HARD MODE: TOUGHER ENEMIES, x1.5 COINS", x + 10, y + 112, UIC.red);
  button("start", x + w - 120, y + h - 36, 110, 28, "START ▶", () => beginMission(briefId), { scale: 1, fill: "#5a2a1a", border: UIC.gold });
  button("bclose", x + 10, y + h - 36, 70, 28, "BACK", () => backFromScreen());
}

// ---------- Armory ----------
function drawArmory() {
  title("ARMORY"); backButton(); topCoins();
  const L = SAFE.l + 8, R = W - SAFE.r - 8, T = SAFE.t + 34, B = H - SAFE.b - 6;
  const cols = 2, gap = 6, cw = Math.floor((R - L - gap) / cols), ch = Math.floor((B - T - gap * 2) / 3);
  ARMORY.forEach((a, i) => {
    const x = L + (i % cols) * (cw + gap), y = T + Math.floor(i / cols) * (ch + gap), lvl = save.armory[a.id], cost = armoryCost(a.id);
    frame(x, y, cw, ch);
    text(a.name, x + 6, y + 5, UIC.gold);
    for (let k = 0; k < 5; k++) { g.fillStyle = k < lvl ? UIC.green : "#3a2c30"; g.fillRect(x + cw - 8 - (5 - k) * 7, y + 6, 5, 6); }
    const lines = wrapText(a.desc(lvl), cw - 76);
    lines.slice(0, 2).forEach((l, j) => text(l, x + 6, y + 17 + j * 10, UIC.ink));
    if (cost !== null) text(`NEXT: ${a.short(lvl + 1)}`.slice(0, Math.floor((cw - 72) / 8)), x + 6, y + ch - 12, UIC.dim);
    const can = cost !== null && save.coins >= cost;
    button("buy" + a.id, x + cw - 66, y + ch - 26, 60, 20, cost === null ? "MAX" : `${cost} ¤`, () => { if (buyArmory(a.id)) { sfx.buy(); toast(`${a.name} LV ${save.armory[a.id]}`, UIC.green); } else sfx.deny(); }, { enabled: cost !== null, fill: can ? "#2a4a1a" : UIC.bg2, sound: false });
  });
}

// ---------- Soldiers ----------
function drawSoldiers() {
  title("SOLDIERS"); backButton(); topCoins();
  const L = SAFE.l + 8, R = W - SAFE.r - 8, T = SAFE.t + 34, B = H - SAFE.b - 6;
  const gap = 5, cw = Math.floor((R - L - gap * 3) / 4), ch = B - T;
  HERO_INFO.forEach((info, i) => {
    const x = L + i * (cw + gap), y = T, h = save.heroes[i], sel = save.hero === i;
    frame(x, y, cw, ch, sel ? "#3a2420" : UIC.bg, sel ? UIC.gold : UIC.line);
    text(info.name, x + cw / 2, y + 5, sel ? UIC.gold : UIC.ink, { align: "center" });
    if (h.unlocked) text(`LV ${h.level}`, x + cw / 2, y + 15, UIC.dim, { align: "center" });
    if (h.unlocked) heroSprite(i, x + cw / 2 - 2, y + 82, 2, h.costume, sel ? realClock : null);
    else { g.globalAlpha = 0.35; heroSprite(i, x + cw / 2 - 2, y + 82, 2, 0); g.globalAlpha = 1; text("🔒", x + cw / 2 - 3, y + 50, UIC.ink); }
    const lines = wrapText(info.perkText(h.level), cw - 8);
    lines.slice(0, 2).forEach((l, j) => text(l, x + cw / 2, y + 88 + j * 9, UIC.green, { align: "center" }));
    if (h.unlocked) {
      if (h.level < MAX_LEVEL) bar(x + 6, y + 108, cw - 12, 3, h.xp / xpToNext(h.level), UIC.blue);
      const look = HERO_LOOKS[i], c = h.costume, unlockedC = COSTUME_LEVELS[c] <= h.level;
      button("cl" + i, x + 4, y + 114, 14, 16, "←", () => { h.costume = (h.costume + 3) % 4; persist(); }, { sound: true });
      button("cr" + i, x + cw - 18, y + 114, 14, 16, "→", () => { h.costume = (h.costume + 1) % 4; persist(); }, { sound: true });
      text(look.costumes[c].slice(0, Math.floor((cw - 36) / 8)), x + cw / 2, y + 118, unlockedC ? UIC.ink : "#6a5a56", { align: "center" });
      if (!unlockedC) text(`LV ${COSTUME_LEVELS[c]}`, x + cw / 2, y + 128, UIC.red, { align: "center" });
      button("sel" + i, x + 4, y + ch - 24, cw - 8, 20, sel ? "SELECTED" : "SELECT", () => { if (unlockedC) { save.hero = i; persist(); } else sfx.deny(); }, { enabled: !sel, fill: sel ? "#2a4a1a" : UIC.bg2 });
      if (!unlockedC && sel) { h.costume = [3, 2, 1, 0].find(k => COSTUME_LEVELS[k] <= h.level) ?? 0; }
    } else {
      wrapText(`CLEAR MISSION ${info.unlockMission} OR BUY`, cw - 8).forEach((l, j) => text(l, x + cw / 2, y + 110 + j * 10, UIC.dim, { align: "center" }));
      button("unl" + i, x + 4, y + ch - 24, cw - 8, 20, `${info.cost} ¤`, () => { if (buyHero(i)) { sfx.buy(); toast(`${info.name} JOINED THE SQUAD!`, UIC.blue); } else sfx.deny(); }, { enabled: save.coins >= info.cost, sound: false });
    }
  });
}

// ---------- Awards ----------
function drawAwards() {
  title("AWARDS"); backButton(); topCoins();
  const L = SAFE.l + 8, R = W - SAFE.r - 8, T = SAFE.t + 34, B = H - SAFE.b - 6;
  const done = Object.keys(save.achievements).length;
  text(`${done}/${ACHIEVEMENTS.length} UNLOCKED`, L, T - 8, UIC.dim);
  const rowH = 24, cols = 2, cw = Math.floor((R - L - 6) / cols), rows = Math.ceil(ACHIEVEMENTS.length / cols);
  const off = scrollArea("awards", L, T, R - L, B - T, rows * rowH);
  g.save(); g.beginPath(); g.rect(L, T, R - L, B - T); g.clip();
  ACHIEVEMENTS.forEach((a, i) => {
    const x = L + (i % cols) * (cw + 6), y = T + Math.floor(i / cols) * rowH - off, got = !!save.achievements[a.id];
    if (y + rowH < T || y > B) return;
    frame(x, y, cw - 4, rowH - 3, got ? "#2c2a18" : UIC.bg, got ? "#8a7a30" : UIC.line);
    text(got ? "★" : "☆", x + 4, y + 7, got ? UIC.gold : "#5a4a46");
    text(a.name, x + 15, y + 3, got ? UIC.gold : UIC.ink);
    text(a.desc.slice(0, Math.floor((cw - 50) / 8)), x + 15, y + 12, UIC.dim);
    text(`${a.reward} ¤`, x + cw - 8, y + 3, got ? UIC.dim : UIC.gold, { align: "right" });
  });
  g.restore();
}

// ---------- Records ----------
function drawRecords() {
  title("RECORDS"); backButton(); topCoins();
  const L = SAFE.l + 8, R = W - SAFE.r - 8, T = SAFE.t + 34, B = H - SAFE.b - 6;
  const rowH = 14, s = save.stats;
  const rows = MISSIONS.length + 12;
  const off = scrollArea("records", L, T, R - L, B - T, rows * rowH + 20);
  g.save(); g.beginPath(); g.rect(L, T, R - L, B - T); g.clip();
  let y = T - off;
  const colX = [L, L + 22, L + Math.round((R - L) * 0.42), L + Math.round((R - L) * 0.6), L + Math.round((R - L) * 0.74), L + Math.round((R - L) * 0.88)];
  ["#", "MISSION", "BEST", "TIME", "RANK", "TAGS"].forEach((h, i) => text(h, colX[i], y, UIC.dim));
  y += rowH;
  for (const m of MISSIONS) {
    const r = save.missions[m.id] || {};
    text(String(m.id), colX[0], y, UIC.gold); text(m.name, colX[1], y, r.done ? UIC.ink : "#6a5a56");
    text(r.bestScore ? fmtNum(r.bestScore) : "-", colX[2], y, UIC.ink); text(r.bestTime ? fmtTime(r.bestTime) : "-", colX[3], y, UIC.ink);
    text(r.rank || "-", colX[4], y, UIC.orange); text(`${(r.tags || []).filter(Boolean).length}/3`, colX[5], y, UIC.blue);
    y += rowH;
  }
  y += 6;
  const stats = [["SURVIVAL BEST WAVE", save.survival.best], ["SURVIVAL BEST SCORE", fmtNum(save.survival.bestScore)], ["ENEMIES DEFEATED", fmtNum(s.kills)], ["PRISONERS FREED", fmtNum(s.pows)],
    ["BOSSES DEFEATED", s.bosses], ["VEHICLES DESTROYED", s.vehicles], ["BEST COMBO", "x" + s.bestCombo], ["DOG TAGS FOUND", s.secrets], ["DEATHS", s.deaths], ["COINS EARNED", fmtNum(s.coinsEarned)], ["TIME PLAYED", fmtTime(s.playTime)]];
  for (const [k, v] of stats) { text(k, L, y, UIC.dim); text(String(v), R - 8, y, UIC.ink, { align: "right" }); y += rowH; }
  g.restore();
}

// ---------- Settings ----------
function toggleRow(id, x, y, w, label, val, onTap) {
  text(label, x, y + 6, UIC.ink);
  button(id, x + w - 56, y, 56, 18, val ? "ON" : "OFF", onTap, { fill: val ? "#2a4a1a" : UIC.bg2, textColor: val ? UIC.green : UIC.dim });
}
function stepRow(id, x, y, w, label, val, steps, fmt, onSet) {
  text(label, x, y + 6, UIC.ink);
  const i = steps.indexOf(steps.reduce((a, b) => Math.abs(b - val) < Math.abs(a - val) ? b : a));
  button(id + "-", x + w - 92, y, 18, 18, "-", () => onSet(steps[Math.max(0, i - 1)]));
  text(fmt(steps[i]), x + w - 47, y + 6, UIC.gold, { align: "center" });
  button(id + "+", x + w - 18, y, 18, 18, "+", () => onSet(steps[Math.min(steps.length - 1, i + 1)]));
}
function drawSettings() {
  title("SETTINGS");
  button("back", SAFE.l + 6, SAFE.t + 6, 54, 20, "← BACK", () => backFromScreen());
  const s = save.settings, L = SAFE.l + 10, R = W - SAFE.r - 10, T = SAFE.t + 34, B = H - SAFE.b - 6;
  const gap = 12, cw = Math.floor((R - L - gap) / 2), rh = 22;
  const off = scrollArea("settings", L - 4, T, R - L + 8, B - T, rh * 9 + 10);
  g.save(); g.beginPath(); g.rect(L - 4, T, R - L + 8, B - T); g.clip();
  let y = T - off;
  const c2 = L + cw + gap;
  text("GAMEPLAY", L, y, UIC.dim); text("CONTROLS", c2, y, UIC.dim); y += 12;
  const pct = v => `${Math.round(v * 100)}%`;
  toggleRow("af", L, y, cw, "AUTO-FIRE", autoFireOn(), () => { s.autoFire = !autoFireOn(); invalidateLayout(); persist(); });
  stepRow("cs", c2, y, cw, "BUTTON SIZE", s.ctrlSize, [0.8, 0.9, 1, 1.15, 1.3], pct, v => { s.ctrlSize = v; invalidateLayout(); persist(); }); y += rh;
  toggleRow("aa", L, y, cw, "AIM ASSIST", s.aimAssist, () => { s.aimAssist = !s.aimAssist; persist(); });
  stepRow("ca", c2, y, cw, "OPACITY", s.ctrlAlpha, [0.3, 0.45, 0.6, 0.75, 0.9], pct, v => { s.ctrlAlpha = v; persist(); }); y += rh;
  toggleRow("vb", L, y, cw, "VIBRATION", s.haptics, () => { s.haptics = !s.haptics; if (s.haptics) hapticTap(true); persist(); });
  toggleRow("lh", c2, y, cw, "LEFT-HANDED", s.leftHanded, () => { s.leftHanded = !s.leftHanded; invalidateLayout(); persist(); }); y += rh;
  toggleRow("sh", L, y, cw, "SCREEN SHAKE", s.shake, () => { s.shake = !s.shake; persist(); });
  button("edit", c2, y, cw, 18, "EDIT BUTTON LAYOUT", () => { screen = "layout"; screenT = 0; }); y += rh + 6;
  text("SOUND", L, y, UIC.dim); text("SAVE DATA", c2, y, UIC.dim); y += 12;
  stepRow("mu", L, y, cw, "MUSIC", s.music, [0, 0.2, 0.4, 0.6, 0.8, 1], pct, v => { s.music = v; applyVolumes(); persist(); });
  button("copy", c2, y, cw, 18, "COPY BACKUP CODE", () => { const code = exportSave(); try { navigator.clipboard.writeText(code).then(() => toast("BACKUP CODE COPIED", UIC.green), () => toast("COPY NOT ALLOWED HERE", UIC.red)); } catch { toast("COPY NOT ALLOWED HERE", UIC.red); } }); y += rh;
  stepRow("sf", L, y, cw, "EFFECTS", s.sfx, [0, 0.2, 0.4, 0.6, 0.8, 1], pct, v => { s.sfx = v; applyVolumes(); sfx.pick(); persist(); });
  button("load", c2, y, cw, 18, "LOAD BACKUP CODE", () => { let code = null; try { code = prompt("Paste your backup code"); } catch {} if (code) { const ok = importSave(code); toast(ok ? "PROGRESS LOADED" : "THAT CODE DID NOT WORK", ok ? UIC.green : UIC.red); } }); y += rh;
  toggleRow("vo", L, y, cw, "VOICE", s.voice, () => { s.voice = !s.voice; persist(); });
  button("reset", c2, y, cw, 18, confirmReset ? "TAP AGAIN TO ERASE" : "RESET PROGRESS", () => { if (confirmReset) { resetSave(); confirmReset = false; toast("PROGRESS ERASED", UIC.red); } else { confirmReset = true; setTimeout(() => confirmReset = false, 3000); } }, { fill: confirmReset ? "#6a1a1a" : UIC.bg2, textColor: UIC.red }); y += rh;
  toggleRow("gore", L, y, cw, "BLOOD & GORE", s.gore, () => { s.gore = !s.gore; persist(); });
  g.restore();
}

// ---------- Layout editor ----------
let layoutDragging = null;
function drawLayoutEditor() {
  if (state === "play") dim(0.7); else { dim(0.3); }
  text("DRAG THE CONTROLS · THEY SAVE AUTOMATICALLY", W / 2, SAFE.t + 30, UIC.ink, { align: "center" });
  text(autoFireOn() ? "LAYOUT FOR AUTO-FIRE" : "LAYOUT FOR MANUAL FIRE", W / 2, SAFE.t + 42, UIC.dim, { align: "center" });
  drawTouchControls(true);
  button("ldone", W / 2 + 4, SAFE.t + 6, 70, 20, "DONE", () => backFromScreen());
  button("lreset", W / 2 - 74, SAFE.t + 6, 70, 20, "RESET", () => { const s = save.settings; if (s.layout) delete s.layout[layoutKey()]; invalidateLayout(); persist(); });
}
function layoutDown(p, id) {
  if (hitAt(p)) return false;
  const L = layout();
  for (const [name, b] of Object.entries(L.buttons)) if (Math.hypot(p.x - b.x, p.y - b.y) < b.r * 1.2) { layoutDragging = { pid: id, name }; return true; }
  if (Math.hypot(p.x - L.stick.x, p.y - L.stick.y) < L.stick.r * 1.2) { layoutDragging = { pid: id, name: "stick" }; return true; }
  return false;
}
function layoutMove(p, id) {
  if (!layoutDragging || layoutDragging.pid !== id) return false;
  const s = save.settings, key = layoutKey();
  s.layout = s.layout || {}; s.layout[key] = s.layout[key] || {};
  const left = s.leftHanded, isStick = layoutDragging.name === "stick";
  const fromRight = isStick ? left : !left;
  const dx = fromRight ? (W - SAFE.r - p.x) / PT : (p.x - SAFE.l) / PT, dy = (H - SAFE.b - p.y) / PT;
  s.layout[key][layoutDragging.name] = { dx: clamp(Math.round(dx), 30, (W / PT) * 0.48), dy: clamp(Math.round(dy), 30, H / PT - 40) };
  invalidateLayout();
  return true;
}
function layoutUp(id) { if (layoutDragging && layoutDragging.pid === id) { layoutDragging = null; persist(); return true; } return false; }

// ---------- Touch controls ----------
const circleCache = new Map();
function ring(x, y, r, fill, edge, alpha) {
  g.globalAlpha = alpha;
  pcirc(g, x, y, r, edge); pcirc(g, x, y, r - 1, fill);
  g.globalAlpha = 1;
}
// The touch controls are drawn after the pixel buffer is upscaled, straight onto the full-resolution
// canvas, so they look like native iOS controls (smooth glass, vector glyphs) rather than pixel art.
let hdControls = null;
const glassCache = new Map();
function drawTouchControls(editing = false) {
  if (!editing && (!touchUI || !inPlayControls() || screen === "layout")) return;   // drawn on top, so never over menus
  hdControls = { editing };
}
const BTN_TINT = { fire: [255, 96, 82], jump: [110, 168, 255], bomb: [150, 222, 106] };
function drawControlsHD(c) {
  const req = hdControls; hdControls = null;
  if (!req) return;
  const editing = req.editing, L = layout(), a = save.settings.ctrlAlpha, S = K;
  const X = x => OX + x * S, Y = y => OY + y * S, d = DPR;
  const held = new Set([...btnTouch.values()].map(t => t.name));
  c.save(); c.imageSmoothingEnabled = true; c.lineCap = "round"; c.lineJoin = "round";
  // glass discs are rendered once per size/state into a cache: canvas blur shadows are slow on iOS
  const glass = (x, y, r, tint, on, name) => {
    const key = `${name}|${Math.round(r)}|${on}`, pad = Math.ceil(16 * d);
    let cv = glassCache.get(key);
    if (!cv) {
      cv = document.createElement("canvas"); cv.width = cv.height = Math.ceil(r * 2 + pad * 2);
      const cc = cv.getContext("2d"), m = cv.width / 2;
      cc.lineCap = "round";
      paintGlass(cc, m, m, r, tint, on, d);
      if (name) icon(name, m, m - (name === "bomb" ? r * 0.08 : 0), r, cc);
      glassCache.set(key, cv);
      if (glassCache.size > 40) glassCache.delete(glassCache.keys().next().value);
    }
    c.drawImage(cv, Math.round(x - cv.width / 2), Math.round(y - cv.height / 2));
  };
  const paintGlass = (c, x, y, r, tint, on, d) => {
    const [tr, tg, tb] = tint;
    c.save();
    c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 10 * d; c.shadowOffsetY = 3 * d;
    const gr = c.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
    gr.addColorStop(0, on ? `rgba(${tr},${tg},${tb},0.75)` : "rgba(255,255,255,0.30)");
    gr.addColorStop(1, on ? `rgba(${tr * 0.5 | 0},${tg * 0.5 | 0},${tb * 0.5 | 0},0.70)` : "rgba(18,20,26,0.55)");
    c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.restore();
    c.lineWidth = 2 * d; c.strokeStyle = `rgba(${tr},${tg},${tb},${on ? 1 : 0.85})`;
    c.beginPath(); c.arc(x, y, r - d, 0, TAU); c.stroke();
    c.lineWidth = 1.2 * d; c.strokeStyle = "rgba(255,255,255,0.35)";
    c.beginPath(); c.arc(x, y, r - 3.5 * d, Math.PI * 1.1, Math.PI * 1.9); c.stroke();   // top sheen
  };
  const icon = (name, x, y, r, c) => {
    c.strokeStyle = c.fillStyle = "rgba(255,255,255,0.95)"; c.lineWidth = Math.max(2 * d, r * 0.12);
    const s = r * 0.42;
    if (name === "jump") { c.beginPath(); c.moveTo(x - s, y + s * 0.35); c.lineTo(x, y - s * 0.55); c.lineTo(x + s, y + s * 0.35); c.stroke();
      c.globalAlpha *= 0.55; c.beginPath(); c.moveTo(x - s * 0.7, y + s * 0.95); c.lineTo(x, y + s * 0.3); c.lineTo(x + s * 0.7, y + s * 0.95); c.stroke(); c.globalAlpha /= 0.55; }
    else if (name === "fire") { c.beginPath(); c.arc(x, y, s * 0.75, 0, TAU); c.stroke();
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(x + ux * s * 0.45, y + uy * s * 0.45); c.lineTo(x + ux * s * 1.15, y + uy * s * 1.15); c.stroke(); }
      c.beginPath(); c.arc(x, y, s * 0.12, 0, TAU); c.fill(); }
    else if (name === "bomb") { c.beginPath(); c.ellipse(x, y + s * 0.2, s * 0.62, s * 0.78, 0, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(x - s * 0.25, y - s * 0.62); c.lineTo(x + s * 0.25, y - s * 0.62); c.stroke();
      c.beginPath(); c.moveTo(x + s * 0.2, y - s * 0.55); c.quadraticCurveTo(x + s * 0.85, y - s * 0.7, x + s * 0.7, y + s * 0.05); c.stroke(); }
  };
  // joystick: appears under the thumb; at rest it shows where to put it
  const st = L.stick, live = stick && !editing, base = live ? { x: stick.ox, y: stick.oy } : st;
  const bx = X(base.x), by = Y(base.y), br = st.r * S;
  c.globalAlpha = live ? Math.min(1, a + 0.2) : a * 0.85;
  c.fillStyle = "rgba(18,20,26,0.35)"; c.beginPath(); c.arc(bx, by, br, 0, TAU); c.fill();
  c.lineWidth = 1.5 * d; c.strokeStyle = "rgba(255,255,255,0.45)"; c.beginPath(); c.arc(bx, by, br - d, 0, TAU); c.stroke();
  c.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 4; i++) { const ang = i * Math.PI / 2, cx = bx + Math.cos(ang) * br * 0.72, cy = by + Math.sin(ang) * br * 0.72, s = br * 0.09;
    c.beginPath(); c.moveTo(cx + Math.cos(ang) * s, cy + Math.sin(ang) * s); c.lineTo(cx + Math.cos(ang + 2.3) * s, cy + Math.sin(ang + 2.3) * s); c.lineTo(cx + Math.cos(ang - 2.3) * s, cy + Math.sin(ang - 2.3) * s); c.fill(); }
  let kx = base.x, ky = base.y;
  if (live) { const dx = stick.x - stick.ox, dy = stick.y - stick.oy, dd = Math.hypot(dx, dy) || 1, m = Math.min(dd, st.travel); kx += dx / dd * m; ky += dy / dd * m; }
  const kr = st.knob * S;
  c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.arc(X(kx), Y(ky) + 2.5 * d, kr, 0, TAU); c.fill();   // soft drop shadow
  const kg = c.createRadialGradient(X(kx) - kr * 0.3, Y(ky) - kr * 0.4, kr * 0.1, X(kx), Y(ky), kr);
  kg.addColorStop(0, "rgba(255,255,255,0.95)"); kg.addColorStop(1, "rgba(190,196,210,0.85)");
  c.fillStyle = kg; c.beginPath(); c.arc(X(kx), Y(ky), kr, 0, TAU); c.fill();
  // buttons
  for (const [name, b] of Object.entries(L.buttons)) {
    const on = held.has(name) || (editing && layoutDragging?.name === name);
    const x = X(b.x), y = Y(b.y), r = b.r * S * (on ? 0.93 : 1);
    c.globalAlpha = on ? Math.min(1, a + 0.35) : Math.min(1, a + 0.1);
    glass(x, y, r, BTN_TINT[name], on, name);
    if (name === "bomb" && game && P) {   // grenade count badge
      const n = String(P.inTank && tank ? tank.shells : P.bombs), bw = Math.max(18 * d, (n.length * 7 + 10) * d), bh = 15 * d, px = x + r * 0.5, py = y - r * 0.85;
      c.fillStyle = "rgba(20,22,28,0.9)"; c.beginPath(); c.roundRect(px - bw / 2, py - bh / 2, bw, bh, bh / 2); c.fill();
      c.strokeStyle = "rgba(150,222,106,0.9)"; c.lineWidth = 1.2 * d; c.stroke();
      c.fillStyle = "#fff"; c.font = `700 ${11 * d}px -apple-system, system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(n, px, py + 0.5 * d);
    }
  }
  // pause
  if (!editing) {
    const p = L.pause, x = X(p.x), y = Y(p.y), w = p.w * S, h = p.h * S;
    c.globalAlpha = 0.9; c.fillStyle = "rgba(18,20,26,0.55)"; c.beginPath(); c.roundRect(x, y, w, h, 10 * d); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.3)"; c.lineWidth = d; c.stroke();
    c.fillStyle = "#fff"; c.beginPath(); c.roundRect(x + w * 0.32, y + h * 0.28, w * 0.13, h * 0.44, 2 * d); c.roundRect(x + w * 0.55, y + h * 0.28, w * 0.13, h * 0.44, 2 * d); c.fill();
  }
  c.restore();
}

// ---------- HUD ----------
function drawHUD() {
  if (!game || !P) return;
  const L = SAFE.l + 6, T = SAFE.t + 5, R = W - SAFE.r - 6;
  // hearts + lives
  let hx = L;
  for (let i = 0; i < P.maxHp; i++) {
    const full = i < P.hp, low = P.hp === 1 && full && Math.floor(realClock * 4) % 2;
    text(full ? "♥" : "♡", hx, T, low ? "#ffffff" : full ? "#ff4a4a" : "#6a2a2a", { outline: true });
    hx += 9;
  }
  if (game.mode === "mission") { const look = HERO_LOOKS[save.hero]; spr(look.head, hx + 8, T + 9, heroPal()); text(`×${game.lives}`, hx + 14, T, UIC.ink, { outline: true }); }
  // weapon + grenades
  const inTank = P.inTank && tank;
  const wy = T + 12;
  frame(L, wy, 76, 16, "rgba(20,12,14,0.75)", UIC.line);
  if (inTank) { text("SLUG", L + 4, wy + 4, UIC.blue); bar(L + 38, wy + 6, 32, 4, tank.hp / tank.maxHp, tank.hp > 2 ? UIC.green : UIC.red); }
  else {
    const wl = P.weapon === "P" ? "P" : P.weapon, wc = ITEM_COLORS[P.weapon] || UIC.ink;
    text(wl, L + 4, wy + 4, wc); text(P.weapon === "P" ? "∞" : String(P.ammo), L + 14, wy + 4, UIC.ink);
    text(`G${inTank ? tank.shells : P.bombs}`, L + 72, wy + 4, UIC.green, { align: "right" });
  }
  // score + combo + time
  text(fmtNum(game.score), W / 2, T, UIC.ink, { align: "center", outline: true });
  if (game.mode === "survival") text(`WAVE ${game.wave}`, W / 2, T + 11, UIC.orange, { align: "center", outline: true });
  else text(fmtTime(game.time), W / 2, T + 11, game.time > game.m.par ? UIC.dim : UIC.ink, { align: "center", outline: true });
  if (game.combo >= 2) {
    const s = `COMBO x${game.combo}`, cx = W / 2, cy = T + 23, pop = Math.max(0, game.comboT - 2.2) * 2;
    text(s, cx, cy - Math.round(pop * 4), game.combo >= 20 ? UIC.orange : UIC.gold, { align: "center", outline: true });
    bar(cx - 20, cy + 10, 40, 2, game.comboT / 2.6, UIC.gold);
  }
  // coins (left of pause)
  const pl = layout().pause;
  coinsLabel(pl.x - 6, T + 2, save.coins);
  if (game.mode === "mission") { text(`POW ${game.pows}/${game.powsTotal}`, pl.x - 6, T + 13, UIC.dim, { align: "right" }); }
  // boss bar
  if (boss && !boss.enter) {
    const w = Math.min(180, W * 0.4), x = Math.round(W / 2 - w / 2), y = T + 36;
    text(bossName(), W / 2, y - 1, "#ff8a6a", { align: "center", outline: true });
    bar(x, y + 9, w, 4, boss.hp / boss.maxHp, boss.phase === 3 ? UIC.red : boss.phase === 2 ? UIC.orange : "#ffb03a");
  }
  drawTouchControls();
  // banner, announcements, hints, go arrow
  if (banner) {
    const b = banner, k = Math.min(b.t * 3, 1), out = b.t > b.dur - 0.4 ? (b.dur - b.t) / 0.4 : 1, y = Math.round(H * 0.32);
    g.globalAlpha = clamp(out, 0, 1);
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, y - 6, W, 38);
    text(b.title, W / 2 + (1 - k) * -W, y, b.red && Math.floor(realClock * 6) % 2 ? UIC.red : UIC.gold, { align: "center", scale: 2, outline: true });
    if (b.sub) text(b.sub, W / 2 + (1 - k) * W, y + 20, UIC.ink, { align: "center" });
    g.globalAlpha = 1;
  }
  if (announceMsg) {
    const a = announceMsg, k = Math.min(a.t * 6, 1);
    text(a.text, W / 2 + (1 - k) * 60, Math.round(H * 0.25), Math.floor(realClock * 10) % 2 ? a.c : "#ffffff", { align: "center", outline: true, alpha: a.t > 1.5 ? (1.8 - a.t) / 0.3 : 1 });
  }
  if (hintMsg) {
    const lines = wrapText(hintMsg.text, Math.min(W - 40, 300)), w = Math.max(...lines.map(l => textW(l))) + 14, x = Math.round(W / 2 - w / 2), y = Math.round(H * 0.42);
    g.globalAlpha = hintMsg.t > 3.6 ? (4 - hintMsg.t) / 0.4 : 1;
    frame(x, y, w, lines.length * 10 + 8, "rgba(20,30,40,0.85)", UIC.blue);
    lines.forEach((l, i) => text(l, W / 2, y + 5 + i * 10, UIC.ink, { align: "center" }));
    g.globalAlpha = 1;
  }
  if (game.mode === "mission" && (game.goT > 0 || (game.idleCam > 4 && !game.lock && !boss && game.phase === "play")) && Math.floor(realClock * 3) % 2) {
    text("GO!", R - 30, Math.round(H * 0.4), UIC.gold, { align: "center", outline: true, scale: 2 });
    text("→", R - 30, Math.round(H * 0.4) + 18, UIC.gold, { align: "center", outline: true, scale: 2 });
  }
}

// ---------- Pause ----------
function drawPause() {
  dim(0.65);
  title("PAUSED", Math.round(H * 0.12));
  const w = 150, x = Math.round(W / 2 - w / 2);
  let y = Math.round(H * 0.28);
  if (game.mode === "mission") {
    const m = game.m;
    text(`${m.name}`, W / 2, y - 12, UIC.dim, { align: "center" });
    const st = [game.pows >= game.powsTotal, game.deaths === 0, game.time <= m.par];
    starsRow(W / 2 - 13, y - 2, st);
    y += 12;
  }
  button("resume", x, y, w, 26, "RESUME", () => setPaused(false), { fill: "#2a4a1a" }); y += 30;
  if (game.mode === "mission" && game.checkpoint) { button("cp", x, y, w, 22, "RETRY CHECKPOINT", () => beginMission(game.id, game.checkpoint)); y += 26; }
  button("restart", x, y, w, 22, "RESTART", () => game.mode === "mission" ? beginMission(game.id) : beginSurvival()); y += 26;
  button("psettings", x, y, w, 22, "SETTINGS", () => { screen = "settings"; screenT = 0; uiFocus = -1; }); y += 26;
  button("quit", x, y, w, 22, game.mode === "mission" ? "QUIT TO MAP" : "QUIT", () => { const m = game.mode; persist(); state = "menu"; paused = false; musicPaused = false; game = null; setupMenuScene(); playMusic("menu"); screen = m === "mission" ? "map" : "main"; });
}

// ---------- Results ----------
function resultsDone() { return resSkip || resT > resultsLength(); }
function resultsLength() { return lastResult?.mode === "survival" ? 3.5 : 6.5; }
function once(key, fn) { if (!resSfx[key]) { resSfx[key] = true; fn(); } }
function drawResults(dt) {
  resT += dt;
  if (resSkip) resT = Math.max(resT, resultsLength() + 0.01);
  if (!menuScene) setupMenuScene();
  drawMenuBackdrop(dt); dim(0.55);
  const r = lastResult, t = resT;
  const L = Math.max(SAFE.l + 10, Math.round(W / 2 - 210)), R = Math.min(W - SAFE.r - 10, Math.round(W / 2 + 210)), T = SAFE.t + 6;
  title(r.mode === "survival" ? `WAVE ${r.wave}` : "MISSION COMPLETE!", T);
  if (r.mode === "mission") text(r.name, W / 2, T + 20, UIC.dim, { align: "center" });
  const cnt = (v, t0, d = 0.6) => Math.round(v * easeOut((t - t0) / d));
  let y = T + 34;
  const rows = r.mode === "mission"
    ? [["SCORE", fmtNum(cnt(r.score, 0.2)) + (r.best && t > 0.9 ? "  NEW BEST!" : "")], ["TIME", fmtTime(Math.min(r.time, r.time * easeOut((t - 0.35) / 0.5))) + ` / ${fmtTime(r.par)}`],
      ["ENEMIES", String(cnt(r.kills, 0.5))], ["PRISONERS", `${r.pows}/${r.powsTotal}`], ["DOG TAGS", `${r.tags}/3`], ["BEST COMBO", "x" + r.bestCombo]]
    : [["SCORE", fmtNum(cnt(r.score, 0.2)) + (r.best && t > 0.9 ? "  NEW BEST!" : "")], ["ENEMIES", String(cnt(r.kills, 0.4))], ["BEST COMBO", "x" + r.bestCombo], ["TIME", fmtTime(r.time)]];
  const colW = R - L;
  rows.forEach(([k, v], i) => {
    if (t < 0.15 + i * 0.12) return;
    once("row" + i, () => sfx.tick());
    text(k, L, y, UIC.dim); text(v, L + 96, y, k === "SCORE" && r.best ? UIC.gold : UIC.ink);
    y += 11;
  });
  let rx = R - 132;
  if (r.mode === "mission") {
    const labels = ["ALL PRISONERS", "NO LIVES LOST", "UNDER PAR"];
    r.stars.forEach((s, i) => {
      const t0 = 1.4 + i * 0.45;
      if (t < t0) return;
      const k = easeOutBack((t - t0) / 0.3), yy = T + 36 + i * 22;
      once("star" + i, () => { if (s) sfx.star(); else sfx.tick(); });
      text(s ? "★" : "☆", rx, yy, s ? UIC.gold : "#6a5a56", { scale: Math.max(1, Math.round(2 * k)), outline: true });
      text(labels[i], rx + 20, yy + 4, s ? UIC.ink : UIC.dim);
      if (r.newStars[i] && Math.floor(realClock * 4) % 2) text("NEW!", rx + 20, yy + 13, UIC.green);
    });
    if (t > 2.9) {
      once("rank", () => { sfx.cannon(); addShake(0); });
      const k = easeOutBack((t - 2.9) / 0.3);
      text("RANK", rx, T + 106, UIC.dim);
      text(r.rank, rx + 40, T + 100 - Math.round((1 - k) * 20), { S: UIC.gold, A: UIC.green, B: UIC.blue, C: UIC.ink }[r.rank], { scale: 3, outline: true });
    }
  }
  const tc = r.mode === "mission" ? 3.4 : 1.4;
  if (t > tc) {
    y = Math.max(y + 6, T + 114);
    const total = r.coinsRun + r.bonus, shown = cnt(total, tc, 1.2);
    if (t < tc + 1.2 && Math.floor(t * 20) % 2) once("c" + Math.floor(t * 10), () => sfx.coin());
    text("COINS", L, y, UIC.dim); const cw2 = coinsLabel(L + 96, y, shown, "left");
    text(`${r.coinsRun} FOUND + ${r.bonus} BONUS`, L + 104 + cw2, y, UIC.dim);
    y += 14;
  }
  const tx = tc + 1.4;
  if (t > tx) {
    const h = heroSave(), lvShown = r.levels > 0 && t > tx + 0.8 ? h.level : r.lvBefore;
    text(`${HERO_INFO[save.hero].name} LV ${lvShown}   +${r.xp} XP`, L, y, UIC.blue);
    const frac = r.levels > 0 ? (t > tx + 0.8 ? h.xp / xpToNext(h.level) : clamp((t - tx) / 0.8, 0, 1)) : lerp(r.xpBefore, h.xp, clamp((t - tx) / 0.8, 0, 1)) / xpToNext(h.level);
    bar(L, y + 11, Math.round(colW * 0.6), 4, h.level >= MAX_LEVEL ? 1 : frac, UIC.blue);
    if (r.levels > 0 && t > tx + 0.8) { once("lvl", () => sfx.levelUp()); if (Math.floor(realClock * 4) % 2) text("LEVEL UP!", L + Math.round(colW * 0.62), y + 8, UIC.green, { outline: true }); }
  }
  if (resultsDone()) {
    const bw = 104, by = H - SAFE.b - 30;
    if (r.mode === "mission") {
      const next = r.id < 6 && save.unlocked > r.id;
      button("rmap", L, by, bw, 24, "MAP", () => { state = "menu"; screen = "map"; screenT = 0; playMusic("menu"); });
      button("rretry", W / 2 - bw / 2, by, bw, 24, "RETRY", () => beginMission(r.id));
      if (next) button("rnext", R - bw, by, bw, 24, "NEXT ▶", () => beginMission(r.id + 1), { fill: "#5a2a1a", border: UIC.gold });
      else button("rarm", R - bw, by, bw, 24, "ARMORY", () => { state = "menu"; screen = "armory"; playMusic("menu"); });
    } else {
      button("rmenu", L, by, bw, 24, "MENU", () => { state = "menu"; screen = "main"; playMusic("menu"); });
      button("rarm2", W / 2 - bw / 2, by, bw, 24, "ARMORY", () => { state = "menu"; screen = "armory"; playMusic("menu"); });
      button("rretry2", R - bw, by, bw, 24, "AGAIN ▶", () => beginSurvival(), { fill: "#5a2a1a", border: UIC.gold });
    }
  } else if (Math.floor(realClock * 2) % 2) text("TAP TO SKIP", W / 2, H - SAFE.b - 14, UIC.dim, { align: "center" });
}

// ---------- Failed ----------
const TIPS = ["CROUCH UNDER HIGH SHOTS, JUMP OVER LOW ONES", "GRENADES CLEAR ENEMIES HIDING BEHIND SANDBAGS", "THE ARMORY CAN GIVE YOU MORE HEARTS", "FREE PRISONERS: THEY DROP WEAPONS AND ARMOR",
  "SHOOT DOWN HOMING MISSILES BEFORE THEY HIT YOU", "BOSSES HAVE GLOWING WEAK POINTS: x2 DAMAGE", "A RED LASER MEANS A SNIPER IS AIMING AT YOU", "WATCH FOR THE RED MARKER: A MORTAR SHELL IS COMING"];
function drawFailed() {
  if (!game) { state = "menu"; screen = "map"; return; }
  dim(0.7);   // the world under it is drawn (frozen) by the main loop
  title("MISSION FAILED", Math.round(H * 0.16));
  text(`YOU KEEP THE ${game.coins} ¤ YOU FOUND`, W / 2, Math.round(H * 0.16) + 24, UIC.gold, { align: "center" });
  const tip = TIPS[Math.floor(game.time) % TIPS.length];
  wrapText("TIP: " + tip, W - 60).forEach((l, i) => text(l, W / 2, Math.round(H * 0.16) + 40 + i * 10, UIC.blue, { align: "center" }));
  const w = 170, x = Math.round(W / 2 - w / 2);
  let y = Math.round(H * 0.5);
  if (game.checkpoint) { button("fcp", x, y, w, 26, "RETRY CHECKPOINT", () => beginMission(game.id, game.checkpoint), { fill: "#5a2a1a", border: UIC.gold }); y += 30; }
  button("fre", x, y, w, 22, "RESTART MISSION", () => beginMission(game.id)); y += 26;
  button("fmap", x, y, w, 22, "MAP", () => { game = null; state = "menu"; screen = "map"; setupMenuScene(); playMusic("menu"); });
}

// ---------- Toasts ----------
function drawToasts(dt) {
  if (!toastShown && toasts.length) toastShown = toasts.shift();
  if (!toastShown) return;
  const t = toastShown; t.t += dt;
  const k = t.t < 0.25 ? easeOut(t.t / 0.25) : t.t > 2.6 ? 1 - easeOut((t.t - 2.6) / 0.3) : 1;
  const w = Math.min(W - 20, textW(t.msg) + 16), x = Math.round(W / 2 - w / 2);
  // in play: under the HUD; on results and menus: near the bottom so it never covers a screen title
  const y = state === "results" ? Math.round(H - SAFE.b - 52 + (1 - k) * 30) : Math.round(SAFE.t + 6 - (1 - k) * 30) + (state === "play" ? 58 : 0);   // clear of the combo meter and boss bar
  frame(x, y, w, 16, "rgba(20,14,16,0.92)", t.color);
  text(t.msg, W / 2, y + 4, t.color, { align: "center" });
  if (t.t > 2.9) toastShown = null;
}
