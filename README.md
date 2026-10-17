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
