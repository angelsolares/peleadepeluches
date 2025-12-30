/**
 * Balloon (Infla el Globo) State Manager
 * Server-side game state for Balloon mode
 */

const BALLOON_CONFIG = {
    TARGET_SIZE: 100,       // UI target
    INFLATE_AMOUNT: 1,      // A bit more air to compensate for fast deflation
    DEFLATE_RATE: 2.0,     // Much faster deflation (difficulty)
    COOLDOWN: 50,           // 50ms cooldown
    GAME_DURATION: 60,      // Seconds
};

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

        const balloonState = {
            roomCode,
            players: new Map(),
            startTime: Date.now(),
            endTime: Date.now() + (BALLOON_CONFIG.GAME_DURATION * 1000),
            gameState: 'active',    // 'active', 'finished'
            winner: null,
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
                burstSize: 85 + Math.random() * 10, // Burst between 85% and 95%
                lastPumpTime: 0,
                isDQ: false // Disqualified if they burst
            });
        });

        this.balloonStates.set(roomCode, balloonState);
        return balloonState;
    }

    /**
     * Process a game tick
     */
    processTick(roomCode) {
        const state = this.balloonStates.get(roomCode);
        if (!state || state.gameState !== 'active') return null;

        const now = Date.now();
        const dt = 1 / 60;

        // Update timer
        state.timeLeft = Math.max(0, (state.endTime - now) / 1000);

        // Apply slow deflation to all active players
        state.players.forEach((p) => {
            if (!p.isDQ && p.balloonSize > 0) {
                p.balloonSize = Math.max(0, p.balloonSize - BALLOON_CONFIG.DEFLATE_RATE * dt);
            }
        });

        // Check if time ran out
        if (state.timeLeft <= 0) {
            let maxProgress = -1;
            let winnerPlayer = null;

            state.players.forEach(p => {
                if (!p.isDQ && p.balloonSize > maxProgress) {
                    maxProgress = p.balloonSize;
                    winnerPlayer = p;
                }
            });

            state.gameState = 'finished';
            if (winnerPlayer) {
                state.winner = {
                    id: winnerPlayer.id,
                    name: winnerPlayer.name
                };
            }
        }

        return {
            roomCode,
            gameState: state.gameState,
            winner: state.winner,
            timeLeft: Math.ceil(state.timeLeft),
            players: Array.from(state.players.values()).map(p => ({
                ...p,
                progress: p.isDQ ? 100 : Math.min(100, (p.balloonSize / 100) * 100)
            }))
        };
    }

    /**
     * Handle inflation pump from a player
     */
    handleInflate(playerId, roomCode) {
        const state = this.balloonStates.get(roomCode);
        if (!state || state.gameState !== 'active') return;

        const player = state.players.get(playerId);
        if (!player || player.isDQ) return;

        const now = Date.now();
        if (now - player.lastPumpTime < BALLOON_CONFIG.COOLDOWN) return;

        player.lastPumpTime = now;
        player.balloonSize += BALLOON_CONFIG.INFLATE_AMOUNT*100;

        // Check for burst (Disqualification)
        if (player.balloonSize >= player.burstSize) {
            player.balloonSize = player.burstSize;
            player.isDQ = true;
            // Removed early finish logic - wait for timer to reach 0
        }
    }

    cleanup(roomCode) {
        this.balloonStates.delete(roomCode);
    }
}

export default BalloonStateManager;

