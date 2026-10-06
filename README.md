# 🥊 Pelea de Peluches

Una fiesta de minijuegos 3D hecha con Three.js: la pantalla grande (PC o TV) es el escenario y cada quien usa su celular como control. Hasta 8 jugadores por sala.

## 🎮 Modos de juego

| Modo | Página | De qué va |
|------|--------|-----------|
| **Pelea (Smash)** | `smash.html` | Pelea de plataformas estilo Smash Bros: % de daño, knockback, 3 vidas. Doble salto, ataques direccionales, escudo que se desgasta y hitstop al golpear. |
| **Arena (Lucha libre)** | `arena.html` | Ring de lucha libre estilo WCW vs NWO: amarres, llaves, cuerdas, látigo irlandés, lariats, barra de ánimo, remates por personaje, cuenta de 3 y battle royal. |
| **Carrera** | `race.html` | Sprint de 100 m: alterna los pies en el celular para correr más rápido. |
| **Flappy** | `flappy.html` | Vuela entre obstáculos tocando la pantalla. Último en pie gana. |
| **La Trae** | `tag.html` | El clásico "la traes": quien la trae al final pierde. |
| **Guerra de Cuerda** | `tug.html` | Dos equipos jalan la cuerda **al ritmo del beat**. Jalar en sincronía con el equipo multiplica la fuerza; machacar el botón no sirve. |
| **Pinta el Piso** | `paint.html` | Pinta más territorio que los demás antes de que acabe el tiempo. |
| **Infla el Globo** | `balloon.html` | Mantén presionado para soplar, suelta para respirar. El globo truena entre 85 y 95 (no se ve la barra): lee las señales y **amarra** a tiempo para asegurar tu tamaño. |

Todos los modos tienen revancha, torneo por rondas y reconexión del teléfono (30 s de gracia si se cae el WiFi).

Los modos de baby shower (`maze.html`, `trivia.html`, `word_puzzle.html`, `baby_shower.html`) siguen en el repo pero están ocultos de la landing.

## 🕹️ Controles (celular)

Todos los modos con movimiento usan un **joystick analógico** en la izquierda.

### Pelea (Smash)

| Acción | Control |
|--------|---------|
| Mover / correr | Joystick (a fondo = correr) |
| Saltar | Joystick ↑ (otra vez en el aire = doble salto) |
| Golpe / Patada | A / B |
| Smash lateral | ← o → + A/B |
| Uppercut | ↑ + A/B |
| Barrida (en el piso) | ↓ + A/B |
| Meteoro (en el aire) | ↓ + A/B — manda al rival hacia abajo |
| Bloqueo | X (mantener). El escudo se desgasta al sostenerlo y con cada golpe; si llega a 0 se rompe y te deja mareado 2 s |
| Burla | Y |

### Arena (Lucha libre)

| Acción | Control |
|--------|---------|
| Mover / correr | Joystick (a fondo = correr) |
| Golpe / Patada | A / B — corriendo se vuelven lariat y dropkick |
| Agarrar | G: amarre. En el amarre: A/B = llave, G = cargar, G + stick = látigo irlandés a las cuerdas |
| Cubrir | G sobre un rival en la lona (cuenta de 3, el rival machaca para zafarse) |
| Burla | Y: llena la barra de ánimo. Con la barra llena, Y = **REMATE** (distinto por personaje) |
| Bloqueo | X |

### Teclado en el host (solo pruebas)

Flechas / WASD mover, ↑ o espacio saltar, ↓ o S para barrida/meteoro, J golpe, K patada, L bloqueo, T burla, Shift correr.

## 📁 Estructura del proyecto

```
pelea-de-peluches/
├── index.html              # Landing con todos los modos
├── smash.html, arena.html, race.html, flappy.html, tag.html, tug.html, paint.html, balloon.html
├── css/                    # Estilos del host
├── js/
│   ├── main.js             # Host de Pelea (Smash)
│   ├── arena/, race/, flappy/, tag/, tug/, paint/, balloon/   # Host de cada modo
│   ├── animation/          # AnimationController y retarget Mixamo -> Meshy
│   ├── assets/AssetLoader.js  # Carga en paralelo y caché de modelos/animaciones
│   ├── effects/, audio/    # VFX, SFX y BGM
│   └── config.js           # URL del servidor
├── assets/
│   ├── *.fbx               # Modelos de los personajes (Meshy AI)
│   ├── anims/*.json        # Animaciones convertidas (24-109 KB en vez de 5-8 MB)
│   └── mixamo/*.fbx        # Animaciones de lucha libre (Mixamo)
├── mobile/                 # Control móvil (PWA): index.html, js/controller.js, css/
├── server/                 # Servidor Socket.IO: index.js + un *State.js por modo
├── tools/convert-anims.mjs # Convierte animaciones FBX a clips JSON
└── playground/             # Pruebas de animaciones y retarget
```

## 🚀 Cómo correrlo

### Local (misma WiFi)

1. Servidor WebSocket:
   ```bash
   cd server && npm install && npm start
   ```
2. Archivos estáticos, en otra terminal (desde la raíz):
   ```bash
   npx http-server -p 8080 -c-1 --cors
   ```
3. Abre `http://localhost:8080` en la PC/TV y `http://TU-IP-LOCAL:8080/mobile/` en los celulares (o escanea el QR de la sala).

### Producción

- **Frontend** → Vercel / Netlify / GitHub Pages (sube el repo tal cual).
- **Backend** → Railway (carpeta `server/`, detecta Node automáticamente).
- Pon la URL de Railway en `PRODUCTION_SERVER_URL` dentro de `js/config.js` y `mobile/js/controller.js`.

| Variable (server) | Descripción | Default |
|-------------------|-------------|---------|
| `PORT` | Puerto del servidor | 3001 |

## 🧪 Pruebas

```bash
npm install          # una vez, en la raíz (instala socket.io-client para las pruebas)
npm test             # todo: simulaciones + pruebas contra un servidor real
npm run test:sim     # solo simulaciones (segundos, sin red)
npm run test:server  # solo las de servidor (levanta server/index.js en el puerto 3199)
```

- `tests/sim/` simula los `server/*State.js` con un reloj falso: física de Smash y Arena, lucha libre (amarres, ánimo, cuerdas), ritmo de la Cuerda, pulmones del Globo y regresiones de bugs viejos.
- `tests/server/` conecta bots por Socket.IO a un servidor real: sanitización, revancha, reconexión, Carrera, y partidas completas de Cuerda y Globo. Necesita `cd server && npm install` hecho.
- `node tests/run.mjs sim smash` corre solo los archivos cuyo nombre contenga `smash`. Cada prueba imprime `PASS`/`FAIL` por check y termina con `N/M passed`.

## 🧩 Cómo funciona

- **Servidor autoritativo.** Cada modo tiene su `server/*State.js` con la física y las reglas; el host solo dibuja y los teléfonos solo mandan input. Los ticks usan el delta real (en Windows `setInterval` a 16 ms corre a ~36 Hz).
- **Animaciones ligeras.** Los FBX de animación traen el modelo completo; `tools/convert-anims.mjs` los convierte a clips JSON que `AssetLoader` carga en paralelo. Los personajes se descargan hasta que alguien los elige. Para regenerar los clips:
  ```bash
  cd tools && npm install && node convert-anims.mjs
  ```
- **Lucha libre.** Las animaciones de Mixamo se retargetean al esqueleto de Meshy en tiempo real (`js/animation/MixamoRetarget.js`).
- **Pinta el Piso** manda solo las casillas que cambian más un keyframe por segundo (~46 KB/s por cliente).

## 🛠️ Tecnologías

Three.js r160 (ES modules vía importmap) · Socket.IO 4.7 · Node.js + Express · Modelos FBX de Meshy AI · Animaciones de Mixamo

## 📱 PWA

El control móvil se puede "Añadir a pantalla de inicio" para usarlo como app. Soporta vibración (háptica) en golpes, beats y globos a punto de tronar.

## 📄 Licencia

MIT License - Haz lo que quieras con el código 🎉

---

Hecho con ❤️ y Three.js
