'use strict';
// ================= worlds =================
// A world is pure data: materials, lighting, scenery and level rules. The board renderer (board.js) paints
// whatever a world describes and the level generator (levels.js) follows its rules, so a new world
// (desert, snow, volcano…) is a new entry here plus a line in CAMPAIGN — no engine changes.
//
// Shape of a world:
//   name, accent (portal/UI glow), debris (soft-block chunks)
//   light    – shadow offset/blur/colour, sun & shade grading, vignette, ambient motes
//   floor    – turf checker colours, grout, grass blades, clover & flower decals, plaza paving
//   pillar   – indestructible stone cube;  wall – border wall;  brick – destructible block
//   obstacle – extra indestructible props a layout may scatter (skins chosen by the level generator)
//   outside  – ground, path, trees, lanterns and props framing the arena
//   levels   – layout weights, block density curve, enemy roster curve
const WORLDS = {
  forest: {
    id: 'forest', name: 'BOSQUE',
    accent: '#b8ff6a',
    debris: ['#ef8d4c', '#c8622c', '#7d3815', '#f7d2a6'],
    light: {
      shadow: { dx: 0.22, dy: 0.26, blur: 0.13, color: 'rgba(8,26,2,0.62)' },
      sun: 'rgba(255,190,100,0.38)',       // soft-light wash from the top-left
      shade: 'rgba(28,56,92,0.30)',        // cool multiply toward the bottom-right
      rays: 'rgba(255,236,170,0.07)',
      outsideDim: 'rgba(6,14,4,0.34)',
      vignette: 'rgba(6,10,3,0.55)',
      motes: { count: 14, color: '#fff1a8' },
    },
    floor: {
      turf: [['#6cbb45', '#57a338'], ['#62b240', '#4f9a33']],   // checker A / B: light → dark
      grout: '#2d5f1d',
      blades: ['#8fd65e', '#4a9430', '#a9e276', '#3d8227', '#76c24c'],
      clover: ['#3c8a2a', '#5aab3f', '#7cc95a'],
      flowers: [['#ffffff', '#ffd23f'], ['#ffe14d', '#ff9a1f'], ['#ffb36b', '#fff4c2'], ['#f4f0ff', '#ffcc33']],
      flowerRate: 0.17, cloverRate: 0.32,
      paving: ['#d6ccb2', '#a99f86', '#7c745f'],
    },
    pillar: { top: ['#c9ccc7', '#8f9590'], side: ['#737a76', '#3c423f'], crack: '#4a504c', moss: ['#7fae42', '#4d7f29'], mossRate: 0.55 },
    wall: { top: ['#b4b8ae', '#80867c'], side: ['#6c7369', '#383e37'], seam: '#353d32', moss: ['#80b544', '#4c7f28'], vine: ['#3b7a25', '#5ea53a', '#86cc55'] },
    brick: { top: ['#f6a05a', '#de7638'], side: ['#c9632c', '#8c3c18'], mortar: '#f4cfa2', shade: '#5c260c' },
    obstacle: {
      rock: { top: ['#b9bfc0', '#868d90'], side: ['#737a7d', '#454b4e'], moss: ['#86b84a', '#4f8a2c'] },
      stump: { bark: ['#9a6a3e', '#5a381c', '#3a2312'], wood: ['#f0cf98', '#cf9f66', '#a8743f'], moss: ['#7fb244', '#4c8429'] },
    },
    outside: {
      ground: ['#33492a', '#121a0c'], tuft: ['#4e7a34', '#3a5e27', '#6a9a45'], dirt: 'rgba(60,44,24,0.35)',
      path: ['#8a8878', '#6a695b', '#2a2a22'],
      leaf: ['#9ad866', '#5ea53c', '#357a26', '#1b4a14'], trunk: ['#7c5434', '#45291a'],
      lantern: { metal: '#2a2a30', light: '#ffd27a', glow: '#ffb547' },
      barrel: ['#a26a38', '#5e3517', '#3b3b40'],
      props: [['tree', 7], ['bush', 5], ['rock', 3], ['flowers', 4], ['mushroom', 2], ['barrel', 1]],
    },
    // 3D diorama (board3d.js): camera, lights and proportions; colours come from the materials above.
    scene3d: {
      theme: 'forest',
      camera: { elevation: 64, fov: 30, landscape: { elevation: 62, fov: 21 } },   // degrees above the horizon, vertical field of view
      sun: { color: '#ffd29c', intensity: 4.2, from: [-5, 12, -5.5] },
      sky: { color: '#ffe6c6', ground: '#3d4a26', intensity: 0.78 },
      fill: { color: '#9fc0ff', intensity: 0.32 },
      lamp: { color: '#ffb25c', intensity: 6, distance: 5 },
      fog: '#17210f', exposure: 1.28,
      heights: { wall: 0.66, pillar: 0.6, brick: 0.6 },
      stone: { pillar: ['#d6dad9', '#8a9192'], wall: ['#b2b8b6', '#646c6a'] }, base: '#1e3d12',
      brick: { colors: ['#de6c2c', '#c4561f', '#e67a38', '#b54c1b'], mortar: '#b07446' },
    },
    levels: {
      layouts: [['classic', 4], ['grove', 3], ['clearings', 3], ['plaza', 2]],
      firstLayout: 'classic', bossLayout: 'plaza',   // stage 1 teaches on the classic grid; bosses fight on the plaza
      obstacleSkins: [['rock', 2], ['stump', 3]],
      density: { base: 0.44, perStage: 0.005, max: 0.56, boss: 0.24, battle: 0.7 },
      enemies: { base: 3, perStage: 0.55, max: 11, tierEvery: 2, maxTier: 6 },
    },
  },
};

// The other worlds share the forest's level rules, with their own obstacle mix. plazaPool: the plaza's
// centrepiece is a pool (water, ice, cooled lava), so no blocks are dropped on it.
const sameLevels = skins => Object.assign({}, WORLDS.forest.levels, { obstacleSkins: skins });

// ---- desert: sun-baked sand, sandstone ruins, wooden crates, cacti and palms ----
WORLDS.desert = {
  id: 'desert', name: 'DESIERTO',
  accent: '#ffcf5a',
  debris: ['#d9a35a', '#a8692f', '#6b4520', '#f4dcae'],
  light: {
    shadow: { dx: 0.24, dy: 0.26, blur: 0.12, color: 'rgba(70,36,8,0.55)' },
    sun: 'rgba(255,214,140,0.42)', shade: 'rgba(120,70,40,0.22)', rays: 'rgba(255,240,200,0.09)',
    outsideDim: 'rgba(60,30,8,0.22)', vignette: 'rgba(60,28,6,0.45)',
    motes: { count: 18, color: '#ffe2a8', kind: 'float' },   // drifting dust
  },
  floor: {
    turf: [['#efce8f', '#e2bb78'], ['#e8c482', '#d9b06c']],
    grout: '#b48348',
    blades: ['#d8b468', '#a07a3a', '#e8cc88', '#7d5e2a', '#c29a50'],   // dry grass
    clover: ['#b39672', '#d2b894', '#8a7052'],                         // pebbles
    flowers: [['#ff7aa8', '#ffd23f'], ['#ffb347', '#fff1b8'], ['#ff5c7a', '#ffe08a']],
    flowerRate: 0.04, cloverRate: 0.4,
    paving: ['#ead2a0', '#c6a46c', '#8c6f44'],
  },
  pillar: { top: ['#f2d59c', '#caa565'], side: ['#c69656', '#8a6232'], crack: '#7a5428', moss: ['#c9a35a', '#a07a3a'], mossRate: 0 },
  wall: { top: ['#e2c088', '#b38c52'], side: ['#b08048', '#6e4c26'], seam: '#5e3e1e', moss: ['#d8aa66', '#b08448'], vine: ['#8a9a3a', '#a8b84a', '#c2d060'] },
  brick: { top: ['#d69a58', '#b07438'], side: ['#9c6430', '#6b4520'], mortar: '#3e2812', shade: '#2e1c0c' },
  obstacle: {
    rock: { top: ['#e8c48a', '#c09058'], side: ['#b07c44', '#7a5228'], moss: ['#e8cc94', '#cfae74'] },
    stump: { bark: ['#6aa844', '#3f7a2a', '#24501a'], wood: ['#9ccc5a', '#6aa840', '#4a8a2c'], moss: ['#ff7aa8', '#ffd23f'] },
  },
  outside: {
    ground: ['#e0b878', '#a8763e'], tuft: ['#c9a458', '#a8823e', '#dcbc72'], dirt: 'rgba(150,100,50,0.3)',
    path: ['#cbab7a', '#a68a5e', '#5e4a30'],
    leaf: ['#a8d860', '#72b040', '#4a8a30', '#2a5a1e'], trunk: ['#a8804c', '#5e4228'],
    lantern: { metal: '#3a2a22', light: '#ffd27a', glow: '#ff9a3a' },
    barrel: ['#c8743e', '#7a3a1a', '#3b2a20'],
    props: [['tree', 5], ['bush', 5], ['rock', 5], ['flowers', 1], ['barrel', 2]],
  },
  scene3d: {
    theme: 'desert',
    camera: { elevation: 64, fov: 30, landscape: { elevation: 62, fov: 21 } },
    sun: { color: '#fff0d2', intensity: 4.6, from: [-5, 12, -4.5] },
    sky: { color: '#ffe8c2', ground: '#b07a3e', intensity: 0.9 },
    fill: { color: '#ffd6a0', intensity: 0.3 },
    lamp: { color: '#ff9a3c', intensity: 6, distance: 5 },
    fog: '#d8a868', exposure: 1.12, base: '#8a5a2c',
    heights: { wall: 0.66, pillar: 0.6, brick: 0.6 },
    stone: { pillar: ['#f4dba6', '#b98c50'], wall: ['#dcb47a', '#8e6436'] },
    brick: { style: 'crate', colors: ['#d08e4c', '#b8783c', '#dc9c5a', '#a8692f'], mortar: '#4a2e14' },
  },
  levels: Object.assign(sameLevels([['rock', 3], ['stump', 2]]), { plazaPool: true }),
};

// ---- snow: powder snow, ice pillars, frozen bricks, snowy pines; snowflakes drift down ----
WORLDS.snow = {
  id: 'snow', name: 'NIEVE',
  accent: '#7fe3ff',
  debris: ['#d8f0ff', '#a8d4f2', '#6fa8d0', '#ffffff'],
  light: {
    shadow: { dx: 0.2, dy: 0.24, blur: 0.14, color: 'rgba(30,60,110,0.42)' },
    sun: 'rgba(255,250,235,0.3)', shade: 'rgba(60,100,170,0.25)', rays: 'rgba(240,250,255,0.07)',
    outsideDim: 'rgba(20,40,70,0.2)', vignette: 'rgba(16,30,60,0.45)',
    motes: { count: 46, color: '#ffffff', kind: 'fall' },   // snowfall
  },
  floor: {
    turf: [['#eef3f9', '#d9e4f0'], ['#e6edf6', '#cfdcea']],
    grout: '#9db4cc',
    blades: ['#e2ecf6', '#a9bfd6', '#ffffff', '#8aa3bf', '#c9d9ea'],
    clover: ['#c2dcf2', '#ffffff', '#9fc0de'],                         // snow lumps
    flowers: [['#cfeaff', '#7fc7ff'], ['#e6f4ff', '#a8dcff']],
    flowerRate: 0, cloverRate: 0.45,
    paving: ['#cad6e2', '#93a6b8', '#617386'],
  },
  pillar: { top: ['#dcf4ff', '#a2d6f4'], side: ['#88c2e8', '#4f8cba'], crack: '#5a9ac8', moss: ['#ffffff', '#dceaf6'], mossRate: 0.7 },
  wall: { top: ['#c0ccd8', '#7a8a9a'], side: ['#7a8898', '#3e4a58'], seam: '#34404c', moss: ['#ffffff', '#dfeaf5'], vine: ['#cfeeff', '#e8f8ff', '#ffffff'] },
  brick: { top: ['#d4eeff', '#a8d4f2'], side: ['#9ccbec', '#6aa2cc'], mortar: '#f4fbff', shade: '#4a7aa8' },
  obstacle: {
    rock: { top: ['#a8b4c0', '#7a8692'], side: ['#6e7a86', '#424c56'], moss: ['#ffffff', '#e2edf7'] },
    stump: { bark: ['#ffffff', '#e4eef8', '#c8d8e8'], wood: ['#ffffff', '#e8f0f8', '#d0deec'], moss: ['#ff8a2a', '#2a2a2a'] },
  },
  outside: {
    ground: ['#f0f5fb', '#b8c9db'], tuft: ['#ffffff', '#dfe9f4', '#c7d6e6'], dirt: 'rgba(120,150,190,0.25)',
    path: ['#a8b6c4', '#7c8a98', '#3a4652'],
    leaf: ['#4a8a64', '#2e6a4c', '#1e4e38', '#10301f'], trunk: ['#6e4c34', '#3a281c'],
    lantern: { metal: '#2a2e38', light: '#ffe2a8', glow: '#ffc06a' },
    barrel: ['#8a6440', '#4a321e', '#3b3b40'],
    props: [['tree', 7], ['bush', 5], ['rock', 3], ['barrel', 1]],
  },
  scene3d: {
    theme: 'snow',
    camera: { elevation: 64, fov: 30, landscape: { elevation: 62, fov: 21 } },
    sun: { color: '#fff6e8', intensity: 3.8, from: [-4.5, 12, -6] },
    sky: { color: '#cfe2ff', ground: '#6f88aa', intensity: 0.85 },
    fill: { color: '#a8c6ff', intensity: 0.45 },
    lamp: { color: '#ffc77a', intensity: 6, distance: 5 },
    fog: '#a9c2de', exposure: 0.9, base: '#9fb6d0',
    heights: { wall: 0.66, pillar: 0.6, brick: 0.6 },
    stone: { pillar: ['#bfe6ff', '#5aa2d8'], wall: ['#b4c2d0', '#5e6e7e'] },
    brick: { style: 'ice', colors: ['#9fd2f4', '#86c2ec', '#b4dcf8', '#78b4e2'], mortar: '#eef8ff' },
  },
  levels: Object.assign(sameLevels([['rock', 3], ['stump', 2]]), { plazaPool: true }),
};

// ---- volcano: cracked basalt, obsidian, rock bricks seamed with lava, embers rising ----
WORLDS.volcano = {
  id: 'volcano', name: 'VOLCÁN',
  accent: '#ff6a2a',
  debris: ['#5a3a30', '#3e261e', '#ff7a1a', '#ffb03a'],
  light: {
    shadow: { dx: 0.22, dy: 0.26, blur: 0.14, color: 'rgba(10,2,0,0.65)' },
    sun: 'rgba(255,120,60,0.3)', shade: 'rgba(40,10,30,0.35)', rays: 'rgba(255,140,60,0.06)',
    outsideDim: 'rgba(10,2,0,0.4)', vignette: 'rgba(10,0,0,0.6)',
    motes: { count: 34, color: '#ff9a3a', kind: 'rise' },   // embers
  },
  floor: {
    turf: [['#4c4442', '#3e3634'], ['#463e3c', '#3a3230']],
    grout: '#181210',
    blades: ['#5a504c', '#2e2826', '#6e6460', '#221c1a', '#4a423e'],
    clover: ['#2e2826', '#4a423e', '#1a1614'],                         // ash pebbles
    flowers: [['#ff7a1a', '#ffd23f']],
    flowerRate: 0, cloverRate: 0.35,
    paving: ['#5c504c', '#3c3330', '#221c1a'],
  },
  pillar: { top: ['#3c3644', '#1e1a26'], side: ['#2a2432', '#0f0c16'], crack: '#ff6a1a', moss: ['#ff7a1a', '#c23a0a'], mossRate: 0 },
  wall: { top: ['#5c4c46', '#2c221e'], side: ['#40342e', '#1a1210'], seam: '#100a08', moss: ['#3a302c', '#221a16'], vine: ['#ff6a1a', '#ff9a2a', '#ffc04a'] },
  brick: { top: ['#5c3c32', '#442c24'], side: ['#3c261e', '#24160f'], mortar: '#ff7a1a', shade: '#120806' },
  obstacle: {
    rock: { top: ['#4a4448', '#2a262c'], side: ['#2a2428', '#141014'], moss: ['#ff7a1a', '#c23a0a'] },
    stump: { bark: ['#2e221c', '#1a120e', '#0e0806'], wood: ['#ff9a2a', '#ff6a1a', '#c23a0a'], moss: ['#3a2e28', '#221a16'] },
  },
  outside: {
    ground: ['#3c2c26', '#120a08'], tuft: ['#2e2624', '#3e3430', '#1e1816'], dirt: 'rgba(255,90,20,0.12)',
    path: ['#4c403c', '#2e2624', '#120e0c'],
    leaf: ['#4a3a30', '#2e241e', '#1e1814', '#100c0a'], trunk: ['#2a1e18', '#120c0a'],
    lantern: { metal: '#1e1816', light: '#ffb04a', glow: '#ff5a1a' },
    barrel: ['#4a3a32', '#241a16', '#141010'],
    props: [['tree', 5], ['rock', 6], ['bush', 2]],
  },
  scene3d: {
    theme: 'volcano',
    camera: { elevation: 64, fov: 30, landscape: { elevation: 62, fov: 21 } },
    sun: { color: '#ffb48a', intensity: 2.8, from: [-5, 12, -5] },
    sky: { color: '#ff9a6a', ground: '#2a1410', intensity: 0.6 },
    fill: { color: '#ff6a3a', intensity: 0.4 },
    lamp: { color: '#ff6a1a', intensity: 8, distance: 5.5 },
    fog: '#1c0d0a', exposure: 1.32, base: '#1a100c',
    heights: { wall: 0.66, pillar: 0.6, brick: 0.6 },
    stone: { pillar: ['#4a4456', '#141018'], wall: ['#5e4e48', '#22181a'] },
    brick: { style: 'magma', colors: ['#463430', '#3a2a26', '#4e3a34', '#30221e'], mortar: '#2a1810', glow: '#e8500e' },
  },
  levels: Object.assign(sameLevels([['rock', 3], ['stump', 2]]), { plazaPool: true }),
};

// Stage → world: five stages per world, the fifth a boss fight; after the volcano the tour starts again (harder).
const CAMPAIGN = [{ from: 1, world: 'forest' }, { from: 6, world: 'desert' }, { from: 11, world: 'snow' }, { from: 16, world: 'volcano' }];
const CAMPAIGN_LEN = 20;
function worldForStage(stage) {
  const s = ((stage - 1) % CAMPAIGN_LEN) + 1;
  let id = CAMPAIGN[0].world;
  for (const c of CAMPAIGN) if (s >= c.from && WORLDS[c.world]) id = c.world;
  return WORLDS[id];
}
// Worlds a battle round may use (every world in the campaign so far).
function battleWorlds() { return [...new Set(CAMPAIGN.map(c => c.world))].filter(id => WORLDS[id]).map(id => WORLDS[id]); }
