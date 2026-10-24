"use strict";
// Six bosses, one per mission. Each has phases (it gets faster and adds attacks as its health drops)
// and weak points that take double damage. Multi-part bosses lose turrets one by one.

const s_ = () => 1 + game.diff * 0.12;   // boss health scale
function spawnBoss(kind) {
  const def = BOSSES[kind];
  boss = { kind, def, hp: Math.round(def.hp * s_()), maxHp: 0, t: 0, enter: true, flash: 0, dying: false, dieT: 0, boomT: 0,
    phase: 1, face: -1, blocks: !!def.blocks, blockX: () => def.blockX(boss), cdC: 2.4, cdM: 4, cdS: 6, burst: 0, burstT: 0, recoil: 0 };
  def.init(boss);
  boss.maxHp = boss.maxHp || boss.hp;
  if (def.multi) boss.hp = def.totalHp(boss);
  banner = { title: "DANGER!", sub: def.name, t: 0, dur: 2.6, red: true };
  say("Danger!"); sfx.alarm(); playMusic("boss");
}
function bossName() { return boss ? boss.def.name : ""; }
function updateBoss(dt) {
  if (!boss) return;
  const b = boss, tg = targetPos();
  b.flash = Math.max(0, b.flash - dt); b.recoil = Math.max(0, b.recoil - dt);
  if (!b.enter && !banner && (b.hintT = (b.hintT || 0) + dt) > 1.5) showHint("roll", "PULL DOWN WHILE RUNNING TO ROLL PAST SHOTS");
  if (b.dying) {
    b.dieT += dt; b.boomT -= dt; addShake(2);
    b.def.dying?.(b, dt);
    const a = b.def.area(b);
    if (b.boomT <= 0) { b.boomT = 0.13; boom(a.x + rand(0, a.w), a.y + rand(0, a.h), rand(0.8, 1.6)); sfx.boom(false); }
    if (b.dieT > 2.6) {
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      explode(cx, cy, 0, 0, "none", 4); debris(cx, cy, 30, "#3a3a40");
      for (let i = 0; i < 4; i++) boom(a.x + rand(0, a.w), a.y + rand(0, a.h), 2.5);
      addScore(10000 * (1 + game.diff * 0.25), cx, cy + 20, "#ffd34d");
      gainCoins(game.mode === "mission" ? 50 + game.id * 15 : 40, cx, cy);
      boss = null;
      bossDefeated();
    }
    return;
  }
  const ratio = b.hp / b.maxHp;
  b.phase = ratio > 0.6 ? 1 : ratio > 0.3 ? 2 : 3;
  const spd = (b.phase === 1 ? 1 : b.phase === 2 ? 1.3 : 1.6) * (1 + game.diff * 0.04) * (game.hard ? 1.15 : 1);
  if (b.phase === 3 && chance(0.08)) { const a = b.def.area(b); smoke(a.x + rand(0, a.w), a.y + rand(a.h * 0.4, a.h), 1, 4); }
  b.def.update(b, dt, tg, spd);
}
function bossTargets() {
  if (!boss || boss.enter || boss.dying) return [];
  return boss.def.targets(boss);
}
function hitBossBox(box, dmg) {
  const b = boss;
  if (!b || b.dying || b.enter) return;
  const ref = box.ref || b;
  if (ref.invuln) { sfx.clink(); return; }
  const d = dmg * (box.weak ? 2 : 1);
  ref.hp -= d; ref.flash = 0.06;
  if (box.weak) { sparks(box.x + box.w / 2, box.y + box.h / 2, 3, "#ff9a3a", 120); if (chance(0.15)) popup(box.x + box.w / 2, box.y + box.h + 6, "WEAK POINT x2", "#ff9a3a"); }
  if (ref !== b) {
    b.flash = 0.03;
    if (ref.hp <= 0 && !ref.dead) { ref.dead = true; const c = [box.x + box.w / 2, box.y + box.h / 2]; explode(c[0], c[1], 0, 0, "none", 2); debris(c[0], c[1], 12, "#3a3a40"); addScore(2500, c[0], c[1] + 10, "#ffd34d"); b.def.partDown?.(b, ref); }
  } else b.flash = 0.04;
  game.score += 10;
  if (b.def.multi) b.hp = b.def.totalHp(b);
  if (b.hp <= 0 && !b.dying) { b.dying = true; b.dieT = 0; b.boomT = 0; slowT = 1.1; say("Great!"); }
}
function bossBlast(x, y, R, dmg) {
  const seen = new Set();
  for (const box of bossTargets()) { const r = box.ref || boss; if (seen.has(r)) continue; if (distBox(x, y, box) < R) { seen.add(r); hitBossBox(box, dmg); } }
}
function drawBoss() { if (boss) boss.def.draw(boss); }
function bossBurst(b, dt, mx, my, tg, speed = 170) {
  if (b.burst <= 0) { b.burstAim = null; return; }
  if (!b.burstAim) {
    // warn first, then fire the whole burst at where you were: keep moving (or roll) to dodge it
    b.burstAim = { x: tg.x, y: tg.y }; b.burstT = 0.45;
    part(mx, my, 0, 0, 0.45, "#ff3020", 8, 0, "flash"); popup(mx, my + 12, "!", "#ff3020");
  }
  b.burstT -= dt;
  if (b.burstT > 0) return;
  b.burst--; b.burstT = 0.11;
  const a = Math.atan2(b.burstAim.y - my, b.burstAim.x - mx) + rand(-0.05, 0.05);
  addB({ kind: "eb", team: "e", x: mx, y: my, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 3 });
  muzzle(mx, my); sfx.enemyShot();
}
function lob(kind, x0, y0, tx, T, gr) { addB({ kind, team: "e", x: x0, y: y0, vx: (tx - x0) / T, vy: (GROUND - y0 - 0.5 * gr * T * T) / T, grav: gr, life: 4, mark: tx }); }
// Thick pixel line (no anti-aliasing)
function pline(c, x0, y0, x1, y1, w, color) {
  c.fillStyle = color;
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1, h = Math.floor(w / 2);
  for (let i = 0; i <= n; i++) { const x = Math.round(lerp(x0, x1, i / n)), y = Math.round(lerp(y0, y1, i / n)); c.fillRect(x - h, y - h, w, w); }
}
function hpBarOver(x, y, w, frac) {
  g.fillStyle = "#000"; g.fillRect(x - 1, y - 1, w + 2, 4);
  g.fillStyle = "#4a1010"; g.fillRect(x, y, w, 2);
  g.fillStyle = "#ffb03a"; g.fillRect(x, y, Math.max(0, Math.round(w * frac)), 2);
}

const BOSSES = {
  // ---- Mission 1: tank. Phase 2 drops its front plate and exposes a glowing engine grille (weak point).
  tank: { name: "IRON TORTOISE", hp: 150, blocks: true,
    init(b) { b.x = camX + W + 20; b.targetX = camX + W - 168; b.tread = 0; },
    blockX: b => b.x,
    area: b => ({ x: b.x, y: GROUND, w: 150, h: 90 }),
    update(b, dt, tg, spd) {
      if (b.enter) { b.x -= 40 * dt; b.tread += dt; addShake(0.8); if (b.x <= b.targetX) b.enter = false; return; }
      b.t += dt; b.tread += dt * Math.cos(b.t * 0.6);
      b.x = b.targetX + Math.sin(b.t * 0.6) * 14;
      if (chance(0.08)) smoke(b.x + 131, GROUND + 106, 1, 3);
      b.cdC -= dt * spd;
      if (b.cdC <= 0) {
        b.cdC = 2.6; b.recoil = 0.3;
        const sx0 = b.x - 40, sy0 = GROUND + 71;
        const shots = b.phase === 1 ? [0] : b.phase === 2 ? [0, rand(-50, -30)] : [0, -45, 40];
        for (const off of shots) lob("eshell", sx0, sy0, tg.x + off, 1.3, GRAV * 0.6);
        muzzle(sx0, sy0, true); smoke(sx0, sy0, 3, 4); sfx.cannon(); addShake(2);
      }
      b.cdM -= dt * spd;
      if (b.cdM <= 0) { b.cdM = 3.2; b.burst = 4 + b.phase; b.burstT = 0; }
      bossBurst(b, dt, b.x + 70, GROUND + 90, tg);
      if (b.phase >= 2) {
        b.cdS -= dt * spd;
        if (b.cdS <= 0) { b.cdS = 7; if (enemies.length < 4) { mkEnemy(pickType(), b.x + 30, { y: GROUND + 86, vy: 150, vx: -70 }); announce("REINFORCEMENTS!", "#ff9a4a"); } }
      }
      if (b.phase >= 2 && !b.plateOff) { b.plateOff = true; debris(b.x + 4, GROUND + 20, 10, "#5a5a62"); announce("HIT THE GLOWING ENGINE!", "#ff9a4a"); }
    },
    targets(b) {
      const t = [];
      if (b.phase >= 2) t.push({ x: b.x - 6, y: GROUND + 8, w: 14, h: 20, ref: b, weak: true });
      t.push({ x: b.x + 2, y: GROUND, w: 146, h: 86, ref: b });
      return t;
    },
    draw(b) {
      const p = procCanvas(200, 122), c = p.g, X = 46, Y = 118, f = b.flash > 0;
      const hull = theme().boss, hullD = shade(hull, -0.3), hullL = shade(hull, 0.25);
      PR(c, X + 4, Y - 24, 142, 24, "#222");
      for (let i = 0; i < 7; i++) { pcirc(c, X + 16 + i * 20, Y - 12, 9, "#3a3a3a"); pcirc(c, X + 16 + i * 20, Y - 12, 3, "#777"); }
      const off = ((Math.floor(b.tread * 30) % 6) + 6) % 6;
      for (let i = off; i < 140; i += 6) PR(c, X + 5 + i, Y - 25, 3, 2, "#555");
      PR(c, X, Y - 54, 150, 30, hull);
      for (let i = 0; i < 14; i++) PR(c, X - i, Y - 40 - Math.floor(i / 2), 1, 14 - i + Math.floor(i / 2), hull);
      PR(c, X - 6, Y - 30, 156, 6, hullD);
      for (let i = 0; i < 12; i++) PR(c, X + 8 + i * 12, Y - 50, 2, 2, hullL);
      PR(c, X + 40, Y - 86, 82, 32, hull); PR(c, X + 40, Y - 60, 82, 6, hullD); PR(c, X + 44, Y - 84, 74, 3, hullL);
      const rc = Math.round(b.recoil * 24);
      PR(c, X - 36 + rc, Y - 77, 80, 10, "#3a3a40"); PR(c, X - 36 + rc, Y - 75, 80, 2, "#5a5a62"); PR(c, X - 42 + rc, Y - 79, 7, 14, "#222");
      PR(c, X + 84, Y - 98, 22, 12, hullD); PR(c, X + 68, Y - 93, 17, 3, "#222");
      PR(c, X + 48, Y - 76, 8, 5, (Math.floor(clock * 6) % 2 || b.phase > 1) ? "#ff3020" : "#701010");
      PR(c, X + 126, Y - 106, 10, 20, "#333");
      for (let i = 0; i < 6; i++) PR(c, X + 92 + i * 8, Y - 40, 8, 6, i % 2 ? "#222" : "#e8c03a");
      if (b.phase >= 2) {
        const glow = Math.floor(clock * 8) % 2 ? "#ff8a2a" : "#ffd34d";
        PR(c, X - 4, Y - 28, 12, 20, "#2a2a2a");
        for (let i = 0; i < 4; i++) PR(c, X - 3, Y - 26 + i * 5, 10, 2, glow);
      } else PR(c, X - 4, Y - 28, 12, 20, hullD);
      procBlit(p, sx(b.x) - X, H - GROUND - Y, { flash: f });
    } },

  // ---- Mission 2: walker. Leaps (shockwaves), low laser (crouch), scythe swipe up close. Cockpit is the weak point while it recovers after a landing.
  walker: { name: "ARMORED MANTIS", hp: 140,
    init(b) { b.x = camX + W - 100; b.y = H + 60; b.vy = 0; b.mode = "walk"; b.modeT = 2.5; b.cdC = 2.5; b.walkT = 0; b.stunT = 0; },
    blockX: b => b.x,
    area: b => ({ x: b.x - 34, y: b.y, w: 68, h: 76 }),
    update(b, dt, tg, spd) {
      const lo = camX + 40, hi = camX + W - 40;
      b.stunT = Math.max(0, b.stunT - dt);
      if (b.enter) { b.vy += GRAV * dt; b.y += b.vy * dt; if (b.y <= GROUND) { b.y = GROUND; b.vy = 0; b.enter = false; walkerLand(b); } return; }
      b.t += dt;
      const dx = tg.x - b.x;
      if (b.stunT > 0) { if (chance(0.3)) sparks(b.x + b.face * 20, b.y + 50, 1, "#7ad0ff", 60); return; }
      if (b.mode === "walk") {
        b.face = dx < 0 ? -1 : 1;
        if (Math.abs(dx) > 70) { b.x += b.face * 30 * spd * dt; b.walkT += dt * spd; }
        b.cdC -= dt * spd; b.modeT -= dt * spd;
        if (b.phase >= 2 && Math.abs(dx) < 46 && (b.cdS -= dt) <= 0) { b.mode = "swipe"; b.modeT = 0.55; b.cdS = 3; sfx.charge(); }
        else if (b.cdC <= 0) { b.mode = "charge"; b.modeT = 0.75; b.cdC = 3.6; sfx.charge(); announce("DUCK!", "#ff6a9a"); }
        else if (b.modeT <= 0) { b.mode = "crouch"; b.modeT = 0.45; }
      } else if (b.mode === "charge") {
        b.modeT -= dt;
        if (b.modeT <= 0) { b.mode = "laser"; b.modeT = 0.55; sfx.laser(); addShake(2); }
      } else if (b.mode === "laser") {
        b.modeT -= dt;
        const beam = walkerLaser(b);
        if (P.inTank && tank) { if (overlap(beam, tankBox())) damageTank(); }
        else if (!P.dead && overlap(beam, pBox())) hurtPlayer();
        light(b.x + b.face * 80, GROUND + 16, 60, 0.05, "#ff6a9a");
        if (b.modeT <= 0) { b.mode = "walk"; b.modeT = rand(2.2, 3.6); }
      } else if (b.mode === "swipe") {
        b.modeT -= dt;
        if (b.modeT <= 0) {
          b.mode = "walk"; b.modeT = rand(1.5, 2.5); sfx.knife(); addShake(2);
          const zone = { x: b.x + (b.face < 0 ? -50 : 4), y: GROUND, w: 46, h: 26 };
          if (P.inTank && tank) { if (overlap(zone, tankBox())) damageTank(); } else if (!P.dead && overlap(zone, pBox())) hurtPlayer();
          sparks(b.x + b.face * 30, GROUND + 10, 6, "#ffffff", 120);
        }
      } else if (b.mode === "crouch") {
        b.modeT -= dt;
        if (b.modeT <= 0) { const T = 1.0, tx = clamp(tg.x, lo, hi); b.vx = (tx - b.x) / T; b.vy = -0.5 * GRAV * T; b.mode = "air"; sfx.jump(); }
      } else if (b.mode === "air") {
        b.vy += GRAV * dt; b.y += b.vy * dt; b.x += b.vx * dt;
        if (b.y <= GROUND) { b.y = GROUND; b.vy = 0; b.mode = "walk"; b.modeT = rand(3, 5) / (b.phase > 1 ? 1.5 : 1); walkerLand(b); }
      }
      b.x = clamp(b.x, lo, hi);
    },
    targets(b) {
      const t = [];
      if (b.stunT > 0) t.push({ x: b.x + (b.face > 0 ? 12 : -28), y: b.y + 44, w: 16, h: 14, ref: b, weak: true });
      t.push({ x: b.x - 32, y: b.y + 4, w: 64, h: 70, ref: b });
      return t;
    },
    draw(b) {
      const p = procCanvas(140, 124), c = p.g, X = 70, Y = 120, F = b.face, f = b.flash > 0;
      const body = theme().boss, bodyD = shade(body, -0.3), bodyL = shade(body, 0.25);
      const dip = b.mode === "crouch" ? 8 : b.mode === "air" ? -4 : 0;
      const s = b.mode === "walk" ? Math.sin(b.walkT * 6) : 0;
      const hipY = Y - 40 + dip;
      for (const k of [-1, 1]) {
        const footX = X + k * 20 + Math.round(s * 6 * k), footY = Y - (s * k > 0.3 ? 3 : 0);
        const kneeX = X + k * 30, kneeY = Math.round((hipY + footY) / 2) - 2;
        const col = k < 0 ? "#2a2a30" : "#3a3a42";
        pline(c, X + k * 10, hipY, kneeX, kneeY, 6, col); pline(c, kneeX, kneeY, footX, footY - 3, 6, col);
        pcirc(c, kneeX, kneeY, 4, "#6a6a72"); PR(c, footX - 8, footY - 4, 16, 4, "#2a2a30");
      }
      const sw = b.mode === "swipe" ? (b.modeT > 0.2 ? -10 : 8) : 0;
      pline(c, X + F * 26, hipY - 26, X + F * (46 + sw), hipY - 44 - sw, 4, bodyD); pline(c, X + F * (46 + sw), hipY - 44 - sw, X + F * (52 + sw), hipY - 26, 4, bodyD);
      pline(c, X + F * 24, hipY - 6, X + F * 40, Y - 17, 5, "#3a3a42");
      PR(c, F > 0 ? X + 38 : X - 44, Y - 20, 6, 6, "#2a2a30");
      PR(c, X - 34, hipY - 34, 68, 30, body);
      for (let i = 0; i < 12; i++) PR(c, X - 30 + i, hipY - 34 - Math.min(i, 10), 60 - i * 2, 1, body);
      PR(c, X - 34, hipY - 10, 68, 6, bodyD); PR(c, X - 30, hipY - 32, 60, 2, bodyL);
      const glass = b.stunT > 0 ? (Math.floor(clock * 12) % 2 ? "#ff8a2a" : "#ffd34d") : "#7ad0e8";
      PR(c, F > 0 ? X + 14 : X - 28, hipY - 30, 14, 9, glass); PR(c, F > 0 ? X + 16 : X - 26, hipY - 29, 4, 2, "#e6f6ff");
      for (let i = 0; i < 5; i++) PR(c, X - 25 + i * 8, hipY - 18, 8, 5, i % 2 ? "#222" : "#e8c03a");
      PR(c, X - 2, hipY - 54, 2, 10, "#333"); pcirc(c, X - 1, hipY - 55, 2, Math.floor(clock * 4) % 2 ? "#ff3020" : "#701010");
      const ex = F > 0 ? X + 44 : X - 44, ey = Y - 17;
      if (b.mode === "charge") { const k = 1 - b.modeT / 0.75; pcirc(c, ex, ey, 2 + k * 5, Math.floor(clock * 20) % 2 ? "#ff6a9a" : "#ffffff"); }
      procBlit(p, sx(b.x) - X, H - Math.round(b.y) - Y, { flash: f });
      if (b.mode === "laser") {
        const lb = walkerLaser(b), lx = sx(lb.x), ly = sy(lb.y + lb.h);
        g.fillStyle = Math.floor(clock * 30) % 2 ? "#ff3a6a" : "#ff8ab0"; g.fillRect(lx, ly - 1, Math.round(lb.w), lb.h + 2);
        g.fillStyle = "#ffffff"; g.fillRect(lx, ly + 1, Math.round(lb.w), 2);
      }
    } },

  // ---- Mission 3: bomber. Bomb carpets, homing missiles you can shoot down, paratroopers.
  bomber: { name: "POLAR BEAR MK-II", hp: 130,
    init(b) { b.x = camX + W + 90; b.y = skyY(148); b.dir = -1; b.cdC = 2; b.cdM = 4; b.cdS = 2.5; b.bombs = 0; b.bombT = 0; b.drop = 6; },
    blockX: b => b.x,
    area: b => ({ x: b.x - 56, y: b.y - 12, w: 112, h: 26 }),
    dying(b, dt) { b.y = Math.max(GROUND + 14, b.y - 30 * dt); b.x += b.dir * 25 * dt; if (chance(0.5)) smoke(b.x, b.y, 1, 5); },
    update(b, dt, tg, spd) {
      b.t += dt;
      if (b.enter) { b.x -= 70 * dt; if (b.x < camX + W - 80) { b.enter = false; b.dir = -1; } return; }
      b.x += b.dir * 46 * spd * dt;
      if (b.x < camX + 70) b.dir = 1;
      if (b.x > camX + W - 70) b.dir = -1;
      b.face = b.dir; b.y = skyY(148) + Math.sin(b.t * 1.6) * 6;
      b.cdC -= dt * spd;
      if (b.cdC <= 0) { b.cdC = 4.2; b.bombs = 3 + b.phase * 2; b.bombT = 0; }
      if (b.bombs > 0) { b.bombT -= dt; if (b.bombT <= 0) { b.bombs--; b.bombT = 0.22; addB({ kind: "ebomb", team: "e", x: b.x, y: b.y - 12, vx: b.dir * 40, vy: -10, grav: GRAV * 0.6, life: 4 }); tone("triangle", 900, 300, 0.25, 0.05); } }
      b.cdM -= dt * spd;
      if (b.cdM <= 0) { b.cdM = 5.5; for (const d of [-1, 1]) addB({ kind: "emissile", team: "e", x: b.x + d * 30, y: b.y - 10, vx: d * 50, vy: -50, life: 4.5 }); sfx.rocket(); announce("MISSILES! SHOOT THEM DOWN", "#ff9a4a"); }
      b.cdS -= dt * spd;
      if (b.cdS <= 0) { b.cdS = 3; b.burst = 3 + b.phase; b.burstT = 0; }
      bossBurst(b, dt, b.x, b.y - 14, tg);
      b.drop -= dt;
      if (b.drop <= 0) { b.drop = 8; if (enemies.length < 4) mkEnemy(pick(["rifle", "knife", "grenadier"]), b.x, { y: b.y - 14, para: true }); }
    },
    targets: b => [{ x: b.x - 56, y: b.y - 12, w: 112, h: 26, ref: b }],
    draw(b) {
      const p = procCanvas(150, 50), c = p.g, X = 75, Y = 25, F = b.face;
      const body = theme().boss, D = shade(body, -0.3), L = shade(body, 0.25);
      const R2 = (x, y, w, h, col) => PR(c, F > 0 ? X + x : X - x - w, Y - y - h, w, h, col);
      R2(-70, 0, 8, 20, D); R2(-62, -4, 16, 9, body);
      R2(-50, -10, 96, 20, body); R2(-50, -10, 96, 4, D); R2(-46, 7, 88, 2, L);
      R2(46, -8, 8, 16, body); R2(54, -5, 4, 10, D); R2(38, 2, 11, 6, "#8fd0e8");
      R2(-16, -2, 44, 5, D);
      for (const ex of [-8, 16]) {
        R2(ex, -16, 12, 8, D);
        const pw = Math.round(Math.abs(Math.sin(clock * 50 + ex)) * 12) + 2;
        R2(ex + 12, -12 - (pw >> 1), 1, pw, "#222");
        if (b.phase === 3 && Math.floor(clock * 10 + ex) % 2) R2(ex + 2, -14, 6, 4, "#ff8a2a");
      }
      R2(-22, -12, 22, 2, b.bombs > 0 ? "#111" : "#333");
      R2(-32, -3, 6, 6, "#c83a2a"); R2(-31, -2, 4, 4, "#e8e0c8");
      R2(-2, -15, 6, 5, "#333");
      procBlit(p, sx(b.x) - X, H - Math.round(b.y) - Y, { flash: b.flash > 0 });
    } },

  // ---- Mission 4: night gunship. Searchlight that calls rockets on you, chaingun barrages on a marked zone.
  gunship: { name: "NIGHT HAWK", hp: 150,
    init(b) { b.x = camX + W + 80; b.y = skyY(140); b.light = camX + W * 0.5; b.lockT = 0; b.cdR = 2; b.cdG = 5; b.zone = null; b.drop = 8; },
    blockX: b => b.x,
    area: b => ({ x: b.x - 44, y: b.y - 14, w: 88, h: 30 }),
    dying(b, dt) { b.y = Math.max(GROUND + 14, b.y - 40 * dt); b.x += b.face * 20 * dt; if (chance(0.5)) smoke(b.x, b.y, 1, 5); },
    update(b, dt, tg, spd) {
      b.t += dt;
      if (b.enter) { b.x -= 80 * dt; if (b.x < camX + W - 90) b.enter = false; return; }
      const want = clamp(tg.x + Math.sin(b.t * 0.5) * 90, camX + 60, camX + W - 60);
      b.x += clamp(want - b.x, -40 * dt * spd, 40 * dt * spd);
      b.y = skyY(138) + Math.sin(b.t * 1.3) * 6; b.face = tg.x < b.x ? -1 : 1;
      b.light += clamp(tg.x - b.light, -50 * spd * dt, 50 * spd * dt);
      const lit = Math.abs(tg.x - b.light) < 14;
      b.lockT = lit ? b.lockT + dt : Math.max(0, b.lockT - dt * 0.5);
      b.cdR -= dt;
      if (b.lockT > 0.6 && b.cdR <= 0) {
        b.cdR = 2.4 / spd; b.lockT = 0;
        for (let i = 0; i < 2 + b.phase; i++) {
          const tx = b.light + (i - 1) * 16, a = Math.atan2(GROUND - (b.y - 10), tx - b.x);
          addB({ kind: "erocket", team: "e", x: b.x, y: b.y - 10, vx: Math.cos(a) * (150 + i * 20), vy: Math.sin(a) * (150 + i * 20), life: 3 });
        }
        sfx.rocket();
      }
      b.cdG -= dt * spd;
      if (b.cdG <= 0 && !b.zone) { const z0 = clamp(tg.x - 70, camX, camX + W - 140); b.zone = { x: z0, w: 140, t: -1.05, fire: 0 }; sfx.alarm(); }
      if (b.zone) {
        const z = b.zone; z.t += dt;
        if (z.t >= 0) { z.fire -= dt; if (z.fire <= 0) { z.fire = 0.05; const tx = z.x + rand(0, z.w), a = Math.atan2(GROUND - b.y, tx - b.x); addB({ kind: "eb", team: "e", x: b.x, y: b.y - 12, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 2 }); sfx.enemyShot(); } }
        if (z.t > 1.1) { b.zone = null; b.cdG = 4.5; }
      }
      if (b.phase >= 2) { b.drop -= dt; if (b.drop <= 0) { b.drop = 9; if (enemies.length < 4) mkEnemy(pick(["rifle", "knife", "shield"]), b.x, { y: b.y - 14, para: true }); } }
    },
    targets: b => [{ x: b.x - 40, y: b.y - 12, w: 80, h: 26, ref: b }],
    draw(b) {
      // searchlight cone + marked zone (drawn behind)
      const lx = sx(b.light), gy = sy(GROUND);
      g.save(); g.globalAlpha = 0.18 + (b.lockT > 0.3 ? 0.12 : 0);
      g.fillStyle = b.lockT > 0.3 ? "#ff5a4a" : "#fff6c0";
      g.beginPath(); g.moveTo(sx(b.x), sy(b.y - 10)); g.lineTo(lx - 16, gy); g.lineTo(lx + 16, gy); g.closePath(); g.fill();
      g.restore();
      light(b.light, GROUND + 6, 34, 0.03, "#fff6c0");
      if (b.zone && b.zone.t < 0 && Math.floor(clock * 8) % 2) { g.fillStyle = "#ff3a2a"; g.fillRect(sx(b.zone.x), gy - 2, b.zone.w, 3); text("!", sx(b.zone.x + b.zone.w / 2) - 3, gy - 14, "#ff3a2a"); }
      const p = procCanvas(110, 46), c = p.g, X = 55, Y = 24, F = b.face;
      const body = theme().boss, D = shade(body, -0.35), L = shade(body, 0.2);
      const R2 = (x, y, w, h, col) => PR(c, F > 0 ? X + x : X - x - w, Y - y - h, w, h, col);
      R2(-22, -8, 50, 18, body); R2(-22, -8, 50, 4, D); R2(-18, 8, 40, 2, L);
      R2(18, -4, 14, 10, "#8fd0e8"); R2(22, 0, 6, 3, "#e6f6ff");
      R2(-50, -2, 30, 6, body); R2(-54, -6, 5, 14, D); R2(-44, 2, 6, 2, "#c83a2a");
      R2(-14, -12, 30, 4, D); R2(-18, -16, 8, 5, "#333"); R2(14, -16, 8, 5, "#333");
      R2(26, -14, 10, 4, "#2a2a30");
      R2(-2, 10, 4, 4, D);
      const rw = Math.round(Math.abs(Math.sin(clock * 40)) * 60 + 10); R2(-(rw >> 1), 14, rw, 1, "#222");
      R2(-55, Math.floor(clock * 30) % 2 ? -4 : 0, 1, 6, "#222");
      if (b.zone && b.zone.t < 0 && Math.floor(clock * 16) % 2) R2(34, -13, 3, 3, "#ff8a3a");
      procBlit(p, sx(b.x) - X, H - Math.round(b.y) - Y, { flash: b.flash > 0 });
    } },

  // ---- Mission 5: battleship. Three turrets (cannon, machine gun, missiles) to destroy one by one, then the exposed core.
  battleship: { name: "LEVIATHAN", hp: 0, blocks: true, multi: true,
    init(b) {
      const s = s_();
      b.x = camX + W + 40; b.targetX = camX + Math.round(W * 0.46); b.bob = 0;
      b.turrets = [
        { id: "cannon", dx: 22, w: 26, h: 16, hp: 45 * s, cd: 2 },
        { id: "mg", dx: 66, w: 22, h: 14, hp: 45 * s, cd: 3 },
        { id: "missile", dx: 112, w: 26, h: 16, hp: 45 * s, cd: 4.5 },
      ];
      b.core = { hp: 90 * s, invuln: true, cd: 2 };
      b.maxHp = BOSSES.battleship.totalHp(b);
    },
    totalHp: b => b.turrets.reduce((a, t) => a + Math.max(0, t.hp), 0) + Math.max(0, b.core.hp),
    blockX: b => b.x + 4,
    area: b => ({ x: b.x, y: GROUND, w: 170, h: 60 }),
    partDown(b) { if (b.turrets.every(t => t.dead)) { b.core.invuln = false; announce("THE CORE IS EXPOSED!", "#ff9a4a"); sfx.alarm(); } },
    update(b, dt, tg, spd) {
      b.t += dt; b.bob = Math.round(Math.sin(b.t * 1.4) * 1.5);
      if (b.enter) { b.x -= 45 * dt; if (b.x <= b.targetX) b.enter = false; return; }
      const deck = GROUND + 12 + b.bob;
      for (const t of b.turrets) {
        if (t.dead) continue;
        t.flash = Math.max(0, (t.flash || 0) - dt);
        t.cd -= dt * spd;
        const tx = b.x + t.dx, ty = deck + t.h / 2;
        if (t.cd > 0) continue;
        if (t.id === "cannon") { t.cd = 2.8; lob("eshell", tx - 10, ty + 4, tg.x + rand(-20, 20), 1.2, GRAV * 0.6); muzzle(tx - 12, ty + 4, true); sfx.cannon(); t.recoil = 0.3; }
        if (t.id === "mg") { t.cd = 3; b.burst = 6; b.burstT = 0; b.mgx = tx - 12; b.mgy = ty + 2; }
        if (t.id === "missile") { t.cd = 5; for (const d of [0, 1]) addB({ kind: "emissile", team: "e", x: tx, y: ty + 10, vx: -40 - d * 20, vy: 70, life: 4.5 }); sfx.rocket(); }
      }
      if (b.burst > 0) bossBurst(b, dt, b.mgx, b.mgy, tg, 180);
      if (!b.core.invuln) {
        b.core.cd -= dt * spd;
        if (b.core.cd <= 0) { b.core.cd = 1.6; for (let i = 0; i < 3; i++) lob("eshell", b.x + 100, deck + 40, tg.x + (i - 1) * 40, 1.1 + i * 0.15, GRAV * 0.6); sfx.cannon(); }
      }
      for (const t of b.turrets) t.recoil = Math.max(0, (t.recoil || 0) - dt);
    },
    targets(b) {
      const deck = GROUND + 12 + b.bob, out = [];
      for (const t of b.turrets) if (!t.dead) out.push({ x: b.x + t.dx - t.w / 2, y: deck, w: t.w, h: t.h, ref: t });
      if (!b.core.invuln) out.push({ x: b.x + 88, y: deck, w: 24, h: 48, ref: b.core, weak: true });
      return out;
    },
    draw(b) {
      const gy = sy(GROUND);
      const p = procCanvas(260, 130), c = p.g, X = 10, Y = 100, f = b.flash > 0;
      const hull = theme().boss, D = shade(hull, -0.35), L = shade(hull, 0.2);
      PR(c, X, Y - 12, 240, 30, hull);
      for (let i = 0; i < 16; i++) PR(c, X - i * 0.6, Y - 12 + i, 1 + i * 0.6, 1, hull);
      PR(c, X, Y - 12, 240, 3, L); PR(c, X, Y + 8, 240, 6, D);
      for (let i = 0; i < 18; i++) pcirc(c, X + 12 + i * 13, Y - 2, 1.5, D);
      // bridge / core tower
      PR(c, X + 84, Y - 62, 30, 50, hull); PR(c, X + 84, Y - 62, 30, 4, L);
      for (let i = 0; i < 3; i++) PR(c, X + 88 + i * 9, Y - 54, 6, 4, "#8fd0e8");
      PR(c, X + 120, Y - 80, 10, 30, "#333"); PR(c, X + 100, Y - 76, 2, 14, "#555");
      if (!b.core.invuln) { const glow = Math.floor(clock * 8) % 2 ? "#ff8a2a" : "#ffd34d"; PR(c, X + 90, Y - 40, 18, 22, "#2a2a2a"); for (let i = 0; i < 4; i++) PR(c, X + 92, Y - 38 + i * 5, 14, 2, glow); }
      // turrets
      for (const t of b.turrets) {
        const tx = X + t.dx, ty = Y - 12;
        if (t.dead) { PR(c, tx - t.w / 2, ty - 6, t.w, 6, "#2a2a2a"); continue; }
        const col = t.flash > 0 ? "#ffffff" : D;
        PR(c, tx - t.w / 2, ty - t.h, t.w, t.h, col); PR(c, tx - t.w / 2, ty - t.h, t.w, 3, L);
        if (t.id === "cannon") PR(c, tx - t.w / 2 - 18 + Math.round((t.recoil || 0) * 20), ty - t.h + 5, 20, 5, "#2a2a30");
        if (t.id === "mg") { PR(c, tx - t.w / 2 - 12, ty - t.h + 4, 12, 2, "#222"); PR(c, tx - t.w / 2 - 12, ty - t.h + 8, 12, 2, "#222"); }
        if (t.id === "missile") for (let i = 0; i < 3; i++) PR(c, tx - 9 + i * 7, ty - t.h - 6, 4, 6, "#c83a2a");
      }
      procBlit(p, sx(b.x) - X, gy - Y - b.bob, { flash: f });
      // water in front of the hull
      const wx = sx(b.x - 6);
      g.fillStyle = "#1e4a6a"; g.fillRect(wx, gy, W - wx + 4, GROUND + VPAD);
      g.fillStyle = "#4a8ab0";
      for (let x = wx; x < W; x += 12) g.fillRect(x + Math.round(Math.sin(clock * 3 + x) * 2), gy + 1 + (x % 24 ? 0 : 2), 7, 1);
    } },

  // ---- Mission 6: final boss. Stage 1 fortress gate with two turrets; stage 2 the general's mech walks out
  // (flamethrower: crouch, missiles, stomp); stage 3 exposes the core and fires high/low lasers.
  general: { name: "IRON GENERAL", hp: 0, blocks: true, multi: true,
    init(b) {
      const s = s_();
      b.stage = 1; b.x = camX + W - 120; b.gateT = 4;
      b.turrets = [{ id: "top", dx: 30, dy: 42, w: 24, h: 14, hp: 55 * s, cd: 2 }, { id: "mid", dx: 52, dy: 6, w: 24, h: 16, hp: 55 * s, cd: 3 }];
      b.mech = { hp: 180 * s, x: camX + W + 60, y: GROUND, vy: 0, face: -1, mode: "walk", modeT: 2, cd: 2, walkT: 0 };
      b.maxHp = BOSSES.general.totalHp(b);
    },
    totalHp: b => b.turrets.reduce((a, t) => a + Math.max(0, t.hp), 0) + Math.max(0, b.mech.hp),
    blockX: b => b.stage === 1 ? b.x : camX + W + 100,
    area: b => b.stage === 1 ? { x: b.x, y: GROUND, w: 120, h: 110 } : { x: b.mech.x - 36, y: b.mech.y, w: 72, h: 84 },
    partDown(b) {
      if (b.stage === 1 && b.turrets.every(t => t.dead)) {
        b.stage = 1.5; b.stageT = 0; announce("THE GATE IS FALLING!", "#ff9a4a");
      }
    },
    update(b, dt, tg, spd) {
      b.t += dt; b.enter = false;
      if (b.stage === 1) {
        for (const t of b.turrets) {
          if (t.dead) continue;
          t.flash = Math.max(0, (t.flash || 0) - dt); t.cd -= dt * spd;
          if (t.cd > 0) continue;
          const tx = b.x + t.dx, ty = GROUND + t.dy + t.h / 2;
          if (t.id === "top") { t.cd = 2.6; lob("eshell", tx - 12, ty, tg.x + rand(-25, 25), 1.25, GRAV * 0.6); muzzle(tx - 14, ty, true); sfx.cannon(); }
          else { t.cd = 3; b.burst = 6; b.burstT = 0; b.mgx = tx - 14; b.mgy = ty; }
        }
        if (b.burst > 0) bossBurst(b, dt, b.mgx, b.mgy, tg, 180);
        b.gateT -= dt;
        if (b.gateT <= 0) { b.gateT = 6; if (enemies.length < 4) { mkEnemy(pickType(), b.x + 4, { elite: chance(0.4) }); } }
        return;
      }
      if (b.stage === 1.5) {
        b.stageT += dt; addShake(2);
        if (chance(0.4)) boom(b.x + rand(0, 120), GROUND + rand(0, 100), rand(0.8, 1.8));
        if (b.stageT > 1.6) { b.stage = 2; b.wallGone = true; debris(b.x + 60, GROUND + 50, 30, "#5a4a44"); announce("THE GENERAL IS HERE!", "#ff5a4a"); sfx.alarm(); }
        return;
      }
      const m = b.mech, dx = tg.x - m.x;
      m.flash = Math.max(0, (m.flash || 0) - dt);
      if (b.stage === 2 && m.hp < 180 * s_() * 0.45) { b.stage = 3; announce("CORE EXPOSED! x2 DAMAGE", "#ff9a4a"); }
      const sp = spd * (b.stage === 3 ? 1.3 : 1);
      m.cd -= dt * sp;
      if (m.mode === "walk") {
        m.face = dx < 0 ? -1 : 1;
        if (m.x > camX + W - 50) m.x -= 40 * dt;
        else if (Math.abs(dx) > 100) m.x += m.face * 26 * sp * dt;
        m.walkT += dt;
        if (m.cd <= 0) {
          const opts = b.stage === 3 ? ["flame", "missiles", "stomp", "laser", "laser"] : ["flame", "missiles", "stomp"];
          m.mode = pick(opts); m.cd = 2.2; m.modeT = 0.8;
          if (m.mode === "flame") { announce("DUCK!", "#ff8a3a"); sfx.charge(); }
          if (m.mode === "laser") { m.low = chance(0.5); announce(m.low ? "JUMP!" : "DUCK!", "#ff6a9a"); sfx.charge(); }
          if (m.mode === "stomp") { m.vx = clamp((tg.x - m.x) / 1, -160, 160); m.vy = 420; sfx.jump(); }
        }
      } else if (m.mode === "flame") {
        m.modeT -= dt;
        if (m.modeT < 0) {
          m.fireT = (m.fireT || 0) - dt;
          if (m.fireT <= 0) { m.fireT = 0.05; addB({ kind: "eflame", team: "e", x: m.x + m.face * 34, y: GROUND + 18, vx: m.face * 220, vy: 0, life: 0.75 }); if (chance(0.3)) sfx.flame(); }
          light(m.x + m.face * 60, GROUND + 18, 50, 0.05, "#ff8a3a");
          if (m.modeT < -1.3) m.mode = "walk";
        }
      } else if (m.mode === "missiles") {
        m.modeT -= dt;
        if (m.modeT <= 0) { for (let i = 0; i < 4; i++) addB({ kind: "emissile", team: "e", x: m.x + (i - 1.5) * 8, y: GROUND + 80, vx: (i - 1.5) * 30, vy: 90, life: 5 }); sfx.rocket(); m.mode = "walk"; }
      } else if (m.mode === "stomp") {
        m.vy += GRAV * 1.2 * dt; m.y += m.vy * dt; m.x += m.vx * dt;
        if (m.y <= GROUND) {
          m.y = GROUND; m.mode = "walk"; addShake(6); sfx.boom(true);
          for (const d of [-1, 1]) addB({ kind: "wave", team: "e", x: m.x + d * 34, y: GROUND + 4, vx: d * 190, life: 1.6 });
          if (!P.dead && Math.abs(P.x - m.x) < 36 && P.y < GROUND + 30) hurtPlayer();
        }
      } else if (m.mode === "laser") {
        m.modeT -= dt;
        if (m.modeT < 0) {
          const beam = generalLaser(b);
          if (P.inTank && tank) { if (overlap(beam, tankBox())) damageTank(); } else if (!P.dead && overlap(beam, pBox())) hurtPlayer();
          if (m.modeT > -0.05) sfx.laser();
          if (m.modeT < -0.6) m.mode = "walk";
        }
      }
      m.x = clamp(m.x, camX + 40, camX + W + 60);
    },
    targets(b) {
      if (b.stage === 1) return b.turrets.filter(t => !t.dead).map(t => ({ x: b.x + t.dx - t.w / 2, y: GROUND + t.dy, w: t.w, h: t.h, ref: t }));
      if (b.stage === 1.5) return [];
      const m = b.mech, out = [];
      if (b.stage === 3) out.push({ x: m.x - 9, y: m.y + 46, w: 18, h: 16, ref: m, weak: true });
      out.push({ x: m.x - 32, y: m.y, w: 64, h: 80, ref: m });
      return out;
    },
    draw(b) {
      if (!b.wallGone) {
        const p = procCanvas(130, 120), c = p.g, X = 4, Y = 116;
        const wall = "#5a4a44", D = "#3a2e2a", L = "#7a6a62";
        PR(c, X, Y - 112, 122, 112, wall);
        for (let r = 0; r < 14; r++) for (let q = 0; q < 8; q++) PR(c, X + q * 16 + (r % 2) * 8, Y - 112 + r * 8, 1, 8, D);
        for (let r = 0; r < 14; r++) PR(c, X, Y - 112 + r * 8, 122, 1, D);
        for (let i = 0; i < 6; i++) PR(c, X + 4 + i * 20, Y - 120, 12, 8, wall);
        PR(c, X + 4, Y - 30, 26, 30, "#1a1210"); PR(c, X + 6, Y - 28, 22, 2, "#3a2a24");
        PR(c, X + 62, Y - 92, 40, 24, "#8a2a2a"); PR(c, X + 74, Y - 86, 16, 12, "#ffd34d"); PR(c, X + 78, Y - 82, 8, 4, "#8a2a2a");
        for (const t of b.turrets) {
          const tx = X + t.dx, ty = Y - t.dy;
          if (t.dead) { PR(c, tx - t.w / 2, ty - 6, t.w, 6, "#1a1a1a"); continue; }
          const col = t.flash > 0 ? "#ffffff" : "#3a3a42";
          PR(c, tx - t.w / 2, ty - t.h, t.w, t.h, col); PR(c, tx - t.w / 2, ty - t.h, t.w, 3, "#6a6a72");
          PR(c, tx - t.w / 2 - 16, ty - t.h / 2 - 2, 16, 4, "#222");
        }
        procBlit(p, sx(b.x) - X, sy(GROUND) - Y, { flash: false });
        if (b.stage === 1.5) { g.globalAlpha = 0.5; g.fillStyle = "#ffffff"; if (Math.floor(clock * 10) % 2) g.fillRect(sx(b.x), sy(GROUND + 112), 122, 112); g.globalAlpha = 1; }
        return;
      }
      g.fillStyle = "#3a2e2a"; g.fillRect(sx(b.x), sy(GROUND + 14), 122, 14);
      const m = b.mech, p = procCanvas(140, 120), c = p.g, X = 70, Y = 116, F = m.face;
      const body = theme().boss, D = shade(body, -0.35), L = shade(body, 0.2);
      const air = m.y > GROUND + 1, s = air ? 0 : Math.sin(m.walkT * 5);
      const hipY = Y - 42;
      for (const k of [-1, 1]) {
        const fx = X + k * 18 + Math.round(s * 5 * k), fy = Y - (air ? 6 : 0);
        pline(c, X + k * 10, hipY, X + k * 22, hipY + 20, 9, k < 0 ? "#2a2a30" : "#3a3a42");
        pline(c, X + k * 22, hipY + 20, fx, fy - 4, 8, k < 0 ? "#2a2a30" : "#3a3a42");
        PR(c, fx - 11, fy - 5, 22, 5, "#222");
      }
      PR(c, X - 36, hipY - 40, 72, 42, body); PR(c, X - 36, hipY - 40, 72, 4, L); PR(c, X - 36, hipY - 4, 72, 6, D);
      PR(c, X - 30, hipY - 56, 60, 16, D); PR(c, X - 10, hipY - 54, 20, 8, "#8fd0e8");
      PR(c, X - 44, hipY - 52, 10, 26, D); PR(c, X + 34, hipY - 52, 10, 26, D);
      for (let i = 0; i < 4; i++) PR(c, X - 42 + (i % 2) * 2, hipY - 50 + i * 6, 6, 4, "#c83a2a");
      PR(c, F > 0 ? X + 30 : X - 50, hipY - 20, 20, 8, "#2a2a30"); PR(c, F > 0 ? X + 48 : X - 52, hipY - 19, 4, 6, "#ff8a3a");
      if (b.stage === 3) { const glow = Math.floor(clock * 8) % 2 ? "#ff8a2a" : "#ffd34d"; PR(c, X - 9, hipY - 30, 18, 16, "#1a1a1a"); PR(c, X - 6, hipY - 27, 12, 10, glow); }
      PR(c, X - 18, hipY - 34, 36, 4, "#e8c03a");
      if (m.mode === "laser" && m.modeT >= 0 && Math.floor(clock * 16) % 2) PR(c, F > 0 ? X + 46 : X - 50, hipY - (m.low ? 14 : 26), 4, 4, "#ff6a9a");
      procBlit(p, sx(m.x) - X, H - Math.round(m.y) - Y, { flash: m.flash > 0 });
      if (m.mode === "laser" && m.modeT < 0) {
        const lb = generalLaser(b), lx = sx(lb.x), ly = sy(lb.y + lb.h);
        g.fillStyle = Math.floor(clock * 30) % 2 ? "#ff3a6a" : "#ff8ab0"; g.fillRect(lx, ly - 1, Math.round(lb.w), lb.h + 2);
        g.fillStyle = "#ffffff"; g.fillRect(lx, ly + 1, Math.round(lb.w), 2);
      }
    } },
};
function walkerLaser(b) { const x0 = b.face < 0 ? camX - 10 : b.x + 42, x1 = b.face < 0 ? b.x - 42 : camX + W + 10; return { x: x0, y: GROUND + 15, w: x1 - x0, h: 4 }; }
function walkerLand(b) {
  addShake(5); sfx.boom(true); vibrate(60); b.stunT = 1.1;
  smoke(b.x - 22, GROUND + 2, 3, 5); smoke(b.x + 22, GROUND + 2, 3, 5);
  for (const d of [-1, 1]) addB({ kind: "wave", team: "e", x: b.x + d * 30, y: GROUND + 4, vx: d * 170, life: 1.6 });
  if (P.inTank && tank) { if (Math.abs(tank.x - b.x) < 44) damageTank(); }
  else if (!P.dead && Math.abs(P.x - b.x) < 30 && P.y < GROUND + 30) hurtPlayer();
}
function generalLaser(b) {
  const m = b.mech, x0 = m.face < 0 ? camX - 10 : m.x + 46, x1 = m.face < 0 ? m.x - 46 : camX + W + 10;
  return { x: x0, y: m.low ? GROUND + 6 : GROUND + 16, w: x1 - x0, h: 4 };
}
