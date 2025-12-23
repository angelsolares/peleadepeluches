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
let selectedCharacter = 'edgar'; // Default character
let gameMode = 'smash'; // 'smash' or 'arena'
let isGrabbing = false; // Track if player is currently grabbing someone (Arena mode)
let isGrabbed = false; // Track if player is currently grabbed by someone (Arena mode)
let escapeProgress = 0; // Progress towards escaping from grab (0-100)
let escapeThreshold = 5; // Number of button presses needed to escape

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
    lidia: { name: 'Lidia', emoji: '👩‍🦰' }
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
    const name = CHARACTERS[selectedCharacter]?.name || 'Jugador';
    
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
    
    if (gameMode === 'arena') {
        // Arena mode: D-pad controls all 4 directions for movement
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
            if (isGrabbing) {
                // If already grabbing, try to throw
                // Calculate throw direction from current input
                let direction = null;
                if (inputState.left) direction = -Math.PI / 2;
                else if (inputState.right) direction = Math.PI / 2;
                else if (inputState.up) direction = 0;
                else if (inputState.down) direction = Math.PI;
                
                socket.emit('arena-throw', direction, (response) => {
                    console.log('[Arena Throw]', response);
                    if (response.success) {
                        isGrabbing = false;
                        updateGrabButtonState();
                    }
                });
            } else {
                // Try to grab
                socket.emit('arena-grab', (response) => {
                    console.log('[Arena Grab]', response);
                    if (response.success) {
                        isGrabbing = true;
                        updateGrabButtonState();
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
    
    escapeProgress += (100 / escapeThreshold);
    console.log('[Escape] Progress:', escapeProgress);
    
    // Update progress bar
    const fill = document.getElementById('escape-fill');
    if (fill) {
        fill.style.width = Math.min(100, escapeProgress) + '%';
    }
    
    // Haptic feedback
    triggerHaptic();
    
    // Check if escaped
    if (escapeProgress >= 100) {
        console.log('[Escape] Attempting to escape from grab!');
        socket.emit('arena-escape', (response) => {
            console.log('[Escape] Server response:', response);
            if (response && response.success) {
                console.log('[Escape] Successfully escaped!');
                isGrabbed = false;
                hideEscapeUI();
            } else {
                console.log('[Escape] Failed to escape:', response?.error);
                // Reset progress and let them try again
                escapeProgress = 50; // Don't reset fully, they were close
                const fill = document.getElementById('escape-fill');
                if (fill) fill.style.width = '50%';
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

