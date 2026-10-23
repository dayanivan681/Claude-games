"use strict";
// Boot and main loop: fixed 60 Hz simulation (same feel on 60 and 120 Hz screens), render, present.

let lastT = 0, acc = 0, saveTimer = 0, devSpeed = 1;
function boot() {
  initFont(); initHaptics(); resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { if (state === "play" && !paused) setPaused(true); persist(); } });
  ensureDaily();
  openScreen("title");
  requestAnimationFrame(loop);
}
function loop(t) {
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 0;
  lastT = t; realClock += dt;
  readInput();
  if (state === "play") {
    if (input.pausePressed && game && game.phase !== "failed") setPaused(!paused);
    if (!paused) {
      let sim = dt;
      if (slowT > 0) { slowT -= dt; sim *= 0.3; }
      acc += sim * devSpeed;
      let n = 0;
      while (acc >= STEP && n < 6 * devSpeed) { clock += STEP; stepGame(STEP); input.jumpPressed = input.bombPressed = false; acc -= STEP; n++; }
      if (n >= 6 * devSpeed) acc = 0;
      save.stats.playTime += dt;
    }
  }
  if ((state === "play" || state === "failed") && game) drawWorld(paused ? 0 : dt);
  drawUI(dt);
  present();
  musicTick();
  saveTimer += dt;
  if (saveTimer > 8) { saveTimer = 0; if (saveDirty) persist(); }
  requestAnimationFrame(loop);
}
// Developer hooks for automated tests (only with ?dev in the URL)
if (/[?&]dev\b/.test(location.search)) {
  window.__dev = {
    god() { if (P) { P.inv = 9999; P.hp = P.maxHp; } },
    speed(n) { devSpeed = n; },
    mission(id) { beginMission(id); },
    survival() { beginSurvival(); },
    toBoss() { if (!game) return; placed = []; game.locks = game.locks.filter(l => l.boss); camX = game.len - W - 2; P.x = camX + 60; },
    warp(x) { camX = x; P.x = x + 60; placed = placed.filter(s => s.x > x); game.locks = game.locks.filter(l => l.x >= x); },
    coins(n) { addCoins(n); },
    info() { return { state, screen, paused, mission: game?.id, mode: game?.mode, phase: game?.phase, camX: Math.round(camX), px: P ? Math.round(P.x) : null, py: P ? Math.round(P.y) : null, hp: P?.hp, lives: game?.lives,
      score: game?.score, enemies: enemies.map(e => e.type + "@" + Math.round(e.x) + (e.plat ? "^" : "")), boss: boss ? { kind: boss.kind, hp: Math.round(boss.hp), max: Math.round(boss.maxHp), dying: boss.dying, x: Math.round(boss.x ?? 0) } : null,
      lock: !!game?.lock, len: game?.len, wave: game?.wave, W, H, K, coins: save.coins, weapon: P?.weapon, inTank: P?.inTank }; },
    state: () => state,
    open(s) { openScreen(s); },
    tap(x, y) { const h = hitAt({ x, y }); if (h) h.onTap(); return h?.id; },
    buttons() { return uiHitsPrev.filter(h => !h.scroll).map(h => ({ id: h.id, x: Math.round(h.x + h.w / 2), y: Math.round(h.y + h.h / 2), en: h.enabled })); },
    press(id) { const h = uiHitsPrev.find(h => h.id === id); if (h && h.enabled) { h.onTap(); return true; } return false; },
  };
}
boot();
