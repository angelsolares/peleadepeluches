# Propuestas para Baby Shower Arena 👶🍼

¡Hola! Qué gran idea. Basándome en la estructura actual de "Pelea de Peluches", que ya tiene un motor multijugador sólido con Three.js y Socket.io, adaptar esto para un Baby Shower en 2 semanas es totalmente factible.

Aquí tienes una propuesta técnica y creativa para transformar el proyecto:

---

## 🎨 Concepto General: "Baby Party Arena"
En lugar de peluches peleando, los jugadores controlan **bebés personalizados** (o cigüeñas) en un entorno colorido, con colores pastel, nubes y juguetes.

---

## 🕹️ Adaptación de Juegos Existentes (Reutilización de Código)

Para cumplir con el plazo de 2 semanas, lo ideal es reutilizar la lógica de los juegos que ya tienes:

### 1. Carrera de Gateo (Basado en `RaceGame`)
*   **Mecánica:** Los jugadores deben alternar toques (o teclas) para que el bebé gatee más rápido.
*   **Visuales:** Pista de foamy de colores, obstáculos como cubos de madera y un biberón gigante en la meta.
*   **Cambio:** Solo necesitas cambiar los modelos FBX de los peluches por modelos de bebés gateando.

### 2. La Cigüeña Mensajera (Basado en `FlappyGame`)
*   **Mecánica:** Controlar a una cigüeña que lleva un paquete.
*   **Visuales:** Evitar nubes de tormenta o aviones de juguete.
*   **Objetivo:** Llegar lo más lejos posible entregando "bebés".

### 3. Atrapa los Chupones (Basado en `BalloonGame`)
*   **Mecánica:** En lugar de reventar globos, los bebés deben atrapar chupones, biberones o sonajas que caen del cielo o flotan.
*   **Visuales:** Efectos de partículas tipo "polvo de estrellas" al atrapar un objeto.

### 4. Guerra de Biberones (Basado en `ArenaGame` / `Smash`)
*   **Mecánica:** En lugar de combate físico, los bebés en **andaderas** chocan entre sí para sacarse de una plataforma circular (como un "Bumper Baby").
*   **Visuales:** Las andaderas tienen físicas de rebote divertidas.

### 5. Pinta el Cuarto (Basado en `PaintGame`)
*   **Mecánica:** Los bebés se mueven dejando un rastro de pintura (azul, rosa, amarillo).
*   **Visuales:** El suelo es una alfombra blanca que se va llenando de color.

---

## 💡 Nuevas Ideas (Adaptaciones Específicas)

Si tienes un poco más de tiempo, podrías añadir estas adaptaciones:

1.  **Cambio de Pañal Express (Basado en ritmo/clicks):**
    *   Un mini-juego de clicks rápidos y precisos donde gana quien "limpie y cambie" al bebé virtual más rápido.
2.  **Adivina el Tamaño de la Panza (Slider interactivo):**
    *   Un mini-juego donde los jugadores usan un slider para intentar adivinar la circunferencia de la panza de la festejada.

---

## 🚀 Ideas Originales (Nuevas Mecánicas)

Aquí hay algunas ideas que se salen de los juegos que ya tienes y que aprovecharían muy bien el sistema de Sockets:

### 1. "El Precio es Correcto" (Baby Edition)
*   **Mecánica:** En la pantalla principal se muestra un artículo (ej. un cochecito de marca, un paquete de pañales premium). Los invitados, desde su celular, deben escribir el precio que creen que cuesta.
*   **Ganador:** El que más se acerque sin pasarse. Los resultados aparecen en tiempo real en la pantalla grande.

### 2. Sopa de Nombres / Baby Scramble
*   **Mecánica:** Aparecen letras desordenadas en la pantalla 3D (flotando como globos). Los jugadores deben seleccionar las letras en su celular para formar palabras relacionadas con el bebé o los nombres de los padres.
*   **Tecnología:** Usarías el `ModeSelector` para un nuevo estado global de "Palabra".

### 3. Quiz de "Memoria de los Padres"
*   **Mecánica:** Un juego tipo Kahoot pero integrado en tu plataforma. Se hacen preguntas sobre los futuros padres (ej. "¿Cuál fue el primer antojo de la mamá?"). 
*   **Dinamismo:** Las respuestas correctas hacen que el avatar del jugador en la pantalla principal crezca o se eleve en un globo.

### 4. Mixer Genético Divertido
*   **Mecánica:** No es un juego competitivo per se, sino una actividad. Los invitados eligen rasgos (ojos de papá, nariz de mamá, etc.) en su celular y el servidor genera un "modelo" divertido y exagerado en 3D que se muestra en la pantalla principal.

### 5. Obstáculos de Carriola (Con Física de Conducción)
*   **Mecánica:** En lugar de una carrera de velocidad, es una carrera de **obstáculos y precisión**. Los jugadores deben manejar una carriola a través de una sala llena de juguetes regados.
*   **Control:** Usar el giroscopio del celular (si es posible) o un joystick virtual para dar una sensación de conducción real.

---

## 🛠️ Plan de Acción (2 Semanas)

### Semana 1: Visuales y Assets
*   **Modelos 3D:** Buscar o crear 1 modelo de bebé base y usar texturas para diferenciar jugadores (ropa de distinto color).
*   **UI/UX:** Cambiar el CSS (`style.css`) para usar una paleta de colores pastel (celeste `#A2D2FF`, rosa `#FFC8DD`, amarillo `#FCF6BD`).
*   **Audio:** Cambiar los SFX de golpes por sonidos de risas de bebé, sonajas y música de cuna estilo *Lo-fi* o *8-bit*.

### Semana 2: Ajustes de Lógica y Testing
*   **Adaptación de Estados:** Ajustar `server/*.js` para que los nombres de las variables reflejen el nuevo tema (ej. `plushieState` -> `babyState`).
*   **Pruebas de Conexión:** Asegurar que el sistema de Lobby actual funcione bien para que todos los invitados entren con un QR.

---

## 👋 Conclusión
Tienes el 80% del trabajo hecho con la infraestructura actual. El mayor reto será el **reemplazo de assets (modelos FBX y texturas)** y el **ajuste estético de la UI**. 

¿Te gustaría que te ayude a empezar con el cambio de estilos de alguna de las pantallas o a ver cómo adaptar el modelo de la carrera?

¡Saludos y felicidades a tu amigo por el baby shower! 🍼✨

