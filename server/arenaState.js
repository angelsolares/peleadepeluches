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
    STUN_FRICTION: 0.92,   // Lighter friction while stunned so hit knockback actually moves the victim
    FALL_OUT_DEPTH: 3,     // Ring-out when a player falls this far below the ring floor
    COLLISION_RADIUS: 0.8, // Players closer than this are pushed apart (server-authoritative)

    // Carry position of a grabbed player relative to the grabber (MUST match client updateGrabbedPlayerPositions)
    CARRY_OFFSET: 0.3,
    CARRY_HEIGHT: 1.2,
    
    // Health & Stamina
    MAX_HEALTH: 100,
    MAX_STAMINA: 100,
    STAMINA_REGEN: 10,          // Normal regen rate
    STAMINA_REGEN_TAUNT: 25,    // Fast regen when taunting/dancing
    
    // Stamina costs
    PUNCH_STAMINA: 20,
    KICK_STAMINA: 28,
    GRAB_STAMINA: 35,
    THROW_STAMINA: 0,           // Throw is FREE - reward for successful grab!
    BLOCK_STAMINA_PER_SEC: 10,
    
    // Damage
    PUNCH_DAMAGE: 10,
    KICK_DAMAGE: 15,
    THROW_DAMAGE: 25,
    RING_OUT_DAMAGE: 50,
    
    // Knockback
    PUNCH_KNOCKBACK: 3,
    KICK_KNOCKBACK: 5,
    THROW_KNOCKBACK: 10,       // Reduced 60% (was 25) - still good for ring outs near edge
    THROW_HEIGHT: 8,           // Reduced height to match shorter distance
    
    // Timing
    ATTACK_COOLDOWN: 500,      // ms
    ACTIVE_FRAME_DELAY: 150,   // ms before hit detection
    GRAB_DURATION: 10000,      // ms - time to hold before auto-release (10 seconds)
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
        const totalPlayers = room.players.size;
        let playerIndex = 0;
        room.players.forEach((player, socketId) => {
            const playerState = this.createPlayerArenaState(player, playerIndex, totalPlayers);
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
    createPlayerArenaState(player, index = 0, totalPlayers = 8) {
        // Calculate initial position around the ring (evenly distributed)
        const angle = (index / totalPlayers) * Math.PI * 2;
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
            isTaunting: false,
            tauntEndTime: 0,
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
        const simulated = [];             // Active players updated this tick
        const previousPositions = new Map(); // socketId -> {x, z} before movement (for rope checks)

        // Pass 1: input, timers and movement
        arenaState.players.forEach((playerState, socketId) => {
            if (playerState.isEliminated) return;

            const roomPlayer = room.players.get(socketId);
            if (!roomPlayer) return;
            simulated.push(playerState);
                        
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
            
            previousPositions.set(socketId, { x: playerState.position.x, z: playerState.position.z });

            // Carried players are positioned by their grabber (pass 4).
            // Everyone else is integrated every tick, including stunned/thrown players
            // so knockback and throws actually move them. They just can't steer.
            if (!playerState.isGrabbed) {
                const canControl = !playerState.isStunned && !playerState.isBeingThrown;
                this.processPlayerMovement(playerState, delta, canControl);
            }

            // Regenerate stamina
            this.updateStamina(playerState, delta);
        });

        // Pass 2: body collisions (server-authoritative so the host doesn't fight the server)
        this.resolvePlayerCollisions(simulated);

        // Pass 3: ropes
        for (const playerState of simulated) {
            if (playerState.isGrabbed) continue;
            this.checkRingBoundaries(playerState, previousPositions.get(playerState.id));
        }

        // Pass 4: carried players follow their grabber
        for (const playerState of simulated) {
            if (playerState.isGrabbed) this.followGrabber(arenaState, playerState);
        }

        // Serialize (eliminated players are still sent so clients keep showing them)
        arenaState.players.forEach((playerState, socketId) => {
            if (playerState.isEliminated || simulated.includes(playerState)) {
                players.push(this.getPlayerStateForClient(playerState));
            }
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
    processPlayerMovement(playerState, delta, canControl = true) {
        // Check if player is locked in an action (attacking, blocking, or taunting)
        const isLockedInAction = playerState.isAttacking || playerState.isBlocking || playerState.isTaunting;

        if (!canControl) {
            // Stunned or flying: no input, momentum is handled by friction below
        } else if (isLockedInAction) {
            // Slow down while locked in action (can't move)
            playerState.velocity.x *= 0.9;
            playerState.velocity.z *= 0.9;
        } else {
            // Calculate movement direction
            let dirX = 0, dirZ = 0;
            
            if (playerState.input.left) dirX -= 1;
            if (playerState.input.right) dirX += 1;
            if (playerState.input.up) dirZ -= 1;
            if (playerState.input.down) dirZ += 1;
            
            // Normalize diagonal
            const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
            if (length > 0) {
                dirX /= length;
                dirZ /= length;
                
                // Slower speed when carrying someone
                let speed = playerState.input.run ? ARENA_CONFIG.RUN_SPEED : ARENA_CONFIG.MOVE_SPEED;
                if (playerState.isGrabbing) {
                    speed *= 0.5; // Walk slower when carrying
                }
                
                playerState.velocity.x = dirX * speed;
                playerState.velocity.z = dirZ * speed;
                
                // Update facing angle
                playerState.facingAngle = Math.atan2(dirX, dirZ);
            }
        }
        
        // Apply friction
        // Less friction when thrown (keep the arc) or stunned (let hit knockback push the victim)
        const friction = playerState.isBeingThrown ? 0.98 :
                         playerState.isStunned ? ARENA_CONFIG.STUN_FRICTION :
                         ARENA_CONFIG.FRICTION;
        playerState.velocity.x *= friction;
        playerState.velocity.z *= friction;

        // Gravity applies in the air and anywhere off the ring platform (there is no floor out there)
        const prevY = playerState.position.y;
        if (playerState.position.y > ARENA_CONFIG.RING_HEIGHT || !this.isOverRing(playerState.position)) {
            playerState.velocity.y += ARENA_CONFIG.GRAVITY * delta;
        }

        // Update position
        playerState.position.x += playerState.velocity.x * delta;
        playerState.position.y += playerState.velocity.y * delta;
        playerState.position.z += playerState.velocity.z * delta;

        // Land on the ring only when coming from above while over the platform.
        // Someone who already fell below the floor keeps falling (ring-out) instead of popping back up.
        if (this.isOverRing(playerState.position) &&
            playerState.position.y <= ARENA_CONFIG.RING_HEIGHT &&
            prevY >= ARENA_CONFIG.RING_HEIGHT - 0.05) {
            playerState.position.y = ARENA_CONFIG.RING_HEIGHT;
            if (playerState.velocity.y < 0) {
                playerState.velocity.y = 0;

                // Reset thrown state when landing
                if (playerState.isBeingThrown) {
                    playerState.isBeingThrown = false;
                    // Reduce stun time when landing
                    playerState.stunEndTime = Math.min(playerState.stunEndTime, Date.now() + 500);
                }
            }
        }
    }

    /**
     * Whether an X/Z position is above the ring platform (the floor ends at the platform edge)
     */
    isOverRing(position) {
        const half = ARENA_CONFIG.RING_SIZE / 2;
        return Math.abs(position.x) <= half && Math.abs(position.z) <= half;
    }

    /**
     * Keep a grabbed player in the carry position (behind and above the grabber).
     * Without this the victim's server position stays where they were grabbed,
     * so hits miss and they teleport back on release.
     */
    followGrabber(arenaState, playerState) {
        const grabber = arenaState.players.get(playerState.grabbedBy);
        if (!grabber || grabber.isEliminated) return;

        const angle = grabber.facingAngle || 0;
        playerState.position.x = grabber.position.x - Math.sin(angle) * ARENA_CONFIG.CARRY_OFFSET;
        playerState.position.z = grabber.position.z - Math.cos(angle) * ARENA_CONFIG.CARRY_OFFSET;
        playerState.position.y = grabber.position.y + ARENA_CONFIG.CARRY_HEIGHT;
        playerState.velocity = { x: 0, y: 0, z: 0 };
    }

    /**
     * Push overlapping players apart on the ground plane.
     * Stunned and thrown players pass through so knockback isn't absorbed by bodies.
     */
    resolvePlayerCollisions(players) {
        const radius = ARENA_CONFIG.COLLISION_RADIUS;
        const active = players.filter(p =>
            !p.isEliminated && !p.isGrabbed && !p.isBeingThrown && !p.isStunned &&
            p.position.y <= ARENA_CONFIG.RING_HEIGHT + 0.3
        );

        for (let i = 0; i < active.length; i++) {
            for (let j = i + 1; j < active.length; j++) {
                const a = active[i];
                const b = active[j];
                if (a.grabbing === b.id || b.grabbing === a.id) continue;

                let dx = b.position.x - a.position.x;
                let dz = b.position.z - a.position.z;
                let dist = Math.sqrt(dx * dx + dz * dz);
                if (dist >= radius) continue;

                if (dist < 0.0001) {
                    // Exactly on top of each other: pick an arbitrary direction
                    dx = 1; dz = 0; dist = 1;
                    const push = radius / 2;
                    a.position.x -= push;
                    b.position.x += push;
                    continue;
                }

                const push = (radius - dist) / 2;
                const nx = dx / dist;
                const nz = dz / dist;
                a.position.x -= nx * push;
                a.position.z -= nz * push;
                b.position.x += nx * push;
                b.position.z += nz * push;
            }
        }
    }
    
    /**
     * Update stamina regeneration
     */
    updateStamina(playerState, delta) {
        if (playerState.isBlocking) {
            // Blocking drains stamina
            playerState.stamina = Math.max(
                0,
                playerState.stamina - ARENA_CONFIG.BLOCK_STAMINA_PER_SEC * delta
            );
        } else if (playerState.isTaunting) {
            // Taunting/Dancing regenerates stamina FAST
            playerState.stamina = Math.min(
                ARENA_CONFIG.MAX_STAMINA,
                playerState.stamina + ARENA_CONFIG.STAMINA_REGEN_TAUNT * delta
            );
        } else if (!playerState.isAttacking && !playerState.isGrabbing) {
            // Normal slow regeneration when idle
            playerState.stamina = Math.min(
                ARENA_CONFIG.MAX_STAMINA,
                playerState.stamina + ARENA_CONFIG.STAMINA_REGEN * delta
            );
        }
    }
    
    /**
     * Check and handle ring boundary collisions
     * @param {object} playerState - Player state
     * @param {{x:number, z:number}} prevPos - Position before this tick's movement
     */
    checkRingBoundaries(playerState, prevPos) {
        const ringHalf = ARENA_CONFIG.RING_SIZE / 2 - 0.8; // Rope boundary (matches client)
        const ringBounce = 0.3; // Bounce back force when hitting ropes
        const RING_OUT_SPEED = 10; // Faster than this goes through the ropes

        // Calculate total horizontal speed
        const speed = Math.sqrt(
            playerState.velocity.x * playerState.velocity.x +
            playerState.velocity.z * playerState.velocity.z
        );

        // Off the platform (between the ring edge and the ring-out line)
        playerState.isOutOfRing = !this.isOverRing(playerState.position);

        // Thrown or very fast players fly through the ropes
        const flying = playerState.isBeingThrown || speed > RING_OUT_SPEED;

        // Ropes only stop players crossing them from the inside.
        // Someone already outside (e.g. thrown onto the apron) isn't pulled back into the ring.
        const prev = prevPos || playerState.position;
        if (!flying) {
            if (Math.abs(prev.x) <= ringHalf && Math.abs(playerState.position.x) > ringHalf) {
                playerState.position.x = Math.sign(playerState.position.x) * ringHalf;
                playerState.velocity.x *= -ringBounce;
            }
            if (Math.abs(prev.z) <= ringHalf && Math.abs(playerState.position.z) > ringHalf) {
                playerState.position.z = Math.sign(playerState.position.z) * ringHalf;
                playerState.velocity.z *= -ringBounce;
            }
        }
                
        // Set near edge flag for visual warnings
        const edgeDistance = 1.5;
        playerState.isNearEdge = 
            Math.abs(playerState.position.x) > ringHalf - edgeDistance ||
            Math.abs(playerState.position.z) > ringHalf - edgeDistance;
    }
    
    /**
     * Check for ring out eliminations
     */
    checkRingOuts(roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return [];
        
        const ringOuts = [];
        const ringHalf = ARENA_CONFIG.RING_SIZE / 2;
        const outZone = ARENA_CONFIG.RING_OUT_ZONE || 3;
        
        arenaState.players.forEach((playerState, playerId) => {
            if (playerState.isEliminated) return;
            
            // Check if player is outside ring out zone, or fell off the platform
            const isOutX = Math.abs(playerState.position.x) > ringHalf + outZone;
            const isOutZ = Math.abs(playerState.position.z) > ringHalf + outZone;
            const fellOff = playerState.position.y < ARENA_CONFIG.RING_HEIGHT - ARENA_CONFIG.FALL_OUT_DEPTH;

            if (isOutX || isOutZ || fellOff) {
                console.log(`[Arena] RING OUT! ${playerState.name} fell out of the ring!`);
                
                // Eliminate the player
                const elimInfo = this.eliminatePlayer(arenaState, playerId);
                
                if (elimInfo) {
                    ringOuts.push({
                        playerId,
                        playerName: playerState.name,
                        playerNumber: playerState.number,
                        reason: 'ringout',
                        position: elimInfo.position
                    });
                }
            }
        });
        
        return ringOuts;
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
        console.log(`[Arena] processGrab called for ${socketId} in ${roomCode}`);
        
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) {
            console.log('[Arena] No arena state found');
            return null;
        }
        
        const attacker = arenaState.players.get(socketId);
        if (!attacker) {
            console.log('[Arena] Attacker not found');
            return null;
        }
        if (attacker.isEliminated) {
            console.log('[Arena] Attacker is eliminated');
            return null;
        }
        if (attacker.isGrabbing) {
            console.log('[Arena] Attacker already grabbing');
            return null;
        }
        if (attacker.isGrabbed || attacker.isStunned || attacker.isBeingThrown) {
            // A carried/stunned/flying player grabbing someone would chain carries and teleport bodies
            return null;
        }
        
        // Check stamina
        if (attacker.stamina < ARENA_CONFIG.GRAB_STAMINA) {
            console.log(`[Arena] Not enough stamina: ${attacker.stamina} < ${ARENA_CONFIG.GRAB_STAMINA}`);
            return null;
        }
        
        // Find nearest player in grab range
        let nearestTarget = null;
        let nearestDistance = ARENA_CONFIG.GRAB_RANGE;
        
        console.log(`[Arena] Looking for target in range ${ARENA_CONFIG.GRAB_RANGE} from pos (${attacker.position.x.toFixed(2)}, ${attacker.position.z.toFixed(2)})`);
        
        arenaState.players.forEach((targetState, targetId) => {
            if (targetId === socketId) return;
            if (targetState.isEliminated) {
                console.log(`[Arena] Target ${targetId} is eliminated`);
                return;
            }
            if (targetState.isGrabbed) {
                console.log(`[Arena] Target ${targetId} already grabbed`);
                return;
            }
            if (targetState.isBeingThrown || targetState.position.y > ARENA_CONFIG.RING_HEIGHT + 0.3) {
                return; // Can't grab someone in the air
            }
            
            const dx = targetState.position.x - attacker.position.x;
            const dz = targetState.position.z - attacker.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            console.log(`[Arena] Target ${targetId} at distance ${distance.toFixed(2)}`);
            
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestTarget = targetState;
            }
        });
        
        if (nearestTarget) {
            console.log(`[Arena] GRAB SUCCESS! Target: ${nearestTarget.id}`);
            
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
        
        console.log('[Arena] No target found in range');
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
        
        // 0 is a valid angle (straight "down"), so only fall back to facing when no number was sent
        const throwAngle = (typeof direction === 'number' && Number.isFinite(direction))
            ? direction
            : attacker.facingAngle;

        // IMPORTANT: Set target position to carried position BEFORE applying velocity
        // This prevents "teleport behind" - throw starts from where victim was being carried
        const carryOffset = ARENA_CONFIG.CARRY_OFFSET;
        const carryHeight = ARENA_CONFIG.CARRY_HEIGHT;
        target.position.x = attacker.position.x - Math.sin(throwAngle) * carryOffset;
        target.position.z = attacker.position.z - Math.cos(throwAngle) * carryOffset;
        target.position.y = attacker.position.y + carryHeight;
        
        // Now apply throw velocity FROM the carried position
        target.velocity.x = Math.sin(throwAngle) * ARENA_CONFIG.THROW_KNOCKBACK;
        target.velocity.z = Math.cos(throwAngle) * ARENA_CONFIG.THROW_KNOCKBACK;
        target.velocity.y = ARENA_CONFIG.THROW_HEIGHT; // Launch upward for arc
        
        console.log(`[Throw Debug] Throwing ${target.name}:`);
        console.log(`  - Angle: ${throwAngle.toFixed(2)}`);
        console.log(`  - Velocity: X=${target.velocity.x.toFixed(2)}, Y=${target.velocity.y.toFixed(2)}, Z=${target.velocity.z.toFixed(2)}`);
        console.log(`  - Config: KNOCKBACK=${ARENA_CONFIG.THROW_KNOCKBACK}, HEIGHT=${ARENA_CONFIG.THROW_HEIGHT}`);
        
        target.isStunned = true;
        target.isBeingThrown = true; // Mark as thrown for client effects
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
            targetName: target.name,
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
     * Set player taunting state (for stamina boost while dancing)
     */
    setPlayerTaunting(socketId, roomCode, isTaunting) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return;
        
        const playerState = arenaState.players.get(socketId);
        if (!playerState) return;
        
        playerState.isTaunting = isTaunting;
        
        if (isTaunting) {
            console.log(`[Arena] Player ${playerState.name} is taunting (stamina boost active)`);
        }
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
            // Push the grabber away from the victim (the victim is carried behind the grabber,
            // so pushing "backwards" along the facing would shove the grabber into them)
            let awayX = grabber.position.x - target.position.x;
            let awayZ = grabber.position.z - target.position.z;
            const awayLen = Math.sqrt(awayX * awayX + awayZ * awayZ);
            if (awayLen > 0.0001) {
                awayX /= awayLen;
                awayZ /= awayLen;
            } else {
                const angle = grabber.facingAngle || 0;
                awayX = Math.sin(angle);
                awayZ = Math.cos(angle);
            }
            grabber.velocity.x += awayX * 8;
            grabber.velocity.z += awayZ * 8;
            grabber.isStunned = true;
            grabber.stunEndTime = Date.now() + 1000; // Longer stun from escape hit
            // Apply some damage from the escape punch
            grabber.health = Math.max(0, grabber.health - 10);
        }

        // The escape punch can finish the grabber off
        let grabberElimination = null;
        if (grabber && grabber.health <= 0) {
            grabberElimination = this.eliminatePlayer(arenaState, grabberId);
        }
        
        // Target recovers in place
        target.velocity.x = 0;
        target.velocity.z = 0;
        
        console.log(`[Arena] Player ${target.name} escaped from grab successfully!`);
        
        return {
            success: true,
            grabberId: grabberId,
            grabberEliminated: !!grabberElimination,
            grabberName: grabber?.name,
            grabberNumber: grabber?.number
        };
    }
    
    /**
     * Eliminate a player
     * Returns elimination info for broadcasting
     */
    eliminatePlayer(arenaState, playerId) {
        const playerState = arenaState.players.get(playerId);
        if (!playerState || playerState.isEliminated) return null;
        
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
        
        console.log(`[Arena] Player ${playerState.name} (${playerId}) ELIMINATED!`);
        
        // Check for round end BEFORE returning
        const alivePlayers = [];
        arenaState.players.forEach((ps, id) => {
            if (!ps.isEliminated) alivePlayers.push(id);
        });
        
        console.log(`[Arena] Alive players remaining: ${alivePlayers.length}`);
        
        if (alivePlayers.length <= 1) {
            arenaState.roundState = 'finished';
            arenaState.lastWinner = alivePlayers[0] || null;
            console.log(`[Arena] ROUND FINISHED! Winner: ${arenaState.lastWinner || 'None'}`);
        }
        
        // Return elimination info for broadcasting
        return {
            playerId,
            playerName: playerState.name,
            playerNumber: playerState.number,
            position: arenaState.eliminationOrder.length
        };
    }
    
    /**
     * Remove a player who left the room mid-match.
     * They are eliminated (releasing any grab and ending the round if only one player remains)
     * and then dropped from the arena state so they can't be grabbed or counted as alive.
     * @returns {object|null} Elimination info, or null if the player wasn't in the arena
     */
    removePlayer(roomCode, socketId) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState || !arenaState.players.has(socketId)) return null;

        const playerState = arenaState.players.get(socketId);
        const wasAlive = !playerState.isEliminated;
        const elimination = wasAlive && arenaState.roundState === 'active'
            ? this.eliminatePlayer(arenaState, socketId)
            : null;

        // Drop any queued attacks from the player who left
        const pending = this.pendingAttacks.get(roomCode);
        if (pending) {
            this.pendingAttacks.set(roomCode, pending.filter(atk => atk.attackerId !== socketId));
        }

        arenaState.players.delete(socketId);

        // If the round already ended without a recorded winner, re-check who is left
        if (arenaState.roundState === 'finished' && arenaState.lastWinner === socketId) {
            const alive = [...arenaState.players.values()].filter(p => !p.isEliminated);
            arenaState.lastWinner = alive.length === 1 ? alive[0].id : null;
        }

        return elimination ? { ...elimination, reason: 'disconnect' } : null;
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
            playerState.isBeingThrown = false;
            playerState.isOutOfRing = false;
            playerState.velocity = { x: 0, y: 0, z: 0 };
            
            // Position around the ring (evenly distributed based on total players)
            const totalPlayers = arenaState.players.size;
            const angle = (index / totalPlayers) * Math.PI * 2;
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

