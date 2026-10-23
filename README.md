# Claude Games

La página principal (`index.html`) enlaza a los dos juegos. Cada juego es una PWA independiente: se instala en la pantalla de inicio y funciona sin conexión.

## Slugger (`slugger/`)

Run-and-gun en pixel art estilo Metal Slug, para jugar en horizontal.

- **4 soldados** con ventaja propia (pistola doble, munición +50 %, 20 granadas, más velocidad).
- **Armas** H, R, F y S, granadas, cuchillo cuerpo a cuerpo, rehenes que dan premios y el tanque **SLUG**.
- **3 misiones** que se repiten más difíciles (desierto, selva, nieve), cada una con techos, arenas, camión, helicóptero y su propio jefe.
- Todo en un solo archivo (`slugger/index.html`): gráficos en canvas, sonido sintetizado y fuente Press Start 2P incrustada.

Instalar: abre `https://<usuario>.github.io/Claude-games/slugger/` en Safari → Compartir → **Agregar a inicio**.

El juego está en inglés. Controles: joystick a la izquierda (arriba apunta, abajo se agacha) y botones FIRE / JUMP / BOMB. Teclado: flechas, J dispara, K salta, L granada, P pausa, M silencio.

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
