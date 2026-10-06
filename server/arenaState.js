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

    // ---- Grappling (WCW/nWo style) ----
    TIEUP_DURATION: 2500,      // ms the attacker has to pick a move before the tie-up breaks
    TIEUP_STAMINA: 25,         // Cost of starting a tie-up
    TIEUP_DISTANCE: 0.9,       // Distance between both players while locked up
    TIEUP_ESCAPE_TAPS: 5,      // Defender taps needed to break a tie-up
    LIFT_STAMINA: 10,          // Tie-up -> lift into the carry
    CARRY_ESCAPE_TAPS: 6,      // Taps needed to escape a carry
    LANDING_DISTANCE: 1.3,     // Where slammed/suplexed players land (in front / behind)
    DOWN_DURATION: 3000,       // ms a slammed player stays on the mat
    GETUP_DURATION: 1500,      // ms of the getting-up animation (invulnerable)
    STOMP_DAMAGE: 6,
    STOMP_STAMINA: 10,
    STOMP_RANGE: 1.6,
    PIN_RANGE: 1.7,
    PIN_COUNT_INTERVAL: 1000,  // ms between referee counts (1, 2, 3)

    // Grapple moves: picked in a tie-up with PUNCH/KICK, with or without a stick direction
    MOVES: {
        headbutt: { damage: 10, stamina: 10, duration: 900,  impact: 450,  down: false, stun: 800, knockback: 5 },
        knee:     { damage: 12, stamina: 10, duration: 900,  impact: 450,  down: false, stun: 800, knockback: 5 },
        slam:     { damage: 15, stamina: 20, duration: 1300, impact: 850,  down: true,  landing: 'front' },
        suplex:   { damage: 20, stamina: 20, duration: 1500, impact: 1000, down: true,  landing: 'back' }
    }
};

// ---- Spirit meter & finishers (phase 2) ----
const SPIRIT_CONFIG = {
    MAX: 100,
    GAIN: { punch: 5, kick: 6, stomp: 4, headbutt: 8, knee: 8, slam: 12, suplex: 12, throw: 10, pinCount: 3 },
    TAUNT_PER_SEC: 22,       // Taunting fills the meter fast (but leaves you open)
    DAMAGE_TAKEN_LOSS: 3,    // Taking a hit lowers it a bit (not while SPECIAL)
    SPECIAL_DURATION: 12000, // ms to use the finisher once the meter is full
    AFTER_TIMEOUT: 60,       // Meter left if SPECIAL runs out unused
    TAUNT_DURATION: 2500
};

// Finisher types. 'from': tieup = from a tie-up as the attacker; standing = opponent in front;
// downed = opponent on the mat nearby.
const FINISHERS = {
    powerbomb:  { from: 'tieup',    damage: 30, duration: 1800, impact: 1300, down: 4500, landingDist: 1.4 },
    piledriver: { from: 'tieup',    damage: 32, duration: 1700, impact: 1150, down: 4500, landingDist: 0.8 },
    ddt:        { from: 'tieup',    damage: 28, duration: 1400, impact: 900,  down: 4500, landingDist: 1.0 },
    superkick:  { from: 'standing', damage: 28, duration: 1000, impact: 500,  down: 3500, range: 2.2, knockback: 13, launchY: 6 },
    splash:     { from: 'downed',   damage: 30, duration: 1200, impact: 800,  down: 4000, range: 3.2 }
};

// One signature finisher per character (variant picks the attacker animation on the host)
const CHARACTER_FINISHERS = {
    edgar:    { type: 'powerbomb',  name: 'EDGARBOMBA' },
    sol:      { type: 'powerbomb',  name: 'ECLIPSE TOTAL' },
    marile:   { type: 'powerbomb',  name: 'MARILE BOMBA' },
    jesus:    { type: 'piledriver', name: 'MARTINETE MILAGROSO' },
    lidia:    { type: 'piledriver', name: 'MARTINETE DE LIDIA' },
    gabriel:  { type: 'piledriver', name: 'MARTINETE CELESTIAL' },
    lia:      { type: 'ddt',        name: 'DDT DE LIA' },
    yadira:   { type: 'ddt',        name: 'YADI-DDT' },
    isabella: { type: 'ddt',        name: 'ISA-DDT' },
    hector:   { type: 'superkick',  name: 'SÚPER PATADA HÉCTOR', variant: 'mma' },
    katy:     { type: 'superkick',  name: 'KATY KICK',           variant: 'flying' },
    fabian:   { type: 'superkick',  name: 'PATADA HURACÁN',      variant: 'hurricane' },
    angel:    { type: 'splash',     name: 'SALTO DEL ÁNGEL',     variant: 'jump' },
    mariana:  { type: 'splash',     name: 'PLANCHA MARIANA',     variant: 'dive' },
    baby:     { type: 'splash',     name: 'PAÑALAZO',            variant: 'dive' }
};
const DEFAULT_FINISHER = { type: 'superkick', name: 'SÚPER PATADA', variant: 'mma' };

/**
 * Taps a pinned player needs to kick out: harder the more damage they have taken
 */
function kickoutTapsNeeded(health) {
    return 3 + Math.floor(Math.max(0, ARENA_CONFIG.MAX_HEALTH - health) / 15);
}

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
            events: [],        // Queued socket events ({ name, data }) drained by the server loop
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
            character: player.character || null,
            finisher: CHARACTER_FINISHERS[player.character] || DEFAULT_FINISHER,
            spirit: 0,
            specialUntil: 0,    // > now while SPECIAL (finisher available)
            pendingDown: 0,     // ms to stay down when a launched player lands (superkick)
                        
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
            escapeTaps: 0,

            // Grappling state
            tieUp: null,       // { partnerId, role: 'attacker'|'defender', until, escapeTaps }
            move: null,        // { type, role, partnerId, startedAt, impactAt, endAt, impactDone, landing }
            isDown: false,
            downUntil: 0,
            isGettingUp: false,
            getUpUntil: 0,
            pin: null,         // { partnerId, role: 'pinner'|'pinned', count, nextCountAt, taps, tapsNeeded }

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
        // Real elapsed time: setInterval(16.7 ms) can run much slower (e.g. ~36 Hz on Windows),
        // and a fixed 1/60 step would slow the whole match down
        const delta = Math.min(0.05, Math.max(0.001, (now - (arenaState.lastTickAt || (now - 1000 / 60))) / 1000));
        arenaState.lastTickAt = now;
        // Per-tick factors (friction) were tuned at 60 FPS: scale them to the real step
        this.frameScale = delta * 60;
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

            // Grappling timers (tie-up timeout, move impact/end, down/get-up, pin counts)
            this.updateGrappleTimers(arenaState, playerState, now);
            if (playerState.isEliminated) return;

            // Taunt ends on its own timer (no overlapping setTimeouts)
            if (playerState.isTaunting && now >= playerState.tauntEndTime) {
                playerState.isTaunting = false;
            }

            // Spirit: taunting fills it; SPECIAL runs out if unused
            if (playerState.isTaunting) {
                this.addSpirit(arenaState, playerState, SPIRIT_CONFIG.TAUNT_PER_SEC * delta);
            }
            if (playerState.specialUntil && now >= playerState.specialUntil) {
                playerState.specialUntil = 0;
                playerState.spirit = SPIRIT_CONFIG.AFTER_TIMEOUT;
                this.pushEvent(arenaState, 'arena-special-end', { playerId: playerState.id, reason: 'timeout' });
            }
                        
            previousPositions.set(socketId, { x: playerState.position.x, z: playerState.position.z });

            // Carried players are positioned by their grabber (pass 4).
            // Everyone else is integrated every tick, including stunned/thrown players
            // so knockback and throws actually move them. They just can't steer.
            if (!playerState.isGrabbed) {
                const locked = this.isLocked(playerState);
                if (locked) {
                    // Grapples, downs and pins hold players in place
                    playerState.velocity.x = 0;
                    playerState.velocity.z = 0;
                }
                const canControl = !playerState.isStunned && !playerState.isBeingThrown && !locked;
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
            playerState.velocity.x *= Math.pow(0.9, this.frameScale || 1);
            playerState.velocity.z *= Math.pow(0.9, this.frameScale || 1);
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
        const frictionStep = Math.pow(friction, this.frameScale || 1);
        playerState.velocity.x *= frictionStep;
        playerState.velocity.z *= frictionStep;

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

                // A superkicked player lands flat on the mat
                if (playerState.pendingDown) {
                    playerState.isDown = true;
                    playerState.downUntil = Date.now() + playerState.pendingDown;
                    playerState.pendingDown = 0;
                    playerState.isStunned = false;
                    playerState.velocity.x = 0;
                    playerState.velocity.z = 0;
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
            !p.move && !p.isDown && !p.pin && !p.tieUp &&
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

        // In a tie-up, PUNCH/KICK pick a grapple move instead of a strike
        if (playerState.tieUp) {
            if (playerState.tieUp.role !== 'attacker') return null;
            return this.startGrappleMove(arenaState, playerState, attackType);
        }

        // Busy with a grapple, on the mat, getting up, pinning or being carried
        if (this.isLocked(playerState) || playerState.isGrabbed || playerState.isGrabbing) return null;

        // Check cooldown
        if (now - playerState.lastAttackTime < ARENA_CONFIG.ATTACK_COOLDOWN) {
            return null;
        }

        // Strike on a downed opponent nearby (and nobody standing in range) = stomp
        if (attackType === 'punch' || attackType === 'kick') {
            const reach = attackType === 'punch' ? ARENA_CONFIG.PUNCH_RANGE : ARENA_CONFIG.KICK_RANGE;
            let downedNear = false, standingNear = false;
            arenaState.players.forEach((other, otherId) => {
                if (otherId === socketId || other.isEliminated) return;
                const d = Math.hypot(other.position.x - playerState.position.x, other.position.z - playerState.position.z);
                if (other.isDown && d <= ARENA_CONFIG.STOMP_RANGE) downedNear = true;
                else if (!other.isDown && d <= reach) standingNear = true;
            });
            if (downedNear && !standingNear) attackType = 'stomp';
        }
        
        // Check stamina
        const staminaCost = attackType === 'punch' ? ARENA_CONFIG.PUNCH_STAMINA :
                          attackType === 'kick' ? ARENA_CONFIG.KICK_STAMINA :
                          attackType === 'stomp' ? ARENA_CONFIG.STOMP_STAMINA :
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
        
        const isStomp = attack.attackType === 'stomp';

        const range = attack.attackType === 'punch' ? ARENA_CONFIG.PUNCH_RANGE :
                     attack.attackType === 'kick' ? ARENA_CONFIG.KICK_RANGE :
                     isStomp ? ARENA_CONFIG.STOMP_RANGE :
                     ARENA_CONFIG.GRAB_RANGE;

        const damage = attack.attackType === 'punch' ? ARENA_CONFIG.PUNCH_DAMAGE :
                      attack.attackType === 'kick' ? ARENA_CONFIG.KICK_DAMAGE :
                      isStomp ? ARENA_CONFIG.STOMP_DAMAGE : 0;

        const knockback = attack.attackType === 'punch' ? ARENA_CONFIG.PUNCH_KNOCKBACK :
                         attack.attackType === 'kick' ? ARENA_CONFIG.KICK_KNOCKBACK : 0;

        const hits = [];

        // Check all other players for hits
        arenaState.players.forEach((targetState, targetId) => {
            if (targetId === attack.attackerId || targetState.isEliminated) return;

            // Stomps only hit players on the mat; strikes only hit standing players.
            // Players inside a grapple move or getting up can't be hit.
            if (isStomp !== !!targetState.isDown) return;
            if (targetState.move || targetState.isGettingUp) return;

            // Calculate distance
            const dx = targetState.position.x - attack.position.x;
            const dz = targetState.position.z - attack.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            // Check if in range
            if (distance <= range) {
                // Check if in attack arc (roughly 120 degrees in front; stomps hit all around)
                const angleToTarget = Math.atan2(dx, dz);
                let angleDiff = angleToTarget - attack.facingAngle;

                // Normalize angle difference
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                if (isStomp || Math.abs(angleDiff) < Math.PI / 3) { // 60 degrees each side
                    // Getting hit breaks a tie-up, and hitting a pinner breaks the pin
                    if (targetState.tieUp) this.breakTieUp(arenaState, targetState, 'interrupted');
                    if (targetState.pin && targetState.pin.role === 'pinner') this.endPin(arenaState, targetState, 'interrupted');
                    // Hit!
                    const blocked = targetState.isBlocking;
                    const actualDamage = blocked ? damage * 0.2 : damage;
                    const actualKnockback = blocked ? knockback * 0.3 : knockback;
                    
                    // Apply damage
                    targetState.health = Math.max(0, targetState.health - actualDamage);

                    // Spirit: the attacker gains, the target loses a little
                    if (!blocked) {
                        this.addSpirit(arenaState, attacker, SPIRIT_CONFIG.GAIN[attack.attackType] || 0);
                        this.loseSpirit(targetState);
                    }
                    
                    // Apply knockback (away from attacker)
                    const knockbackAngle = Math.atan2(dx, dz);
                    targetState.velocity.x += Math.sin(knockbackAngle) * actualKnockback;
                    targetState.velocity.z += Math.cos(knockbackAngle) * actualKnockback;
                    
                    // Apply stun if not blocked (a stomped player is already on the mat)
                    if (!blocked && !isStomp) {
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

        // GRAB while holding someone in a tie-up: lift them into the carry
        if (attacker.tieUp && attacker.tieUp.role === 'attacker') {
            return this.liftFromTieUp(arenaState, attacker);
        }

        // Busy (tie-up defender, grapple move, on the mat, getting up, pinning)
        if (this.isLocked(attacker)) return null;
        if (attacker.isGrabbing) {
            console.log('[Arena] Attacker already grabbing');
            return null;
        }
        if (attacker.isGrabbed || attacker.isStunned || attacker.isBeingThrown) {
            // A carried/stunned/flying player grabbing someone would chain carries and teleport bodies
            return null;
        }
        
        // GRAB next to a downed opponent: pin (cover) them for the 3-count
        const pinTarget = this.findPinTarget(arenaState, attacker);
        if (pinTarget) {
            return this.startPin(arenaState, attacker, pinTarget);
        }

        // Check stamina
        if (attacker.stamina < ARENA_CONFIG.TIEUP_STAMINA) {
            console.log(`[Arena] Not enough stamina: ${attacker.stamina} < ${ARENA_CONFIG.TIEUP_STAMINA}`);
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
            if (targetState.isGrabbing || this.isLocked(targetState)) {
                return; // Already busy in another grapple, on the mat or getting up
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
            console.log(`[Arena] TIE-UP! ${attacker.name} locks up with ${nearestTarget.name}`);
            attacker.stamina -= ARENA_CONFIG.TIEUP_STAMINA;
            return this.startTieUp(arenaState, attacker, nearestTarget);
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
        this.addSpirit(arenaState, attacker, SPIRIT_CONFIG.GAIN.throw);
        this.loseSpirit(target);
        
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
        
        if (isTaunting) {
            // Can't taunt while locked in a grapple, on the mat, carried or carrying
            if (this.isLocked(playerState) || playerState.isGrabbed || playerState.isGrabbing || playerState.isEliminated) {
                return false;
            }
            playerState.isTaunting = true;
            playerState.tauntEndTime = Date.now() + SPIRIT_CONFIG.TAUNT_DURATION;
            return true;
        }
        playerState.isTaunting = false;
        return true;
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
        
        // Mashing out of a tie-up
        if (target.tieUp && target.tieUp.role === 'defender') {
            target.tieUp.escapeTaps++;
            if (target.tieUp.escapeTaps < ARENA_CONFIG.TIEUP_ESCAPE_TAPS) {
                return { success: true, escaped: false, mode: 'tieup', taps: target.tieUp.escapeTaps, needed: ARENA_CONFIG.TIEUP_ESCAPE_TAPS };
            }
            const attackerId = target.tieUp.partnerId;
            this.breakTieUp(arenaState, target, 'escape');
            return { success: true, escaped: true, mode: 'tieup', attackerId };
        }

        // Kicking out of a pin
        if (target.pin && target.pin.role === 'pinned') {
            target.pin.taps++;
            if (target.pin.taps < target.pin.tapsNeeded) {
                return { success: true, escaped: false, mode: 'pin', taps: target.pin.taps, needed: target.pin.tapsNeeded };
            }
            this.endPin(arenaState, target, 'kickout');
            return { success: true, escaped: true, mode: 'pin' };
        }

        console.log(`[Arena] Target state: isGrabbed=${target.isGrabbed}, grabbedBy=${target.grabbedBy}`);

        // Check if player is actually grabbed
        if (!target.isGrabbed || !target.grabbedBy) {
            console.log('[Arena] Player not grabbed');
            return { success: false, error: 'Not grabbed' };
        }

        // Escaping a carry takes several taps (counted here, not on the phone)
        target.escapeTaps = (target.escapeTaps || 0) + 1;
        if (target.escapeTaps < ARENA_CONFIG.CARRY_ESCAPE_TAPS) {
            return { success: true, escaped: false, mode: 'carry', taps: target.escapeTaps, needed: ARENA_CONFIG.CARRY_ESCAPE_TAPS };
        }
        target.escapeTaps = 0;
                
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
            escaped: true,
            mode: 'carry',
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

        // Free whoever was locked with this player
        this.clearGrapples(arenaState, playerState);
                
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
            playerState.escapeTaps = 0;
            playerState.spirit = 0;
            playerState.specialUntil = 0;
            playerState.pendingDown = 0;
            playerState.isTaunting = false;
            playerState.tieUp = null;
            playerState.move = null;
            playerState.isDown = false;
            playerState.downUntil = 0;
            playerState.isGettingUp = false;
            playerState.getUpUntil = 0;
            playerState.pin = null;
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
            isEliminated: playerState.isEliminated,

            // Spirit & finisher
            spirit: Math.round(playerState.spirit || 0),
            isSpecial: (playerState.specialUntil || 0) > Date.now(),
            specialMsLeft: Math.max(0, (playerState.specialUntil || 0) - Date.now()),
            finisher: playerState.finisher,
            isTaunting: !!playerState.isTaunting,

            // Grappling
            isDown: !!playerState.isDown,
            isGettingUp: !!playerState.isGettingUp,
            tieUp: playerState.tieUp ? {
                partnerId: playerState.tieUp.partnerId,
                role: playerState.tieUp.role,
                msLeft: Math.max(0, playerState.tieUp.until - Date.now()),
                escapeTaps: playerState.tieUp.escapeTaps,
                escapeNeeded: ARENA_CONFIG.TIEUP_ESCAPE_TAPS
            } : null,
            move: playerState.move ? {
                type: playerState.move.type,
                role: playerState.move.role,
                partnerId: playerState.move.partnerId
            } : null,
            pin: playerState.pin ? {
                partnerId: playerState.pin.partnerId,
                role: playerState.pin.role,
                count: playerState.pin.count,
                taps: playerState.pin.taps,
                tapsNeeded: playerState.pin.tapsNeeded
            } : null,
            carryEscape: playerState.isGrabbed ? {
                taps: playerState.escapeTaps || 0,
                needed: ARENA_CONFIG.CARRY_ESCAPE_TAPS
            } : null
        };
    }

    // =====================================================================
    // Grappling (tie-ups, grapple moves, downs, pins)
    // =====================================================================

    // =====================================================================
    // Spirit meter & finishers
    // =====================================================================

    isSpecial(p) {
        return (p.specialUntil || 0) > Date.now();
    }

    addSpirit(arenaState, p, amount) {
        if (!p || p.isEliminated || !amount || this.isSpecial(p)) return;
        p.spirit = Math.min(SPIRIT_CONFIG.MAX, (p.spirit || 0) + amount);
        if (p.spirit >= SPIRIT_CONFIG.MAX) {
            p.specialUntil = Date.now() + SPIRIT_CONFIG.SPECIAL_DURATION;
            this.pushEvent(arenaState, 'arena-special', {
                playerId: p.id,
                finisher: p.finisher,
                duration: SPIRIT_CONFIG.SPECIAL_DURATION
            });
        }
    }

    loseSpirit(p) {
        if (!p || this.isSpecial(p)) return;
        p.spirit = Math.max(0, (p.spirit || 0) - SPIRIT_CONFIG.DAMAGE_TAKEN_LOSS);
    }

    /**
     * Use the signature finisher (only while SPECIAL).
     * @returns {object} { success, error?, finisher? }
     */
    processFinisher(socketId, roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState) return { success: false, error: 'No arena state' };
        const attacker = arenaState.players.get(socketId);
        if (!attacker || attacker.isEliminated) return { success: false, error: 'Not playing' };
        if (!this.isSpecial(attacker)) return { success: false, error: 'not-special' };

        const fin = attacker.finisher || DEFAULT_FINISHER;
        const cfg = FINISHERS[fin.type];
        let defender = null;

        if (cfg.from === 'tieup') {
            if (!attacker.tieUp || attacker.tieUp.role !== 'attacker') return { success: false, error: 'need-tieup' };
            defender = arenaState.players.get(attacker.tieUp.partnerId);
        } else if (cfg.from === 'standing') {
            if (attacker.tieUp && attacker.tieUp.role === 'attacker') {
                defender = arenaState.players.get(attacker.tieUp.partnerId);
            } else if (this.isLocked(attacker) || attacker.isGrabbed || attacker.isGrabbing || attacker.isStunned) {
                return { success: false, error: 'busy' };
            } else {
                defender = this.findFinisherTarget(arenaState, attacker, cfg, false);
            }
        } else {
            if (this.isLocked(attacker) || attacker.isGrabbed || attacker.isGrabbing || attacker.isStunned) {
                return { success: false, error: 'busy' };
            }
            defender = this.findFinisherTarget(arenaState, attacker, cfg, true);
        }
        if (!defender || defender.isEliminated) return { success: false, error: 'no-target' };

        // Spend the meter
        attacker.specialUntil = 0;
        attacker.spirit = 0;
        attacker.isTaunting = false;
        attacker.isBlocking = false;

        const now = Date.now();
        const angle = this.angleTo(attacker, defender);
        attacker.facingAngle = angle;
        if (cfg.from !== 'downed') defender.facingAngle = angle + Math.PI;
        attacker.velocity = { x: 0, y: 0, z: 0 };
        defender.velocity = { x: 0, y: 0, z: 0 };

        let landing = null;
        if (cfg.from === 'tieup') {
            landing = this.clampInsideRopes({
                x: attacker.position.x + Math.sin(angle) * cfg.landingDist,
                y: ARENA_CONFIG.RING_HEIGHT,
                z: attacker.position.z + Math.cos(angle) * cfg.landingDist
            });
        } else if (cfg.from === 'downed') {
            // The attacker lands right next to the victim
            landing = this.clampInsideRopes({
                x: defender.position.x - Math.sin(angle) * 0.6,
                y: ARENA_CONFIG.RING_HEIGHT,
                z: defender.position.z - Math.cos(angle) * 0.6
            });
        }

        // Both players are part of the move (a downed victim stays down)
        attacker.tieUp = null;
        defender.tieUp = null;
        if (defender.pin) this.endPin(arenaState, defender, 'interrupted');
        const base = { type: 'finisher', finisher: fin.type, startedAt: now, impactAt: now + cfg.impact, endAt: now + cfg.duration, impactDone: false, landing };
        attacker.move = { ...base, role: 'attacker', partnerId: defender.id };
        defender.move = { ...base, role: 'defender', partnerId: attacker.id };
        if (defender.isDown) defender.downUntil = Math.max(defender.downUntil, now + cfg.duration);

        const info = {
            attackerId: attacker.id,
            defenderId: defender.id,
            finisher: fin.type,
            name: fin.name,
            variant: fin.variant || null,
            duration: cfg.duration,
            impactDelay: cfg.impact,
            attackerPos: { ...attacker.position },
            defenderPos: { ...defender.position },
            facingAngle: angle,
            landing
        };
        this.pushEvent(arenaState, 'arena-finisher', info);
        return { success: true, finisher: info };
    }

    findFinisherTarget(arenaState, attacker, cfg, downed) {
        let best = null;
        let bestDist = cfg.range;
        arenaState.players.forEach((other, otherId) => {
            if (otherId === attacker.id || other.isEliminated || other.move || other.isGrabbed || other.isGrabbing) return;
            if (downed ? !other.isDown : (other.isDown || other.isGettingUp || other.pin)) return;
            const dx = other.position.x - attacker.position.x;
            const dz = other.position.z - attacker.position.z;
            const d = Math.hypot(dx, dz);
            if (d > bestDist) return;
            if (!downed) {
                // Must be roughly in front for the superkick
                let diff = Math.atan2(dx, dz) - attacker.facingAngle;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                if (Math.abs(diff) > Math.PI / 2.5) return;
            }
            bestDist = d;
            best = other;
        });
        return best;
    }

    applyFinisherImpact(arenaState, attacker, defender) {
        const fin = attacker.finisher || DEFAULT_FINISHER;
        const cfg = FINISHERS[attacker.move.finisher] || FINISHERS[fin.type];
        attacker.move.impactDone = true;
        if (defender.move) defender.move.impactDone = true;
        const now = Date.now();

        defender.health = Math.max(0, defender.health - cfg.damage);
        this.loseSpirit(defender);

        let landing = null;
        if (cfg.from === 'tieup') {
            landing = attacker.move.landing;
            defender.position.x = landing.x;
            defender.position.z = landing.z;
            defender.position.y = ARENA_CONFIG.RING_HEIGHT;
            defender.velocity = { x: 0, y: 0, z: 0 };
            defender.isDown = true;
            defender.downUntil = now + cfg.down;
            defender.isStunned = false;
        } else if (cfg.from === 'downed') {
            landing = attacker.move.landing;
            attacker.position.x = landing.x;
            attacker.position.z = landing.z;
            defender.isDown = true;
            defender.downUntil = now + cfg.down;
        } else {
            // Superkick: launch the defender; they go down when they land (or fly out of the ring)
            const angle = this.angleTo(attacker, defender);
            defender.move = null;
            defender.velocity = {
                x: Math.sin(angle) * cfg.knockback,
                y: cfg.launchY,
                z: Math.cos(angle) * cfg.knockback
            };
            defender.position.y = Math.max(defender.position.y, ARENA_CONFIG.RING_HEIGHT + 0.05);
            defender.isBeingThrown = true;
            defender.isStunned = true;
            defender.stunEndTime = now + 1500;
            defender.pendingDown = cfg.down;
        }

        let eliminated = false;
        if (defender.health <= 0) {
            const info = this.eliminatePlayer(arenaState, defender.id);
            eliminated = !!info;
            if (info) {
                this.pushEvent(arenaState, 'arena-elimination', {
                    playerId: defender.id,
                    playerName: defender.name,
                    playerNumber: defender.number,
                    reason: 'knockout',
                    eliminatedBy: attacker.id
                });
            }
        }

        this.pushEvent(arenaState, 'arena-grapple-impact', {
            attackerId: attacker.id,
            defenderId: defender.id,
            move: 'finisher',
            finisher: fin.type,
            name: fin.name,
            damage: cfg.damage,
            newHealth: defender.health,
            down: cfg.from !== 'standing',
            landing,
            eliminated
        });
    }

    /** Queue a socket event to be emitted by the server loop */
    pushEvent(arenaState, name, data) {
        arenaState.events.push({ name, data });
    }

    /** Take and clear the queued events for a room */
    drainEvents(roomCode) {
        const arenaState = this.arenaStates.get(roomCode);
        if (!arenaState || arenaState.events.length === 0) return [];
        const events = arenaState.events;
        arenaState.events = [];
        return events;
    }

    /** Player can't move or act on their own */
    isLocked(p) {
        return !!(p.tieUp || p.move || p.isDown || p.isGettingUp || p.pin);
    }

    angleTo(from, to) {
        return Math.atan2(to.position.x - from.position.x, to.position.z - from.position.z);
    }

    clampInsideRopes(pos) {
        const limit = ARENA_CONFIG.RING_SIZE / 2 - 0.8 - 0.4;
        pos.x = Math.max(-limit, Math.min(limit, pos.x));
        pos.z = Math.max(-limit, Math.min(limit, pos.z));
        return pos;
    }

    startTieUp(arenaState, attacker, defender) {
        const until = Date.now() + ARENA_CONFIG.TIEUP_DURATION;

        // Face each other at a fixed distance
        const angle = this.angleTo(attacker, defender);
        const midX = (attacker.position.x + defender.position.x) / 2;
        const midZ = (attacker.position.z + defender.position.z) / 2;
        const half = ARENA_CONFIG.TIEUP_DISTANCE / 2;
        attacker.position.x = midX - Math.sin(angle) * half;
        attacker.position.z = midZ - Math.cos(angle) * half;
        defender.position.x = midX + Math.sin(angle) * half;
        defender.position.z = midZ + Math.cos(angle) * half;
        attacker.facingAngle = angle;
        defender.facingAngle = angle + Math.PI;
        attacker.velocity = { x: 0, y: 0, z: 0 };
        defender.velocity = { x: 0, y: 0, z: 0 };

        // A grab beats a block
        defender.isBlocking = false;
        attacker.isTaunting = false;
        defender.isTaunting = false;

        attacker.tieUp = { partnerId: defender.id, role: 'attacker', until, escapeTaps: 0 };
        defender.tieUp = { partnerId: attacker.id, role: 'defender', until, escapeTaps: 0 };

        const info = {
            mode: 'tieup',
            attackerId: attacker.id,
            defenderId: defender.id,
            duration: ARENA_CONFIG.TIEUP_DURATION
        };
        this.pushEvent(arenaState, 'arena-tieup', info);
        return info;
    }

    /** End a tie-up for both players. reason: 'timeout' | 'escape' | 'interrupted' */
    breakTieUp(arenaState, player, reason) {
        if (!player.tieUp) return;
        const partner = arenaState.players.get(player.tieUp.partnerId);
        const attacker = player.tieUp.role === 'attacker' ? player : partner;
        const defender = player.tieUp.role === 'attacker' ? partner : player;

        player.tieUp = null;
        if (partner) partner.tieUp = null;

        // Push both apart; an escape shoves the attacker harder and dazes them
        if (attacker && defender) {
            const angle = this.angleTo(attacker, defender);
            const push = reason === 'escape' ? 7 : 4;
            attacker.velocity.x -= Math.sin(angle) * push;
            attacker.velocity.z -= Math.cos(angle) * push;
            defender.velocity.x += Math.sin(angle) * 3;
            defender.velocity.z += Math.cos(angle) * 3;
            if (reason === 'escape') {
                attacker.isStunned = true;
                attacker.stunEndTime = Date.now() + 500;
            }
        }

        this.pushEvent(arenaState, 'arena-tieup-end', {
            attackerId: attacker?.id,
            defenderId: defender?.id,
            reason
        });
    }

    /** GRAB during a tie-up: lift the defender into the existing carry */
    liftFromTieUp(arenaState, attacker) {
        const defender = arenaState.players.get(attacker.tieUp.partnerId);
        if (!defender || attacker.stamina < ARENA_CONFIG.LIFT_STAMINA) return null;

        attacker.stamina -= ARENA_CONFIG.LIFT_STAMINA;
        attacker.tieUp = null;
        defender.tieUp = null;

        attacker.isGrabbing = true;
        attacker.grabbing = defender.id;
        attacker.grabEndTime = Date.now() + ARENA_CONFIG.GRAB_DURATION;
        defender.isGrabbed = true;
        defender.grabbedBy = attacker.id;
        defender.escapeTaps = 0;

        const info = { mode: 'carry', grabberId: attacker.id, targetId: defender.id };
        // Same event the host already uses to start the carry
        this.pushEvent(arenaState, 'arena-grab', info);
        return info;
    }

    /** PUNCH/KICK in a tie-up: pick and start a grapple move */
    startGrappleMove(arenaState, attacker, attackType) {
        const defender = arenaState.players.get(attacker.tieUp.partnerId);
        if (!defender) return null;

        const input = attacker.input || {};
        const withStick = !!(input.left || input.right || input.up || input.down);
        const type = attackType === 'kick'
            ? (withStick ? 'suplex' : 'knee')
            : (withStick ? 'slam' : 'headbutt');
        const cfg = ARENA_CONFIG.MOVES[type];

        if (attacker.stamina < cfg.stamina) return null; // Not enough stamina: keep the tie-up
        attacker.stamina -= cfg.stamina;

        const now = Date.now();
        const angle = this.angleTo(attacker, defender);
        attacker.facingAngle = angle;
        defender.facingAngle = angle + Math.PI;

        let landing = null;
        if (cfg.down) {
            const dist = ARENA_CONFIG.LANDING_DISTANCE * (cfg.landing === 'back' ? -1 : 1);
            landing = this.clampInsideRopes({
                x: attacker.position.x + Math.sin(angle) * dist,
                y: ARENA_CONFIG.RING_HEIGHT,
                z: attacker.position.z + Math.cos(angle) * dist
            });
        }

        const base = { type, startedAt: now, impactAt: now + cfg.impact, endAt: now + cfg.duration, impactDone: false, landing };
        attacker.tieUp = null;
        defender.tieUp = null;
        attacker.move = { ...base, role: 'attacker', partnerId: defender.id };
        defender.move = { ...base, role: 'defender', partnerId: attacker.id };
        attacker.lastAttackTime = now;

        this.pushEvent(arenaState, 'arena-grapple-move', {
            attackerId: attacker.id,
            defenderId: defender.id,
            move: type,
            duration: cfg.duration,
            impactDelay: cfg.impact,
            attackerPos: { ...attacker.position },
            defenderPos: { ...defender.position },
            facingAngle: angle,
            landing
        });

        return { grapple: true, attackerId: attacker.id, attackType: type };
    }

    /** Apply a grapple move's impact (damage, knockdown or stun) */
    applyGrappleImpact(arenaState, attacker, defender) {
        if (attacker.move.type === 'finisher') {
            this.applyFinisherImpact(arenaState, attacker, defender);
            return;
        }
        const type = attacker.move.type;
        const cfg = ARENA_CONFIG.MOVES[type];
        attacker.move.impactDone = true;
        if (defender.move) defender.move.impactDone = true;

        defender.health = Math.max(0, defender.health - cfg.damage);
        this.addSpirit(arenaState, attacker, SPIRIT_CONFIG.GAIN[type] || 0);
        this.loseSpirit(defender);
        
        if (cfg.down) {
            const landing = attacker.move.landing;
            defender.position.x = landing.x;
            defender.position.z = landing.z;
            defender.position.y = ARENA_CONFIG.RING_HEIGHT;
            defender.velocity = { x: 0, y: 0, z: 0 };
            defender.isDown = true;
            defender.downUntil = Date.now() + ARENA_CONFIG.DOWN_DURATION;
            defender.isStunned = false;
        } else {
            const angle = this.angleTo(attacker, defender);
            defender.velocity.x += Math.sin(angle) * cfg.knockback;
            defender.velocity.z += Math.cos(angle) * cfg.knockback;
            defender.isStunned = true;
            defender.stunEndTime = Date.now() + cfg.stun;
        }

        let eliminated = false;
        if (defender.health <= 0) {
            const info = this.eliminatePlayer(arenaState, defender.id);
            eliminated = !!info;
            if (info) {
                this.pushEvent(arenaState, 'arena-elimination', {
                    playerId: defender.id,
                    playerName: defender.name,
                    playerNumber: defender.number,
                    reason: 'knockout',
                    eliminatedBy: attacker.id
                });
            }
        }

        this.pushEvent(arenaState, 'arena-grapple-impact', {
            attackerId: attacker.id,
            defenderId: defender.id,
            move: type,
            damage: cfg.damage,
            newHealth: defender.health,
            down: !!cfg.down,
            landing: cfg.down ? { ...defender.position } : null,
            eliminated
        });
    }

    findPinTarget(arenaState, attacker) {
        let best = null;
        let bestDist = ARENA_CONFIG.PIN_RANGE;
        arenaState.players.forEach((other, otherId) => {
            if (otherId === attacker.id || other.isEliminated || !other.isDown || other.pin || other.move) return;
            const d = Math.hypot(other.position.x - attacker.position.x, other.position.z - attacker.position.z);
            if (d <= bestDist) {
                bestDist = d;
                best = other;
            }
        });
        return best;
    }

    startPin(arenaState, pinner, victim) {
        const now = Date.now();
        const tapsNeeded = kickoutTapsNeeded(victim.health);

        // Kneel next to the victim, facing them
        const angle = this.angleTo(pinner, victim);
        pinner.facingAngle = angle;
        pinner.velocity = { x: 0, y: 0, z: 0 };
        pinner.isTaunting = false;
        pinner.isBlocking = false;

        pinner.pin = { partnerId: victim.id, role: 'pinner', count: 0, nextCountAt: now + ARENA_CONFIG.PIN_COUNT_INTERVAL, taps: 0, tapsNeeded };
        victim.pin = { partnerId: pinner.id, role: 'pinned', count: 0, nextCountAt: 0, taps: 0, tapsNeeded };
        victim.downUntil = Infinity; // Stays down while pinned

        const info = { mode: 'pin', pinnerId: pinner.id, victimId: victim.id, tapsNeeded };
        this.pushEvent(arenaState, 'arena-pin-start', info);
        return info;
    }

    /** End a pin. result: 'kickout' | 'pinfall' | 'interrupted' */
    endPin(arenaState, player, result) {
        if (!player.pin) return;
        const partner = arenaState.players.get(player.pin.partnerId);
        const pinner = player.pin.role === 'pinner' ? player : partner;
        const victim = player.pin.role === 'pinned' ? player : partner;
        const count = (pinner?.pin || player.pin).count;

        player.pin = null;
        if (partner) partner.pin = null;

        if (victim && !victim.isEliminated) {
            if (result === 'kickout') {
                // Kick out: get up right away and shove the pinner off
                victim.isDown = false;
                victim.downUntil = 0;
                victim.isGettingUp = true;
                victim.getUpUntil = Date.now() + ARENA_CONFIG.GETUP_DURATION;
                this.pushEvent(arenaState, 'arena-getup', { playerId: victim.id });
                if (pinner) {
                    pinner.isStunned = true;
                    pinner.stunEndTime = Date.now() + 400;
                    const angle = this.angleTo(victim, pinner);
                    pinner.velocity.x += Math.sin(angle) * 4;
                    pinner.velocity.z += Math.cos(angle) * 4;
                }
            } else {
                // Interrupted: the victim stays down a little longer
                victim.downUntil = Date.now() + 800;
            }
        }

        this.pushEvent(arenaState, 'arena-pin-end', {
            pinnerId: pinner?.id,
            victimId: victim?.id,
            result,
            count
        });
    }

    /** Per-tick grappling timers for one player */
    updateGrappleTimers(arenaState, p, now) {
        // Tie-up timeout (handled once, from the attacker's side)
        if (p.tieUp && p.tieUp.role === 'attacker' && now >= p.tieUp.until) {
            this.breakTieUp(arenaState, p, 'timeout');
        }

        // Grapple move impact and end (handled from the attacker's side)
        if (p.move && p.move.role === 'attacker') {
            const defender = arenaState.players.get(p.move.partnerId);
            if (!defender || defender.isEliminated) {
                p.move = null;
            } else {
                if (!p.move.impactDone && now >= p.move.impactAt) {
                    this.applyGrappleImpact(arenaState, p, defender);
                }
                if (p.move && now >= p.move.endAt) {
                    p.move = null;
                    defender.move = null;
                }
            }
        }

        // On the mat -> getting up
        if (p.isDown && !p.pin && now >= p.downUntil) {
            p.isDown = false;
            p.isGettingUp = true;
            p.getUpUntil = now + ARENA_CONFIG.GETUP_DURATION;
            this.pushEvent(arenaState, 'arena-getup', { playerId: p.id });
        }
        if (p.isGettingUp && now >= p.getUpUntil) {
            p.isGettingUp = false;
        }

        // Referee count (handled from the pinner's side)
        if (p.pin && p.pin.role === 'pinner' && now >= p.pin.nextCountAt) {
            const victim = arenaState.players.get(p.pin.partnerId);
            if (!victim || victim.isEliminated) {
                p.pin = null;
                return;
            }
            p.pin.count++;
            if (victim.pin) victim.pin.count = p.pin.count;
            this.addSpirit(arenaState, p, SPIRIT_CONFIG.GAIN.pinCount);
            this.pushEvent(arenaState, 'arena-pin-count', { pinnerId: p.id, victimId: victim.id, count: p.pin.count });

            if (p.pin.count >= 3) {
                // Pinfall: the victim is eliminated
                this.endPin(arenaState, p, 'pinfall');
                const info = this.eliminatePlayer(arenaState, victim.id);
                if (info) {
                    this.pushEvent(arenaState, 'arena-elimination', {
                        playerId: victim.id,
                        playerName: victim.name,
                        playerNumber: victim.number,
                        reason: 'pinfall',
                        eliminatedBy: p.id
                    });
                }
            } else {
                p.pin.nextCountAt += ARENA_CONFIG.PIN_COUNT_INTERVAL;
            }
        }
    }

    /** Release every grapple that involves this player (used on elimination/leave) */
    clearGrapples(arenaState, p) {
        if (p.tieUp) {
            const partner = arenaState.players.get(p.tieUp.partnerId);
            if (partner) partner.tieUp = null;
            p.tieUp = null;
        }
        if (p.move) {
            const partner = arenaState.players.get(p.move.partnerId);
            if (partner) partner.move = null;
            p.move = null;
        }
        if (p.pin) {
            const partner = arenaState.players.get(p.pin.partnerId);
            if (partner) {
                partner.pin = null;
                if (partner.isDown) partner.downUntil = Date.now() + 800;
            }
            p.pin = null;
        }
        p.isDown = false;
        p.isGettingUp = false;
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

