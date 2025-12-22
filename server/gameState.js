/**
 * Game State Manager - Handles game logic and state synchronization
 */

class GameStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        
        // Physics constants
        this.GRAVITY = -30;
        this.MOVE_SPEED = 4;
        this.RUN_SPEED = 7;
        this.JUMP_FORCE = 12;
        this.GROUND_Y = 0;
        this.ARENA_RADIUS = 4.5;
        
        // Game tick rate (60 FPS)
        this.TICK_RATE = 1000 / 60;
        this.lastTickTime = Date.now();
    }
    
    /**
     * Process a game tick for a specific room
     * @param {string} roomCode - Room code
     * @returns {object|null} Updated game state
     */
    processTick(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (!room || room.state !== 'playing') {
            return null;
        }
        
        const now = Date.now();
        const delta = (now - this.lastTickTime) / 1000;
        this.lastTickTime = now;
        
        // Cap delta to prevent physics explosions
        const cappedDelta = Math.min(delta, 0.1);
        
        // Update each player
        const playerUpdates = [];
        
        for (const [playerId, player] of room.players) {
            const update = this.updatePlayer(player, cappedDelta);
            playerUpdates.push({
                id: playerId,
                ...update
            });
        }
        
        return {
            roomCode: roomCode,
            timestamp: now,
            players: playerUpdates
        };
    }
    
    /**
     * Update a single player's physics
     * @param {object} player - Player object
     * @param {number} delta - Time delta
     * @returns {object} Updated state
     */
    updatePlayer(player, delta) {
        const input = player.input;
        
        // Initialize facingRight if not set
        if (player.facingRight === undefined) {
            player.facingRight = true;
        }
        
        // Horizontal movement
        const currentSpeed = input.run ? this.RUN_SPEED : this.MOVE_SPEED;
        
        if (input.left) {
            player.velocity.x = -currentSpeed;
            player.facingRight = false;
        } else if (input.right) {
            player.velocity.x = currentSpeed;
            player.facingRight = true;
        } else {
            // Deceleration
            player.velocity.x *= 0.8;
            if (Math.abs(player.velocity.x) < 0.1) {
                player.velocity.x = 0;
            }
        }
        
        // Check if grounded
        const isGrounded = player.position.y <= this.GROUND_Y;
        
        // Jumping
        if (input.jump && isGrounded) {
            player.velocity.y = this.JUMP_FORCE;
        }
        
        // Apply gravity
        if (!isGrounded) {
            player.velocity.y += this.GRAVITY * delta;
        }
        
        // Update position
        player.position.x += player.velocity.x * delta;
        player.position.y += player.velocity.y * delta;
        
        // Ground collision
        if (player.position.y < this.GROUND_Y) {
            player.position.y = this.GROUND_Y;
            player.velocity.y = 0;
        }
        
        // Arena boundaries
        const distFromCenter = Math.sqrt(
            player.position.x ** 2 + player.position.z ** 2
        );
        
        if (distFromCenter > this.ARENA_RADIUS) {
            const angle = Math.atan2(player.position.z, player.position.x);
            player.position.x = Math.cos(angle) * this.ARENA_RADIUS;
            player.position.z = Math.sin(angle) * this.ARENA_RADIUS;
        }
        
        return {
            position: { ...player.position },
            velocity: { ...player.velocity },
            health: player.health,
            stocks: player.stocks,
            isGrounded: isGrounded,
            facingRight: player.facingRight,
            input: { ...player.input }
        };
    }
    
    /**
     * Process an attack action
     * @param {string} attackerId - Attacker's socket ID
     * @param {string} attackType - 'punch' or 'kick'
     * @param {string} roomCode - Room code
     * @returns {object|null} Attack result
     */
    processAttack(attackerId, attackType, roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (!room || room.state !== 'playing') {
            return null;
        }
        
        const attacker = room.players.get(attackerId);
        
        if (!attacker) {
            return null;
        }
        
        // Attack properties (Smash Bros style)
        const attackProps = {
            punch: { 
                damage: 8, 
                baseKnockback: 3, 
                knockbackGrowth: 0.08,
                range: 1.8,
                hitstun: 0.3  // seconds of hitstun
            },
            kick: { 
                damage: 12, 
                baseKnockback: 5, 
                knockbackGrowth: 0.1,
                range: 2.2,
                hitstun: 0.4
            }
        };
        
        const props = attackProps[attackType] || attackProps.punch;
        
        // Check for hits
        const hits = [];
        
        // Determine attacker facing direction
        const facingDir = attacker.velocity.x >= 0 ? 1 : -1;
        
        for (const [targetId, target] of room.players) {
            if (targetId === attackerId) continue;
            
            // Calculate distance
            const dx = target.position.x - attacker.position.x;
            const dy = target.position.y - attacker.position.y;
            const dz = target.position.z - attacker.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            // Check if target is in front of attacker and within range
            const inFront = (facingDir > 0 && dx > -0.5) || (facingDir < 0 && dx < 0.5);
            
            if (distance <= props.range && inFront) {
                // Apply damage
                target.health += props.damage;
                
                // Smash Bros knockback formula:
                // knockback = baseKnockback + (damage * knockbackGrowth * damageMultiplier)
                const damageMultiplier = 1 + (target.health / 50);
                const knockbackPower = props.baseKnockback + 
                    (target.health * props.knockbackGrowth * damageMultiplier);
                
                // Direction of knockback
                const knockbackAngle = Math.atan2(dy + 0.5, dx); // Slight upward angle
                const knockbackDirX = dx === 0 ? facingDir : Math.sign(dx);
                
                // Apply knockback
                target.velocity.x = knockbackDirX * knockbackPower * Math.cos(knockbackAngle) * 1.5;
                target.velocity.y = knockbackPower * 0.8; // Always knock up a bit
                
                hits.push({
                    targetId: targetId,
                    damage: props.damage,
                    newHealth: target.health,
                    knockback: {
                        x: target.velocity.x,
                        y: target.velocity.y
                    },
                    hitstun: props.hitstun
                });
            }
        }
        
        return {
            attackerId: attackerId,
            attackType: attackType,
            attackerPosition: { ...attacker.position },
            hits: hits
        };
    }
    
    /**
     * Check for KO (player out of bounds)
     * @param {string} roomCode - Room code
     * @returns {array} KO events
     */
    checkKOs(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (!room || room.state !== 'playing') {
            return [];
        }
        
        const kos = [];
        const BLAST_ZONE = {
            top: 15,
            bottom: -10,
            sides: 20
        };
        
        for (const [playerId, player] of room.players) {
            let isKO = false;
            
            if (player.position.y > BLAST_ZONE.top ||
                player.position.y < BLAST_ZONE.bottom ||
                Math.abs(player.position.x) > BLAST_ZONE.sides) {
                isKO = true;
            }
            
            if (isKO) {
                player.stocks--;
                player.health = 0;
                
                // Respawn position
                player.position = { x: 0, y: 5, z: 0 };
                player.velocity = { x: 0, y: 0, z: 0 };
                
                kos.push({
                    playerId: playerId,
                    stocksRemaining: player.stocks,
                    eliminated: player.stocks <= 0
                });
            }
        }
        
        return kos;
    }
    
    /**
     * Check for game over condition
     * @param {string} roomCode - Room code
     * @returns {object|null} Game over result
     */
    checkGameOver(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (!room || room.state !== 'playing') {
            return null;
        }
        
        // Count players with stocks remaining
        const alivePlayers = Array.from(room.players.values())
            .filter(p => p.stocks > 0);
        
        if (alivePlayers.length <= 1) {
            room.state = 'finished';
            
            const winner = alivePlayers[0] || null;
            
            return {
                gameOver: true,
                winner: winner ? {
                    id: winner.id,
                    name: winner.name,
                    color: winner.color
                } : null,
                draw: alivePlayers.length === 0
            };
        }
        
        return null;
    }
    
    /**
     * Reset game state for a rematch
     * @param {string} roomCode - Room code
     * @returns {object|null} Reset result
     */
    resetGame(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (!room) {
            return null;
        }
        
        room.state = 'lobby';
        
        const playerArray = Array.from(room.players.values());
        playerArray.forEach((player, index) => {
            player.position = {
                x: (index - (playerArray.length - 1) / 2) * 3,
                y: 0,
                z: 0
            };
            player.velocity = { x: 0, y: 0, z: 0 };
            player.health = 0;
            player.stocks = 3;
            player.ready = false;
            player.input = {
                left: false,
                right: false,
                jump: false,
                punch: false,
                kick: false,
                run: false
            };
        });
        
        return {
            success: true,
            room: this.lobbyManager.getRoomInfo(roomCode)
        };
    }
}

export default GameStateManager;

