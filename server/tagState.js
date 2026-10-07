/**
 * Tag (La Trae) State Manager
 * Server-side game state and physics for Tag mode
 * Handles "It" status, penalty timers, grace periods and power-ups
 */

const TAG_CONFIG = {
    MAP_SIZE: 20,           // Width/depth of the play area
    BOUNDARY: 9.5,          // Practical boundary for players
    TAG_RANGE: 1.5,         // Distance for a successful tag
    GRACE_PERIOD: 5000,     // Increased from 3000 to 5000ms (5 seconds)
    MATCH_DURATION: 120,    // 120 seconds per match

    // Physics
    MOVE_SPEED: 7,
    IT_SPEED_BOOST: 1.1,    // "It" is 10% faster
    FRICTION: 0.85,         // Per 60 Hz tick (normalized to the real tick length)
    MAX_DELTA: 0.05,        // Longest simulated step per tick (s), e.g. after a stall

    // Initial positions
    SPAWN_RADIUS: 7,

    // Power-ups: one on the map at a time, 'rayo' (speed) or 'escudo' (can't be tagged)
    POWERUP_SPAWN_MIN: 10000,      // ms after the previous one is gone
    POWERUP_SPAWN_MAX: 14000,
    POWERUP_LIFETIME: 12000,       // ms before an uncollected power-up vanishes
    POWERUP_PICKUP_RANGE: 1.2,     // m
    POWERUP_MARGIN: 1.5,           // Spawn inside |x|,|z| <= BOUNDARY - margin
    POWERUP_PLAYER_CLEARANCE: 3,   // Never spawn this close to a player (m)
    BOOST_DURATION: 4000,          // ms
    BOOST_MULTIPLIER: 1.5,
    SHIELD_DURATION: 4000          // ms
};

const POWERUP_KINDS = ['rayo', 'escudo'];

class TagStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.tagStates = new Map();
        this.pendingEvents = new Map(); // roomCode -> [{ type, id, kind, playerId?, playerName? }]
    }

    /**
     * Initialize tag state for a room
     * @param {string} roomCode - Room code
     */
    initializeTag(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room || room.gameMode !== 'tag') return null;

        const now = Date.now();
        const tagState = {
            roomCode,
            players: new Map(),
            startTime: now,
            lastTickAt: now,
            matchDuration: TAG_CONFIG.MATCH_DURATION * 1000,
            remainingTime: TAG_CONFIG.MATCH_DURATION * 1000,
            itPlayerId: null,
            lastTagTime: 0,
            gameState: 'active', // 'active', 'finished'
            eliminationOrder: [],
            // Power-ups
            powerUp: null,                              // { id, kind, position: {x, z}, spawnedAt, expiresAt }
            nextPowerUpAt: now + this.randomSpawnDelay(),
            lastPowerUpKind: null,
            powerUpSeq: 0
        };
        this.pendingEvents.delete(roomCode);

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
            boostUntil: 0,       // 'rayo' power-up: faster until this timestamp
            shieldUntil: 0,      // 'escudo' power-up: can't be tagged until this timestamp
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
     * Queue a one-off event for the room loop to broadcast ('tag-powerup')
     */
    pushEvent(roomCode, event) {
        if (!this.pendingEvents.has(roomCode)) this.pendingEvents.set(roomCode, []);
        this.pendingEvents.get(roomCode).push(event);
    }

    /**
     * Take the queued events of a room
     * @returns {array}
     */
    drainEvents(roomCode) {
        const events = this.pendingEvents.get(roomCode) || [];
        this.pendingEvents.delete(roomCode);
        return events;
    }

    /**
     * Process a game tick
     */
    processTick(roomCode) {
        const tagState = this.tagStates.get(roomCode);
        if (!tagState || tagState.gameState !== 'active') return null;

        const now = Date.now();
        // Real elapsed time: setInterval(16.7 ms) fires at ~36 Hz on Windows, so a fixed
        // 1/60 step would move everyone ~40% slower on that host
        const delta = Math.min(TAG_CONFIG.MAX_DELTA, Math.max(0, now - tagState.lastTickAt) / 1000);
        tagState.lastTickAt = now;
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;

        // Clean up players who left the room
        for (const socketId of tagState.players.keys()) {
            if (!room.players.has(socketId)) {
                tagState.players.delete(socketId);
                // If the player who left was "It", we need to pick a new one
                if (socketId === tagState.itPlayerId) {
                    tagState.itPlayerId = null;
                }
            }
        }

        // If no players left, finish the game
        if (tagState.players.size === 0) {
            tagState.gameState = 'finished';
            return null;
        }

        // Ensure there is always someone "It"
        if (tagState.itPlayerId === null || !tagState.players.has(tagState.itPlayerId)) {
            const playerIds = Array.from(tagState.players.keys());
            if (playerIds.length > 0) {
                const newItId = playerIds[Math.floor(Math.random() * playerIds.length)];
                this.transferIt(tagState, null, newItId);
            }
        }

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

            this.processMovement(playerState, delta, now);
            this.checkBoundaries(playerState);
        });

        // Power-ups: spawn / collect / expire (before tags so a fresh shield protects at once)
        this.updatePowerUp(tagState, now);

        // Check for tags
        this.checkTags(tagState);

        tagState.players.forEach((playerState) => {
            playersForClient.push(this.getPlayerStateForClient(playerState, now));
        });

        return {
            roomCode,
            remainingTime: tagState.remainingTime,
            gameState: tagState.gameState,
            itPlayerId: tagState.itPlayerId,
            powerUp: this.getPowerUpForClient(tagState),
            players: playersForClient
        };
    }

    processMovement(playerState, delta, now = Date.now()) {
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
            if (now < playerState.boostUntil) {
                speed *= TAG_CONFIG.BOOST_MULTIPLIER;
            }

            // Walking speed is MOVE_SPEED * FRICTION (what a 60 Hz tick always produced),
            // independent of how often the loop actually fires
            playerState.velocity.x = dirX * speed * TAG_CONFIG.FRICTION;
            playerState.velocity.z = dirZ * speed * TAG_CONFIG.FRICTION;
            playerState.facingAngle = Math.atan2(dirX, dirZ);
        } else {
            // Friction normalized to the real tick length (FRICTION per 1/60 s)
            const decay = Math.pow(TAG_CONFIG.FRICTION, delta * 60);
            playerState.velocity.x *= decay;
            playerState.velocity.z *= decay;
        }

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

    // =================================
    // Power-ups
    // =================================

    randomSpawnDelay() {
        const range = TAG_CONFIG.POWERUP_SPAWN_MAX - TAG_CONFIG.POWERUP_SPAWN_MIN;
        return TAG_CONFIG.POWERUP_SPAWN_MIN + Math.random() * range;
    }

    /**
     * 50/50 between the kinds, but never two shields in a row
     */
    pickPowerUpKind(tagState) {
        if (tagState.lastPowerUpKind === 'escudo') return 'rayo';
        return POWERUP_KINDS[Math.random() < 0.5 ? 0 : 1];
    }

    /**
     * Random spot inside the boundary (minus a margin), away from every player.
     * Falls back to the candidate farthest from the players if none is clear.
     */
    pickPowerUpPosition(tagState) {
        const limit = TAG_CONFIG.BOUNDARY - TAG_CONFIG.POWERUP_MARGIN;
        const clearance = TAG_CONFIG.POWERUP_PLAYER_CLEARANCE;
        let best = null;
        let bestDistance = -1;

        for (let attempt = 0; attempt < 24; attempt++) {
            const x = (Math.random() * 2 - 1) * limit;
            const z = (Math.random() * 2 - 1) * limit;
            let nearest = Infinity;
            tagState.players.forEach((p) => {
                const dx = p.position.x - x;
                const dz = p.position.z - z;
                nearest = Math.min(nearest, Math.sqrt(dx * dx + dz * dz));
            });
            if (nearest >= clearance) return { x, z };
            if (nearest > bestDistance) {
                bestDistance = nearest;
                best = { x, z };
            }
        }
        return best || { x: 0, z: 0 };
    }

    spawnPowerUp(tagState, now) {
        const kind = this.pickPowerUpKind(tagState);
        tagState.powerUpSeq++;
        tagState.powerUp = {
            id: `pu-${tagState.powerUpSeq}`,
            kind,
            position: this.pickPowerUpPosition(tagState),
            spawnedAt: now,
            expiresAt: now + TAG_CONFIG.POWERUP_LIFETIME
        };
        tagState.lastPowerUpKind = kind;
        this.pushEvent(tagState.roomCode, { type: 'spawn', id: tagState.powerUp.id, kind });
    }

    /**
     * Remove the current power-up and arm the next spawn timer
     */
    clearPowerUp(tagState, now) {
        tagState.powerUp = null;
        tagState.nextPowerUpAt = now + this.randomSpawnDelay();
    }

    collectPowerUp(tagState, playerState, now) {
        const powerUp = tagState.powerUp;
        if (powerUp.kind === 'rayo') {
            playerState.boostUntil = now + TAG_CONFIG.BOOST_DURATION;
        } else {
            playerState.shieldUntil = now + TAG_CONFIG.SHIELD_DURATION;
        }
        this.pushEvent(tagState.roomCode, {
            type: 'collect',
            id: powerUp.id,
            kind: powerUp.kind,
            playerId: playerState.id,
            playerName: playerState.name
        });
        this.clearPowerUp(tagState, now);
    }

    updatePowerUp(tagState, now) {
        const powerUp = tagState.powerUp;

        if (!powerUp) {
            if (now >= tagState.nextPowerUpAt) this.spawnPowerUp(tagState, now);
            return;
        }

        if (now >= powerUp.expiresAt) {
            this.pushEvent(tagState.roomCode, { type: 'expire', id: powerUp.id, kind: powerUp.kind });
            this.clearPowerUp(tagState, now);
            return;
        }

        // Closest eligible player within pickup range takes it ("It" can't take a shield)
        let collector = null;
        let closest = TAG_CONFIG.POWERUP_PICKUP_RANGE;
        tagState.players.forEach((playerState) => {
            if (powerUp.kind === 'escudo' && playerState.isIt) return;
            const dx = playerState.position.x - powerUp.position.x;
            const dz = playerState.position.z - powerUp.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            if (distance <= closest) {
                closest = distance;
                collector = playerState;
            }
        });

        if (collector) this.collectPowerUp(tagState, collector, now);
    }

    getPowerUpForClient(tagState) {
        const powerUp = tagState.powerUp;
        if (!powerUp) return null;
        return {
            id: powerUp.id,
            kind: powerUp.kind,
            position: { x: powerUp.position.x, z: powerUp.position.z },
            expiresAt: powerUp.expiresAt
        };
    }

    checkTags(tagState) {
        const itPlayer = tagState.players.get(tagState.itPlayerId);
        if (!itPlayer) return;

        const now = Date.now();
        const itId = tagState.itPlayerId;

        // Tag only the closest eligible player, once per tick
        let closestId = null;
        let closestDistance = TAG_CONFIG.TAG_RANGE;
        tagState.players.forEach((targetState, targetId) => {
            if (targetId === itId) return;

            // Check if target has grace period or an 'escudo' power-up
            if (now < targetState.graceUntil) return;
            if (now < targetState.shieldUntil) return;

            const dx = targetState.position.x - itPlayer.position.x;
            const dz = targetState.position.z - itPlayer.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestId = targetId;
            }
        });

        if (closestId) {
            this.transferIt(tagState, itId, closestId);
        }
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
            newIt.shieldUntil = 0; // "It" never carries a shield (only reachable when "It" left the room)
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
            remainingTime: 0,
            winner: {
                id: winner.id,
                name: winner.name,
                penaltyTime: winner.penaltyTime
            },
            ranking
        };
    }

    getPlayerStateForClient(playerState, now = Date.now()) {
        const boostMsLeft = Math.max(0, playerState.boostUntil - now);
        const shieldMsLeft = Math.max(0, playerState.shieldUntil - now);
        return {
            id: playerState.id,
            name: playerState.name,
            number: playerState.number,
            position: { ...playerState.position },
            velocity: { ...playerState.velocity },
            facingAngle: playerState.facingAngle,
            isIt: playerState.isIt,
            penaltyTime: playerState.penaltyTime,
            hasGrace: now < playerState.graceUntil,
            boosted: boostMsLeft > 0,
            shielded: shieldMsLeft > 0,
            boostMsLeft,
            shieldMsLeft
        };
    }

    cleanup(roomCode) {
        this.tagStates.delete(roomCode);
        this.pendingEvents.delete(roomCode);
    }
}

export { TAG_CONFIG };
export default TagStateManager;
