/**
 * Balloon (Infla el Globo) State Manager
 * Server-side game state for Balloon mode
 *
 * Press-your-luck breath control: the player HOLDS to blow ('balloon-blow' true/false).
 * Blowing drains the lungs, which only refill while the button is released (and the
 * balloon slowly deflates meanwhile). The balloon bursts at a hidden random size, so the
 * player reads the tension cues (sent as `tension`, 0..1 from 70 up) and can lock in
 * ("amarrar", 'balloon-tie') whatever size they have: a tied balloon no longer grows,
 * deflates or pops. Winner: the biggest balloon that did not pop.
 */

const BALLOON_CONFIG = {
    TARGET_SIZE: 100,       // UI target
    BLOW_RATE: 26,          // size per second at full lungs once the blow has ramped up
    BLOW_RAMP: 0.35,        // seconds for a blow to reach its full rate
    LUNG_DRAIN: 55,         // lung per second while blowing
    LUNG_REGEN: 50,         // lung per second while the button is released
    PUFF_AMOUNT: 1.5,       // legacy tap ('balloon-inflate'): tiny puff
    PUFF_COOLDOWN: 120,     // ms between accepted puffs
    PUFF_LUNG_COST: 25,     // a puff also spends air (so mashing is strictly worse than holding)
    DEFLATE_RATE: 1.5,      // size per second lost while not blowing (and not tied)
    TENSION_START: 70,      // tension cue begins here...
    TENSION_END: 95,        // ...and is at its maximum here (the hidden burst is 85-95)
    MAX_TICK_DT: 0.25,      // clamp for real-time integration after a stall
    GAME_DURATION: 30       // seconds
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

class BalloonStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.balloonStates = new Map();
    }

    /**
     * Initialize balloon state for a room
     * @param {string} roomCode - Room code
     */
    initializeBalloon(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room || room.gameMode !== 'balloon') return null;

        const now = Date.now();
        const balloonState = {
            roomCode,
            players: new Map(),
            startTime: now,
            endTime: now + (BALLOON_CONFIG.GAME_DURATION * 1000),
            lastTickTime: now,
            gameState: 'active',    // 'active', 'finished'
            endReason: null,        // 'all-popped' | 'last-survivor' | 'all-tied' | 'time'
            winner: null,
            results: null,          // final ranking (filled when finished)
            timeLeft: BALLOON_CONFIG.GAME_DURATION
        };

        // Initialize players
        room.players.forEach((player) => {
            balloonState.players.set(player.id, {
                id: player.id,
                name: player.name,
                number: player.number,
                color: player.color,
                character: player.character || 'edgar',
                balloonSize: 0,
                burstSize: 85 + Math.random() * 10, // Burst between 85% and 95% (never sent to clients)
                lung: 100,          // air left (0-100)
                blowing: false,     // button held
                blowTime: 0,        // seconds of the current blow (rate ramp)
                tied: false,        // locked in ("amarrado")
                tiedAt: null,
                lastPumpTime: 0,    // legacy puff cooldown
                isDQ: false         // Disqualified if they burst
            });
        });

        this.balloonStates.set(roomCode, balloonState);
        return balloonState;
    }

    /**
     * Process a game tick (integrates with the real elapsed time)
     */
    processTick(roomCode) {
        const state = this.balloonStates.get(roomCode);
        if (!state || state.gameState !== 'active') return null;

        const now = Date.now();
        const dt = Math.min(BALLOON_CONFIG.MAX_TICK_DT, Math.max(0, (now - state.lastTickTime) / 1000));
        state.lastTickTime = now;

        // Update timer
        state.timeLeft = Math.max(0, (state.endTime - now) / 1000);

        // Breath / balloon physics
        state.players.forEach((p) => this.integratePlayer(p, dt));

        // Game over conditions
        const activePlayers = Array.from(state.players.values()).filter(p => !p.isDQ);

        if (activePlayers.length === 0) {
            // Everyone popped!
            this.finish(state, 'all-popped');
        } else if (activePlayers.length === 1 && state.players.size > 1) {
            // Last survivor wins!
            this.finish(state, 'last-survivor');
        } else if (activePlayers.every(p => p.tied)) {
            // Everyone banked (or popped): nothing left to play for
            this.finish(state, 'all-tied');
        } else if (state.timeLeft <= 0) {
            // Time out: biggest surviving balloon wins
            this.finish(state, 'time');
        }

        return this.buildPayload(state);
    }

    /**
     * One player's breath and balloon for `dt` seconds
     */
    integratePlayer(p, dt) {
        if (p.isDQ || p.tied) return;

        if (p.blowing && p.lung > 0) {
            // Blowing: the rate ramps up over the first instants and weakens as the air runs out
            p.blowTime += dt;
            const ramp = Math.min(1, p.blowTime / BALLOON_CONFIG.BLOW_RAMP);
            const rate = BALLOON_CONFIG.BLOW_RATE * ramp * (0.4 + 0.6 * p.lung / 100);
            p.balloonSize += rate * dt;
            p.lung = Math.max(0, p.lung - BALLOON_CONFIG.LUNG_DRAIN * dt);
            this.checkBurst(p);
            return;
        }

        if (!p.blowing) {
            // Released: breathe in
            p.lung = Math.min(100, p.lung + BALLOON_CONFIG.LUNG_REGEN * dt);
            p.blowTime = 0;
        }
        // Not blowing (or holding with empty lungs, which does not refill them): slow deflation
        if (p.balloonSize > 0) {
            p.balloonSize = Math.max(0, p.balloonSize - BALLOON_CONFIG.DEFLATE_RATE * dt);
        }
    }

    /**
     * Burst check (Disqualification)
     */
    checkBurst(p) {
        if (p.balloonSize >= p.burstSize) {
            p.balloonSize = p.burstSize;
            p.isDQ = true;
            p.blowing = false;
            p.blowTime = 0;
        }
    }

    getTension(p) {
        return clamp01((p.balloonSize - BALLOON_CONFIG.TENSION_START) /
            (BALLOON_CONFIG.TENSION_END - BALLOON_CONFIG.TENSION_START));
    }

    /**
     * End the match: winner = biggest balloon that did not pop, plus the full ranking
     */
    finish(state, reason) {
        state.gameState = 'finished';
        state.endReason = reason;
        state.results = this.buildResults(state);
        const best = state.results.find(r => !r.isDQ);
        state.winner = best ? { id: best.id, name: best.name } : null;
    }

    /**
     * Ranking: survivors by size (biggest first), then the popped ones
     */
    buildResults(state) {
        return Array.from(state.players.values())
            .sort((a, b) => (a.isDQ - b.isDQ) || (b.balloonSize - a.balloonSize))
            .map(p => ({
                id: p.id,
                name: p.name,
                balloonSize: Math.round(p.balloonSize),
                tied: p.tied,
                isDQ: p.isDQ
            }));
    }

    /**
     * Public state (the hidden burst size and internal timers stay on the server)
     */
    buildPayload(state) {
        return {
            roomCode: state.roomCode,
            gameState: state.gameState,
            endReason: state.endReason,
            winner: state.winner,
            results: state.results,
            timeLeft: Math.ceil(state.timeLeft),
            players: Array.from(state.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                number: p.number,
                color: p.color,
                character: p.character,
                balloonSize: p.balloonSize,
                progress: p.isDQ ? 100 : Math.min(100, (p.balloonSize / BALLOON_CONFIG.TARGET_SIZE) * 100),
                lung: Math.round(p.lung),
                tension: this.getTension(p),
                blowing: p.blowing,
                tied: p.tied,
                isDQ: p.isDQ
            }))
        };
    }

    /**
     * Get a player that can still act (match active, not popped, not tied)
     */
    getActivePlayer(playerId, roomCode) {
        const state = this.balloonStates.get(roomCode);
        if (!state || state.gameState !== 'active') return null;

        const player = state.players.get(playerId);
        if (!player || player.isDQ || player.tied) return null;
        return player;
    }

    /**
     * Hold / release the blow button
     */
    handleBlow(playerId, roomCode, blowing) {
        const player = this.getActivePlayer(playerId, roomCode);
        if (!player) return;

        const on = !!blowing;
        if (player.blowing === on) return;
        player.blowing = on;
        if (!on) player.blowTime = 0;
    }

    /**
     * Lock the balloon at its current size (no growth, no deflation, cannot pop)
     */
    handleTie(playerId, roomCode) {
        const player = this.getActivePlayer(playerId, roomCode);
        if (!player) return false;

        player.tied = true;
        player.tiedAt = Date.now();
        player.blowing = false;
        player.blowTime = 0;
        return true;
    }

    /**
     * Legacy tap ('balloon-inflate'): a tiny puff that also spends air
     */
    handleInflate(playerId, roomCode) {
        const player = this.getActivePlayer(playerId, roomCode);
        if (!player) return;

        const now = Date.now();
        if (now - player.lastPumpTime < BALLOON_CONFIG.PUFF_COOLDOWN) return;
        if (player.lung < BALLOON_CONFIG.PUFF_LUNG_COST) return;

        player.lastPumpTime = now;
        player.lung -= BALLOON_CONFIG.PUFF_LUNG_COST;
        player.balloonSize += BALLOON_CONFIG.PUFF_AMOUNT;
        this.checkBurst(player);
    }

    cleanup(roomCode) {
        this.balloonStates.delete(roomCode);
    }
}

export default BalloonStateManager;
