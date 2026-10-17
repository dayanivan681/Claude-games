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
      camera: { elevation: 64, fov: 30 },          // degrees above the horizon, vertical field of view
      sun: { color: '#ffd29c', intensity: 4.2, from: [-5, 12, -5.5] },
      sky: { color: '#ffe6c6', ground: '#3d4a26', intensity: 0.78 },
      fill: { color: '#9fc0ff', intensity: 0.32 },
      lamp: { color: '#ffb25c', intensity: 3.2, distance: 4.5 },
      fog: '#17210f', exposure: 1.28,
      heights: { wall: 0.66, pillar: 0.6, brick: 0.6 },
      brick: { colors: ['#de6c2c', '#c4561f', '#e67a38', '#b54c1b'], mortar: '#b07446' },
    },
    levels: {
      layouts: [['classic', 4], ['grove', 3], ['clearings', 3], ['plaza', 2]],
      firstLayout: 'classic', bossLayout: 'plaza',   // stage 1 teaches on the classic grid; bosses fight on the plaza
      obstacleSkins: [['rock', 2], ['stump', 3]],
      density: { base: 0.36, perStage: 0.006, max: 0.5, boss: 0.22, battle: 0.7 },
      enemies: { base: 3, perStage: 0.55, max: 11, tierEvery: 2, maxTier: 6 },
    },
  },
};

// Stage → world. Future worlds are appended with the stage they start at, e.g. { from: 11, world: 'desert' }.
const CAMPAIGN = [{ from: 1, world: 'forest' }];
function worldForStage(stage) {
  let id = CAMPAIGN[0].world;
  for (const c of CAMPAIGN) if (stage >= c.from && WORLDS[c.world]) id = c.world;
  return WORLDS[id];
}
// Worlds a battle round may use (every world in the campaign so far).
function battleWorlds() { return [...new Set(CAMPAIGN.map(c => c.world))].filter(id => WORLDS[id]).map(id => WORLDS[id]); }
