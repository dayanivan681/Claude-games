# Art resource index

Every external art resource used or seriously considered for a project in this repo, per the
`blender-artist` skill (.claude/skills/blender-artist/SKILL.md). Status: candidate, downloaded, tested, discarded.

| Resource / role | URL · author | Licence · attribution | Checked | Project · local path | Changes | Status |
|---|---|---|---|---|---|---|
| Mixamo "X Bot" (Beta_Surface + Beta_Joints meshes, mixamorig skeleton, "run" clip) — Rayo's body, rig and run cycle | https://www.mixamo.com/ (Adobe); file from three.js examples, pinned: https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Xbot.glb (sha256 002f8d26…3ba5) | Mixamo terms: royalty-free use of characters/animations in personal and commercial projects; raw files may not be redistributed. No attribution required. mixamo.com was unreachable from the cloud session, so these terms are from the published FAQ and were not re-read on the live page — check them locally | 2026-10-26 | Slugger · downloaded to `/tmp/slugger_hero/` by `slugger/art/hero.py` (not committed) | Meshes joined; bone tails fixed (the import leaves them ~44 m long); IK on legs and arms driven from the game skeleton; run legs from the mocap clip's joint positions; chest, shoulders, arms and neck thickened, hips narrowed (bone scale); split into legs / upper-body layers at the belt; head, neck faces dropped; suit / pants / glove / boot materials | tested |
| Lee Perry-Smith head scan (LeePerrySmith.glb, Map-COL.jpg, normal map) — Rayo's face | Infinite-Realities (Lee Perry-Smith), via https://casual-effects.com/data/ (McGuire Computer Graphics Archive); files from three.js examples, pinned r170 (sha256 in `hero.py`) | CC BY 3.0 — attribution required: "Head scan: Lee Perry-Smith, Infinite-Realities, CC BY 3.0" (credited in README). Licence as listed by the archive; casual-effects.com was unreachable from the cloud session — re-check locally | 2026-10-26 | Slugger · `/tmp/slugger_hero/` (not committed; only renders ship) | Cut at the neck, scaled and fitted on X Bot's Head bone; colour + tangent normal map on a skin shader; covered by modelled hair and bandana | tested |
| Ready Player Me avatar (readyplayer.me.glb in three.js examples) — alternative realistic body/face | https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/readyplayer.me.glb | Ready Player Me terms (unclear for this use) | 2026-10-26 | scratchpad only | Not used: suit-and-hat outfit, unclear licence | discarded |
| Mixamo "Alpha" (Samba Dancing.fbx in three.js examples) | https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/fbx/Samba%20Dancing.fbx | Mixamo terms | 2026-10-26 | scratchpad only | Not used: another faceless mannequin like X Bot | discarded |
| Mixamo "Vanguard" (Soldier.glb) — alternative base body | https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb · Mixamo | Mixamo terms (see above) | 2026-10-26 | Slugger · scratchpad only | Not used: sci-fi armour with a helmet, not Rayo's sneaking-suit look | discarded |

## In-house assets (no external source)
| Asset | Made with | Project · path | Notes |
|---|---|---|---|
| Hero "Rayo" (sneaking-suit look), 74 frames × 4 costumes | Blender 5.2 (bpy): X Bot body + Lee Perry-Smith head (above), modelled hair, bandana, gear and guns, PBR materials; Cycles 48 samples, denoised, AgX | Slugger · `slugger/art/hero.py` → `slugger/img/rayo_<n>.webp` + `slugger/js/hero_art.js` | Full colour, R = 6 px per world px; legs/upper-body layers, mocap run, duck walk, 3-phase jump, 8-angle roll |

Kenney, Poly Haven, Quaternius, ambientCG and mixamo.com are blocked by the cloud sessions' network policy (checked 2026-10-24); GitHub raw, PyPI and npm are reachable.
