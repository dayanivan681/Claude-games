# Art resource index

Every external art resource used or seriously considered for a project in this repo, per the
`blender-artist` skill (.claude/skills/blender-artist/SKILL.md). Status: candidate, downloaded, tested, discarded.

| Resource / role | URL · author | Licence · attribution | Checked | Project · local path | Changes | Status |
|---|---|---|---|---|---|---|
| Mixamo "X Bot" (Beta_Surface mesh + mixamorig skeleton) — base body for Rayo's suit (pelvis, thighs, shins, torso, upper arms, forearms) | https://www.mixamo.com/ (Adobe); file from three.js examples, pinned: https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Xbot.glb (sha256 002f8d26…3ba5) | Mixamo terms: royalty-free use of characters/animations in personal and commercial projects; raw files may not be redistributed. No attribution required. mixamo.com was unreachable from the cloud session, so these terms are from the published FAQ and were not re-read on the live page — check them locally | 2026-10-24 | Slugger · downloaded to `/tmp/slugger_hero/Xbot.glb` by `slugger/art/hero.py` (not committed) | Smoothed (Laplacian ×6) and decimated to 30 %, rotated to the sprite axes, re-posed per frame onto the game skeleton with per-bone affine maps + linear blend skinning, thickness rescaled to the old capsule radii so the gear still sits on the suit. Head, hands and feet not used (our face, gloves, boots) | tested |
| Mixamo "X Bot" animations (idle, walk, run, sneak_pose…) | same file | same as above | 2026-10-24 | Slugger | Not used: the legs and upper body must follow `js/soldier.js`'s skeleton and timing | discarded |
| Mixamo "Vanguard" (Soldier.glb) — alternative base body | https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb · Mixamo | Mixamo terms (see above) | 2026-10-24 | Slugger · scratchpad only | Not used: helmet, visor and a baked texture fight the palette, and it reads less like Snake than a clean body under our own gear | discarded |

## In-house assets (no external source)
| Asset | Made with | Project · path | Notes |
|---|---|---|---|
| Hero "Rayo" (sneaking-suit look), 74 frames | Blender 5.2 (bpy): Mixamo X Bot body (above) + primitives for head, gear, boots and guns; Cycles | Slugger · `slugger/art/hero.py` → `slugger/js/hero_art.js` | Legs/upper-body layers, duck walk, 3-phase jump, 8-angle roll; palette-indexed |

Kenney, Poly Haven, Quaternius, ambientCG and mixamo.com are blocked by the cloud sessions' network policy (checked 2026-10-24); GitHub raw, PyPI and npm are reachable.
