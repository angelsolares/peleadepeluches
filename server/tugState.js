/**
 * Tug of War (Guerra de Cuerda) State Manager
 * Server-side game state for Tug of War mode
 * Handles rhythm, stamina, and team force calculations
 */

const TUG_CONFIG = {
    WIN_DISTANCE: 100,      // Distance to win
    ROPE_SENSITIVITY: 0.5,  // How much force moves the rope
    STAMINA_REGEN: 15,      // Stamina regen per second
    STAMINA_COST: 20,       // Stamina cost per pull
    BASE_PULL_POWER: 10,    // Base force per player
    ALPHA_BALANCING: 0.85,  // Team size compensation factor
    PULSE_INTERVAL: 1500,   // Rhythm pulse interval (ms)
    GREEN_ZONE_WINDOW: 300, // Timing window for perfect pull (ms)
    COMEBACK_MAX_BONUS: 0.15 // 15% max bonus for team losing
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

        const tugState = {
            roomCode,
            players: new Map(),
            markerPos: 0,           // -100 (left win) to 100 (right win)
            startTime: Date.now() + 3000, // 3 second countdown
            nextPulseTime: Date.now() + 3000 + TUG_CONFIG.PULSE_INTERVAL,
            gameState: 'countdown', // 'countdown', 'active', 'finished'
            winnerTeam: null,       // 'left' or 'right'
            countdown: 3,
            teams: {
                left: [],
                right: []
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
            pendingPull: false,
            pullQuality: 0 // 0: fail, 1: good, 2: perfect
        };
    }

    /**
     * Process a game tick
     */
    processTick(roomCode) {
        const tugState = this.tugStates.get(roomCode);
        if (!tugState || tugState.gameState === 'finished') return null;

        const now = Date.now();
        const dt = 1 / 60; // Assumed fixed delta for simplicity in calculations

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
                players: Array.from(tugState.players.values()).map(p => ({
                    id: p.id,
                    name: p.name,
                    team: p.team,
                    stamina: p.stamina,
                    pullQuality: 0
                }))
            };
        }

        // Check for pulse (rhythm)
        if (now >= tugState.nextPulseTime) {
            tugState.nextPulseTime = now + TUG_CONFIG.PULSE_INTERVAL;
            // Notify clients of pulse if needed, though they usually track it locally
        }

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

            // Reset pull quality for this tick unless a pull happens
            playerState.pullQuality = 0;

            // Regenerate stamina
            playerState.stamina = Math.min(100, playerState.stamina + TUG_CONFIG.STAMINA_REGEN * timeDiff);

            // Calculate player force for this tick if they pulled
            let playerForce = 0;
            if (playerState.pendingPull) {
                playerForce = this.calculatePullForce(tugState, playerState, now);
                playerState.pendingPull = false;
            }

            if (playerState.team === 'left') {
                leftTeamForce += playerForce;
            } else {
                rightTeamForce += playerForce;
            }
        });

        // Team balancing and Comeback bonus
        const leftSize = tugState.teams.left.length;
        const rightSize = tugState.teams.right.length;

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

        // Apply movement
        const netForce = rightFinalForce - leftFinalForce;
        tugState.markerPos += netForce * TUG_CONFIG.ROPE_SENSITIVITY;

        // Clamp and Check for win
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
            nextPulseTime: tugState.nextPulseTime,
            players: Array.from(tugState.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                team: p.team,
                stamina: p.stamina,
                pullQuality: p.pullQuality
            }))
        };
    }

    /**
     * Calculate force of a single pull action
     */
    calculatePullForce(tugState, playerState, now) {
        // Cost of pulling
        if (playerState.stamina < TUG_CONFIG.STAMINA_COST) {
            return 0; // Not enough stamina to pull
        }
        playerState.stamina -= TUG_CONFIG.STAMINA_COST;

        // Check timing relative to pulse
        const pulseDiff = Math.abs(now - tugState.nextPulseTime);
        const prevPulseTime = tugState.nextPulseTime - TUG_CONFIG.PULSE_INTERVAL;
        const prevPulseDiff = Math.abs(now - prevPulseTime);
        
        const minDiff = Math.min(pulseDiff, prevPulseDiff);
        
        let timingBonus = 0.2; // Default bad pull
        playerState.pullQuality = 0;

        if (minDiff <= TUG_CONFIG.GREEN_ZONE_WINDOW / 2) {
            timingBonus = 1.0; // Perfect
            playerState.pullQuality = 2;
        } else if (minDiff <= TUG_CONFIG.GREEN_ZONE_WINDOW) {
            timingBonus = 0.6; // Good
            playerState.pullQuality = 1;
        }

        // Apply stamina factor: Force is reduced if stamina is low
        const staminaFactor = Math.max(0.2, playerState.stamina / 100);
        
        return TUG_CONFIG.BASE_PULL_POWER * timingBonus * staminaFactor;
    }

    /**
     * Record a pull action from a player
     */
    handlePull(playerId, roomCode) {
        const tugState = this.tugStates.get(roomCode);
        if (!tugState || tugState.gameState !== 'active') return;

        const playerState = tugState.players.get(playerId);
        if (playerState) {
            playerState.pendingPull = true;
            playerState.lastPullTime = Date.now();
        }
    }

    cleanup(roomCode) {
        this.tugStates.delete(roomCode);
    }
}

export default TugStateManager;

