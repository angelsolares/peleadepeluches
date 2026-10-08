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
    characterSelectionArea: document.getElementById('character-selection-area'),
    
    // Baby shower specific
    babyNameContainer: document.getElementById('baby-name-input-container'),
    babyNameInput: document.getElementById('baby-player-name'),
    
    // Controller screen
    controllerBadge: document.getElementById('controller-player-badge'),
    playerDamage: document.getElementById('player-damage'),
    stocksDisplay: document.getElementById('stocks-display'),
    menuBtn: document.getElementById('menu-btn'),
    
    // Balloon specific
    balloonControls: document.getElementById('balloon-controls'),
    balloonInflateBtn: document.getElementById('balloon-inflate-btn'),
    balloonProgressFill: document.getElementById('balloon-progress-fill'),

    // Trivia specific
    triviaControls: document.getElementById('trivia-controls'),
    
    // Puzzle specific
    puzzleControls: document.getElementById('puzzle-controls'),
    puzzleInput: document.getElementById('puzzle-input'),
    puzzleSendBtn: document.getElementById('puzzle-send-btn'),
    
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
// Tie-ups, grapple moves, downs and pins live in `wrestle` / `mash` (Arena wrestling section)

// Race mode state
let lastRaceTap = null; // 'left' or 'right' - track last tap for alternating
let raceSpeed = 0; // Current speed display
const RACE_JUMP_WINDOW = [1.5, 5]; // Metres before a hurdle where a jump counts (same as the server)

// Flappy mode state
let flappyAlive = true;

// Tug of War state (the beat is server-driven: pulse k = startTime + k * pulseInterval)
let tugStamina = 100;
let tugNextPulse = 0;
let tugPulseInterval = 1500; // ms
let tugClockOffset = 0;      // serverTime - Date.now(), smoothed from every tug-state
let tugClockSynced = false;
let tugBeat = -1;            // Last beat index reported by the server
let tugBeatFlashUntil = 0;   // Bar flash deadline (ms, local clock)
let tugStreakShown = null;   // Last rendered streak line, to skip DOM writes
let tugTeamSyncShown = null; // Last rendered team sync line

// Balloon state
let balloonProgress = 0;
let balloonBlowing = false;     // button held (what we last told the server)
let balloonTied = false;        // "amarrado": banked, both buttons disabled
let balloonTension = 0;         // 0..1 from the server (size 70 -> 95)
let balloonLastVibe = 0;        // last tension vibration (throttle)

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

// Rematch request state (one request at a time)
let rematchPending = false;
let rematchErrorTimer = null;

// Mode classes that updateControllerUIForMode toggles on #controller-screen
const MODE_CLASSES = ['race-mode', 'flappy-mode', 'tug-mode', 'paint-mode', 'balloon-mode',
    'trivia-mode', 'puzzle-mode', 'maze-mode', 'sumo-mode', 'joystick-only'];

// =================================
// Small helpers
// =================================

/**
 * Escape text before inserting it with innerHTML (player names come from other players)
 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`]/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
    }[ch]));
}

/**
 * Vibrate if the device supports it (silently ignored otherwise)
 */
function vibrate(pattern) {
    try {
        if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
        // Some browsers throw if vibration is blocked; never break input handling for it
    }
}

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
        // Keep retrying: the server keeps our slot for 30 s (connectionStateRecovery)
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 4000
    });

    // Connection events
    socket.on('connect', () => {
        console.log(`[Socket] Connected to server${socket.recovered ? ' (session recovered)' : ''}`);
        isConnected = true;
        updateConnectionStatus('connected', 'Conectado');
        hideReconnectNotice();

        if (socket.recovered) {
            // Same socket id, room and player slot; missed events are replayed by the server.
            // The server zeroed our input while we were away: resend what is held right now.
            sendInput();
            // Escape taps sent before the drop never got their ack: stop counting them.
            // The next 'arena-state' redraws the wrestling UI from the server's truth.
            mash.pending = 0;
            return;
        }

        if (roomCode) {
            // We were in a room but the session could not be recovered (grace period expired
            // or the server restarted): our slot is gone, so go back to the join screen.
            const lostRoom = roomCode;
            console.warn('[Socket] Session lost, back to join screen');
            resetState();
            showScreen('join');
            elements.roomCodeInput.value = lostRoom;
            showError('Se perdió la conexión con la sala. Vuelve a unirte.');
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected from server:', reason);
        isConnected = false;

        if (reason === 'io server disconnect') {
            // Kicked by the server: socket.io will not retry on its own and the slot is gone
            hideReconnectNotice();
            if (roomCode) {
                resetState();
                showScreen('join');
                showError('Desconectado de la sala');
            }
            updateConnectionStatus('connecting', 'Conectando...');
            socket.connect();
            return;
        }

        if (reason === 'io client disconnect') {
            // Intentional disconnect from this page
            updateConnectionStatus('error', 'Desconectado');
            return;
        }

        // Network drop / screen lock: socket.io reconnects by itself and the server keeps
        // our slot for a while, so stay on the current screen and just show a notice.
        updateConnectionStatus('connecting', 'Reconectando...');
        if (roomCode) showReconnectNotice();
    });

    socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        if (roomCode) {
            showReconnectNotice();
        } else {
            updateConnectionStatus('error', 'Error de conexión');
        }
    });

    // Combat feedback: vibrate when THIS player gets hit
    socket.on('attack-hit', handleAttackHitHaptics);
    socket.on('arena-attack-hit', handleArenaAttackHit); // + lariat / dropkick knockdowns
    
    // Game events
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);
    socket.on('player-ready-changed', handleReadyChanged);
    socket.on('game-started', handleGameStarted);
    socket.on('game-state', handleGameState);
    socket.on('player-ko', handlePlayerKO);
    socket.on('smash-event', handleSmashEvent);
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
    // Arena wrestling (tie-ups, grapple moves, downs, pins)
    socket.on('arena-tieup', handleArenaTieUp);
    socket.on('arena-tieup-end', handleArenaTieUpEnd);
    socket.on('arena-grapple-move', handleArenaGrappleMove);
    socket.on('arena-grapple-impact', handleArenaGrappleImpact);
    socket.on('arena-getup', handleArenaGetUp);
    socket.on('arena-pin-start', handleArenaPinStart);
    socket.on('arena-pin-count', handleArenaPinCount);
    socket.on('arena-pin-end', handleArenaPinEnd);
    // Arena spirit meter & signature finishers
    socket.on('arena-special', handleArenaSpecial);
    socket.on('arena-special-end', handleArenaSpecialEnd);
    socket.on('arena-finisher', handleArenaFinisher);
    // Arena ropes (Irish whip, rebounds, rope running) & battle royal eliminations
    socket.on('arena-whip', handleArenaWhip);
    socket.on('arena-rebound', handleArenaRebound);
    socket.on('arena-whip-end', handleArenaWhipEnd);
    socket.on('arena-rope-bounce', handleArenaRopeBounce);
    socket.on('arena-elimination', handleArenaElimination);

    // Race mode events
    socket.on('race-state', handleRaceState);
    socket.on('race-countdown', handleRaceCountdown);
    socket.on('race-start', handleRaceStart);
    socket.on('race-finish', handleRaceFinish);
    socket.on('race-winner', handleRaceWinner);
    socket.on('race-stumble', handleRaceStumble);

    // Flappy mode events
    socket.on('flappy-countdown', handleFlappyCountdown);
    socket.on('flappy-start', handleFlappyStart);
    socket.on('flappy-state', handleFlappyState);
    socket.on('flappy-player-died', handleFlappyDeath);
    socket.on('flappy-game-over', handleFlappyGameOver);
    
    // Tag mode events
    socket.on('tag-state', handleTagState);
    socket.on('tag-transfer', handleTagTransfer);
    socket.on('tag-powerup', handleTagPowerUp);
    socket.on('tag-game-over', handleTagGameOver);

    // Sumo mode events
    socket.on('sumo-state', handleSumoState);
    socket.on('sumo-event', handleSumoEvent);
    socket.on('sumo-game-over', handleGameOver);
    
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
        updateRaceHurdleUI(myState);
    }
}

// Hurdles: the jump button glows in the jump window and shows the distance to the next hurdle
function updateRaceHurdleUI(me) {
    const btn = document.getElementById('race-jump-btn');
    const info = document.getElementById('race-hurdle-info');
    const controls = document.getElementById('race-controls');
    if (!btn || !info) return;

    const distance = me.nextHurdleDistance;
    const hasHurdle = typeof distance === 'number';
    const inWindow = hasHurdle && distance >= RACE_JUMP_WINDOW[0] && distance <= RACE_JUMP_WINDOW[1];

    btn.classList.toggle('ready', inWindow && !me.jumping && !me.stumbled);
    btn.classList.toggle('jumping', !!me.jumping);
    info.classList.toggle('near', inWindow);
    if (controls) controls.classList.toggle('stumbled', !!me.stumbled);

    if (me.jumping) {
        info.textContent = '¡EN EL AIRE!';
    } else if (me.stumbled) {
        info.textContent = '¡TROPEZÓN!';
    } else if (hasHurdle) {
        info.textContent = `Valla en ${Math.max(1, Math.round(distance))} m`;
    } else {
        info.textContent = me.finished ? '' : '¡Sin más vallas!';
    }
}

function resetRaceHurdleUI() {
    const btn = document.getElementById('race-jump-btn');
    const info = document.getElementById('race-hurdle-info');
    const controls = document.getElementById('race-controls');
    if (btn) btn.classList.remove('ready', 'jumping', 'pressed');
    if (info) { info.textContent = ''; info.classList.remove('near'); }
    if (controls) controls.classList.remove('stumbled');
}

// I tripped on a hurdle: buzz (the race-state flag keeps the UI in sync)
function handleRaceStumble(data) {
    if (!data || data.playerId !== socket.id) return;
    vibrate([80, 40, 80]);
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

// Power-ups ('tag-state'.powerUp, 'tag-powerup' events): label, color and vibration per kind
const TAG_POWERUPS = {
    rayo:   { emoji: '⚡', name: 'RAYO', color: '#ffcc00', hint: '¡Hay un rayo en el mapa!', vibration: [30, 40, 30] },
    escudo: { emoji: '🛡', name: 'ESCUDO', color: '#00e5ff', hint: '¡Hay un escudo en el mapa!', vibration: [60, 40, 60] }
};
let tagEffectShown = null;   // Last rendered effect line, to skip DOM writes
let tagHintShown = null;     // Last rendered map hint

/**
 * "⚡ RAYO 3 s" (active effect) and "¡Hay un rayo en el mapa!" lines under the status,
 * created on first use next to the penalty time (same spot as the Arena "QUEDAN N")
 */
function getTagHudEl(id) {
    let el = document.getElementById(id);
    if (el) return el;
    const info = elements.playerDamage?.parentElement;
    if (!info) return null;
    if (!document.getElementById('tag-powerup-styles')) {
        const style = document.createElement('style');
        style.id = 'tag-powerup-styles';
        style.textContent = `
            .tag-effect, .tag-powerup-hint {
                display: block; margin-top: 1px; white-space: nowrap;
                font-family: 'Orbitron', sans-serif; font-weight: 900; letter-spacing: 1px;
            }
            .tag-effect { font-size: 0.7rem; }
            .tag-powerup-hint { font-size: 0.55rem; color: var(--text-muted); animation: tagHintPulse 1s infinite; }
            .tag-effect.hidden, .tag-powerup-hint.hidden { display: none; }
            @keyframes tagHintPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        `;
        document.head.appendChild(style);
    }
    el = document.createElement('span');
    el.id = id;
    el.className = `${id === 'tag-effect' ? 'tag-effect' : 'tag-powerup-hint'} hidden`;
    info.appendChild(el);
    return el;
}

function renderTagEffect(myState) {
    const el = getTagHudEl('tag-effect');
    if (!el) return;
    let text = '';
    let color = '';
    if (myState && myState.boosted && myState.boostMsLeft > 0) {
        text = `${TAG_POWERUPS.rayo.emoji} ${TAG_POWERUPS.rayo.name} ${Math.ceil(myState.boostMsLeft / 1000)} s`;
        color = TAG_POWERUPS.rayo.color;
    } else if (myState && myState.shielded && myState.shieldMsLeft > 0) {
        text = `${TAG_POWERUPS.escudo.emoji} ${TAG_POWERUPS.escudo.name} ${Math.ceil(myState.shieldMsLeft / 1000)} s`;
        color = TAG_POWERUPS.escudo.color;
    }
    if (text === tagEffectShown) return;
    tagEffectShown = text;
    el.textContent = text;
    el.style.color = color;
    el.classList.toggle('hidden', !text);
}

function renderTagPowerUpHint(powerUp, myState) {
    const el = getTagHudEl('tag-powerup-hint');
    if (!el) return;
    const info = powerUp && TAG_POWERUPS[powerUp.kind];
    // "It" can't take the shield, so don't tempt them
    const text = info && !(powerUp.kind === 'escudo' && myState?.isIt) ? info.hint : '';
    if (text === tagHintShown) return;
    tagHintShown = text;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
}

function resetTagHud() {
    tagEffectShown = null;
    tagHintShown = null;
    ['tag-effect', 'tag-powerup-hint'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.classList.add('hidden');
        }
    });
}

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

    renderTagEffect(myState);
    renderTagPowerUpHint(data.powerUp, myState);
}

/**
 * 'tag-powerup' { type: 'spawn' | 'collect' | 'expire', id, kind, playerId?, playerName? }
 */
function handleTagPowerUp(event) {
    if (!event) return;
    const info = TAG_POWERUPS[event.kind];
    if (event.type === 'collect' && event.playerId === socket.id && info) {
        vibrate(info.vibration);
        showTagNotification(`${info.emoji} ¡${info.name}!`, info.color);
    } else if (event.type === 'spawn') {
        vibrate(15);
    }
}

// =================================
// Sumo
// =================================

/** Only the A button (EMPUJAR) in Sumo; the normal four buttons everywhere else */
function renderSumoButtons(on) {
    document.querySelectorAll('.action-btn[data-action], .action-btn[data-input]').forEach(btn => {
        const isShove = btn.dataset.action === 'punch';
        if (btn.classList.contains('arena-only')) return; // handled by the arena branch
        btn.style.display = on && !isShove ? 'none' : '';
        if (isShove) {
            const label = btn.querySelector('.btn-action');
            if (label) label.textContent = on ? 'EMPUJAR' : 'GOLPE';
            btn.classList.toggle('sumo-shove', on);
        }
    });
}

let sumoCharging = false;

function sumoChargeStart() {
    if (gameMode !== 'sumo' || !socket || !socket.connected || sumoCharging) return;
    sumoCharging = true;
    socket.emit('sumo-charge');
    vibrate(10);
}

function sumoShove() {
    if (gameMode !== 'sumo' || !sumoCharging) return;
    sumoCharging = false;
    if (!socket || !socket.connected) return;
    socket.emit('sumo-shove', (result) => {
        if (result && result.success) vibrate(result.power >= 0.99 ? [40, 30, 60] : 25);
    });
}

function handleSumoState(data) {
    if (!data || !data.players || !socket) return;
    const me = data.players.find(p => p.id === socket.id);
    if (elements.playerDamage) {
        let text = `${data.aliveCount}`;
        let color = '';
        if (me && !me.alive) { text = `${me.placement}º`; color = 'var(--primary)'; }
        else if (data.gameState === 'suddenDeath') color = 'var(--primary)';
        if (elements.playerDamage.textContent !== text) elements.playerDamage.textContent = text;
        elements.playerDamage.style.color = color;
    }
    const label = document.querySelector('.health-label');
    if (label) {
        const want = me && !me.alive ? 'FUERA' : (data.gameState === 'suddenDeath' ? '¡MUERTE SÚBITA!' : 'QUEDAN');
        if (label.textContent !== want) label.textContent = want;
    }
    // Charge feedback on the button
    const btn = document.querySelector('.action-btn[data-action="punch"]');
    if (btn && me) {
        btn.style.setProperty('--charge', `${Math.round((me.isCharging ? me.chargeRatio : 0) * 100)}%`);
        btn.classList.toggle('full', !!me.isCharging && me.chargeRatio >= 1);
    }
}

function handleSumoEvent(event) {
    if (!event || !socket) return;
    if (event.type === 'shove-hit' && event.targetId === socket.id) {
        vibrate(HIT_VIBRATION.hit);
    } else if (event.type === 'ring-out') {
        if (event.playerId === socket.id) {
            sumoCharging = false;
            vibrate([80, 40, 80, 40, 200]);
            showTagNotification(`¡FUERA! ${event.placement}º lugar`, '#ff3366');
        } else if (event.by === socket.id) {
            showTagNotification('¡LO SACASTE!', '#ffaa33');
        }
    } else if (event.type === 'sudden-death') {
        vibrate([60, 60, 60]);
        showTagNotification('¡MUERTE SÚBITA!', '#ff3366');
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

    // Server clock: the cursor and the beat haptic run on server time (see startTugRhythmAnimation)
    if (typeof data.serverTime === 'number') {
        const sample = data.serverTime - Date.now();
        if (!tugClockSynced) {
            tugClockOffset = sample;
            tugClockSynced = true;
        } else {
            tugClockOffset += (sample - tugClockOffset) * 0.1;
        }
    }
    if (data.pulseInterval > 0) tugPulseInterval = data.pulseInterval;
    if (data.nextPulseTime) tugNextPulse = data.nextPulseTime;

    // New beat: short buzz so the whole room feels the same rhythm
    if (typeof data.beat === 'number' && data.beat !== tugBeat) {
        // Consecutive beat = it just happened (a jump means we rejoined mid-match: no buzz)
        const justHappened = data.beat === tugBeat + 1;
        tugBeat = data.beat;
        if (justHappened) {
            vibrate(20);
            tugBeatFlashUntil = Date.now() + 120;
        }
    }

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

        // Visual feedback for pull quality (or a wasted extra pull)
        const btn = document.getElementById('tug-pull-btn');
        if (btn && ((myState.pullQuality !== undefined && myState.pullQuality > 0) || myState.mashed)) {
            const qualityClass = myState.mashed ? 'mashed' : (myState.pullQuality === 2 ? 'perfect' : 'good');
            btn.classList.add(qualityClass);
            setTimeout(() => btn.classList.remove(qualityClass), 300);
        }

        updateTugStreak(myState);
        updateTugTeamSync(data.teams ? data.teams[myState.team] : null);
    }
}

/** Personal streak line: "x3 PERFECTO" (last pull quality), or a short warning on a wasted pull */
let tugStreakMsgTimer = null;

function updateTugStreak(myState) {
    const el = document.getElementById('tug-streak');
    if (!el) return;
    const streak = myState.streak || 0;

    if (myState.mashed) {
        // Extra pull in an already used beat window: warn for a moment (the server only flags one tick)
        if (tugStreakShown !== 'mashed') {
            tugStreakShown = 'mashed';
            el.textContent = '¡ESPERA EL BEAT!';
            el.className = 'tug-streak mashed';
        }
        clearTimeout(tugStreakMsgTimer);
        tugStreakMsgTimer = setTimeout(() => {
            if (tugStreakShown !== 'mashed') return;
            tugStreakShown = null;
            el.textContent = '';
            el.className = 'tug-streak';
        }, 1500);
        return;
    }

    if (streak === 0) {
        if (tugStreakShown !== null && tugStreakShown !== 'mashed') {
            tugStreakShown = null;
            el.textContent = '';
            el.className = 'tug-streak';
        }
        return;
    }

    // Rewrite only on a counted pull (pullQuality > 0) or when the streak itself changed
    const prevWord = tugStreakShown && tugStreakShown.includes('|') ? tugStreakShown.split('|')[1] : 'BIEN';
    const word = myState.pullQuality === 2 ? 'PERFECTO' : (myState.pullQuality === 1 ? 'BIEN' : prevWord);
    const key = `${streak}|${word}`;
    if (key === tugStreakShown) return;
    tugStreakShown = key;
    el.textContent = `x${streak} ${word}`;
    el.className = word === 'PERFECTO' ? 'tug-streak perfect pop' : 'tug-streak pop';
    clearTimeout(tugStreakMsgTimer);
    tugStreakMsgTimer = setTimeout(() => el.classList.remove('pop'), 120);
}

/** Team line: "¡EQUIPO EN SINCRONÍA x2!" when the team keeps landing the beat together */
function updateTugTeamSync(team) {
    const el = document.getElementById('tug-team-sync');
    if (!el || !team) return;
    const combo = team.syncCombo || 0;
    const key = `${combo}|${team.hits}|${team.size}`;
    if (key === tugTeamSyncShown) return;
    tugTeamSyncShown = key;
    if (combo >= 2) {
        el.textContent = `¡EQUIPO EN SINCRONÍA x${combo}!`;
        el.className = 'tug-team-sync active';
    } else if (combo === 1) {
        el.textContent = '¡Equipo en sincronía! Sigan así';
        el.className = 'tug-team-sync';
    } else {
        el.textContent = team.size > 1 ? `Equipo: ${team.hits || 0}/${team.size} en el beat` : 'Sigue el beat';
        el.className = 'tug-team-sync';
    }
}

/** Fresh rhythm UI for a new match (game-started); the clock offset survives, same server */
function resetTugRhythmUI() {
    tugBeat = -1;
    tugBeatFlashUntil = 0;
    tugNextPulse = 0;
    tugStreakShown = null;
    tugTeamSyncShown = null;
    clearTimeout(tugStreakMsgTimer);
    const streak = document.getElementById('tug-streak');
    if (streak) { streak.textContent = ''; streak.className = 'tug-streak'; }
    const sync = document.getElementById('tug-team-sync');
    if (sync) { sync.textContent = ''; sync.className = 'tug-team-sync'; }
    document.getElementById('rhythm-bar-container')?.classList.remove('beat');
    document.getElementById('tug-pull-btn')?.classList.remove('perfect', 'good', 'mashed');
}

/**
 * Tell the server whether the blow button is held. Only sends on a change, so it is safe
 * to call from every release path (touchend, mode change, game over, reset).
 */
function sendBalloonBlow(on) {
    on = !!on;
    if (balloonBlowing === on) return;
    balloonBlowing = on;
    if (socket && socket.connected) {
        socket.emit('balloon-blow', on);
    }
}

/**
 * Tension vibration: short pulses that get stronger and closer together as the balloon
 * nears its (hidden) burst size. Never more often than every 250 ms.
 */
function pulseBalloonTension(tension, now) {
    if (tension <= 0) return;
    const interval = 250 + (1 - tension) * 650;      // 900 ms (barely stretched) -> 250 ms (about to pop)
    if (now - balloonLastVibe < interval) return;
    balloonLastVibe = now;
    const ms = Math.round(12 + tension * 50);          // 12 ms -> 62 ms
    vibrate(tension >= 0.7 ? [ms, 40, ms] : ms);
}

/**
 * Phone UI for a banked balloon (from the tie button or the server state)
 */
function showBalloonTied() {
    balloonTied = true;
    sendBalloonBlow(false);
    const btn = document.getElementById('balloon-inflate-btn');
    const tieBtn = document.getElementById('balloon-tie-btn');
    const label = document.querySelector('.balloon-label');
    if (btn) {
        btn.disabled = true;
        btn.classList.remove('pressed', 'shaking', 'tense', 'danger');
        btn.style.setProperty('--shake', 0);
    }
    if (tieBtn) {
        tieBtn.disabled = true;
        tieBtn.classList.remove('pressed');
        tieBtn.classList.add('tied');
        tieBtn.textContent = '🎀 AMARRADO';
    }
    if (label) {
        label.textContent = '🎀 Amarrado. ¡A esperar!';
        label.style.color = '#ffcc00';
    }
}

function handleBalloonState(data) {
    if (!data || !data.players) return;

    const myState = data.players.find(p => p.id === socket.id);
    if (!myState) return;

    // Use normalized progress (0-100) from server
    balloonProgress = myState.progress !== undefined ? myState.progress : myState.balloonSize;
    balloonTension = typeof myState.tension === 'number' ? myState.tension : 0;
    const fill = document.getElementById('balloon-progress-fill');
    const btn = document.getElementById('balloon-inflate-btn');
    const tieBtn = document.getElementById('balloon-tie-btn');
    const label = document.querySelector('.balloon-label');
    const progressContainer = document.querySelector('.balloon-progress-container');
    const lungFill = document.getElementById('balloon-lung-fill');
    const lungValue = document.getElementById('balloon-lung-value');

    // The size bar stays hidden (tension!); the player only sees their air
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    if (fill) fill.style.width = `${balloonProgress}%`;

    // Air bar
    const lung = typeof myState.lung === 'number' ? Math.max(0, Math.min(100, myState.lung)) : 100;
    if (lungFill) {
        lungFill.style.width = `${lung}%`;
        lungFill.classList.toggle('low', lung > 0 && lung <= 35);
        lungFill.classList.toggle('empty', lung <= 0);
    }
    if (lungValue) lungValue.textContent = `${Math.round(lung)}%`;

    if (myState.isDQ) {
        // Popped: the bar shows up full and red, everything else is locked
        sendBalloonBlow(false);
        if (progressContainer) progressContainer.style.display = 'block';
        if (fill) {
            fill.style.width = '100%';
            fill.style.background = '#ff3366';
            fill.style.boxShadow = '0 0 20px #ff0000';
        }
        if (btn) {
            btn.disabled = true;
            btn.classList.remove('pressed', 'shaking', 'tense', 'danger');
            btn.style.setProperty('--shake', 0);
            const text = btn.querySelector('.balloon-text');
            if (text) text.textContent = '¡BOOM!';
            const sub = btn.querySelector('.balloon-subtext');
            if (sub) sub.textContent = '';
        }
        if (tieBtn) {
            tieBtn.disabled = true;
            tieBtn.classList.remove('pressed');
        }
        if (label) {
            label.textContent = '💀 ¡ELIMINADO!';
            label.style.color = '#ff3366';
        }
        return;
    }

    if (myState.tied) {
        if (!balloonTied) showBalloonTied();
        return;
    }

    // Tension feedback (no numbers: label, trembling button and vibration)
    const t = balloonTension;
    if (label) {
        if (t >= 0.7) {
            label.textContent = '¡¡VA A TRONAR!!';
            label.style.color = '#ff3366';
        } else if (t >= 0.3) {
            label.textContent = 'Se está estirando…';
            label.style.color = '#ffcc00';
        } else {
            label.textContent = 'Sopla con calma…';
            label.style.color = 'white';
        }
    }
    if (btn) {
        btn.style.setProperty('--shake', t.toFixed(2));
        btn.classList.toggle('shaking', t > 0);
        btn.classList.toggle('tense', t >= 0.3 && t < 0.7);
        btn.classList.toggle('danger', t >= 0.7);
    }
    pulseBalloonTension(t, Date.now());
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

function showReconnectNotice() {
    const notice = document.getElementById('reconnect-notice');
    if (notice) notice.classList.remove('hidden');
}

function hideReconnectNotice() {
    const notice = document.getElementById('reconnect-notice');
    if (notice) notice.classList.add('hidden');
}

// =================================
// Hit Haptics (Smash 'attack-hit' / Arena 'arena-attack-hit' and 'arena-throw')
// =================================

const HIT_VIBRATION = {
    hit: [35, 25, 35],   // short double buzz
    blocked: 15,         // light tick
    thrown: [90, 40, 140] // long
};

function handleAttackHitHaptics(data) {
    if (!data || !Array.isArray(data.hits) || !socket) return;
    const myHit = data.hits.find(h => h && h.targetId === socket.id);
    if (!myHit) return;
    vibrate(myHit.blocked ? HIT_VIBRATION.blocked : HIT_VIBRATION.hit);
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
        
        console.log('[Controller] join-room response:', response);
        console.log('[Controller] Room info:', response.room);
        
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
    
    const mainLogo = document.getElementById('main-logo');
    elements.lobbyRoomCode.textContent = room.code;
    gameMode = room.gameMode;

    // Handle Baby Shower mode UI - check BOTH flags
    const isBabyShower = room.isBabyShower === true || gameMode === 'baby_shower';
    console.log('[Controller] updateLobbyUI - isBabyShower:', isBabyShower, 'room.isBabyShower:', room.isBabyShower, 'gameMode:', gameMode);
    
    if (isBabyShower) {
        console.log('[Controller] Activating Baby Shower mode UI');
        
        // Apply baby theme class to body FIRST
        document.body.classList.add('baby-theme');
        
        // Update logo
        if (mainLogo) mainLogo.innerHTML = 'FIESTA DE<br>BEBÉS';
        
        // Show name input container
        if (elements.babyNameContainer) {
            elements.babyNameContainer.style.display = 'block';
            elements.babyNameContainer.style.visibility = 'visible';
            elements.babyNameContainer.classList.add('visible');
        }
        
        // Update display name placeholder
        elements.playerDisplayName.textContent = '¿Cuál es tu nombre?';
        
        // FORCE hide character selection - multiple approaches
        if (elements.characterSelectionArea) {
            elements.characterSelectionArea.style.display = 'none';
            elements.characterSelectionArea.style.visibility = 'hidden';
            elements.characterSelectionArea.style.height = '0';
            elements.characterSelectionArea.style.overflow = 'hidden';
        }
        const charSelectionByClass = document.querySelector('.character-selection');
        if (charSelectionByClass) {
            charSelectionByClass.style.display = 'none';
            charSelectionByClass.style.visibility = 'hidden';
        }
        
        // Hide player status text
        if (elements.playerStatus) {
            elements.playerStatus.style.display = 'none';
        }
        
        // Auto-select baby character
        if (selectedCharacter !== 'baby') {
            selectedCharacter = 'baby';
            socket.emit('select-character', { characterId: 'baby', characterName: 'Bebé' });
        }
        
        // Disable ready button until name is entered
        elements.readyBtn.disabled = true;

        // Setup name input listener if not already done
        if (!elements.babyNameInput.dataset.listenerAdded) {
            elements.babyNameInput.addEventListener('input', (e) => {
                const newName = e.target.value.trim();
                if (newName.length > 0) {
                    socket.emit('update-player-name', newName);
                    elements.readyBtn.disabled = false;
                    // Update display name
                    elements.playerDisplayName.textContent = newName;
                } else {
                    elements.readyBtn.disabled = true;
                }
            });
            elements.babyNameInput.dataset.listenerAdded = 'true';
        }
        
        // Focus on name input for convenience
        setTimeout(() => {
            if (elements.babyNameInput) {
                elements.babyNameInput.focus();
            }
        }, 300);
        
    } else {
        document.body.classList.remove('baby-theme');
        if (elements.babyNameContainer) elements.babyNameContainer.style.display = 'none';
        if (elements.characterSelectionArea) {
            elements.characterSelectionArea.style.display = 'block';
            elements.characterSelectionArea.style.visibility = 'visible';
            elements.characterSelectionArea.style.height = 'auto';
            elements.characterSelectionArea.style.overflow = 'visible';
        }
        if (elements.playerStatus) elements.playerStatus.style.display = 'block';
    }
    
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
    
    // Disable ready button based on mode
    const isBabyShowerMode = document.body.classList.contains('baby-theme');
    if (isBabyShowerMode) {
        // In baby shower mode, button is disabled until name is entered
        const hasName = elements.babyNameInput && elements.babyNameInput.value.trim().length > 0;
        elements.readyBtn.disabled = !hasName;
    } else {
        // Normal mode - disabled if no character selected
        elements.readyBtn.disabled = !selectedCharacter;
    }
    
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
        const charEmoji = (p.character && CHARACTERS[p.character]?.emoji) || '❓';
        const color = escapeHtml(p.color);
        return `
            <li class="${p.ready ? 'ready' : ''}" style="border-left-color: ${color}">
                <span class="player-number" style="color: ${color}">P${escapeHtml(p.number)}</span>
                <span class="player-name">${charEmoji} ${escapeHtml(p.name)}</span>
                <span class="ready-status">${p.ready ? '✓ Listo' : ''}</span>
            </li>
        `;
    }).join('');
}

function toggleReady() {
    const isBabyShowerMode = document.body.classList.contains('baby-theme');
    
    // Can't be ready without selecting a character (unless in baby shower mode)
    if (!isBabyShowerMode && !selectedCharacter) {
        alert('¡Primero selecciona un personaje!');
        return;
    }

    // In baby shower mode, must have a name
    if (isBabyShowerMode && elements.babyNameInput.value.trim().length === 0) {
        alert('¡Primero ingresa tu nombre!');
        return;
    }
    
    isReady = !isReady;
    
    elements.readyBtn.classList.toggle('active', isReady);
    elements.readyBtn.querySelector('.btn-text').textContent = isReady ? '¡ESPERANDO!' : '¡LISTO!';
    
    if (isBabyShowerMode) {
        // In baby shower mode, show the entered name
        const playerName = elements.babyNameInput.value.trim();
        elements.playerDisplayName.textContent = playerName;
    } else if (selectedCharacter) {
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
    
    // Tournament info (also covers rematches, which restart at round 1)
    if (data.tournamentRounds) tournamentState.totalRounds = data.tournamentRounds;
    if (data.currentRound) tournamentState.currentRound = data.currentRound;
    tournamentState.playerScores = data.playerScores || {};
    updateTournamentHUD();

    // Fresh per-match state: this event also starts tournament rounds and rematches
    resetMatchState();

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

/**
 * Reset everything that belongs to a single match/round so a rematch or the next
 * tournament round starts clean for every mode. Mode-specific UI is rebuilt
 * afterwards by updateControllerUIForMode().
 */
function resetMatchState() {
    // End-of-match screens
    elements.gameOverOverlay.classList.add('hidden');
    elements.gameOverTitle.style.color = '';
    elements.gameOverMessage.style.whiteSpace = '';
    const tournamentOverlay = document.getElementById('tournament-end-overlay');
    if (tournamentOverlay) tournamentOverlay.classList.add('hidden');
    hideRoundEndOverlay();
    setEliminationInfo('game-over-elim', '');
    resetRematchButtons();
    document.querySelectorAll('.race-finish-notification, .flappy-death-notification')
        .forEach(el => el.remove());

    // Inputs: joystick, held buttons, block
    resetJoystick();
    Object.keys(inputState).forEach(key => inputState[key] = false);
    document.querySelectorAll('#controller-screen .pressed').forEach(el => el.classList.remove('pressed'));

    // Arena grab / wrestling state (carry, tie-up, move, down, pin, mash screen, HUD)
    clearArenaWrestling();

    // Race
    lastRaceTap = null;
    updateRaceSpeed(0);
    resetRaceHurdleUI();

    // Flappy
    flappyAlive = true;
    const distEl = document.getElementById('flappy-distance');
    if (distEl) distEl.textContent = '0m';

    // Tug of War
    tugStamina = 100;
    const tugFill = document.getElementById('tug-stamina-fill');
    if (tugFill) {
        tugFill.style.width = '100%';
        tugFill.style.background = '';
    }
    resetTugRhythmUI();

    // Balloon (buttons/label/air bar are rebuilt in setupBalloonControls)
    sendBalloonBlow(false);
    balloonProgress = 0;
    balloonTied = false;
    balloonTension = 0;
    balloonLastVibe = 0;

    // Trivia
    document.querySelectorAll('.trivia-btn').forEach(btn => btn.classList.remove('selected', 'pressed'));

    // Tag power-up lines
    resetTagHud();

    // Header: damage / health / penalty / score ("X" when eliminated)
    const initialValue = {
        arena: '100%',
        tag: '0.0s',
        paint: '0.0%'
    }[gameMode] || '0%';
    elements.playerDamage.textContent = initialValue;
    elements.playerDamage.style.color = '';
    updateStocks(3);
}

function updateControllerUIForMode() {
    const healthLabel = document.querySelector('.health-label');
    const stocksDisplay = elements.stocksDisplay;
    const grabBtn = document.querySelector('.btn-grab');
    const actionButtons = document.querySelector('.action-buttons');
    const joystickHint = document.getElementById('joystick-hint');
    const controllerBody = document.querySelector('.controller-body');
    const raceControls = document.getElementById('race-controls');
    const flappyControls = document.getElementById('flappy-controls');
    const tugControls = document.getElementById('tug-controls');
    const balloonControls = document.getElementById('balloon-controls');
    const triviaControls = document.getElementById('trivia-controls');
    const puzzleControls = document.getElementById('puzzle-controls');
    const controllerScreen = document.getElementById('controller-screen');
    
    // Start from a neutral layout so switching modes never leaves stale pieces behind
    sendBalloonBlow(false);
    if (raceControls) raceControls.style.display = 'none';
    if (flappyControls) flappyControls.style.display = 'none';
    if (tugControls) tugControls.style.display = 'none';
    if (balloonControls) balloonControls.style.display = 'none';
    if (triviaControls) triviaControls.style.display = 'none';
    if (puzzleControls) puzzleControls.style.display = 'none';
    if (controllerScreen) controllerScreen.classList.remove(...MODE_CLASSES);
    if (actionButtons) actionButtons.style.display = '';
    if (grabBtn) grabBtn.style.display = 'none';
    if (stocksDisplay) stocksDisplay.style.display = 'none';
    if (joystickHint) joystickHint.textContent = '';
    resetSmashShieldUI();
    resetTagHud();
    renderSumoButtons(false);

    if (gameMode === 'sumo') {
        // Sumo: 8-direction joystick + one big EMPUJAR button (hold to charge, release to dash)
        if (controllerBody) controllerBody.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('sumo-mode');
        if (healthLabel) healthLabel.textContent = 'QUEDAN';
        if (joystickHint) joystickHint.textContent = 'MANTÉN EMPUJAR PARA CARGAR';
        renderSumoButtons(true);

        console.log('[Controller] Sumo mode UI configured');
    } else if (gameMode === 'trivia') {
        // Trivia mode
        if (controllerBody) controllerBody.style.display = 'none';
        if (triviaControls) triviaControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('trivia-mode');
        if (healthLabel) healthLabel.textContent = '';
        
        setupTriviaControls();
        console.log('[Controller] Trivia mode UI configured');
    } else if (gameMode === 'word_puzzle') {
        // Word Puzzle mode
        if (controllerBody) controllerBody.style.display = 'none';
        if (puzzleControls) puzzleControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('puzzle-mode');
        if (healthLabel) healthLabel.textContent = '';
        
        setupPuzzleControls();
        console.log('[Controller] Puzzle mode UI configured');
    } else if (gameMode === 'maze') {
        // Maze mode: joystick only (8 directions)
        if (controllerBody) controllerBody.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('maze-mode', 'joystick-only');
        if (actionButtons) actionButtons.style.display = 'none';
        if (healthLabel) healthLabel.textContent = 'EXPLORA';
        
        console.log('[Controller] Maze mode UI configured');
    } else if (gameMode === 'balloon') {
        // Balloon mode
        if (controllerBody) controllerBody.style.display = 'none';
        if (balloonControls) balloonControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('balloon-mode');
        if (healthLabel) healthLabel.textContent = '';
        
        setupBalloonControls();
        console.log('[Controller] Balloon mode UI configured');
    } else if (gameMode === 'tug') {
        // Tug of War mode
        if (controllerBody) controllerBody.style.display = 'none';
        if (tugControls) tugControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('tug-mode');
        if (healthLabel) healthLabel.textContent = '';
        
        setupTugControls();
        startTugRhythmAnimation();
        
        console.log('[Controller] Tug mode UI configured');
    } else if (gameMode === 'flappy') {
        // Flappy mode: Show single TAP button
        if (controllerBody) controllerBody.style.display = 'none';
        if (flappyControls) flappyControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('flappy-mode');
        if (healthLabel) healthLabel.textContent = '';
        
        // Setup flappy tap button
        setupFlappyControls();
        
        console.log('[Controller] Flappy mode UI configured');
    } else if (gameMode === 'race') {
        // Race mode: Show only left/right foot buttons
        const isBabyShower = document.body.classList.contains('baby-theme');
        const raceLabel = document.querySelector('.race-label');
        if (raceLabel) {
            raceLabel.textContent = isBabyShower ? '¡GATEA! 👶' : '¡CORRE! 🏃';
        }

        if (controllerBody) controllerBody.style.display = 'none';
        if (raceControls) raceControls.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('race-mode');
        if (healthLabel) healthLabel.textContent = '';
        
        // Setup race foot buttons
        setupRaceControls();
        
        console.log('[Controller] Race mode UI configured');
    } else if (gameMode === 'tag') {
        // Tag mode: joystick only (8 directions), no action buttons
        if (controllerBody) controllerBody.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('joystick-only');
        if (actionButtons) actionButtons.style.display = 'none';
        if (healthLabel) healthLabel.textContent = 'TIEMPO';
        
        console.log('[Controller] Tag mode UI configured');
    } else if (gameMode === 'paint') {
        // Paint mode: joystick only (8 directions)
        if (controllerBody) controllerBody.style.display = 'flex';
        if (controllerScreen) controllerScreen.classList.add('paint-mode', 'joystick-only');
        if (actionButtons) actionButtons.style.display = 'none';
        if (healthLabel) healthLabel.textContent = 'PINTA!';
        
        console.log('[Controller] Paint mode UI configured');
    } else if (gameMode === 'arena') {
        // Arena mode: joystick moves in 8 directions, push it all the way to run
        if (controllerBody) controllerBody.style.display = 'flex';
        if (grabBtn) grabBtn.style.display = 'flex';
        if (healthLabel) healthLabel.textContent = 'VIDA';
        if (joystickHint) joystickHint.textContent = 'A FONDO = CORRER';
        
        console.log('[Controller] Arena mode UI configured');
    } else {
        // Smash mode: joystick left/right moves, up jumps, all the way sideways runs
        if (controllerBody) controllerBody.style.display = 'flex';
        if (healthLabel) healthLabel.textContent = 'DAÑO';
        if (stocksDisplay) stocksDisplay.style.display = 'flex';
        if (joystickHint) joystickHint.textContent = '↑ SALTA (×2 EN EL AIRE) · DIRECCIÓN + GOLPE = MOVIMIENTO';
        renderSmashShield(100, false, false);

        console.log('[Controller] Smash mode UI configured');
    }

    // Spirit meter only in Arena; BURLA back to its normal look everywhere else
    renderSpiritUI(true);
    // "QUEDAN N" only in an Arena battle royal
    renderRoyalCounter(true);
}

// Setup race mode controls (left/right foot buttons and the jump button)
function setupRaceControls() {
    // Replace the buttons so listeners are not stacked on every round/rematch
    // (stacked listeners sent each tap several times)
    ['left-foot', 'right-foot', 'race-jump-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            const fresh = btn.cloneNode(true);
            fresh.classList.remove('pressed', 'pulse', 'ready', 'jumping');
            btn.replaceWith(fresh);
        }
    });
    const leftFoot = document.getElementById('left-foot');
    const rightFoot = document.getElementById('right-foot');
    const jumpBtn = document.getElementById('race-jump-btn');
    resetRaceHurdleUI();

    if (jumpBtn) {
        jumpBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleRaceJump(jumpBtn);
        }, { passive: false });

        jumpBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            jumpBtn.classList.remove('pressed');
        }, { passive: false });
    }

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

// Handle a jump press: the server only counts it 1.5-5 m before a hurdle (too early costs nothing)
function handleRaceJump(btn) {
    btn.classList.add('pressed');

    if (socket && socket.connected) {
        socket.emit('race-jump');
    }

    triggerHaptic();
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
/**
 * Setup trivia mode controls
 */
function setupTriviaControls() {
    const triviaButtons = document.querySelectorAll('.trivia-btn');
    triviaButtons.forEach(btn => {
        // Remove existing listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            newBtn.classList.add('pressed');
            const answer = newBtn.dataset.answer;
            if (socket) {
                socket.emit('trivia-answer', answer);
                // Visual feedback (query the live buttons: the originals were replaced)
                document.querySelectorAll('.trivia-btn').forEach(b => b.classList.remove('selected'));
                newBtn.classList.add('selected');
            }
        }, { passive: false });

        newBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            newBtn.classList.remove('pressed');
        }, { passive: false });
    });
}

/**
 * Setup puzzle mode controls
 */
function setupPuzzleControls() {
    const input = elements.puzzleInput;
    const sendBtn = elements.puzzleSendBtn;
    
    if (!input || !sendBtn) return;

    // Clear input
    input.value = '';

    // Remove existing listener for sendBtn
    const newSendBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);

    const sendGuess = () => {
        const guess = input.value.trim();
        if (guess && socket) {
            socket.emit('puzzle-guess', guess);
            input.value = ''; // Clear after send
            input.blur();
        }
    };

    // Use click for better reliability with inputs
    newSendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sendGuess();
    });

    // Also support Enter key (replace the previous round's handler instead of stacking)
    if (puzzleEnterHandler) input.removeEventListener('keyup', puzzleEnterHandler);
    puzzleEnterHandler = (e) => {
        if (e.key === 'Enter') {
            sendGuess();
        }
    };
    input.addEventListener('keyup', puzzleEnterHandler);
}

let puzzleEnterHandler = null;

function setupBalloonControls() {
    const inflateBtn = document.getElementById('balloon-inflate-btn');
    const tieBtn = document.getElementById('balloon-tie-btn');
    const fill = document.getElementById('balloon-progress-fill');
    const label = document.querySelector('.balloon-label');
    const progressContainer = document.querySelector('.balloon-progress-container');
    const lungFill = document.getElementById('balloon-lung-fill');
    const lungValue = document.getElementById('balloon-lung-value');

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
    if (lungFill) {
        lungFill.style.width = '100%';
        lungFill.classList.remove('low', 'empty');
    }
    if (lungValue) lungValue.textContent = '100%';
    if (label) {
        label.textContent = 'Sopla con calma…';
        label.style.color = 'white';
    }
    balloonProgress = 0;
    balloonTied = false;
    balloonTension = 0;
    balloonLastVibe = 0;
    sendBalloonBlow(false);

    if (inflateBtn) {
        // Remove old listeners
        inflateBtn.replaceWith(inflateBtn.cloneNode(true));
        const newInflateBtn = document.getElementById('balloon-inflate-btn');

        // Reset button state
        newInflateBtn.disabled = false;
        newInflateBtn.style.opacity = '';
        newInflateBtn.style.setProperty('--shake', 0);
        newInflateBtn.classList.remove('pressed', 'pulse', 'shaking', 'tense', 'danger');
        const btnText = newInflateBtn.querySelector('.balloon-text');
        if (btnText) btnText.textContent = 'SOPLA';
        const btnSub = newInflateBtn.querySelector('.balloon-subtext');
        if (btnSub) btnSub.textContent = '(mantén)';

        // Hold to blow: true on press, false on every way the press can end
        const startBlow = (e) => {
            if (e) e.preventDefault();
            if (gameMode !== 'balloon') return;
            if (newInflateBtn.disabled || balloonTied) return; // popped or banked

            newInflateBtn.classList.add('pressed');
            sendBalloonBlow(true);
            triggerHaptic();
        };
        const stopBlow = (e) => {
            if (e && e.cancelable) e.preventDefault();
            newInflateBtn.classList.remove('pressed');
            sendBalloonBlow(false);
        };

        newInflateBtn.addEventListener('touchstart', startBlow, { passive: false });
        newInflateBtn.addEventListener('touchend', stopBlow, { passive: false });
        newInflateBtn.addEventListener('touchcancel', stopBlow, { passive: false });
        newInflateBtn.addEventListener('mousedown', startBlow);
        newInflateBtn.addEventListener('mouseup', stopBlow);
        newInflateBtn.addEventListener('mouseleave', stopBlow);
    }

    if (tieBtn) {
        tieBtn.replaceWith(tieBtn.cloneNode(true));
        const newTieBtn = document.getElementById('balloon-tie-btn');
        newTieBtn.disabled = false;
        newTieBtn.classList.remove('pressed', 'tied');
        newTieBtn.textContent = '🎀 AMARRAR';

        // Bank the current size: sent once, then both buttons are done for this match
        const handleTie = (e) => {
            if (e) e.preventDefault();
            if (gameMode !== 'balloon') return;
            if (newTieBtn.disabled || balloonTied) return;

            newTieBtn.classList.add('pressed');
            if (socket && socket.connected) {
                socket.emit('balloon-tie');
            }
            showBalloonTied();
            triggerHaptic(true);
        };

        newTieBtn.addEventListener('touchstart', handleTie, { passive: false });
        newTieBtn.addEventListener('mousedown', handleTie);
    }

    // Releasing the finger outside the button (slid off) must also stop the blow
    document.addEventListener('touchend', stopBalloonBlowIfNeeded, { passive: true });
    document.addEventListener('touchcancel', stopBalloonBlowIfNeeded, { passive: true });

    console.log('[Balloon] Controls setup complete');
}

function stopBalloonBlowIfNeeded() {
    if (!balloonBlowing) return;
    const btn = document.getElementById('balloon-inflate-btn');
    if (btn) btn.classList.remove('pressed');
    sendBalloonBlow(false);
}

// Client-side rhythm animation for the Tug of War bar
let tugRhythmRunning = false;

function startTugRhythmAnimation() {
    const cursor = document.getElementById('rhythm-bar-cursor');
    if (!cursor) return;
    if (tugRhythmRunning) return; // One loop is enough (game-started fires every round)
    tugRhythmRunning = true;

    const container = document.getElementById('rhythm-bar-container');
    let flashing = false;

    const animate = () => {
        if (gameMode !== 'tug') {
            tugRhythmRunning = false;
            if (container) container.classList.remove('beat');
            return;
        }

        const now = Date.now();
        if (tugNextPulse > 0) {
            // Server time, so the pulse lands exactly at 50% of the bar (the green zone center)
            const serverNow = now + tugClockOffset;
            const interval = tugPulseInterval;
            const progress = ((((serverNow - tugNextPulse + interval / 2) % interval) + interval) % interval) / interval;
            cursor.style.left = `${progress * 100}%`;
        }

        // Beat flash (class only toggled on change)
        const shouldFlash = now < tugBeatFlashUntil;
        if (container && shouldFlash !== flashing) {
            flashing = shouldFlash;
            container.classList.toggle('beat', flashing);
        }

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

            // Shield level on the BLOQUEO button
            if (typeof myState.shield === 'number') {
                renderSmashShield(myState.shield, myState.shieldStunned === true, myState.isBlocking === true);
            }
        }
    }
}

// =================================
// Smash: shield on the BLOQUEO button
// =================================

let smashShieldLast = -1;

/**
 * Plain BLOQUEO button (other modes have no shield meter)
 */
function resetSmashShieldUI() {
    const btn = document.querySelector('.action-btn[data-input="block"]');
    if (!btn) return;
    smashShieldLast = -1;
    btn.style.removeProperty('--shield');
    btn.style.removeProperty('--shield-color');
    btn.classList.remove('shield-broken', 'shield-low');
    const label = btn.querySelector('.btn-action');
    if (label) label.textContent = 'BLOQUEO';
}

/**
 * Fill the BLOQUEO button with the shield level (blue -> red) and mark it when broken
 */
function renderSmashShield(shield, stunned, blocking) {
    const btn = document.querySelector('.action-btn[data-input="block"]');
    if (!btn) return;
    const value = Math.max(0, Math.min(100, Math.round(shield)));
    const label = btn.querySelector('.btn-action');
    if (value !== smashShieldLast) {
        smashShieldLast = value;
        btn.style.setProperty('--shield', `${value}%`);
        btn.style.setProperty('--shield-color', `hsl(${Math.round(200 * value / 100)}, 100%, 55%)`);
    }
    btn.classList.toggle('shield-broken', stunned);
    btn.classList.toggle('shield-low', !stunned && value < 25);
    if (label) label.textContent = stunned ? 'ROTO' : 'BLOQUEO';
}

/**
 * One-off Smash events from the server (shield breaks)
 */
function handleSmashEvent(event) {
    if (!event || !socket) return;
    const mine = event.playerId === socket.id;
    if (event.type === 'shield-break' && mine) {
        vibrate([60, 40, 60, 40, 120]);
        renderSmashShield(0, true, false);
        // The server already dropped the guard: release the local flag too
        inputState.block = false;
        document.querySelector('.action-btn[data-input="block"]')?.classList.remove('pressed');
    } else if (event.type === 'item-pickup' && mine) {
        if (event.kind === 'bomba') {
            vibrate([120, 60, 120, 60, 200]);
            showTagNotification('💣 ¡CORRE! 2.5 s', '#ff3366');
        } else {
            vibrate([30, 30, 30]);
            showTagNotification('🏏 ¡BATE! 3 golpes', '#ffcc00');
        }
    } else if (event.type === 'item-heal' && mine) {
        vibrate(40);
        showTagNotification(`🍗 -${event.healed}% daño`, '#33cc66');
    } else if (event.type === 'item-explode' && Array.isArray(event.hits) && event.hits.some(h => h.targetId === socket.id)) {
        vibrate(HIT_VIBRATION.hit);
    } else if (event.type === 'item-break' && mine) {
        vibrate(20);
    }
}

// Handle Arena-specific state updates
function handleArenaState(data) {
    if (!data || !Array.isArray(data.players) || !socket) return;
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
        
        // Carry flags come from the server every tick: this self-heals any missed event
        // (auto-release, throw, escape, reconnection)
        isGrabbing = !!myState.isGrabbing && !myState.isEliminated;
        isGrabbed = !!myState.isGrabbed && !myState.isEliminated;

        // Spirit meter, SPECIAL countdown, taunt and BURLA / ¡REMATE! button
        syncSpiritFromState(myState, data.players);

        // Irish whip, rope running, running-strike hints and the battle royal counter
        syncRopesFromState(myState, data.players);

        // Tie-up / grapple move / down / pin / carry escape, plus CUBRIR proximity
        syncWrestleFromState(myState, data.players);
    }
}

/**
 * Handle when someone grabs (server broadcast). With the wrestling update this is only
 * sent for the carry (lifting the opponent out of a tie-up).
 */
function handleArenaGrabEvent(data) {
    if (!data || !socket) return;
    if (data.mode && data.mode !== 'carry') return;
    // If we are the grabber, update our state (button becomes LANZAR)
    if (data.grabberId === socket.id) {
        isGrabbing = true;
        wrestle.tieRole = null;
        vibrate(WRESTLE_VIBRATION.lift);
        renderWrestleUI();
    }
    // If we are the target (being carried), open the mash screen
    if (data.targetId === socket.id) {
        isGrabbed = true;
        wrestle.tieRole = null;
        setMash({ mode: 'carry', taps: 0 });
        vibrate(WRESTLE_VIBRATION.carried);
        renderWrestleUI();
    }
}

/**
 * Handle when someone is thrown (server broadcast)
 */
function handleArenaThrowEvent(data) {
    if (!data || !socket) return;
    // If we were grabbing, we're no longer grabbing
    if (data.grabberId === socket.id) {
        isGrabbing = false;
        triggerHaptic();
        renderWrestleUI();
    }
    // If we were thrown, close the mash screen and vibrate (long pattern)
    if (data.targetId === socket.id) {
        isGrabbed = false;
        if (mash.mode === 'carry') setMash(null);
        vibrate(HIT_VIBRATION.thrown);
        renderWrestleUI();
    }
}

/**
 * Handle when grab is released without throw
 */
function handleArenaGrabReleased(data) {
    if (!data || !socket) return;
    if (data.grabberId === socket.id) {
        isGrabbing = false;
        renderWrestleUI();
    }
    if (data.targetId === socket.id) {
        isGrabbed = false;
        if (mash.mode === 'carry') setMash(null);
        renderWrestleUI();
    }
}

/**
 * Handle when someone escapes from a carry (server broadcast)
 */
function handleArenaGrabEscapeEvent(data) {
    if (!data || !socket) return;
    // If we were the one who escaped (the escape callback may have handled it already)
    if (data.targetId === socket.id) {
        isGrabbed = false;
        if (mash.mode === 'carry') {
            setMash(null);
            vibrate(WRESTLE_VIBRATION.escaped);
            flashHud('¡LIBRE!', 'Te soltaste', 'good');
        }
        renderWrestleUI();
    }
    // If we were the grabber and they escaped
    if (data.grabberId === socket.id) {
        isGrabbing = false;
        triggerHaptic(true); // Strong vibration - they escaped!
        flashHud('¡SE ESCAPÓ!', '', 'danger');
        renderWrestleUI();
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

    // Arena: who eliminated me / my place (read it before the reset below forgets it)
    const isArenaWinner = !!(data && data.winner && socket && data.winner.id === socket.id);
    const elimText = gameMode === 'arena' && !isArenaWinner ? describeMyElimination(true) : '';

    // No mash screen / wrestling HUD left behind the end-of-match screen
    clearArenaWrestling();
    setEliminationInfo('game-over-elim', elimText);
    // Balloon: a finger still on the blow button must not keep "blowing" into the next match
    sendBalloonBlow(false);

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

// =================================
// Analog Joystick (replaces the 4-button D-Pad)
// =================================

const JOYSTICK = {
    DEAD_ZONE: 0.25,      // Fraction of the radius ignored around the center
    JUMP_THRESHOLD: 0.5,  // Smash: push up past half the radius to jump
    RUN_THRESHOLD: 0.85,  // Smash (horizontal) / Arena (any direction): run near the edge
    TRAVEL: 0.72          // Knob travel radius as a fraction of the base radius
};

// inputState fields driven by the joystick (block and attacks belong to the buttons)
const JOYSTICK_FIELDS = ['left', 'right', 'up', 'down', 'jump', 'run'];

const joystick = {
    zone: null,
    base: null,
    knob: null,
    arrows: {},
    pointerId: null, // Pointer id (Pointer Events) or touch identifier (touch fallback)
    centerX: 0,
    centerY: 0,
    radius: 1,
    engaged: false   // Outside the dead zone
};

/**
 * How the stick maps to inputs in the current mode
 *  - smash: left/right, up = jump, far sideways = run
 *  - arena: 8-way + run near the edge
 *  - eight: 8-way only (tag, paint, maze)
 */
function getJoystickProfile() {
    if (gameMode === 'arena') return 'arena';
    if (gameMode === 'tag' || gameMode === 'paint' || gameMode === 'maze' || gameMode === 'sumo') return 'eight';
    return 'smash';
}

function findTouch(touchList, id) {
    for (let i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === id) return touchList[i];
    }
    return null;
}

function setupJoystick() {
    joystick.zone = document.getElementById('joystick-zone');
    joystick.base = document.getElementById('joystick-base');
    joystick.knob = document.getElementById('joystick-knob');
    if (!joystick.zone || !joystick.base || !joystick.knob) return;

    ['up', 'down', 'left', 'right'].forEach(dir => {
        joystick.arrows[dir] = joystick.zone.querySelector(`.joy-${dir}`);
    });

    const zone = joystick.zone;

    if (window.PointerEvent) {
        // Pointer Events: each finger has its own pointerId, so the stick and the
        // action buttons work at the same time (multi-touch)
        zone.addEventListener('pointerdown', (e) => {
            if (joystick.pointerId !== null) return; // Already driven by another finger
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            joystick.pointerId = e.pointerId;
            try { zone.setPointerCapture(e.pointerId); } catch (err) { /* keep going without capture */ }
            joystickStart(e.clientX, e.clientY);
        });

        zone.addEventListener('pointermove', (e) => {
            if (e.pointerId !== joystick.pointerId) return;
            e.preventDefault();
            joystickMove(e.clientX, e.clientY);
        });

        const endPointer = (e) => {
            if (e.pointerId !== joystick.pointerId) return;
            joystickEnd();
        };
        zone.addEventListener('pointerup', endPointer);
        zone.addEventListener('pointercancel', endPointer);
        zone.addEventListener('lostpointercapture', endPointer);
        // With capture the thumb may slide outside the zone and keep steering;
        // without capture, leaving the zone lets go of the stick.
        zone.addEventListener('pointerleave', (e) => {
            if (e.pointerId !== joystick.pointerId) return;
            if (zone.hasPointerCapture && zone.hasPointerCapture(e.pointerId)) return;
            joystickEnd();
        });
    } else {
        // Touch fallback for browsers without Pointer Events: follow our own touch identifier
        zone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (joystick.pointerId !== null) return;
            const touch = e.changedTouches[0];
            joystick.pointerId = touch.identifier;
            joystickStart(touch.clientX, touch.clientY);
        }, { passive: false });

        zone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = findTouch(e.changedTouches, joystick.pointerId);
            if (touch) joystickMove(touch.clientX, touch.clientY);
        }, { passive: false });

        const endTouch = (e) => {
            e.preventDefault();
            if (findTouch(e.changedTouches, joystick.pointerId)) joystickEnd();
        };
        zone.addEventListener('touchend', endTouch, { passive: false });
        zone.addEventListener('touchcancel', endTouch, { passive: false });
    }

    // Let go if the page loses focus mid-press (screen lock, app switch, notification)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) joystickEnd();
    });
    window.addEventListener('blur', () => joystickEnd());
}

function joystickStart(x, y) {
    const rect = joystick.base.getBoundingClientRect();
    joystick.centerX = rect.left + rect.width / 2;
    joystick.centerY = rect.top + rect.height / 2;
    joystick.radius = Math.max(20, (rect.width / 2) * JOYSTICK.TRAVEL);
    joystick.zone.classList.add('active');
    joystickMove(x, y);
}

function joystickMove(x, y) {
    let dx = x - joystick.centerX;
    let dy = y - joystick.centerY;
    const max = joystick.radius;
    const dist = Math.hypot(dx, dy);

    // Clamp the knob to the travel radius
    if (dist > max) {
        dx = (dx / dist) * max;
        dy = (dy / dist) * max;
    }

    joystick.knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    applyJoystickVector(dx / max, dy / max);
}

/**
 * Release the stick: knob springs back and every direction is cleared.
 * @param {boolean} send - send the cleared input to the server if it changed
 */
function joystickEnd(send = true) {
    const pointerId = joystick.pointerId;
    joystick.pointerId = null; // Clear first: releasing capture fires 'lostpointercapture'

    if (joystick.zone && pointerId !== null && joystick.zone.hasPointerCapture &&
        joystick.zone.hasPointerCapture(pointerId)) {
        try { joystick.zone.releasePointerCapture(pointerId); } catch (err) { /* ignore */ }
    }

    if (joystick.zone) joystick.zone.classList.remove('active', 'running');
    if (joystick.knob) joystick.knob.style.transform = 'translate3d(0, 0, 0)';

    setJoystickInputs({ left: false, right: false, up: false, down: false, jump: false, run: false }, false, send);
}

/**
 * Reset the stick for a new match without emitting anything
 */
function resetJoystick() {
    joystickEnd(false);
}

/**
 * Turn a normalized stick vector (x right, y down, length <= 1) into inputState booleans
 */
function applyJoystickVector(nx, ny) {
    const magnitude = Math.min(1, Math.hypot(nx, ny));
    const next = { left: false, right: false, up: false, down: false, jump: false, run: false };
    const engaged = magnitude >= JOYSTICK.DEAD_ZONE;

    if (engaged) {
        // 8 sectors of 45 degrees: 0 = right, 2 = up, 4 = left, 6 = down (diagonals set two)
        const angle = Math.atan2(-ny, nx);
        const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
        const dirRight = sector === 7 || sector === 0 || sector === 1;
        const dirUp = sector >= 1 && sector <= 3;
        const dirLeft = sector >= 3 && sector <= 5;
        const dirDown = sector >= 5 && sector <= 7;
        const profile = getJoystickProfile();

        if (profile === 'smash') {
            // Smash server reads left/right, jump and run (up/down stay false like the old D-pad)
            next.left = dirLeft;
            next.right = dirRight;
            next.jump = dirUp && -ny >= JOYSTICK.JUMP_THRESHOLD;
            // Stick down + GOLPE/PATADA = barrida (en el piso) o meteoro (en el aire)
            next.down = dirDown && ny >= JOYSTICK.JUMP_THRESHOLD;
            next.run = (dirLeft || dirRight) && Math.abs(nx) >= JOYSTICK.RUN_THRESHOLD;
        } else {
            next.left = dirLeft;
            next.right = dirRight;
            next.up = dirUp;
            next.down = dirDown;
            if (profile === 'arena') {
                next.run = magnitude >= JOYSTICK.RUN_THRESHOLD;
            }
        }
    }

    setJoystickInputs(next, engaged, true);
}

function setJoystickInputs(next, engaged, send) {
    let changed = false;
    JOYSTICK_FIELDS.forEach(key => {
        if (inputState[key] !== next[key]) {
            if (key === 'jump' && next.jump) vibrate(12);
            inputState[key] = next[key];
            changed = true;
        }
    });

    // Visual feedback on the base
    if (joystick.arrows.up) joystick.arrows.up.classList.toggle('on', next.up || next.jump);
    if (joystick.arrows.down) joystick.arrows.down.classList.toggle('on', next.down);
    if (joystick.arrows.left) joystick.arrows.left.classList.toggle('on', next.left);
    if (joystick.arrows.right) joystick.arrows.right.classList.toggle('on', next.right);
    if (joystick.zone) joystick.zone.classList.toggle('running', next.run);

    // Light tick when the stick leaves the dead zone
    if (engaged && !joystick.engaged) vibrate(8);
    joystick.engaged = engaged;

    // Same 'player-input' payload as before, only when something changed
    if (changed && send) sendInput();
}

function setupControllerInput() {
    // Movement: analog joystick (smash, arena, tag, paint, maze)
    setupJoystick();

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
            if (action === 'punch') sumoShove(); // Sumo: release = dash (no-op elsewhere)
        }, { passive: false });
        btn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            btn.classList.remove('pressed');
            if (action === 'punch') sumoShove();
        }, { passive: false });

        // Mouse events
        btn.addEventListener('mousedown', () => handleAction(action, btn));
        btn.addEventListener('mouseup', () => { btn.classList.remove('pressed'); if (action === 'punch') sumoShove(); });
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

    // Arena mash screen (tie-up defender / pinned / carried)
    setupMashInput();
}

function handleAction(action, btn) {
    // Arena: on the mat, getting up, in a grapple move, pinning or held -> the server
    // ignores actions, so the (dimmed) buttons do nothing
    if (gameMode === 'arena' && wrestle.locked) return;

    btn.classList.add('pressed');

    // While reconnecting, socket.io would buffer these and replay stale attacks later
    if (!socket || !socket.connected) return;

    // Sumo: pressing starts the charge; the release (touchend) sends the shove
    if (gameMode === 'sumo') {
        if (action === 'punch') sumoChargeStart();
        return;
    }

    // Handle actions based on game mode
    if (gameMode === 'arena') {
        // Arena mode events
        if (action === 'taunt') {
            // While SPECIAL the BURLA button is ¡REMATE! (signature finisher)
            if (spirit.isSpecial && !spirit.eliminated) {
                requestFinisher();
            } else {
                socket.emit('player-taunt');
            }
        } else if (action === 'grab') {
            // isGrabbing is refreshed from 'arena-state' every tick (me.isGrabbing)
            console.log(`[Arena] Grab button pressed. mode=${grabButtonMode} isGrabbing=${isGrabbing}`);
            if (isGrabbing) {
                // If already grabbing, try to throw
                // Calculate throw direction from current input
                // Must match the server's facing convention: atan2(dirX, dirZ), where "up" is -Z
                let direction = null;
                if (inputState.left) direction = -Math.PI / 2;
                else if (inputState.right) direction = Math.PI / 2;
                else if (inputState.up) direction = Math.PI;
                else if (inputState.down) direction = 0;
                
                console.log(`[Arena] Throwing with direction=${direction}`);
                socket.emit('arena-throw', direction, (response) => {
                    console.log('[Arena Throw] Response:', response);
                    if (response && response.success) {
                        isGrabbing = false;
                        renderWrestleUI();
                        console.log('[Arena] Throw success, button reset to AGARRAR');
                    }
                });
            } else {
                // AGARRAR = tie-up, CUBRIR = pin a downed rival, CARGAR = lift from the tie-up,
                // CARGAR + stick = Irish whip into the ropes.
                // The server picks which one; tie-up/pin UI arrives with its events and state.
                socket.emit('arena-grab', (response) => {
                    console.log('[Arena Grab] Response:', response);
                    if (!response || !response.success) return;
                    const mode = response.grabInfo && response.grabInfo.mode;
                    if (mode === 'whip') {
                        // The tie-up is over: the rival is running into the ropes
                        onWhipSent();
                    } else if (mode === 'carry' || !mode) {
                        // Carrying: button becomes LANZAR right away
                        isGrabbing = true;
                        wrestle.tieRole = null;
                        renderWrestleUI();
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
    socket.emit('player-input', { ...inputState, [action]: true });

    // Reset action flag after brief moment. Build it from the CURRENT inputState:
    // re-sending the 100 ms old snapshot kept the player moving if a direction was
    // released in the meantime.
    setTimeout(() => {
        if (socket && socket.connected) {
            socket.emit('player-input', { ...inputState, [action]: false });
        }
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
    vibrate(strong ? [50, 30, 50] : 10);
}

// =================================
// Arena wrestling: tie-ups, grapple moves, downs, pins and carries
// =================================
// The phone mirrors MY entry in 'arena-state' (~60 Hz), so the UI always heals itself
// (missed events, reconnection). The one-shot events only make it react right away and
// drive the haptics; every haptic fires on a state CHANGE, so event + state never double up.

const GRAPPLE_MOVE_NAMES = {
    headbutt: '¡CABEZAZO!',
    slam: '¡AZOTÓN!',
    knee: '¡RODILLAZO!',
    suplex: '¡SUPLEX!'
};
const HEAVY_GRAPPLE_MOVES = ['slam', 'suplex'];

const WRESTLE = {
    TIEUP_MS: 2500,             // Server TIEUP_DURATION (the 'arena-tieup' event sends the real value)
    TIEUP_ESCAPE_TAPS: 5,       // Server defaults, replaced by the callback / state values
    CARRY_ESCAPE_TAPS: 6,
    PIN_RANGE: 1.7,             // Server PIN_RANGE: AGARRAR becomes CUBRIR within this distance
    TAP_DEBOUNCE_MS: 40,        // The same physical tap reported twice
    PENDING_TIMEOUT_MS: 1000,   // Unacked taps stop counting after this
    FLASH_MS: 1300              // Short HUD messages (escaped, pinfall...)
};

const WRESTLE_VIBRATION = {
    tieUpAttacker: 30,
    tieUpDefender: [40, 30, 40],
    lift: [50, 30, 50],
    carried: [60, 30, 90],
    moveStart: 20,
    impactHeavy: [150, 50, 230],  // Slam / suplex received
    impactLight: [70, 35, 70],    // Headbutt / knee received
    impactDealt: 25,
    pinStart: [50, 30, 50],
    pinCount: 70,
    pinThree: [200, 60, 300],
    pinCountPinner: 15,
    pinWin: [40, 30, 40, 30, 120],
    escaped: [25, 20, 60],
    partnerEscaped: [50, 30, 50],
    getUp: 15,
    mashTap: 8
};

const MASH_SCREENS = {
    tieup: { title: '¡ZÁFATE!', sub: '¡Toca rápido para soltarte del amarre!', icon: '💪', button: '¡ZÁFATE!' },
    pin: { title: '¡PATEA PARA SALIR!', sub: '¡Toca rápido antes de la cuenta de 3!', icon: '🦵', button: '¡PATEA!' },
    carry: { title: '¡ESCÁPATE!', sub: '¡Toca rápido para soltarte!', icon: '🤸', button: '¡ESCAPA!' }
};

const GRAB_BUTTON_MODES = {
    grab: { label: 'AGARRAR', className: '' },
    cover: { label: 'CUBRIR', className: 'mode-cover' },
    lift: { label: 'CARGAR', className: 'mode-lift' },
    throw: { label: 'LANZAR', className: 'grabbing' }
};

// MY wrestling situation (mirrors my 'arena-state' entry; events update it a frame early)
const wrestle = {
    tieRole: null,          // 'attacker' | 'defender' | null
    tieMsLeft: 0,
    tieDuration: WRESTLE.TIEUP_MS,
    pinRole: null,          // 'pinner' | 'pinned' | null
    pinCount: 0,
    moveType: null,         // 'headbutt' | 'slam' | 'knee' | 'suplex' | null
    moveRole: null,         // 'attacker' | 'defender' | null
    moveName: '',           // Finisher name while moveType === 'finisher'
    isDown: false,
    isGettingUp: false,
    eliminated: false,
    coverAvailable: false,  // A downed rival within PIN_RANGE (AGARRAR -> CUBRIR)
    locked: false,          // Actions are ignored by the server right now
    flash: null,            // { id, title, sub, tone } short message after an escape / pinfall
    flashTimer: null,
    hudKey: ''
};

// Mash screen (tie-up defender / pinned / carried): exactly one 'arena-escape' per tap
const mash = {
    mode: null,             // 'tieup' | 'pin' | 'carry' | null
    taps: 0,                // Confirmed by the server (callback or state)
    needed: 0,
    pending: 0,             // Sent but not acked yet (shown optimistically)
    lastEmitAt: 0,
    lastTapAt: 0,
    count: 0                // Referee count while pinned
};

let grabButtonMode = 'grab';
let flashSeq = 0;
const wrestleEls = {};

function wEl(id) {
    if (!wrestleEls[id]) wrestleEls[id] = document.getElementById(id);
    return wrestleEls[id];
}

function isMe(id) {
    return !!socket && !!id && id === socket.id;
}

// ---------- Model setters (haptics only on real changes) ----------

/** @returns {boolean} whether the role changed */
function setTieRole(role) {
    if (wrestle.tieRole === role) return false;
    wrestle.tieRole = role;
    if (role === 'attacker') vibrate(WRESTLE_VIBRATION.tieUpAttacker);
    else if (role === 'defender') vibrate(WRESTLE_VIBRATION.tieUpDefender);
    else wrestle.tieMsLeft = 0;
    return true;
}

function setPinRole(role) {
    if (wrestle.pinRole === role) return;
    wrestle.pinRole = role;
    wrestle.pinCount = 0;
    if (role === 'pinned') vibrate(WRESTLE_VIBRATION.pinStart);
}

function setPinCount(count) {
    if (!wrestle.pinRole || !(count > wrestle.pinCount)) return;
    wrestle.pinCount = count;
    if (wrestle.pinRole === 'pinned') {
        vibrate(count >= 3 ? WRESTLE_VIBRATION.pinThree : WRESTLE_VIBRATION.pinCount);
    } else {
        vibrate(WRESTLE_VIBRATION.pinCountPinner);
    }
}

/**
 * Open / update / close the mash screen. Taps only grow within one screen (a state frame
 * can lag one tap behind the callback); switching screens starts from zero.
 */
function setMash(info) {
    if (!info) {
        if (mash.mode) {
            mash.mode = null;
            mash.taps = 0;
            mash.needed = 0;
            mash.pending = 0;
            mash.count = 0;
        }
        return;
    }
    if (info.mode !== mash.mode) {
        mash.mode = info.mode;
        mash.taps = 0;
        mash.pending = 0;
        mash.count = 0;
        mash.needed = info.mode === 'tieup' ? WRESTLE.TIEUP_ESCAPE_TAPS :
            info.mode === 'carry' ? WRESTLE.CARRY_ESCAPE_TAPS : 0;
    }
    const taps = Number(info.taps);
    if (Number.isFinite(taps)) mash.taps = Math.max(mash.taps, taps);
    const needed = Number(info.needed);
    if (Number.isFinite(needed) && needed > 0) mash.needed = needed;
    const count = Number(info.count);
    if (Number.isFinite(count)) mash.count = Math.max(mash.count, count);
}

/** A downed rival I could cover (same filter as the server's findPinTarget) */
function isCoverAvailable(me, players) {
    if (!me || !me.position || me.isEliminated || me.isDown || me.isGettingUp || me.move ||
        me.pin || me.tieUp || me.isGrabbing || me.isGrabbed) return false;
    return players.some(other => other && other.id !== me.id && !other.isEliminated &&
        other.isDown && !other.pin && !other.move && other.position &&
        Math.hypot(other.position.x - me.position.x, other.position.z - me.position.z) <= WRESTLE.PIN_RANGE);
}

/**
 * Mirror my 'arena-state' entry (called every tick)
 */
function syncWrestleFromState(me, players) {
    const out = !!me.isEliminated;
    const tie = !out && me.tieUp ? me.tieUp : null;
    const pin = !out && me.pin ? me.pin : null;
    const move = !out && me.move ? me.move : null;

    wrestle.eliminated = out;

    const tieChanged = setTieRole(tie ? tie.role : null);
    if (tie) {
        wrestle.tieMsLeft = Math.max(0, Number(tie.msLeft) || 0);
        // Joined mid tie-up (no event seen, e.g. after a reconnection): size the bar from here
        if (tieChanged || wrestle.tieMsLeft > wrestle.tieDuration) {
            wrestle.tieDuration = Math.max(WRESTLE.TIEUP_MS, wrestle.tieMsLeft);
        }
    }

    setPinRole(pin ? pin.role : null);
    if (pin) setPinCount(Number(pin.count) || 0);

    wrestle.moveName = move && move.type === 'finisher' ? getFinisherMoveName(me, move, players) : '';
    wrestle.moveType = move ? move.type : null;
    wrestle.moveRole = move ? move.role : null;
    wrestle.isDown = !out && !!me.isDown;
    wrestle.isGettingUp = !out && !!me.isGettingUp;
    wrestle.coverAvailable = isCoverAvailable(me, players);

    if (pin && pin.role === 'pinned') {
        setMash({ mode: 'pin', taps: pin.taps, needed: pin.tapsNeeded, count: pin.count });
    } else if (tie && tie.role === 'defender') {
        setMash({ mode: 'tieup', taps: tie.escapeTaps, needed: tie.escapeNeeded });
    } else if (isGrabbed) {
        const carry = me.carryEscape || {};
        setMash({ mode: 'carry', taps: carry.taps, needed: carry.needed });
    } else {
        setMash(null);
    }

    renderWrestleUI();
}

/**
 * Forget every wrestling/grab state and hide its UI (rematch, next round, game over, leave)
 */
function clearArenaWrestling() {
    isGrabbing = false;
    isGrabbed = false;
    if (wrestle.flashTimer) clearTimeout(wrestle.flashTimer);
    Object.assign(wrestle, {
        tieRole: null,
        tieMsLeft: 0,
        tieDuration: WRESTLE.TIEUP_MS,
        pinRole: null,
        pinCount: 0,
        moveType: null,
        moveRole: null,
        moveName: '',
        isDown: false,
        isGettingUp: false,
        eliminated: false,
        coverAvailable: false,
        flash: null,
        flashTimer: null
    });
    setMash(null);
    mash.lastTapAt = 0;
    mash.lastEmitAt = 0;

    // Spirit meter, SPECIAL, ¡REMATE! button and banner
    clearArenaSpirit();

    // Irish whip, rope running, running-strike hints, battle royal counter / elimination
    clearArenaRopes();

    // Leftovers from the old escape overlay (older builds created it on the fly)
    const oldOverlay = document.getElementById('escape-overlay');
    if (oldOverlay) oldOverlay.remove();
    const oldStyles = document.getElementById('escape-styles');
    if (oldStyles) oldStyles.remove();

    renderWrestleUI();
    updateGrabButtonState(true);
}

// ---------- Rendering ----------

function renderWrestleUI() {
    renderMash();
    renderHud();
    renderActionLock();
    updateGrabButtonState();
}

function setPinCountDisplay(container, count) {
    if (!container) return;
    const value = String(count || 0);
    if (container.dataset.count === value) return;
    container.dataset.count = value;
    container.querySelectorAll('.pin-num').forEach(num => {
        num.classList.toggle('on', Number(num.dataset.n) <= count);
    });
}

function renderMash() {
    const overlay = wEl('mash-overlay');
    if (!overlay) return;

    if (!mash.mode) {
        if (!overlay.classList.contains('hidden')) overlay.classList.add('hidden');
        overlay.dataset.mode = '';
        overlay.dataset.progress = '';
        return;
    }

    if (overlay.dataset.mode !== mash.mode) {
        const screen = MASH_SCREENS[mash.mode] || MASH_SCREENS.carry;
        overlay.dataset.mode = mash.mode;
        overlay.dataset.progress = '';
        const set = (id, text) => { const el = wEl(id); if (el) el.textContent = text; };
        set('mash-title', screen.title);
        set('mash-sub', screen.sub);
        set('mash-btn-icon', screen.icon);
        set('mash-btn-text', screen.button);
        const countEl = wEl('mash-count');
        if (countEl) {
            countEl.classList.toggle('hidden', mash.mode !== 'pin');
            countEl.dataset.count = '';
        }
        overlay.classList.remove('hidden');
    }

    // Taps whose ack never came (dropped connection) stop counting after a moment
    if (mash.pending && performance.now() - mash.lastEmitAt > WRESTLE.PENDING_TIMEOUT_MS) {
        mash.pending = 0;
    }

    const needed = mash.needed;
    const raw = mash.taps + mash.pending;
    const shown = needed > 0 ? Math.min(needed, raw) : raw;
    const progressKey = `${shown}/${needed}`;
    if (overlay.dataset.progress !== progressKey) {
        overlay.dataset.progress = progressKey;
        const fill = wEl('mash-fill');
        if (fill) fill.style.transform = `scaleX(${needed > 0 ? shown / needed : 0})`;
        const tapsEl = wEl('mash-taps');
        if (tapsEl) tapsEl.textContent = needed > 0 ? `${shown} / ${needed}` : `${shown}`;
    }

    if (mash.mode === 'pin') setPinCountDisplay(wEl('mash-count'), mash.count);
}

/** What the small HUD above the buttons should say right now (null = hidden) */
function getHudView() {
    if (gameMode !== 'arena') return null;
    if (wrestle.eliminated) return getEliminatedHudView();

    if (wrestle.tieRole === 'attacker') {
        // SPECIAL with a finisher that works from here: add it to the move guide
        const finisher = spirit.isSpecial && canFinishFromTieUp() ? getMyFinisherName() : '';
        return {
            key: `tie:${finisher}`,
            title: finisher ? '¡AMARRE! ¡USA TU REMATE!' : '¡AMARRE! ELIGE TU LLAVE',
            tone: 'warn', guide: true, timer: true, finisher
        };
    }
    if (wrestle.pinRole === 'pinner') {
        return { key: 'pinner', title: 'CONTANDO…', tone: 'danger', count: true };
    }
    if (wrestle.moveType) {
        const attacking = wrestle.moveRole === 'attacker';
        if (wrestle.moveType === 'finisher') {
            return {
                key: `move:finisher:${wrestle.moveRole}:${wrestle.moveName}`,
                title: wrestle.moveName || '¡REMATE!',
                sub: attacking ? '¡Tu remate!' : '¡Te aplican un remate!',
                tone: attacking ? 'good' : 'danger'
            };
        }
        return {
            key: `move:${wrestle.moveType}:${wrestle.moveRole}`,
            title: GRAPPLE_MOVE_NAMES[wrestle.moveType] || '¡LLAVE!',
            sub: attacking ? '¡Lo estás aplicando!' : '¡Te lo están aplicando!',
            tone: attacking ? 'good' : 'danger'
        };
    }
    if (ropes.whipPhase) {
        // Irish whip: I run into the ropes and come back (no control until it ends)
        return {
            key: `whip:${ropes.whipPhase}`,
            title: '¡LATIGAZO!',
            sub: ropes.whipPhase === 'back' ? '¡Rebotas! Cuidado…' : 'Vas a las cuerdas…',
            tone: 'danger'
        };
    }
    if (isGrabbing) {
        return { key: 'carry', title: '¡LO CARGAS!', sub: 'Apunta con 🕹 y pulsa LANZAR', tone: 'warn' };
    }
    if (spirit.isTaunting) {
        return { key: 'taunt', title: '¡PROVOCANDO! +ÁNIMO', sub: '¡Cuidado: quedas expuesto!', tone: 'warn' };
    }
    if (ropes.reboundTarget) {
        // A rival comes back from the ropes right next to me: any strike becomes a running one
        return { key: 'rebound', title: '¡GOLPÉALO AL REBOTAR!', sub: 'GOLPE: Tendedero · PATADA: Dropkick', tone: 'good' };
    }
    if (wrestle.flash) {
        return { key: `flash:${wrestle.flash.id}`, title: wrestle.flash.title, sub: wrestle.flash.sub, tone: wrestle.flash.tone };
    }
    if (wrestle.isGettingUp) {
        return { key: 'getup', title: 'Levantándote…', tone: 'info' };
    }
    if (wrestle.isDown) {
        return { key: 'down', title: '¡EN LA LONA!', sub: 'Espera a levantarte', tone: 'danger' };
    }
    if (wrestle.coverAvailable) {
        return { key: 'cover', title: 'RIVAL EN LA LONA', sub: 'AGARRAR: Cubrir · GOLPE/PATADA: Pisotón', tone: 'good' };
    }
    if (ropes.running) {
        return { key: 'run', title: 'CORRIENDO', sub: 'GOLPE: Tendedero · PATADA: Dropkick', tone: 'info', compact: true };
    }
    return null;
}

function renderHud() {
    const hud = wEl('arena-hud');
    if (!hud) return;

    const view = getHudView();
    const key = view ? view.key : '';
    if (key !== wrestle.hudKey) {
        wrestle.hudKey = key;
        if (!view) {
            hud.classList.add('hidden');
            return;
        }
        const title = wEl('arena-hud-title');
        if (title) title.textContent = view.title;
        const sub = wEl('arena-hud-sub');
        if (sub) sub.textContent = view.sub || '';
        const guide = wEl('arena-hud-guide');
        if (guide) guide.classList.toggle('hidden', !view.guide);
        const guideFinisher = wEl('arena-hud-guide-finisher');
        if (guideFinisher) guideFinisher.classList.toggle('hidden', !view.finisher);
        const guideFinisherName = wEl('arena-hud-guide-finisher-name');
        if (guideFinisherName) guideFinisherName.textContent = view.finisher || '';
        const count = wEl('arena-hud-count');
        if (count) {
            count.classList.toggle('hidden', !view.count);
            count.dataset.count = '';
        }
        const timer = wEl('arena-hud-timer');
        if (timer) timer.classList.toggle('hidden', !view.timer);
        hud.classList.toggle('compact', !!view.compact);
        hud.dataset.tone = view.tone || '';
        hud.classList.remove('hidden');
    }
    if (!view) return;

    if (view.timer) {
        const fill = wEl('arena-hud-timer-fill');
        const ratio = Math.max(0, Math.min(1, wrestle.tieMsLeft / (wrestle.tieDuration || WRESTLE.TIEUP_MS)));
        if (fill) fill.style.transform = `scaleX(${ratio.toFixed(3)})`;
    }
    if (view.count) setPinCountDisplay(wEl('arena-hud-count'), wrestle.pinCount);
}

/** Dim the action buttons while the server ignores them */
function renderActionLock() {
    const locked = gameMode === 'arena' && !wrestle.eliminated && (
        wrestle.isDown || wrestle.isGettingUp || !!wrestle.moveType || !!wrestle.pinRole ||
        wrestle.tieRole === 'defender' || isGrabbed || !!ropes.whipPhase);
    if (locked === wrestle.locked) return;
    wrestle.locked = locked;
    const buttons = document.querySelector('.action-buttons');
    if (buttons) buttons.classList.toggle('locked', locked);
    if (locked) {
        document.querySelectorAll('.action-buttons .action-btn[data-action].pressed')
            .forEach(btn => btn.classList.remove('pressed'));
    }
}

/** Short HUD message (shown when nothing more important is on screen) */
function flashHud(title, sub, tone) {
    if (wrestle.flashTimer) clearTimeout(wrestle.flashTimer);
    wrestle.flash = { id: ++flashSeq, title, sub: sub || '', tone: tone || '' };
    wrestle.flashTimer = setTimeout(() => {
        wrestle.flash = null;
        wrestle.flashTimer = null;
        renderHud();
    }, WRESTLE.FLASH_MS);
    renderHud();
}

function computeGrabButtonMode() {
    if (isGrabbing) return 'throw';                       // Carrying: throw
    if (wrestle.tieRole === 'attacker') return 'lift';    // Tie-up attacker: lift into the carry
    if (wrestle.coverAvailable) return 'cover';           // Downed rival next to me: pin
    return 'grab';
}

/**
 * AGARRAR / CUBRIR / CARGAR / LANZAR label and color
 * @param {boolean} force - rewrite the button even if the mode did not change
 */
function updateGrabButtonState(force = false) {
    const mode = computeGrabButtonMode();
    if (mode === grabButtonMode && !force) return;
    grabButtonMode = mode;

    const grabButton = document.querySelector('.action-btn[data-action="grab"]');
    if (!grabButton) return;

    Object.values(GRAB_BUTTON_MODES).forEach(cfg => {
        if (cfg.className) grabButton.classList.remove(cfg.className);
    });
    const cfg = GRAB_BUTTON_MODES[mode];
    if (cfg.className) grabButton.classList.add(cfg.className);
    // Colors/animation come from the CSS classes (older builds set them inline)
    grabButton.style.borderColor = '';
    grabButton.style.color = '';
    grabButton.style.animation = '';

    const labelSpan = grabButton.querySelector('.btn-action');
    if (labelSpan) labelSpan.textContent = cfg.label;
}

// ---------- Mash input ----------

function setupMashInput() {
    const overlay = document.getElementById('mash-overlay');
    if (!overlay || overlay.dataset.bound) return;
    overlay.dataset.bound = '1';

    if (window.PointerEvent) {
        // One pointerdown per finger; no click/mouse listeners, so touch + click never double-fire
        overlay.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            handleMashTap(e);
        });
    } else {
        // preventDefault on touchstart suppresses the emulated mouse events
        overlay.addEventListener('touchstart', handleMashTap, { passive: false });
        overlay.addEventListener('mousedown', handleMashTap);
    }
}

/**
 * One tap = one 'arena-escape' (the server counts the taps)
 */
function handleMashTap(e) {
    if (e && e.cancelable) e.preventDefault();
    if (!mash.mode) return;

    const now = performance.now();
    if (now - mash.lastTapAt < WRESTLE.TAP_DEBOUNCE_MS) return;
    mash.lastTapAt = now;

    // Instant feedback: squash animation + light tick
    const btn = wEl('mash-btn');
    if (btn) {
        btn.classList.remove('tap');
        void btn.offsetWidth; // Restart the animation
        btn.classList.add('tap');
    }
    vibrate(WRESTLE_VIBRATION.mashTap);

    // While reconnecting socket.io would buffer the taps and replay them later
    if (!socket || !socket.connected) return;

    const mode = mash.mode;
    mash.pending++;
    mash.lastEmitAt = now;
    renderMash();

    socket.emit('arena-escape', (res) => {
        if (mash.mode !== mode) return; // That screen is already gone
        mash.pending = Math.max(0, mash.pending - 1);
        if (res && res.success && res.mode === mode) {
            if (res.escaped) {
                onMashEscaped(mode);
                return;
            }
            setMash({ mode, taps: res.taps, needed: res.needed });
        }
        renderMash();
    });
}

function onMashEscaped(mode) {
    if (mode === 'tieup') {
        setTieRole(null);
        flashHud('¡LIBRE!', 'Te zafaste del amarre', 'good');
    } else if (mode === 'pin') {
        setPinRole(null);
        flashHud('¡TE ZAFASTE!', '¡Sigue peleando!', 'good');
    } else {
        isGrabbed = false;
        flashHud('¡LIBRE!', 'Te soltaste', 'good');
    }
    setMash(null);
    vibrate(WRESTLE_VIBRATION.escaped);
    renderWrestleUI();
}

// ---------- Server events ----------

function handleArenaTieUp(data) {
    if (!data) return;
    if (isMe(data.attackerId)) {
        const duration = Number(data.duration);
        wrestle.tieDuration = duration > 0 ? duration : WRESTLE.TIEUP_MS;
        wrestle.tieMsLeft = wrestle.tieDuration;
        setTieRole('attacker');
    } else if (isMe(data.defenderId)) {
        setTieRole('defender');
        setMash({ mode: 'tieup', taps: 0 });
    } else {
        return;
    }
    renderWrestleUI();
}

function handleArenaTieUpEnd(data) {
    if (!data) return;
    const meAttacker = isMe(data.attackerId);
    const meDefender = isMe(data.defenderId);
    if (!meAttacker && !meDefender) return;

    const wasRole = wrestle.tieRole;
    setTieRole(null);
    if (meDefender) {
        if (mash.mode === 'tieup') setMash(null);
        // (When my own tap broke it, the escape callback already celebrated)
        if (data.reason === 'escape' && wasRole === 'defender') {
            vibrate(WRESTLE_VIBRATION.escaped);
            flashHud('¡LIBRE!', 'Te zafaste del amarre', 'good');
        }
    } else if (wasRole === 'attacker') {
        if (data.reason === 'escape') {
            vibrate(WRESTLE_VIBRATION.partnerEscaped);
            flashHud('¡SE ZAFÓ!', '', 'danger');
        } else if (data.reason === 'timeout') {
            flashHud('AMARRE ROTO', 'Se acabó el tiempo', 'info');
        }
    }
    renderWrestleUI();
}

function handleArenaGrappleMove(data) {
    if (!data) return;
    const meAttacker = isMe(data.attackerId);
    const meDefender = isMe(data.defenderId);
    if (!meAttacker && !meDefender) return;

    setTieRole(null);
    if (mash.mode === 'tieup') setMash(null);
    wrestle.moveType = data.move || null;
    wrestle.moveRole = meAttacker ? 'attacker' : 'defender';
    if (meAttacker) vibrate(WRESTLE_VIBRATION.moveStart);
    renderWrestleUI();
}

function handleArenaGrappleImpact(data) {
    if (!data) return;
    if (data.move === 'finisher') {
        handleFinisherImpact(data);
        return;
    }
    if (isMe(data.defenderId)) {
        vibrate(HEAVY_GRAPPLE_MOVES.includes(data.move) ? WRESTLE_VIBRATION.impactHeavy : WRESTLE_VIBRATION.impactLight);
        if (data.down && !data.eliminated) {
            wrestle.isDown = true;
            renderWrestleUI();
        }
    } else if (isMe(data.attackerId)) {
        vibrate(WRESTLE_VIBRATION.impactDealt);
    }
}

function handleArenaGetUp(data) {
    if (!data || !isMe(data.playerId)) return;
    wrestle.isDown = false;
    wrestle.isGettingUp = true;
    // Do not cut the "escaped" buzz of a kick-out (that also makes me get up)
    if (!wrestle.flash) vibrate(WRESTLE_VIBRATION.getUp);
    renderWrestleUI();
}

function handleArenaPinStart(data) {
    if (!data) return;
    if (isMe(data.victimId)) {
        setPinRole('pinned');
        setMash({ mode: 'pin', taps: 0, needed: data.tapsNeeded, count: 0 });
    } else if (isMe(data.pinnerId)) {
        setPinRole('pinner');
    } else {
        return;
    }
    renderWrestleUI();
}

function handleArenaPinCount(data) {
    if (!data) return;
    const meVictim = isMe(data.victimId);
    if (!meVictim && !isMe(data.pinnerId)) return;

    const count = Number(data.count) || 0;
    if (!wrestle.pinRole) setPinRole(meVictim ? 'pinned' : 'pinner');
    setPinCount(count);
    if (meVictim) setMash({ mode: 'pin', count });
    renderWrestleUI();
}

function handleArenaPinEnd(data) {
    if (!data) return;
    const meVictim = isMe(data.victimId);
    const mePinner = isMe(data.pinnerId);
    if (!meVictim && !mePinner) return;

    const wasRole = wrestle.pinRole;
    setPinRole(null);
    if (meVictim) {
        if (mash.mode === 'pin') setMash(null);
        // (When my own tap kicked out, the escape callback already celebrated)
        if (data.result === 'kickout' && wasRole === 'pinned') {
            vibrate(WRESTLE_VIBRATION.escaped);
            flashHud('¡TE ZAFASTE!', '¡Sigue peleando!', 'good');
        }
    } else if (wasRole === 'pinner') {
        if (data.result === 'pinfall') {
            vibrate(WRESTLE_VIBRATION.pinWin);
            flashHud('¡1 · 2 · 3!', '¡Ganaste por conteo!', 'good');
        } else if (data.result === 'kickout') {
            vibrate(WRESTLE_VIBRATION.partnerEscaped);
            flashHud('¡SE ZAFÓ!', 'Pateó antes del 3', 'danger');
        }
    }
    renderWrestleUI();
}

// =================================
// Arena spirit meter, taunts and signature finishers
// =================================
// Same approach as the wrestling section: my 'arena-state' entry is the truth (meter,
// SPECIAL countdown, taunting), the events only make the phone react a frame early, and
// every haptic / banner fires on a state CHANGE so event + state never double up.

const SPIRIT = {
    MAX: 100,
    SPECIAL_MS: 12000,          // Server SPECIAL_DURATION ('arena-special' sends the real value)
    SUPERKICK_RANGE: 2.2,       // Server FINISHERS.superkick.range
    SUPERKICK_CONE: Math.PI / 2.5, // Server findFinisherTarget: "roughly in front"
    SPLASH_RANGE: 3.2,          // Server FINISHERS.splash.range
    BANNER_MS: 2800,            // "¡ESPECIAL! Tu remate: ..."
    NOTE_MS: 1600,              // "Se acabó el especial"
    ERROR_MS: 1300,             // "¡Primero amárralo!", ...
    REQUEST_TIMEOUT_MS: 1200    // A finisher request whose ack never came stops blocking
};

const TIEUP_FINISHERS = ['powerbomb', 'piledriver', 'ddt'];

const FINISHER_HOWTO = {
    tieup: 'Amarra al rival y presiona ¡REMATE!',
    superkick: 'Frente a un rival: ¡REMATE!',
    splash: 'Junto a un rival en la lona: ¡REMATE!'
};

const SPIRIT_VIBRATION = {
    special: [90, 40, 90, 40, 260],          // Meter full: SPECIAL
    specialEnd: 40,
    ready: [12, 40, 12],                     // Superkick / splash target just came into range
    finisherStart: 30,                       // My finisher starts
    finisherIncoming: [60, 40, 60],          // Someone starts a finisher on me
    finisherDealt: [50, 30, 50, 30, 200],    // My finisher lands
    finisherTaken: [320, 60, 220, 60, 480],  // A finisher lands on me (strongest pattern)
    error: [20, 40, 20]
};

const TAUNT_BUTTON_MODES = {
    taunt: { label: 'Y', action: 'BURLA', className: '' },
    finisher: { label: '★', action: '¡REMATE!', className: 'mode-finisher' }
};

// MY spirit (mirrors my 'arena-state' entry; events update it a frame early)
const spirit = {
    value: 0,               // 0..100
    isSpecial: false,
    msLeft: 0,
    duration: SPIRIT.SPECIAL_MS,
    finisher: null,         // { type, name, variant }
    isTaunting: false,
    ready: false,           // The finisher would connect right now
    eliminated: false,
    requestPending: false,
    requestTimer: null,
    requestSeq: 0,          // Bumped on resets so stale callbacks are ignored
    bannerTimer: null,
    view: {}                // Render cache (only touch the DOM on changes)
};

function getFinisherKind(type) {
    if (TIEUP_FINISHERS.includes(type)) return 'tieup';
    return type === 'splash' ? 'splash' : 'superkick';
}

function getMyFinisherName() {
    return (spirit.finisher && spirit.finisher.name) || '¡REMATE!';
}

/** Tie-up finishers and the superkick can be used as the tie-up attacker */
function canFinishFromTieUp() {
    return getFinisherKind(spirit.finisher && spirit.finisher.type) !== 'splash';
}

/** Name of the finisher I am giving / taking (from the attacker's entry) */
function getFinisherMoveName(me, move, players) {
    const attacker = move.role === 'attacker' ? me :
        players.find(p => p && p.id === move.partnerId);
    return (attacker && attacker.finisher && attacker.finisher.name) || wrestle.moveName || '';
}

/**
 * Would the server accept my finisher right now? (same rules as processFinisher /
 * findFinisherTarget). Only drives the button pulse: the server still has the last word.
 */
function isFinisherReady(me, players) {
    if (!me || !me.position || me.isEliminated) return false;
    const kind = getFinisherKind(spirit.finisher && spirit.finisher.type);
    const tieAttacker = !!(me.tieUp && me.tieUp.role === 'attacker');
    if (kind === 'tieup') return tieAttacker;
    if (kind === 'superkick' && tieAttacker) return true;
    if (me.tieUp || me.move || me.isDown || me.isGettingUp || me.pin ||
        me.isGrabbed || me.isGrabbing || me.isStunned) return false;

    const downed = kind === 'splash';
    const range = downed ? SPIRIT.SPLASH_RANGE : SPIRIT.SUPERKICK_RANGE;
    const facing = Number(me.facingAngle) || 0;
    return players.some(other => {
        if (!other || other.id === me.id || !other.position || other.isEliminated ||
            other.move || other.isGrabbed || other.isGrabbing) return false;
        if (downed ? !other.isDown : (other.isDown || other.isGettingUp || other.pin)) return false;
        const dx = other.position.x - me.position.x;
        const dz = other.position.z - me.position.z;
        if (Math.hypot(dx, dz) > range) return false;
        if (!downed) {
            let diff = Math.atan2(dx, dz) - facing;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) > SPIRIT.SUPERKICK_CONE) return false;
        }
        return true;
    });
}

// ---------- Model setters (haptics / banners only on real changes) ----------

/**
 * Enter / leave SPECIAL
 * @param {object} opts - { duration, msLeft, finisher } when entering;
 *                        { used } (finisher spent) or { timeout } when leaving
 */
function setSpecial(on, opts = {}) {
    if (spirit.isSpecial === on) return false;
    spirit.isSpecial = on;
    spirit.ready = false;

    if (on) {
        if (opts.finisher && opts.finisher.type) spirit.finisher = opts.finisher;
        const duration = Number(opts.duration);
        const msLeft = Number(opts.msLeft);
        spirit.duration = Math.max(duration > 0 ? duration : SPIRIT.SPECIAL_MS, msLeft > 0 ? msLeft : 0);
        spirit.msLeft = msLeft > 0 ? msLeft : spirit.duration;
        spirit.value = SPIRIT.MAX;
        vibrate(SPIRIT_VIBRATION.special);
        const kind = getFinisherKind(spirit.finisher && spirit.finisher.type);
        showArenaBanner({
            title: '¡ESPECIAL!',
            sub: `Tu remate: ${getMyFinisherName()}`,
            hint: FINISHER_HOWTO[kind],
            tone: 'special',
            ms: SPIRIT.BANNER_MS
        });
    } else {
        spirit.msLeft = 0;
        if (opts.used) {
            spirit.value = 0;
            hideArenaBanner();
        } else if (opts.timeout) {
            vibrate(SPIRIT_VIBRATION.specialEnd);
            showArenaBanner({ title: 'Se acabó el especial', tone: 'info', ms: SPIRIT.NOTE_MS });
        }
    }
    return true;
}

function setFinisherReady(ready) {
    if (spirit.ready === ready) return;
    spirit.ready = ready;
    // Tie-up finishers: the tie-up itself already buzzes
    if (ready && getFinisherKind(spirit.finisher && spirit.finisher.type) !== 'tieup') {
        vibrate(SPIRIT_VIBRATION.ready);
    }
}

/**
 * Mirror my 'arena-state' entry (called every tick, before the wrestling sync)
 */
function syncSpiritFromState(me, players) {
    const out = !!me.isEliminated;
    spirit.eliminated = out;
    if (me.finisher && me.finisher.type) spirit.finisher = me.finisher;

    const value = Math.max(0, Math.min(SPIRIT.MAX, Number(me.spirit) || 0));
    const special = !out && !!me.isSpecial;
    const msLeft = Math.max(0, Number(me.specialMsLeft) || 0);

    // Leaving SPECIAL with meter left over = it ran out unused (a finisher empties it)
    setSpecial(special, special ? { msLeft } : { timeout: !out && value > 0 });
    spirit.value = value;
    if (special) {
        spirit.msLeft = msLeft;
        if (msLeft > spirit.duration) spirit.duration = msLeft;
    }
    spirit.isTaunting = !out && !!me.isTaunting;
    setFinisherReady(special && isFinisherReady(me, players));

    renderSpiritUI();
}

/**
 * Forget the spirit state and hide its UI (rematch, next round, game over, leave)
 */
function clearArenaSpirit() {
    if (spirit.requestTimer) clearTimeout(spirit.requestTimer);
    spirit.requestSeq++;
    Object.assign(spirit, {
        value: 0,
        isSpecial: false,
        msLeft: 0,
        duration: SPIRIT.SPECIAL_MS,
        finisher: null,
        isTaunting: false,
        ready: false,
        eliminated: false,
        requestPending: false,
        requestTimer: null
    });
    hideArenaBanner();
    renderSpiritUI(true);
}

// ---------- Rendering ----------

/**
 * @param {boolean} force - rewrite everything (mode change / reset)
 */
function renderSpiritUI(force = false) {
    if (force) spirit.view = {};
    renderSpiritMeter();
    renderTauntButton();
}

function renderSpiritMeter() {
    const meter = wEl('spirit-meter');
    if (!meter) return;
    const view = spirit.view;

    const show = gameMode === 'arena';
    if (view.show !== show) {
        view.show = show;
        meter.classList.toggle('hidden', !show);
    }
    if (!show) return;

    const special = spirit.isSpecial && !spirit.eliminated;
    const cls = `${special ? 'special' : ''}|${spirit.isTaunting ? 'taunting' : ''}|${spirit.eliminated ? 'out' : ''}`;
    if (view.cls !== cls) {
        view.cls = cls;
        meter.classList.toggle('special', special);
        meter.classList.toggle('taunting', spirit.isTaunting && !special);
        meter.classList.toggle('out', spirit.eliminated);
    }

    // While SPECIAL the bar shows the time left to use the finisher
    const ratio = special ?
        Math.max(0, Math.min(1, spirit.msLeft / (spirit.duration || SPIRIT.SPECIAL_MS))) :
        spirit.value / SPIRIT.MAX;
    const fill = ratio.toFixed(3);
    if (view.fill !== fill) {
        view.fill = fill;
        const fillEl = wEl('spirit-fill');
        if (fillEl) fillEl.style.transform = `scaleX(${fill})`;
    }

    const label = special ? '¡ESPECIAL!' : 'ÁNIMO';
    if (view.label !== label) {
        view.label = label;
        const labelEl = wEl('spirit-label');
        if (labelEl) labelEl.textContent = label;
    }

    const valueText = special ? `${Math.ceil(spirit.msLeft / 1000)}s` : `${Math.round(spirit.value)}`;
    if (view.value !== valueText) {
        view.value = valueText;
        const valueEl = wEl('spirit-value');
        if (valueEl) valueEl.textContent = valueText;
    }

    const finisherText = spirit.finisher && spirit.finisher.name ? `Remate: ${spirit.finisher.name}` : '';
    if (view.finisher !== finisherText) {
        view.finisher = finisherText;
        const finEl = wEl('spirit-finisher');
        if (finEl) finEl.textContent = finisherText;
    }
}

/** BURLA <-> ¡REMATE! (glows while SPECIAL, pulses harder when it would connect) */
function renderTauntButton() {
    const mode = gameMode === 'arena' && spirit.isSpecial && !spirit.eliminated ? 'finisher' : 'taunt';
    const ready = mode === 'finisher' && spirit.ready;
    const key = `${mode}:${ready}`;
    if (spirit.view.button === key) return;

    const btn = document.querySelector('.action-btn[data-action="taunt"]');
    if (!btn) return;
    spirit.view.button = key;

    const cfg = TAUNT_BUTTON_MODES[mode];
    Object.values(TAUNT_BUTTON_MODES).forEach(c => {
        if (c.className) btn.classList.remove(c.className);
    });
    if (cfg.className) btn.classList.add(cfg.className);
    btn.classList.toggle('ready', ready);
    const labelEl = btn.querySelector('.btn-label');
    if (labelEl) labelEl.textContent = cfg.label;
    const actionEl = btn.querySelector('.btn-action');
    if (actionEl) actionEl.textContent = cfg.action;
}

/**
 * Big centered message that never takes touches
 * @param {object} opts - { title, sub, hint, tone: 'special'|'info'|'error', ms }
 */
function showArenaBanner(opts) {
    const banner = wEl('arena-banner');
    if (!banner) return;
    if (spirit.bannerTimer) clearTimeout(spirit.bannerTimer);

    const set = (id, text) => { const el = wEl(id); if (el) el.textContent = text || ''; };
    set('arena-banner-title', opts.title);
    set('arena-banner-sub', opts.sub);
    set('arena-banner-hint', opts.hint);
    banner.dataset.tone = opts.tone || '';
    // Restart the pop-in animation when a banner replaces another one
    banner.classList.add('hidden');
    void banner.offsetWidth;
    banner.classList.remove('hidden');

    spirit.bannerTimer = setTimeout(hideArenaBanner, opts.ms || SPIRIT.NOTE_MS);
}

function hideArenaBanner() {
    if (spirit.bannerTimer) clearTimeout(spirit.bannerTimer);
    spirit.bannerTimer = null;
    const banner = wEl('arena-banner');
    if (banner) banner.classList.add('hidden');
}

// ---------- Finisher request ----------

function showFinisherError(error) {
    const kind = getFinisherKind(spirit.finisher && spirit.finisher.type);
    let title = 'Ahora no puedes';
    let sub = '';
    if (error === 'need-tieup') {
        title = '¡Primero amárralo!';
        sub = 'AGARRAR para amarrar y luego ¡REMATE!';
    } else if (error === 'no-target') {
        title = 'No hay rival en rango';
        sub = kind === 'splash' ? 'Acércate a un rival en la lona' : 'Ponte frente a un rival';
    } else if (error === 'not-special') {
        title = 'Ya no tienes ESPECIAL';
    }
    vibrate(SPIRIT_VIBRATION.error);
    showArenaBanner({ title, sub, tone: 'error', ms: SPIRIT.ERROR_MS });
}

/**
 * ¡REMATE! pressed: ask the server (it checks SPECIAL, the tie-up and the target)
 */
function requestFinisher() {
    if (spirit.requestPending || !socket || !socket.connected) return;
    spirit.requestPending = true;
    const seq = ++spirit.requestSeq;
    if (spirit.requestTimer) clearTimeout(spirit.requestTimer);
    spirit.requestTimer = setTimeout(() => {
        spirit.requestPending = false;
        spirit.requestTimer = null;
    }, SPIRIT.REQUEST_TIMEOUT_MS);

    socket.emit('arena-finisher', (res) => {
        if (seq !== spirit.requestSeq) return; // Reset / newer request since then
        spirit.requestPending = false;
        if (spirit.requestTimer) clearTimeout(spirit.requestTimer);
        spirit.requestTimer = null;
        console.log('[Arena Finisher] Response:', res);

        if (res && res.success) {
            // The 'arena-finisher' broadcast brings the move HUD and its haptics
            setSpecial(false, { used: true });
            renderSpiritUI();
            return;
        }
        const error = res && res.error;
        if (error === 'not-special') {
            // SPECIAL just ran out: back to BURLA (the state confirms it next frame)
            setSpecial(false, { used: true });
            renderSpiritUI();
        }
        showFinisherError(error);
    });
}

// ---------- Server events ----------

function handleArenaSpecial(data) {
    if (!data || !isMe(data.playerId) || spirit.eliminated) return;
    setSpecial(true, { duration: data.duration, finisher: data.finisher });
    renderSpiritUI();
    renderHud();
}

function handleArenaSpecialEnd(data) {
    if (!data || !isMe(data.playerId)) return;
    setSpecial(false, { timeout: data.reason === 'timeout' && !spirit.eliminated });
    renderSpiritUI();
    renderHud();
}

function handleArenaFinisher(data) {
    if (!data) return;
    const meAttacker = isMe(data.attackerId);
    const meDefender = isMe(data.defenderId);
    if (!meAttacker && !meDefender) return;

    // Both of us are now in the finisher (a tie-up / mash screen ends here)
    setTieRole(null);
    if (mash.mode === 'tieup') setMash(null);
    wrestle.moveType = 'finisher';
    wrestle.moveRole = meAttacker ? 'attacker' : 'defender';
    wrestle.moveName = data.name || '';

    if (meAttacker) {
        setSpecial(false, { used: true });
        vibrate(SPIRIT_VIBRATION.finisherStart);
    } else {
        vibrate(SPIRIT_VIBRATION.finisherIncoming);
    }
    renderSpiritUI();
    renderWrestleUI();
}

function handleFinisherImpact(data) {
    if (isMe(data.defenderId)) {
        vibrate(SPIRIT_VIBRATION.finisherTaken);
        if (data.down && !data.eliminated) {
            wrestle.isDown = true;
            renderWrestleUI();
        }
    } else if (isMe(data.attackerId)) {
        vibrate(SPIRIT_VIBRATION.finisherDealt);
        flashHud(data.name || '¡REMATE!', data.eliminated ? '¡Fuera de combate!' : '¡Lo conectaste!', 'good');
    }
}

// =================================
// Arena ropes, running strikes and battle royal
// =================================
// Same approach as the sections above: my 'arena-state' entry is the truth (whip phase,
// rope running, eliminations), the events only make the phone react a frame early, and
// every haptic fires on a state CHANGE so event + state never double up.

const ROPES = {
    RUNNING_MIN_SPEED: 7,       // Server ROPE_CONFIG.RUNNING_MIN_SPEED (run flag + this speed = running strikes)
    REBOUND_HINT_RANGE: 4,      // "¡GOLPÉALO AL REBOTAR!" when a rebounding rival is this close
    RUN_HINT_GRACE_MS: 250,     // Keep the running hint through short speed dips (no flicker)
    BOUNCE_DEDUPE_MS: 300,      // Event + state report the same rope bounce
    WHIP_SENT_DEDUPE_MS: 600,   // Grab callback + 'arena-whip' report the same whip
    ROYAL_MIN_PLAYERS: 3        // "QUEDAN N" only in a battle royal
};

const ROPE_VIBRATION = {
    whipped: [40, 30, 90],              // I'm sent into the ropes
    whipSent: 25,                       // I sent someone into the ropes
    rebound: [70, 25, 70],              // Bump: I hit the ropes and come back
    ropeBounce: 12,                     // My own rope-running bounce
    reboundTarget: 10,                  // A rebounding rival is in range
    strikeTaken: [170, 50, 260],        // A lariat / dropkick knocks me down
    strikeDealt: [30, 25, 30, 25, 110], // My lariat / dropkick lands
    eliminatedRival: [40, 30, 40, 30, 160],
    eliminated: [260, 80, 260]
};

const RUNNING_STRIKE_NAMES = {
    lariat: '¡TENDEDERO!',
    dropkick: '¡DROPKICK!'
};

const ELIMINATION_REASONS = {
    ringout: 'ring-out',
    pinfall: 'cuenta de 3',
    knockout: 'KO',
    disconnect: 'desconexión'
};

// MY rope situation (mirrors my 'arena-state' entry; events update it a frame early)
const ropes = {
    whipPhase: null,        // 'out' | 'back' | null: I'm being whipped into the ropes
    ropeRunning: false,     // Bouncing back off the ropes at speed (my own run)
    running: false,         // Running hint on screen
    runSeenAt: 0,
    reboundTarget: false,   // A rival coming back from the ropes is within range
    lastBounceAt: 0,
    whipSentAt: 0,
    lastPos: null           // { x, z, t }: speed fallback when the state has no velocity
};

// Battle royal (3+ players)
const royal = {
    startCount: 0,          // Players in this match (eliminated ones stay in 'arena-state')
    remaining: 0,
    elimination: null,      // { byName, reason, remaining } once I'm out
    view: null              // Render cache
};

// ---------- Model setters (haptics only on real changes) ----------

/** @returns {boolean} whether the phase changed */
function setWhipPhase(phase) {
    if (ropes.whipPhase === phase) return false;
    const prev = ropes.whipPhase;
    ropes.whipPhase = phase;
    if (phase === 'out' && !prev) vibrate(ROPE_VIBRATION.whipped);
    else if (phase === 'back') vibrate(ROPE_VIBRATION.rebound);
    return true;
}

function noteRopeBounce() {
    const now = performance.now();
    if (now - ropes.lastBounceAt < ROPES.BOUNCE_DEDUPE_MS) return;
    ropes.lastBounceAt = now;
    vibrate(ROPE_VIBRATION.ropeBounce);
}

function setRopeRunning(on) {
    if (ropes.ropeRunning === on) return;
    ropes.ropeRunning = on;
    if (on) noteRopeBounce();
}

function setReboundTarget(on) {
    if (ropes.reboundTarget === on) return;
    ropes.reboundTarget = on;
    if (on) vibrate(ROPE_VIBRATION.reboundTarget);
}

/** The server ignores my strikes (or won't turn them into running strikes) right now */
function isBusyForStrikes(me) {
    return !!(me.isEliminated || me.tieUp || me.move || me.isDown || me.isGettingUp || me.pin ||
        me.whip || me.isGrabbed || me.isGrabbing || me.isStunned);
}

/** My horizontal speed: the state's velocity, or the change between two positions */
function getMySpeed(me) {
    const now = performance.now();
    const pos = me.position;
    const v = me.velocity;
    let speed = v ? Math.hypot(Number(v.x) || 0, Number(v.z) || 0) : NaN;
    if (!Number.isFinite(speed) && pos && ropes.lastPos) {
        const dt = (now - ropes.lastPos.t) / 1000;
        if (dt > 0.005 && dt < 0.5) speed = Math.hypot(pos.x - ropes.lastPos.x, pos.z - ropes.lastPos.z) / dt;
    }
    ropes.lastPos = pos ? { x: pos.x, z: pos.z, t: now } : null;
    return Number.isFinite(speed) ? speed : 0;
}

/** A rival coming back from the ropes (whip 'back') close enough to lariat / dropkick */
function isReboundTargetNear(me, players) {
    if (!me.position) return false;
    return players.some(other => other && other.id !== me.id && !other.isEliminated && other.position &&
        other.whip && other.whip.phase === 'back' &&
        Math.hypot(other.position.x - me.position.x, other.position.z - me.position.z) <= ROPES.REBOUND_HINT_RANGE);
}

/**
 * Mirror my 'arena-state' entry (called every tick, before the wrestling sync that renders the HUD)
 */
function syncRopesFromState(me, players) {
    const out = !!me.isEliminated;
    const now = performance.now();

    setWhipPhase(!out && me.whip ? (me.whip.phase === 'back' ? 'back' : 'out') : null);
    setRopeRunning(!out && !!me.isRopeRunning);

    // Running = my stick run flag + real speed, or bouncing off the ropes
    const speed = getMySpeed(me);
    const busy = isBusyForStrikes(me);
    if (!busy && (ropes.ropeRunning || (inputState.run && speed > ROPES.RUNNING_MIN_SPEED))) {
        ropes.runSeenAt = now;
    }
    ropes.running = !busy && ropes.runSeenAt > 0 && now - ropes.runSeenAt < ROPES.RUN_HINT_GRACE_MS;
    setReboundTarget(!busy && isReboundTargetNear(me, players));

    // Battle royal counter
    royal.startCount = Math.max(royal.startCount, players.length);
    royal.remaining = players.filter(p => p && !p.isEliminated).length;
    renderRoyalCounter();
}

/**
 * Forget the rope / battle royal state (rematch, next round, game over, leave).
 * Called from clearArenaWrestling, which re-renders the HUD afterwards.
 */
function clearArenaRopes() {
    Object.assign(ropes, {
        whipPhase: null,
        ropeRunning: false,
        running: false,
        runSeenAt: 0,
        reboundTarget: false,
        lastBounceAt: 0,
        whipSentAt: 0,
        lastPos: null
    });
    Object.assign(royal, {
        startCount: 0,
        remaining: 0,
        elimination: null
    });
    renderRoyalCounter(true);
}

// ---------- Rendering ----------

/** "QUEDAN N" under the health value (Arena with 3+ players only) */
function renderRoyalCounter(force = false) {
    const el = wEl('arena-royal');
    if (!el) return;
    const show = gameMode === 'arena' && royal.startCount >= ROPES.ROYAL_MIN_PLAYERS;
    const key = show ? String(royal.remaining) : '';
    if (!force && royal.view === key) return;
    royal.view = key;
    el.classList.toggle('hidden', !show);
    const countEl = wEl('arena-royal-count');
    if (countEl) countEl.textContent = key;
}

/** "Te eliminó Ana (ring-out)" / "Cuenta de 3" / "KO" */
function getEliminationCause(elim) {
    if (!elim) return '';
    const reason = ELIMINATION_REASONS[elim.reason] || '';
    if (elim.byName) {
        return reason && elim.reason !== 'knockout' ? `Te eliminó ${elim.byName} (${reason})` : `Te eliminó ${elim.byName}`;
    }
    return reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : '';
}

/**
 * How I went out, for the in-match HUD ("… · Quedan 3") or the end screens ("… · Puesto 3 de 4").
 * Empty when I was not eliminated.
 */
function describeMyElimination(final = false) {
    const elim = royal.elimination;
    if (!elim && !wrestle.eliminated) return '';
    const parts = [];
    const cause = getEliminationCause(elim);
    if (cause) parts.push(cause);
    else if (final) parts.push('Quedaste eliminado');

    if (royal.startCount >= ROPES.ROYAL_MIN_PLAYERS) {
        if (!final) {
            parts.push(`Quedan ${royal.remaining}`);
        } else if (elim && elim.remaining > 0) {
            parts.push(`Puesto ${elim.remaining + 1} de ${royal.startCount}`);
        }
    }
    return parts.join(' · ');
}

function getEliminatedHudView() {
    const sub = describeMyElimination(false);
    return { key: `out:${sub}`, title: '¡ELIMINADO!', sub, tone: 'danger' };
}

/** Elimination line on the game-over / round-end screens (hidden when empty) */
function setEliminationInfo(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
}

// ---------- Server events ----------

/** I sent my tie-up partner into the ropes (grab callback or 'arena-whip') */
function onWhipSent() {
    const now = performance.now();
    if (now - ropes.whipSentAt < ROPES.WHIP_SENT_DEDUPE_MS) return;
    ropes.whipSentAt = now;
    setTieRole(null);
    vibrate(ROPE_VIBRATION.whipSent);
    flashHud('¡LATIGAZO!', 'Al rebote: GOLPE = Tendedero · PATADA = Dropkick', 'good');
    renderWrestleUI();
}

function handleArenaWhip(data) {
    if (!data) return;
    if (isMe(data.attackerId)) {
        onWhipSent();
    } else if (isMe(data.defenderId)) {
        // The tie-up (and its mash screen) is over: I'm running into the ropes
        setTieRole(null);
        if (mash.mode === 'tieup') setMash(null);
        setWhipPhase('out');
        renderWrestleUI();
    }
}

function handleArenaRebound(data) {
    if (!data || !isMe(data.playerId)) return;
    if (setWhipPhase('back')) renderWrestleUI();
}

function handleArenaWhipEnd(data) {
    if (!data || !isMe(data.playerId)) return;
    if (setWhipPhase(null)) renderWrestleUI();
}

function handleArenaRopeBounce(data) {
    if (!data || !isMe(data.playerId)) return;
    // Every bounce buzzes (back-to-back bounces keep isRopeRunning on in the state)
    ropes.ropeRunning = true;
    noteRopeBounce();
}

/**
 * 'arena-attack-hit': the usual hit haptics, plus lariat / dropkick knockdowns
 */
function handleArenaAttackHit(data) {
    if (!data || !Array.isArray(data.hits) || !socket) return;

    const myHit = data.hits.find(h => h && h.targetId === socket.id);
    if (myHit && myHit.knockdown) {
        // Knocked flat (the state confirms isDown next frame)
        vibrate(ROPE_VIBRATION.strikeTaken);
        setWhipPhase(null);
        ropes.ropeRunning = false;
        if (!myHit.eliminated) {
            wrestle.isDown = true;
            flashHud(RUNNING_STRIKE_NAMES[myHit.move] || '¡DERRIBADO!', '¡Te mandaron a la lona!', 'danger');
        }
        renderWrestleUI();
    } else {
        handleAttackHitHaptics(data);
    }

    if (isMe(data.attackerId)) {
        const landed = data.hits.find(h => h && h.knockdown && h.move);
        if (landed) {
            vibrate(ROPE_VIBRATION.strikeDealt);
            flashHud(RUNNING_STRIKE_NAMES[landed.move] || '¡DERRIBO!',
                landed.eliminated ? '¡Fuera de combate!' : '¡A la lona!', 'good');
        }
    }
}

/**
 * 'arena-elimination' { playerId, reason, eliminatedBy, eliminatedByName, remaining }
 */
function handleArenaElimination(data) {
    if (!data || !socket || gameMode !== 'arena') return;
    const remaining = Number(data.remaining);
    if (Number.isFinite(remaining)) royal.remaining = remaining;

    if (isMe(data.playerId)) {
        const byOther = !!data.eliminatedBy && !isMe(data.eliminatedBy);
        royal.elimination = {
            byName: byOther ? (data.eliminatedByName || 'un rival') : '',
            reason: data.reason || '',
            remaining: Number.isFinite(remaining) ? remaining : royal.remaining
        };
        wrestle.eliminated = true;
        setWhipPhase(null);
        setReboundTarget(false);
        ropes.running = false;
        vibrate(ROPE_VIBRATION.eliminated);
        renderWrestleUI();
    } else if (isMe(data.eliminatedBy)) {
        vibrate(ROPE_VIBRATION.eliminatedRival);
        const name = data.playerName || 'Rival';
        const left = royal.startCount >= ROPES.ROYAL_MIN_PLAYERS && Number.isFinite(remaining) && remaining > 1
            ? ` · Quedan ${remaining}` : '';
        flashHud('¡LO ELIMINASTE!', `${name}${left}`, 'good');
    }
    renderRoyalCounter();
}

function resetState() {
    playerData = null;
    roomCode = null;
    isReady = false;
    selectedCharacter = null;
    takenCharacters = {};
    gameMode = 'smash';
    lastRaceTap = null;
    raceSpeed = 0;
    flappyAlive = true;
    balloonProgress = 0;
    balloonBlowing = false;
    balloonTied = false;
    balloonTension = 0;
    resetJoystick();
    Object.keys(inputState).forEach(key => inputState[key] = false);

    // Arena grab / wrestling state and its UI (mash screen, HUD, AGARRAR label)
    clearArenaWrestling();
    hideReconnectNotice();
    resetRematchButtons();

    elements.roomCodeInput.value = '';
    elements.joinError.textContent = '';
    elements.gameOverOverlay.classList.add('hidden');
    hideRoundEndOverlay();
    const tournamentOverlay = document.getElementById('tournament-end-overlay');
    if (tournamentOverlay) tournamentOverlay.classList.add('hidden');
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
    
    // Game over screen (every mode) and tournament end screen
    elements.rematchBtn.addEventListener('click', () => {
        requestRematch(document.getElementById('rematch-error'));
    });

    const tournamentRematchBtn = document.getElementById('tournament-rematch-btn');
    if (tournamentRematchBtn) {
        tournamentRematchBtn.addEventListener('click', () => {
            requestRematch(document.getElementById('tournament-rematch-error'));
        });
    }

    elements.exitBtn.addEventListener('click', () => {
        leaveRoom();
    });
}

// =================================
// Rematch
// =================================

const REMATCH_ERRORS = {
    'Match in progress': 'La partida aún no termina',
    'Game has not started': 'El juego no ha empezado',
    'Not in a room': 'No estás en una sala',
    'Room not found': 'La sala ya no existe',
    'No players in room': 'No hay jugadores en la sala'
};

function getRematchButtons() {
    return [elements.rematchBtn, document.getElementById('tournament-rematch-btn')].filter(Boolean);
}

/**
 * Ask the server to restart the current mode. On success the server sends
 * 'round-starting' { rematch: true } and then 'game-started', which reset this screen.
 */
function requestRematch(errorEl) {
    if (rematchPending) return;

    if (!socket || !socket.connected) {
        showRematchError(errorEl, 'Sin conexión, reintentando...');
        return;
    }

    rematchPending = true;
    getRematchButtons().forEach(btn => {
        btn.disabled = true;
        btn.classList.add('pending');
        btn.textContent = 'PIDIENDO...';
    });
    showRematchError(errorEl, '');

    let settled = false;
    const fallback = setTimeout(() => {
        if (settled) return;
        settled = true;
        resetRematchButtons();
        showRematchError(errorEl, 'Sin respuesta del servidor');
    }, 5000);

    socket.emit('request-rematch', (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(fallback);

        if (res && res.success) {
            // Keep the buttons disabled: 'round-starting' / 'game-started' take over from here
            // ('round-starting' can arrive before this ack and has already reset them)
            if (rematchPending) {
                getRematchButtons().forEach(btn => { btn.textContent = '¡VAMOS!'; });
            }
            triggerHaptic();
        } else {
            resetRematchButtons();
            const error = res && res.error;
            showRematchError(errorEl, REMATCH_ERRORS[error] || error || 'No se pudo pedir la revancha');
        }
    });
}

function resetRematchButtons() {
    rematchPending = false;
    getRematchButtons().forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('pending');
        btn.textContent = 'REVANCHA';
    });
}

function showRematchError(errorEl, message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    clearTimeout(rematchErrorTimer);
    if (message) {
        rematchErrorTimer = setTimeout(() => { errorEl.textContent = ''; }, 3000);
    }
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
    const elimText = gameMode === 'arena' ? describeMyElimination(true) : '';
    clearArenaWrestling();
    sendBalloonBlow(false);

    showRoundEndOverlay(data);
    setEliminationInfo('round-elim-info', elimText);
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
    if (data.totalRounds) tournamentState.totalRounds = data.totalRounds;

    if (data.rematch) {
        // Rematch (requested by any phone or the host): leave the end-of-match screens now;
        // 'game-started' (~1 s later) rebuilds this mode's live controls with fresh state.
        tournamentState.playerScores = {};
        resetMatchState();
        showTagNotification('¡REVANCHA!', 'var(--primary)');
    }

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
                    <span class="player-name">${escapeHtml(name)}</span>
                    <span class="player-wins">${escapeHtml(wins)}</span>
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
                    <span class="player-name">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : ''} ${escapeHtml(name)}</span>
                    <span class="player-wins">${escapeHtml(wins)}</span>
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

