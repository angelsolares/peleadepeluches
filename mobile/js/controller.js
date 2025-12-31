/**
 * Pelea de Peluches - Mobile Controller
 * Handles touch input and WebSocket communication
 */

// =================================
// Configuration
// =================================

// ⚠️ IMPORTANTE: Cambia esta URL después de desplegar en Railway
const PRODUCTION_SERVER_URL = 'https://peleadepeluches-production.up.railway.app';

// Detección automática del entorno
const isLocalhost = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname.startsWith('192.168.');

// URL del servidor WebSocket
const SERVER_URL = isLocalhost 
    ? `http://${window.location.hostname}:3001`
    : PRODUCTION_SERVER_URL;

console.log(`[Config] Environment: ${isLocalhost ? 'Development' : 'Production'}`);
console.log(`[Config] Server URL: ${SERVER_URL}`);

// =================================
// DOM Elements
// =================================

const screens = {
    join: document.getElementById('join-screen'),
    lobby: document.getElementById('lobby-screen'),
    controller: document.getElementById('controller-screen')
};

const elements = {
    // Join screen
    roomCodeInput: document.getElementById('room-code'),
    joinBtn: document.getElementById('join-btn'),
    joinError: document.getElementById('join-error'),
    connectionStatus: document.getElementById('connection-status'),
    
    // Lobby screen
    lobbyRoomCode: document.getElementById('lobby-room-code'),
    leaveBtn: document.getElementById('leave-btn'),
    playerAvatar: document.getElementById('player-avatar'),
    playerDisplayName: document.getElementById('player-display-name'),
    playerStatus: document.getElementById('player-status'),
    playersList: document.getElementById('players-list'),
    readyBtn: document.getElementById('ready-btn'),
    
    // Controller screen
    controllerBadge: document.getElementById('controller-player-badge'),
    playerDamage: document.getElementById('player-damage'),
    stocksDisplay: document.getElementById('stocks-display'),
    menuBtn: document.getElementById('menu-btn'),
    
    // Overlays
    gameOverOverlay: document.getElementById('game-over-overlay'),
    gameOverTitle: document.getElementById('game-over-title'),
    gameOverMessage: document.getElementById('game-over-message'),
    rematchBtn: document.getElementById('rematch-btn'),
    exitBtn: document.getElementById('exit-btn')
};

// =================================
// State
// =================================

let socket = null;
let playerData = null;
let roomCode = null;
let isReady = false;
let isConnected = false;
let selectedCharacter = null; // No character selected by default
let gameMode = 'smash'; // 'smash', 'arena', or 'race'
let isGrabbing = false; // Track if player is currently grabbing someone (Arena mode)
let isGrabbed = false; // Track if player is currently grabbed by someone (Arena mode)
let escapeProgress = 0; // Progress towards escaping from grab (0-100)
let escapeThreshold = 3; // Number of button presses needed to escape (3 = ~33% per press)

// Race mode state
let lastRaceTap = null; // 'left' or 'right' - track last tap for alternating
let raceSpeed = 0; // Current speed display

// Flappy mode state
let flappyAlive = true;

// Tug of War state
let tugStamina = 100;
let tugNextPulse = 0;
let tugPulseInterval = 1500; // ms
let tugRhythmStart = 0;

// Balloon state
let balloonProgress = 0;

// Available characters
const CHARACTERS = {
    edgar: { name: 'Edgar', emoji: '👦' },
    isabella: { name: 'Isabella', emoji: '👧' },
    jesus: { name: 'Jesus', emoji: '🧔' },
    lia: { name: 'Lia', emoji: '👩' },
    hector: { name: 'Hector', emoji: '🧑' },
    katy: { name: 'Katy', emoji: '👱‍♀️' },
    mariana: { name: 'Mariana', emoji: '👩‍🦱' },
    sol: { name: 'Sol', emoji: '🌞' },
    yadira: { name: 'Yadira', emoji: '💃' },
    angel: { name: 'Angel', emoji: '😇' },
    lidia: { name: 'Lidia', emoji: '👩‍🦰' },
    fabian: { name: 'Fabian', emoji: '🧑‍🦲' },
    marile: { name: 'Marile', emoji: '👩‍🦳' },
    gabriel: { name: 'Gabriel', emoji: '👼' }
};

// Track which characters are taken by other players
let takenCharacters = {};

// Input state (supports both Smash and Arena modes)
const inputState = {
    left: false,
    right: false,
    up: false,     // Used for jump in Smash, movement in Arena
    down: false,   // Used for run in Smash, movement in Arena
    jump: false,
    run: false,
    block: false
};

// =================================
// Socket.IO Connection
// =================================

// Prevent context menu globally for better mobile experience
document.addEventListener('contextmenu', (e) => e.preventDefault());

function connectToServer() {
    updateConnectionStatus('connecting', 'Conectando...');
    
    socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });
    
    // Connection events
    socket.on('connect', () => {
        console.log('[Socket] Connected to server');
        isConnected = true;
        updateConnectionStatus('connected', 'Conectado');
    });
    
    socket.on('disconnect', () => {
        console.log('[Socket] Disconnected from server');
        isConnected = false;
        updateConnectionStatus('error', 'Desconectado');
    });
    
    socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        updateConnectionStatus('error', 'Error de conexión');
    });
    
    // Game events
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);
    socket.on('player-ready-changed', handleReadyChanged);
    socket.on('game-started', handleGameStarted);
    socket.on('game-state', handleGameState);
    socket.on('player-ko', handlePlayerKO);
    socket.on('game-over', handleGameOver);
    socket.on('game-reset', handleGameReset);
    socket.on('room-closed', handleRoomClosed);
    
    // Character selection events
    socket.on('character-selected', handleCharacterSelected);
    socket.on('character-deselected', handleCharacterDeselected);
    socket.on('character-selection-update', handleCharacterSelectionUpdate);
    
    // Arena mode events
    socket.on('arena-state', handleArenaState);
    socket.on('arena-game-over', handleGameOver);
    socket.on('arena-grab', handleArenaGrabEvent);
    socket.on('arena-throw', handleArenaThrowEvent);
    socket.on('arena-grab-released', handleArenaGrabReleased);
    socket.on('arena-grab-escape', handleArenaGrabEscapeEvent);
    
    // Race mode events
    socket.on('race-state', handleRaceState);
    socket.on('race-countdown', handleRaceCountdown);
    socket.on('race-start', handleRaceStart);
    socket.on('race-finish', handleRaceFinish);
    socket.on('race-winner', handleRaceWinner);
    
    // Flappy mode events
    socket.on('flappy-countdown', handleFlappyCountdown);
    socket.on('flappy-start', handleFlappyStart);
    socket.on('flappy-state', handleFlappyState);
    socket.on('flappy-player-died', handleFlappyDeath);
    socket.on('flappy-game-over', handleFlappyGameOver);
    
    // Tag mode events
    socket.on('tag-state', handleTagState);
    socket.on('tag-transfer', handleTagTransfer);
    socket.on('tag-game-over', handleTagGameOver);
    
    // Tug mode events
    socket.on('tug-state', handleTugState);
    socket.on('tug-game-over', handleGameOver);
    
    // Balloon mode events
    socket.on('balloon-state', handleBalloonState);
    socket.on('balloon-game-over', handleGameOver);
    
    // Paint mode events
    socket.on('paint-state', handlePaintState);
    socket.on('paint-game-over', handleGameOver);
    
    // Tournament events
    socket.on('tournament-config', handleTournamentConfig);
    socket.on('round-ended', handleRoundEnded);
    socket.on('tournament-ended', handleTournamentEnded);
    socket.on('round-starting', handleRoundStarting);
}

// Race mode event handlers
function handleRaceState(data) {
    if (!data || !data.players) return;
    
    // Find our player's speed
    const myState = data.players.find(p => p.id === socket.id);
    if (myState) {
        updateRaceSpeed(myState.speed);
    }
}

function handleRaceCountdown(data) {
    console.log('[Race] Countdown:', data.count);
    showRaceCountdown(data.count);
}

function showRaceCountdown(count) {
    let overlay = document.getElementById('race-countdown-overlay');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'race-countdown-overlay';
        overlay.innerHTML = `<div class="countdown-number"></div>`;
        
        const style = document.createElement('style');
        style.textContent = `
            #race-countdown-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                display: flex; align-items: center; justify-content: center;
                z-index: 9999;
            }
            #race-countdown-overlay .countdown-number {
                font-family: 'Orbitron', sans-serif;
                font-size: 10rem; font-weight: 900;
                color: #00ff88;
                text-shadow: 0 0 50px rgba(0, 255, 136, 0.8);
                animation: countPulse 0.5s ease-out;
            }
            #race-countdown-overlay .countdown-number.go {
                color: #ff6600;
                text-shadow: 0 0 50px rgba(255, 102, 0, 0.8);
            }
            @keyframes countPulse {
                0% { transform: scale(2); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }
            #race-countdown-overlay.hidden { display: none; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
    }
    
    const numberEl = overlay.querySelector('.countdown-number');
    overlay.classList.remove('hidden');
    
    if (count > 0) {
        numberEl.textContent = count;
        numberEl.classList.remove('go');
    } else {
        numberEl.textContent = '¡GO!';
        numberEl.classList.add('go');
        triggerHaptic(true);
        
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 800);
    }
    
    // Re-trigger animation
    numberEl.style.animation = 'none';
    numberEl.offsetHeight;
    numberEl.style.animation = 'countPulse 0.5s ease-out';
}

function handleRaceStart() {
    console.log('[Race] Race started!');
    triggerHaptic(true);
}

function handleRaceFinish(data) {
    console.log('[Race] Player finished:', data);
    if (data.playerId === socket.id) {
        triggerHaptic(true);
        // Show finish notification
        const position = data.position || 1;
        const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `#${position}`;
        const time = data.time ? `${(data.time / 1000).toFixed(2)}s` : '';
        
        // Create temporary finish notification
        const notification = document.createElement('div');
        notification.className = 'race-finish-notification';
        notification.innerHTML = `
            <div class="finish-medal">${medal}</div>
            <div class="finish-text">¡LLEGASTE ${position === 1 ? 'PRIMERO' : position === 2 ? 'SEGUNDO' : position === 3 ? 'TERCERO' : `#${position}`}!</div>
            <div class="finish-time">${time}</div>
        `;
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => notification.remove(), 3000);
    }
}

function handleRaceWinner(data) {
    console.log('[Race] Winner:', data);
    
    const isWinner = data.winnerId === socket.id;
    
    // Show game over overlay
    elements.gameOverOverlay.classList.remove('hidden');
    elements.gameOverTitle.textContent = isWinner ? '🏆 ¡GANASTE!' : '🏁 FIN DE CARRERA';
    elements.gameOverTitle.style.color = isWinner ? 'var(--secondary)' : 'var(--accent)';
    
    // Show winner info and positions
    let message = `🥇 ${data.winnerName} gana la carrera!`;
    if (data.positions && data.positions.length > 0) {
        message += '\n\n📊 POSICIONES:\n';
        data.positions.forEach((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}°`;
            const time = p.time ? `${(p.time / 1000).toFixed(2)}s` : 'DNF';
            message += `${medal} ${p.name} - ${time}\n`;
        });
    }
    elements.gameOverMessage.textContent = message;
    elements.gameOverMessage.style.whiteSpace = 'pre-line';
    
    triggerHaptic(true);
}

// =================================
// Flappy Mode Event Handlers
// =================================

function handleFlappyCountdown(data) {
    console.log('[Flappy] Countdown:', data.count);
    showFlappyCountdown(data.count);
}

function showFlappyCountdown(count) {
    let overlay = document.getElementById('flappy-countdown-overlay');
    
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'flappy-countdown-overlay';
        overlay.innerHTML = `<div class="countdown-number"></div>`;
        
        const style = document.createElement('style');
        style.textContent = `
            #flappy-countdown-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: linear-gradient(135deg, rgba(135, 206, 235, 0.9), rgba(255, 204, 0, 0.8));
                display: flex; align-items: center; justify-content: center;
                z-index: 9999;
            }
            #flappy-countdown-overlay .countdown-number {
                font-family: 'Orbitron', sans-serif;
                font-size: 12rem; font-weight: 900;
                color: #ff6600;
                text-shadow: 0 0 50px rgba(255, 102, 0, 0.8), 4px 4px 0 #ffcc00;
                animation: flappyCountPulse 0.5s ease-out;
            }
            @keyframes flappyCountPulse {
                0% { transform: scale(2) rotate(-10deg); opacity: 0; }
                100% { transform: scale(1) rotate(0); opacity: 1; }
            }
            #flappy-countdown-overlay.hidden { display: none; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
    }
    
    const numberEl = overlay.querySelector('.countdown-number');
    overlay.classList.remove('hidden');
    
    if (count > 0) {
        numberEl.textContent = count;
    } else {
        numberEl.textContent = '¡VUELA!';
        triggerHaptic(true);
        
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 800);
    }
    
    // Re-trigger animation
    numberEl.style.animation = 'none';
    numberEl.offsetHeight;
    numberEl.style.animation = 'flappyCountPulse 0.5s ease-out';
}

function handleFlappyStart() {
    console.log('[Flappy] Game started!');
    flappyAlive = true;
    triggerHaptic(true);
}

function handleFlappyState(data) {
    if (!data || !data.players) return;
    
    // Find our player state
    const myState = data.players[socket.id];
    if (myState) {
        flappyAlive = myState.isAlive;
        
        // Update distance display
        const distEl = document.getElementById('flappy-distance');
        if (distEl) {
            distEl.textContent = `${Math.floor(myState.distance || 0)}m`;
        }
    }
}

function handleFlappyDeath(data) {
    console.log('[Flappy] Player died:', data);
    
    if (data.playerId === socket.id) {
        flappyAlive = false;
        triggerHaptic(true);
        
        // Show death notification
        const notification = document.createElement('div');
        notification.className = 'flappy-death-notification';
        notification.innerHTML = `
            <div class="death-icon">💀</div>
            <div class="death-text">¡CAÍSTE!</div>
            <div class="death-distance">${Math.floor(data.distance || 0)}m</div>
        `;
        notification.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(255, 0, 0, 0.9); border-radius: 20px; padding: 30px;
            text-align: center; z-index: 9999; animation: deathPopIn 0.5s ease-out;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes deathPopIn {
                0% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
            .death-icon { font-size: 4rem; margin-bottom: 10px; }
            .death-text { font-family: 'Orbitron', sans-serif; font-size: 2rem; color: white; }
            .death-distance { font-family: 'Orbitron', sans-serif; font-size: 1.5rem; color: #ffcc00; margin-top: 10px; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(notification);
        
        setTimeout(() => notification.remove(), 2000);
    }
}

function handleFlappyGameOver(data) {
    console.log('[Flappy] Game over:', data);
    
    const isWinner = data.winner && data.winner.id === socket.id;
    
    // Show game over overlay
    elements.gameOverOverlay.classList.remove('hidden');
    elements.gameOverTitle.textContent = isWinner ? '🏆 ¡GANASTE!' : '🐦 FIN DEL VUELO';
    elements.gameOverTitle.style.color = isWinner ? 'var(--secondary)' : 'var(--accent)';
    
    // Show results
    let message = data.winner ? `🥇 ${data.winner.name} voló más lejos!` : '¡Todos cayeron!';
    
    if (data.results && data.results.length > 0) {
        message += '\n\n📊 RESULTADOS:\n';
        data.results.forEach((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}°`;
            message += `${medal} ${p.name} - ${Math.floor(p.distance)}m\n`;
        });
    }
    
    elements.gameOverMessage.textContent = message;
    elements.gameOverMessage.style.whiteSpace = 'pre-line';
    
    triggerHaptic(true);
}

// =================================
// Tag Mode Event Handlers
// =================================

function handleTagState(data) {
    if (!data || !data.players) return;
    
    const myState = data.players.find(p => p.id === socket.id);
    if (myState) {
        // Update damage display as penalty time
        const penaltySec = (myState.penaltyTime / 1000).toFixed(1);
        elements.playerDamage.textContent = `${penaltySec}s`;
        elements.playerDamage.style.color = myState.isIt ? '#ff3366' : '#fff';
        
        // Show indicator if we "la traemos"
        if (myState.isIt) {
            elements.playerDamage.parentElement.querySelector('.health-label').textContent = 'LA TRAES';
        } else {
            elements.playerDamage.parentElement.querySelector('.health-label').textContent = 'TIEMPO';
        }
    }
}

function handleTagTransfer(data) {
    if (data.newItId === socket.id) {
        // We are "It"!
        triggerHaptic(true);
        showTagNotification('¡LA TRAES!', '#ff3366');
    } else if (data.oldItId === socket.id) {
        // We passed it!
        triggerHaptic(false);
        showTagNotification('¡PÁSALA!', '#00ff88');
    }
}

function showTagNotification(text, color) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: ${color}; border-radius: 20px; padding: 20px 40px;
        font-family: 'Orbitron', sans-serif; font-size: 2rem; color: white;
        z-index: 9999; animation: tagPop 0.5s ease-out; pointer-events: none;
    `;
    notification.textContent = text;
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes tagPop {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
            50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transition = 'opacity 0.5s';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 500);
    }, 1000);
}

function handleTagGameOver(data) {
    console.log('[Tag] Game over:', data);
    
    const isWinner = data.winner && data.winner.id === socket.id;
    
    elements.gameOverOverlay.classList.remove('hidden');
    elements.gameOverTitle.textContent = isWinner ? '🏆 ¡GANASTE!' : '🏃 FIN DEL JUEGO';
    elements.gameOverTitle.style.color = isWinner ? 'var(--secondary)' : 'var(--accent)';
    
    let message = data.winner ? `🥇 ${data.winner.name} fue el que menos la trajo!` : '¡Juego terminado!';
    
    if (data.ranking && data.ranking.length > 0) {
        message += '\n\n📊 POSICIONES:\n';
        data.ranking.forEach((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}°`;
            const penalty = (p.penaltyTime / 1000).toFixed(1);
            message += `${medal} ${p.name} - ${penalty}s\n`;
        });
    }
    
    elements.gameOverMessage.textContent = message;
    elements.gameOverMessage.style.whiteSpace = 'pre-line';
    
    triggerHaptic(true);
}

// =================================
// Tug of War Mode Event Handlers
// =================================

function handleTugState(data) {
    if (!data || !data.players) return;
    
    const myState = data.players.find(p => p.id === socket.id);
    if (myState) {
        // Update stamina
        tugStamina = myState.stamina;
        const fill = document.getElementById('tug-stamina-fill');
        if (fill) {
            fill.style.width = `${tugStamina}%`;
            // Change color if low
            fill.style.background = tugStamina < 30 ? 'var(--primary)' : 'linear-gradient(90deg, #9966ff, #ff3366)';
        }
        
        // Visual feedback for pull quality
        if (myState.pullQuality !== undefined && myState.pullQuality > 0) {
            const btn = document.getElementById('tug-pull-btn');
            if (btn) {
                const qualityClass = myState.pullQuality === 2 ? 'perfect' : 'good';
                btn.classList.add(qualityClass);
                setTimeout(() => btn.classList.remove(qualityClass), 300);
            }
        }
    }
    
    // Sync rhythm pulse
    if (data.nextPulseTime) {
        tugNextPulse = data.nextPulseTime;
    }
}

function handleBalloonState(data) {
    if (!data || !data.players) return;
    
    const myState = data.players.find(p => p.id === socket.id);
    if (myState) {
        // Use normalized progress (0-100) from server
        balloonProgress = myState.progress !== undefined ? myState.progress : myState.balloonSize;
        const fill = document.getElementById('balloon-progress-fill');
        const btn = document.getElementById('balloon-inflate-btn');
        const label = document.querySelector('.balloon-label');
        const progressContainer = document.querySelector('.balloon-progress-container');

        // Hide progress bar as requested by user to increase tension
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }

        if (fill) {
            fill.style.width = `${balloonProgress}%`;
            
            if (myState.isDQ) {
                // When DQ, we can show the bar or some visual feedback that they popped
                if (progressContainer) progressContainer.style.display = 'block';
                fill.style.width = '100%';
                fill.style.background = '#ff3366';
                fill.style.boxShadow = '0 0 20px #ff0000';
                if (btn) {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    btn.querySelector('.balloon-text').textContent = '¡BOOM!';
                }
                if (label) {
                    label.textContent = '💀 ¡ELIMINADO!';
                    label.style.color = '#ff3366';
                }
            }
        }
    }
}

function handlePaintState(data) {
    if (!data || !data.players) return;
    
    const myState = data.players.find(p => p.id === socket.id);
    if (myState) {
        // Update score display
        if (elements.playerDamage) {
            elements.playerDamage.textContent = `${myState.score.toFixed(1)}%`;
            elements.playerDamage.style.color = 'var(--secondary)';
        }
    }
}

function updateConnectionStatus(status, text) {
    const statusEl = elements.connectionStatus;
    statusEl.className = 'connection-status ' + status;
    statusEl.querySelector('.status-text').textContent = text;
}

// =================================
// Screen Management
// =================================

function showScreen(screenName) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    
    if (screens[screenName]) {
        screens[screenName].classList.add('active');
    }
}

// =================================
// Join Room
// =================================

function joinRoom() {
    const code = elements.roomCodeInput.value.trim().toUpperCase();
    const name = 'Jugador'; // Generic name until character is selected
    
    if (code.length !== 4) {
        showError('Ingresa un código de 4 letras');
        return;
    }
    
    if (!isConnected) {
        showError('No hay conexión al servidor');
        return;
    }
    
    elements.joinBtn.disabled = true;
    showError('');
    
    socket.emit('join-room', { roomCode: code, playerName: name }, (response) => {
        elements.joinBtn.disabled = false;
        
        if (response.success) {
            playerData = response.player;
            roomCode = code;
            
            updateLobbyUI(response.room);
            showScreen('lobby');
        } else {
            showError(response.error || 'Error al unirse');
        }
    });
}

function showError(message) {
    elements.joinError.textContent = message;
}

// =================================
// Lobby Management
// =================================

function updateLobbyUI(room) {
    if (!room) return;
    
    elements.lobbyRoomCode.textContent = room.code;
    
    if (playerData) {
        elements.playerAvatar.textContent = `P${playerData.number}`;
        elements.playerAvatar.style.background = `linear-gradient(135deg, ${playerData.color}, var(--accent))`;
        elements.playerDisplayName.textContent = playerData.name;
        
        // Update status based on character selection
        if (selectedCharacter) {
            elements.playerStatus.textContent = isReady ? '¡Listo!' : `${CHARACTERS[selectedCharacter].emoji} ${CHARACTERS[selectedCharacter].name}`;
        } else {
            elements.playerStatus.textContent = 'Selecciona tu personaje';
        }
    }
    
    // Disable ready button if no character selected
    elements.readyBtn.disabled = !selectedCharacter;
    
    // Build taken characters map from room players
    takenCharacters = {};
    room.players.forEach(p => {
        if (p.character && p.id !== socket.id) {
            takenCharacters[p.character] = p.name;
        }
    });
    
    // Update character selection UI
    updateCharacterSelectionUI();
    
    // Update players list with character info
    elements.playersList.innerHTML = room.players.map(p => {
        const charEmoji = p.character ? CHARACTERS[p.character]?.emoji : '❓';
        return `
            <li class="${p.ready ? 'ready' : ''}" style="border-left-color: ${p.color}">
                <span class="player-number" style="color: ${p.color}">P${p.number}</span>
                <span class="player-name">${charEmoji} ${p.name}</span>
                <span class="ready-status">${p.ready ? '✓ Listo' : ''}</span>
            </li>
        `;
    }).join('');
}

function toggleReady() {
    // Can't be ready without selecting a character
    if (!selectedCharacter) {
        alert('¡Primero selecciona un personaje!');
        return;
    }
    
    isReady = !isReady;
    
    elements.readyBtn.classList.toggle('active', isReady);
    elements.readyBtn.querySelector('.btn-text').textContent = isReady ? '¡ESPERANDO!' : '¡LISTO!';
    
    if (selectedCharacter) {
        elements.playerStatus.textContent = isReady ? '¡Listo!' : `${CHARACTERS[selectedCharacter].emoji} ${CHARACTERS[selectedCharacter].name}`;
    }
    
    socket.emit('player-ready', isReady);
    
    triggerHaptic();
}

// =================================
// Character Selection
// =================================

function selectCharacter(characterId) {
    // Check if character is taken
    if (takenCharacters[characterId]) {
        return;
    }
    
    // If already selected this character, do nothing
    if (selectedCharacter === characterId) {
        return;
    }
    
    // Emit selection to server with character name
    const characterName = CHARACTERS[characterId]?.name || characterId;
    socket.emit('select-character', { characterId, characterName }, (response) => {
        if (response.success) {
            selectedCharacter = characterId;
            updateCharacterSelectionUI();
            
            // Enable ready button
            elements.readyBtn.disabled = false;
            
            // Update player status
            elements.playerStatus.textContent = `${CHARACTERS[characterId].emoji} ${CHARACTERS[characterId].name}`;
            
            triggerHaptic();
        } else {
            alert(response.error || 'No se pudo seleccionar el personaje');
        }
    });
}

function updateCharacterSelectionUI() {
    const charOptions = document.querySelectorAll('.char-option');
    
    charOptions.forEach(btn => {
        const charId = btn.dataset.character;
        const statusEl = btn.querySelector('.char-status');
        
        // Reset classes
        btn.classList.remove('selected', 'taken');
        
        // Check if this is my selection
        if (selectedCharacter === charId) {
            btn.classList.add('selected');
            statusEl.textContent = '✓ Tu selección';
        }
        // Check if taken by someone else
        else if (takenCharacters[charId]) {
            btn.classList.add('taken');
            statusEl.textContent = `${takenCharacters[charId]}`;
        } else {
            statusEl.textContent = '';
        }
    });
}

function handleCharacterSelected(data) {
    console.log('[Character] Selected:', data);
    if (data.playerId !== socket.id) {
        takenCharacters[data.character] = data.playerName;
        updateCharacterSelectionUI();
    }
}

function handleCharacterDeselected(data) {
    console.log('[Character] Deselected:', data);
    delete takenCharacters[data.character];
    updateCharacterSelectionUI();
}

function handleCharacterSelectionUpdate(data) {
    console.log('[Character] Update:', data);
    takenCharacters = {};
    
    data.selections.forEach(sel => {
        if (sel.playerId !== socket.id) {
            takenCharacters[sel.character] = sel.playerName;
        }
    });
    
    updateCharacterSelectionUI();
}

function leaveRoom() {
    socket.emit('leave-room', () => {
        resetState();
        showScreen('join');
    });
}

// =================================
// Event Handlers
// =================================

function handlePlayerJoined(data) {
    console.log('[Game] Player joined:', data.player.name);
    updateLobbyUI(data.room);
}

function handlePlayerLeft(data) {
    console.log('[Game] Player left:', data.playerId);
    updateLobbyUI(data.room);
}

function handleReadyChanged(data) {
    updateLobbyUI(data.room);
}

function handleGameStarted(data) {
    console.log('[Game] Game started!', data);
    
    // Store game mode
    gameMode = data.gameMode || 'smash';
    console.log('[Game] Mode:', gameMode);
    
    // Find my player data in the list to get team/character info
    if (data.players && socket) {
        const myPlayerData = data.players.find(p => p.id === socket.id);
        if (myPlayerData) {
            playerData = { ...playerData, ...myPlayerData };
            console.log('[Controller] My team:', playerData.team);
        }
    }
    
    showScreen('controller');
    
    // Update controller UI with player info
    if (playerData) {
        elements.controllerBadge.querySelector('.badge-name').textContent = `P${playerData.number}`;
        elements.controllerBadge.style.background = `linear-gradient(135deg, ${playerData.color}, var(--accent))`;
    }
    
    // Update UI based on game mode
    updateControllerUIForMode();
    
    if (gameMode === 'smash') {
        updateStocks(3);
    }
    
    triggerHaptic();
}

function updateControllerUIForMode() {
    const dpadUp = document.querySelector('.dpad-up');
    const dpadDown = document.querySelector('.dpad-down');
    const healthLabel = document.querySelector('.health-label');
    const stocksDisplay = elements.stocksDisplay;
    const grabBtn = document.querySelector('.btn-grab');
    const runLabel = dpadDown?.querySelector('.label');
    const controllerBody = document.querySelector('.controller-body');
    const raceControls = document.getElementById('race-controls');
    const flappyControls = document.getElementById('flappy-controls');
    const tugControls = document.getElementById('tug-controls');
    const balloonControls = document.getElementById('balloon-controls');
    const controllerScreen = document.getElementById('controller-screen');
    
    // Hide all special controls first
    if (raceControls) raceControls.style.display = 'none';
    if (flappyControls) flappyControls.style.display = 'none';
    if (tugControls) tugControls.style.display = 'none';
    if (balloonControls) balloonControls.style.display = 'none';
    
    if (gameMode === 'balloon') {
        // Balloon mode
        if (controllerBody) controllerBody.style.display = 'none';
        if (balloonControls) balloonControls.style.display = 'flex';
        if (controllerScreen) {
            controllerScreen.classList.add('balloon-mode');
            controllerScreen.classList.remove('race-mode', 'flappy-mode', 'tug-mode', 'paint-mode');
        }
        if (stocksDisplay) stocksDisplay.style.display = 'none';
        if (healthLabel) healthLabel.textContent = '';
        
        setupBalloonControls();
        console.log('[Controller] Balloon mode UI configured');
    } else if (gameMode === 'tug') {
        // Tug of War mode
        if (controllerBody) controllerBody.style.display = 'none';
        if (tugControls) tugControls.style.display = 'flex';
        if (controllerScreen) {
            controllerScreen.classList.add('tug-mode');
            controllerScreen.classList.remove('race-mode', 'flappy-mode');
        }
        if (stocksDisplay) stocksDisplay.style.display = 'none';
        if (healthLabel) healthLabel.textContent = '';
        
        setupTugControls();
        startTugRhythmAnimation();
        
        console.log('[Controller] Tug mode UI configured');
    } else if (gameMode === 'flappy') {
        // Flappy mode: Show single TAP button
        if (controllerBody) controllerBody.style.display = 'none';
        if (flappyControls) flappyControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('flappy-mode');
        if (controllerScreen) controllerScreen.classList.remove('race-mode');
        if (stocksDisplay) stocksDisplay.style.display = 'none';
        if (healthLabel) healthLabel.textContent = '';
        
        // Setup flappy tap button
        setupFlappyControls();
        
        console.log('[Controller] Flappy mode UI configured');
    } else if (gameMode === 'race') {
        // Race mode: Show only left/right foot buttons
        if (controllerBody) controllerBody.style.display = 'none';
        if (raceControls) raceControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('race-mode');
        if (controllerScreen) controllerScreen.classList.remove('flappy-mode');
        if (stocksDisplay) stocksDisplay.style.display = 'none';
        if (healthLabel) healthLabel.textContent = '';
        
        // Setup race foot buttons
        setupRaceControls();
        
        console.log('[Controller] Race mode UI configured');
    } else if (gameMode === 'tag') {
        // Tag mode: D-pad for 4-way movement, no action buttons
        if (controllerBody) controllerBody.style.display = 'flex';
        if (raceControls) raceControls.style.display = 'none';
        if (flappyControls) flappyControls.style.display = 'none';
        
        if (dpadUp) {
            dpadUp.dataset.input = 'up';
            dpadUp.dataset.originalInput = 'up';
        }
        if (dpadDown) {
            dpadDown.dataset.input = 'down';
            dpadDown.dataset.originalInput = 'down';
            if (runLabel) runLabel.style.display = 'none';
        }
        
        // Hide action buttons in Tag mode
        const actionButtons = document.querySelector('.action-buttons');
        if (actionButtons) actionButtons.style.display = 'none';
        
        if (healthLabel) healthLabel.textContent = 'TIEMPO';
        if (stocksDisplay) stocksDisplay.style.display = 'none';
        
        console.log('[Controller] Tag mode UI configured');
    } else if (gameMode === 'paint') {
        // Paint mode: D-pad for 4-way movement + Run
        if (controllerBody) controllerBody.style.display = 'flex';
        if (raceControls) raceControls.style.display = 'none';
        if (flappyControls) flappyControls.style.display = 'none';
        if (controllerScreen) {
            controllerScreen.classList.add('paint-mode');
            controllerScreen.classList.remove('race-mode', 'flappy-mode', 'tug-mode');
        }
        
        if (dpadUp) {
            dpadUp.dataset.input = 'up';
            dpadUp.dataset.originalInput = 'up';
        }
        if (dpadDown) {
            dpadDown.dataset.input = 'down';
            dpadDown.dataset.originalInput = 'down';
            if (runLabel) runLabel.style.display = 'block';
        }
        
        // Show action buttons but maybe only for running? 
        // Actually, let's just use the D-pad and keep it simple.
        const actionButtons = document.querySelector('.action-buttons');
        if (actionButtons) actionButtons.style.display = 'none';
        
        if (healthLabel) healthLabel.textContent = 'PINTA!';
        if (stocksDisplay) stocksDisplay.style.display = 'none';
        
        console.log('[Controller] Paint mode UI configured');
    } else if (gameMode === 'arena') {
        // Arena mode: D-pad controls all 4 directions for movement
        if (controllerBody) controllerBody.style.display = 'flex';
        if (raceControls) raceControls.style.display = 'none';
        if (controllerScreen) controllerScreen.classList.remove('race-mode');
        
        if (dpadUp) {
            dpadUp.dataset.input = 'up';
            dpadUp.dataset.originalInput = 'up';
        }
        if (dpadDown) {
            dpadDown.dataset.input = 'down';
            dpadDown.dataset.originalInput = 'down';
            if (runLabel) runLabel.style.display = 'none';
        }
        
        // Show grab button in Arena mode
        if (grabBtn) grabBtn.style.display = 'flex';
        
        // Change health display for Arena mode
        if (healthLabel) healthLabel.textContent = 'VIDA';
        if (stocksDisplay) stocksDisplay.style.display = 'none';
        
        console.log('[Controller] Arena mode UI configured');
    } else {
        // Smash mode: Up = jump, Down = run
        if (controllerBody) controllerBody.style.display = 'flex';
        if (raceControls) raceControls.style.display = 'none';
        if (controllerScreen) controllerScreen.classList.remove('race-mode');
        
        if (dpadUp) {
            dpadUp.dataset.input = 'jump';
            dpadUp.dataset.originalInput = 'jump';
        }
        if (dpadDown) {
            dpadDown.dataset.input = 'run';
            dpadDown.dataset.originalInput = 'run';
            if (runLabel) runLabel.style.display = 'block';
        }
        
        // Hide grab button in Smash mode
        if (grabBtn) grabBtn.style.display = 'none';
        
        if (healthLabel) healthLabel.textContent = 'DAÑO';
        if (stocksDisplay) stocksDisplay.style.display = 'flex';
        
        console.log('[Controller] Smash mode UI configured');
    }
}

// Setup race mode controls (left/right foot buttons)
function setupRaceControls() {
    const leftFoot = document.getElementById('left-foot');
    const rightFoot = document.getElementById('right-foot');
    
    if (leftFoot) {
        leftFoot.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleRaceTap('left', leftFoot);
        }, { passive: false });
        
        leftFoot.addEventListener('touchend', (e) => {
            e.preventDefault();
            leftFoot.classList.remove('pressed');
        }, { passive: false });
    }
    
    if (rightFoot) {
        rightFoot.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleRaceTap('right', rightFoot);
        }, { passive: false });
        
        rightFoot.addEventListener('touchend', (e) => {
            e.preventDefault();
            rightFoot.classList.remove('pressed');
        }, { passive: false });
    }
    
    console.log('[Race] Controls setup complete');
}

// Handle a race tap (left or right foot)
function handleRaceTap(side, btn) {
    btn.classList.add('pressed');
    btn.classList.add('pulse');
    
    // Send tap to server
    if (socket && socket.connected) {
        socket.emit('race-tap', side);
    }
    
    // Visual feedback
    triggerHaptic();
    
    // Remove pulse class after animation
    setTimeout(() => {
        btn.classList.remove('pulse');
    }, 300);
    
    // Update last tap for alternating indicator
    lastRaceTap = side;
}

// Setup flappy mode controls (single TAP button)
function setupFlappyControls() {
    const flapBtn = document.getElementById('flap-btn');
    
    if (flapBtn) {
        // Remove old listeners
        flapBtn.replaceWith(flapBtn.cloneNode(true));
        const newFlapBtn = document.getElementById('flap-btn');
        
        newFlapBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleFlappyTap(newFlapBtn);
        }, { passive: false });
        
        newFlapBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            newFlapBtn.classList.remove('pressed');
        }, { passive: false });
        
        // Mouse events for testing
        newFlapBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handleFlappyTap(newFlapBtn);
        });
        newFlapBtn.addEventListener('mouseup', () => {
            newFlapBtn.classList.remove('pressed');
        });
    }
    
    console.log('[Flappy] Controls setup complete');
}

// Setup Tug of War mode controls
function setupTugControls() {
    const pullBtn = document.getElementById('tug-pull-btn');
    
    if (pullBtn) {
        // Remove old listeners
        pullBtn.replaceWith(pullBtn.cloneNode(true));
        const newPullBtn = document.getElementById('tug-pull-btn');
        
        const handlePull = (e) => {
            if (e) e.preventDefault();
            if (gameMode !== 'tug') return;
            
            newPullBtn.classList.add('pressed');
            
            // Send pull action to server
            if (socket && socket.connected) {
                socket.emit('tug-pull');
            }
            
            triggerHaptic();
        };
        
        newPullBtn.addEventListener('touchstart', handlePull, { passive: false });
        newPullBtn.addEventListener('touchend', () => newPullBtn.classList.remove('pressed'), { passive: false });
        newPullBtn.addEventListener('mousedown', handlePull);
        newPullBtn.addEventListener('mouseup', () => newPullBtn.classList.remove('pressed'));
    }
    
    console.log('[Tug] Controls setup complete');
}

// Setup Balloon mode controls
function setupBalloonControls() {
    const inflateBtn = document.getElementById('balloon-inflate-btn');
    const fill = document.getElementById('balloon-progress-fill');
    const label = document.querySelector('.balloon-label');
    const progressContainer = document.querySelector('.balloon-progress-container');
    
    // Hide progress bar as requested by user to increase tension
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    
    // Reset UI state for new game
    if (fill) {
        fill.style.width = '0%';
        fill.style.background = 'linear-gradient(90deg, #9966ff, #ff66ff)';
        fill.style.boxShadow = '0 0 15px rgba(255, 102, 255, 0.5)';
    }
    if (label) {
        label.textContent = '¡Toca para inflar!';
        label.style.color = 'white';
    }
    
    if (inflateBtn) {
        // Remove old listeners
        inflateBtn.replaceWith(inflateBtn.cloneNode(true));
        const newInflateBtn = document.getElementById('balloon-inflate-btn');
        
        // Reset button state
        newInflateBtn.disabled = false;
        newInflateBtn.style.opacity = '1';
        const btnText = newInflateBtn.querySelector('.balloon-text');
        if (btnText) btnText.textContent = '¡INFLAR!';
        
        const handleInflate = (e) => {
            if (e) e.preventDefault();
            if (gameMode !== 'balloon') return;
            if (newInflateBtn.disabled) return; // Don't process if DQ'd
            
            newInflateBtn.classList.add('pressed');
            newInflateBtn.classList.add('pulse');
            
            // Send inflate action to server
            if (socket && socket.connected) {
                socket.emit('balloon-inflate');
            }
            
            triggerHaptic();
            
            setTimeout(() => {
                newInflateBtn.classList.remove('pulse');
            }, 200);
        };
        
        newInflateBtn.addEventListener('touchstart', handleInflate, { passive: false });
        newInflateBtn.addEventListener('touchend', () => newInflateBtn.classList.remove('pressed'), { passive: false });
        newInflateBtn.addEventListener('mousedown', handleInflate);
        newInflateBtn.addEventListener('mouseup', () => newInflateBtn.classList.remove('pressed'));
    }
    
    // Reset balloon progress state
    balloonProgress = 0;
    
    console.log('[Balloon] Controls setup complete');
}

// Client-side rhythm animation for the Tug of War bar
function startTugRhythmAnimation() {
    const cursor = document.getElementById('rhythm-bar-cursor');
    if (!cursor) return;
    
    const animate = () => {
        if (gameMode !== 'tug') return;
        
        const now = Date.now();
        // Calculate progress within the current pulse interval (0 to 1)
        // We use tugPulseInterval = 1500ms
        const progress = (now % tugPulseInterval) / tugPulseInterval;
        
        // Move cursor from 0% to 100%
        cursor.style.left = `${progress * 100}%`;
        
        requestAnimationFrame(animate);
    };
    
    requestAnimationFrame(animate);
}

// Handle flappy tap (flap wings)
function handleFlappyTap(btn) {
    if (!flappyAlive) return;
    
    btn.classList.add('pressed');
    btn.classList.add('flap');
    
    // Send tap to server
    if (socket && socket.connected) {
        socket.emit('flappy-tap');
    }
    
    // Visual feedback
    triggerHaptic();
    
    // Remove flap class after animation
    setTimeout(() => {
        btn.classList.remove('flap');
    }, 200);
}

// Update race speed display
function updateRaceSpeed(speed) {
    const speedEl = document.getElementById('race-speed');
    if (speedEl) {
        // Convert game speed to "km/h" for display
        const displaySpeed = Math.floor(speed * 10);
        speedEl.textContent = `${displaySpeed} km/h`;
        
        // Change color based on speed
        if (speed > 10) {
            speedEl.style.color = '#ff3366';
        } else if (speed > 5) {
            speedEl.style.color = '#ff6600';
        } else {
            speedEl.style.color = '#00ccff';
        }
    }
    raceSpeed = speed;
}

function handleGameState(data) {
    // Find our player in the state
    const myState = data.players.find(p => p.id === socket.id);
    
    if (myState) {
        if (gameMode === 'arena') {
            // Arena mode: Show health percentage (100 = full health)
            const healthPercent = Math.floor((myState.health / 100) * 100);
            elements.playerDamage.textContent = `${healthPercent}%`;
            
            // Change color based on health
            if (healthPercent > 60) {
                elements.playerDamage.style.color = 'var(--secondary)';
            } else if (healthPercent > 30) {
                elements.playerDamage.style.color = 'var(--accent)';
            } else {
                elements.playerDamage.style.color = 'var(--primary)';
            }
        } else {
            // Smash mode: Show damage (higher = worse)
            elements.playerDamage.textContent = `${Math.floor(myState.health)}%`;
            
            // Change color based on damage
            if (myState.health > 100) {
                elements.playerDamage.style.color = 'var(--primary)';
            } else if (myState.health > 50) {
                elements.playerDamage.style.color = 'var(--accent)';
            } else {
                elements.playerDamage.style.color = 'var(--secondary)';
            }
        }
    }
}

// Handle Arena-specific state updates
function handleArenaState(data) {
    const myState = data.players.find(p => p.id === socket.id);
    
    if (myState) {
        // Show health percentage
        const healthPercent = Math.floor(myState.health);
        elements.playerDamage.textContent = `${healthPercent}%`;
        
        // Change color based on health
        if (healthPercent > 60) {
            elements.playerDamage.style.color = 'var(--secondary)';
        } else if (healthPercent > 30) {
            elements.playerDamage.style.color = 'var(--accent)';
        } else {
            elements.playerDamage.style.color = 'var(--primary)';
        }
        
        // Show eliminated state
        if (myState.isEliminated) {
            elements.playerDamage.textContent = 'X';
            elements.playerDamage.style.color = 'var(--primary)';
        }
        
        // Update grab state from server
        if (myState.isGrabbing !== undefined) {
            if (isGrabbing !== myState.isGrabbing) {
                isGrabbing = myState.isGrabbing;
                updateGrabButtonState();
            }
        }
        
        // Update grabbed state from server (sync in case of auto-release)
        if (myState.isGrabbed !== undefined) {
            if (isGrabbed && !myState.isGrabbed) {
                // We were grabbed but now we're not - grab was released
                console.log('[Arena] Grab auto-released by server');
                isGrabbed = false;
                hideEscapeUI();
            } else if (!isGrabbed && myState.isGrabbed) {
                // Server says we're grabbed but we didn't know - show escape UI
                console.log('[Arena] Grab detected from server state');
                isGrabbed = true;
                escapeProgress = 0;
                showEscapeUI();
            }
        }
    }
}

/**
 * Handle when someone grabs (server broadcast)
 */
function handleArenaGrabEvent(data) {
    console.log('[Arena] Grab event:', data);
    // If we are the grabber, update our state
    if (data.grabberId === socket.id) {
        isGrabbing = true;
        updateGrabButtonState();
        triggerHaptic();
    }
    // If we are the target (being grabbed), show escape UI
    if (data.targetId === socket.id) {
        isGrabbed = true;
        escapeProgress = 0;
        showEscapeUI();
        triggerHaptic(true);
    }
}

/**
 * Handle when someone is thrown (server broadcast)
 */
function handleArenaThrowEvent(data) {
    console.log('[Arena] Throw event:', data);
    // If we were grabbing, we're no longer grabbing
    if (data.grabberId === socket.id) {
        isGrabbing = false;
        updateGrabButtonState();
        triggerHaptic();
    }
    // If we were thrown, hide escape UI and vibrate strongly
    if (data.targetId === socket.id) {
        isGrabbed = false;
        hideEscapeUI();
        triggerHaptic(true);
    }
}

/**
 * Handle when grab is released without throw
 */
function handleArenaGrabReleased(data) {
    console.log('[Arena] Grab released:', data);
    if (data.grabberId === socket.id) {
        isGrabbing = false;
        updateGrabButtonState();
    }
    if (data.targetId === socket.id) {
        isGrabbed = false;
        hideEscapeUI();
    }
}

/**
 * Handle when someone escapes from a grab (server broadcast)
 */
function handleArenaGrabEscapeEvent(data) {
    console.log('[Arena] Grab escape event:', data);
    // If we were the one who escaped
    if (data.targetId === socket.id) {
        isGrabbed = false;
        hideEscapeUI();
        triggerHaptic();
    }
    // If we were the grabber and they escaped
    if (data.grabberId === socket.id) {
        isGrabbing = false;
        updateGrabButtonState();
        triggerHaptic(true); // Strong vibration - they escaped!
    }
}

function handlePlayerKO(kos) {
    kos.forEach(ko => {
        if (ko.playerId === socket.id) {
            updateStocks(ko.stocksRemaining);
            triggerHaptic(true); // Strong haptic for KO
        }
    });
}

function handleGameOver(data) {
    console.log('[Game] Game over!', data);
    
    elements.gameOverOverlay.classList.remove('hidden');
    
    // Handle Tug of War team winner
    if (gameMode === 'tug' && data.winnerTeam) {
        if (data.winnerTeam === 'draw') {
            elements.gameOverTitle.textContent = '¡EMPATE!';
            elements.gameOverMessage.textContent = 'Ningún equipo logró ganar';
        } else {
            const isWinner = playerData && playerData.team === data.winnerTeam;
            elements.gameOverTitle.textContent = isWinner ? '¡GANASTE!' : '¡PERDISTE!';
            elements.gameOverTitle.style.color = isWinner ? 'var(--secondary)' : 'var(--primary)';
            elements.gameOverMessage.textContent = data.winnerTeam === 'left' ? 'Gana el EQUIPO IZQUIERDO' : 'Gana el EQUIPO DERECHO';
        }
    } else if (data.winner) {
        const isWinner = data.winner.id === socket.id;
        elements.gameOverTitle.textContent = isWinner ? '¡GANASTE!' : '¡PERDISTE!';
        elements.gameOverTitle.style.color = isWinner ? 'var(--secondary)' : 'var(--primary)';
        elements.gameOverMessage.textContent = `Ganador: ${data.winner.name}`;
    } else {
        elements.gameOverTitle.textContent = '¡EMPATE!';
        elements.gameOverMessage.textContent = 'Partida terminada';
    }
    
    triggerHaptic(true);
}

function handleGameReset(data) {
    console.log('[Game] Game reset');
    elements.gameOverOverlay.classList.add('hidden');
    isReady = false;
    updateLobbyUI(data.room);
    showScreen('lobby');
}

function handleRoomClosed(data) {
    console.log('[Game] Room closed:', data.reason);
    alert(data.reason || 'La sala fue cerrada');
    resetState();
    showScreen('join');
}

// =================================
// Controller Input
// =================================

function setupControllerInput() {
    // D-Pad buttons - read inputType dynamically from dataset for game mode switching
    const dpadButtons = document.querySelectorAll('.dpad-btn');
    
    dpadButtons.forEach(btn => {
        // Touch events - read inputType at event time for dynamic mode switching
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const inputType = btn.dataset.input; // Read at event time
            handleInputStart(inputType, btn);
        }, { passive: false });
        
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            const inputType = btn.dataset.input; // Read at event time
            handleInputEnd(inputType, btn);
        }, { passive: false });
        
        btn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            const inputType = btn.dataset.input; // Read at event time
            handleInputEnd(inputType, btn);
        }, { passive: false });
        
        // Mouse events (for testing on desktop) - also read dynamically
        btn.addEventListener('mousedown', () => {
            const inputType = btn.dataset.input;
            handleInputStart(inputType, btn);
        });
        btn.addEventListener('mouseup', () => {
            const inputType = btn.dataset.input;
            handleInputEnd(inputType, btn);
        });
        btn.addEventListener('mouseleave', () => {
            const inputType = btn.dataset.input;
            handleInputEnd(inputType, btn);
        });
    });
    
    // Action buttons (punch, kick, taunt)
    const actionButtons = document.querySelectorAll('.action-btn[data-action]');
    
    actionButtons.forEach(btn => {
        const action = btn.dataset.action;
        
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleAction(action, btn);
        }, { passive: false });
        
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            btn.classList.remove('pressed');
        }, { passive: false });
        
        // Mouse events
        btn.addEventListener('mousedown', () => handleAction(action, btn));
        btn.addEventListener('mouseup', () => btn.classList.remove('pressed'));
    });
    
    // Block button (hold to maintain)
    const blockButtons = document.querySelectorAll('.action-btn[data-input]');
    
    blockButtons.forEach(btn => {
        const inputType = btn.dataset.input;
        
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleBlockStart(inputType, btn);
        }, { passive: false });
        
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleBlockEnd(inputType, btn);
        }, { passive: false });
        
        btn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            handleBlockEnd(inputType, btn);
        }, { passive: false });
        
        // Mouse events
        btn.addEventListener('mousedown', () => handleBlockStart(inputType, btn));
        btn.addEventListener('mouseup', () => handleBlockEnd(inputType, btn));
        btn.addEventListener('mouseleave', () => handleBlockEnd(inputType, btn));
    });
}

function handleInputStart(inputType, btn) {
    console.log('[Input] Start:', inputType, 'gameMode:', gameMode);
    if (!inputType || inputState[inputType]) return;
    
    inputState[inputType] = true;
    btn.classList.add('pressed');
    
    sendInput();
    triggerHaptic();
}

function handleInputEnd(inputType, btn) {
    if (!inputType || !inputState[inputType]) return;
    
    inputState[inputType] = false;
    btn.classList.remove('pressed');
    
    sendInput();
}

function handleAction(action, btn) {
    btn.classList.add('pressed');
    
    // Handle actions based on game mode
    if (gameMode === 'arena') {
        // Arena mode events
        if (action === 'taunt') {
            socket.emit('player-taunt');
        } else if (action === 'grab') {
            console.log(`[Arena] Grab button pressed. isGrabbing=${isGrabbing}`);
            if (isGrabbing) {
                // If already grabbing, try to throw
                // Calculate throw direction from current input
                let direction = null;
                if (inputState.left) direction = -Math.PI / 2;
                else if (inputState.right) direction = Math.PI / 2;
                else if (inputState.up) direction = 0;
                else if (inputState.down) direction = Math.PI;
                
                console.log(`[Arena] Throwing with direction=${direction}`);
                socket.emit('arena-throw', direction, (response) => {
                    console.log('[Arena Throw] Response:', response);
                    if (response && response.success) {
                        isGrabbing = false;
                        updateGrabButtonState();
                        console.log('[Arena] Throw success, button reset to AGARRAR');
                    }
                });
            } else {
                // Try to grab
                console.log('[Arena] Attempting grab...');
                socket.emit('arena-grab', (response) => {
                    console.log('[Arena Grab] Response:', response);
                    if (response && response.success) {
                        isGrabbing = true;
                        updateGrabButtonState();
                        console.log('[Arena] Grab success! Button changed to LANZAR');
                    } else {
                        console.log('[Arena] Grab failed - no target in range?');
                    }
                });
            }
        } else {
            socket.emit('arena-attack', action, (response) => {
                console.log('[Arena Attack]', action, response);
            });
        }
    } else {
        // Smash mode events
        if (action === 'taunt') {
            socket.emit('player-taunt');
        } else {
            socket.emit('player-attack', action, (response) => {
                console.log('[Attack]', action, response);
            });
        }
    }
    
    // Send input update with action flag
    const inputWithAction = { ...inputState };
    inputWithAction[action] = true;
    socket.emit('player-input', inputWithAction);
    
    // Reset action flag after brief moment
    setTimeout(() => {
        inputWithAction[action] = false;
        socket.emit('player-input', inputWithAction);
    }, 100);
    
    triggerHaptic();
}

function handleBlockStart(inputType, btn) {
    btn.classList.add('pressed');
    inputState[inputType] = true;
    
    // Emit block state to server (different event for Arena)
    if (gameMode === 'arena') {
        socket.emit('arena-block', true);
    } else {
        socket.emit('player-block', true);
    }
    sendInput();
    triggerHaptic();
}

function handleBlockEnd(inputType, btn) {
    btn.classList.remove('pressed');
    inputState[inputType] = false;
    
    // Emit block release to server
    if (gameMode === 'arena') {
        socket.emit('arena-block', false);
    } else {
        socket.emit('player-block', false);
    }
    sendInput();
}

function sendInput() {
    if (socket && socket.connected) {
        // Create input object based on game mode
        const gameInput = { ...inputState };
        
        if (gameMode === 'arena') {
            // Arena mode: ensure up/down are movement (not jump/run)
            // The d-pad buttons already send 'up'/'down' in arena mode
            // but we need to map them correctly
            gameInput.up = inputState.up || false;
            gameInput.down = inputState.down || false;
            gameInput.run = inputState.run || false; // Shift can still be run
        }
        
        socket.emit('player-input', gameInput);
    }
}

// =================================
// UI Helpers
// =================================

function updateStocks(count) {
    const stocks = elements.stocksDisplay.querySelectorAll('.stock');
    stocks.forEach((stock, i) => {
        stock.classList.toggle('lost', i >= count);
    });
}

function triggerHaptic(strong = false) {
    if ('vibrate' in navigator) {
        navigator.vibrate(strong ? [50, 30, 50] : 10);
    }
}

/**
 * Update grab button visual state based on isGrabbing
 */
function updateGrabButtonState() {
    const grabButton = document.querySelector('.action-btn[data-action="grab"]');
    if (!grabButton) return;
    
    const labelSpan = grabButton.querySelector('.btn-action');
    
    if (isGrabbing) {
        // Change to "LANZAR" (throw) mode
        grabButton.classList.add('grabbing');
        grabButton.style.borderColor = '#ff6600';
        grabButton.style.color = '#ff6600';
        grabButton.style.animation = 'pulse 0.5s infinite';
        if (labelSpan) labelSpan.textContent = 'LANZAR';
    } else {
        // Back to normal "AGARRAR" (grab) mode
        grabButton.classList.remove('grabbing');
        grabButton.style.borderColor = '#9966ff';
        grabButton.style.color = '#9966ff';
        grabButton.style.animation = 'none';
        if (labelSpan) labelSpan.textContent = 'AGARRAR';
    }
}

/**
 * Show escape UI when player is grabbed
 */
function showEscapeUI() {
    // Remove existing escape UI if present
    hideEscapeUI();
    
    // Create escape overlay
    const escapeOverlay = document.createElement('div');
    escapeOverlay.id = 'escape-overlay';
    escapeOverlay.innerHTML = `
        <div class="escape-container">
            <div class="escape-title">¡ESTÁS AGARRADO!</div>
            <div class="escape-instruction">¡PRESIONA RÁPIDO PARA ESCAPAR!</div>
            <div class="escape-progress-bar">
                <div class="escape-progress-fill" id="escape-fill"></div>
            </div>
            <button class="escape-btn" id="escape-btn">
                <span class="escape-btn-icon">💪</span>
                <span class="escape-btn-text">¡ESCAPAR!</span>
            </button>
        </div>
    `;
    
    // Add styles
    escapeOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(255, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: pulseRed 0.5s infinite;
    `;
    
    const style = document.createElement('style');
    style.id = 'escape-styles';
    style.textContent = `
        @keyframes pulseRed {
            0%, 100% { background: rgba(255, 0, 0, 0.2); }
            50% { background: rgba(255, 0, 0, 0.4); }
        }
        .escape-container {
            background: rgba(0, 0, 0, 0.9);
            border: 4px solid #ff3366;
            border-radius: 20px;
            padding: 30px;
            text-align: center;
            max-width: 90%;
        }
        .escape-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.8rem;
            font-weight: bold;
            color: #ff3366;
            margin-bottom: 10px;
            text-shadow: 0 0 10px rgba(255, 51, 102, 0.8);
        }
        .escape-instruction {
            font-family: 'Orbitron', sans-serif;
            font-size: 1rem;
            color: white;
            margin-bottom: 20px;
        }
        .escape-progress-bar {
            width: 100%;
            height: 30px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 15px;
            overflow: hidden;
            margin-bottom: 20px;
            border: 2px solid #00ffcc;
        }
        .escape-progress-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #00ffcc, #00ff88);
            transition: width 0.1s ease;
            box-shadow: 0 0 20px rgba(0, 255, 204, 0.5);
        }
        .escape-btn {
            width: 100%;
            padding: 20px;
            font-size: 1.5rem;
            font-family: 'Orbitron', sans-serif;
            font-weight: bold;
            background: linear-gradient(45deg, #00ffcc, #00ff88);
            color: #0a0a15;
            border: none;
            border-radius: 15px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            animation: escapeButtonPulse 0.3s infinite;
        }
        @keyframes escapeButtonPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        .escape-btn:active {
            transform: scale(0.95) !important;
            background: linear-gradient(45deg, #00ff88, #00ffcc);
        }
        .escape-btn-icon {
            font-size: 2rem;
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(escapeOverlay);
    
    // Add click handler for escape button
    const escapeBtn = document.getElementById('escape-btn');
    escapeBtn.addEventListener('click', handleEscapePress);
    escapeBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleEscapePress();
    });
}

/**
 * Hide escape UI
 */
function hideEscapeUI() {
    const overlay = document.getElementById('escape-overlay');
    const styles = document.getElementById('escape-styles');
    if (overlay) overlay.remove();
    if (styles) styles.remove();
    escapeProgress = 0;
}

/**
 * Handle escape button press
 */
function handleEscapePress() {
    if (!isGrabbed) {
        console.log('[Escape] Not grabbed, ignoring');
        return;
    }
    
    // Each press adds 33-40% progress
    escapeProgress += (100 / escapeThreshold);
    escapeProgress = Math.min(100, escapeProgress); // Cap at 100
    console.log('[Escape] Progress:', escapeProgress);
    
    // Update progress bar immediately
    const fill = document.getElementById('escape-fill');
    if (fill) {
        fill.style.width = escapeProgress + '%';
    }
    
    // Haptic feedback
    triggerHaptic();
    
    // Check if escaped (at or above 100%)
    if (escapeProgress >= 100) {
        console.log('[Escape] Bar full! Sending escape request...');
        
        // Immediately hide UI and mark as escaped (optimistic)
        isGrabbed = false;
        hideEscapeUI();
        
        socket.emit('arena-escape', (response) => {
            console.log('[Escape] Server response:', response);
            if (response && response.success) {
                console.log('[Escape] Successfully escaped!');
                // Already handled above
            } else {
                console.log('[Escape] Server said no, but we escaped locally');
                // Still escaped from user perspective - server will sync state
            }
        });
    }
}

function resetState() {
    playerData = null;
    roomCode = null;
    isReady = false;
    selectedCharacter = null;
    takenCharacters = {};
    gameMode = 'smash';
    isGrabbing = false;
    isGrabbed = false;
    escapeProgress = 0;
    lastRaceTap = null;
    raceSpeed = 0;
    flappyAlive = true;
    balloonProgress = 0;
    Object.keys(inputState).forEach(key => inputState[key] = false);
    
    // Hide escape UI if visible
    hideEscapeUI();
    updateGrabButtonState();
    
    elements.roomCodeInput.value = '';
    elements.joinError.textContent = '';
    elements.gameOverOverlay.classList.add('hidden');
    elements.readyBtn.classList.remove('active');
    elements.readyBtn.disabled = true;
    elements.readyBtn.querySelector('.btn-text').textContent = '¡LISTO!';
    
    // Reset character selection UI
    updateCharacterSelectionUI();
}

// =================================
// Event Listeners
// =================================

function setupEventListeners() {
    // Join screen
    elements.joinBtn.addEventListener('click', joinRoom);
    
    elements.roomCodeInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            joinRoom();
        }
    });
    
    // Auto-uppercase room code
    elements.roomCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });
    
    // Lobby screen
    elements.readyBtn.addEventListener('click', toggleReady);
    elements.leaveBtn.addEventListener('click', leaveRoom);
    
    // Character selection
    const charOptions = document.querySelectorAll('.char-option');
    charOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            selectCharacter(btn.dataset.character);
        });
    });
    
    // Controller screen
    elements.menuBtn.addEventListener('click', () => {
        if (confirm('¿Salir del juego?')) {
            leaveRoom();
        }
    });
    
    // Game over screen
    elements.rematchBtn.addEventListener('click', () => {
        socket.emit('request-rematch');
    });
    
    elements.exitBtn.addEventListener('click', () => {
        leaveRoom();
    });
}

// =================================
// Tournament Handlers
// =================================

let tournamentState = {
    totalRounds: 1,
    currentRound: 1,
    playerScores: {}
};

function handleTournamentConfig(data) {
    console.log('[Tournament] Config received:', data);
    tournamentState.totalRounds = data.tournamentRounds || 1;
    tournamentState.currentRound = data.currentRound || 1;
    updateTournamentHUD();
}

function handleRoundEnded(data) {
    console.log('[Tournament] Round ended:', data);
    tournamentState.currentRound = data.currentRound;
    tournamentState.playerScores = data.playerScores || {};
    
    showRoundEndOverlay(data);
}

function handleTournamentEnded(data) {
    console.log('[Tournament] Tournament ended:', data);
    tournamentState.playerScores = data.playerScores || {};
    
    hideRoundEndOverlay();
    showTournamentEndOverlay(data);
}

function handleRoundStarting(data) {
    console.log('[Tournament] Round starting:', data);
    tournamentState.currentRound = data.round;
    
    hideRoundEndOverlay();
    updateTournamentHUD();
}

function showRoundEndOverlay(data) {
    const overlay = document.getElementById('round-end-overlay');
    if (!overlay) return;
    
    const roundNum = document.getElementById('round-num');
    const winnerName = document.getElementById('round-winner-name');
    const scoresEl = document.getElementById('round-mobile-scores');
    const countdownEl = document.getElementById('round-countdown');
    
    if (roundNum) roundNum.textContent = data.currentRound;
    if (winnerName) winnerName.textContent = `¡${data.roundWinner} GANA!`;
    
    // Build scores
    if (scoresEl && data.playerScores) {
        const maxWins = Math.max(...Object.values(data.playerScores), 0);
        scoresEl.innerHTML = Object.entries(data.playerScores)
            .sort((a, b) => b[1] - a[1])
            .map(([name, wins]) => `
                <div class="score-item ${wins === maxWins ? 'leader' : ''}">
                    <span class="player-name">${name}</span>
                    <span class="player-wins">${wins}</span>
                </div>
            `).join('');
    }
    
    overlay.classList.remove('hidden');
    
    // Countdown
    let countdown = 5;
    if (countdownEl) countdownEl.textContent = countdown;
    
    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdownEl) countdownEl.textContent = countdown;
        if (countdown <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);
}

function hideRoundEndOverlay() {
    const overlay = document.getElementById('round-end-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function showTournamentEndOverlay(data) {
    const overlay = document.getElementById('tournament-end-overlay');
    if (!overlay) return;
    
    const champion = document.getElementById('tournament-winner');
    const scoresEl = document.getElementById('tournament-mobile-scores');
    
    if (champion) champion.textContent = `🏆 ${data.tournamentWinner} 🏆`;
    
    // Build final scores
    if (scoresEl && data.playerScores) {
        scoresEl.innerHTML = Object.entries(data.playerScores)
            .sort((a, b) => b[1] - a[1])
            .map(([name, wins], index) => `
                <div class="score-item ${name === data.tournamentWinner ? 'leader' : ''}">
                    <span class="player-name">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : ''} ${name}</span>
                    <span class="player-wins">${wins}</span>
                </div>
            `).join('');
    }
    
    overlay.classList.remove('hidden');
    
    // Setup exit button
    const exitBtn = document.getElementById('tournament-exit-btn');
    if (exitBtn) {
        exitBtn.onclick = () => {
            overlay.classList.add('hidden');
            leaveRoom();
        };
    }
}

function updateTournamentHUD() {
    const hud = document.getElementById('mobile-tournament-hud');
    if (!hud) return;
    
    if (tournamentState.totalRounds <= 1) {
        hud.classList.add('hidden');
        return;
    }
    
    hud.classList.remove('hidden');
    
    const currentRound = document.getElementById('mobile-current-round');
    const totalRounds = document.getElementById('mobile-total-rounds');
    
    if (currentRound) currentRound.textContent = tournamentState.currentRound;
    if (totalRounds) totalRounds.textContent = tournamentState.totalRounds;
}

// =================================
// Initialization
// =================================

function init() {
    console.log('[Controller] Initializing...');
    
    // Check for room code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomCodeFromUrl = urlParams.get('room');
    if (roomCodeFromUrl) {
        elements.roomCodeInput.value = roomCodeFromUrl.toUpperCase();
    }
    
    // Connect to server
    connectToServer();
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup controller input
    setupControllerInput();
    
    // Prevent zoom on double tap
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // Prevent context menu
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    
    console.log('[Controller] Ready!');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

