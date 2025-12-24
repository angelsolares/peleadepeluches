/**
 * Pelea de Peluches - WebSocket Server
 * Handles multiplayer game sessions with mobile controllers
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import LobbyManager from './lobbyManager.js';
import GameStateManager from './gameState.js';
import ArenaStateManager from './arenaState.js';
import { RaceStateManager } from './raceState.js';
import { FlappyStateManager } from './flappyState.js';

// ES Module dirname support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from parent directory (project root)
const projectRoot = path.join(__dirname, '..');
app.use('/assets', express.static(path.join(projectRoot, 'assets')));
app.use('/mobile', express.static(path.join(projectRoot, 'mobile')));

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ['GET', 'POST']
    }
});

// Initialize managers
const lobbyManager = new LobbyManager();
const gameStateManager = new GameStateManager(lobbyManager);
const arenaStateManager = new ArenaStateManager(lobbyManager);
const raceStateManager = new RaceStateManager(lobbyManager);
const flappyStateManager = new FlappyStateManager();

// Set up flappy game end callback for tournament handling
flappyStateManager.setOnGameEndCallback((roomCode, winner, results, io) => {
    const room = lobbyManager.rooms.get(roomCode);
    
    if (room && room.tournamentRounds > 1 && winner) {
        const roundResult = handleRoundEndFlappy(
            roomCode, 
            winner.id, 
            winner.name,
            'flappy'
        );
        
        if (roundResult.action === 'tournament-end') {
            io.to(roomCode).emit('tournament-ended', {
                ...roundResult,
                gameMode: 'flappy',
                flappyWinner: winner,
                results: results
            });
            return false; // Don't emit default game-over
        } else if (roundResult.action === 'round-end') {
            io.to(roomCode).emit('round-ended', {
                ...roundResult,
                gameMode: 'flappy',
                flappyWinner: winner,
                results: results
            });
            // Start next round after 5 seconds
            setTimeout(() => startNextRoundFlappy(roomCode), 5000);
            return false; // Don't emit default game-over
        }
    }
    
    return true; // Emit default game-over
});

// Flappy tournament helper (defined early for callback)
function handleRoundEndFlappy(roomCode, winnerId, winnerName, gameMode) {
    const room = lobbyManager.rooms.get(roomCode);
    if (!room) return { action: 'none' };
    
    // Record round winner
    const result = lobbyManager.recordRoundWinner(roomCode, winnerId, winnerName);
    
    if (!result.success) {
        return { action: 'none' };
    }
    
    if (result.isTournamentOver) {
        return {
            action: 'tournament-end',
            tournamentWinner: result.tournamentWinner,
            playerScores: result.playerScores,
            roundWinners: result.roundWinners,
            totalRounds: result.totalRounds
        };
    } else {
        return {
            action: 'round-end',
            currentRound: result.currentRound,
            totalRounds: result.totalRounds,
            roundWinner: winnerName,
            roundWinnerId: winnerId,
            playerScores: result.playerScores
        };
    }
}

function startNextRoundFlappy(roomCode) {
    const room = lobbyManager.rooms.get(roomCode);
    if (!room) return;
    
    // Advance to next round
    const advanceResult = lobbyManager.advanceRound(roomCode);
    if (!advanceResult.success) return;
    
    console.log(`[Tournament] Starting flappy round ${advanceResult.currentRound} in room ${roomCode}`);
    
    // Emit round-starting event
    io.to(roomCode).emit('round-starting', {
        round: advanceResult.currentRound,
        totalRounds: advanceResult.totalRounds
    });
    
    // Get players for the new round
    const players = Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        number: p.number,
        color: p.color,
        character: p.character || 'edgar'
    }));
    
    // Small delay before actually starting
    setTimeout(() => {
        // Reinitialize flappy game
        flappyStateManager.initializeGame(roomCode, players);
        flappyStateManager.startCountdown(roomCode, io);
        
        // Get tournament state
        const tournamentState = lobbyManager.getTournamentState(roomCode);
        
        // Emit game-started for the new round
        io.to(roomCode).emit('game-started', {
            success: true,
            players: players,
            gameMode: 'flappy',
            tournamentRounds: tournamentState?.tournamentRounds || 1,
            currentRound: tournamentState?.currentRound || 1,
            playerScores: tournamentState?.playerScores || {}
        });
    }, 1000);
}

// Game tick intervals per room
const gameLoops = new Map();

// Arena game loops (separate from smash)
const arenaLoops = new Map();

// Race game loops
const raceLoops = new Map();

// Flappy game loops
const flappyLoops = new Map();

// =================================
// REST API Endpoints
// =================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        rooms: lobbyManager.rooms.size,
        timestamp: Date.now()
    });
});

// Get room info (for QR code generation)
app.get('/api/room/:code', (req, res) => {
    const roomInfo = lobbyManager.getRoomInfo(req.params.code.toUpperCase());
    
    if (roomInfo) {
        res.json(roomInfo);
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// =================================
// Socket.IO Event Handlers
// =================================

io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);
    
    // ========== HOST EVENTS (Main Screen) ==========
    
    /**
     * Create a new game room
     * @param {object|function} dataOrCallback - Either { gameMode: 'smash'|'arena' } or callback for backward compatibility
     * @param {function} callback - Callback function
     */
    socket.on('create-room', (dataOrCallback, callback) => {
        console.log('[Socket] create-room called with:', typeof dataOrCallback, typeof callback);
        
        // Handle both old format (just callback) and new format (data + callback)
        let gameMode = 'smash';
        let actualCallback = callback;
        
        if (typeof dataOrCallback === 'function') {
            // Old format: create-room with just callback
            actualCallback = dataOrCallback;
            console.log('[Socket] Using old format (callback only)');
        } else if (dataOrCallback && typeof dataOrCallback === 'object') {
            // New format: create-room with data object
            gameMode = dataOrCallback.gameMode || 'smash';
            console.log('[Socket] Using new format with gameMode:', gameMode);
        }
        
        const result = lobbyManager.createRoom(socket.id, gameMode);
        console.log('[Socket] createRoom result:', result);
        
        if (result.success) {
            socket.join(result.roomCode);
            console.log(`[Socket] Room ${result.roomCode} created with mode: ${gameMode}`);
        }
        
        console.log('[Socket] Calling callback:', typeof actualCallback);
        if (typeof actualCallback === 'function') {
            actualCallback(result);
            console.log('[Socket] Callback called with result');
        } else {
            console.log('[Socket] No callback to call!');
        }
    });
    
    /**
     * Set tournament rounds (host only)
     */
    socket.on('set-tournament-rounds', (rounds, callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        
        if (!roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Not in a room' });
            }
            return;
        }
        
        const room = lobbyManager.rooms.get(roomCode);
        
        if (room.hostId !== socket.id) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Only host can set rounds' });
            }
            return;
        }
        
        const result = lobbyManager.setTournamentRounds(roomCode, rounds);
        
        if (result.success) {
            // Notify all players in room about tournament config
            io.to(roomCode).emit('tournament-config', {
                tournamentRounds: rounds,
                currentRound: 1
            });
            console.log(`[Socket] Tournament rounds set to ${rounds} in room ${roomCode}`);
        }
        
        if (typeof callback === 'function') {
            callback(result);
        }
    });
    
    /**
     * Start the game (host only)
     */
    socket.on('start-game', (callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        
        if (!roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Not in a room' });
            }
            return;
        }
        
        const room = lobbyManager.rooms.get(roomCode);
        
        if (room.hostId !== socket.id) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Only host can start the game' });
            }
            return;
        }
        
        const result = lobbyManager.startGame(roomCode);
        
        if (result.success) {
            // Prepare players data with correct character names
            let playersData = result.players;
            if (room.gameMode === 'race') {
                // For race mode, use character name as display name
                playersData = result.players.map(p => ({
                    ...p,
                    name: p.characterName || (p.character ? p.character.charAt(0).toUpperCase() + p.character.slice(1) : p.name)
                }));
            }
            
            // Get tournament state
            const tournamentState = lobbyManager.getTournamentState(roomCode);
            
            // Notify all players in room
            io.to(roomCode).emit('game-started', {
                ...result,
                players: playersData,
                gameMode: room.gameMode || 'smash',
                // Include tournament info
                tournamentRounds: tournamentState?.tournamentRounds || 1,
                currentRound: tournamentState?.currentRound || 1,
                playerScores: tournamentState?.playerScores || {}
            });
            
            // Start appropriate game loop based on mode
            if (room.gameMode === 'arena') {
                // Initialize arena state
                arenaStateManager.initializeArena(roomCode);
                startArenaLoop(roomCode);
                console.log(`[Socket] Arena game started in room ${roomCode}`);
            } else if (room.gameMode === 'race') {
                // Initialize race state and start countdown
                console.log(`[Socket] Race game starting in room ${roomCode}`);
                raceStateManager.initializeRace(roomCode);
                
                // Start countdown (with callback to start race loop)
                raceStateManager.startCountdown(roomCode, io, () => {
                    startRaceLoop(roomCode);
                });
            } else if (room.gameMode === 'flappy') {
                // Initialize flappy state and start countdown
                console.log(`[Socket] Flappy game starting in room ${roomCode}`);
                flappyStateManager.initializeGame(roomCode, result.players);
                flappyStateManager.startCountdown(roomCode, io);
            } else {
                // Start smash game loop
                startGameLoop(roomCode);
                console.log(`[Socket] Smash game started in room ${roomCode}`);
            }
        }
        
        if (typeof callback === 'function') {
            callback(result);
        }
    });
    
    // ========== PLAYER EVENTS (Mobile Controller) ==========
    
    /**
     * Join an existing room
     */
    socket.on('join-room', (data, callback) => {
        const { roomCode, playerName } = data;
        
        const result = lobbyManager.joinRoom(roomCode, socket.id, playerName);
        
        if (result.success) {
            socket.join(roomCode.toUpperCase());
            
            // Notify room of new player
            socket.to(roomCode.toUpperCase()).emit('player-joined', {
                player: result.player,
                room: result.room
            });
            
            console.log(`[Socket] Player ${playerName} joined room ${roomCode}`);
        }
        
        if (typeof callback === 'function') {
            callback(result);
        }
    });
    
    /**
     * Player ready toggle
     */
    socket.on('player-ready', (ready, callback) => {
        const result = lobbyManager.setPlayerReady(socket.id, ready);
        
        if (result.success) {
            const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
            
            // Notify room of ready status change
            io.to(roomCode).emit('player-ready-changed', {
                playerId: socket.id,
                ready: ready,
                allReady: result.allReady,
                room: result.room
            });
        }
        
        if (typeof callback === 'function') {
            callback(result);
        }
    });
    
    /**
     * Select character (mobile player)
     */
    socket.on('select-character', (data, callback) => {
        // Support both old format (string) and new format (object with characterId and characterName)
        const characterId = typeof data === 'string' ? data : data.characterId;
        const characterName = typeof data === 'object' ? data.characterName : null;
        
        const result = lobbyManager.selectCharacter(socket.id, characterId, characterName);
        
        if (result.success) {
            const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
            
            // Notify all players in room about the character selection
            io.to(roomCode).emit('character-selected', {
                playerId: socket.id,
                playerName: result.player.name,
                character: characterId
            });
            
            console.log(`[Socket] Player ${result.player.name} selected ${characterId} in room ${roomCode}`);
        }
        
        if (typeof callback === 'function') {
            callback(result);
        }
    });
    
    /**
     * Player input update (from mobile controller)
     */
    socket.on('player-input', (input) => {
        const result = lobbyManager.updatePlayerInput(socket.id, input);
        
        if (result) {
            const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
            const room = lobbyManager.rooms.get(roomCode);
            
            // Forward to host for visual feedback (both lobby and playing)
            if (room && room.hostId) {
                io.to(room.hostId).emit('player-input-update', result);
            }
        }
    });
    
    /**
     * Player attack action
     * Queue attack for processing after active frame delay
     */
    socket.on('player-attack', (attackType, callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        
        if (!roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Not in a room' });
            }
            return;
        }
        
        // Queue the attack (doesn't process hit immediately)
        const attackInfo = gameStateManager.queueAttack(socket.id, attackType, roomCode);
        
        if (attackInfo) {
            // Immediately broadcast attack-started for animation
            // Hit detection will happen after activeFrameDelay in game loop
            io.to(roomCode).emit('attack-started', attackInfo);
        }
        
        if (typeof callback === 'function') {
            callback({ success: !!attackInfo, attackInfo });
        }
    });
    
    /**
     * Player block state change
     */
    socket.on('player-block', (isBlocking) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) return;
        
        // Update player's blocking state on server
        gameStateManager.setPlayerBlocking(socket.id, roomCode, isBlocking);
        
        // Broadcast block state to all clients in room
        io.to(roomCode).emit('player-block-state', {
            playerId: socket.id,
            isBlocking: isBlocking
        });
    });
    
    /**
     * Player taunt action (Hip Hop Dance!)
     * While taunting, stamina regenerates faster
     */
    socket.on('player-taunt', () => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) return;
        
        // Update arena state for stamina boost
        arenaStateManager.setPlayerTaunting(socket.id, roomCode, true);
        
        // Broadcast taunt to all clients
        io.to(roomCode).emit('player-taunting', {
            playerId: socket.id
        });
        
        // Taunt lasts for 3 seconds for stamina boost
        setTimeout(() => {
            arenaStateManager.setPlayerTaunting(socket.id, roomCode, false);
        }, 3000);
    });
    
    // ========== ARENA MODE EVENTS ==========
    
    /**
     * Arena attack action (punch/kick with 360 detection)
     */
    socket.on('arena-attack', (attackType, callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        
        if (!roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Not in a room' });
            }
            return;
        }
        
        const attackInfo = arenaStateManager.queueAttack(socket.id, attackType, roomCode);
        
        if (attackInfo) {
            // Broadcast attack started for animation
            io.to(roomCode).emit('arena-attack-started', attackInfo);
        }
        
        if (typeof callback === 'function') {
            callback({ success: !!attackInfo, attackInfo });
        }
    });
    
    /**
     * Arena grab attempt
     */
    socket.on('arena-grab', (callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        
        if (!roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Not in a room' });
            }
            return;
        }
        
        const grabInfo = arenaStateManager.processGrab(socket.id, roomCode);
        
        if (grabInfo) {
            io.to(roomCode).emit('arena-grab', grabInfo);
        }
        
        if (typeof callback === 'function') {
            callback({ success: !!grabInfo, grabInfo });
        }
    });
    
    /**
     * Arena throw (when grabbing another player)
     */
    socket.on('arena-throw', (direction, callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        
        if (!roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Not in a room' });
            }
            return;
        }
        
        const throwInfo = arenaStateManager.processThrow(socket.id, roomCode, direction);
        
        if (throwInfo) {
            io.to(roomCode).emit('arena-throw', throwInfo);
            
            // Check if throw killed the target
            if (throwInfo.eliminated) {
                io.to(roomCode).emit('arena-elimination', {
                    playerId: throwInfo.targetId,
                    playerName: throwInfo.targetName || 'Player',
                    reason: 'knockout',
                    eliminatedBy: socket.id
                });
            }
        }
        
        if (typeof callback === 'function') {
            callback({ success: !!throwInfo, throwInfo });
        }
    });
    
    /**
     * Arena block state
     */
    socket.on('arena-block', (isBlocking) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) return;
        
        arenaStateManager.setPlayerBlocking(socket.id, roomCode, isBlocking);
        
        io.to(roomCode).emit('arena-block-state', {
            playerId: socket.id,
            isBlocking: isBlocking
        });
    });
    
    /**
     * Arena escape from grab
     */
    socket.on('arena-escape', (callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) {
            return callback?.({ success: false, error: 'Not in room' });
        }
        
        const result = arenaStateManager.processEscape(socket.id, roomCode);
        callback?.(result);
        
        if (result.success) {
            // Broadcast escape to all clients
            io.to(roomCode).emit('arena-grab-escape', {
                targetId: socket.id,
                grabberId: result.grabberId
            });
        }
    });
    
    // ========== RACE MODE EVENTS ==========
    
    /**
     * Start race (host only)
     */
    socket.on('start-race', () => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) return;
        
        const room = lobbyManager.rooms.get(roomCode);
        if (!room || room.host !== socket.id) {
            console.log('[Race] Non-host tried to start race');
            return;
        }
        
        console.log(`[Race] Manual start-race called for room ${roomCode}`);
        
        // This event is now handled by start-game for consistency
        // But we keep it for backward compatibility
        const raceState = raceStateManager.raceStates.get(roomCode);
        if (!raceState) {
            // Race not initialized yet, do it now
            raceStateManager.initializeRace(roomCode);
            raceStateManager.startCountdown(roomCode, io, () => {
                startRaceLoop(roomCode);
            });
        }
    });
    
    /**
     * Race tap input (left/right foot)
     */
    socket.on('race-tap', (side) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) return;
        
        const result = raceStateManager.processTap(socket.id, roomCode, side);
        
        // Optionally send feedback to the tapper
        if (result) {
            socket.emit('race-tap-result', result);
        }
    });
    
    // ========== FLAPPY MODE EVENTS ==========
    
    /**
     * Flappy tap (flap wings)
     */
    socket.on('flappy-tap', () => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) return;
        
        flappyStateManager.processFlap(roomCode, socket.id);
    });
    
    // ========== COMMON EVENTS ==========
    
    /**
     * Leave room
     */
    socket.on('leave-room', (callback) => {
        const result = handleDisconnect(socket);
        
        if (typeof callback === 'function') {
            callback(result);
        }
    });
    
    /**
     * Request rematch
     */
    socket.on('request-rematch', (callback) => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        
        if (!roomCode) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'Not in a room' });
            }
            return;
        }
        
        const result = gameStateManager.resetGame(roomCode);
        
        if (result.success) {
            stopGameLoop(roomCode);
            io.to(roomCode).emit('game-reset', result);
        }
        
        if (typeof callback === 'function') {
            callback(result);
        }
    });
    
    /**
     * Handle disconnection
     */
    socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
        handleDisconnect(socket);
    });
});

// =================================
// Helper Functions
// =================================

/**
 * Handle round/tournament end logic
 * @param {string} roomCode - Room code
 * @param {string} winnerId - Winner's socket ID
 * @param {string} winnerName - Winner's name
 * @param {string} gameMode - Game mode
 * @returns {object} Result with next action
 */
function handleRoundEnd(roomCode, winnerId, winnerName, gameMode) {
    const room = lobbyManager.rooms.get(roomCode);
    if (!room) return { action: 'none' };
    
    // Record round winner
    const result = lobbyManager.recordRoundWinner(roomCode, winnerId, winnerName);
    
    if (!result.success) {
        return { action: 'none' };
    }
    
    if (result.isTournamentOver) {
        // Tournament is over
        return {
            action: 'tournament-end',
            tournamentWinner: result.tournamentWinner,
            playerScores: result.playerScores,
            roundWinners: result.roundWinners,
            totalRounds: result.totalRounds
        };
    } else {
        // More rounds to play
        return {
            action: 'round-end',
            currentRound: result.currentRound,
            totalRounds: result.totalRounds,
            roundWinner: winnerName,
            roundWinnerId: winnerId,
            playerScores: result.playerScores
        };
    }
}

/**
 * Start next round after delay
 * @param {string} roomCode - Room code
 * @param {string} gameMode - Game mode
 */
function startNextRound(roomCode, gameMode) {
    const room = lobbyManager.rooms.get(roomCode);
    if (!room) return;
    
    // Advance to next round
    const advanceResult = lobbyManager.advanceRound(roomCode);
    if (!advanceResult.success) return;
    
    console.log(`[Tournament] Starting round ${advanceResult.currentRound} in room ${roomCode}`);
    
    // Emit round-starting event
    io.to(roomCode).emit('round-starting', {
        round: advanceResult.currentRound,
        totalRounds: advanceResult.totalRounds
    });
    
    // Get players for the new round
    const players = Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        number: p.number,
        color: p.color,
        character: p.character || 'edgar'
    }));
    
    // Small delay before actually starting
    setTimeout(() => {
        // Reinitialize game state based on mode
        if (gameMode === 'arena') {
            arenaStateManager.initializeArena(roomCode);
            stopArenaLoop(roomCode);
            startArenaLoop(roomCode);
        } else if (gameMode === 'race') {
            raceStateManager.initializeRace(roomCode);
            stopRaceLoop(roomCode);
            raceStateManager.startCountdown(roomCode, io, () => {
                startRaceLoop(roomCode);
            });
        } else if (gameMode === 'flappy') {
            flappyStateManager.initializeGame(roomCode, players);
            flappyStateManager.startCountdown(roomCode, io);
        } else {
            // Smash mode
            stopGameLoop(roomCode);
            startGameLoop(roomCode);
        }
        
        // Get tournament state
        const tournamentState = lobbyManager.getTournamentState(roomCode);
        
        // Emit game-started for the new round
        io.to(roomCode).emit('game-started', {
            success: true,
            players: players,
            gameMode: gameMode,
            tournamentRounds: tournamentState?.tournamentRounds || 1,
            currentRound: tournamentState?.currentRound || 1,
            playerScores: tournamentState?.playerScores || {}
        });
    }, 1000);
}

/**
 * Handle player disconnect/leave
 */
function handleDisconnect(socket) {
    const result = lobbyManager.leaveRoom(socket.id);
    
    if (result.success) {
        if (result.roomClosed) {
            // Room was closed (host left)
            stopGameLoop(result.roomCode);
            stopArenaLoop(result.roomCode);
            stopRaceLoop(result.roomCode);
            stopFlappyLoop(result.roomCode);
            
            // Notify all players
            result.affectedPlayers.forEach(playerId => {
                io.to(playerId).emit('room-closed', {
                    reason: 'Host disconnected'
                });
            });
        } else {
            // Regular player left
            io.to(result.roomCode).emit('player-left', {
                playerId: socket.id,
                player: result.player,
                room: result.room
            });
        }
    }
    
    return result;
}

/**
 * Start game loop for a room
 */
function startGameLoop(roomCode) {
    // Stop existing loop if any
    stopGameLoop(roomCode);
    
    const tickRate = 1000 / 60; // 60 FPS
    
    const loop = setInterval(() => {
        const state = gameStateManager.processTick(roomCode);
        
        if (state) {
            // Send state to all clients in room
            io.to(roomCode).emit('game-state', state);
            
            // Process pending attacks (active frames system)
            const attackResults = gameStateManager.processPendingAttacks(roomCode);
            for (const result of attackResults) {
                // Broadcast hit results
                io.to(roomCode).emit('attack-hit', result);
            }
            
            // Check for KOs
            const kos = gameStateManager.checkKOs(roomCode);
            if (kos.length > 0) {
                io.to(roomCode).emit('player-ko', kos);
                
                // Check for game over
                const gameOver = gameStateManager.checkGameOver(roomCode);
                if (gameOver) {
                    stopGameLoop(roomCode);
                    
                    // Handle tournament logic
                    const room = lobbyManager.rooms.get(roomCode);
                    if (room && room.tournamentRounds > 1) {
                        const roundResult = handleRoundEnd(
                            roomCode, 
                            gameOver.winner?.id, 
                            gameOver.winner?.name,
                            'smash'
                        );
                        
                        if (roundResult.action === 'tournament-end') {
                            io.to(roomCode).emit('tournament-ended', roundResult);
                        } else if (roundResult.action === 'round-end') {
                            io.to(roomCode).emit('round-ended', roundResult);
                            // Start next round after 5 seconds
                            setTimeout(() => startNextRound(roomCode, 'smash'), 5000);
                        }
                    } else {
                        // Single round, just emit game-over
                        io.to(roomCode).emit('game-over', gameOver);
                    }
                }
            }
        } else {
            // Room no longer active
            stopGameLoop(roomCode);
        }
    }, tickRate);
    
    gameLoops.set(roomCode, loop);
    console.log(`[Game] Started game loop for room ${roomCode}`);
}

/**
 * Stop game loop for a room
 */
function stopGameLoop(roomCode) {
    const loop = gameLoops.get(roomCode);
    
    if (loop) {
        clearInterval(loop);
        gameLoops.delete(roomCode);
        console.log(`[Game] Stopped game loop for room ${roomCode}`);
    }
}

/**
 * Start arena game loop for a room
 */
function startArenaLoop(roomCode) {
    // Stop existing loop if any
    stopArenaLoop(roomCode);
    
    const tickRate = 1000 / 60; // 60 FPS
    
    const loop = setInterval(() => {
        const state = arenaStateManager.processTick(roomCode);
        
        if (state) {
            // Send state to all clients in room
            io.to(roomCode).emit('arena-state', state);
            
            // Process pending attacks (active frames system)
            const attackResults = arenaStateManager.processPendingAttacks(roomCode);
            for (const result of attackResults) {
                io.to(roomCode).emit('arena-attack-hit', result);
                
                // Check for eliminations in this attack
                if (result.hits) {
                    for (const hit of result.hits) {
                        if (hit.eliminated) {
                            const eliminatedPlayer = state.players.find(p => p.id === hit.targetId);
                            if (eliminatedPlayer) {
                                io.to(roomCode).emit('arena-elimination', {
                                    playerId: hit.targetId,
                                    playerName: eliminatedPlayer.name,
                                    playerNumber: eliminatedPlayer.number,
                                    reason: 'knockout',
                                    eliminatedBy: result.attackerId
                                });
                            }
                        }
                    }
                }
            }
            
            // Check for ring out eliminations
            const ringOuts = arenaStateManager.checkRingOuts(roomCode);
            for (const ringOut of ringOuts) {
                io.to(roomCode).emit('arena-elimination', ringOut);
            }
            
            // Check for game over
            const gameOver = arenaStateManager.checkGameOver(roomCode);
            if (gameOver) {
                stopArenaLoop(roomCode);
                
                // Handle tournament logic
                const room = lobbyManager.rooms.get(roomCode);
                if (room && room.tournamentRounds > 1) {
                    const roundResult = handleRoundEnd(
                        roomCode, 
                        gameOver.winner?.id, 
                        gameOver.winner?.name,
                        'arena'
                    );
                    
                    if (roundResult.action === 'tournament-end') {
                        io.to(roomCode).emit('tournament-ended', {
                            ...roundResult,
                            gameMode: 'arena'
                        });
                    } else if (roundResult.action === 'round-end') {
                        io.to(roomCode).emit('round-ended', {
                            ...roundResult,
                            gameMode: 'arena'
                        });
                        // Start next round after 5 seconds
                        setTimeout(() => startNextRound(roomCode, 'arena'), 5000);
                    }
                } else {
                    // Single round, just emit game-over
                    io.to(roomCode).emit('arena-game-over', gameOver);
                }
            }
        } else {
            // Room no longer active
            stopArenaLoop(roomCode);
        }
    }, tickRate);
    
    arenaLoops.set(roomCode, loop);
    console.log(`[Arena] Started arena loop for room ${roomCode}`);
}

/**
 * Stop arena game loop for a room
 */
function stopArenaLoop(roomCode) {
    const loop = arenaLoops.get(roomCode);
    
    if (loop) {
        clearInterval(loop);
        arenaLoops.delete(roomCode);
        console.log(`[Arena] Stopped arena loop for room ${roomCode}`);
    }
}

/**
 * Start race game loop for a room
 */
function startRaceLoop(roomCode) {
    if (raceLoops.has(roomCode)) {
        console.log(`[Race] Loop already exists for room ${roomCode}`);
        return;
    }
    
    const tickRate = 1000 / 30; // 30 FPS for race
    let lastTime = Date.now();
    
    const loop = setInterval(() => {
        const now = Date.now();
        const delta = (now - lastTime) / 1000; // Delta in seconds
        lastTime = now;
        
        const state = raceStateManager.processTick(roomCode, delta);
        
        if (state) {
            // Send state to all clients in room
            io.to(roomCode).emit('race-state', state);
            
            // Check for race finish (first player crossed)
            if (state.finishOrder && state.finishOrder.length > 0) {
                const latestFinisher = state.players.find(p => 
                    p.id === state.finishOrder[state.finishOrder.length - 1] && p.finished
                );
                if (latestFinisher) {
                    io.to(roomCode).emit('race-finish', {
                        playerId: latestFinisher.id,
                        time: latestFinisher.finishTime,
                        position: latestFinisher.finishPosition
                    });
                }
            }
            
            // Check for race over
            if (state.raceOver) {
                stopRaceLoop(roomCode);
                const winnerInfo = raceStateManager.getWinnerInfo(roomCode);
                
                // Handle tournament logic
                const room = lobbyManager.rooms.get(roomCode);
                if (room && room.tournamentRounds > 1 && winnerInfo) {
                    const roundResult = handleRoundEnd(
                        roomCode, 
                        winnerInfo.id, 
                        winnerInfo.name,
                        'race'
                    );
                    
                    if (roundResult.action === 'tournament-end') {
                        io.to(roomCode).emit('tournament-ended', {
                            ...roundResult,
                            gameMode: 'race',
                            raceWinner: winnerInfo
                        });
                    } else if (roundResult.action === 'round-end') {
                        io.to(roomCode).emit('round-ended', {
                            ...roundResult,
                            gameMode: 'race',
                            raceWinner: winnerInfo
                        });
                        // Start next round after 5 seconds
                        setTimeout(() => startNextRound(roomCode, 'race'), 5000);
                    }
                } else if (winnerInfo) {
                    // Single round, just emit race-winner
                    io.to(roomCode).emit('race-winner', winnerInfo);
                }
                raceStateManager.endRace(roomCode);
            }
        }
    }, tickRate);
    
    raceLoops.set(roomCode, loop);
    console.log(`[Race] Started race loop for room ${roomCode}`);
}

/**
 * Stop race game loop for a room
 */
function stopRaceLoop(roomCode) {
    const loop = raceLoops.get(roomCode);
    
    if (loop) {
        clearInterval(loop);
        raceLoops.delete(roomCode);
        console.log(`[Race] Stopped race loop for room ${roomCode}`);
    }
}

/**
 * Start flappy game loop for a room (called by FlappyStateManager)
 */
function startFlappyLoop(roomCode) {
    // Flappy loop is started inside FlappyStateManager.startGame()
    // This function exists for consistency but is not directly used
    console.log(`[Flappy] Game loop handled by FlappyStateManager for room ${roomCode}`);
}

/**
 * Stop flappy game loop for a room
 */
function stopFlappyLoop(roomCode) {
    flappyStateManager.removeGame(roomCode);
    console.log(`[Flappy] Stopped flappy game for room ${roomCode}`);
}

// =================================
// Cleanup Task
// =================================

// Clean up abandoned rooms every 5 minutes
setInterval(() => {
    lobbyManager.cleanupRooms();
}, 5 * 60 * 1000);

// =================================
// Start Server
// =================================

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🥊 PELEA DE PELUCHES - WebSocket Server                 ║
║                                                           ║
║   Server running on port ${PORT}                           ║
║   Ready for connections!                                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

export { io, lobbyManager, gameStateManager };

