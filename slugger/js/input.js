"use strict";
// Touch controls (floating joystick + thumb buttons), keyboard and gamepad, merged into one `input` state.
// Layout sizes are in iOS points and converted to internal pixels so buttons stay thumb-sized on every screen.

const input = { left: false, right: false, up: false, down: false, fire: false, jump: false, bomb: false,
  jumpPressed: false, bombPressed: false, pausePressed: false };
const keys = new Set();
let stick = null;                        // { id, ox, oy, x, y }
const btnTouch = new Map();              // pointerId -> { name, sy, swiped }
let touchUI = isTouch;
let upLatch = false, downLatch = false;
let pulseJump = false, pulseBomb = false, pulsePause = false;
let prevJump = false, prevBomb = false;
const padEdge = { up: false, down: false, left: false, right: false, a: false, b: false, start: false };
let padPrev = {};

const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  KeyJ: "fire", KeyZ: "fire", KeyK: "jump", KeyX: "jump", Space: "jump", KeyL: "bomb", KeyC: "bomb" };

// ---------- Layout ----------
const DEFAULT_LAYOUT = {
  auto: { jump: { dx: 72, dy: 70, r: 40 }, bomb: { dx: 156, dy: 50, r: 27 }, fire: { dx: 64, dy: 162, r: 24 } },
  classic: { fire: { dx: 72, dy: 70, r: 40 }, jump: { dx: 156, dy: 50, r: 31 }, bomb: { dx: 146, dy: 136, r: 25 } },
};
const BTN_LABEL = { jump: "JUMP", bomb: "BOMB", fire: "FIRE" };
function layoutKey() { return autoFireOn() ? "auto" : "classic"; }
function controlLayout() {
  const s = save.settings, key = layoutKey(), user = (s.layout && s.layout[key]) || {}, sz = s.ctrlSize, left = s.leftHanded;
  const buttons = {};
  for (const [name, d] of Object.entries(DEFAULT_LAYOUT[key])) {
    const u = user[name] || {};
    const dx = u.dx ?? d.dx, dy = u.dy ?? d.dy;
    buttons[name] = {
      x: left ? SAFE.l + dx * PT : W - SAFE.r - dx * PT,
      y: H - SAFE.b - dy * PT, r: d.r * PT * sz, dx, dy, primary: d.r >= 36,
    };
  }
  const st = user.stick || { dx: 88, dy: 84 };
  const stickBase = { x: left ? W - SAFE.r - st.dx * PT : SAFE.l + st.dx * PT, y: H - SAFE.b - st.dy * PT, r: 42 * PT * sz, knob: 19 * PT * sz, travel: 32 * PT * sz, dx: st.dx, dy: st.dy };
  const ps = 40 * PT;
  const pause = { x: W - SAFE.r - ps - 4, y: SAFE.t + 4, w: ps, h: ps };
  return { buttons, stick: stickBase, pause, left };
}
let layoutCache = null;
function layout() { return layoutCache || (layoutCache = controlLayout()); }
function invalidateLayout() { layoutCache = null; }

// ---------- Haptics ----------
let hapticLabel = null;
function initHaptics() {
  try {
    const sw = document.createElement("input"); sw.type = "checkbox"; sw.setAttribute("switch", ""); sw.id = "hsw";
    const lb = document.createElement("label"); lb.htmlFor = "hsw";
    for (const el of [sw, lb]) Object.assign(el.style, { position: "fixed", left: "-100px", top: "0", opacity: "0", pointerEvents: "none", width: "1px", height: "1px" });
    document.body.append(sw, lb); hapticLabel = lb;
  } catch {}
}
function hapticTap(strong = false) {
  if (!save.settings.haptics) return;
  try {
    if (navigator.vibrate) navigator.vibrate(strong ? 35 : 10);
    else if (hapticLabel) hapticLabel.click();
  } catch {}
}

// ---------- Pointer routing ----------
function toInternal(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
function inPlayControls() { return state === "play" && !paused && game && game.phase !== "failed"; }
function btnAt(p) {
  const L = layout();
  let best = null, bd = Infinity;
  for (const [name, b] of Object.entries(L.buttons)) {
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < b.r * 1.45 && d < bd) { best = name; bd = d; }
  }
  if (!best) {
    const rightZone = L.left ? p.x < W * 0.45 : p.x > W * 0.55;
    if (rightZone) best = autoFireOn() ? "jump" : "fire";
  }
  return best;
}
function pressButton(name) {
  if (name === "jump") pulseJump = true;
  if (name === "bomb") pulseBomb = true;
  hapticTap(false);
}
canvas.addEventListener("pointerdown", e => {
  e.preventDefault();
  initAudio();
  if (e.pointerType === "touch") touchUI = true;
  const p = toInternal(e);
  canvas.setPointerCapture?.(e.pointerId);
  if (!inPlayControls()) { uiPointerDown(p, e.pointerId); return; }
  const L = layout();
  if (p.x >= L.pause.x - 6 && p.y <= L.pause.y + L.pause.h + 6) { pulsePause = true; return; }
  const stickZone = L.left ? p.x > W * 0.55 : p.x < W * 0.45;
  if (stickZone && !stick) {
    const m = L.stick.r;
    stick = { id: e.pointerId, ox: clamp(p.x, SAFE.l + m, W - SAFE.r - m), oy: clamp(p.y, SAFE.t + m, H - SAFE.b - m), x: p.x, y: p.y };
    return;
  }
  const name = btnAt(p);
  if (name) { btnTouch.set(e.pointerId, { name, sy: p.y, swiped: false }); pressButton(name); }
});
canvas.addEventListener("pointermove", e => {
  const p = toInternal(e);
  if (!inPlayControls()) { uiPointerMove(p, e.pointerId); return; }
  if (stick && stick.id === e.pointerId) {
    stick.x = p.x; stick.y = p.y;
    const L = layout(), dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy), max = L.stick.travel * 1.35;
    if (d > max) { stick.ox = stick.x - dx / d * max; stick.oy = stick.y - dy / d * max; }
    return;
  }
  const t = btnTouch.get(e.pointerId);
  if (!t) return;
  // Swipe gestures on the primary fire button (classic mode): up = jump, down = grenade, without letting go
  if (t.name === "fire" && !t.swiped) {
    const dy = p.y - t.sy;
    if (dy < -18 * PT) { t.swiped = true; pulseJump = true; hapticTap(false); return; }
    if (dy > 18 * PT) { t.swiped = true; pulseBomb = true; hapticTap(false); return; }
  }
  if (t.swiped) return;
  const name = btnAt(p);
  if (name && name !== t.name) { t.name = name; t.sy = p.y; pressButton(name); }
});
function releasePointer(e) {
  if (stick && stick.id === e.pointerId) stick = null;
  btnTouch.delete(e.pointerId);
  if (!inPlayControls()) uiPointerUp(toInternal(e), e.pointerId);
}
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", e => { if (stick && stick.id === e.pointerId) stick = null; btnTouch.delete(e.pointerId); uiPointerCancel(e.pointerId); });
canvas.addEventListener("wheel", e => { uiWheel(e.deltaY); e.preventDefault(); }, { passive: false });
function releaseAllTouches() { stick = null; btnTouch.clear(); keys.clear(); }

window.addEventListener("keydown", e => {
  initAudio();
  if (e.code === "KeyM") { save.settings.music = save.settings.music > 0 ? 0 : 0.8; save.settings.sfx = save.settings.sfx > 0 ? 0 : 1; applyVolumes(); persist(); return; }
  if (e.code === "KeyP" || e.code === "Escape") { if (!e.repeat) { if (state === "play") pulsePause = true; else uiKey("back"); } e.preventDefault(); return; }
  const k = KEYMAP[e.code];
  if (!inPlayControls()) {
    if (e.repeat) return;
    if (e.code === "Enter" || k === "fire" || k === "jump") uiKey("ok");
    else if (k === "up" || k === "down" || k === "left" || k === "right") uiKey(k);
    else if (e.code === "Backspace") uiKey("back");
    if (k || e.code === "Enter") e.preventDefault();
    return;
  }
  if (!k) return;
  e.preventDefault();
  if (k === "jump" && !keys.has("jump")) pulseJump = true;
  if (k === "bomb" && !keys.has("bomb")) pulseBomb = true;
  keys.add(k);
});
window.addEventListener("keyup", e => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
window.addEventListener("blur", releaseAllTouches);

// ---------- Per-frame merge ----------
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && [...pads].find(p => p && p.connected);
  const cur = { up: false, down: false, left: false, right: false, a: false, b: false, x: false, y: false, start: false, rb: false };
  if (gp) {
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, bt = i => !!gp.buttons[i]?.pressed;
    cur.left = ax < -0.4 || bt(14); cur.right = ax > 0.4 || bt(15); cur.up = ay < -0.55 || bt(12); cur.down = ay > 0.6 || bt(13);
    cur.a = bt(0); cur.b = bt(1); cur.x = bt(2); cur.y = bt(3); cur.start = bt(9); cur.rb = bt(5) || bt(7);
    touchUI = touchUI && !gp;
  }
  for (const k of Object.keys(padEdge)) padEdge[k] = cur[k] && !padPrev[k];
  padPrev = cur;
  return gp ? cur : null;
}
function readInput() {
  const pad = pollGamepad();
  let l = keys.has("left"), r = keys.has("right"), u = keys.has("up"), d = keys.has("down");
  if (stick) {
    const L = layout(), nx = (stick.x - stick.ox) / L.stick.travel, ny = (stick.oy - stick.y) / L.stick.travel;
    if (Math.hypot(nx, ny) > 0.25) {
      l ||= nx < -0.38; r ||= nx > 0.38;
      if (!upLatch && ny > 0.62) upLatch = true; else if (upLatch && ny < 0.42) upLatch = false;
      if (!downLatch && ny < -0.68) downLatch = true; else if (downLatch && ny > -0.45) downLatch = false;
    } else { upLatch = false; downLatch = false; }
    u ||= upLatch; d ||= downLatch;
  } else { upLatch = false; downLatch = false; }
  const held = new Set([...btnTouch.values()].map(t => t.name));
  if (pad) { l ||= pad.left; r ||= pad.right; u ||= pad.up; d ||= pad.down; if (pad.x || pad.rb) held.add("fire"); if (pad.a) held.add("jump"); if (pad.b || pad.y) held.add("bomb"); }
  input.left = l; input.right = r; input.up = u; input.down = d;
  input.fire = keys.has("fire") || held.has("fire");
  input.jump = keys.has("jump") || held.has("jump");
  input.bomb = keys.has("bomb") || held.has("bomb");
  input.jumpPressed ||= pulseJump || (input.jump && !prevJump && !!pad?.a);
  input.bombPressed ||= pulseBomb || (input.bomb && !prevBomb && !!(pad?.b || pad?.y));
  input.pausePressed = pulsePause || padEdge.start;
  prevJump = input.jump; prevBomb = input.bomb;
  pulseJump = false; pulseBomb = false; pulsePause = false;
  if (!inPlayControls() && pad) {
    if (padEdge.up) uiKey("up"); if (padEdge.down) uiKey("down"); if (padEdge.left) uiKey("left"); if (padEdge.right) uiKey("right");
    if (padEdge.a) uiKey("ok"); if (padEdge.b) uiKey("back"); if (padEdge.start) uiKey(state === "play" ? "back" : "ok");
  }
}
function clearInputEdges() { pulseJump = pulseBomb = pulsePause = false; input.jumpPressed = input.bombPressed = false; }
