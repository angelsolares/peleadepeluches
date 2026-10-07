/**
 * Race State Manager
 * Server-side game state for Race mode
 * Handles player tapping, speed, and race progression
 */

const RACE_CONFIG = {
    TRACK_LENGTH: 100,
    MAX_PLAYERS: 8,
    FINISH_TIMEOUT: 15000,  // ms the others get after the first finisher before the race ends
    
    // Movement physics - increased for faster races
    TAP_BOOST: 1.5,         // Speed boost per valid alternating tap (was 0.8)
    MAX_SPEED: 25,          // Maximum speed (was 15)
    DECELERATION: 0.94,     // Speed decay per tick (was 0.92, higher = slower decay)
    
    // Tap validation
    TAP_COOLDOWN: 40,       // Minimum ms between taps (was 50)
    WRONG_TAP_PENALTY: 0.2, // Speed reduction for wrong tap (was 0.3)
    
    // Countdown
    COUNTDOWN_DURATION: 3,  // Seconds

    // Ticks: the loop timer is not reliable (Windows fires a 16 ms interval at ~36 Hz),
    // so each tick uses the real elapsed time, capped so a stall doesn't teleport anyone
    MAX_TICK_DELTA: 0.05,   // Seconds

    // Hurdles (vallas): same positions for every lane, jump in time or stumble
    HURDLE_COUNT: 3,
    HURDLE_MIN_POS: 25,     // Metres: first possible hurdle
    HURDLE_MAX_POS: 85,     // Metres: last possible hurdle
    HURDLE_MIN_GAP: 15,     // Metres between hurdles
    JUMP_WINDOW_MIN: 1.5,   // Metres before a hurdle where a jump counts...
    JUMP_WINDOW_MAX: 5,     // ...up to this far away
    JUMP_DURATION: 600,     // ms the runner is in the air
    STUMBLE_SPEED: 0.3,     // Speed multiplier when a hurdle is hit
    STUMBLE_DURATION: 700   // ms without taps after a stumble
};

class RaceStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.raceStates = new Map();
        this.pendingEvents = new Map(); // roomCode -> [{ type, ... }]
    }

    /**
     * Place HURDLE_COUNT hurdles at random positions in [HURDLE_MIN_POS, HURDLE_MAX_POS],
     * at least HURDLE_MIN_GAP apart (sorted by position). Same for every lane.
     * @returns {Array<{ id: number, position: number }>}
     */
    placeHurdles() {
        const { HURDLE_COUNT, HURDLE_MIN_POS, HURDLE_MAX_POS, HURDLE_MIN_GAP } = RACE_CONFIG;
        let positions = [];
        for (let attempt = 0; attempt < 200 && positions.length < HURDLE_COUNT; attempt++) {
            // Rounded to 0.1 m before the gap check, so the sent positions keep the gap too
            const candidate = Math.round((HURDLE_MIN_POS + Math.random() * (HURDLE_MAX_POS - HURDLE_MIN_POS)) * 10) / 10;
            if (positions.every(p => Math.abs(p - candidate) >= HURDLE_MIN_GAP - 1e-9)) positions.push(candidate);
        }
        if (positions.length < HURDLE_COUNT) {
            // Rejection sampling got unlucky: spread them evenly instead
            positions = [];
            const step = (HURDLE_MAX_POS - HURDLE_MIN_POS) / (HURDLE_COUNT - 1 || 1);
            for (let i = 0; i < HURDLE_COUNT; i++) positions.push(HURDLE_MIN_POS + i * step);
        }
        positions.sort((a, b) => a - b);
        return positions.map((position, id) => ({ id, position: Math.round(position * 10) / 10 }));
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
     * Initialize race state for a room
     */
    initializeRace(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;
        
        const raceState = {
            roomCode,
            state: 'waiting', // 'waiting', 'countdown', 'racing', 'finished'
            startTime: 0,
            players: new Map(),
            finishOrder: [],
            countdownValue: RACE_CONFIG.COUNTDOWN_DURATION,
            lastTickAt: 0,      // Date.now() of the previous tick (real delta per room)
            hurdles: this.placeHurdles()
        };
        this.pendingEvents.delete(roomCode);

        // Initialize player states
        let lane = 0;
        room.players.forEach((player, socketId) => {
            // Use character name as display name, with fallbacks
            let displayName = player.name || 'Jugador';
            if (player.character) {
                displayName = player.character.charAt(0).toUpperCase() + player.character.slice(1);
            }
            if (player.characterName) {
                displayName = player.characterName;
            }
            
            raceState.players.set(socketId, {
                id: socketId,
                name: displayName || `Jugador ${lane + 1}`,
                number: player.number,
                character: player.character,
                
                // Race state
                position: 0,        // Distance from start
                speed: 0,           // Current speed
                lane: lane++,       // Lane assignment
                
                // Tap tracking
                lastTap: null,      // 'left' or 'right'
                lastTapTime: 0,     // Timestamp
                tapCount: 0,        // Total valid taps

                // Hurdles
                jumpUntil: 0,       // Timestamp until which the player is in the air
                stumbledUntil: 0,   // Timestamp until which taps are ignored (hit a hurdle)
                clearedHurdles: new Set(), // Hurdle ids jumped over
                hitHurdles: new Set(),     // Hurdle ids tripped on

                // Finish state
                finished: false,
                finishTime: 0,
                finishPosition: 0
            });
        });
        
        this.raceStates.set(roomCode, raceState);
        console.log(`[Race] Initialized race for room ${roomCode} with ${raceState.players.size} players`);
        
        return raceState;
    }
    
    /**
     * Start countdown for race
     */
    startCountdown(roomCode, io, onRaceStart) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState) return;
        
        raceState.state = 'countdown';
        raceState.countdownValue = RACE_CONFIG.COUNTDOWN_DURATION;
        
        console.log(`[Race] Starting countdown for room ${roomCode}`);
        
        // Countdown interval
        const countdownInterval = setInterval(() => {
            io.to(roomCode).emit('race-countdown', { 
                count: raceState.countdownValue 
            });
            
            raceState.countdownValue--;
            
            if (raceState.countdownValue < 0) {
                clearInterval(countdownInterval);
                this.startRace(roomCode, io);
                
                // Call callback to start race loop
                if (onRaceStart) {
                    onRaceStart();
                }
            }
        }, 1000);
    }
    
    /**
     * Start the race
     */
    startRace(roomCode, io) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState) return;
        
        raceState.state = 'racing';
        raceState.startTime = Date.now();
        raceState.lastTickAt = raceState.startTime;

        console.log(`[Race] Race started for room ${roomCode}!`);

        io.to(roomCode).emit('race-start', { hurdles: raceState.hurdles });
    }

    /**
     * Next hurdle the player has neither cleared nor hit, or null
     */
    nextHurdle(raceState, player) {
        for (const hurdle of raceState.hurdles) {
            if (player.clearedHurdles.has(hurdle.id) || player.hitHurdles.has(hurdle.id)) continue;
            return hurdle;
        }
        return null;
    }

    /**
     * Process a jump from a player. Valid 1.5-5 m before the next hurdle (and not already
     * in the air): the player clears that hurdle. Too early, too late or no hurdle: nothing.
     */
    processJump(socketId, roomCode) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState || raceState.state !== 'racing') return null;

        const player = raceState.players.get(socketId);
        if (!player || player.finished) return null;

        const now = Date.now();
        if (now < player.jumpUntil) return { valid: false, reason: 'jumping' };
        if (now < player.stumbledUntil) return { valid: false, reason: 'stumbled' };

        const hurdle = this.nextHurdle(raceState, player);
        if (!hurdle) return { valid: false, reason: 'no-hurdle' };

        const distance = hurdle.position - player.position;
        if (distance > RACE_CONFIG.JUMP_WINDOW_MAX) return { valid: false, reason: 'early', distance };
        if (distance < RACE_CONFIG.JUMP_WINDOW_MIN) return { valid: false, reason: 'late', distance };

        player.jumpUntil = now + RACE_CONFIG.JUMP_DURATION;
        player.clearedHurdles.add(hurdle.id);
        return { valid: true, hurdleId: hurdle.id, distance };
    }

    /**
     * Process a tap input from a player
     */
    processTap(socketId, roomCode, tapSide) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState || raceState.state !== 'racing') return null;
        
        const player = raceState.players.get(socketId);
        if (!player || player.finished) return null;
        
        const now = Date.now();

        // Picking yourself up after a hurdle: taps don't count
        if (now < player.stumbledUntil) {
            return { valid: false, reason: 'stumbled' };
        }

        // Check tap cooldown
        if (now - player.lastTapTime < RACE_CONFIG.TAP_COOLDOWN) {
            return { valid: false, reason: 'cooldown' };
        }
        
        // Check if alternating tap (valid)
        let validTap = false;
        
        if (player.lastTap === null) {
            // First tap is always valid
            validTap = true;
        } else if (player.lastTap !== tapSide) {
            // Alternating tap (left -> right or right -> left)
            validTap = true;
        } else {
            // Same tap twice in a row - penalty
            player.speed = Math.max(0, player.speed - RACE_CONFIG.WRONG_TAP_PENALTY);
        }
        
        if (validTap) {
            // Boost speed
            player.speed = Math.min(RACE_CONFIG.MAX_SPEED, player.speed + RACE_CONFIG.TAP_BOOST);
            player.tapCount++;
        }
        
        player.lastTap = tapSide;
        player.lastTapTime = now;
        
        return { 
            valid: validTap, 
            speed: player.speed,
            tapCount: player.tapCount
        };
    }
    
    /**
     * Process game tick - update positions.
     * The delta is the real time since the previous tick (clamped), so the race runs at the
     * same pace whatever rate the loop timer actually achieves.
     */
    processTick(roomCode) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState || raceState.state !== 'racing') return null;

        const now = Date.now();
        const delta = Math.min(RACE_CONFIG.MAX_TICK_DELTA, Math.max(0, (now - raceState.lastTickAt) / 1000));
        raceState.lastTickAt = now;

        const players = [];

        raceState.players.forEach((player, socketId) => {
            if (!player.finished) {
                // Apply deceleration (DECELERATION is per 60 Hz tick; scale it to the real delta)
                player.speed *= Math.pow(RACE_CONFIG.DECELERATION, delta * 60);

                // Minimum speed threshold
                if (player.speed < 0.1) player.speed = 0;

                // Update position
                player.position += player.speed * delta;

                // Hurdles reached without a jump: stumble (each hurdle resolves once per player)
                for (const hurdle of raceState.hurdles) {
                    if (player.position < hurdle.position) break;
                    if (player.clearedHurdles.has(hurdle.id) || player.hitHurdles.has(hurdle.id)) continue;
                    player.hitHurdles.add(hurdle.id);
                    player.speed *= RACE_CONFIG.STUMBLE_SPEED;
                    player.stumbledUntil = now + RACE_CONFIG.STUMBLE_DURATION;
                    player.jumpUntil = 0;
                    this.pushEvent(roomCode, { type: 'race-stumble', playerId: player.id, hurdleId: hurdle.id });
                    console.log(`[Race] ${player.name} stumbled on hurdle ${hurdle.id}`);
                }

                // Check finish
                if (player.position >= RACE_CONFIG.TRACK_LENGTH) {
                    player.position = RACE_CONFIG.TRACK_LENGTH;
                    player.finished = true;
                    player.finishTime = Date.now() - raceState.startTime;
                    player.finishPosition = raceState.finishOrder.length + 1;
                    raceState.finishOrder.push(socketId);
                    if (!raceState.firstFinishAt) raceState.firstFinishAt = Date.now();
                                        
                    console.log(`[Race] ${player.name} finished in position ${player.finishPosition}!`);
                }
            }
            
            const next = player.finished ? null : this.nextHurdle(raceState, player);
            players.push({
                id: player.id,
                name: player.name,
                position: player.position,
                speed: player.speed,
                finished: player.finished,
                finishTime: player.finishTime,
                finishPosition: player.finishPosition,
                jumping: now < player.jumpUntil,
                stumbled: now < player.stumbledUntil,
                nextHurdleDistance: next ? Math.max(0, Math.round((next.position - player.position) * 10) / 10) : null
            });
        });

        // Check if race is over (all finished or first finished)
        const finishedCount = raceState.finishOrder.length;
        const totalPlayers = raceState.players.size;
        
        let raceOver = false;
        if (finishedCount > 0 && finishedCount === totalPlayers) {
            raceOver = true;
        }

        // Once someone finishes, the rest get FINISH_TIMEOUT to cross the line (AFK players can't stall the room)
        if (raceState.firstFinishAt && Date.now() - raceState.firstFinishAt >= RACE_CONFIG.FINISH_TIMEOUT) {
            raceOver = true;
        }

        // Everyone left
        if (totalPlayers === 0) {
            raceOver = true;
        }
        
        return {
            roomCode,
            state: raceState.state,
            players,
            hurdles: raceState.hurdles,
            raceOver,
            finishOrder: raceState.finishOrder
        };
    }
    
    /**
     * Get winner info
     */
    getWinnerInfo(roomCode) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState || raceState.finishOrder.length === 0) return null;
        
        const winnerId = raceState.finishOrder[0];
        const winner = raceState.players.get(winnerId);
        
        const positions = raceState.finishOrder.map((id, index) => {
            const p = raceState.players.get(id);
            return {
                id: p.id,
                name: p.name,
                position: index + 1,
                time: p.finishTime
            };
        });
        
        // Add DNF players
        raceState.players.forEach((p, id) => {
            if (!p.finished) {
                positions.push({
                    id: p.id,
                    name: p.name,
                    position: positions.length + 1,
                    time: null
                });
            }
        });
        
        return {
            winnerId: winner.id,
            winnerName: winner.name,
            winnerTime: winner.finishTime,
            positions
        };
    }
    
    /**
     * End race and cleanup
     */
    endRace(roomCode) {
        const raceState = this.raceStates.get(roomCode);
        if (raceState) {
            raceState.state = 'finished';
            console.log(`[Race] Race ended for room ${roomCode}`);
        }
    }
    
    /**
     * Drop a player who left mid-race. Finished players are kept so results stay complete.
     */
    removePlayer(roomCode, socketId) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState) return;
        const player = raceState.players.get(socketId);
        if (player && !player.finished) {
            raceState.players.delete(socketId);
        }
    }

    /**
     * Remove race state
     */
    removeRace(roomCode) {
        this.raceStates.delete(roomCode);
        this.pendingEvents.delete(roomCode);
    }
}

export { RaceStateManager, RACE_CONFIG };

