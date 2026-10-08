/**
 * Sumo State Manager
 * Server-side state for Sumo mode: a shrinking round ring, charged shoves, ring-outs.
 * Last one standing wins.
 */

const SUMO_CONFIG = {
    RING_RADIUS: 8,           // Start radius
    RING_MIN_RADIUS: 3,       // Radius at the end of the regular time
    SUDDEN_DEATH_RADIUS: 1,   // Radius at the end of sudden death
    MATCH_DURATION: 60,       // Seconds of regular time
    SUDDEN_DEATH_DURATION: 10,
    COUNTDOWN: 3,             // Seconds before the start
    OUT_MARGIN: 0.4,          // How far past the rim a player's center must be to fall

    MOVE_SPEED: 6,
    CHARGE_MOVE_SPEED: 2.5,   // Walking while charging a shove
    FRICTION: 0.85,           // Per 60 Hz frame (normalized to the real delta)
    STUN_FRICTION: 0.93,      // Sliding after being shoved
    BODY_RADIUS: 0.9,         // Players closer than this are pushed apart

    CHARGE_MAX_MS: 1000,      // Full charge
    SHOVE_COOLDOWN_MS: 1000,
    DASH_MS: 220,
    DASH_SPEED_MIN: 10,
    DASH_SPEED_MAX: 18,
    DASH_BRAKE: 0.3,          // Momentum kept when the dash ends
    SHOVE_RANGE: 1.4,         // Reach of the shove during the dash
    SHOVE_POWER_MIN: 9,       // Knockback speed at zero charge
    SHOVE_POWER_MAX: 20,      // Knockback speed at full charge
    STUN_MS: 350,

    END_DELAY_MS: 1500,       // Keep ticking after the last ring-out before finishing
    FALL_GRAVITY: 22,
    FALL_FLOOR: -8,           // Eliminated players stop being updated below this
    SPAWN_RADIUS: 5,
    MAX_DELTA: 0.05
};

class SumoStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.sumoStates = new Map();
        this.pendingEvents = new Map(); // roomCode -> [{ type, ... }]
    }

    /**
     * Initialize sumo state for a room
     * @param {string} roomCode
     */
    initializeSumo(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room || room.gameMode !== 'sumo') return null;

        const now = Date.now();
        const state = {
            roomCode,
            players: new Map(),
            gameState: 'countdown',   // 'countdown', 'active', 'suddenDeath', 'finished'
            startTime: now + SUMO_CONFIG.COUNTDOWN * 1000,
            lastTickAt: now,
            ringRadius: SUMO_CONFIG.RING_RADIUS,
            lastShrinkNotice: Math.ceil(SUMO_CONFIG.RING_RADIUS),
            suddenDeathAnnounced: false,
            endingAt: 0,
            eliminatedCount: 0,
            winner: null,
            ranking: []
        };

        const ids = Array.from(room.players.keys());
        ids.forEach((socketId, index) => {
            const player = room.players.get(socketId);
            state.players.set(socketId, this.createPlayerState(player, index, ids.length));
        });

        this.sumoStates.set(roomCode, state);
        this.pendingEvents.delete(roomCode);
        return state;
    }

    createPlayerState(player, index, total) {
        const angle = (index / Math.max(total, 1)) * Math.PI * 2;
        return {
            id: player.id,
            name: player.name,
            number: player.number,
            color: player.color,
            character: player.character || 'edgar',
            position: { x: Math.cos(angle) * SUMO_CONFIG.SPAWN_RADIUS, y: 0, z: Math.sin(angle) * SUMO_CONFIG.SPAWN_RADIUS },
            velocity: { x: 0, y: 0, z: 0 },
            facingAngle: Math.atan2(-Math.cos(angle), -Math.sin(angle)), // Face the center
            input: { left: false, right: false, up: false, down: false },
            chargeStart: 0,       // Timestamp while holding the shove button
            dashUntil: 0,         // Dashing while > now
            dashDir: { x: 0, z: 0 },
            dashPower: 0,         // 0..1 charge of the current dash
            dashHit: new Set(),   // Players already hit by this dash
            shoveReadyAt: 0,
            stunnedUntil: 0,
            lastShovedBy: null,
            lastShovedAt: 0,
            alive: true,
            falling: false,
            eliminatedAt: 0,
            placement: null
        };
    }

    pushEvent(roomCode, event) {
        if (!this.pendingEvents.has(roomCode)) this.pendingEvents.set(roomCode, []);
        this.pendingEvents.get(roomCode).push(event);
    }

    drainEvents(roomCode) {
        const events = this.pendingEvents.get(roomCode) || [];
        this.pendingEvents.delete(roomCode);
        return events;
    }

    /**
     * Process a game tick
     */
    processTick(roomCode) {
        const state = this.sumoStates.get(roomCode);
        if (!state || state.gameState === 'finished') return null;
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;

        const now = Date.now();
        const delta = Math.min(SUMO_CONFIG.MAX_DELTA, Math.max(0, (now - state.lastTickAt) / 1000));
        state.lastTickAt = now;
        const frames = delta * 60;

        // Players who left the room are out
        for (const [socketId, p] of state.players) {
            if (!room.players.has(socketId) && p.alive) {
                this.eliminate(state, roomCode, p, null, now);
            }
        }

        // Countdown
        if (state.gameState === 'countdown') {
            if (now >= state.startTime) {
                state.gameState = 'active';
            } else {
                return this.getStateForClient(state, now);
            }
        }

        // Ring size and phases
        const elapsed = (now - state.startTime) / 1000;
        if (elapsed < SUMO_CONFIG.MATCH_DURATION) {
            const t = elapsed / SUMO_CONFIG.MATCH_DURATION;
            state.ringRadius = SUMO_CONFIG.RING_RADIUS + (SUMO_CONFIG.RING_MIN_RADIUS - SUMO_CONFIG.RING_RADIUS) * t;
        } else {
            if (!state.suddenDeathAnnounced) {
                state.suddenDeathAnnounced = true;
                state.gameState = 'suddenDeath';
                this.pushEvent(roomCode, { type: 'sudden-death' });
            }
            const t = Math.min(1, (elapsed - SUMO_CONFIG.MATCH_DURATION) / SUMO_CONFIG.SUDDEN_DEATH_DURATION);
            state.ringRadius = SUMO_CONFIG.RING_MIN_RADIUS + (SUMO_CONFIG.SUDDEN_DEATH_RADIUS - SUMO_CONFIG.RING_MIN_RADIUS) * t;
        }
        if (Math.ceil(state.ringRadius) < state.lastShrinkNotice) {
            state.lastShrinkNotice = Math.ceil(state.ringRadius);
            this.pushEvent(roomCode, { type: 'ring-shrink', ringRadius: Math.round(state.ringRadius * 10) / 10 });
        }

        // Movement, dashes, shoves
        for (const [socketId, p] of state.players) {
            const roomPlayer = room.players.get(socketId);
            if (roomPlayer && roomPlayer.name) p.name = roomPlayer.name;
            if (!p.alive) { this.updateFalling(p, delta); continue; }
            if (roomPlayer && roomPlayer.input) p.input = { ...p.input, ...roomPlayer.input };
            this.processMovement(p, delta, frames, now);
        }
        this.resolveBodyCollisions(state);
        this.processShoveHits(state, roomCode, now);

        // Ring-outs (none once the match is decided: the winner's dash momentum must not "eliminate" them)
        for (const p of state.players.values()) {
            if (!p.alive || state.endingAt) continue;
            const dist = Math.sqrt(p.position.x * p.position.x + p.position.z * p.position.z);
            if (dist > state.ringRadius + SUMO_CONFIG.OUT_MARGIN) {
                const by = p.lastShovedBy && now - p.lastShovedAt < 2000 ? p.lastShovedBy : null;
                this.eliminate(state, roomCode, p, by, now);
            }
        }

        // End: last one standing (or nobody left). The match lingers a moment so the fall of the
        // last eliminated player is streamed and the winner gets their "last one standing" beat.
        const alive = Array.from(state.players.values()).filter(p => p.alive);
        if ((alive.length <= 1 && state.players.size > 1) || alive.length === 0) {
            if (!state.endingAt) state.endingAt = now + SUMO_CONFIG.END_DELAY_MS;
            if (now >= state.endingAt) this.finish(state, roomCode, alive[0] || null, now);
        }

        return this.getStateForClient(state, now);
    }

    processMovement(p, delta, frames, now) {
        const stunned = p.stunnedUntil > now;
        const dashing = p.dashUntil > now;

        if (dashing) {
            const speed = SUMO_CONFIG.DASH_SPEED_MIN + (SUMO_CONFIG.DASH_SPEED_MAX - SUMO_CONFIG.DASH_SPEED_MIN) * p.dashPower;
            p.velocity.x = p.dashDir.x * speed;
            p.velocity.z = p.dashDir.z * speed;
            p.wasDashing = true;
        } else if (p.wasDashing) {
            // Brake at the end of the dash so a full charge travels ~4.5 m, not 6
            p.wasDashing = false;
            p.velocity.x *= SUMO_CONFIG.DASH_BRAKE;
            p.velocity.z *= SUMO_CONFIG.DASH_BRAKE;
        } else if (!stunned) {
            let dirX = 0, dirZ = 0;
            if (p.input.left) dirX -= 1;
            if (p.input.right) dirX += 1;
            if (p.input.up) dirZ -= 1;
            if (p.input.down) dirZ += 1;
            const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
            if (len > 0) {
                dirX /= len; dirZ /= len;
                const speed = p.chargeStart ? SUMO_CONFIG.CHARGE_MOVE_SPEED : SUMO_CONFIG.MOVE_SPEED;
                // Steady state of "set velocity, then friction" at 60 Hz, tick-rate independent
                p.velocity.x = dirX * speed * SUMO_CONFIG.FRICTION;
                p.velocity.z = dirZ * speed * SUMO_CONFIG.FRICTION;
                p.facingAngle = Math.atan2(dirX, dirZ);
            } else {
                const f = Math.pow(SUMO_CONFIG.FRICTION, frames);
                p.velocity.x *= f;
                p.velocity.z *= f;
            }
        } else {
            const f = Math.pow(SUMO_CONFIG.STUN_FRICTION, frames);
            p.velocity.x *= f;
            p.velocity.z *= f;
        }

        p.position.x += p.velocity.x * delta;
        p.position.z += p.velocity.z * delta;
    }

    updateFalling(p, delta) {
        if (!p.falling || p.position.y <= SUMO_CONFIG.FALL_FLOOR) return;
        p.velocity.y -= SUMO_CONFIG.FALL_GRAVITY * delta;
        p.position.y += p.velocity.y * delta;
        p.position.x += p.velocity.x * delta;
        p.position.z += p.velocity.z * delta;
        if (p.position.y <= SUMO_CONFIG.FALL_FLOOR) {
            p.position.y = SUMO_CONFIG.FALL_FLOOR;
            p.falling = false;
        }
    }

    /** Soft push between alive players standing too close (dashing players go through) */
    resolveBodyCollisions(state) {
        const alive = Array.from(state.players.values()).filter(p => p.alive);
        const r = SUMO_CONFIG.BODY_RADIUS;
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i], b = alive[j];
                const dx = b.position.x - a.position.x;
                const dz = b.position.z - a.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist >= r || dist === 0) continue;
                const push = (r - dist) / 2;
                const nx = dx / dist, nz = dz / dist;
                a.position.x -= nx * push; a.position.z -= nz * push;
                b.position.x += nx * push; b.position.z += nz * push;
            }
        }
    }

    /** During a dash, anyone in front within reach gets launched (once per dash) */
    processShoveHits(state, roomCode, now) {
        for (const attacker of state.players.values()) {
            if (!attacker.alive || attacker.dashUntil <= now) continue;
            for (const target of state.players.values()) {
                if (target === attacker || !target.alive || attacker.dashHit.has(target.id)) continue;
                const dx = target.position.x - attacker.position.x;
                const dz = target.position.z - attacker.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > SUMO_CONFIG.SHOVE_RANGE || dist === 0) continue;
                const dot = (dx / dist) * attacker.dashDir.x + (dz / dist) * attacker.dashDir.z;
                if (dot < 0.3) continue;

                const power = SUMO_CONFIG.SHOVE_POWER_MIN + (SUMO_CONFIG.SHOVE_POWER_MAX - SUMO_CONFIG.SHOVE_POWER_MIN) * attacker.dashPower;
                target.velocity.x = attacker.dashDir.x * power;
                target.velocity.z = attacker.dashDir.z * power;
                target.stunnedUntil = now + SUMO_CONFIG.STUN_MS;
                target.chargeStart = 0; // A hit interrupts the charge
                target.lastShovedBy = attacker.id;
                target.lastShovedAt = now;
                attacker.dashHit.add(target.id);
                this.pushEvent(roomCode, { type: 'shove-hit', attackerId: attacker.id, targetId: target.id, power: Math.round(attacker.dashPower * 100) / 100 });
            }
        }
    }

    eliminate(state, roomCode, p, by, now) {
        if (!p.alive) return;
        p.alive = false;
        p.falling = true;
        p.eliminatedAt = now;
        p.chargeStart = 0;
        p.dashUntil = 0;
        // Keep a bit of outward momentum so the fall looks right
        const dist = Math.sqrt(p.position.x * p.position.x + p.position.z * p.position.z) || 1;
        p.velocity.x = (p.position.x / dist) * 2 + p.velocity.x * 0.3;
        p.velocity.z = (p.position.z / dist) * 2 + p.velocity.z * 0.3;
        p.velocity.y = 1;
        state.eliminatedCount++;
        p.placement = state.players.size - state.eliminatedCount + 1;
        this.pushEvent(roomCode, { type: 'ring-out', playerId: p.id, playerName: p.name, placement: p.placement, by });
    }

    finish(state, roomCode, winner, now) {
        state.gameState = 'finished';
        if (winner) {
            winner.placement = 1;
            state.winner = { id: winner.id, name: winner.name };
        } else {
            // Everyone fell: the last one out takes it
            const last = Array.from(state.players.values()).sort((a, b) => b.eliminatedAt - a.eliminatedAt)[0];
            state.winner = last ? { id: last.id, name: last.name } : null;
        }
        state.ranking = Array.from(state.players.values())
            .sort((a, b) => (a.placement || 99) - (b.placement || 99))
            .map(p => ({ id: p.id, name: p.name, placement: p.placement }));
    }

    /**
     * Hold the shove button: start charging
     */
    handleChargeStart(playerId, roomCode) {
        const state = this.sumoStates.get(roomCode);
        const p = state && state.players.get(playerId);
        if (!p || !p.alive || state.gameState === 'countdown' || state.gameState === 'finished') return false;
        const now = Date.now();
        if (p.chargeStart || p.dashUntil > now || p.stunnedUntil > now || p.shoveReadyAt > now) return false;
        p.chargeStart = now;
        return true;
    }

    /**
     * Release the shove button: dash forward with the accumulated charge
     * @returns {{ success: boolean, power?: number, reason?: string }}
     */
    handleShove(playerId, roomCode) {
        const state = this.sumoStates.get(roomCode);
        const p = state && state.players.get(playerId);
        if (!p || !p.alive) return { success: false, reason: 'not-alive' };
        if (state.gameState === 'countdown' || state.gameState === 'finished') return { success: false, reason: 'not-active' };
        const now = Date.now();
        if (p.stunnedUntil > now) { p.chargeStart = 0; return { success: false, reason: 'stunned' }; }
        if (p.dashUntil > now || p.shoveReadyAt > now) { p.chargeStart = 0; return { success: false, reason: 'cooldown' }; }

        const power = p.chargeStart ? Math.min(1, (now - p.chargeStart) / SUMO_CONFIG.CHARGE_MAX_MS) : 0;
        p.chargeStart = 0;

        // Dash where the player faces (or where the stick points)
        let dirX = 0, dirZ = 0;
        if (p.input.left) dirX -= 1;
        if (p.input.right) dirX += 1;
        if (p.input.up) dirZ -= 1;
        if (p.input.down) dirZ += 1;
        const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (len > 0) {
            dirX /= len; dirZ /= len;
            p.facingAngle = Math.atan2(dirX, dirZ);
        } else {
            dirX = Math.sin(p.facingAngle);
            dirZ = Math.cos(p.facingAngle);
        }
        p.dashDir = { x: dirX, z: dirZ };
        p.dashPower = power;
        p.dashUntil = now + SUMO_CONFIG.DASH_MS;
        p.dashHit = new Set();
        p.shoveReadyAt = now + SUMO_CONFIG.SHOVE_COOLDOWN_MS;
        return { success: true, power };
    }

    getStateForClient(state, now) {
        const elapsed = (now - state.startTime) / 1000;
        const alive = Array.from(state.players.values()).filter(p => p.alive).length;
        return {
            roomCode: state.roomCode,
            gameState: state.gameState,
            countdown: state.gameState === 'countdown' ? Math.max(0, Math.ceil((state.startTime - now) / 1000)) : 0,
            timeLeft: Math.max(0, SUMO_CONFIG.MATCH_DURATION - Math.max(0, elapsed)),
            ringRadius: Math.round(state.ringRadius * 100) / 100,
            serverTime: now,
            aliveCount: alive,
            winner: state.winner,
            ranking: state.ranking,
            players: Array.from(state.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                number: p.number,
                color: p.color,
                character: p.character,
                position: { x: Math.round(p.position.x * 100) / 100, y: Math.round(p.position.y * 100) / 100, z: Math.round(p.position.z * 100) / 100 },
                velocity: { x: Math.round(p.velocity.x * 100) / 100, z: Math.round(p.velocity.z * 100) / 100 },
                facingAngle: Math.round(p.facingAngle * 100) / 100,
                isCharging: !!p.chargeStart && p.alive,
                chargeRatio: p.chargeStart ? Math.min(1, Math.round(((now - p.chargeStart) / SUMO_CONFIG.CHARGE_MAX_MS) * 100) / 100) : 0,
                isShoving: p.dashUntil > now,
                stunned: p.stunnedUntil > now,
                alive: p.alive,
                falling: p.falling,
                placement: p.placement
            }))
        };
    }

    cleanup(roomCode) {
        this.sumoStates.delete(roomCode);
        this.pendingEvents.delete(roomCode);
    }
}

export default SumoStateManager;
export { SUMO_CONFIG };
