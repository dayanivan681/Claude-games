"use strict";
// The running game: player, weapons, bullets, explosions, pickups, coins, combos, the SLUG tank,
// camera, checkpoints and mission flow. Enemies and bosses live in their own files.

let game = null, P = null, tank = null, boss = null;
let enemies = [], bullets = [], items = [], coins = [], pows = [], crates = [], barrels = [], covers = [];
let plats = [], walls = [], props = [], flags = [], hints = [], placed = [];
let parts = [], booms = [], corpses = [], popups = [], blasts = [], decals = [];
let camX = 0, shake = 0, hitstop = 0, slowT = 0, hurtFlash = 0;
let banner = null, announceMsg = null;
let progressDirty = false;

const WEAPONS = {
  P: { name: "PISTOL", cd: 0.17, ammo: Infinity },
  H: { name: "HEAVY MACHINE GUN", cd: 0.065, ammo: 200, voice: "Heavy machine gun!" },
  R: { name: "ROCKET LAUNCHER", cd: 0.42, ammo: 30, voice: "Rocket launcher!" },
  F: { name: "FLAME SHOT", cd: 0.38, ammo: 30, voice: "Flame shot!" },
  S: { name: "SHOTGUN", cd: 0.6, ammo: 30, voice: "Shotgun!" },
};
const ITEM_COLORS = { H: "#ffd34d", R: "#ff7a4a", F: "#ffa02a", S: "#7ad0ff", B: "#8ae06a" };
const dmgMul = () => 1 + save.armory.power * 0.12;
const ammoMul = () => 1 + save.armory.ammo * 0.2 + heroPerk("ammo");
const sx = x => Math.round(x - camX);
const sy = y => Math.round(H - y);

function resetWorld() {
  enemies = []; bullets = []; items = []; coins = []; pows = []; crates = []; barrels = []; covers = [];
  plats = []; walls = []; props = []; flags = []; hints = []; placed = [];
  parts = []; booms = []; corpses = []; popups = []; blasts = []; decals = [];
  tank = null; boss = null; camX = 0; shake = 0; hitstop = 0; slowT = 0; hurtFlash = 0; banner = null; announceMsg = null;
}

function mkPlayer(x, y = GROUND) {
  const a = save.armory, hp = maxHpFor(a.armor);
  const p = { x, y, vx: 0, vy: 0, face: 1, onGround: y <= GROUND, crouch: false, aim: "f", moving: false, runT: 0,
    hp, maxHp: hp, weapon: "P", ammo: Infinity, bombs: 10 + a.bombs * 2 + heroPerk("bombs"),
    fireCD: 0, shootT: 0, knifeT: 0, throwT: 0, inv: 0, dead: false, deadT: 0, inTank: false, enterCD: 0,
    dropT: 0, airT: 0, turnT: 0 };
  if (a.start) { p.weapon = "H"; p.ammo = 40 * a.start; }
  return p;
}

// ---------- Starting runs ----------
function startMission(id, checkpoint = null) {
  resetWorld();
  const m = MISSIONS[id - 1];
  game = { mode: "mission", id, m, theme: THEMES[m.theme], hard: save.hard, diff: id - 1 + (save.hard ? 2 : 0),
    time: checkpoint?.time || 0, score: checkpoint?.score || 0, kills: checkpoint?.kills || 0, pows: checkpoint?.pows || 0, powsTotal: 0,
    coins: checkpoint?.coins || 0, deaths: checkpoint?.deaths || 0, hits: checkpoint?.hits || 0, combo: 0, comboT: 0, bestCombo: 0,
    lives: 3, checkpoint, phase: "intro", phaseT: 0, len: 0, locks: [], lock: null, bossDone: false, goT: 0, idleCam: 0,
    tagsTotal: 0, tagsRun: 0, xpRun: 0, coinCheck: 0 };
  buildMission(game);
  const startX = checkpoint ? checkpoint.x - 70 : 0;
  if (checkpoint) {
    const keep = o => (o.x ?? 0) >= startX - 20;
    placed = placed.filter(keep); pows = pows.filter(keep); crates = crates.filter(keep); barrels = barrels.filter(keep);
    items = items.filter(keep); hints = hints.filter(keep); game.locks = game.locks.filter(l => l.x >= startX);
    for (const f of flags) if (f.x <= checkpoint.x) f.reached = true;
  }
  camX = startX;
  P = mkPlayer(camX + 90, checkpoint ? 170 : GROUND);
  if (checkpoint) { P.onGround = false; P.inv = 2; }
  banner = { title: `MISSION ${id}`, sub: m.name + (save.hard ? "  ·  HARD" : ""), t: 0, dur: 2.8 };
  playMusic(game.theme.music);
  say(`Mission ${id}. Start!`);
}
function startSurvival() {
  resetWorld();
  const unlockedThemes = MISSIONS.filter(m => save.missions[m.id]?.done).map(m => m.theme);
  const th = unlockedThemes.length ? pick(unlockedThemes) : "desert";
  game = { mode: "survival", theme: THEMES[th], hard: false, diff: 0, time: 0, score: 0, kills: 0, pows: 0, powsTotal: 0,
    coins: 0, deaths: 0, hits: 0, combo: 0, comboT: 0, bestCombo: 0, lives: 1, phase: "intro", phaseT: 0, len: W,
    locks: [], lock: { x: 0, survival: true }, wave: 0, waveT: 2.5, waveLeft: [], goT: 0, idleCam: 0, tagsTotal: 0, tagsRun: 0, xpRun: 0, coinCheck: 0 };
  buildSurvivalArena(game);
  camX = 0;
  P = mkPlayer(W * 0.3);
  banner = { title: "SURVIVAL", sub: "HOW LONG CAN YOU LAST?", t: 0, dur: 2.6 };
  playMusic("survival");
  say("Survival. Start!");
}

// ---------- Effects ----------
function part(x, y, vx, vy, life, c, s = 2, gr = 0, kind = "sq") { if (parts.length < 600) parts.push({ x, y, vx, vy, life, max: life, c, s, g: gr, kind }); }
function sparks(x, y, n, c, sp) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), v = rand(0.3, 1) * sp; part(x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.2, 0.45), c, chance(0.5) ? 1 : 2, -300); } }
function smoke(x, y, n, s = 4) { for (let i = 0; i < n; i++) part(x + rand(-5, 5), y + rand(-4, 6), rand(-12, 12), rand(10, 32), rand(0.6, 1.2), pick(["#5a5550", "#6e6862", "#47423e"]), s, 0, "smoke"); }
function debris(x, y, n, c) { for (let i = 0; i < n; i++) part(x, y, rand(-90, 90), rand(60, 200), rand(0.5, 0.9), c, ri(2, 3), GRAV * 0.8, "deb"); }
function dust(x, y, n) { for (let i = 0; i < n; i++) part(x + rand(-4, 4), y + 1, rand(-30, 30), rand(5, 25), rand(0.25, 0.45), game?.theme.dust || "#d8c8a0", 2, 0, "smoke"); }
function muzzle(x, y, big = false) { part(x, y, 0, 0, 0.06, "#fff3a0", big ? 9 : 6, 0, "flash"); light(x, y, big ? 50 : 30, 0.07); }
function popup(x, y, txt, c = "#fff") { popups.push({ x, y, text: txt, c, t: 0 }); }
function announce(txt, c = "#ffd34d") { announceMsg = { text: txt, c, t: 0 }; }
let lights = [];
function light(x, y, r, life, c = "#ffd890") { if (lights.length < 40) lights.push({ x, y, r, life, max: life, c }); }
function addShake(v) { if (save.settings.shake) shake = Math.max(shake, v); }
function boom(x, y, size) {
  const blobs = [], n = 3 + Math.round(size * 3);
  for (let i = 0; i < n; i++) blobs.push({ dx: rand(-1, 1) * size * 7, dy: rand(0, 1) * size * 9, r: rand(5, 9), d: i === 0 ? 0 : rand(0, 0.16) });
  booms.push({ x, y, t: 0, dur: 0.45 + size * 0.1, size, blobs });
  light(x, y + 8, 30 + size * 30, 0.35 + size * 0.1, "#ffb060");
}
function explode(x, y, R, dmg, team, size = 1, src = "G") {
  boom(x, y, size); sfx.boom(size > 1.6); addShake(1.5 + size * 1.6);
  smoke(x, y + 6, 2 + Math.round(size * 2), 4); sparks(x, y + 4, 6 + size * 3, "#ffd34d", 170);
  if (y <= GROUND + 6 && decals.length < 50) decals.push({ x, w: 10 + size * 8 });
  if (size > 1.5) vibrate(40);
  if (team === "p") {
    for (const e of enemies) {
      if (e.dead) continue;
      const d = distBox(x, y, ebox(e));
      if (d < R) damageEnemy(e, dmg, "boom", x, src);
      else if (d < R + 36 && e.soldier && !e.plat && e.state === "act" && chance(0.5)) e.panic = 0.8;
    }
    bossBlast(x, y, R, dmg);
    for (const c of crates) if (!c.dead && distBox(x, y, c) < R) damageCrate(c, dmg);
    for (const b of barrels) if (!b.dead && distBox(x, y, b) < R) damageBarrel(b, dmg);
    for (const w of walls) if (!w.dead && distBox(x, y, w) < R) damageWall(w, dmg);
  } else if (team === "e") {
    if (P.inTank) { if (distBox(x, y, tankBox()) < R) damageTank(); }
    else if (!P.dead && distBox(x, y, pBox()) < R) hurtPlayer();
  }
}

// ---------- Boxes ----------
const ROLL_T = 0.36;
const pBox = () => ({ x: P.x - 4, y: P.y, w: 8, h: P.crouch ? 13 : 24 });
const tankBox = () => ({ x: tank.x - 20, y: tank.y, w: 40, h: 30 });
const powBox = p => ({ x: p.x - 5, y: p.y, w: 10, h: 16 });
function targetPos() {
  if (P.inTank && tank) return { x: tank.x, y: tank.y + 15 };
  return { x: P.x, y: P.y + (P.crouch ? 8 : 13) };
}

// ---------- Score, combo, coins ----------
const comboMul = () => 1 + Math.min(game.combo, 40) * 0.05;
function addScore(n, x, y, color) {
  const v = Math.round(n * comboMul());
  game.score += v;
  if (x !== undefined) popup(x, y, String(v), color);
  return v;
}
function onKill(src, vehicle = false) {
  game.kills++;
  game.combo = game.comboT > 0 ? game.combo + 1 : 1; game.comboT = 2.6;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  if (game.combo >= 5 && game.combo % 10 === 0) { gainCoins(game.combo / 2, P.x, P.y + 30); announce(`COMBO x${game.combo}!`, "#ff9a4a"); sfx.levelUp(); }
  stat("kills"); stat("kills_" + src); if (vehicle) stat("vehicles");
  statMax("bestCombo", game.combo); dailyMax("combo", game.combo);
  progressDirty = true;
}
function gainCoins(n, x, y) {
  n = Math.round(n * (game.hard ? 1.5 : 1));
  if (n <= 0) return;
  const k = Math.min(n, 10);
  for (let i = 0; i < k; i++) coins.push({ x, y, vx: rand(-70, 70), vy: rand(90, 170), v: Math.floor(n / k) + (i < n % k ? 1 : 0), t: rand(0, 0.08) });
}
function updateCoins(dt) {
  const tp = targetPos();
  for (const c of coins) {
    c.t += dt;
    if (c.t < 0.4) {
      c.vy += GRAV * 0.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.y < GROUND + 2) { c.y = GROUND + 2; c.vy = Math.abs(c.vy) * 0.45; c.vx *= 0.7; }
    } else {
      const dx = tp.x - c.x, dy = tp.y - c.y, d = Math.hypot(dx, dy) || 1, sp = 140 + (c.t - 0.4) * 700;
      c.x += dx / d * Math.min(d, sp * dt); c.y += dy / d * Math.min(d, sp * dt);
      if (d < 8) { c.got = true; addCoins(c.v); game.coins += c.v; sfx.coin(); }
    }
  }
  coins = coins.filter(c => !c.got);
}

// ---------- Player damage, death, respawn ----------
function hurtPlayer() {
  if (!game || game.phase === "clear" || P.dead || P.inv > 0 || P.rollT > 0) return;
  if (P.inTank) { damageTank(); return; }
  P.hp--; game.hits++;
  hurtFlash = 0.25; hitstop = 0.06; addShake(3); vibrate(60); hapticTap(true);
  if (P.hp <= 0) return killPlayer();
  P.inv = 1.4; sfx.hurt();
  P.vy = Math.max(P.vy, 120); P.onGround = false; P.vx = -P.face * 60;
  sparks(P.x, P.y + 14, 6, "#ffffff", 110);
  if (P.hp === 1) announce("LOW HEALTH!", "#ff5a4a");
}
function killPlayer() {
  if (P.dead) return;
  if (P.inTank) ejectTank(true);
  P.dead = true; P.deadT = 0; P.vy = 170; P.vx = -P.face * 45; P.onGround = false; P.hp = 0;
  game.deaths++; stat("deaths");
  sfx.die(); addShake(4); vibrate(120);
  sparks(P.x, P.y + 12, 10, "#ffffff", 140);
  game.combo = 0; game.comboT = 0;
}
function respawn() {
  const w = P.weapon === "P" ? null : { weapon: P.weapon, ammo: P.ammo };
  P = mkPlayer(camX + 60, 175);
  P.onGround = false; P.inv = 2.5;
  if (w && !save.armory.start) { P.weapon = "P"; P.ammo = Infinity; }
}

// ---------- Player movement ----------
function movePlayerX(dx) {
  P.x += dx;
  for (const c of crates) {
    if (c.dead) continue;
    const top = c.y + c.h;
    if (P.y < top - 1 && P.y + 20 > c.y && P.x + 4 > c.x && P.x - 4 < c.x + c.w) { if (dx > 0) P.x = c.x - 4; else if (dx < 0) P.x = c.x + c.w + 4; }
  }
}
function floorAt(x, half, prevY, noPlat = false) {
  let f = GROUND;
  if (!noPlat) for (const p of plats) if (x > p.x && x < p.x + p.w && prevY >= p.y - 0.5) f = Math.max(f, p.y);
  for (const c of crates) {
    if (c.dead) continue;
    const top = c.y + c.h;
    if (x + half > c.x && x - half < c.x + c.w && prevY >= top - 0.5) f = Math.max(f, top);
  }
  return f;
}
const onRoof = () => P.y > GROUND + 0.5 && plats.some(p => Math.abs(P.y - p.y) < 0.5 && P.x > p.x && P.x < p.x + p.w);
function playerBounds() {
  let lo = camX + 6, hi = camX + W - 8;
  if (boss?.blocks && !boss.dying) hi = Math.min(hi, boss.blockX() - 6);
  return [lo, hi];
}

// What auto-fire and aim assist can see
function scanTargets() {
  const shotY = P.inTank && tank ? tank.y + 18 : P.y + (P.crouch ? 10 : 17), r = { front: false, behind: false, up: false };
  const look = (b, hostile, range = W * 0.85) => {
    const cx = b.x + b.w / 2, dx = cx - P.x;
    if (cx < camX - 4 || cx > camX + W + 4) return;
    if (shotY >= b.y - 2 && shotY <= b.y + b.h + 2 && Math.abs(dx) < range) {
      if (Math.sign(dx) === P.face || Math.abs(dx) < 6) r.front = true;
      else if (hostile && Math.abs(dx) < W * 0.55) r.behind = true;
    }
    if (hostile && b.y > P.y + 24 && Math.abs(dx) < 46) r.up = true;
  };
  for (const e of enemies) if (!e.dead && !e.harmless) look(ebox(e), true);
  for (const b of bossTargets()) look(b, true);
  for (const c of crates) if (!c.dead) look(c, false, 140);
  for (const b of barrels) if (!b.dead) look(b, false, 140);
  for (const w of walls) if (!w.dead && w.cracked) look(w, false, 140);
  for (const p of pows) if (p.state === "tied") look(powBox(p), false, 140);
  return r;
}

function updatePlayer(dt) {
  P.inv = Math.max(0, P.inv - dt); P.enterCD = Math.max(0, P.enterCD - dt); P.dropT = Math.max(0, P.dropT - dt); P.turnT = Math.max(0, P.turnT - dt);
  if (P.dead) {
    P.deadT += dt; P.x += P.vx * dt; P.vy += GRAV * dt; P.y += P.vy * dt;
    if (P.y <= GROUND) { P.y = GROUND; P.vy = 0; P.vx = 0; }
    if (P.deadT > 1.7) {
      if (game.lives > 1) { game.lives--; respawn(); }
      else { game.lives = 0; game.phase = "failed"; game.phaseT = 0; stopMusic(); jingle("fail"); say("Mission failed"); }
    }
    return;
  }
  if (P.inTank) return driveTank(dt);
  P.crouch = input.down && P.onGround;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // Dodge roll: pull down while running. Short burst of speed and no damage while rolling.
  const downEdge = input.down && !P.wasDown; P.wasDown = input.down;
  P.rollT = Math.max(0, (P.rollT || 0) - dt); P.rollCD = Math.max(0, (P.rollCD || 0) - dt);
  if (downEdge && dir && P.onGround && P.rollCD <= 0) { P.rollT = ROLL_T; P.rollCD = 0.75; P.rollDir = dir; sfx.jump(); dust(P.x, P.y, 4); }
  if (P.rollT > 0) P.crouch = true;
  else if (dir) P.face = dir;
  const speed = P.crouch ? 36 : 92 * (1 + heroPerk("speed"));
  P.vx = approach(P.vx, 0, 400 * dt);
  if (P.rollT > 0) { movePlayerX(P.rollDir * 200 * dt); if (chance(0.5)) dust(P.x, P.y, 1); }
  else movePlayerX((dir * speed + P.vx) * dt);
  if (input.jumpPressed && P.onGround && P.rollT <= 0) {
    if (input.down && onRoof()) { P.dropT = 0.3; P.onGround = false; P.vy = -40; }
    else { P.vy = 300; P.onGround = false; sfx.jump(); dust(P.x, P.y, 3); }
  }
  const prevY = P.y, wasGround = P.onGround;
  P.vy += GRAV * dt; P.y += P.vy * dt;
  P.onGround = false;
  if (P.vy <= 0) {
    const f = floorAt(P.x, 4, prevY, P.dropT > 0);
    if (P.y <= f) { P.y = f; P.vy = 0; P.onGround = true; }
  }
  if (!P.onGround) P.airT += dt;
  else { if (!wasGround && P.airT > 0.3) { sfx.land(); dust(P.x, P.y, 4); } P.airT = 0; }
  const [lo, hi] = playerBounds();
  P.x = clamp(P.x, lo, hi);
  P.moving = dir !== 0 && P.onGround;
  if (P.moving) P.runT += dt * (P.crouch ? 0.5 : 1);
  P.fireCD -= dt; P.shootT -= dt; P.knifeT -= dt; P.throwT -= dt;

  const auto = autoFireOn(), assist = save.settings.aimAssist;
  const tg = (auto || assist) ? scanTargets() : null;
  let aim = input.up ? "u" : (input.down && !P.onGround) ? "d" : "f";
  if (aim === "f" && assist && tg?.up && !tg.front && !dir) aim = "u";
  if (aim === "f" && assist && tg?.up && !tg.front && auto) aim = "u";
  P.aim = aim;
  if (auto && tg && !dir && !tg.front && tg.behind && P.turnT <= 0) { P.face = -P.face; P.turnT = 0.35; }
  const autoShot = auto && tg && ((aim === "f" && tg.front) || (aim === "u" && (tg.up || input.up)) || aim === "d");
  if ((input.fire || autoShot) && P.fireCD <= 0 && P.rollT <= 0) shoot();
  if (input.bombPressed) throwGrenade();

  if (tank && tank.state === "parked" && P.enterCD <= 0 && Math.abs(P.x - tank.x) < 14 && P.y < tank.y + 34) {
    P.inTank = true; tank.state = "driven"; tank.face = P.face; tank.flash = 0;
    sfx.slug(); announce("SLUG READY!"); say("Slug!");
    showHint("slug_in", "JUMP + DOWN TO HOP OUT");
  }
}

function knifeTarget() {
  for (const e of enemies) {
    if (e.dead || !(e.soldier || e.type === "jugg")) continue;
    const dx = e.x - P.x;
    if (Math.abs(dx) < 17 && (Math.sign(dx) === P.face || Math.abs(dx) < 6) && Math.abs(e.y - P.y) < 14) return e;
  }
  return null;
}
function addB(o) {
  const b = Object.assign({ vx: 0, vy: 0, grav: 0, life: 3, dmg: 1, r: 1.5, dead: false, acc: 0, max: 0, src: "P" }, o);
  if (b.team === "p" && (b.kind === "b" || b.kind === "hb")) b.ox = Math.sign(b.vx) * 14;
  bullets.push(b);
}
function playerPose() { return !P.onGround ? (P.vy > 0 ? "jump" : "fall") : P.crouch ? "crouch" : P.moving ? "run" : "stand"; }

function shoot() {
  const k = P.aim === "f" ? knifeTarget() : null;
  if (k) { P.knifeT = 0.22; P.fireCD = 0.28; sfx.knife(); damageEnemy(k, 3 * dmgMul(), "cut", P.x, "K"); sparks(k.x, k.y + 14, 4, "#ffffff", 80); return; }
  const wpn = WEAPONS[P.weapon];
  P.fireCD = wpn.cd; P.shootT = 0.1;
  let dx = P.face, dy = 0;
  if (P.aim === "u") { dx = 0; dy = 1; } else if (P.aim === "d") { dx = 0; dy = -1; }
  const gun = P.weapon === "P" ? "pistol" : P.weapon;
  const [mx, my] = muzzleOf(playerPose(), P.runT, P.aim, gun);
  const ox = P.x + mx * P.face, oy = P.y + my;
  const mul = dmgMul();
  switch (P.weapon) {
    case "P": addB({ kind: "b", team: "p", x: ox, y: oy, vx: dx * 340, vy: dy * 340, life: 2.2, dmg: mul * (1 + heroPerk("pistol")), src: "P" }); sfx.pistol(); break;
    case "H": {
      const j = rand(-0.07, 0.07), sp = 390;
      const vx = dx ? dx * sp * Math.cos(j) : sp * Math.sin(j), vy = dy ? dy * sp * Math.cos(j) : sp * Math.sin(j);
      addB({ kind: "hb", team: "p", x: ox, y: oy + rand(-1, 1), vx, vy, life: 2, dmg: mul, src: "H" });
      part(P.x, P.y + 15, -P.face * rand(30, 60), rand(60, 110), 0.5, "#e8c050", 1, GRAV * 0.7, "deb");
      sfx.hmg(); break;
    }
    case "S": blasts.push({ x: ox, y: oy, dx, dy, t: 0 }); shotgunHit(ox, oy, dx, dy, 6 * mul); sfx.shotgun(); addShake(2); break;
    case "R": addB({ kind: "rocket", team: "p", x: ox, y: oy, vx: dx * 90, vy: dy * 90, acc: 520, max: 320, life: 2.2, dmg: 5 * mul, src: "R" }); sfx.rocket(); break;
    case "F": addB({ kind: "flame", team: "p", x: ox, y: oy, vx: dx * 180, vy: dy * 180, life: 0.55, dmg: 2 * mul, hits: new Set(), src: "F" }); sfx.flame(); break;
  }
  muzzle(ox, oy, P.weapon !== "P");
  if (P.weapon !== "P" && --P.ammo <= 0) { P.weapon = "P"; P.ammo = Infinity; announce("OUT OF AMMO", "#cfc3b0"); }
}
function shotgunHit(x, y, dx, dy, dmg) {
  const inCone = (cx, cy) => {
    const rx = cx - x, ry = cy - y, along = rx * dx + ry * dy, across = Math.abs(rx * dy - ry * dx);
    return along > -4 && along < 78 && across < 10 + along * 0.38;
  };
  for (const e of enemies) { if (e.dead) continue; const b = ebox(e); if (inCone(b.x + b.w / 2, b.y + b.h / 2)) damageEnemy(e, dmg, "shot", x, "S"); }
  for (const c of crates) if (!c.dead && inCone(c.x + 8, c.y + 8)) damageCrate(c, dmg);
  for (const b of barrels) if (!b.dead && inCone(b.x + 6, b.y + 8)) damageBarrel(b, dmg);
  for (const w of walls) if (!w.dead && inCone(w.x + w.w / 2, w.y + w.h / 2)) damageWall(w, dmg);
  for (const p of pows) if (p.state === "tied" && inCone(p.x, p.y + 7)) freePow(p);
  for (const b of bossTargets()) if (inCone(clamp(x + dx * 40, b.x, b.x + b.w), clamp(y + dy * 40, b.y, b.y + b.h))) { hitBossBox(b, dmg); break; }
}
function throwGrenade() {
  if (P.dead || P.bombs <= 0) { if (!P.dead) sfx.deny(); return; }
  if (bullets.filter(b => b.kind === "gren").length >= 2) return;
  P.bombs--; P.throwT = 0.25; sfx.toss();
  const blast = 1 + save.armory.bombs * 0.08;
  addB({ kind: "gren", team: "p", x: P.x + P.face * 4, y: P.y + 22, vx: P.face * (150 + (P.moving ? 30 : 0)), vy: 230, grav: GRAV * 0.8, life: 4, dmg: 7 * dmgMul(), blast, src: "G" });
}

// ---------- SLUG tank ----------
function mkTank(x) {
  const l = save.armory.slug, hp = 6 + l * 2;
  return { x, y: GROUND, vy: 0, onGround: true, face: 1, hp, maxHp: hp, state: "parked", cd: 0, ccd: 0, shells: 10 + l * 3, flash: 0, tread: 0, aimUp: false, t: 0 };
}
function ejectTank(destroyed) {
  if (!tank) return;
  P.inTank = false; P.x = tank.x; P.y = tank.y + 30; P.vy = 260; P.onGround = false;
  P.inv = Math.max(P.inv, destroyed ? 1.4 : 0.3); P.enterCD = 1;
  if (destroyed) { tank.state = "doomed"; tank.t = 1.1; announce("THE SLUG IS GOING TO BLOW!", "#ff7a4a"); }
  else tank.state = "parked";
}
function damageTank() {
  if (!tank || tank.state !== "driven" || tank.flash > 0) return;
  tank.hp--; tank.flash = 0.4; addShake(3); sfx.clink(); sfx.boom(false); game.hits++;
  if (tank.hp <= 0) ejectTank(true);
}
function driveTank(dt) {
  const t = tank;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) t.face = dir;
  t.x += dir * 74 * dt; t.tread += dir * dt;
  t.aimUp = input.up;
  if (input.jumpPressed) {
    if (input.down) { ejectTank(false); return; }
    if (t.onGround) { t.vy = 250; t.onGround = false; sfx.jump(); }
  }
  const [lo, hi] = playerBounds();
  t.x = clamp(t.x, lo + 16, hi - 14);
  P.x = t.x; P.y = t.y; P.face = t.face;
  t.cd -= dt; t.ccd -= dt;
  const tg = autoFireOn() ? scanTargets() : null;
  if (tg && !dir && !tg.front && tg.behind && P.turnT <= 0) { t.face = -t.face; P.face = t.face; P.turnT = 0.35; }
  if ((input.fire || (tg && (tg.front || tg.up))) && t.cd <= 0) {
    t.cd = 0.075;
    const j = rand(-0.06, 0.06), up = t.aimUp || (tg && tg.up && !tg.front);
    if (up) addB({ kind: "hb", team: "p", x: t.x + t.face, y: t.y + 38, vx: 400 * Math.sin(j), vy: 400, life: 1.8, dmg: dmgMul(), src: "T" });
    else addB({ kind: "hb", team: "p", x: t.x + t.face * 20, y: t.y + 18, vx: t.face * 400, vy: 400 * Math.sin(j) * 0.5, life: 1.8, dmg: dmgMul(), src: "T" });
    muzzle(up ? t.x : t.x + t.face * 20, up ? t.y + 38 : t.y + 18);
    sfx.hmg();
  }
  if (input.bombPressed && t.ccd <= 0) {
    if (t.shells > 0) {
      t.shells--; t.ccd = 0.5;
      addB({ kind: "tshell", team: "p", x: t.x + t.face * 26, y: t.y + 22, vx: t.face * 330, vy: 30, grav: -280, life: 3, dmg: 12 * dmgMul(), src: "T" });
      muzzle(t.x + t.face * 26, t.y + 22, true); sfx.cannon(); addShake(2.5);
    } else sfx.deny();
  }
  for (const c of crates) if (!c.dead && distBox(t.x, t.y + 10, c) < 20) damageCrate(c, 99);
  for (const e of enemies) if (!e.dead && e.soldier && e.panic <= 0 && !e.panicked && Math.abs(e.x - t.x) < 50 && !e.plat) { e.panicked = true; if (chance(0.5)) { e.panic = 1.1; sfx.scream(); } }
}
function updateTank(dt) {
  if (!tank) return;
  const t = tank;
  t.flash = Math.max(0, t.flash - dt);
  t.vy += GRAV * dt; t.y += t.vy * dt;
  if (t.y <= GROUND) { t.y = GROUND; t.vy = 0; t.onGround = true; } else t.onGround = false;
  if (t.state === "doomed") {
    t.t -= dt;
    if (chance(0.3)) smoke(t.x, t.y + 24, 1, 3);
    if (t.t <= 0) { explode(t.x, t.y + 14, 40, 14, "p", 2.4, "T"); debris(t.x, t.y + 14, 14, "#56636f"); tank = null; }
  }
}

// ---------- Pickups, crates, barrels, walls, prisoners ----------
function dropItem(x, y, kind, extra = {}) { items.push({ x, y, vy: 110, kind, t: 0, ...extra }); }
function randItem(rng = Math.random) { const r = rng(); return r < 0.3 ? "H" : r < 0.45 ? "R" : r < 0.6 ? "F" : r < 0.75 ? "S" : r < 0.88 ? "B" : r < 0.94 ? "vest" : "food"; }
function damageCrate(c, d) {
  c.hp -= d; c.flash = 0.06;
  if (c.hp <= 0 && !c.dead) {
    c.dead = true; debris(c.x + 8, c.y + 8, 10, c.gold ? "#c8962a" : "#a8743a"); debris(c.x + 8, c.y + 8, 4, "#6a4520");
    if (c.item) dropItem(c.x + 8, c.y + 4, c.item, c.tag !== undefined ? { tag: c.tag } : {});
    if (c.gold) gainCoins(12, c.x + 8, c.y + 8);
    addScore(50);
  }
}
function damageBarrel(b, d) { b.hp -= d; b.flash = 0.06; if (b.hp <= 0 && !b.fuse) b.fuse = 0.12; }
function damageWall(w, d) {
  if (!w.cracked) return;
  w.hp -= d; w.flash = 0.06;
  if (w.hp <= 0 && !w.dead) {
    w.dead = true; debris(w.x + w.w / 2, w.y + w.h / 2, 16, game.theme.wall); smoke(w.x + w.w / 2, w.y + 8, 4, 5); sfx.boom(false);
    for (const it of w.loot) dropItem(w.x + w.w / 2 + rand(-4, 4), w.y + 6, it.kind, it);
    announce("SECRET FOUND!", "#7ad0ff");
  }
}
function freePow(p) {
  if (p.state !== "tied") return;
  p.state = "free"; p.t = 0; game.pows++; stat("pows"); progressDirty = true;
  addScore(100, p.x, p.y + 24, "#ffd34d"); gainCoins(8, p.x, p.y + 10);
  debris(p.x, p.y + 8, 5, "#c8a060");
  showHint("pow", "FREED PRISONERS GIVE YOU ITEMS");
}
function pickup(it) {
  const k = it.kind;
  sfx.pick();
  if (WEAPONS[k]) {
    const amt = Math.round(WEAPONS[k].ammo * ammoMul());
    if (P.weapon === k) P.ammo += amt; else { P.weapon = k; P.ammo = amt; }
    announce(WEAPONS[k].name); say(WEAPONS[k].voice);
  } else if (k === "B") {
    if (P.inTank && tank) { tank.shells += 10; announce("+10 SHELLS"); } else { P.bombs += 10; announce("+10 GRENADES"); }
  } else if (k === "vest") { P.hp = P.maxHp; sfx.vest(); announce("ARMOR RESTORED", "#8ae06a"); if (P.inTank && tank) tank.hp = tank.maxHp; }
  else if (k === "food") { addScore(500, P.x, P.y + 26, "#ffd34d"); gainCoins(5, P.x, P.y + 20); }
  else if (k === "gold") gainCoins(10, P.x, P.y + 20);
  else if (k === "medal") { addScore(2000, P.x, P.y + 26, "#ffd34d"); gainCoins(15, P.x, P.y + 20); }
  else if (k === "life") { game.lives++; announce("1UP!", "#8ae06a"); sfx.levelUp(); }
  else if (k === "tag") {
    gainCoins(30, P.x, P.y + 20); stat("secrets"); game.tagsRun++; progressDirty = true;
    if (game.mode === "mission") { const m = save.missions[game.id] || (save.missions[game.id] = {}); m.tags = m.tags || [false, false, false]; m.tags[it.tag] = true; }
    announce(`DOG TAG ${game.tagsRun}/${game.tagsTotal}`, "#7ad0ff"); sfx.achieve();
  }
}
function updateItems(dt) {
  for (const it of items) {
    it.t += dt;
    const prevY = it.y;
    it.vy += GRAV * dt; it.y += it.vy * dt;
    const f = floorAt(it.x, 5, prevY);
    if (it.y <= f) { it.y = f; it.vy = 0; }
    if (!P.dead && Math.abs(it.x - P.x) < 12 && it.y < P.y + 26 && it.y + 12 > P.y) { pickup(it); it.gone = true; }
  }
  items = items.filter(it => !it.gone && (it.kind === "tag" || it.t < 18) && it.x > camX - 30);
}
function updatePows(dt) {
  for (const p of pows) {
    p.t += dt;
    if (p.state === "tied") { if (!P.dead && Math.abs(P.x - p.x) < 12 && Math.abs(P.y - p.y) < 14) freePow(p); }
    else if (p.state === "free") { if (p.t > 0.5) { p.state = "walk"; p.t = 0; } }
    else if (p.state === "walk") {
      const d = P.x - p.x;
      p.face = d >= 0 ? 1 : -1;
      if (Math.abs(d) > 14 && p.t < 2.5) p.x += p.face * 60 * dt;
      else { p.state = "salute"; p.t = 0; dropItem(p.x + p.face * 6, p.y + 10, p.item); popup(p.x, p.y + 30, "THANK YOU!", "#ffffff"); sfx.thanks(); }
    } else if (p.state === "salute") { if (p.t > 0.8) { p.state = "run"; p.t = 0; p.face = -1; } }
    else if (p.state === "run") p.x -= 130 * dt;
  }
  pows = pows.filter(p => !(p.state === "run" && p.x < camX - 30));
}
function updateStatics(dt) {
  for (const c of crates) {
    c.flash = Math.max(0, c.flash - dt);
    if (c.dead) continue;
    let f = GROUND;
    for (const p of plats) if (c.x + c.w > p.x && c.x < p.x + p.w && c.y >= p.y - 0.5) f = Math.max(f, p.y);
    for (const o of crates) if (o !== c && !o.dead && o.y < c.y && c.x + c.w > o.x + 1 && c.x < o.x + o.w - 1) f = Math.max(f, o.y + o.h);
    if (c.y > f) { c.vy += GRAV * dt; c.y = Math.max(f, c.y + c.vy * dt); if (c.y === f) c.vy = 0; }
  }
  crates = crates.filter(c => !c.dead && c.x > camX - 80);
  for (const b of barrels) {
    b.flash = Math.max(0, b.flash - dt);
    if (b.fuse > 0) { b.fuse -= dt; if (b.fuse <= 0 && !b.dead) { b.dead = true; explode(b.x + 6, b.y + 8, 38, 9, "p", 1.9, "G"); debris(b.x + 6, b.y + 8, 8, "#c03a28"); } }
  }
  barrels = barrels.filter(b => !b.dead && b.x > camX - 80);
  for (const w of walls) w.flash = Math.max(0, (w.flash || 0) - dt);
}

// ---------- Bullets ----------
const EXPLOSIVE = { gren: [26, 1.3], rocket: [20, 1.1], tshell: [30, 1.8], egren: [17, 1], erocket: [16, 1], ebomb: [17, 1.1], eshell: [22, 1.4], emissile: [16, 1], mortar: [20, 1.3] };
function coverBlocks(b) {
  if (b.y > GROUND + 13 || b.kind === "flame" || EXPLOSIVE[b.kind] && b.grav) return false;
  for (const c of covers) if (b.x > c.x && b.x < c.x + c.w && b.y < c.y + c.h) return c;
  return false;
}
function updateBullets(dt) {
  for (const b of bullets) {
    if (b.dead) continue;
    b.life -= dt;
    if (b.kind === "rocket") {
      const sp = Math.min(Math.hypot(b.vx, b.vy) + b.acc * dt, b.max);
      let ang = Math.atan2(b.vy, b.vx), best = null, bd = 170;
      for (const e of enemies) {
        if (e.dead || e.harmless) continue;
        const bx = ebox(e), ex = bx.x + bx.w / 2, ey = bx.y + bx.h / 2, d = Math.hypot(ex - b.x, ey - b.y);
        if (d < bd && Math.cos(Math.atan2(ey - b.y, ex - b.x) - ang) > 0.5) { best = [ex, ey]; bd = d; }
      }
      if (!best) for (const bb of bossTargets()) { const ex = bb.x + bb.w / 2, ey = bb.y + bb.h / 2; if (Math.cos(Math.atan2(ey - b.y, ex - b.x) - ang) > 0.3) { best = [ex, ey]; break; } }
      if (best) { let da = Math.atan2(best[1] - b.y, best[0] - b.x) - ang; da = Math.atan2(Math.sin(da), Math.cos(da)); ang += clamp(da, -3 * dt, 3 * dt); }
      b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
      if (chance(0.6)) part(b.x, b.y, rand(-10, 10), rand(-10, 10), 0.35, "#9a948e", 3, 0, "smoke");
    } else if (b.kind === "emissile") {
      const tp = targetPos(), sp = Math.min(Math.hypot(b.vx, b.vy) + 60 * dt, 105);
      let ang = Math.atan2(b.vy, b.vx), da = Math.atan2(tp.y - b.y, tp.x - b.x) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da)); ang += clamp(da, -1.7 * dt, 1.7 * dt);
      b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp;
      if (chance(0.6)) part(b.x, b.y, rand(-8, 8), rand(-8, 8), 0.4, "#9a948e", 3, 0, "smoke");
    } else if (b.acc) {
      b.vx = clamp(b.vx + b.acc * dt, -b.max, b.max);
      if (chance(0.5)) part(b.x, b.y, 0, 8, 0.3, "#9a948e", 3, 0, "smoke");
    }
    if (b.kind === "wave" && chance(0.5)) part(b.x, GROUND + 2, -b.vx * 0.1, rand(20, 50), 0.3, game.theme.dust || "#d8c8a0", 2, -200);
    const x0 = b.fresh === undefined ? b.x - (b.ox ?? 0) : b.x, y0 = b.y;
    b.fresh = false;
    b.vy += b.grav * dt; b.x += b.vx * dt; b.y += b.vy * dt;
    // swept test points (start of the step, middle, end) so fast bullets cannot skip a target
    const pts = [[x0, y0], [(x0 + b.x) / 2, (y0 + b.y) / 2], [b.x, b.y]];
    const hitPt = box => { for (const [px, py] of pts) if (inBox(box, px, py, b.r)) return true; return false; };
    if (b.kind === "gren" || b.kind === "egren") b.spin = (b.spin || 0) + dt * 14;
    if (b.kind === "flame") {
      if (chance(0.8)) part(b.x + rand(-3, 3), b.y + rand(-2, 3), b.vx * 0.2, rand(10, 40), 0.25, pick(["#ffd34d", "#ff8a1a", "#ff5a1a"]), 3);
      if (b.y <= GROUND + 2) { b.y = GROUND + 2; b.vy = 0; }
      light(b.x, b.y, 22, 0.05, "#ff9a40");
    }
    const ex = EXPLOSIVE[b.kind];
    let floor = GROUND;
    if (b.kind === "gren" || b.kind === "egren" || b.kind === "mortar") floor = floorAt(b.x, 1, b.y - b.vy * dt);
    if (b.y <= floor) {
      if (b.kind === "gren" && !b.bounced) { b.bounced = true; b.y = floor; b.vy = Math.abs(b.vy) * 0.35; b.vx *= 0.55; }
      else if (ex) { b.dead = true; explode(b.x, Math.max(b.y, floor), ex[0] * (b.blast || 1), b.team === "p" ? b.dmg : 0, b.team, ex[1], b.src); continue; }
      else if (b.kind !== "flame" && b.kind !== "wave") { b.dead = true; part(b.x, GROUND + 1, 0, 20, 0.25, "#d8c8a0", 2, 0, "smoke"); continue; }
    }
    if (b.life <= 0 || b.x < camX - 40 || b.x > camX + W + 40 || b.y > H + 80) { b.dead = true; continue; }
    const cov = coverBlocks(b);
    if (cov) { b.dead = true; sparks(b.x, b.y, 2, "#e0d0a0", 60); if (ex) explode(b.x, b.y, ex[0], b.team === "p" ? b.dmg : 0, b.team, ex[1], b.src); continue; }

    if (b.team === "p") {
      if (b.kind === "flame") {
        const r = 5 + (0.55 - b.life) * 16;
        for (const e of enemies) if (!e.dead && !b.hits.has(e) && distBox(b.x, b.y, ebox(e)) < r) { b.hits.add(e); damageEnemy(e, b.dmg, "flame", b.x, "F"); }
        for (const c of crates) if (!c.dead && !b.hits.has(c) && distBox(b.x, b.y, c) < r) { b.hits.add(c); damageCrate(c, b.dmg); }
        for (const br of barrels) if (!br.dead && !b.hits.has(br) && distBox(b.x, b.y, br) < r) { b.hits.add(br); damageBarrel(br, b.dmg); }
        for (const p of pows) if (p.state === "tied" && distBox(b.x, b.y, powBox(p)) < r) freePow(p);
        for (const bb of bossTargets()) if (!b.hits.has(bb.ref) && distBox(b.x, b.y, bb) < r) { b.hits.add(bb.ref); hitBossBox(bb, b.dmg); }
        continue;
      }
      let hit = false;
      for (const m of bullets) if (m.kind === "emissile" && !m.dead && Math.hypot(m.x - b.x, m.y - b.y) < 7) { m.dead = true; boom(m.x, m.y, 0.7); sfx.boom(false); addScore(50, m.x, m.y + 8); hit = true; break; }
      if (!hit) for (const e of enemies) {
        if (e.dead || e.harmless || !hitPt(ebox(e))) continue;
        damageEnemy(e, ex ? 0 : b.dmg, "bullet", b.x - b.vx, b.src); hit = true; break;
      }
      if (!hit) for (const p of pows) if (p.state === "tied" && hitPt(powBox(p))) { freePow(p); hit = true; break; }
      if (!hit) for (const c of crates) if (!c.dead && hitPt(c)) { if (!ex) damageCrate(c, b.dmg); hit = true; break; }
      if (!hit) for (const br of barrels) if (!br.dead && hitPt(br)) { if (!ex) damageBarrel(br, b.dmg); hit = true; break; }
      if (!hit) for (const w of walls) if (!w.dead && w.cracked && hitPt(w)) { if (!ex) damageWall(w, b.dmg); hit = true; break; }
      if (!hit) for (const bb of bossTargets()) if (hitPt(bb)) { if (!ex) hitBossBox(bb, b.dmg); hit = true; break; }
      if (hit) {
        b.dead = true;
        if (ex) explode(b.x, b.y, ex[0], b.dmg, "p", ex[1], b.src);
        else sparks(b.x, b.y, 2, "#fff3a0", 70);
      }
    } else if (b.team === "e") {
      const box = P.inTank && tank ? tankBox() : (P.dead ? null : pBox());
      if (box && hitPt(box)) {
        b.dead = true;
        if (ex) explode(b.x, b.y, ex[0], 0, "e", ex[1]);
        else hurtPlayer();
      }
    }
  }
  bullets = bullets.filter(b => !b.dead);
}

// ---------- Effects update ----------
function updateFx(dt) {
  for (const p of parts) {
    p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === "deb" && p.y < GROUND) { p.y = GROUND; p.vy = -p.vy * 0.35; p.vx *= 0.6; }
  }
  parts = parts.filter(p => p.life > 0);
  for (const b of booms) b.t += dt;
  booms = booms.filter(b => b.t < b.dur + 0.2);
  for (const b of blasts) b.t += dt;
  blasts = blasts.filter(b => b.t < 0.22);
  for (const p of popups) p.t += dt;
  popups = popups.filter(p => p.t < 0.9);
  for (const l of lights) l.life -= dt;
  lights = lights.filter(l => l.life > 0);
  for (const c of corpses) {
    c.t += dt;
    if (c.kind === "fly") {
      c.vy += GRAV * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot = Math.floor(c.t * 10) % 4;
      if (c.y < (c.floor ?? GROUND)) { c.y = c.floor ?? GROUND; c.kind = "fall"; c.t = 0.3; c.rot = 1; smoke(c.x, c.y + 3, 2, 3); }
    } else if (c.kind === "heli") {
      c.vy += GRAV * 0.5 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += dt * 3;
      if (chance(0.6)) smoke(c.x, c.y, 1, 4);
      if (c.y < GROUND + 8) { c.done = true; explode(c.x, GROUND + 6, 34, 8, "p", 2.4); debris(c.x, GROUND + 8, 12, "#4a5528"); }
    } else if (c.kind === "fall") { if (c.t < 0.3) c.x += c.vx * dt; if (c.t > 1.5) c.done = true; }
    else if (c.kind === "burn") { if (chance(0.5) && c.t < 1) part(c.x + rand(-4, 4), c.y + rand(4, 22), 0, 30, 0.3, pick(["#ffd34d", "#ff8a1a"]), 2); if (c.t > 1.8) c.done = true; }
    else if (c.t > 1.5) c.done = true;
  }
  corpses = corpses.filter(c => !c.done);
  shake = Math.max(0, shake - dt * 14);
  hurtFlash = Math.max(0, hurtFlash - dt);
  if (announceMsg) { announceMsg.t += dt; if (announceMsg.t > 1.8) announceMsg = null; }
  if (banner) { banner.t += dt; if (banner.t > banner.dur) banner = null; }
}

// ---------- Camera, spawns, locks, triggers ----------
function updateCamera(dt) {
  if (game.mode === "survival") return;
  const focus = P.inTank && tank ? tank.x : P.x;
  let maxCam = game.len - W;
  if (game.lock) maxCam = Math.min(maxCam, game.lock.x);
  if (game.locks.length) maxCam = Math.min(maxCam, game.locks[0].x);
  // Keep the hero near the left third so enemies show up early, well ahead of the right thumb.
  const lead = P.face * 24;
  const want = clamp(focus - W * 0.3 + lead, camX, maxCam);
  if (want > camX + 0.01 && !P.dead) { camX += Math.min(want - camX, 170 * dt); game.idleCam = 0; }
  else game.idleCam += dt;
}
function activatePlaced() {
  while (placed.length && placed[0].x < camX + W + 40) { const s = placed.shift(); s.spawn(); }
}
function updateLocks(dt) {
  if (game.mode === "survival") return;
  if (!game.lock && game.locks.length && camX >= game.locks[0].x - 0.5) {
    game.lock = game.locks.shift(); camX = game.lock.x; game.lock.wave = -1; game.lock.pause = 0.6; game.lock.pending = [];
    if (game.lock.boss) { spawnBoss(game.m.boss); return; }
  }
  const L = game.lock;
  if (L && !L.boss) {
    if (L.pending.length) {
      for (const s of L.pending) s.delay -= dt;
      for (const s of L.pending.filter(s => s.delay <= 0)) spawnWaveUnit(s);
      L.pending = L.pending.filter(s => s.delay > 0);
    } else if (!enemies.some(e => e.wave)) {
      L.pause -= dt;
      if (L.pause <= 0) {
        L.wave++;
        if (L.wave >= L.waves.length) { game.lock = null; game.goT = 3; addScore(500); }
        else { L.pending = L.waves[L.wave].map(s => ({ ...s })); L.pause = 0.8; }
      }
    }
  }
}
function spawnWaveUnit(s) {
  const o = { wave: true, elite: s.elite };
  if (s.type === "heli") { mkEnemy("heli", camX + W + 40, o); announce("ENEMY CHOPPER!", "#ff9a4a"); }
  else if (s.type === "truck") { mkEnemy("truck", camX + W + 40, o); announce("ENEMY TRUCK!", "#ff9a4a"); }
  else if (s.type === "biker") mkEnemy("biker", camX + W + 60, o);
  else if (s.type === "jugg") { mkEnemy("jugg", camX + W + 20, o); announce("JUGGERNAUT!", "#ff5a4a"); }
  else if (s.para) mkEnemy(s.type, camX + rand(70, W - 60), { ...o, y: H + 10, para: true });
  else mkEnemy(s.type, s.side === "r" ? camX + W + 12 : camX - 12, o);
}
function updateTriggers() {
  for (const f of flags) {
    if (f.reached || P.x < f.x) continue;
    f.reached = true; f.t = 0;
    game.checkpoint = { x: f.x, score: game.score, time: game.time, pows: game.pows, deaths: game.deaths, hits: game.hits, kills: game.kills, coins: game.coins };
    sfx.checkpoint(); announce("CHECKPOINT", "#8ae06a");
    if (P.hp < P.maxHp) P.hp = Math.min(P.maxHp, P.hp + 1);
  }
  if (!banner && !hintMsg) for (const h of hints) if (!h.shown && P.x > h.x) { h.shown = true; showHint(h.key, h.text); break; }
}
let hintMsg = null;
function showHint(key, txt) {
  if (save.seen[key]) return;
  save.seen[key] = true; markDirty();
  hintMsg = { text: txt, t: 0 };
}

// ---------- Main game step ----------
function stepGame(dt) {
  updateFx(dt);
  if (hintMsg) { hintMsg.t += dt; if (hintMsg.t > 4) hintMsg = null; }
  if (hitstop > 0) { hitstop -= dt; return; }
  if (game.phase === "failed") { game.phaseT += dt; if (game.phaseT > 1.4 && state === "play") { if (game.mode === "survival") finishSurvival(); else openScreen("failed"); } return; }
  game.phaseT += dt;
  if (game.phase === "intro" && game.phaseT > 1.5) { game.phase = "play"; game.phaseT = 0; }
  if (game.phase !== "clear") game.time += dt;
  if (game.comboT > 0) { game.comboT -= dt; if (game.comboT <= 0) game.combo = 0; }
  updatePlayer(dt);
  if (game.phase === "failed") return;
  updateTank(dt);
  activatePlaced();
  updateLocks(dt);
  updateTriggers();
  if (game.mode === "survival") updateSurvival(dt);
  updateEnemies(dt);
  updateBoss(dt);
  updateBullets(dt);
  updatePows(dt);
  updateItems(dt);
  updateCoins(dt);
  updateStatics(dt);
  updateCamera(dt);
  game.goT = Math.max(0, game.goT - dt);
  game.coinCheck -= dt;
  if (progressDirty && game.coinCheck <= 0) { progressDirty = false; game.coinCheck = 0.5; checkDaily(); }
  if (game.phase === "clear" && game.phaseT > 3.2 && state === "play") finishMission();
}

// Called by bosses.js when the boss is destroyed
function bossDefeated() {
  game.bossDone = true; stat("bosses"); progressDirty = true;
  for (const e of enemies) if (!e.dead) killEnemy(e, "boom", "G");
  if (game.mode === "mission") {
    game.phase = "clear"; game.phaseT = 0; game.lock = null;
    stopMusic(); jingle("win"); say("Mission complete!");
    banner = { title: "MISSION COMPLETE!", sub: game.m.name, t: 0, dur: 3.2 };
  }
}

// ---------- Mission results ----------
let lastResult = null;
function finishMission() {
  const m = game.m, rec = save.missions[game.id] || (save.missions[game.id] = {});
  const prevStars = (rec.stars || [false, false, false]).slice();
  const stars = [game.powsTotal > 0 ? game.pows >= game.powsTotal : true, game.deaths === 0, game.time <= m.par];
  const nStars = stars.filter(Boolean).length;
  const rank = nStars === 3 && game.hits <= 2 ? "S" : nStars === 3 ? "A" : nStars === 2 ? "B" : "C";
  const firstClear = !rec.done;
  const clearBonus = Math.round((60 + game.id * 25) * (firstClear ? 1.5 : 1));
  const starBonus = stars.reduce((a, s, i) => a + (s && !(rec.stars?.[i]) ? 40 : 0), 0);
  const total = Math.round((clearBonus + starBonus) * (game.hard ? 1.5 : 1));
  addCoins(total);
  const prevBest = rec.bestScore || 0;
  rec.done = true;
  rec.stars = (rec.stars || [false, false, false]).map((s, i) => s || stars[i]);
  rec.bestScore = Math.max(prevBest, game.score);
  rec.bestTime = rec.bestTime ? Math.min(rec.bestTime, game.time) : game.time;
  const rankOrder = "CBAS";
  if (!rec.rank || rankOrder.indexOf(rank) > rankOrder.indexOf(rec.rank)) rec.rank = rank;
  rec.tags = rec.tags || [false, false, false];
  save.unlocked = Math.max(save.unlocked, Math.min(6, game.id + 1));
  if (game.id === 6) save.hardUnlocked = true;
  stat("missionsWon"); if (game.hits === 0) stat("flawless"); if (game.hard) stat("hardWins");
  const xp = Math.round(game.score / 40 + nStars * 60 + 80);
  const lvBefore = heroSave().level, xpBefore = heroSave().xp;
  const levels = addXp(xp);
  unlockHeroes(); checkDaily(); checkAchievements(); persist();
  lastResult = { mode: "mission", id: game.id, name: m.name, score: game.score, best: game.score > prevBest, time: game.time, par: m.par,
    kills: game.kills, pows: game.pows, powsTotal: game.powsTotal, tags: rec.tags.filter(Boolean).length, tagsRun: game.tagsRun,
    stars, newStars: stars.map((s, i) => s && !prevStars[i]), rank, coinsRun: game.coins, bonus: total, xp, levels, lvBefore, xpBefore,
    bestCombo: game.bestCombo, deaths: game.deaths, firstClear };
  openScreen("results");
}
function finishSurvival() {
  const wave = game.wave, best = save.survival.best;
  const bonus = Math.round(wave * 12);
  addCoins(bonus);
  const isBest = wave > best || (wave === best && game.score > save.survival.bestScore);
  save.survival.best = Math.max(best, wave);
  save.survival.bestScore = Math.max(save.survival.bestScore, game.score);
  dailyMax("wave", wave);
  const xp = Math.round(game.score / 50 + wave * 20);
  const lvBefore = heroSave().level, xpBefore = heroSave().xp;
  const levels = addXp(xp);
  checkDaily(); checkAchievements(); persist();
  lastResult = { mode: "survival", wave, score: game.score, best: isBest, kills: game.kills, coinsRun: game.coins, bonus, xp, levels, lvBefore, xpBefore, bestCombo: game.bestCombo, time: game.time };
  openScreen("results");
}
