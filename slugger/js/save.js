"use strict";
// Progress saved on the phone: coins, armory, soldiers, mission stars and records, achievements,
// daily tasks and settings. Everything stays local (localStorage), versioned, with a backup code.

const SAVE_KEY = "slugger2.save";
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

function defaultSave() {
  return {
    v: 1, coins: 0, hero: 0,
    heroes: [0, 1, 2, 3].map(i => ({ unlocked: i === 0, xp: 0, level: 1, costume: 0 })),
    armory: { power: 0, ammo: 0, bombs: 0, armor: 0, slug: 0, start: 0 },
    missions: {}, unlocked: 1, hardUnlocked: false, hard: false,
    survival: { best: 0, bestScore: 0 },
    achievements: {},
    stats: { kills: 0, pows: 0, deaths: 0, missionsWon: 0, bosses: 0, vehicles: 0, coinsEarned: 0, playTime: 0,
      bestCombo: 0, secrets: 0, upgrades: 0, flawless: 0, hardWins: 0, kills_P: 0, kills_H: 0, kills_R: 0, kills_F: 0,
      kills_S: 0, kills_G: 0, kills_K: 0, kills_T: 0 },
    daily: { day: "", tasks: [], streak: 0, lastDone: "", max: { combo: 0, wave: 0 } },
    seen: {},
    settings: { autoFire: null, aimAssist: true, haptics: true, shake: true, music: 0.8, sfx: 1, voice: true,
      ctrlSize: 1, ctrlAlpha: 0.6, leftHanded: false, layout: {} },
  };
}
function mergeSave(base, data) {
  for (const k of Object.keys(data || {})) {
    if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && data[k] && typeof data[k] === "object" && !Array.isArray(data[k])) mergeSave(base[k], data[k]);
    else if (data[k] !== undefined) base[k] = data[k];
  }
  return base;
}
function loadSave() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) return mergeSave(defaultSave(), JSON.parse(raw)); } catch {}
  return defaultSave();
}
let save = loadSave();
let saveDirty = false;
function persist() { saveDirty = false; try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }
function markDirty() { saveDirty = true; }
try { navigator.storage?.persist?.(); } catch {}

function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(save)))); }
function importSave(code) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (!data || data.v !== 1) return false;
    save = mergeSave(defaultSave(), data); persist(); applyVolumes(); return true;
  } catch { return false; }
}
function resetSave() { const s = save.settings; save = defaultSave(); save.settings = s; persist(); }
const autoFireOn = () => save.settings.autoFire ?? isTouch;

// ---------- Armory ----------
const ARMORY = [
  { id: "power", name: "FIREPOWER", desc: l => `+${l * 12}% DAMAGE, ALL GUNS`, short: l => `+${l * 12}% DAMAGE` },
  { id: "ammo", name: "AMMO BELT", desc: l => `+${l * 20}% AMMO IN WEAPON CRATES`, short: l => `+${l * 20}% AMMO` },
  { id: "bombs", name: "GRENADES", desc: l => `START WITH ${10 + l * 2}, +${l * 8}% BLAST`, short: l => `${10 + l * 2} GRENADES` },
  { id: "armor", name: "ARMOR", desc: l => `${maxHpFor(l)} HEARTS PER LIFE`, short: l => `${maxHpFor(l)} HEARTS` },
  { id: "slug", name: "SLUG PLATING", desc: l => `SLUG ${6 + l * 2} HP, +${l * 3} SHELLS`, short: l => `SLUG ${6 + l * 2} HP` },
  { id: "start", name: "LOADOUT", desc: l => l ? `START WITH H GUN (${l * 40} AMMO)` : "START WITH THE PISTOL", short: l => `H GUN ${l * 40} AMMO` },
];
const ARMORY_COST = [80, 180, 350, 600, 1000];
const maxHpFor = l => 3 + l;
const armoryCost = id => { const l = save.armory[id]; return l >= 5 ? null : ARMORY_COST[l]; };
function buyArmory(id) {
  const c = armoryCost(id);
  if (c === null || save.coins < c) return false;
  save.coins -= c; save.armory[id]++; save.stats.upgrades++;
  checkAchievements(); persist(); return true;
}

// ---------- Soldiers ----------
const HERO_INFO = [
  { name: "RAYO", perk: "pistol", perkText: l => `PISTOL DAMAGE +${50 + l * 5}%`, unlockMission: 0, cost: 0 },
  { name: "TANIA", perk: "ammo", perkText: l => `WEAPON AMMO +${30 + l * 4}%`, unlockMission: 2, cost: 500 },
  { name: "ERIKA", perk: "bombs", perkText: l => `+${5 + l} GRENADES`, unlockMission: 3, cost: 800 },
  { name: "FITO", perk: "speed", perkText: l => `RUN SPEED +${10 + l}%`, unlockMission: 4, cost: 1200 },
];
const COSTUME_LEVELS = [1, 3, 6, 10];
const MAX_LEVEL = 10;
const xpToNext = l => 250 + l * 150;
const heroSave = (i = save.hero) => save.heroes[i];
function heroPerk(kind) {
  const i = save.hero, h = save.heroes[i];
  if (HERO_INFO[i].perk !== kind) return 0;
  const l = h.level;
  if (kind === "pistol") return 0.5 + l * 0.05;
  if (kind === "ammo") return 0.3 + l * 0.04;
  if (kind === "bombs") return 5 + l;
  if (kind === "speed") return 0.1 + l * 0.01;
  return 0;
}
function unlockHeroes() {
  HERO_INFO.forEach((h, i) => {
    if (!save.heroes[i].unlocked && h.unlockMission && save.missions[h.unlockMission]?.done) {
      save.heroes[i].unlocked = true; toast(`${h.name} JOINED THE SQUAD!`, "#7ad0ff");
    }
  });
  checkAchievements();
}
function buyHero(i) {
  const h = save.heroes[i];
  if (h.unlocked || save.coins < HERO_INFO[i].cost) return false;
  save.coins -= HERO_INFO[i].cost; h.unlocked = true; checkAchievements(); persist(); return true;
}
// Returns the levels gained
function addXp(amount) {
  const h = heroSave(); let gained = 0;
  if (h.level >= MAX_LEVEL) return 0;
  h.xp += amount;
  while (h.level < MAX_LEVEL && h.xp >= xpToNext(h.level)) { h.xp -= xpToNext(h.level); h.level++; gained++; }
  if (h.level >= MAX_LEVEL) h.xp = 0;
  if (gained) checkAchievements();
  return gained;
}

// ---------- Coins, stats, toasts ----------
const toasts = [];
function toast(msg, color = "#ffd34d", icon = null) { toasts.push({ msg, color, icon, t: 0 }); }
function addCoins(n) { n = Math.round(n); if (n <= 0) return; save.coins += n; save.stats.coinsEarned += n; markDirty(); }
function stat(name, n = 1) { save.stats[name] = (save.stats[name] || 0) + n; markDirty(); }
function statMax(name, v) { if (v > (save.stats[name] || 0)) { save.stats[name] = v; markDirty(); } }

// ---------- Achievements ----------
const ACHIEVEMENTS = [
  ["first", "FIRST BLOOD", "DEFEAT YOUR FIRST ENEMY", 20, s => s.kills >= 1],
  ["k100", "SOLDIER", "DEFEAT 100 ENEMIES", 50, s => s.kills >= 100],
  ["k1000", "VETERAN", "DEFEAT 1,000 ENEMIES", 150, s => s.kills >= 1000],
  ["k5000", "LEGEND", "DEFEAT 5,000 ENEMIES", 400, s => s.kills >= 5000],
  ["p10", "RESCUER", "FREE 10 PRISONERS", 50, s => s.pows >= 10],
  ["p50", "HOPE BRINGER", "FREE 50 PRISONERS", 150, s => s.pows >= 50],
  ["p150", "LIBERATOR", "FREE 150 PRISONERS", 300, s => s.pows >= 150],
  ["m1", "SAND STORM", "CLEAR MISSION 1", 60, () => !!save.missions[1]?.done],
  ["m2", "INTO THE GREEN", "CLEAR MISSION 2", 80, () => !!save.missions[2]?.done],
  ["m3", "COLD FRONT", "CLEAR MISSION 3", 100, () => !!save.missions[3]?.done],
  ["m4", "NIGHT SHIFT", "CLEAR MISSION 4", 120, () => !!save.missions[4]?.done],
  ["m5", "HIGH TIDE", "CLEAR MISSION 5", 140, () => !!save.missions[5]?.done],
  ["m6", "VICTORY", "CLEAR MISSION 6", 250, () => !!save.missions[6]?.done],
  ["stars3", "PERFECTIONIST", "GET 3 STARS IN A MISSION", 100, () => Object.values(save.missions).some(m => m.stars?.every(Boolean))],
  ["stars18", "GENERAL", "GET ALL 18 STARS", 500, () => [1, 2, 3, 4, 5, 6].every(i => save.missions[i]?.stars?.every(Boolean))],
  ["flawless", "UNTOUCHABLE", "CLEAR A MISSION WITHOUT A HIT", 200, s => s.flawless >= 1],
  ["c10", "COMBO x10", "REACH A x10 COMBO", 50, s => s.bestCombo >= 10],
  ["c30", "COMBO x30", "REACH A x30 COMBO", 150, s => s.bestCombo >= 30],
  ["gren", "GRENADIER", "50 GRENADE KILLS", 80, s => s.kills_G >= 50],
  ["pyro", "PYRO", "50 FLAME SHOT KILLS", 80, s => s.kills_F >= 50],
  ["knife", "CLOSE QUARTERS", "25 KNIFE KILLS", 80, s => s.kills_K >= 25],
  ["slug", "TANK COMMANDER", "50 KILLS WITH THE SLUG", 100, s => s.kills_T >= 50],
  ["veh", "WRECKER", "DESTROY 20 VEHICLES", 100, s => s.vehicles >= 20],
  ["boss", "GIANT SLAYER", "DEFEAT 10 BOSSES", 150, s => s.bosses >= 10],
  ["tag3", "TREASURE HUNTER", "FIND 3 DOG TAGS", 50, s => s.secrets >= 3],
  ["tag18", "NOTHING HIDDEN", "FIND ALL 18 DOG TAGS", 300, () => [1, 2, 3, 4, 5, 6].every(i => (save.missions[i]?.tags || []).filter(Boolean).length >= 3)],
  ["up10", "WELL EQUIPPED", "BUY 10 UPGRADES", 100, s => s.upgrades >= 10],
  ["upmax", "MAXED OUT", "MAX OUT AN UPGRADE", 150, () => Object.values(save.armory).some(l => l >= 5)],
  ["squad", "FULL SQUAD", "UNLOCK ALL SOLDIERS", 200, () => save.heroes.every(h => h.unlocked)],
  ["elite", "ELITE", "GET A SOLDIER TO LEVEL 10", 300, () => save.heroes.some(h => h.level >= MAX_LEVEL)],
  ["w10", "SURVIVOR", "REACH WAVE 10 IN SURVIVAL", 100, () => save.survival.best >= 10],
  ["w25", "UNSTOPPABLE", "REACH WAVE 25 IN SURVIVAL", 300, () => save.survival.best >= 25],
  ["streak", "DEDICATED", "7-DAY DAILY STREAK", 200, () => save.daily.streak >= 7],
  ["hard", "HARDCORE", "CLEAR A MISSION ON HARD", 200, s => s.hardWins >= 1],
].map(([id, name, desc, reward, check]) => ({ id, name, desc, reward, check }));
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (save.achievements[a.id] || !a.check(save.stats)) continue;
    save.achievements[a.id] = true;
    addCoins(a.reward);
    toast(`★ ${a.name}  +${a.reward} ¤`, "#ffd34d");
    if (typeof sfx !== "undefined") sfx.achieve();
  }
}

// ---------- Daily tasks ----------
const DAILY_POOL = [
  { id: "kills", stat: "kills", n: [60, 90, 120], text: n => `DEFEAT ${n} ENEMIES`, reward: 80 },
  { id: "pows", stat: "pows", n: [6, 10], text: n => `FREE ${n} PRISONERS`, reward: 80 },
  { id: "wins", stat: "missionsWon", n: [1, 2], text: n => `WIN ${n} MISSION${n > 1 ? "S" : ""}`, reward: 100 },
  { id: "gren", stat: "kills_G", n: [10, 15], text: n => `${n} GRENADE KILLS`, reward: 90 },
  { id: "flame", stat: "kills_F", n: [12, 20], text: n => `${n} FLAME SHOT KILLS`, reward: 90 },
  { id: "shot", stat: "kills_S", n: [12, 20], text: n => `${n} SHOTGUN KILLS`, reward: 90 },
  { id: "hmg", stat: "kills_H", n: [30, 45], text: n => `${n} HEAVY MACHINE GUN KILLS`, reward: 90 },
  { id: "rocket", stat: "kills_R", n: [10, 15], text: n => `${n} ROCKET KILLS`, reward: 90 },
  { id: "knife", stat: "kills_K", n: [5, 8], text: n => `${n} KNIFE KILLS`, reward: 100 },
  { id: "slug", stat: "kills_T", n: [15, 25], text: n => `${n} KILLS WITH THE SLUG`, reward: 90 },
  { id: "veh", stat: "vehicles", n: [3, 5], text: n => `DESTROY ${n} VEHICLES`, reward: 90 },
  { id: "coins", stat: "coinsEarned", n: [300, 500], text: n => `COLLECT ${n} COINS`, reward: 80 },
  { id: "tags", stat: "secrets", n: [1, 2], text: n => `FIND ${n} DOG TAG${n > 1 ? "S" : ""}`, reward: 100 },
  { id: "combo", max: "combo", n: [10, 15], text: n => `REACH A x${n} COMBO`, reward: 90 },
  { id: "wave", max: "wave", n: [5, 8], text: n => `REACH WAVE ${n} IN SURVIVAL`, reward: 100 },
];
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function ensureDaily() {
  const today = dayKey();
  const d = save.daily;
  if (d.day === today) return;
  const r = mulberry([...today].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
  const pool = DAILY_POOL.filter(t => t.id !== "wave" || save.missions[1]?.done);
  const picked = [];
  while (picked.length < 3) { const t = pool[Math.floor(r() * pool.length)]; if (!picked.includes(t)) picked.push(t); }
  d.day = today; d.max = { combo: 0, wave: 0 };
  d.tasks = picked.map(t => { const n = t.n[Math.floor(r() * t.n.length)]; return { id: t.id, n, base: t.stat ? save.stats[t.stat] || 0 : 0, done: false }; });
  persist();
}
function dailyProgress(task) {
  const def = DAILY_POOL.find(t => t.id === task.id);
  if (!def) return 0;
  const v = def.max ? save.daily.max[def.max] : (save.stats[def.stat] || 0) - task.base;
  return Math.min(task.n, v);
}
function checkDaily() {
  ensureDaily();
  const d = save.daily;
  for (const task of d.tasks) {
    if (task.done || dailyProgress(task) < task.n) continue;
    task.done = true;
    const def = DAILY_POOL.find(t => t.id === task.id);
    let bonus = 0;
    if (d.lastDone !== d.day) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      d.streak = d.lastDone === dayKey(y) ? d.streak + 1 : 1;
      d.lastDone = d.day;
      bonus = 25 * Math.min(d.streak, 7);
    }
    addCoins(def.reward + bonus);
    toast(`DAILY DONE: ${def.text(task.n)}  +${def.reward + bonus} ¤`, "#8ae06a");
    if (typeof sfx !== "undefined") sfx.achieve();
  }
  checkAchievements();
}
function dailyMax(kind, v) { ensureDaily(); if (v > save.daily.max[kind]) save.daily.max[kind] = v; }
