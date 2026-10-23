# Claude Games

La página principal (`index.html`) enlaza a los dos juegos. Cada juego es una PWA independiente: se instala en la pantalla de inicio y funciona sin conexión.

## Slugger (`slugger/`)

Run-and-gun en pixel art estilo Metal Slug, pensado para jugar en horizontal en el teléfono. El juego está en inglés.

- **6 misiones** (desierto, selva, nieve, ciudad de noche, puerto y fortaleza), cada una con techos, arenas, prisioneros, el tanque **SLUG**, 3 placas secretas y su propio jefe con fases y puntos débiles.
- **Supervivencia**: oleadas infinitas con jefes cada 10 oleadas (se desbloquea al terminar la misión 1).
- **Progreso**: monedas, armería (6 mejoras de 5 niveles), 4 soldados con nivel y trajes, 3 estrellas y rango por misión, 34 logros, 3 tareas diarias con racha y récords. Todo se guarda en el teléfono, con código de respaldo en Ajustes.
- **Controles**: joystick a la izquierda (arriba apunta, abajo se agacha), disparo automático por defecto en táctil, botones JUMP / BOMB / FIRE que se pueden mover y agrandar, modo zurdo, mando (PlayStation/Xbox) y teclado (flechas, J dispara, K salta, L granada, P pausa).
- **Vida**: 3 corazones por vida (más con la armería) y 3 vidas por misión, con puntos de control.

Instalar: abre `https://<usuario>.github.io/Claude-games/slugger/` en Safari → Compartir → **Agregar a inicio**.

### Código

Scripts clásicos sin paso de compilación, cargados en orden desde `slugger/index.html`:

| Archivo | Rol |
|---|---|
| `js/core.js` | Constantes, resolución interna y utilidades. |
| `js/font.js` | Fuente de mapa de bits (derivada de Press Start 2P, licencia OFL). |
| `js/save.js` | Guardado, armería, soldados, logros, tareas diarias. |
| `js/audio.js` | Efectos y música sintetizados. |
| `js/render.js` | Escalado entero, capas de fondo, objetos, luz nocturna, clima. |
| `js/sprites.js` | Pixel art en código: paletas, partes de personajes, contorno. |
| `js/world.js` | Jugador, armas, disparo automático, monedas, combos, tanque, flujo de misión. |
| `js/enemies.js` / `js/bosses.js` | Enemigos y los 6 jefes. |
| `js/levels.js` | Biomas, bloques de nivel, las 6 misiones y supervivencia. |
| `js/input.js` | Joystick, botones, gestos, teclado, mando, vibración. |
| `js/ui.js` | HUD y todos los menús. |
| `js/main.js` | Arranque y bucle a 60 Hz fijos. Con `?dev` en la URL expone `window.__dev` para pruebas. |

## Bomblast (`bomberman/`)

Juego estilo Bomberman para iPhone, hecho como PWA (se instala en la pantalla de inicio y funciona sin conexión).

- **Aventura:** niveles infinitos, 8 tipos de enemigos, portal de salida, power-ups, combos y vidas extra.
- **Batalla:** tú contra 3 bots (fácil / normal / difícil), muerte súbita y rondas a elegir.
- Gráficos generados en canvas, música y efectos sintetizados, vibración háptica, joystick táctil.

### Instalar en el iPhone

1. Publica el repo con GitHub Pages (Settings → Pages → Deploy from branch → `main` / root).
2. Abre `https://<usuario>.github.io/Claude-games/bomberman/` en Safari.
3. Compartir → **Agregar a inicio**.

### Probar en local

```sh
npx http-server bomberman -p 8080
```

### Arquitectura de mundos y niveles

La lógica del juego y la presentación están separadas:

| Archivo | Rol |
|---|---|
| `bomberman/js/worlds.js` | **Datos.** Cada mundo define materiales (piso, pilares, muro, ladrillos, obstáculos), iluminación, escenario exterior y reglas de niveles. `CAMPAIGN` asigna niveles a mundos. |
| `bomberman/js/levels.js` | **Lógica.** `LevelGen` genera cada nivel con una semilla (siempre el mismo diseño por nivel): distribución (`classic`, `grove`, `clearings`, `plaza`), obstáculos extra con conectividad garantizada, densidad de bloques con claros y matorrales, y la lista de enemigos. |
| `bomberman/js/board.js` | **Presentación.** `Board` pinta el mundo: todo lo estático se hornea una vez por nivel en el fondo; por frame solo dibuja bloques destructibles y luces ambientales. |
| `bomberman/js/board3d.js` | **Presentación 3D.** Diorama WebGL (Three.js) del mismo mundo y nivel: solo se re-renderiza cuando cambia el tablero; en landscape la cámara sigue al héroe moviendo un lienzo sobredimensionado por CSS (sin re-render). Si no hay WebGL se usa `board.js`. |
| `bomberman/js/fx3d.js` | **Presentación 3D.** Capa ligera y transparente con bombas, explosiones y power-ups en 3D, vistos con la cámara del tablero. Sin ella se dibujan en 2D. |
| `bomberman/js/chars3d.js` | **Presentación 3D.** Personajes animados. El héroe es el Bomber del dueño (`models/bomber.blend`/`bomber.glb`), con esqueleto y animaciones añadidos por `tools/rig_bomber.py` (`models/bomber-animado.glb`) y reproducidos con un AnimationMixer; los rivales usan el mismo modelo recoloreado con sus accesorios. Los enemigos son procedurales y amenazantes, con su muerte en llamas. Los dibuja `fx3d.js`. |
| `bomberman/index.html` | Reglas del juego, personajes, HUD, audio y controles. |

**Mundos:** Bosque (niveles 1–5), Desierto (6–10), Nieve (11–15) y Volcán (16–20); cada quinto nivel es un jefe y después del 20 el recorrido vuelve a empezar, más difícil. En Batalla se puede elegir el mundo (o al azar).

**Agregar un mundo nuevo:** copia una entrada de `WORLDS`, cambia colores, luz y reglas, y añade `{ from: <nivel>, world: '<id>' }` a `CAMPAIGN`. En 3D, `scene3d.theme` elige el kit de `board3d.js` (`forest`, `desert`, `snow`, `volcano`: texturas del piso, pilares y bloques, escenario, obstáculos, lámparas y partículas); un tema nuevo se agrega en `themeKit()`.
