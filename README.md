# Claude Games

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
| `bomberman/js/chars3d.js` | **Presentación 3D.** Personajes procedurales y animados: un mismo rig de bomber vestido por cada paleta (héroe, Punk, Ninja, Rey) y un modelo por enemigo, con su muerte en llamas. Los dibuja `fx3d.js`. |
| `bomberman/index.html` | Reglas del juego, personajes, HUD, audio y controles. |

**Agregar un mundo nuevo** (desierto, nieve, volcán…): copia la entrada `forest` en `WORLDS`, cambia colores, luz, accesorios y reglas, y añade `{ from: <nivel>, world: '<id>' }` a `CAMPAIGN`. No hace falta tocar el motor.
