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
    playerNameInput: document.getElementById('player-name'),
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

// Input state
const inputState = {
    left: false,
    right: false,
    jump: false,
    run: false
};

// =================================
// Socket.IO Connection
// =================================

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
    const name = elements.playerNameInput.value.trim() || 'Jugador';
    
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
        elements.playerStatus.textContent = isReady ? '¡Listo!' : 'Esperando...';
    }
    
    // Update players list
    elements.playersList.innerHTML = room.players.map(p => `
        <li class="${p.ready ? 'ready' : ''}" style="border-left-color: ${p.color}">
            <span class="player-number" style="color: ${p.color}">P${p.number}</span>
            <span class="player-name">${p.name}</span>
            <span class="ready-status">${p.ready ? '✓ Listo' : ''}</span>
        </li>
    `).join('');
}

function toggleReady() {
    isReady = !isReady;
    
    elements.readyBtn.classList.toggle('active', isReady);
    elements.readyBtn.querySelector('.btn-text').textContent = isReady ? '¡ESPERANDO!' : '¡LISTO!';
    elements.playerStatus.textContent = isReady ? '¡Listo!' : 'Esperando...';
    
    socket.emit('player-ready', isReady);
    
    triggerHaptic();
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
    console.log('[Game] Game started!');
    showScreen('controller');
    
    // Update controller UI with player info
    if (playerData) {
        elements.controllerBadge.querySelector('.badge-name').textContent = `P${playerData.number}`;
        elements.controllerBadge.style.background = `linear-gradient(135deg, ${playerData.color}, var(--accent))`;
    }
    
    updateStocks(3);
    triggerHaptic();
}

function handleGameState(data) {
    // Find our player in the state
    const myState = data.players.find(p => p.id === socket.id);
    
    if (myState) {
        // Update damage display
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
    
    if (data.winner) {
        const isWinner = data.winner.id === socket.id;
        elements.gameOverTitle.textContent = isWinner ? '¡GANASTE!' : '¡PERDISTE!';
        elements.gameOverTitle.style.color = isWinner ? 'var(--secondary)' : 'var(--primary)';
        elements.gameOverMessage.textContent = `Ganador: ${data.winner.name}`;
    } else {
        elements.gameOverTitle.textContent = '¡EMPATE!';
        elements.gameOverMessage.textContent = 'Todos eliminados';
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
    // D-Pad buttons
    const dpadButtons = document.querySelectorAll('.dpad-btn');
    
    dpadButtons.forEach(btn => {
        const inputType = btn.dataset.input;
        
        // Touch events
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleInputStart(inputType, btn);
        }, { passive: false });
        
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleInputEnd(inputType, btn);
        }, { passive: false });
        
        btn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            handleInputEnd(inputType, btn);
        }, { passive: false });
        
        // Mouse events (for testing on desktop)
        btn.addEventListener('mousedown', () => handleInputStart(inputType, btn));
        btn.addEventListener('mouseup', () => handleInputEnd(inputType, btn));
        btn.addEventListener('mouseleave', () => handleInputEnd(inputType, btn));
    });
    
    // Action buttons
    const actionButtons = document.querySelectorAll('.action-btn');
    
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
}

function handleInputStart(inputType, btn) {
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
    
    socket.emit('player-attack', action, (response) => {
        console.log('[Attack]', action, response);
    });
    
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

function sendInput() {
    if (socket && socket.connected) {
        socket.emit('player-input', inputState);
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

function resetState() {
    playerData = null;
    roomCode = null;
    isReady = false;
    Object.keys(inputState).forEach(key => inputState[key] = false);
    
    elements.roomCodeInput.value = '';
    elements.joinError.textContent = '';
    elements.gameOverOverlay.classList.add('hidden');
    elements.readyBtn.classList.remove('active');
    elements.readyBtn.querySelector('.btn-text').textContent = '¡LISTO!';
}

// =================================
// Event Listeners
// =================================

function setupEventListeners() {
    // Join screen
    elements.joinBtn.addEventListener('click', joinRoom);
    
    elements.roomCodeInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            elements.playerNameInput.focus();
        }
    });
    
    elements.playerNameInput.addEventListener('keyup', (e) => {
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
// Initialization
// =================================

function init() {
    console.log('[Controller] Initializing...');
    
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

