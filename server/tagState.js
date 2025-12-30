/**
 * Tag (La Trae) State Manager
 * Server-side game state and physics for Tag mode
 * Handles "It" status, penalty timers, and grace periods
 */

const TAG_CONFIG = {
    MAP_SIZE: 20,           // Width/depth of the play area
    BOUNDARY: 9.5,          // Practical boundary for players
    TAG_RANGE: 1.5,         // Distance for a successful tag
    GRACE_PERIOD: 3000,     // 3 seconds immunity after being "It"
    MATCH_DURATION: 120,    // 120 seconds per match
    
    // Physics
    MOVE_SPEED: 7,
    IT_SPEED_BOOST: 1.1,    // "It" is 10% faster
    FRICTION: 0.85,
    
    // Initial positions
    SPAWN_RADIUS: 7
};

class TagStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.tagStates = new Map();
    }

    /**
     * Initialize tag state for a room
     * @param {string} roomCode - Room code
     */
    initializeTag(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room || room.gameMode !== 'tag') return null;

        const tagState = {
            roomCode,
            players: new Map(),
            startTime: Date.now(),
            matchDuration: TAG_CONFIG.MATCH_DURATION * 1000,
            remainingTime: TAG_CONFIG.MATCH_DURATION * 1000,
            itPlayerId: null,
            lastTagTime: 0,
            gameState: 'active', // 'active', 'finished'
            eliminationOrder: []
        };

        // Initialize players
        const playersArray = Array.from(room.players.keys());
        const totalPlayers = playersArray.length;
        
        // Randomly pick who starts as "It"
        const itIndex = Math.floor(Math.random() * totalPlayers);
        tagState.itPlayerId = playersArray[itIndex];

        playersArray.forEach((socketId, index) => {
            const player = room.players.get(socketId);
            const playerState = this.createPlayerTagState(player, index, totalPlayers);
            
            if (socketId === tagState.itPlayerId) {
                playerState.isIt = true;
            }
            
            tagState.players.set(socketId, playerState);
        });

        this.tagStates.set(roomCode, tagState);
        return tagState;
    }

    /**
     * Create initial tag state for a player
     */
    createPlayerTagState(player, index, totalPlayers) {
        const angle = (index / totalPlayers) * Math.PI * 2;
        const x = Math.cos(angle) * TAG_CONFIG.SPAWN_RADIUS;
        const z = Math.sin(angle) * TAG_CONFIG.SPAWN_RADIUS;

        return {
            id: player.id,
            name: player.name,
            number: player.number,
            color: player.color,
            position: { x, y: 0, z },
            velocity: { x: 0, y: 0, z: 0 },
            facingAngle: 0,
            isIt: false,
            penaltyTime: 0,      // Total time being "It" (ms)
            graceUntil: 0,       // Timestamp until immunity expires
            lastProcessedTime: Date.now(),
            input: {
                left: false,
                right: false,
                up: false,
                down: false,
                run: false
            }
        };
    }

    /**
     * Process a game tick
     */
    processTick(roomCode) {
        const tagState = this.tagStates.get(roomCode);
        if (!tagState || tagState.gameState !== 'active') return null;

        const now = Date.now();
        const delta = 1 / 60;
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;

        // Update remaining time
        tagState.remainingTime = Math.max(0, tagState.matchDuration - (now - tagState.startTime));
        
        if (tagState.remainingTime <= 0) {
            tagState.gameState = 'finished';
            return this.getFinalResults(tagState);
        }

        const playersForClient = [];
        const itPlayer = tagState.players.get(tagState.itPlayerId);

        // Update IT penalty time
        if (itPlayer) {
            const timeDiff = now - itPlayer.lastProcessedTime;
            itPlayer.penaltyTime += timeDiff;
        }

        // Update each player
        tagState.players.forEach((playerState, socketId) => {
            playerState.lastProcessedTime = now;
            
            const roomPlayer = room.players.get(socketId);
            if (roomPlayer) {
                playerState.input = { ...roomPlayer.input };
            }

            this.processMovement(playerState, delta);
            this.checkBoundaries(playerState);
            
            playersForClient.push(this.getPlayerStateForClient(playerState));
        });

        // Check for tags
        this.checkTags(tagState);

        return {
            roomCode,
            remainingTime: tagState.remainingTime,
            gameState: tagState.gameState,
            itPlayerId: tagState.itPlayerId,
            players: playersForClient
        };
    }

    processMovement(playerState, delta) {
        let dirX = 0, dirZ = 0;
        if (playerState.input.left) dirX -= 1;
        if (playerState.input.right) dirX += 1;
        if (playerState.input.up) dirZ -= 1;
        if (playerState.input.down) dirZ += 1;

        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (length > 0) {
            dirX /= length;
            dirZ /= length;

            let speed = TAG_CONFIG.MOVE_SPEED;
            if (playerState.isIt) {
                speed *= TAG_CONFIG.IT_SPEED_BOOST;
            }

            playerState.velocity.x = dirX * speed;
            playerState.velocity.z = dirZ * speed;
            playerState.facingAngle = Math.atan2(dirX, dirZ);
        }

        playerState.velocity.x *= TAG_CONFIG.FRICTION;
        playerState.velocity.z *= TAG_CONFIG.FRICTION;

        playerState.position.x += playerState.velocity.x * delta;
        playerState.position.z += playerState.velocity.z * delta;
    }

    checkBoundaries(playerState) {
        const b = TAG_CONFIG.BOUNDARY;
        if (playerState.position.x > b) playerState.position.x = b;
        if (playerState.position.x < -b) playerState.position.x = -b;
        if (playerState.position.z > b) playerState.position.z = b;
        if (playerState.position.z < -b) playerState.position.z = -b;
    }

    checkTags(tagState) {
        const itPlayer = tagState.players.get(tagState.itPlayerId);
        if (!itPlayer) return;

        const now = Date.now();

        tagState.players.forEach((targetState, targetId) => {
            if (targetId === tagState.itPlayerId) return;
            
            // Check if target has grace period
            if (now < targetState.graceUntil) return;

            const dx = targetState.position.x - itPlayer.position.x;
            const dz = targetState.position.z - itPlayer.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < TAG_CONFIG.TAG_RANGE) {
                this.transferIt(tagState, tagState.itPlayerId, targetId);
            }
        });
    }

    transferIt(tagState, oldItId, newItId) {
        const now = Date.now();
        const oldIt = tagState.players.get(oldItId);
        const newIt = tagState.players.get(newItId);

        if (oldIt) {
            oldIt.isIt = false;
            oldIt.graceUntil = now + TAG_CONFIG.GRACE_PERIOD;
        }

        if (newIt) {
            newIt.isIt = true;
            tagState.itPlayerId = newItId;
            tagState.lastTagTime = now;
        }

        // Notify room about the tag
        const io = this.lobbyManager.io;
        if (io) {
            io.to(tagState.roomCode).emit('tag-transfer', {
                oldItId,
                newItId,
                gracePeriod: TAG_CONFIG.GRACE_PERIOD
            });
        }
    }

    getFinalResults(tagState) {
        const players = Array.from(tagState.players.values());
        // Winner is the one with LEAST penalty time
        players.sort((a, b) => a.penaltyTime - b.penaltyTime);

        const winner = players[0];
        const ranking = players.map(p => ({
            id: p.id,
            name: p.name,
            penaltyTime: p.penaltyTime
        }));

        return {
            roomCode: tagState.roomCode,
            gameState: 'finished',
            winner: {
                id: winner.id,
                name: winner.name,
                penaltyTime: winner.penaltyTime
            },
            ranking
        };
    }

    getPlayerStateForClient(playerState) {
        return {
            id: playerState.id,
            name: playerState.name,
            number: playerState.number,
            position: { ...playerState.position },
            facingAngle: playerState.facingAngle,
            isIt: playerState.isIt,
            penaltyTime: playerState.penaltyTime,
            hasGrace: Date.now() < playerState.graceUntil
        };
    }

    cleanup(roomCode) {
        this.tagStates.delete(roomCode);
    }
}

export default TagStateManager;

