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

        // Knockback / hitstun physics (per-frame factors are normalized to 60 FPS)
        this.AIR_DRAG = 0.965;               // Horizontal momentum kept per frame while airborne and launched (KO ~90% punch, ~65% kick from center)
        this.HITSTUN_GROUND_FRICTION = 0.85; // Sliding friction per frame while in hitstun on the ground
        this.DI_ACCEL = 6;                   // Directional influence (units/s^2) while carrying launch momentum
        this.HITSTUN_PER_KNOCKBACK = 0.02;   // Extra hitstun seconds per point of knockback power
        this.PLAYER_COLLISION_RADIUS = 0.8;  // Players closer than this (same height) are pushed apart
        
        // Stage platforms (synced with client - js/main.js createArena)
        // Must match floatingPlatformConfigs + main platform
        this.platforms = [
            { x: 0, y: 0, width: 20, isMainGround: true },      // Main ground (20 units for 8 players)
            { x: -6, y: 2.6, width: 4, isMainGround: false },   // Left high (y: 2.5 + 0.1)
            { x: 6, y: 2.6, width: 4, isMainGround: false },    // Right high
            { x: 0, y: 4.6, width: 3.5, isMainGround: false },  // Center top
            { x: -3, y: 5.6, width: 2.5, isMainGround: false }, // Upper left
            { x: 3, y: 5.6, width: 2.5, isMainGround: false }   // Upper right
        ];
        
        // Stage boundaries (expanded for larger stage)
        this.STAGE_LEFT = -12;
        this.STAGE_RIGHT = 12;
        
        // Pending attacks (for active frames system)
        // Map<roomCode, Array<{attackerId, attackType, timestamp, processed}>>
        this.pendingAttacks = new Map();
        
        // Game tick rate (60 FPS)
        this.TICK_RATE = 1000 / 60;
        // Last tick time per room (Map<roomCode, timestamp>) so rooms don't steal each other's delta
        this.lastTickTimes = new Map();
    }
    
    /**
     * Process a game tick for a specific room
     * @param {string} roomCode - Room code
     * @returns {object|null} Updated game state
     */
    processTick(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (!room || room.state !== 'playing') {
            this.lastTickTimes.delete(roomCode);
            return null;
        }

        const now = Date.now();
        const lastTick = this.lastTickTimes.get(roomCode) ?? (now - this.TICK_RATE);
        const delta = (now - lastTick) / 1000;
        this.lastTickTimes.set(roomCode, now);

        // Cap delta to prevent physics explosions
        const cappedDelta = Math.min(delta, 0.1);

        // Update each player's physics (eliminated players are out of the match)
        for (const player of room.players.values()) {
            if (player.stocks <= 0) continue;
            this.updatePlayer(player, cappedDelta);
        }

        // Push overlapping players apart (server-authoritative, so the host doesn't fight it)
        this.resolvePlayerCollisions(room);

        const playerUpdates = [];
        for (const [playerId, player] of room.players) {
            playerUpdates.push({
                id: playerId,
                ...this.serializePlayer(player)
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
        
        // Hitstun: after being hit the player can't act and keeps the knockback momentum
        const inHitstun = (player.hitstunUntil || 0) > Date.now();

        // Check if player is locked in an action (blocking or taunting)
        const isLockedInAction = player.isBlocking === true || player.isTaunting === true;

        // Per-frame factors were tuned at 60 FPS; normalize them to the real delta
        const frames = delta * 60;

        // Check if grounded on ANY platform before movement/jump
        let isGrounded = this.checkIfGrounded(player);

        // Horizontal movement
        const currentSpeed = input.run ? this.RUN_SPEED : this.MOVE_SPEED;
        const inputDir = input.left ? -1 : (input.right ? 1 : 0);

        if (inHitstun) {
            // Launched: ignore input, keep momentum (strong friction on the ground, light drag in the air)
            const friction = isGrounded ? this.HITSTUN_GROUND_FRICTION : this.AIR_DRAG;
            player.velocity.x *= Math.pow(friction, frames);
        } else if (isLockedInAction) {
            // Force stop horizontal movement when blocking/taunting
            player.velocity.x *= Math.pow(0.5, frames);
            if (Math.abs(player.velocity.x) < 0.1) {
                player.velocity.x = 0;
            }
        } else if (!isGrounded && Math.abs(player.velocity.x) > this.RUN_SPEED + 0.5) {
            // Hitstun ended mid-flight: keep drifting, input only nudges the trajectory (DI)
            player.velocity.x *= Math.pow(this.AIR_DRAG, frames);
            player.velocity.x += inputDir * this.DI_ACCEL * delta;
        } else if (inputDir !== 0) {
            player.velocity.x = inputDir * currentSpeed;
            player.facingRight = inputDir > 0;
        } else {
            // Deceleration
            player.velocity.x *= Math.pow(0.8, frames);
            if (Math.abs(player.velocity.x) < 0.1) {
                player.velocity.x = 0;
            }
        }

        // Store previous Y before physics update
        const prevY = player.position.y;

        // Jumping - blocked during blocking/taunting and hitstun
        if (input.jump && isGrounded && !isLockedInAction && !inHitstun) {
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
                // Main ground - only land when coming from above
                // (a player who fell below the stage keeps falling instead of teleporting back up)
                if (platform.isMainGround && player.position.y <= platform.y && prevY >= platform.y - 0.05) {
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
        
        // No horizontal clamp: players can be launched past the stage edge.
        // Blast zones handle KOs (in checkKOs).
        player.position.z = 0; // Lock Z axis for 2D gameplay

        // Store Y and grounded state for next frame / serialization
        player.previousY = player.position.y;
        player.isGrounded = isGrounded;
    }

    /**
     * Build the network snapshot for a player
     * @param {object} player - Player object
     * @returns {object} Serializable state
     */
    serializePlayer(player) {
        return {
            position: { ...player.position },
            velocity: { ...player.velocity },
            health: player.health,
            stocks: player.stocks,
            isGrounded: player.isGrounded === true,
            facingRight: player.facingRight,
            inHitstun: (player.hitstunUntil || 0) > Date.now(),
            input: { ...player.input }
        };
    }

    /**
     * Push overlapping players apart on the X axis.
     * Launched players (in hitstun) pass through so knockback isn't absorbed by bodies.
     * @param {object} room - Room object
     */
    resolvePlayerCollisions(room) {
        const now = Date.now();
        const radius = this.PLAYER_COLLISION_RADIUS;
        const active = Array.from(room.players.values()).filter(p =>
            p.stocks > 0 && !((p.hitstunUntil || 0) > now)
        );

        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                const a = active[i];
                const b = active[j];
                const dx = b.position.x - a.position.x;
                const dy = b.position.y - a.position.y;

                // Only collide at similar heights (players can jump over each other)
                if (Math.abs(dx) >= radius || Math.abs(dy) >= 1.5) continue;

                const dir = dx === 0 ? 1 : Math.sign(dx);
                const push = (radius - Math.abs(dx)) / 2;
                a.position.x -= dir * push;
                b.position.x += dir * push;

                // Cancel velocity pushing into the other player
                if (a.velocity.x * dir > 0) a.velocity.x = 0;
                if (b.velocity.x * -dir > 0) b.velocity.x = 0;
            }
        }
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
        
        // Eliminated players can't attack
        if (attacker.stocks <= 0) {
            return null;
        }

        // Don't allow attacks while blocking, taunting or in hitstun
        if (attacker.isBlocking || attacker.isTaunting || (attacker.hitstunUntil || 0) > Date.now()) {
            return null;
        }

        // Attack cooldown (matches the host's animation cooldown, so every hit has an animation)
        const now = Date.now();
        if (now < (attacker.attackReadyAt || 0)) {
            return null;
        }
        const ATTACK_COOLDOWN_MS = { punch: 400, kick: 500 };
        attacker.attackReadyAt = now + (ATTACK_COOLDOWN_MS[attackType] || ATTACK_COOLDOWN_MS.punch);
        
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

        if (!attacker || attacker.stocks <= 0) {
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
            if (target.stocks <= 0) continue; // Eliminated players can't be hit

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

                // Hitstun scales with knockback so strong hits launch further before the player regains control
                const hitstunSeconds = isBlocking
                    ? props.hitstun * 0.3
                    : props.hitstun + knockbackPower * this.HITSTUN_PER_KNOCKBACK;
                target.hitstunUntil = Date.now() + hitstunSeconds * 1000;
                
                hits.push({
                    targetId: targetId,
                    damage: actualDamage,
                    newHealth: target.health,
                    knockback: {
                        x: target.velocity.x,
                        y: target.velocity.y
                    },
                    hitstun: hitstunSeconds,
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
            if (player.stocks <= 0) continue; // Already eliminated

            let isKO = false;
                        
            if (player.position.y > BLAST_ZONE.top ||
                player.position.y < BLAST_ZONE.bottom ||
                Math.abs(player.position.x) > BLAST_ZONE.sides) {
                isKO = true;
            }
            
            if (isKO) {
                player.stocks--;
                player.health = 0;
                player.velocity = { x: 0, y: 0, z: 0 };
                player.hitstunUntil = 0;

                // Respawn only if the player still has stocks; eliminated players stay out
                if (player.stocks > 0) {
                    player.position = { x: 0, y: 5, z: 0 };
                    player.previousY = player.position.y;
                }
                
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
            player.previousY = 0;
            player.hitstunUntil = 0;
            player.attackReadyAt = 0;
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
    
    /**
     * Set player taunting state
     * @param {string} playerId - Player's socket ID
     * @param {string} roomCode - Room code
     * @param {boolean} isTaunting - Whether player is taunting
     */
    setPlayerTaunting(playerId, roomCode, isTaunting) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return;
        
        const player = room.players.get(playerId);
        if (player) {
            player.isTaunting = isTaunting;
            if (isTaunting) {
                console.log(`[Smash] Player ${player.name} is taunting`);
            }
        }
    }
}

export default GameStateManager;

