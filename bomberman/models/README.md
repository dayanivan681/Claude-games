# Bomber character

- `bomber.glb`: static glTF 2.0 character with embedded materials and bomb color texture. Includes the held bomb, fuse, and spark geometry. Studio floor, lights, and camera are excluded.
- `bomber.blend`: editable source in Blender 5.2.2. Use scene `Bomber • estudio`; the original default scene is also preserved. Contains studio lights and camera.

The character has rounded animation-style proportions, a white helmet, pink antenna and gloves, blue jacket, and pink space boots. No armature or animation clips are included. The GLB uses standard glTF Y-up coordinates; scale it to the game's units when integrating. Emissive sparks need bloom in the game renderer to glow. The bomb's procedural color is baked to an embedded texture; its procedural bump is omitted in the GLB. The Blender source retains the full shader.

## Rig y animaciones (juego)

- `bomber-animado.blend`: copia editable de `bomber.blend` (el original queda intacto). La escena `Bomber • estudio` conserva el diseño y la pose original (bomba en mano); se añadió el esqueleto **Rig Bomber** (raiz, cadera, torso, cabeza, antena, brazo.L/R, pierna.L/R, bomba) con cada pieza emparentada rígidamente a su hueso, y siete acciones a 24 fps: `idle`, `caminar`, `correr`, `poner_bomba`, `victoria`, `dano`, `morir` (pistas NLA silenciadas: elige una en el Action Editor para verla).
- `bomber-animado.glb`: exportación para el juego desde `bomber.glb` con el mismo rig y animaciones, aligerada para móvil (~46 mil triángulos, 1.5 MB).
- Ambos se generan con `../tools/rig_bomber.py` (`MODE=blend` o `MODE=glb`), así que si editas `bomber.blend` / `bomber.glb` basta con volver a ejecutarlo.
