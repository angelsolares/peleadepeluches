/**
 * Lobby Manager - Handles room creation, joining, and player management
 */

// Generate a random 4-character room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing chars like 0, O, I, 1
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Player colors for differentiation
const PLAYER_COLORS = [
    '#ff3366', // Pink
    '#00ffcc', // Cyan
    '#ffcc00', // Yellow
    '#9966ff', // Purple
];

class LobbyManager {
    constructor() {
        // Map of roomCode -> Room object
        this.rooms = new Map();
        
        // Map of socketId -> roomCode (for quick lookup)
        this.playerRooms = new Map();
    }
    
    /**
     * Create a new room
     * @param {string} hostSocketId - Socket ID of the host (main screen)
     * @returns {object} Room info
     */
    createRoom(hostSocketId) {
        // Generate unique room code
        let roomCode;
        do {
            roomCode = generateRoomCode();
        } while (this.rooms.has(roomCode));
        
        const room = {
            code: roomCode,
            hostId: hostSocketId,
            players: new Map(),
            state: 'lobby', // 'lobby', 'playing', 'finished'
            maxPlayers: 4,
            createdAt: Date.now()
        };
        
        this.rooms.set(roomCode, room);
        this.playerRooms.set(hostSocketId, roomCode);
        
        console.log(`[Lobby] Room ${roomCode} created by host ${hostSocketId}`);
        
        return {
            success: true,
            roomCode: roomCode,
            room: this.getRoomInfo(roomCode)
        };
    }
    
    /**
     * Join an existing room as a player (from mobile controller)
     * @param {string} roomCode - Room code to join
     * @param {string} socketId - Player's socket ID
     * @param {string} playerName - Player's display name
     * @returns {object} Join result
     */
    joinRoom(roomCode, socketId, playerName) {
        const room = this.rooms.get(roomCode.toUpperCase());
        
        if (!room) {
            return { success: false, error: 'Room not found' };
        }
        
        if (room.state !== 'lobby') {
            return { success: false, error: 'Game already in progress' };
        }
        
        if (room.players.size >= room.maxPlayers) {
            return { success: false, error: 'Room is full' };
        }
        
        // Check if player already in a room
        if (this.playerRooms.has(socketId)) {
            this.leaveRoom(socketId);
        }
        
        // Assign player number and color
        const playerNumber = room.players.size + 1;
        const player = {
            id: socketId,
            name: playerName || `Player ${playerNumber}`,
            number: playerNumber,
            color: PLAYER_COLORS[playerNumber - 1] || '#ffffff',
            ready: false,
            // Game state
            position: { x: (playerNumber - 2.5) * 2, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            health: 0,
            stocks: 3,
            input: {
                left: false,
                right: false,
                jump: false,
                punch: false,
                kick: false,
                run: false
            }
        };
        
        room.players.set(socketId, player);
        this.playerRooms.set(socketId, roomCode);
        
        console.log(`[Lobby] Player ${playerName} (${socketId}) joined room ${roomCode}`);
        
        return {
            success: true,
            player: player,
            room: this.getRoomInfo(roomCode)
        };
    }
    
    /**
     * Leave current room
     * @param {string} socketId - Socket ID of player leaving
     * @returns {object} Leave result
     */
    leaveRoom(socketId) {
        const roomCode = this.playerRooms.get(socketId);
        
        if (!roomCode) {
            return { success: false, error: 'Not in a room' };
        }
        
        const room = this.rooms.get(roomCode);
        
        if (!room) {
            this.playerRooms.delete(socketId);
            return { success: false, error: 'Room not found' };
        }
        
        // If host leaves, close the room
        if (room.hostId === socketId) {
            console.log(`[Lobby] Host left, closing room ${roomCode}`);
            
            // Get all players to notify
            const playerIds = [...room.players.keys()];
            
            // Clean up
            room.players.forEach((_, id) => {
                this.playerRooms.delete(id);
            });
            this.playerRooms.delete(socketId);
            this.rooms.delete(roomCode);
            
            return {
                success: true,
                roomClosed: true,
                affectedPlayers: playerIds,
                roomCode: roomCode
            };
        }
        
        // Regular player leaves
        const player = room.players.get(socketId);
        room.players.delete(socketId);
        this.playerRooms.delete(socketId);
        
        console.log(`[Lobby] Player ${player?.name} left room ${roomCode}`);
        
        return {
            success: true,
            roomClosed: false,
            player: player,
            roomCode: roomCode,
            room: this.getRoomInfo(roomCode)
        };
    }
    
    /**
     * Get room information for broadcasting
     * @param {string} roomCode - Room code
     * @returns {object|null} Room info
     */
    getRoomInfo(roomCode) {
        const room = this.rooms.get(roomCode);
        
        if (!room) return null;
        
        return {
            code: room.code,
            state: room.state,
            playerCount: room.players.size,
            maxPlayers: room.maxPlayers,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                number: p.number,
                color: p.color,
                ready: p.ready,
                character: p.character || null
            }))
        };
    }
    
    /**
     * Select character for a player
     * @param {string} socketId - Player's socket ID
     * @param {string} characterId - Character to select (e.g., 'edgar', 'isabella')
     * @returns {object} Result
     */
    selectCharacter(socketId, characterId) {
        const room = this.getRoomBySocketId(socketId);
        
        if (!room) {
            return { success: false, error: 'Not in a room' };
        }
        
        const player = room.players.get(socketId);
        
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        // Check if character is already taken by another player
        for (const [id, p] of room.players) {
            if (id !== socketId && p.character === characterId) {
                return { success: false, error: 'Character already taken' };
            }
        }
        
        // If player had a previous character, clear it first
        const previousCharacter = player.character;
        
        // Assign new character
        player.character = characterId;
        
        console.log(`[Lobby] Player ${player.name} selected character ${characterId} (was: ${previousCharacter || 'none'})`);
        
        return {
            success: true,
            player: player,
            previousCharacter: previousCharacter
        };
    }
    
    /**
     * Get room by socket ID
     * @param {string} socketId - Socket ID
     * @returns {object|null} Room object
     */
    getRoomBySocketId(socketId) {
        const roomCode = this.playerRooms.get(socketId);
        return roomCode ? this.rooms.get(roomCode) : null;
    }
    
    /**
     * Get room code by socket ID
     * @param {string} socketId - Socket ID
     * @returns {string|null} Room code
     */
    getRoomCodeBySocketId(socketId) {
        return this.playerRooms.get(socketId) || null;
    }
    
    /**
     * Set player ready status
     * @param {string} socketId - Player's socket ID
     * @param {boolean} ready - Ready status
     * @returns {object} Result
     */
    setPlayerReady(socketId, ready) {
        const room = this.getRoomBySocketId(socketId);
        
        if (!room) {
            return { success: false, error: 'Not in a room' };
        }
        
        const player = room.players.get(socketId);
        
        if (!player) {
            return { success: false, error: 'Player not found' };
        }
        
        player.ready = ready;
        
        // Check if all players are ready
        const allReady = room.players.size > 0 && 
            Array.from(room.players.values()).every(p => p.ready);
        
        return {
            success: true,
            allReady: allReady,
            room: this.getRoomInfo(room.code)
        };
    }
    
    /**
     * Start the game in a room
     * @param {string} roomCode - Room code
     * @returns {object} Result
     */
    startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        
        if (!room) {
            return { success: false, error: 'Room not found' };
        }
        
        if (room.players.size === 0) {
            return { success: false, error: 'No players in room' };
        }
        
        room.state = 'playing';
        
        // Get all mobile players (host is NOT a player, just the display screen)
        const playerArray = Array.from(room.players.values());
        
        // Initialize player positions
        playerArray.forEach((player, index) => {
            player.position = {
                x: (index - (playerArray.length - 1) / 2) * 3,
                y: 0,
                z: 0
            };
            player.health = 0;
            player.stocks = 3;
        });
        
        console.log(`[Lobby] Game started in room ${roomCode} with ${room.players.size} mobile players`);
        
        return {
            success: true,
            room: this.getRoomInfo(roomCode),
            players: playerArray.map(p => ({
                id: p.id,
                name: p.name,
                number: p.number,
                color: p.color,
                position: p.position,
                health: p.health,
                stocks: p.stocks,
                character: p.character || 'edgar'
            }))
        };
    }
    
    /**
     * Update player input from mobile controller
     * @param {string} socketId - Player's socket ID
     * @param {object} input - Input state
     */
    updatePlayerInput(socketId, input) {
        const room = this.getRoomBySocketId(socketId);
        
        if (!room) return null;
        
        const player = room.players.get(socketId);
        
        if (!player) return null;
        
        // Update input state
        player.input = { ...player.input, ...input };
        
        return {
            playerId: socketId,
            input: player.input
        };
    }
    
    /**
     * Get all player states for a room (for game sync)
     * @param {string} roomCode - Room code
     * @returns {array} Player states
     */
    getPlayerStates(roomCode) {
        const room = this.rooms.get(roomCode);
        
        if (!room) return [];
        
        return Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            number: p.number,
            color: p.color,
            position: p.position,
            velocity: p.velocity,
            health: p.health,
            stocks: p.stocks,
            input: p.input
        }));
    }
    
    /**
     * Update player game state (position, health, etc.)
     * @param {string} socketId - Player's socket ID
     * @param {object} state - Game state update
     */
    updatePlayerState(socketId, state) {
        const room = this.getRoomBySocketId(socketId);
        
        if (!room) return null;
        
        const player = room.players.get(socketId);
        
        if (!player) return null;
        
        // Update game state
        if (state.position) player.position = state.position;
        if (state.velocity) player.velocity = state.velocity;
        if (typeof state.health === 'number') player.health = state.health;
        if (typeof state.stocks === 'number') player.stocks = state.stocks;
        
        return player;
    }
    
    /**
     * Clean up old/abandoned rooms
     */
    cleanupRooms() {
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes
        
        for (const [code, room] of this.rooms) {
            if (now - room.createdAt > maxAge && room.state === 'lobby') {
                console.log(`[Lobby] Cleaning up abandoned room ${code}`);
                
                room.players.forEach((_, id) => {
                    this.playerRooms.delete(id);
                });
                this.playerRooms.delete(room.hostId);
                this.rooms.delete(code);
            }
        }
    }
}

export default LobbyManager;

