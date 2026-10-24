"use strict";
// Rebel army: soldiers that take cover, snipers with a warning laser, mortars that mark their target,
// bikers, trucks, helicopters, machine-gun nests and the armored juggernaut. Every dangerous attack is telegraphed.

const ENEMY = {
  rifle: { hp: 1, score: 100, coins: 1, soldier: true },
  knife: { hp: 1, score: 100, coins: 1, soldier: true },
  grenadier: { hp: 1, score: 150, coins: 2, soldier: true },
  bazooka: { hp: 2, score: 200, coins: 2, soldier: true },
  shield: { hp: 2, score: 300, coins: 3, soldier: true },
  sniper: { hp: 2, score: 300, coins: 3, soldier: true },
  mortar: { hp: 3, score: 300, coins: 3, soldier: true },
  biker: { hp: 3, score: 400, coins: 4, vehicle: true },
  heli: { hp: 12, score: 1000, coins: 10, vehicle: true },
  truck: { hp: 22, score: 800, coins: 10, vehicle: true },
  jugg: { hp: 40, score: 3000, coins: 20 },
  mgnest: { hp: 12, score: 600, coins: 6, vehicle: true },
  drone: { hp: 1.5, score: 250, coins: 3, vehicle: true },
};
// Gentler late-game curve: mission 6 enemies have 1.6x health and fire 1.4x as often as mission 1's.
const hpScale = () => 1 + game.diff * 0.12;
const fireRate = e => (1 + game.diff * 0.08) * (e.elite ? 1.35 : 1);
function pickType(diff = game.diff) {
  const r = Math.random();
  if (diff < 1) return r < 0.45 ? "rifle" : r < 0.7 ? "knife" : r < 0.85 ? "grenadier" : "bazooka";
  return r < 0.34 ? "rifle" : r < 0.52 ? "knife" : r < 0.66 ? "grenadier" : r < 0.8 ? "bazooka" : r < 0.92 ? "shield" : "sniper";
}

function mkEnemy(type, x, o = {}) {
  const d = ENEMY[type], th = game.theme.id;
  const e = { type, x, y: o.y ?? GROUND, vx: o.vx || 0, vy: o.vy || 0, face: -1,
    hp: d.hp * hpScale() * (o.elite ? 2 : 1), maxHp: 0, cd: rand(0.8, 1.8), state: o.idle ? "idle" : "act", alertT: 0, flash: 0,
    anim: Math.random() * 10, para: !!o.para, shield: type === "shield" ? 8 + game.diff * 2 : 0, crouch: false, moving: false,
    atkT: 0, throwT: 0, hitDone: true, aimT: 0, hitT: 0, panic: 0, soldier: !!d.soldier, elite: !!o.elite,
    range: type === "bazooka" ? rand(150, 200) : type === "grenadier" ? rand(110, 150) : rand(90, 150),
    wave: !!o.wave, idleKind: o.idle ? pick(["chat", "chat", "sleep"]) : null, t: 0, plat: o.plat || null,
    pal: type === "jugg" ? `jugg_${th}` : (o.elite || type === "sniper" ? `elite_${th}` : `rebel_${th}`) };
  e.maxHp = e.hp;
  if (type === "drone") { e.baseY = e.y = GROUND + rand(62, 100); e.mode = "hover"; e.cd = rand(1.4, 2.4); e.offX = rand(-14, 14); }   // hovers almost overhead: aim up to shoot it
  if (type === "heli") { e.y = 150; e.baseY = 150 + rand(-8, 8); e.cd = 2; }
  if (type === "truck") { e.stopX = camX + W - 74; e.unload = 3 + Math.min(game.diff, 3); e.unT = 0.6; }
  if (type === "biker") { e.warn = 0.8; e.face = -1; e.hitDone = false; sfx.engine(); }
  if (type === "mortar") e.cd = rand(1.5, 2.5);
  if (type === "sniper") e.cd = rand(1, 2);
  if (type === "jugg") { e.cd = 2; e.mode = "walk"; }
  if (e.idleKind === "sleep") e.crouch = true;
  enemies.push(e);
  return e;
}

function ebox(e) {
  switch (e.type) {
    case "heli": return { x: e.x - 15, y: e.y - 9, w: 30, h: 17 };
    case "drone": return { x: e.x - 6, y: e.y - 4, w: 12, h: 8 };
    case "truck": return { x: e.x - 28, y: e.y, w: 56, h: 30 };
    case "biker": return { x: e.x - 12, y: e.y, w: 24, h: 20 };
    case "jugg": return { x: e.x - 9, y: e.y, w: 18, h: 32 };
    case "mgnest": return { x: e.x - 14, y: e.y, w: 28, h: 19 };
  }
  return { x: e.x - 5, y: e.y, w: 10, h: e.coverHide ? 12 : e.crouch ? 18 : 24 };
}

function damageEnemy(e, dmg, kind, fromX, src = "P") {
  if (e.dead || e.harmless) return false;
  if (e.type === "shield" && e.shield > 0 && kind === "bullet" && Math.sign(fromX - e.x) === e.face) {
    e.shield -= dmg; sfx.clink(); sparks(e.x + e.face * 8, e.y + 12, 3, "#ffffff", 90);
    if (e.shield <= 0) { debris(e.x + e.face * 8, e.y + 12, 6, "#9aa4ae"); popup(e.x, e.y + 30, "SHIELD DOWN!", "#7ad0ff"); }
    return true;
  }
  if (e.state === "idle") { e.state = "alert"; e.alertT = 0.25; }
  e.hp -= dmg; e.flash = 0.08;
  if ((e.soldier || e.type === "jugg") && dmg > 0 && kind !== "flame") blood(e.x, e.y + (e.crouch ? 10 : 15), kind === "laser" ? 1 : 3, Math.sign(e.x - fromX) || 1);
  if (e.soldier && dmg > 0) { e.hitT = 0.1; if (!e.plat) e.x += Math.sign(e.x - fromX || 1) * 2; }
  if (e.hp <= 0) killEnemy(e, kind, src);
  return true;
}
function killEnemy(e, kind, src = "P") {
  if (e.dead) return;
  e.dead = true;
  const d = ENEMY[e.type];
  addScore(d.score * (e.elite ? 2 : 1), e.x, e.y + (e.type === "heli" ? 10 : 30));
  gainCoins(d.coins * (e.elite ? 2 : 1), e.x, e.y + 12);
  onKill(src, !!d.vehicle);
  if (e.type === "drone") { boom(e.x, e.y, 0.6); sfx.boom(false); debris(e.x, e.y, 5, "#4a4a52"); sparks(e.x, e.y, 6, "#ffd34d", 120); return; }
  if (e.type === "heli") { corpses.push({ kind: "heli", x: e.x, y: e.y, vx: e.face * 30, vy: 0, t: 0, face: e.face, rot: 0 }); sfx.boom(false); hitstop = 0.05; return; }
  if (e.type === "truck" || e.type === "mgnest") {
    explode(e.x, e.y + 14, 40, 10, "p", 2.6, src); debris(e.x, e.y + 14, 16, "#4a5528"); hitstop = 0.06;
    if (chance(0.5)) dropItem(e.x, e.y + 20, randItem());
    return;
  }
  if (e.type === "biker") {
    explode(e.x, e.y + 8, 24, 6, "p", 1.5, src);
    corpses.push({ kind: "fly", x: e.x, y: e.y + 10, vx: rand(-40, 40), vy: 220, t: 0, face: e.face, rot: 0, pal: e.pal, head: "h_rebel" });
    return;
  }
  if (e.type === "jugg") {
    explode(e.x, e.y + 14, 34, 8, "p", 2.2, src); hitstop = 0.1; addShake(5);
    dropItem(e.x, e.y + 20, pick(["H", "R", "S", "F", "L"])); dropItem(e.x + 8, e.y + 20, "vest");
    announce("JUGGERNAUT DOWN!", "#8ae06a");
  }
  if (e.type === "mortar") { explode(e.x + 10, e.y + 6, 22, 4, "p", 1.2, src); }
  if (chance(0.75)) sfx.scream();
  if (kind === "boom") gibs(e.x, e.y + 12, 7); else if (kind !== "flame") blood(e.x, e.y + 14, 6, Math.sign(e.x - P.x) || 1, 110);
  const ck = kind === "boom" ? "fly" : kind === "flame" ? "burn" : "fall";
  corpses.push({ kind: ck, x: e.x, y: e.y, floor: e.plat ? e.plat.y : GROUND, vx: (ck === "fly" ? -e.face * rand(40, 90) : -e.face * 30),
    vy: ck === "fly" ? rand(160, 240) : 0, t: 0, face: e.face, rot: 0, pal: e.pal, head: e.type === "sniper" ? "h_beret" : e.type === "jugg" ? "h_jugg" : "h_rebel", torso: e.type === "jugg" ? "t_jugg" : "t_rebel" });
  if (chance(e.elite ? 0.35 : 0.05)) dropItem(e.x, e.y + 10, randItem());
}

function nearestCover(e, dir) {
  let best = null, bd = 70;
  for (const c of covers) {
    const cx = c.x + c.w / 2, d = (cx - e.x) * dir;
    if (d > -4 && d < bd) { best = c; bd = d; }
  }
  return best;
}

function updateEnemies(dt) {
  const tg = targetPos();
  for (const e of enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt); e.anim += dt; e.atkT = Math.max(0, e.atkT - dt); e.throwT = Math.max(0, e.throwT - dt);
    e.hitT = Math.max(0, e.hitT - dt);
    switch (e.type) {
      case "heli": updateHeli(e, dt, tg); continue;
      case "drone": updateDrone(e, dt, tg); continue;
      case "truck": updateTruck(e, dt); continue;
      case "biker": updateBiker(e, dt); continue;
      case "jugg": updateJugg(e, dt, tg); continue;
      case "mgnest": updateNest(e, dt, tg); continue;
    }
    const fl = e.plat ? e.plat.y : GROUND;
    if (e.y > fl || e.vy > 0) {
      if (e.para) e.vy = -30; else e.vy += GRAV * dt;
      e.y += e.vy * dt; e.x += e.vx * dt;
      if (e.y <= fl) { e.y = fl; e.vy = 0; e.vx = 0; e.para = false; }
    }
    const dx = tg.x - e.x, ad = Math.abs(dx), dir = dx >= 0 ? 1 : -1;
    e.moving = false;
    if (e.state === "idle") {
      if (ad < 150 || e.flash > 0) { e.state = "alert"; e.alertT = 0.55; e.face = dir; e.crouch = false; }
      continue;
    }
    if (e.state === "alert") { e.alertT -= dt; e.face = dir; if (e.alertT <= 0) e.state = "act"; continue; }
    if (e.y > fl || e.hitT > 0) { e.face = dir; continue; }
    const walk = (d, s) => {
      const x0 = e.x; e.x += d * s * dt;
      if (e.plat) e.x = clamp(e.x, e.plat.x + 5, e.plat.x + e.plat.w - 5);
      e.moving = e.x !== x0;
    };
    const vis = e.x > camX + 4 && e.x < camX + W - 4;
    if (!e.plat && e.type !== "mortar" && (e.x > camX + W - 10 || e.x < camX + 10)) { const d = e.x > camX + W - 10 ? -1 : 1; walk(d, 45); e.face = d; e.crouch = false; e.coverHide = false; continue; }
    if (e.panic > 0) { e.panic -= dt; const away = -dir; walk(away, 74); e.face = away; e.crouch = false; e.coverHide = false; continue; }
    e.face = dir;
    e.cd -= dt * fireRate(e);
    switch (e.type) {
      case "rifle": rifleAI(e, dt, tg, dx, ad, dir, walk, vis); break;
      case "grenadier": {
        if (!e.cover) e.cover = nearestCover(e, dir);
        if (e.cover && !e.plat) { const spot = e.cover.x + e.cover.w / 2 - dir * (e.cover.w / 2 + 6); if (Math.abs(spot - e.x) > 2) walk(Math.sign(spot - e.x), 40); else e.coverHide = e.throwT <= 0; }
        else if (ad > e.range + 15) walk(dir, 34); else if (ad < e.range - 50) walk(-dir, 26);
        if (e.cd <= 0 && ad < 220 && vis) {
          e.cd = rand(2.2, 3.2); e.throwT = 0.3; e.coverHide = false;
          const T = 0.95, gr = GRAV * 0.8, y0 = e.y + 22;
          addB({ kind: "egren", team: "e", x: e.x, y: y0, vx: dx / T, vy: (GROUND - y0 - 0.5 * gr * T * T) / T, grav: gr, life: 3 });
          sfx.toss();
        }
        break;
      }
      case "knife": {
        if (e.atkT > 0) { if (!e.hitDone && e.atkT < 0.15) { e.hitDone = true; if (ad < 17 && Math.abs(tg.y - e.y - 12) < 20) hurtPlayer(); } break; }
        if (ad > 12) walk(dir, 64 + game.diff * 6);
        if (e.y <= fl && covers.some(c => Math.abs(c.x + c.w / 2 - e.x) < c.w / 2 + 8 && (c.x + c.w / 2 - e.x) * dir > 0)) { e.vy = 230; }
        if (ad < 15 && e.cd <= 0) { e.cd = 1; e.atkT = 0.3; e.hitDone = false; sfx.knife(); }
        break;
      }
      case "bazooka": {
        if (ad > e.range + 20) walk(dir, 28); else if (ad < 60) walk(-dir, 24);
        e.crouch = !e.moving;
        if (e.cd <= 0 && ad < 280 && !e.moving && vis) {
          if (e.aimT <= 0) { e.aimT = 0.6; sfx.beep(); }
        }
        if (e.aimT > 0) {
          e.aimT -= dt;
          if (e.aimT <= 0) {
            e.cd = rand(3, 4);
            addB({ kind: "erocket", team: "e", x: e.x + dir * 12, y: e.y + 12, vx: dir * 60, acc: dir * 110, max: 160, life: 4 });
            muzzle(e.x + dir * 12, e.y + 12); sfx.rocket();
          }
        }
        break;
      }
      case "shield": {
        if (e.atkT > 0) { if (!e.hitDone && e.atkT < 0.15) { e.hitDone = true; if (ad < 18) hurtPlayer(); } break; }
        if (ad > 16) walk(dir, 22 + game.diff * 3);
        else if (e.cd <= 0) { e.cd = 1.4; e.atkT = 0.3; e.hitDone = false; }
        break;
      }
      case "sniper": {
        e.crouch = true;
        if (e.aimT > 0) {
          e.aimT -= dt;
          if (e.aimT > 0.4) e.lock = { x: tg.x, y: tg.y };
          if (Math.floor(e.aimT * (e.aimT < 0.4 ? 20 : 8)) % 2 === 0) sfx.beep();
          if (e.aimT <= 0) {
            e.cd = rand(2.6, 3.4);
            const mx = e.x + dir * 12, my = e.y + 12, a = Math.atan2(e.lock.y - my, e.lock.x - mx);
            addB({ kind: "eb", team: "e", x: mx, y: my, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, life: 2, sniper: true });
            muzzle(mx, my, true); sfx.sniper(); e.lock = null;
          }
        } else if (e.cd <= 0 && vis && ad < W) { e.aimT = 1.3; e.lock = { x: tg.x, y: tg.y }; }
        break;
      }
      case "mortar": {
        e.crouch = true; e.face = dir;
        if (e.cd <= 0 && ad < W * 1.2 && e.x < camX + W + 120 && e.x > camX - 10) {
          e.cd = rand(3.2, 4.2) / Math.min(1.6, fireRate(e));
          const T = 1.7, gr = GRAV * 0.5, x0 = e.x + e.face * 8, y0 = e.y + 14, tx = tg.x + rand(-10, 10);
          addB({ kind: "mortar", team: "e", x: x0, y: y0, vx: (tx - x0) / T, vy: (GROUND - y0 - 0.5 * gr * T * T) / T, grav: gr, life: 4, tx });
          muzzle(x0, y0 + 4, true); smoke(x0, y0 + 6, 3, 3); sfx.cannon(); setTimeout(() => sfx.whistle(), 500);
        }
        break;
      }
    }
  }
  enemies = enemies.filter(e => !e.dead && (e.type === "heli" || ((e.type === "truck" || e.type === "mortar" || e.type === "mgnest") && e.x > camX - 220) || (e.x > camX - 140 && e.x < camX + W + 420)));
}

function rifleAI(e, dt, tg, dx, ad, dir, walk, vis) {
  if (!e.plat && !e.cover) e.cover = nearestCover(e, dir);
  const shotH = () => e.plat ? 0 : (e.crouch ? 11 : 17);
  if (e.cover && !e.plat && Math.abs((e.cover.x + e.cover.w / 2 - e.x)) < 90) {
    const spot = e.cover.x + e.cover.w / 2 - dir * (e.cover.w / 2 + 6);
    if (Math.abs(spot - e.x) > 2 && !e.atCover) { walk(Math.sign(spot - e.x), 42); e.crouch = false; e.coverHide = false; return; }
    e.atCover = true;
    // hide, then pop up to shoot
    e.popT = (e.popT || 0) - dt;
    if (e.popT <= 0 && e.cd <= 0 && vis) { e.popT = 0.75; e.aimT = 0.35; e.coverHide = false; e.crouch = false; }
    if (e.popT > 0) {
      if (e.aimT > 0) { e.aimT -= dt; if (e.aimT <= 0) { e.cd = rand(1.4, 2.2); fireRifle(e, tg, dir, 17); } }
    } else { e.coverHide = true; e.crouch = true; }
    return;
  }
  if (!e.plat) { if (ad > e.range + 15) walk(dir, 36); else if (ad < e.range - 50) walk(-dir, 26); }
  if (e.aimT > 0) { e.aimT -= dt; if (e.aimT <= 0) { e.cd = rand(1.7, 2.7); fireRifle(e, tg, dir, e.plat ? 17 : shotH()); } return; }
  if (!e.moving && e.cd < 0.6 && !e.plat && e.crouchPick === undefined) e.crouchPick = chance(0.35);
  e.crouch = !e.moving && !!e.crouchPick;
  if (e.cd <= 0 && ad < 240 && vis) { e.aimT = 0.3; e.crouchPick = undefined; }
}
function fireRifle(e, tg, dir, h) {
  const oy = e.y + h, mx = e.x + dir * 12;
  let vy = 0;
  if (e.plat || Math.abs(tg.y - e.y) > 30) { const T = Math.max(Math.abs(tg.x - mx) / 150, 0.2); vy = clamp((tg.y - oy) / T, -100, 60); }
  addB({ kind: "eb", team: "e", x: mx, y: oy, vx: dir * 150, vy, life: 3 });
  muzzle(mx, oy); sfx.enemyShot();
}

function updateHeli(e, dt, tg) {
  e.t += dt;
  const want = clamp(tg.x + Math.sin(e.t * 0.8) * 70, camX + 30, camX + W - 30), d = want - e.x;
  e.x += Math.sign(d) * Math.min(Math.abs(d), 58 * dt);
  e.y = e.baseY + Math.sin(e.t * 2.2) * 5;
  if (Math.abs(d) > 4) e.face = d > 0 ? 1 : -1;
  e.cd -= dt * fireRate(e);
  if (e.cd <= 0 && Math.abs(tg.x - e.x) < 80) { e.cd = 1.25; addB({ kind: "ebomb", team: "e", x: e.x, y: e.y - 8, vx: e.face * 20, vy: -20, grav: GRAV * 0.6, life: 4 }); }
  if (chance(0.02) && e.hp < e.maxHp * 0.4) smoke(e.x, e.y, 1, 3);
}
// Kamikaze drone: hovers near you, blinks red while it locks on, then dives at that spot.
// Shoot it down (aim up), step away from the marked spot, or roll through it.
function updateDrone(e, dt, tg) {
  e.t += dt;
  if (e.mode === "hover") {
    const want = clamp(tg.x + e.offX, camX + 20, camX + W - 20), d = want - e.x;
    e.x += Math.sign(d) * Math.min(Math.abs(d), 85 * dt);
    e.y = e.baseY + Math.sin(e.t * 3) * 4;
    e.face = tg.x > e.x ? 1 : -1;
    e.cd -= dt * fireRate(e);
    if (e.cd <= 0 && e.x > camX && e.x < camX + W) { e.mode = "lock"; e.lockT = 0.65; e.aim = { x: tg.x, y: tg.y }; }
  } else if (e.mode === "lock") {
    e.lockT -= dt;
    if (Math.floor(e.lockT * 12) % 2 === 0 && !throttled("drone", 0.12)) sfx.beep();
    if (e.lockT <= 0) { const a = Math.atan2(e.aim.y - e.y, e.aim.x - e.x); e.vx = Math.cos(a) * 210; e.vy = Math.sin(a) * 210; e.mode = "dive"; }
  } else {
    e.x += e.vx * dt; e.y += e.vy * dt;
    const hitP = !P.dead && !P.inTank && overlap(ebox(e), pBox()), hitT = P.inTank && tank && overlap(ebox(e), tankBox());
    if (hitP || hitT || e.y <= GROUND + 2) { e.dead = true; explode(e.x, Math.max(GROUND, e.y), 16, 1, "e", 0.8, "drone"); }
  }
}
function updateTruck(e, dt) {
  e.face = -1;
  if (e.x > e.stopX) { e.x -= 70 * dt; e.moving = true; return; }
  e.moving = false;
  if (e.unload > 0) {
    e.unT -= dt;
    if (e.unT <= 0) { e.unT = 0.7; e.unload--; mkEnemy(pick(["rifle", "knife", "grenadier", "shield"]), e.x + 30, { y: e.y + 14, vy: 120, vx: -50, wave: e.wave }); }
  }
  if (e.hp < e.maxHp * 0.35 && chance(0.2)) smoke(e.x, e.y + 26, 1, 3);
}
function updateBiker(e, dt) {
  e.warn -= dt;
  e.x -= 190 * dt; e.moving = true;
  if (chance(0.3)) dust(e.x + 12, e.y, 1);
  if (!e.hitDone && !P.dead) {
    const b = ebox(e), pb = P.inTank && tank ? tankBox() : pBox();
    if (overlap(b, pb)) { e.hitDone = true; hurtPlayer(); }
  }
  if (e.x < camX - 60) e.dead = true;
}
function updateJugg(e, dt, tg) {
  const dx = tg.x - e.x, ad = Math.abs(dx), dir = dx >= 0 ? 1 : -1;
  e.face = dir;
  if (e.x > camX + W - 20) { e.x -= 30 * dt; e.moving = true; return; }
  e.cd -= dt * fireRate(e);
  e.moving = false;
  if (e.mode === "walk") {
    if (ad > 110) { e.x += dir * (ad > 260 ? 34 : 20) * dt; e.moving = true; }
    if (e.cd <= 0 && ad < 280) { e.mode = chance(0.7) ? "spin" : "toss"; e.modeT = e.mode === "spin" ? 0.75 : 0.4; if (e.mode === "spin") { tone("sawtooth", 80, 400, 0.7, 0.06); } }
  } else if (e.mode === "spin") {
    e.modeT -= dt;
    if (e.modeT <= 0) { e.mode = "fire"; e.modeT = 1.3; e.low = chance(0.4); }
  } else if (e.mode === "fire") {
    e.modeT -= dt; e.fireT = (e.fireT || 0) - dt;
    if (e.fireT <= 0) {
      e.fireT = 0.07;
      const h = e.low ? 9 : 19;
      addB({ kind: "eb", team: "e", x: e.x + dir * 18, y: e.y + h + rand(-1, 1), vx: dir * 200, vy: 0, life: 2.5 });
      muzzle(e.x + dir * 18, e.y + h); sfx.enemyShot();
    }
    if (e.modeT <= 0) { e.mode = "walk"; e.cd = rand(1.8, 2.6); }
  } else if (e.mode === "toss") {
    e.modeT -= dt;
    if (e.modeT <= 0) {
      const T = 0.9, gr = GRAV * 0.8, y0 = e.y + 30;
      addB({ kind: "egren", team: "e", x: e.x, y: y0, vx: dx / T, vy: (GROUND - y0 - 0.5 * gr * T * T) / T, grav: gr, life: 3 });
      sfx.toss(); e.mode = "walk"; e.cd = rand(1.5, 2.2);
    }
  }
}
function updateNest(e, dt, tg) {
  const dx = tg.x - e.x, dir = dx >= 0 ? 1 : -1;
  e.face = dir;
  if (e.x > camX + W + 10 || e.x < camX - 10) return;
  e.cd -= dt * fireRate(e);
  if (e.mode === "fire") {
    e.modeT -= dt; e.fireT = (e.fireT || 0) - dt;
    if (e.fireT <= 0) {
      e.fireT = 0.09;
      const h = e.low ? 8 : 18;
      addB({ kind: "eb", team: "e", x: e.x + dir * 16, y: e.y + h, vx: dir * 190, vy: 0, life: 2.5 });
      muzzle(e.x + dir * 16, e.y + h); sfx.enemyShot();
    }
    if (e.modeT <= 0) { e.mode = null; e.cd = rand(1.4, 2); }
  } else if (e.mode === "aim") {
    e.modeT -= dt;
    if (e.modeT <= 0) { e.mode = "fire"; e.modeT = 1; }
  } else if (e.cd <= 0) { e.mode = "aim"; e.modeT = 0.6; e.low = chance(0.45); sfx.beep(); }
}

// ---------- Drawing ----------
function drawEnemy(e) {
  const x = sx(e.x), y = H - Math.round(e.y) - 1;
  if (x < -60 || x > W + 60) { if (e.type === "biker" && e.warn > 0) drawEdgeWarning(H - e.y - 14); return; }
  const mode = e.flash > 0 ? "flash" : "normal";
  switch (e.type) {
    case "heli": return drawHeli(e);
    case "drone": return drawDrone(e);
    case "truck": return drawTruck(e);
    case "biker": return drawBiker(e);
    case "mgnest": return drawNest(e);
  }
  if (e.type === "mortar") drawMortarTube(e);
  const o = { pal: e.pal, torso: e.type === "jugg" ? "t_jugg" : "t_rebel", head: e.type === "sniper" ? "h_beret" : e.type === "jugg" ? "h_jugg" : "h_rebel", t: e.anim };
  const sleeping = e.state === "idle" && e.idleKind === "sleep";
  const fl = e.plat ? e.plat.y : GROUND;
  o.pose = e.y > fl + 1 ? (e.para ? "fall" : "jump") : (e.crouch || sleeping || e.coverHide) ? "crouch" : e.moving ? "run" : "stand";
  o.chute = e.para && e.y > fl + 1;
  o.bob = e.state === "idle" && !sleeping;
  const alert = e.state === "alert" || e.panic > 0;
  switch (e.type) {
    case "rifle": case "sniper": o.arm = alert ? "flail" : (e.state === "idle" ? "idle" : "f"); o.gun = "rifle"; break;
    case "knife": o.arm = alert ? "flail" : e.atkT > 0 ? "knife" : "knifeIdle"; break;
    case "grenadier": o.arm = alert ? "flail" : e.throwT > 0 ? "throw" : "idle"; break;
    case "bazooka": o.arm = alert ? "flail" : "bazooka"; break;
    case "shield": o.arm = e.shield > 0 ? "shield" : (alert ? "flail" : "idle"); o.poke = e.atkT > 0; break;
    case "mortar": o.arm = "hold"; break;
    case "jugg": o.arm = "minigun"; break;
  }
  drawSoldier(o, x, y, e.face, { mode });
  if ((e.type === "rifle" || e.type === "bazooka") && e.aimT > 0 && Math.floor(clock * 20) % 2) {
    const mx = x + e.face * 13, my = H - Math.round(e.y) - (e.type === "bazooka" ? 13 : e.crouch ? 12 : 18);
    g.fillStyle = "#ffffff"; g.fillRect(mx - 1, my, 3, 1); g.fillRect(mx, my - 1, 1, 3);
  }
  if (e.type === "sniper" && e.aimT > 0 && e.lock) {
    const mx = e.x + e.face * 12, my = e.y + 12, tx = e.lock.x, ty = e.lock.y;
    const n = Math.ceil(Math.hypot(tx - mx, ty - my) / 3), on = e.aimT < 0.4 || Math.floor(clock * 10) % 2;
    if (on) { g.fillStyle = e.aimT < 0.4 ? "#ff2a2a" : "#ff6a6a"; for (let i = 0; i < n; i += e.aimT < 0.4 ? 1 : 2) g.fillRect(sx(lerp(mx, tx, i / n)), sy(lerp(my, ty, i / n)), 1, 1); }
  }
  if (e.type === "jugg") {
    const w = 24, bx = x - 12, by = H - Math.round(e.y) - 40;
    g.fillStyle = "#000"; g.fillRect(bx - 1, by - 1, w + 2, 4); g.fillStyle = "#4a1010"; g.fillRect(bx, by, w, 2);
    g.fillStyle = "#ff5a3a"; g.fillRect(bx, by, Math.max(0, w * e.hp / e.maxHp), 2);
    if (e.mode === "spin" && Math.floor(clock * 20) % 2) { g.fillStyle = "#ff8a3a"; g.fillRect(x + e.face * 17 - 1, H - Math.round(e.y) - 20, 3, 3); }
  }
  if (e.state === "alert") text("!", x - 3, H - e.y - 42, "#ffffff");
  if (sleeping) text("z", x + 4 + Math.round(Math.sin(clock * 2) * 2), H - e.y - 32 - Math.floor(clock * 6 % 8), "#ffffff");
}
function drawEdgeWarning(y) {
  if (Math.floor(clock * 8) % 2) return;
  const x = W - SAFE.r - 14;
  text("!", x, y - 4, "#ff4a3a", { outline: true });
  g.fillStyle = "#ff4a3a"; g.fillRect(x + 8, y - 2, 4, 4);
}
function drawDrone(e) {
  const p = procCanvas(24, 14), c = p.g, cx = 12, cy = 8, lock = e.mode === "lock" || e.mode === "dive";
  PR(c, cx - 5, cy - 2, 10, 5, "#3a3e46"); PR(c, cx - 5, cy - 2, 10, 1, "#5a606a"); PR(c, cx - 3, cy + 3, 6, 1, "#2a2e34");
  PR(c, cx - 1, cy, 3, 2, lock && Math.floor(clock * 14) % 2 ? "#ff3020" : "#8fd0e8");
  const rw = Math.round(Math.abs(Math.sin(clock * 50)) * 5 + 2);
  PR(c, cx - 8, cy - 3, 3, 1, "#3a3e46"); PR(c, cx + 5, cy - 3, 3, 1, "#3a3e46");
  PR(c, cx - 7 - (rw >> 1), cy - 5, rw, 1, "#222"); PR(c, cx + 7 - (rw >> 1), cy - 5, rw, 1, "#222");
  procBlit(p, sx(e.x) - cx, H - Math.round(e.y) - cy, { flip: e.face < 0, flash: e.flash > 0 });
  if (e.mode === "lock") { g.fillStyle = "#ff3020"; const mx = sx(e.aim.x), my = H - GROUND; if (Math.floor(clock * 10) % 2) { g.fillRect(mx - 4, my - 1, 9, 1); g.fillRect(mx, my - 5, 1, 9); } }
}
function drawHeli(e) {
  const p = procCanvas(70, 30), c = p.g, cx = 35, cy = 16;
  const body = "#6b7a3a", dark = "#4a5528";
  PR(c, cx - 12, cy - 5, 22, 11, body); PR(c, cx - 12, cy + 3, 22, 3, dark); PR(c, cx - 12, cy - 5, 18, 1, shade(body, 0.2));
  PR(c, cx + 6, cy - 3, 7, 6, "#8fd0e8"); PR(c, cx + 8, cy - 2, 3, 2, "#e6f6ff");
  PR(c, cx - 30, cy - 2, 20, 3, body); PR(c, cx - 32, cy - 5, 3, 8, dark);
  PR(c, cx - 1, cy - 8, 3, 3, dark);
  const rw = Math.round(Math.abs(Math.sin(clock * 40)) * 28 + 6); PR(c, cx - (rw >> 1), cy - 9, rw, 1, "#222");
  PR(c, cx - 33, cy - 3 + (Math.floor(clock * 30) % 2 ? -2 : 1), 1, 4, "#222");
  PR(c, cx - 10, cy + 8, 18, 1, "#333"); PR(c, cx - 6, cy + 6, 1, 2, "#333"); PR(c, cx + 4, cy + 6, 1, 2, "#333");
  PR(c, cx - 5, cy - 1, 3, 3, "#c83a2a");
  procBlit(p, sx(e.x) - cx, H - Math.round(e.y) - cy, { flip: e.face < 0, flash: e.flash > 0 });
}
function drawTruck(e) {
  const p = procCanvas(62, 36), c = p.g, fl = e.flash > 0;
  const body = "#6b7a3a", dark = "#4a5528", cloth = "#a89a6a";
  PR(c, 3, 22, 56, 5, "#2a2a2a");
  PR(c, 3, 16, 34, 6, body); PR(c, 3, 4, 34, 13, cloth); PR(c, 3, 4, 34, 2, shade(cloth, 0.2)); PR(c, 3, 15, 34, 2, shade(cloth, -0.2));
  for (let i = 0; i < 4; i++) PR(c, 6 + i * 10, 6, 1, 10, shade(cloth, -0.2));
  PR(c, 17, 9, 5, 5, "#c83a2a");
  PR(c, 39, 8, 20, 16, body); PR(c, 39, 8, 20, 3, dark); PR(c, 47, 10, 8, 7, "#8fd0e8"); PR(c, 57, 14, 3, 7, shade(body, 0.2)); PR(c, 58, 16, 2, 2, "#ffd34d");
  const spin = Math.floor(e.anim * 20) % 2;
  for (const wx of [13, 25, 49]) { pcirc(c, wx, 28, 4.5, "#1a1a1a"); pcirc(c, wx, 28, 2, "#666"); PR(c, wx - (spin ? 0 : 1), 28, 2, 1, "#aaa"); }
  if (e.hp < e.maxHp * 0.35) PR(c, 28, 1, 2, 2, Math.floor(clock * 10) % 2 ? "#ff8a1a" : "#ffd34d");
  procBlit(p, sx(e.x) - 31, H - Math.round(e.y) - 33, { flip: e.face > 0, flash: fl });
}
function drawBiker(e) {
  const p = procCanvas(30, 32), c = p.g;
  const pal = PALS[e.pal];
  const spin = Math.floor(clock * 24) % 2;
  for (const wx of [5, 24]) { pcirc(c, wx, 26, 4.5, "#1a1a1a"); pcirc(c, wx, 26, 2, "#777"); PR(c, wx - 1 + spin, 26, 2, 1, "#bbb"); }
  PR(c, 6, 19, 18, 4, "#8a2a2a"); PR(c, 4, 17, 8, 3, "#5a5a62"); PR(c, 20, 15, 3, 7, "#5a5a62"); PR(c, 21, 14, 5, 2, "#333");
  PR(c, 10, 9, 8, 9, pal.C); PR(c, 10, 9, 2, 9, pal.c); PR(c, 9, 17, 9, 3, pal.P);
  PR(c, 15, 11, 7, 2, pal.C); PR(c, 21, 11, 2, 2, pal.S);
  PR(c, 11, 2, 7, 7, pal.S); PR(c, 10, 0, 9, 4, pal.A); PR(c, 15, 4, 4, 2, "#222");
  procBlit(p, sx(e.x) - 15, H - Math.round(e.y) - 31, { flip: e.face > 0, flash: e.flash > 0 });
}
function drawNest(e) {
  const p = procCanvas(40, 30), c = p.g, pal = PALS[e.pal];
  const aimLow = e.mode && e.low;
  PR(c, 10, 6, 7, 7, pal.S); PR(c, 9, 4, 9, 4, pal.A); PR(c, 10, 13, 8, 6, pal.C);
  const gy = aimLow ? 16 : 11;
  PR(c, 14, gy, 22, 3, "#34343e"); PR(c, 16, gy - 1, 6, 1, "#565664"); PR(c, 15, gy + 3, 2, 6, "#34343e");
  for (let r = 0; r < 2; r++) for (let i = 0; i < 4 - r; i++) { const bx = 4 + i * 8 + r * 4, by = 26 - r * 5; PR(c, bx, by - 5, 8, 6, "#8a7a52"); PR(c, bx + 1, by - 5, 6, 4, "#c8b48a"); }
  if (e.mode === "aim" && Math.floor(clock * 20) % 2) PR(c, 36, gy, 3, 3, "#ffffff");
  procBlit(p, sx(e.x) - 20, H - Math.round(e.y) - 28, { flip: e.face < 0, flash: e.flash > 0 });
}
function drawMortarTube(e) {
  const p = procCanvas(16, 18), c = p.g;
  PR(c, 2, 14, 12, 3, "#3a3a40"); PR(c, 5, 3, 5, 12, "#4a5262"); PR(c, 4, 2, 7, 2, "#2a2a30"); PR(c, 3, 12, 2, 4, "#2a2a30"); PR(c, 11, 12, 2, 4, "#2a2a30");
  procBlit(p, sx(e.x + e.face * 9) - 8, H - Math.round(e.y) - 17, { flip: e.face < 0, flash: e.flash > 0 });
}
