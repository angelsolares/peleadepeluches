/**
 * Pelea de Peluches - WebSocket Server
 * Handles multiplayer game sessions with mobile controllers
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import LobbyManager from './lobbyManager.js';
import GameStateManager from './gameState.js';

// Configuration
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

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

// Game tick intervals per room
const gameLoops = new Map();

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
     */
    socket.on('create-room', (callback) => {
        const result = lobbyManager.createRoom(socket.id);
        
        if (result.success) {
            socket.join(result.roomCode);
            console.log(`[Socket] Room ${result.roomCode} created`);
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
            // Notify all players in room
            io.to(roomCode).emit('game-started', result);
            
            // Start game loop for this room
            startGameLoop(roomCode);
            
            console.log(`[Socket] Game started in room ${roomCode}`);
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
    socket.on('select-character', (characterId, callback) => {
        const result = lobbyManager.selectCharacter(socket.id, characterId);
        
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
     */
    socket.on('player-taunt', () => {
        const roomCode = lobbyManager.getRoomCodeBySocketId(socket.id);
        if (!roomCode) return;
        
        // Broadcast taunt to all clients
        io.to(roomCode).emit('player-taunting', {
            playerId: socket.id
        });
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
 * Handle player disconnect/leave
 */
function handleDisconnect(socket) {
    const result = lobbyManager.leaveRoom(socket.id);
    
    if (result.success) {
        if (result.roomClosed) {
            // Room was closed (host left)
            stopGameLoop(result.roomCode);
            
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
                    io.to(roomCode).emit('game-over', gameOver);
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

