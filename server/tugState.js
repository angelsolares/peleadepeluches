/**
 * Tug of War (Guerra de Cuerda) State Manager
 * Server-side game state for Tug of War mode
 *
 * Rhythm game: the match has a fixed beat (pulse k = startTime + k * PULSE_INTERVAL) and
 * winning means the whole TEAM pulls on the beat, not mashing:
 *  - only the first pull per pulse window moves the rope (extra pulls cost stamina for nothing)
 *  - consecutive on-beat pulls build a personal streak (up to +50%)
 *  - when at least half of a team lands the same pulse the team sync combo grows (up to +60%)
 */

const TUG_CONFIG = {
    WIN_DISTANCE: 100,      // Distance to win
    ROPE_SENSITIVITY: 0.5,  // How much force moves the rope
    STAMINA_REGEN: 15,      // Stamina regen per second
    STAMINA_COST: 20,       // Stamina cost per pull
    BASE_PULL_POWER: 10,    // Base force per player
    ALPHA_BALANCING: 0.85,  // Team size compensation factor
    PULSE_INTERVAL: 1500,   // Rhythm pulse interval (ms)
    GREEN_ZONE_WINDOW: 300, // |pull - pulse| <= 300 ms is good, <= 150 ms is perfect
    COMEBACK_MAX_BONUS: 0.15, // 15% max bonus for team losing
    GAME_DURATION: 60,      // 60 seconds game duration
    STREAK_STEP: 0.1,       // +10% force per consecutive on-beat pull
    STREAK_MAX: 5,          // Streak bonus caps at x1.5
    SYNC_STEP: 0.15,        // +15% team force per consecutive synced pulse
    SYNC_MAX: 4,            // Team sync bonus caps at x1.6
    SYNC_MIN_RATIO: 0.5     // Share of the team that must land a pulse to keep the combo
};

class TugStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.tugStates = new Map();
    }

    /**
     * Initialize tug state for a room
     * @param {string} roomCode - Room code
     */
    initializeTug(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room || room.gameMode !== 'tug') return null;

        const now = Date.now();
        const tugState = {
            roomCode,
            players: new Map(),
            markerPos: 0,           // -100 (left win) to 100 (right win)
            startTime: now + 3000,  // 3 second countdown; pulse 0 happens right here
            endTime: now + 3000 + (TUG_CONFIG.GAME_DURATION * 1000),
            nextPulseTime: now + 3000,
            beat: -1,               // Index of the last pulse that happened
            closedPulse: -1,        // Last pulse whose timing window was evaluated for team sync
            gameState: 'countdown', // 'countdown', 'active', 'finished'
            winnerTeam: null,       // 'left' or 'right'
            countdown: 3,
            timeLeft: TUG_CONFIG.GAME_DURATION,
            teams: {
                left: [],
                right: []
            },
            teamStats: {
                left: this.createTeamStats(),
                right: this.createTeamStats()
            }
        };

        // Initialize players and teams
        const playersArray = Array.from(room.players.values());

        // Shuffle and divide into teams as evenly as possible
        const shuffled = [...playersArray].sort(() => Math.random() - 0.5);
        shuffled.forEach((player, index) => {
            const team = (index % 2 === 0) ? 'left' : 'right';
            const playerState = this.createPlayerTugState(player, team);
            tugState.players.set(player.id, playerState);
            tugState.teams[team].push(player.id);
        });

        this.tugStates.set(roomCode, tugState);

        // Return player data with team assignments for the start event
        return Array.from(tugState.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            number: p.number,
            color: p.color,
            character: p.character,
            team: p.team
        }));
    }

    createTeamStats() {
        return {
            syncCombo: 0,   // Consecutive pulses on which >= SYNC_MIN_RATIO of the team landed
            syncRatio: 0,   // Share of the team that landed the last closed pulse
            hits: 0         // Members that landed the last closed pulse
        };
    }

    /**
     * Create initial tug state for a player
     */
    createPlayerTugState(player, team) {
        return {
            id: player.id,
            name: player.name,
            number: player.number,
            color: player.color,
            character: player.character || 'edgar',
            team: team,
            stamina: 100,
            pullPower: TUG_CONFIG.BASE_PULL_POWER,
            lastProcessedTime: Date.now(),
            lastPullTime: 0,
            pendingPulls: [],   // Timestamps of pulls received since the last tick
            pullQuality: 0,     // This tick: 0 fail/none, 1 good, 2 perfect
            mashed: false,      // This tick: an extra pull in an already used pulse window
            streak: 0,          // Consecutive pulses landed good/perfect
            hitPulse: -1,       // Last pulse index landed good/perfect
            lastPullPulse: -1   // Last pulse window in which a pull was spent
        };
    }

    // =================================
    // Beat schedule (anchored to startTime, never drifts)
    // =================================

    pulseTime(tugState, k) {
        return tugState.startTime + k * TUG_CONFIG.PULSE_INTERVAL;
    }

    /** Index of the last pulse that happened at time t (-1 before the match starts) */
    beatIndex(tugState, t) {
        return Math.floor((t - tugState.startTime) / TUG_CONFIG.PULSE_INTERVAL);
    }

    /** Index of the pulse nearest to time t (the pulse window the time belongs to) */
    nearestPulse(tugState, t) {
        return Math.round((t - tugState.startTime) / TUG_CONFIG.PULSE_INTERVAL);
    }

    streakMultiplier(streak) {
        return 1 + TUG_CONFIG.STREAK_STEP * Math.min(streak, TUG_CONFIG.STREAK_MAX);
    }

    syncMultiplier(syncCombo) {
        return 1 + TUG_CONFIG.SYNC_STEP * Math.min(syncCombo, TUG_CONFIG.SYNC_MAX);
    }

    /**
     * Process a game tick
     */
    processTick(roomCode) {
        const tugState = this.tugStates.get(roomCode);
        if (!tugState || tugState.gameState === 'finished') return null;

        const now = Date.now();

        if (tugState.gameState === 'countdown') {
            const timeRemaining = (tugState.startTime - now) / 1000;
            tugState.countdown = Math.ceil(timeRemaining);

            if (now >= tugState.startTime) {
                tugState.gameState = 'active';
                tugState.countdown = 0;
            }

            return {
                roomCode,
                markerPos: tugState.markerPos,
                gameState: tugState.gameState,
                countdown: tugState.countdown,
                timeLeft: TUG_CONFIG.GAME_DURATION,
                serverTime: now,
                pulseInterval: TUG_CONFIG.PULSE_INTERVAL,
                greenZoneWindow: TUG_CONFIG.GREEN_ZONE_WINDOW,
                nextPulseTime: tugState.startTime,
                beat: -1,
                teams: this.serializeTeams(tugState),
                players: Array.from(tugState.players.values()).map(p => ({
                    id: p.id,
                    name: p.name,
                    team: p.team,
                    stamina: p.stamina,
                    pullQuality: 0,
                    streak: 0,
                    mashed: false
                }))
            };
        }

        if (tugState.gameState === 'active') {
            const timeRemaining = (tugState.endTime - now) / 1000;
            tugState.timeLeft = Math.max(0, timeRemaining);

            if (tugState.timeLeft <= 0) {
                tugState.gameState = 'finished';
                // Determine winner based on marker position
                if (tugState.markerPos < 0) {
                    tugState.winnerTeam = 'left';
                } else if (tugState.markerPos > 0) {
                    tugState.winnerTeam = 'right';
                } else {
                    tugState.winnerTeam = 'draw';
                }
            }
        }

        // Beat bookkeeping: clients flash on 'beat' changes and align their bar to nextPulseTime
        tugState.beat = this.beatIndex(tugState, now);
        tugState.nextPulseTime = this.pulseTime(tugState, tugState.beat + 1);

        let leftTeamForce = 0;
        let rightTeamForce = 0;

        // Process each player
        tugState.players.forEach((playerState, socketId) => {
            const room = this.lobbyManager.rooms.get(roomCode);
            const roomPlayer = room ? room.players.get(socketId) : null;
            if (roomPlayer && roomPlayer.name) {
                playerState.name = roomPlayer.name; // Sync latest name
            }

            const timeDiff = (now - playerState.lastProcessedTime) / 1000;
            playerState.lastProcessedTime = now;

            // Per-tick feedback flags, set again below if a pull happens
            playerState.pullQuality = 0;
            playerState.mashed = false;

            // Regenerate stamina (real elapsed time)
            playerState.stamina = Math.min(100, playerState.stamina + TUG_CONFIG.STAMINA_REGEN * timeDiff);

            // Each pull is an impulse evaluated at the time it was received
            let playerForce = 0;
            if (playerState.pendingPulls.length > 0) {
                for (const pullTime of playerState.pendingPulls) {
                    playerForce += this.calculatePullForce(tugState, playerState, pullTime);
                }
                playerState.pendingPulls.length = 0;
            }

            if (playerState.team === 'left') {
                leftTeamForce += playerForce;
            } else {
                rightTeamForce += playerForce;
            }
        });

        // Team sync: evaluate every pulse whose timing window closed by now (after the pulls,
        // so a hit received right before the window closed still counts)
        this.closePulseWindows(tugState, now);

        // Team balancing and Comeback bonus
        const leftSize = Math.max(1, tugState.teams.left.length);
        const rightSize = Math.max(1, tugState.teams.right.length);

        // Apply alpha balancing: Force = Force / Size^alpha
        const leftForceNormalized = leftTeamForce / Math.pow(leftSize, TUG_CONFIG.ALPHA_BALANCING);
        const rightForceNormalized = rightTeamForce / Math.pow(rightSize, TUG_CONFIG.ALPHA_BALANCING);

        // Comeback bonus: team losing gets a boost
        let leftFinalForce = leftForceNormalized;
        let rightFinalForce = rightForceNormalized;

        if (tugState.markerPos > 0) { // Right is winning, Left gets bonus
            const bonus = 1 + (Math.abs(tugState.markerPos) / TUG_CONFIG.WIN_DISTANCE) * TUG_CONFIG.COMEBACK_MAX_BONUS;
            leftFinalForce *= bonus;
        } else if (tugState.markerPos < 0) { // Left is winning, Right gets bonus
            const bonus = 1 + (Math.abs(tugState.markerPos) / TUG_CONFIG.WIN_DISTANCE) * TUG_CONFIG.COMEBACK_MAX_BONUS;
            rightFinalForce *= bonus;
        }

        // Apply movement (forces are per-pull impulses, not per-second, so no dt here)
        const netForce = rightFinalForce - leftFinalForce;
        tugState.markerPos += netForce * TUG_CONFIG.ROPE_SENSITIVITY;

        // Clamp and Check for win (early win if pulled all the way)
        if (tugState.markerPos >= TUG_CONFIG.WIN_DISTANCE) {
            tugState.markerPos = TUG_CONFIG.WIN_DISTANCE;
            tugState.gameState = 'finished';
            tugState.winnerTeam = 'right';
        } else if (tugState.markerPos <= -TUG_CONFIG.WIN_DISTANCE) {
            tugState.markerPos = -TUG_CONFIG.WIN_DISTANCE;
            tugState.gameState = 'finished';
            tugState.winnerTeam = 'left';
        }

        return {
            roomCode,
            markerPos: tugState.markerPos,
            gameState: tugState.gameState,
            winnerTeam: tugState.winnerTeam,
            timeLeft: Math.ceil(tugState.timeLeft),
            serverTime: now,
            pulseInterval: TUG_CONFIG.PULSE_INTERVAL,
            greenZoneWindow: TUG_CONFIG.GREEN_ZONE_WINDOW,
            nextPulseTime: tugState.nextPulseTime,
            beat: tugState.beat,
            teams: this.serializeTeams(tugState),
            players: Array.from(tugState.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                team: p.team,
                stamina: p.stamina,
                pullQuality: p.pullQuality,
                streak: p.streak,
                mashed: p.mashed
            }))
        };
    }

    serializeTeams(tugState) {
        const out = {};
        for (const side of ['left', 'right']) {
            const stats = tugState.teamStats[side];
            out[side] = {
                size: tugState.teams[side].length,
                syncCombo: stats.syncCombo,
                syncRatio: stats.syncRatio,
                hits: stats.hits
            };
        }
        return out;
    }

    /**
     * Close every pulse window that ended by `now` (pulseTime + GREEN_ZONE_WINDOW):
     * count the members of each team that landed that pulse, grow or reset the team's
     * sync combo, and reset the streak of players that skipped the pulse.
     */
    closePulseWindows(tugState, now) {
        while (true) {
            const k = tugState.closedPulse + 1;
            if (now < this.pulseTime(tugState, k) + TUG_CONFIG.GREEN_ZONE_WINDOW) break;
            tugState.closedPulse = k;

            for (const side of ['left', 'right']) {
                const members = tugState.teams[side];
                const stats = tugState.teamStats[side];
                let hits = 0;
                for (const id of members) {
                    const p = tugState.players.get(id);
                    if (p && p.hitPulse === k) hits++;
                }
                stats.hits = hits;
                stats.syncRatio = members.length > 0 ? hits / members.length : 0;
                if (members.length > 0 && stats.syncRatio >= TUG_CONFIG.SYNC_MIN_RATIO) {
                    stats.syncCombo++;
                } else {
                    stats.syncCombo = 0;
                }
            }

            tugState.players.forEach(p => {
                if (p.hitPulse !== k) p.streak = 0;
            });
        }
    }

    /**
     * Calculate force of a single pull action received at `pullTime`
     */
    calculatePullForce(tugState, playerState, pullTime) {
        // Timing against the nearest pulse of the anchored schedule
        const k = this.nearestPulse(tugState, pullTime);
        const diff = Math.abs(pullTime - this.pulseTime(tugState, k));

        let quality = 0; // bad
        if (diff <= TUG_CONFIG.GREEN_ZONE_WINDOW / 2) {
            quality = 2; // Perfect
        } else if (diff <= TUG_CONFIG.GREEN_ZONE_WINDOW) {
            quality = 1; // Good
        }

        // Anti-mash: only the first pull per pulse window moves the rope. The window is
        // claimed even without stamina, so a masher's counted pull is always the one at the
        // start of the window (far from the beat), never a lucky one after regenerating.
        if (k === playerState.lastPullPulse) {
            playerState.mashed = true;
            playerState.streak = 0;
            if (playerState.stamina >= TUG_CONFIG.STAMINA_COST) {
                playerState.stamina -= TUG_CONFIG.STAMINA_COST;
            }
            return 0;
        }
        playerState.lastPullPulse = k;

        // Cost of pulling
        if (playerState.stamina < TUG_CONFIG.STAMINA_COST) {
            playerState.streak = 0;
            return 0; // Not enough stamina to pull
        }
        playerState.stamina -= TUG_CONFIG.STAMINA_COST;

        let timingBonus = 0.2; // Default bad pull
        if (quality > 0) {
            timingBonus = quality === 2 ? 1.0 : 0.6;
            playerState.streak++;
            playerState.hitPulse = k;
        } else {
            playerState.streak = 0;
        }
        playerState.pullQuality = Math.max(playerState.pullQuality, quality);

        // Apply stamina factor: Force is reduced if stamina is low
        const staminaFactor = Math.max(0.2, playerState.stamina / 100);

        // Personal streak and team sync (the team bonus lags one pulse by design)
        const streakMult = this.streakMultiplier(playerState.streak);
        const teamMult = this.syncMultiplier(tugState.teamStats[playerState.team].syncCombo);

        return TUG_CONFIG.BASE_PULL_POWER * timingBonus * staminaFactor * streakMult * teamMult;
    }

    /**
     * Record a pull action from a player (evaluated on the next tick with this timestamp)
     */
    handlePull(playerId, roomCode) {
        const tugState = this.tugStates.get(roomCode);
        if (!tugState || tugState.gameState !== 'active') return;

        const playerState = tugState.players.get(playerId);
        if (playerState) {
            const now = Date.now();
            playerState.lastPullTime = now;
            // Cap the queue so a flooding client cannot grow it between ticks
            if (playerState.pendingPulls.length < 8) {
                playerState.pendingPulls.push(now);
            }
        }
    }

    cleanup(roomCode) {
        this.tugStates.delete(roomCode);
    }
}

export { TUG_CONFIG };
export default TugStateManager;
