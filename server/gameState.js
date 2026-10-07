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

        // Double jump: one extra jump in the air, refilled on landing
        this.AIR_JUMPS = 1;
        this.AIR_JUMP_FORCE = 13;

        // Shield (block): drains while held and with every blocked hit; breaks at 0
        this.SHIELD_MAX = 100;
        this.SHIELD_DRAIN_PER_SEC = 10;      // While holding block
        this.SHIELD_REGEN_PER_SEC = 14;      // While not blocking (not during a break stun)
        this.SHIELD_HIT_COST = 3.5;          // Shield lost per point of blocked damage
        this.SHIELD_MIN_TO_RAISE = 10;       // Can't raise a nearly empty shield
        this.SHIELD_BREAK_STUN_MS = 2000;    // Dizzy time after a break
        this.SHIELD_AFTER_BREAK = 30;        // Shield value once the stun ends

        // Hitstop (hitlag): attacker and victim freeze for a few ms on impact
        this.HITSTOP_BASE_MS = 40;
        this.HITSTOP_PER_DAMAGE_MS = 3;
        this.HITSTOP_BLOCKED_MS = 30;

        // Directional moves. The stick direction when the button is pressed picks the variant
        // (angle/vy = vertical share of the knockback, vx = horizontal share)
        this.MOVES = {
            neutral: { name: null,         damage: 1.0, kb: 1.0, growth: 1.0, range: 1.0, hitstun: 1.0,  vx: 1.5, vy: 0.8,  delay: 1.0,  cooldown: 1.0,  lunge: 0 },
            side:    { name: 'SMASH',      damage: 1.3, kb: 1.4, growth: 1.2, range: 1.1, hitstun: 1.2,  vx: 1.8, vy: 0.45, delay: 1.4,  cooldown: 1.35, lunge: 5 },
            up:      { name: 'UPPERCUT',   damage: 1.1, kb: 1.3, growth: 1.2, range: 1.1, hitstun: 1.2,  vx: 0.5, vy: 1.5,  delay: 1.2,  cooldown: 1.25, lunge: 0 },
            sweep:   { name: 'BARRIDA',    damage: 0.9, kb: 1.0, growth: 1.0, range: 1.3, hitstun: 1.8,  vx: 1.1, vy: 0.3,  delay: 1.3,  cooldown: 1.3,  lunge: 0 },
            meteor:  { name: 'METEORO',    damage: 1.2, kb: 1.3, growth: 1.3, range: 1.2, hitstun: 1.4,  vx: 0.4, vy: -1.3, delay: 1.2,  cooldown: 1.4,  lunge: 0 }
        };

        // One-off events for the room loop to broadcast (shield breaks, double jumps...)
        this.pendingEvents = new Map(); // roomCode -> [{ type, ... }]

        // Stages (synced with client - js/main.js STAGES). Platform y = top surface
        // (the client draws floating platforms 0.1 lower). The host picks one in the lobby.
        this.STAGES = {
            clasico: [
                { x: 0, y: 0, width: 20, isMainGround: true },      // Main ground (20 units for 8 players)
                { x: -6, y: 2.6, width: 4, isMainGround: false },   // Left high (y: 2.5 + 0.1)
                { x: 6, y: 2.6, width: 4, isMainGround: false },    // Right high
                { x: 0, y: 4.6, width: 3.5, isMainGround: false },  // Center top
                { x: -3, y: 5.6, width: 2.5, isMainGround: false }, // Upper left
                { x: 3, y: 5.6, width: 2.5, isMainGround: false }   // Upper right
            ],
            torres: [
                { x: 0, y: 0, width: 14, isMainGround: true },      // Narrow ground: more ring-outs
                { x: -7, y: 3.3, width: 3, isMainGround: false },   // Left tower (over the edge!)
                { x: 7, y: 3.3, width: 3, isMainGround: false },    // Right tower
                { x: 0, y: 2.4, width: 4, isMainGround: false },    // Center low
                { x: 0, y: 6.1, width: 3, isMainGround: false }     // Center top
            ]
        };
        this.DEFAULT_STAGE = 'clasico';
        this.platforms = this.STAGES[this.DEFAULT_STAGE]; // Set per room at the start of each tick

        // Items that fall onto the stage
        this.ITEM_SPAWN_FIRST_MS = [8000, 12000];   // First item after the match starts
        this.ITEM_SPAWN_NEXT_MS = [12000, 18000];   // After an item leaves the stage
        this.ITEM_LIFETIME_MS = 10000;              // On the floor before vanishing
        this.ITEM_PICKUP_RANGE = 0.9;
        this.ITEM_WEIGHTS = { bate: 4, bomba: 3, pollo: 3 };
        this.BAT_DURATION_MS = 10000;
        this.BAT_HITS = 3;
        this.BAT_DAMAGE_MULT = 1.6;
        this.BAT_KB_MULT = 1.5;
        this.BAT_RANGE_BONUS = 0.4;
        this.BOMB_FUSE_MS = 2500;
        this.BOMB_RADIUS = 2.5;
        this.BOMB_DAMAGE = 20;
        this.BOMB_SELF_DAMAGE = 10;
        this.BOMB_KNOCKBACK = 9;
        this.FOOD_HEAL = 30;

        // KO slow motion: the whole room runs at this speed for a moment
        this.SLOWMO_SCALE = 0.3;
        this.SLOWMO_MS = 800;
        this.SLOWMO_ELIMINATION_MS = 1300;
        
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

        // Cap delta to prevent physics explosions; slow motion after a KO
        const slowMo = (room.slowMoUntil || 0) > now;
        const cappedDelta = Math.min(delta, 0.1) * (slowMo ? this.SLOWMO_SCALE : 1);

        // This room's stage
        this.platforms = this.STAGES[room.stage] || this.STAGES[this.DEFAULT_STAGE];

        // Update each player's physics (eliminated players are out of the match)
        for (const player of room.players.values()) {
            if (player.stocks <= 0) continue;
            this.updatePlayer(player, cappedDelta, roomCode);
        }

        // Push overlapping players apart (server-authoritative, so the host doesn't fight it)
        this.resolvePlayerCollisions(room);

        // Items: fall, land, get picked up, explode, expire
        this.updateItems(room, roomCode, cappedDelta, now);

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
            stage: room.stage || this.DEFAULT_STAGE,
            slowMo,
            items: (room.items || []).map(item => ({ id: item.id, kind: item.kind, x: item.x, y: item.y, landed: item.landed })),
            players: playerUpdates
        };
    }

    /**
     * Pick the stage of a room (host only; before/between matches)
     * @returns {string|null} The stage applied, or null if unknown
     */
    setStage(roomCode, stageId) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room || !this.STAGES[stageId]) return null;
        room.stage = stageId;
        return stageId;
    }

    getStage(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        return (room && room.stage) || this.DEFAULT_STAGE;
    }

    // =================================
    // Items
    // =================================

    randomBetween([min, max]) {
        return min + Math.random() * (max - min);
    }

    pickItemKind() {
        const total = Object.values(this.ITEM_WEIGHTS).reduce((s, w) => s + w, 0);
        let roll = Math.random() * total;
        for (const [kind, weight] of Object.entries(this.ITEM_WEIGHTS)) {
            roll -= weight;
            if (roll < 0) return kind;
        }
        return 'pollo';
    }

    /**
     * Spawn, drop, pick up, explode and expire items. One item on the stage at a time;
     * the next one is scheduled when it leaves (picked up, expired or fell off).
     */
    updateItems(room, roomCode, delta, now) {
        if (!room.items) room.items = [];
        if (!room.nextItemAt) room.nextItemAt = now + this.randomBetween(this.ITEM_SPAWN_FIRST_MS);
        if (!room.itemSeq) room.itemSeq = 0;

        const ground = this.platforms.find(p => p.isMainGround) || this.platforms[0];

        // Spawn
        if (room.items.length === 0 && now >= room.nextItemAt) {
            const item = {
                id: `item-${++room.itemSeq}`,
                kind: this.pickItemKind(),
                x: Math.round((Math.random() * 2 - 1) * (ground.width / 2 - 1.5) * 10) / 10,
                y: 9,
                vy: 0,
                landed: false,
                landedAt: 0
            };
            room.items.push(item);
            this.pushEvent(roomCode, { type: 'item-spawn', id: item.id, kind: item.kind, x: item.x });
            room.nextItemAt = Infinity; // re-armed when the item leaves
        }

        const leave = (item, type) => {
            room.items = room.items.filter(i => i !== item);
            if (type) this.pushEvent(roomCode, { type, id: item.id, kind: item.kind });
            room.nextItemAt = now + this.randomBetween(this.ITEM_SPAWN_NEXT_MS);
        };

        for (const item of [...room.items]) {
            if (!item.landed) {
                // Falls a bit slower than players
                const prevY = item.y;
                item.vy += this.GRAVITY * 0.6 * delta;
                item.y += item.vy * delta;
                for (const platform of this.platforms) {
                    const half = platform.width / 2;
                    if (item.x < platform.x - half || item.x > platform.x + half) continue;
                    if (prevY >= platform.y && item.y <= platform.y) {
                        item.y = platform.y;
                        item.vy = 0;
                        item.landed = true;
                        item.landedAt = now;
                        break;
                    }
                }
                if (!item.landed && item.y < -10) { leave(item, 'item-lost'); continue; }
            } else if (now - item.landedAt >= this.ITEM_LIFETIME_MS) {
                leave(item, 'item-expire');
                continue;
            }

            if (!item.landed) continue;

            // Pickup: the first player standing on it (not launched, not frozen)
            for (const player of room.players.values()) {
                if (player.stocks <= 0 || player.heldItem) continue;
                if ((player.hitstunUntil || 0) > now || (player.freezeUntil || 0) > now) continue;
                if (Math.abs(player.position.x - item.x) > this.ITEM_PICKUP_RANGE) continue;
                if (Math.abs(player.position.y - item.y) > 1.2) continue;

                if (item.kind === 'pollo') {
                    const before = player.health;
                    player.health = Math.max(0, player.health - this.FOOD_HEAL);
                    this.pushEvent(roomCode, { type: 'item-heal', id: item.id, kind: item.kind, playerId: player.id, healed: before - player.health, newHealth: player.health });
                } else {
                    player.heldItem = {
                        kind: item.kind,
                        until: now + (item.kind === 'bate' ? this.BAT_DURATION_MS : this.BOMB_FUSE_MS),
                        hitsLeft: item.kind === 'bate' ? this.BAT_HITS : 0
                    };
                    this.pushEvent(roomCode, { type: 'item-pickup', id: item.id, kind: item.kind, playerId: player.id });
                }
                leave(item, null);
                break;
            }
        }

        // Held items: bat wears off, bomb explodes
        for (const player of room.players.values()) {
            const held = player.heldItem;
            if (!held || player.stocks <= 0) continue;
            if (now < held.until) continue;
            if (held.kind === 'bate') {
                player.heldItem = null;
                this.pushEvent(roomCode, { type: 'item-break', kind: 'bate', playerId: player.id });
            } else if (held.kind === 'bomba') {
                this.explodeBomb(room, roomCode, player, now);
            }
        }
    }

    /**
     * The bomb a player is holding goes off: everyone nearby is launched (the holder too)
     */
    explodeBomb(room, roomCode, holder, now) {
        holder.heldItem = null;
        const x = holder.position.x;
        const y = holder.position.y;
        const hits = [];
        for (const target of room.players.values()) {
            if (target.stocks <= 0) continue;
            const dx = target.position.x - x;
            const dy = target.position.y - y;
            if (Math.sqrt(dx * dx + dy * dy) > this.BOMB_RADIUS) continue;

            const self = target === holder;
            const damage = self ? this.BOMB_SELF_DAMAGE : this.BOMB_DAMAGE;
            target.health += damage;
            target.isBlocking = false;
            const dirX = dx === 0 ? (holder.facingRight ? -1 : 1) : Math.sign(dx);
            const power = this.BOMB_KNOCKBACK * (1 + target.health / 100);
            target.velocity.x = dirX * power * 0.9;
            target.velocity.y = power * 0.9;
            target.hitstunUntil = Math.max(target.hitstunUntil || 0, now + 500 + power * this.HITSTUN_PER_KNOCKBACK * 1000);
            target.freezeUntil = now + 80;
            hits.push({ targetId: target.id, damage, newHealth: target.health, self });
        }
        this.pushEvent(roomCode, { type: 'item-explode', kind: 'bomba', playerId: holder.id, x, y, hits });
    }
    
    /**
     * Update a single player's physics
     * @param {object} player - Player object
     * @param {number} delta - Time delta
     * @param {string} [roomCode] - Room code (for events)
     * @returns {object} Updated state
     */
    updatePlayer(player, delta, roomCode) {
        const input = player.input;
        
        // Initialize facingRight if not set
        if (player.facingRight === undefined) {
            player.facingRight = true;
        }
        
        // Initialize previousY for platform detection
        if (player.previousY === undefined) {
            player.previousY = player.position.y;
        }
        
        const now = Date.now();

        // Hitstop: frozen on impact, momentum is kept and released when the freeze ends
        if ((player.freezeUntil || 0) > now) {
            player.jumpHeld = !!input.jump;
            return;
        }

        // Hitstun: after being hit the player can't act and keeps the knockback momentum
        const inHitstun = (player.hitstunUntil || 0) > now;

        // Shield: drains while held, breaks at 0 (dizzy), refills while down
        if (player.shield === undefined) player.shield = this.SHIELD_MAX;
        if (player.isBlocking === true) {
            player.shield -= this.SHIELD_DRAIN_PER_SEC * delta;
            if (player.shield <= 0) {
                this.breakShield(player, now, roomCode);
            }
        } else if (!((player.shieldStunUntil || 0) > now)) {
            if (player.shieldRefillPending) {
                // The break stun just ended: start again from a small shield
                player.shield = this.SHIELD_AFTER_BREAK;
                player.shieldRefillPending = false;
            }
            player.shield = Math.min(this.SHIELD_MAX, player.shield + this.SHIELD_REGEN_PER_SEC * delta);
        }

        // Check if player is locked in an action (blocking or taunting)
        const isLockedInAction = player.isBlocking === true || player.isTaunting === true;

        // Per-frame factors were tuned at 60 FPS; normalize them to the real delta
        const frames = delta * 60;

        // Check if grounded on ANY platform before movement/jump
        let isGrounded = this.checkIfGrounded(player);
        if (isGrounded) player.airJumps = this.AIR_JUMPS;

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

        // Jumping - edge triggered (holding the stick up doesn't bounce), blocked during
        // blocking/taunting and hitstun. In the air one extra jump is available.
        const jumpPressed = !!input.jump && !player.jumpHeld;
        player.jumpHeld = !!input.jump;
        if (jumpPressed && !isLockedInAction && !inHitstun) {
            if (isGrounded) {
                player.velocity.y = this.JUMP_FORCE;
                isGrounded = false;
            } else if ((player.airJumps || 0) > 0) {
                player.airJumps--;
                player.velocity.y = this.AIR_JUMP_FORCE;
                player.doubleJumpSeq = (player.doubleJumpSeq || 0) + 1;
            }
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
        const now = Date.now();
        return {
            position: { ...player.position },
            velocity: { ...player.velocity },
            health: player.health,
            stocks: player.stocks,
            isGrounded: player.isGrounded === true,
            facingRight: player.facingRight,
            inHitstun: (player.hitstunUntil || 0) > now,
            isBlocking: player.isBlocking === true,
            shield: Math.round(player.shield === undefined ? this.SHIELD_MAX : player.shield),
            shieldStunned: (player.shieldStunUntil || 0) > now,
            airJumps: player.airJumps === undefined ? this.AIR_JUMPS : player.airJumps,
            doubleJumpSeq: player.doubleJumpSeq || 0,
            heldItem: player.heldItem
                ? { kind: player.heldItem.kind, msLeft: Math.max(0, player.heldItem.until - now), hitsLeft: player.heldItem.hitsLeft }
                : null,
            input: { ...player.input }
        };
    }

    /**
     * Queue a one-off event for the room loop to broadcast
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
     * Shield break: guard drops, the player is dizzy for a while and the shield refills a bit after
     */
    breakShield(player, now, roomCode) {
        player.shield = 0;
        player.isBlocking = false;
        player.shieldStunUntil = now + this.SHIELD_BREAK_STUN_MS;
        player.hitstunUntil = Math.max(player.hitstunUntil || 0, player.shieldStunUntil);
        player.shieldRefillPending = true;
        if (roomCode) this.pushEvent(roomCode, { type: 'shield-break', playerId: player.id });
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

        // Rising through a platform's height is not standing on it
        if (player.velocity.y > 0.01) return false;

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

        // Don't allow attacks while blocking, taunting, in hitstun or frozen by hitstop
        const now = Date.now();
        if (attacker.isBlocking || attacker.isTaunting || (attacker.hitstunUntil || 0) > now || (attacker.freezeUntil || 0) > now) {
            return null;
        }

        // Attack cooldown (matches the host's animation cooldown, so every hit has an animation)
        if (now < (attacker.attackReadyAt || 0)) {
            return null;
        }

        // Stick direction at the press picks the variant (side smash, uppercut, sweep, meteor)
        const variant = this.pickVariant(attacker);
        const move = this.MOVES[variant];

        const ATTACK_COOLDOWN_MS = { punch: 400, kick: 500 };
        attacker.attackReadyAt = now + Math.round((ATTACK_COOLDOWN_MS[attackType] || ATTACK_COOLDOWN_MS.punch) * move.cooldown);

        // Attack timing properties (reduced for faster animations)
        const attackTiming = {
            punch: { activeFrameDelay: 75 },   // ms until hit check (2x faster anim)
            kick: { activeFrameDelay: 110 }    // ms until hit check (1.8x faster anim)
        };

        const timing = attackTiming[attackType] || attackTiming.punch;

        // Side smashes lunge forward a little
        if (move.lunge && attacker.isGrounded) {
            attacker.velocity.x = (attacker.facingRight ? 1 : -1) * move.lunge;
        }

        // Initialize pending attacks for this room if needed
        if (!this.pendingAttacks.has(roomCode)) {
            this.pendingAttacks.set(roomCode, []);
        }

        // Add attack to queue
        const pendingAttack = {
            attackerId,
            attackType,
            variant,
            timestamp: now,
            activeTime: now + Math.round(timing.activeFrameDelay * move.delay),
            processed: false,
            attackerPosition: { ...attacker.position },
            facingRight: attacker.facingRight
        };

        this.pendingAttacks.get(roomCode).push(pendingAttack);

        // Return info for animation (immediate feedback)
        return {
            attackerId,
            attackType,
            variant,
            moveName: move.name,
            attackerPosition: { ...attacker.position },
            facingRight: attacker.facingRight
        };
    }

    /**
     * Pick the directional variant of an attack from the attacker's current stick
     * @param {object} attacker
     * @returns {'neutral'|'side'|'up'|'sweep'|'meteor'}
     */
    pickVariant(attacker) {
        const input = attacker.input || {};
        if (input.down) return attacker.isGrounded === false ? 'meteor' : 'sweep';
        if (input.jump || input.up) return 'up';
        if (input.left || input.right) return 'side';
        return 'neutral';
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
                const hitResult = this.processAttack(attack.attackerId, attack.attackType, roomCode, attack.variant);
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
     * @param {string} [variant] - Directional variant (see MOVES)
     * @returns {object|null} Attack result
     */
    processAttack(attackerId, attackType, roomCode, variant = 'neutral') {
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

        const base = attackProps[attackType] || attackProps.punch;
        const move = this.MOVES[variant] || this.MOVES.neutral;
        const now = Date.now();

        // Swinging a bat: harder, further, and the bat wears out after a few hits
        const bat = attacker.heldItem && attacker.heldItem.kind === 'bate' && attacker.heldItem.until > now ? attacker.heldItem : null;
        const props = {
            damage: Math.round(base.damage * move.damage * (bat ? this.BAT_DAMAGE_MULT : 1)),
            baseKnockback: base.baseKnockback * move.kb * (bat ? this.BAT_KB_MULT : 1),
            knockbackGrowth: base.knockbackGrowth * move.growth,
            range: base.range * move.range + (bat ? this.BAT_RANGE_BONUS : 0),
            hitstun: base.hitstun * move.hitstun
        };

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
            // Only hit targets that are actually in the direction the attacker is facing.
            // Uppercuts also catch rivals right above; meteors catch rivals right below.
            let inFront = (facingDir > 0 && dx > 0) || (facingDir < 0 && dx < 0);
            if (variant === 'up' && dy > 0.3 && Math.abs(dx) < 0.6) inFront = true;
            if (variant === 'meteor' && dy < -0.3 && Math.abs(dx) < 0.6) inFront = true;

            if (distance <= props.range && inFront) {
                // Check if target is blocking
                let isBlocking = target.isBlocking === true;
                let shieldBroke = false;

                // A blocked hit eats shield; an empty shield breaks and the hit goes through
                if (isBlocking) {
                    target.shield = (target.shield === undefined ? this.SHIELD_MAX : target.shield) - props.damage * this.SHIELD_HIT_COST;
                    if (target.shield <= 0) {
                        this.breakShield(target, now, roomCode);
                        isBlocking = false;
                        shieldBroke = true;
                    }
                }

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

                // Apply knockback (much reduced if blocking). Each variant has its own launch
                // angle: smashes go sideways, uppercuts straight up, meteors slam downward
                // (a grounded rival bounces up instead of going through the floor).
                const launchY = (variant === 'meteor' && target.isGrounded !== false) ? Math.abs(move.vy) * 0.7 : move.vy;
                target.velocity.x = knockbackDirX * knockbackPower * Math.abs(Math.cos(knockbackAngle)) * move.vx;
                target.velocity.y = isBlocking ? 0 : knockbackPower * launchY;

                // Hitstun scales with knockback so strong hits launch further before the player regains control
                const hitstunSeconds = isBlocking
                    ? props.hitstun * 0.3
                    : props.hitstun + knockbackPower * this.HITSTUN_PER_KNOCKBACK;
                target.hitstunUntil = Math.max(target.hitstunUntil || 0, now + hitstunSeconds * 1000);

                // Hitstop: both freeze for a moment, the launch happens when it ends
                const hitstopMs = isBlocking
                    ? this.HITSTOP_BLOCKED_MS
                    : this.HITSTOP_BASE_MS + actualDamage * this.HITSTOP_PER_DAMAGE_MS;
                target.freezeUntil = now + hitstopMs;
                attacker.freezeUntil = Math.max(attacker.freezeUntil || 0, now + hitstopMs);

                hits.push({
                    targetId: targetId,
                    damage: actualDamage,
                    newHealth: target.health,
                    knockback: {
                        x: target.velocity.x,
                        y: target.velocity.y
                    },
                    hitstun: hitstunSeconds,
                    hitstop: hitstopMs,
                    blocked: isBlocking,
                    shieldBroke,
                    shield: Math.max(0, Math.round(target.shield === undefined ? this.SHIELD_MAX : target.shield))
                });
            }
        }

        // Each landed bat hit wears it out
        if (bat && hits.length > 0) {
            bat.hitsLeft -= 1;
            if (bat.hitsLeft <= 0) {
                attacker.heldItem = null;
                this.pushEvent(roomCode, { type: 'item-break', kind: 'bate', playerId: attackerId });
            }
        }

        return {
            attackerId: attackerId,
            attackType: attackType,
            variant,
            moveName: bat ? 'BATAZO' : move.name,
            bat: !!bat,
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
                const koPosition = { ...player.position };
                player.stocks--;
                player.health = 0;
                player.velocity = { x: 0, y: 0, z: 0 };
                player.hitstunUntil = 0;
                player.freezeUntil = 0;
                player.shield = this.SHIELD_MAX;
                player.shieldStunUntil = 0;
                player.shieldRefillPending = false;
                player.isBlocking = false;
                player.airJumps = this.AIR_JUMPS;
                player.heldItem = null;

                // Respawn only if the player still has stocks; eliminated players stay out
                if (player.stocks > 0) {
                    player.position = { x: 0, y: 5, z: 0 };
                    player.previousY = player.position.y;
                }

                // Slow motion for everyone (longer when it was the last stock)
                const now = Date.now();
                const eliminated = player.stocks <= 0;
                room.slowMoUntil = Math.max(room.slowMoUntil || 0, now + (eliminated ? this.SLOWMO_ELIMINATION_MS : this.SLOWMO_MS));

                kos.push({
                    playerId: playerId,
                    stocksRemaining: player.stocks,
                    eliminated,
                    position: koPosition,
                    slowMoMs: eliminated ? this.SLOWMO_ELIMINATION_MS : this.SLOWMO_MS
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
        room.items = [];
        room.nextItemAt = 0;
        room.slowMoUntil = 0;
        this.pendingEvents.delete(roomCode);

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
            player.freezeUntil = 0;
            player.attackReadyAt = 0;
            player.shield = this.SHIELD_MAX;
            player.shieldStunUntil = 0;
            player.shieldRefillPending = false;
            player.isBlocking = false;
            player.airJumps = this.AIR_JUMPS;
            player.jumpHeld = false;
            player.heldItem = null;
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
     * @returns {boolean} The blocking state actually applied
     */
    setPlayerBlocking(playerId, roomCode, isBlocking) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return false;

        const player = room.players.get(playerId);
        if (!player) return false;

        if (isBlocking) {
            // A nearly empty or broken shield can't be raised
            const now = Date.now();
            if (player.shield === undefined) player.shield = this.SHIELD_MAX;
            if (player.shield < this.SHIELD_MIN_TO_RAISE || (player.shieldStunUntil || 0) > now || (player.hitstunUntil || 0) > now) {
                player.isBlocking = false;
                return false;
            }
        }
        player.isBlocking = !!isBlocking;
        return player.isBlocking;
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

