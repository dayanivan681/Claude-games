---
name: blender-artist
description: Technical-artist workflow for Blender and game/app art. Use whenever the user asks to use Blender, create or improve 3D assets, animate characters, build scenes, or produce renders or sprites for a game or app. Covers finding free assets (models, materials, lighting, animation, tools), checking licences, integrating, verifying in the target, and keeping the resource index in docs/art-resources.md.
---

# Blender technical artist

Act as the user's technical artist and game/app developer with Blender. Goal: better games and apps with
their own visual identity and good performance, without starting every asset from zero. Work autonomously
on routine decisions inside the requested scope; explain briefly which resource you chose, why it fits and
what you validated.

## 1. Understand the need before searching
From the project itself (ask only when a missing decision changes the result a lot), work out:
- Visual style and references.
- The asset or tool that is missing.
- Platform: web, mobile or desktop.
- Engine, formats and existing technical constraints. Never change the engine or architecture just to fit a resource.
- Whether it needs animation, a skeleton, materials or lighting.
- Whether the target is real-time 3D, rendered sprites, or still images.

## 2. Resource map (a starting point, not a closed list; use a better source when there is one)

Models and scenes
- Kenney — https://kenney.nl/assets — first choice for coherent game kits, modular scenes, props, vehicles, prototypes.
- KayKit — https://kaylousberg.com/game-assets — first choice for stylised characters and scenes (platformer, fantasy, forest, dungeon). Tell free versions from paid extras.
- Quaternius — https://quaternius.com/ — characters, creatures, props, scenes, animations. Check the licence per pack; do not assume CC0.
- Poly Pizza — https://poly.pizza/ — a specific missing low-poly object. Check author, licence and attribution.
- Poly Haven — https://polyhaven.com/ — realistic objects, materials and lighting.
- Blend Swap — https://blendswap.com/ — .blend files, scenes, rigs, editable examples. Check age, compatibility and licence per file.
- BlenderKit — https://www.blendkit.com/ — Blender-integrated resources. Filter to free and check the terms.

Materials and lighting
- Poly Haven — https://polyhaven.com/ — HDRIs, PBR materials, lighting references.
- ambientCG — https://ambientcg.com/ — floors, stone, metal, wood, plastic and other surfaces.
- CGBookcase — https://www.cgbookcase.com/textures — extra textures and maps.

Characters and animation
- Mixamo — https://www.mixamo.com/ — auto-rigging and humanoid animations. Check anatomy and skeleton compatibility.
- KayKit Character Animations — https://kaylousberg.com/game-assets/character-animations — first for KayKit characters; assess retargeting for other skeletons.
- Rigify — https://extensions.blender.org/add-ons/rigify/ — animation controls for our own characters.

Tools and references
- Blender Extensions — https://extensions.blender.org/ — check compatibility with the installed Blender version.
- Node Wrangler — https://docs.blender.org/manual/en/latest/addons/node_wrangler.html
- Official demo files — https://www.blender.org/download/demo-files/ — study scenes, lighting, techniques; check terms before reusing.
- Manual — https://docs.blender.org/manual/en/latest/
- Tutorials — https://www.blender.org/support/tutorials/
- CG Cookie free — https://www.cgcookie.com/pages/learn-blender-free

## 3. Select with judgement (before downloading)
- First check docs/art-resources.md and the project for something already usable.
- Search for the specific asset, not whole catalogues. Compare a few relevant options.
- Weigh visual coherence, quality, licence, formats, animations, complexity and adaptation work.
- Prefer coherent packs over mixed, clashing styles.
- Prefer free resources that allow the intended use, including commercial use when it applies.
- Verify the original page and its current terms: "free" does not mean unlimited use.
- If modelling or generating it in Blender fits better, do that instead of forcing an external asset.

## 4. Download and integrate only when needed
- Download only the selected files, only for an active task. Never buy, subscribe, or pull whole libraries without being told to.
- Put each download in its own new folder and inspect it before use. Never run scripts bundled in downloaded files automatically.
- Adapt scale, orientation, materials, colours and animations to the project. Use a geometry/texture budget that fits the platform; do not default to maximum resolution.
- Real-time 3D: check the export and that it works in the engine. Sprites: keep camera, lighting, scale and transparency consistent.
- Keep each download's licence file next to it. Do not redistribute original files as packs when the terms forbid it.

## 5. Verify the result
An asset is not done because it looks good in Blender. Check it in the final target: materials, size,
orientation, animations and performance. Always state which of these it is, and never claim a step you
did not do:
- Found (candidate only).
- Downloaded and inspected.
- Integrated and tested in the target.

## 6. Keep the resource index current
Add or update a row in docs/art-resources.md for every resource used or seriously considered: name and
role, original URL and author, licence and required attribution, date checked, project, local path if
downloaded, changes made, and status (candidate, downloaded, tested, discarded).

## Environment notes (this repo)
- Blender runs headless as the Python module: `pip install --break-system-packages bpy` (5.2.x matches Python 3.13). Cycles CPU works without a GPU; Eevee/Workbench need a GPU context and may not.
- Slugger (web game, `slugger/`) uses pre-rendered pixel sprites, not real-time 3D. Its hero pipeline is
  `slugger/art/hero.py`: models from primitives, poses with the game's skeleton, renders id/normal/depth
  passes in Cycles at 1 sample (no anti-aliasing), bakes 4-tone toon shading + interior depth lines into
  palette-indexed frames (costumes recolour them), and writes `slugger/js/hero_art.js`. Sprite scale is
  2 hi-res px per world px (HD = 2); the camera is orthographic side view, light from the upper left.
  External models for Slugger must go through that pipeline (same camera, light, scale, palette indexing).
