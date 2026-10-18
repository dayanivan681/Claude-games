# Bomber character

- `bomber.glb`: static glTF 2.0 character with embedded materials and bomb color texture. Includes the held bomb, fuse, and spark geometry. Studio floor, lights, and camera are excluded.
- `bomber.blend`: editable source in Blender 5.2.2. Use scene `Bomber • estudio`; the original default scene is also preserved. Contains studio lights and camera.

The character has rounded animation-style proportions, a white helmet, pink antenna and gloves, blue jacket, and pink space boots. No armature or animation clips are included. The GLB uses standard glTF Y-up coordinates; scale it to the game's units when integrating. Emissive sparks need bloom in the game renderer to glow. The bomb's procedural color is baked to an embedded texture; its procedural bump is omitted in the GLB. The Blender source retains the full shader.
