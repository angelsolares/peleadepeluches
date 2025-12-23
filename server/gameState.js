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
        this.JUMP_FORCE = 15;  // Synced with client - allows reaching platforms
        this.GROUND_Y = 0;
        this.ARENA_RADIUS = 4.5;
        
        // Stage platforms (same as client)
        this.platforms = [
            { x: 0, y: 0, width: 14, isMainGround: true },   // Main ground
            { x: -4, y: 2.6, width: 4, isMainGround: false }, // Left floating
            { x: 4, y: 2.6, width: 4, isMainGround: false },  // Right floating
            { x: 0, y: 4.6, width: 5, isMainGround: false }   // Top floating
        ];
        
        // Stage boundaries
        this.STAGE_LEFT = -8;
        this.STAGE_RIGHT = 8;
        
        // Pending attacks (for active frames system)
        // Map<roomCode, Array<{attackerId, attackType, timestamp, processed}>>
        this.pendingAttacks = new Map();
        
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
        
        // Initialize previousY for platform detection
        if (player.previousY === undefined) {
            player.previousY = player.position.y;
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
        
        // Store previous Y before physics update
        const prevY = player.position.y;
        
        // Check if grounded on ANY platform before jump
        let isGrounded = this.checkIfGrounded(player);
        
        // Jumping
        if (input.jump && isGrounded) {
            player.velocity.y = this.JUMP_FORCE;
            isGrounded = false;
        }
        
        // Apply gravity when not grounded
        if (!isGrounded) {
            player.velocity.y += this.GRAVITY * delta;
        }
        
        // Update position
        player.position.x += player.velocity.x * delta;
        player.position.y += player.velocity.y * delta;
        
        // Platform collision detection
        isGrounded = false;
        for (const platform of this.platforms) {
            const halfWidth = platform.width / 2;
            const platformLeft = platform.x - halfWidth;
            const platformRight = platform.x + halfWidth;
            
            // Check if player is within platform's horizontal bounds
            if (player.position.x >= platformLeft && player.position.x <= platformRight) {
                // Main ground - always collide
                if (platform.isMainGround && player.position.y <= platform.y) {
                    player.position.y = platform.y;
                    player.velocity.y = 0;
                    isGrounded = true;
                    break;
                }
                
                // Floating platforms - only land when falling through from above
                if (!platform.isMainGround && player.velocity.y <= 0) {
                    const platformTop = platform.y;
                    // Was above platform last frame, now at or below
                    if (prevY >= platformTop && player.position.y <= platformTop) {
                        player.position.y = platformTop;
                        player.velocity.y = 0;
                        isGrounded = true;
                        break;
                    }
                }
            }
        }
        
        // Soft boundary - allow players to go slightly off stage but not walk infinitely
        // Blast zones handle actual KOs (in checkKOs)
        player.position.x = Math.max(this.STAGE_LEFT - 2, Math.min(this.STAGE_RIGHT + 2, player.position.x));
        player.position.z = 0; // Lock Z axis for 2D gameplay
        
        // Store Y for next frame
        player.previousY = player.position.y;
        
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
     * Check if player is standing on any platform
     * @param {object} player - Player object
     * @returns {boolean} Whether player is grounded
     */
    checkIfGrounded(player) {
        const tolerance = 0.1; // Small tolerance for ground detection
        
        for (const platform of this.platforms) {
            const halfWidth = platform.width / 2;
            const platformLeft = platform.x - halfWidth;
            const platformRight = platform.x + halfWidth;
            
            // Check if within platform bounds
            if (player.position.x >= platformLeft && player.position.x <= platformRight) {
                // Check if at platform height
                if (Math.abs(player.position.y - platform.y) < tolerance) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Queue an attack for processing after active frame delay
     * @param {string} attackerId - Attacker's socket ID
     * @param {string} attackType - 'punch' or 'kick'
     * @param {string} roomCode - Room code
     * @returns {object|null} Attack info for animation
     */
    queueAttack(attackerId, attackType, roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (!room || room.state !== 'playing') {
            return null;
        }
        
        const attacker = room.players.get(attackerId);
        
        if (!attacker) {
            return null;
        }
        
        // Attack timing properties (reduced for faster animations)
        const attackTiming = {
            punch: { activeFrameDelay: 75 },   // ms until hit check (2x faster anim)
            kick: { activeFrameDelay: 110 }    // ms until hit check (1.8x faster anim)
        };
        
        const timing = attackTiming[attackType] || attackTiming.punch;
        
        // Initialize pending attacks for this room if needed
        if (!this.pendingAttacks.has(roomCode)) {
            this.pendingAttacks.set(roomCode, []);
        }
        
        // Add attack to queue
        const pendingAttack = {
            attackerId,
            attackType,
            timestamp: Date.now(),
            activeTime: Date.now() + timing.activeFrameDelay,
            processed: false,
            attackerPosition: { ...attacker.position },
            facingRight: attacker.facingRight
        };
        
        this.pendingAttacks.get(roomCode).push(pendingAttack);
        
        // Return info for animation (immediate feedback)
        return {
            attackerId,
            attackType,
            attackerPosition: { ...attacker.position },
            facingRight: attacker.facingRight
        };
    }
    
    /**
     * Process pending attacks that have reached their active frames
     * @param {string} roomCode - Room code
     * @returns {array} Hit results
     */
    processPendingAttacks(roomCode) {
        const pendingList = this.pendingAttacks.get(roomCode);
        
        if (!pendingList || pendingList.length === 0) {
            return [];
        }
        
        const now = Date.now();
        const results = [];
        
        // Process attacks that have reached their active time
        for (const attack of pendingList) {
            if (!attack.processed && now >= attack.activeTime) {
                attack.processed = true;
                
                // Process the actual hit detection
                const hitResult = this.processAttack(attack.attackerId, attack.attackType, roomCode);
                if (hitResult && hitResult.hits.length > 0) {
                    results.push(hitResult);
                }
            }
        }
        
        // Clean up processed attacks (older than 1 second)
        const cutoff = now - 1000;
        this.pendingAttacks.set(roomCode, pendingList.filter(a => !a.processed || a.timestamp > cutoff));
        
        return results;
    }
    
    /**
     * Process an attack action (actual hit detection)
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
        
        // Attack properties (Smash Bros style) - With active frames timing
        const attackProps = {
            punch: { 
                damage: 8, 
                baseKnockback: 3, 
                knockbackGrowth: 0.08,
                range: 0.9,  // Reduced from 1.8 - requires being close
                hitstun: 0.2,  // seconds of hitstun (reduced for faster gameplay)
                activeFrameDelay: 75  // ms until hit check (2x faster animation)
            },
            kick: { 
                damage: 12, 
                baseKnockback: 5, 
                knockbackGrowth: 0.1,
                range: 1.1,  // Reduced from 2.2 - slightly longer than punch
                hitstun: 0.25,  // seconds of hitstun (reduced for faster gameplay)
                activeFrameDelay: 110  // ms until hit check (1.8x faster animation)
            }
        };
        
        const props = attackProps[attackType] || attackProps.punch;
        
        // Check for hits
        const hits = [];
        
        // Determine attacker facing direction (use facingRight property, not velocity)
        const facingDir = attacker.facingRight ? 1 : -1;
        
        for (const [targetId, target] of room.players) {
            if (targetId === attackerId) continue;
            
            // Calculate distance
            const dx = target.position.x - attacker.position.x;
            const dy = target.position.y - attacker.position.y;
            const dz = target.position.z - attacker.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            // Check if target is in front of attacker (strict - must be in facing direction)
            // Only hit targets that are actually in the direction the attacker is facing
            const inFront = (facingDir > 0 && dx > 0) || (facingDir < 0 && dx < 0);
            
            if (distance <= props.range && inFront) {
                // Check if target is blocking
                const isBlocking = target.isBlocking === true;
                
                // Reduced damage and knockback when blocking
                const damageMultiplier_block = isBlocking ? 0.25 : 1.0;  // 75% damage reduction when blocking
                const knockbackMultiplier = isBlocking ? 0.2 : 1.0;      // 80% knockback reduction when blocking
                
                // Apply damage (reduced if blocking)
                const actualDamage = Math.floor(props.damage * damageMultiplier_block);
                target.health += actualDamage;
                
                // Smash Bros knockback formula:
                // knockback = baseKnockback + (damage * knockbackGrowth * damageMultiplier)
                const damageMultiplier = 1 + (target.health / 50);
                const knockbackPower = (props.baseKnockback + 
                    (target.health * props.knockbackGrowth * damageMultiplier)) * knockbackMultiplier;
                
                // Direction of knockback
                const knockbackAngle = Math.atan2(dy + 0.5, dx); // Slight upward angle
                const knockbackDirX = dx === 0 ? facingDir : Math.sign(dx);
                
                // Apply knockback (much reduced if blocking)
                target.velocity.x = knockbackDirX * knockbackPower * Math.cos(knockbackAngle) * 1.5;
                target.velocity.y = isBlocking ? 0 : knockbackPower * 0.8; // No vertical knockback when blocking
                
                hits.push({
                    targetId: targetId,
                    damage: actualDamage,
                    newHealth: target.health,
                    knockback: {
                        x: target.velocity.x,
                        y: target.velocity.y
                    },
                    hitstun: isBlocking ? props.hitstun * 0.3 : props.hitstun, // Less hitstun when blocking
                    blocked: isBlocking
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
    
    /**
     * Set player blocking state
     * @param {string} playerId - Player's socket ID
     * @param {string} roomCode - Room code
     * @param {boolean} isBlocking - Whether player is blocking
     */
    setPlayerBlocking(playerId, roomCode, isBlocking) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return;
        
        const player = room.players.get(playerId);
        if (player) {
            player.isBlocking = isBlocking;
        }
    }
}

export default GameStateManager;

