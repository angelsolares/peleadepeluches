/**
 * Arena State Manager
 * Server-side game state and physics for Arena mode
 * Handles health, stamina, combat, grabs, and ring-out detection
 */

// Arena-specific configuration (MUST match client ArenaGame.js)
const ARENA_CONFIG = {
    // Ring dimensions - MUST MATCH CLIENT
    RING_SIZE: 18,         // Width/depth of the ring (synced with client)
    RING_HEIGHT: 0.5,
    RING_OUT_ZONE: 3,      // Distance outside ring before considered "out" (synced with client)
    
    // Physics
    GRAVITY: -30,
    MOVE_SPEED: 6,         // Synced with client
    RUN_SPEED: 10,         // Synced with client
    FRICTION: 0.85,
    
    // Health & Stamina
    MAX_HEALTH: 100,
    MAX_STAMINA: 100,
    STAMINA_REGEN: 10,
    
    // Stamina costs
    PUNCH_STAMINA: 15,
    KICK_STAMINA: 20,
    GRAB_STAMINA: 25,
    THROW_STAMINA: 30,
    BLOCK_STAMINA_PER_SEC: 5,
    
    // Damage
    PUNCH_DAMAGE: 10,
    KICK_DAMAGE: 15,
    THROW_DAMAGE: 25,
    RING_OUT_DAMAGE: 50,
    
    // Knockback
    PUNCH_KNOCKBACK: 3,
    KICK_KNOCKBACK: 5,
    THROW_KNOCKBACK: 15,       // Increased for more dramatic throws
    
    // Timing
    ATTACK_COOLDOWN: 500,      // ms
    ACTIVE_FRAME_DELAY: 150,   // ms before hit detection
    GRAB_DURATION: 3000,       // ms - time to hold before auto-release
    STUN_DURATION: 500,        // ms
    
    // Attack ranges (radius)
    PUNCH_RANGE: 1.2,
    KICK_RANGE: 1.5,
    GRAB_RANGE: 1.8,           // Increased for easier grabs
};

class ArenaStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        
        // Arena-specific state per room
        this.arenaStates = new Map();
        
        // Pending attacks (for active frame system)
        this.pendingAttacks = new Map();
        
        // Pending grabs
        this.pendingGrabs = new Map();
    }
    
    /**
     * Initialize arena state for a room
     * @param {string} roomCode - Room code
     */
    initializeArena(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room || room.gameMode !== 'arena') return null;
        
        const arenaState = {
            roomCode,
            players: new Map(),
            roundNumber: 1,
            roundState: 'active', // 'active', 'paused', 'finished'
            eliminationOrder: [],
            lastWinner: null
        };
        
        // Initialize player arena states with different positions
        let playerIndex = 0;
        room.players.forEach((player, socketId) => {
            const playerState = this.createPlayerArenaState(player, playerIndex);
            arenaState.players.set(socketId, playerState);
            playerIndex++;
        });
        
        this.arenaStates.set(roomCode, arenaState);
        return arenaState;
    }
    
    /**
     * Create initial arena state for a player
     * @param {object} player - Player data
     * @param {number} index - Player index for initial positioning
     */
    createPlayerArenaState(player, index = 0) {
        // Calculate initial position around the ring
        const angle = (index / 4) * Math.PI * 2;
        const radius = ARENA_CONFIG.RING_SIZE / 3; // About 6 units from center
        const initialX = Math.cos(angle) * radius;
        const initialZ = Math.sin(angle) * radius;
        
        return {
            id: player.id,
            name: player.name,
            number: player.number,
            color: player.color,
            
            // Position (3D) - positioned around the ring
            position: { x: initialX, y: ARENA_CONFIG.RING_HEIGHT, z: initialZ },
            velocity: { x: 0, y: 0, z: 0 },
            facingAngle: 0,
            
            // Stats
            health: ARENA_CONFIG.MAX_HEALTH,
            stamina: ARENA_CONFIG.MAX_STAMINA,
            
            // State flags
            isAttacking: false,
            isBlocking: false,
            isGrabbing: false,
            isGrabbed: false,
            isStunned: false,
            isEliminated: false,
            
            // Grab state
            grabbedBy: null,
            grabbing: null,
            
            // Cooldowns (timestamps)
            lastAttackTime: 0,
            stunEndTime: 0,
            grabEndTime: 0,
            
            // Input
            input: {
                left: false,
                right: false,
                up: false,
                down: false,
                run: false,
                block: false
            }
        };
    }
    
    /**
     * Process a game tick for arena mode
     * @param {string} roomCode - Room code
     * @returns {object} Updated game state
     */
    processTick(roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState || arenaState.roundState !== 'active') return null;
        
        const now = Date.now();
        const delta = 1 / 60; // 60 FPS tick
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;
        
        const players = [];
        
        arenaState.players.forEach((playerState, socketId) => {
            if (playerState.isEliminated) {
                players.push(this.getPlayerStateForClient(playerState));
                return;
            }
            
            const roomPlayer = room.players.get(socketId);
            if (!roomPlayer) return;
            
            // Update from room input
            const prevInput = { ...playerState.input };
            playerState.input = { ...roomPlayer.input };
            
            // Debug: Log input changes
            if (JSON.stringify(prevInput) !== JSON.stringify(playerState.input)) {
                console.log(`[Arena] Player ${playerState.number} input changed:`, playerState.input);
            }
            
            // Update timers
            if (playerState.isStunned && now >= playerState.stunEndTime) {
                playerState.isStunned = false;
            }
            
            // Handle grab release
            if (playerState.isGrabbing && now >= playerState.grabEndTime) {
                this.releaseGrab(arenaState, socketId);
            }
            
            // Process movement (if not stunned or grabbed)
            if (!playerState.isStunned && !playerState.isGrabbed) {
                this.processPlayerMovement(playerState, delta);
            }
            
            // Regenerate stamina
            this.updateStamina(playerState, delta);
            
            // Check ring boundaries
            this.checkRingBoundaries(arenaState, playerState);
            
            players.push(this.getPlayerStateForClient(playerState));
        });
        
        return {
            roomCode,
            roundNumber: arenaState.roundNumber,
            roundState: arenaState.roundState,
            players
        };
    }
    
    /**
     * Process player movement for 360 degrees
     */
    processPlayerMovement(playerState, delta) {
        if (playerState.isAttacking || playerState.isGrabbing) {
            // Slow down while attacking
            playerState.velocity.x *= 0.9;
            playerState.velocity.z *= 0.9;
        } else {
            // Calculate movement direction
            let dirX = 0, dirZ = 0;
            
            if (playerState.input.left) dirX -= 1;
            if (playerState.input.right) dirX += 1;
            if (playerState.input.up) dirZ -= 1;
            if (playerState.input.down) dirZ += 1;
            
            // Debug: Log input if any direction is pressed
            if (dirX !== 0 || dirZ !== 0) {
                console.log(`[Arena] Player ${playerState.number} moving: dirX=${dirX}, dirZ=${dirZ}, input=${JSON.stringify(playerState.input)}`);
            }
            
            // Normalize diagonal
            const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
            if (length > 0) {
                dirX /= length;
                dirZ /= length;
                
                const speed = playerState.input.run ? ARENA_CONFIG.RUN_SPEED : ARENA_CONFIG.MOVE_SPEED;
                playerState.velocity.x = dirX * speed;
                playerState.velocity.z = dirZ * speed;
                
                // Update facing angle
                playerState.facingAngle = Math.atan2(dirX, dirZ);
            }
        }
        
        // Apply friction
        playerState.velocity.x *= ARENA_CONFIG.FRICTION;
        playerState.velocity.z *= ARENA_CONFIG.FRICTION;
        
        // Update position
        playerState.position.x += playerState.velocity.x * delta;
        playerState.position.z += playerState.velocity.z * delta;
    }
    
    /**
     * Update stamina regeneration
     */
    updateStamina(playerState, delta) {
        if (playerState.isBlocking) {
            playerState.stamina = Math.max(
                0,
                playerState.stamina - ARENA_CONFIG.BLOCK_STAMINA_PER_SEC * delta
            );
        } else if (!playerState.isAttacking) {
            playerState.stamina = Math.min(
                ARENA_CONFIG.MAX_STAMINA,
                playerState.stamina + ARENA_CONFIG.STAMINA_REGEN * delta
            );
        }
    }
    
    /**
     * Check and handle ring boundary collisions
     */
    checkRingBoundaries(arenaState, playerState) {
        const ringHalf = ARENA_CONFIG.RING_SIZE / 2 - 0.8; // Rope boundary (matches client)
        const ringBounce = 0.3; // Bounce back force when hitting ropes
        let hitRope = false;
        
        // Check X boundaries - bounce off ropes
        if (playerState.position.x > ringHalf) {
            playerState.position.x = ringHalf;
            playerState.velocity.x *= -ringBounce;
            hitRope = true;
        } else if (playerState.position.x < -ringHalf) {
            playerState.position.x = -ringHalf;
            playerState.velocity.x *= -ringBounce;
            hitRope = true;
        }
        
        // Check Z boundaries - bounce off ropes
        if (playerState.position.z > ringHalf) {
            playerState.position.z = ringHalf;
            playerState.velocity.z *= -ringBounce;
            hitRope = true;
        } else if (playerState.position.z < -ringHalf) {
            playerState.position.z = -ringHalf;
            playerState.velocity.z *= -ringBounce;
            hitRope = true;
        }
        
        // Set near edge flag for visual warnings
        const edgeDistance = 1.5;
        playerState.isNearEdge = 
            Math.abs(playerState.position.x) > ringHalf - edgeDistance ||
            Math.abs(playerState.position.z) > ringHalf - edgeDistance;
    }
    
    /**
     * Queue an attack for processing
     */
    queueAttack(socketId, attackType, roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return null;
        
        const playerState = arenaState.players.get(socketId);
        if (!playerState || playerState.isEliminated || playerState.isStunned) return null;
        
        const now = Date.now();
        
        // Check cooldown
        if (now - playerState.lastAttackTime < ARENA_CONFIG.ATTACK_COOLDOWN) {
            return null;
        }
        
        // Check stamina
        const staminaCost = attackType === 'punch' ? ARENA_CONFIG.PUNCH_STAMINA :
                          attackType === 'kick' ? ARENA_CONFIG.KICK_STAMINA :
                          ARENA_CONFIG.GRAB_STAMINA;
        
        if (playerState.stamina < staminaCost) {
            return null;
        }
        
        // Consume stamina and set attacking
        playerState.stamina -= staminaCost;
        playerState.isAttacking = true;
        playerState.lastAttackTime = now;
        
        // Queue attack for active frame processing
        const attackInfo = {
            attackerId: socketId,
            attackType,
            position: { ...playerState.position },
            facingAngle: playerState.facingAngle,
            processTime: now + ARENA_CONFIG.ACTIVE_FRAME_DELAY
        };
        
        if (!this.pendingAttacks.has(roomCode)) {
            this.pendingAttacks.set(roomCode, []);
        }
        this.pendingAttacks.get(roomCode).push(attackInfo);
        
        // Clear attacking state after animation
        setTimeout(() => {
            if (playerState) playerState.isAttacking = false;
        }, ARENA_CONFIG.ATTACK_COOLDOWN);
        
        return attackInfo;
    }
    
    /**
     * Process pending attacks (active frame system)
     */
    processPendingAttacks(roomCode) {
        const attacks = this.pendingAttacks.get(roomCode);
        if (!attacks || attacks.length === 0) return [];
        
        const now = Date.now();
        const results = [];
        const remainingAttacks = [];
        
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return [];
        
        for (const attack of attacks) {
            if (now >= attack.processTime) {
                // Process this attack
                const result = this.processAttackHit(arenaState, attack);
                if (result) results.push(result);
            } else {
                // Keep for next tick
                remainingAttacks.push(attack);
            }
        }
        
        this.pendingAttacks.set(roomCode, remainingAttacks);
        return results;
    }
    
    /**
     * Process attack hit detection
     */
    processAttackHit(arenaState, attack) {
        const attacker = arenaState.players.get(attack.attackerId);
        if (!attacker || attacker.isEliminated) return null;
        
        const range = attack.attackType === 'punch' ? ARENA_CONFIG.PUNCH_RANGE :
                     attack.attackType === 'kick' ? ARENA_CONFIG.KICK_RANGE :
                     ARENA_CONFIG.GRAB_RANGE;
        
        const damage = attack.attackType === 'punch' ? ARENA_CONFIG.PUNCH_DAMAGE :
                      attack.attackType === 'kick' ? ARENA_CONFIG.KICK_DAMAGE : 0;
        
        const knockback = attack.attackType === 'punch' ? ARENA_CONFIG.PUNCH_KNOCKBACK :
                         attack.attackType === 'kick' ? ARENA_CONFIG.KICK_KNOCKBACK : 0;
        
        const hits = [];
        
        // Check all other players for hits
        arenaState.players.forEach((targetState, targetId) => {
            if (targetId === attack.attackerId || targetState.isEliminated) return;
            
            // Calculate distance
            const dx = targetState.position.x - attack.position.x;
            const dz = targetState.position.z - attack.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            // Check if in range
            if (distance <= range) {
                // Check if in attack arc (roughly 120 degrees in front)
                const angleToTarget = Math.atan2(dx, dz);
                let angleDiff = angleToTarget - attack.facingAngle;
                
                // Normalize angle difference
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                
                if (Math.abs(angleDiff) < Math.PI / 3) { // 60 degrees each side
                    // Hit!
                    const blocked = targetState.isBlocking;
                    const actualDamage = blocked ? damage * 0.2 : damage;
                    const actualKnockback = blocked ? knockback * 0.3 : knockback;
                    
                    // Apply damage
                    targetState.health = Math.max(0, targetState.health - actualDamage);
                    
                    // Apply knockback (away from attacker)
                    const knockbackAngle = Math.atan2(dx, dz);
                    targetState.velocity.x += Math.sin(knockbackAngle) * actualKnockback;
                    targetState.velocity.z += Math.cos(knockbackAngle) * actualKnockback;
                    
                    // Apply stun if not blocked
                    if (!blocked) {
                        targetState.isStunned = true;
                        targetState.stunEndTime = Date.now() + ARENA_CONFIG.STUN_DURATION;
                    }
                    
                    // Check for elimination
                    if (targetState.health <= 0) {
                        this.eliminatePlayer(arenaState, targetId);
                    }
                    
                    hits.push({
                        targetId,
                        damage: actualDamage,
                        blocked,
                        knockback: { x: Math.sin(knockbackAngle) * actualKnockback, z: Math.cos(knockbackAngle) * actualKnockback },
                        newHealth: targetState.health,
                        eliminated: targetState.isEliminated
                    });
                }
            }
        });
        
        if (hits.length > 0) {
            return {
                attackerId: attack.attackerId,
                attackType: attack.attackType,
                hits
            };
        }
        
        return null;
    }
    
    /**
     * Set player blocking state
     */
    setPlayerBlocking(socketId, roomCode, isBlocking) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return;
        
        const playerState = arenaState.players.get(socketId);
        if (playerState) {
            playerState.isBlocking = isBlocking;
        }
    }
    
    /**
     * Process a grab attempt
     */
    processGrab(socketId, roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return null;
        
        const attacker = arenaState.players.get(socketId);
        if (!attacker || attacker.isEliminated || attacker.isGrabbing) return null;
        
        // Check stamina
        if (attacker.stamina < ARENA_CONFIG.GRAB_STAMINA) return null;
        
        // Find nearest player in grab range
        let nearestTarget = null;
        let nearestDistance = ARENA_CONFIG.GRAB_RANGE;
        
        arenaState.players.forEach((targetState, targetId) => {
            if (targetId === socketId || targetState.isEliminated || targetState.isGrabbed) return;
            
            const dx = targetState.position.x - attacker.position.x;
            const dz = targetState.position.z - attacker.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestTarget = targetState;
            }
        });
        
        if (nearestTarget) {
            // Consume stamina
            attacker.stamina -= ARENA_CONFIG.GRAB_STAMINA;
            
            // Set grab state
            attacker.isGrabbing = true;
            attacker.grabbing = nearestTarget.id;
            attacker.grabEndTime = Date.now() + ARENA_CONFIG.GRAB_DURATION;
            
            nearestTarget.isGrabbed = true;
            nearestTarget.grabbedBy = socketId;
            
            return {
                grabberId: socketId,
                targetId: nearestTarget.id
            };
        }
        
        return null;
    }
    
    /**
     * Process a throw attempt
     */
    processThrow(socketId, roomCode, direction) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return null;
        
        const attacker = arenaState.players.get(socketId);
        if (!attacker || !attacker.isGrabbing || !attacker.grabbing) return null;
        
        const target = arenaState.players.get(attacker.grabbing);
        if (!target) {
            this.releaseGrab(arenaState, socketId);
            return null;
        }
        
        // Check stamina for throw
        if (attacker.stamina < ARENA_CONFIG.THROW_STAMINA) {
            this.releaseGrab(arenaState, socketId);
            return null;
        }
        
        // Consume stamina
        attacker.stamina -= ARENA_CONFIG.THROW_STAMINA;
        
        // Apply throw damage and knockback
        target.health = Math.max(0, target.health - ARENA_CONFIG.THROW_DAMAGE);
        
        const throwAngle = direction || attacker.facingAngle;
        target.velocity.x = Math.sin(throwAngle) * ARENA_CONFIG.THROW_KNOCKBACK;
        target.velocity.z = Math.cos(throwAngle) * ARENA_CONFIG.THROW_KNOCKBACK;
        
        target.isStunned = true;
        target.stunEndTime = Date.now() + ARENA_CONFIG.STUN_DURATION * 2;
        
        // Release grab
        this.releaseGrab(arenaState, socketId);
        
        // Check elimination
        if (target.health <= 0) {
            this.eliminatePlayer(arenaState, target.id);
        }
        
        return {
            grabberId: socketId,  // Use grabberId for consistency with client
            targetId: target.id,
            damage: ARENA_CONFIG.THROW_DAMAGE,
            direction: throwAngle,
            newHealth: target.health,
            eliminated: target.isEliminated
        };
    }
    
    /**
     * Release a grab
     */
    releaseGrab(arenaState, socketId) {
        const attacker = arenaState.players.get(socketId);
        if (!attacker) return;
        
        if (attacker.grabbing) {
            const target = arenaState.players.get(attacker.grabbing);
            if (target) {
                target.isGrabbed = false;
                target.grabbedBy = null;
            }
        }
        
        attacker.isGrabbing = false;
        attacker.grabbing = null;
    }
    
    /**
     * Process an escape from grab attempt
     */
    processEscape(socketId, roomCode) {
        console.log(`[Arena] processEscape called for ${socketId} in room ${roomCode}`);
        
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) {
            console.log('[Arena] No arena state found');
            return { success: false, error: 'No arena state' };
        }
        
        const target = arenaState.players.get(socketId);
        if (!target) {
            console.log('[Arena] Player not found');
            return { success: false, error: 'Player not found' };
        }
        
        console.log(`[Arena] Target state: isGrabbed=${target.isGrabbed}, grabbedBy=${target.grabbedBy}`);
        
        // Check if player is actually grabbed
        if (!target.isGrabbed || !target.grabbedBy) {
            console.log('[Arena] Player not grabbed');
            return { success: false, error: 'Not grabbed' };
        }
        
        const grabberId = target.grabbedBy;
        console.log(`[Arena] Releasing grab from ${grabberId}`);
        
        // Release the grab
        this.releaseGrab(arenaState, grabberId);
        
        // Apply knockback and damage to grabber (they got hit by escape punch)
        const grabber = arenaState.players.get(grabberId);
        if (grabber) {
            const angle = grabber.facingAngle || 0;
            // Push grabber backwards hard
            grabber.velocity.x -= Math.sin(angle) * 8;
            grabber.velocity.z -= Math.cos(angle) * 8;
            grabber.isStunned = true;
            grabber.stunEndTime = Date.now() + 1000; // Longer stun from escape hit
            // Apply some damage from the escape punch
            grabber.health = Math.max(0, grabber.health - 10);
        }
        
        // Target recovers in place
        target.velocity.x = 0;
        target.velocity.z = 0;
        
        console.log(`[Arena] Player ${target.name} escaped from grab successfully!`);
        
        return { 
            success: true, 
            grabberId: grabberId 
        };
    }
    
    /**
     * Eliminate a player
     */
    eliminatePlayer(arenaState, playerId) {
        const playerState = arenaState.players.get(playerId);
        if (!playerState || playerState.isEliminated) return;
        
        playerState.isEliminated = true;
        playerState.health = 0;
        
        // Release any grabs
        if (playerState.isGrabbing) {
            this.releaseGrab(arenaState, playerId);
        }
        if (playerState.grabbedBy) {
            this.releaseGrab(arenaState, playerState.grabbedBy);
        }
        
        arenaState.eliminationOrder.push(playerId);
        
        // Check for round end
        const alivePlayers = [];
        arenaState.players.forEach((ps, id) => {
            if (!ps.isEliminated) alivePlayers.push(id);
        });
        
        if (alivePlayers.length <= 1) {
            arenaState.roundState = 'finished';
            arenaState.lastWinner = alivePlayers[0] || null;
        }
        
        console.log(`[Arena] Player ${playerState.name} eliminated`);
    }
    
    /**
     * Check if game is over
     */
    checkGameOver(roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState || arenaState.roundState !== 'finished') return null;
        
        const winner = arenaState.lastWinner ? 
            arenaState.players.get(arenaState.lastWinner) : null;
        
        return {
            winner: winner ? {
                id: winner.id,
                name: winner.name,
                number: winner.number
            } : null,
            eliminationOrder: arenaState.eliminationOrder
        };
    }
    
    /**
     * Reset game for rematch
     */
    resetGame(roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return { success: false };
        
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return { success: false };
        
        // Reset room state
        room.state = 'lobby';
        
        // Reset arena state
        arenaState.roundNumber++;
        arenaState.roundState = 'active';
        arenaState.eliminationOrder = [];
        arenaState.lastWinner = null;
        
        // Reset all players
        let index = 0;
        arenaState.players.forEach((playerState) => {
            playerState.health = ARENA_CONFIG.MAX_HEALTH;
            playerState.stamina = ARENA_CONFIG.MAX_STAMINA;
            playerState.isAttacking = false;
            playerState.isBlocking = false;
            playerState.isGrabbing = false;
            playerState.isGrabbed = false;
            playerState.isStunned = false;
            playerState.isEliminated = false;
            playerState.grabbedBy = null;
            playerState.grabbing = null;
            playerState.velocity = { x: 0, y: 0, z: 0 };
            
            // Position around the ring
            const angle = (index / 4) * Math.PI * 2;
            const radius = ARENA_CONFIG.RING_SIZE / 3;
            playerState.position = {
                x: Math.cos(angle) * radius,
                y: ARENA_CONFIG.RING_HEIGHT,
                z: Math.sin(angle) * radius
            };
            playerState.facingAngle = angle + Math.PI; // Face center
            
            index++;
        });
        
        return { success: true };
    }
    
    /**
     * Get player state formatted for client
     */
    getPlayerStateForClient(playerState) {
        return {
            id: playerState.id,
            name: playerState.name,
            number: playerState.number,
            position: { ...playerState.position },
            velocity: { ...playerState.velocity },
            facingAngle: playerState.facingAngle,
            health: playerState.health,
            stamina: playerState.stamina,
            isAttacking: playerState.isAttacking,
            isBlocking: playerState.isBlocking,
            isGrabbing: playerState.isGrabbing,
            isGrabbed: playerState.isGrabbed,
            isStunned: playerState.isStunned,
            isEliminated: playerState.isEliminated
        };
    }
    
    /**
     * Clean up arena state for a room
     */
    cleanup(roomCode) {
        this.arenaStates.delete(roomCode);
        this.pendingAttacks.delete(roomCode);
        this.pendingGrabs.delete(roomCode);
    }
}

export default ArenaStateManager;

