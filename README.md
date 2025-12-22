# 🥊 Pelea de Peluches

Un juego de peleas 3D estilo Smash Bros hecho con Three.js, donde múltiples jugadores pueden unirse usando sus celulares como controles.

![Game Screenshot](https://via.placeholder.com/800x400/1a1a2e/ff3366?text=Pelea+de+Peluches)

## 🎮 Características

- **Gráficos 3D** con Three.js y modelos FBX animados
- **Multijugador local** usando WebSockets
- **Control móvil** - usa tu celular como gamepad
- **Sistema de combate** estilo Smash Bros (% de daño + knockback)
- **Hasta 4 jugadores** simultáneos

## 📁 Estructura del Proyecto

```
pelea-de-peluches/
├── index.html          # Pantalla principal del juego
├── css/
│   └── style.css       # Estilos del juego
├── js/
│   ├── main.js         # Lógica principal del juego
│   └── config.js       # Configuración de URLs
├── assets/             # Modelos y animaciones FBX
├── mobile/             # Control móvil (PWA)
│   ├── index.html
│   ├── css/style.css
│   ├── js/controller.js
│   └── manifest.json
└── server/             # Servidor WebSocket
    ├── index.js
    ├── lobbyManager.js
    ├── gameState.js
    └── package.json
```

## 🚀 Despliegue

### Opción 1: Desarrollo Local (Misma WiFi)

1. **Instala las dependencias del servidor:**
   ```bash
   cd server
   npm install
   ```

2. **Inicia el servidor WebSocket:**
   ```bash
   cd server
   npm start
   ```

3. **En otra terminal, sirve los archivos estáticos:**
   ```bash
   npx http-server -p 8080 -c-1 --cors
   ```

4. **Abre el juego:**
   - PC: `http://localhost:8080`
   - Celular (misma WiFi): `http://TU-IP-LOCAL:8080/mobile/`

### Opción 2: Producción (Internet)

Necesitas desplegar **dos servicios**:

#### A) Frontend → Vercel / GitHub Pages / Netlify

1. Sube el repositorio a GitHub
2. Conecta con Vercel/Netlify
3. Deploy automático

#### B) Backend → Railway

1. Ve a [railway.app](https://railway.app)
2. Crea nuevo proyecto desde GitHub
3. Selecciona la carpeta `server/`
4. Railway detectará Node.js automáticamente
5. Copia la URL generada (ej: `https://tu-proyecto.railway.app`)

#### C) Actualiza las URLs

Edita estos archivos con tu URL de Railway:

**`js/config.js`:**
```javascript
const PRODUCTION_SERVER_URL = 'https://TU-PROYECTO.railway.app';
```

**`mobile/js/controller.js`:**
```javascript
const PRODUCTION_SERVER_URL = 'https://TU-PROYECTO.railway.app';
```

## 🎯 Cómo Jugar

1. **Pantalla principal (PC):**
   - Abre el juego en tu computadora
   - Se mostrará un código de sala de 4 letras

2. **Control móvil (Celular):**
   - Abre `/mobile/` en el navegador de tu celular
   - Ingresa el código de sala
   - Escribe tu nombre y presiona "UNIRSE"

3. **Controles:**
   | Acción | Móvil | Teclado (pruebas) |
   |--------|-------|-------------------|
   | Mover | D-Pad ◀▶ | Flechas / WASD |
   | Saltar | ▲ | Espacio / W |
   | Correr | ▼ RUN | Shift |
   | Golpe | A | J |
   | Patada | B | K |

## 🛠️ Tecnologías

- **Frontend:** Three.js, ES6 Modules, CSS3
- **Backend:** Node.js, Socket.IO, Express
- **Modelos:** FBX (Meshy AI)

## 📱 PWA

El control móvil está configurado como Progressive Web App. Los usuarios pueden "Añadir a pantalla de inicio" para una experiencia de app nativa.

## 🔧 Variables de Entorno (Server)

El servidor acepta estas variables de entorno:

| Variable | Descripción | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | 3001 |

## 📄 Licencia

MIT License - Haz lo que quieras con el código 🎉

---

Hecho con ❤️ y Three.js

