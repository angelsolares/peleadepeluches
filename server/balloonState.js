/**
 * Balloon (Infla el Globo) State Manager
 * Server-side game state for Balloon mode
 */

const BALLOON_CONFIG = {
    TARGET_SIZE: 100,       // Size to win
    INFLATE_AMOUNT: 6,      // Increased from 4
    DEFLATE_RATE: 2.0,      // Decreased from 2.5
    COOLDOWN: 50,           // Decreased from 100
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
                burstSize: 95 + Math.random() * 10, // Burst between 95% and 105%
                lastPumpTime: 0
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

        // Apply slow deflation to all players
        state.players.forEach((p) => {
            if (p.balloonSize > 0) {
                p.balloonSize = Math.max(0, p.balloonSize - BALLOON_CONFIG.DEFLATE_RATE * dt);
            }
        });

        // Check if time ran out
        if (state.timeLeft <= 0) {
            let maxProgress = -1;
            let winnerPlayer = null;

            state.players.forEach(p => {
                if (p.balloonSize > maxProgress) {
                    maxProgress = p.balloonSize;
                    winnerPlayer = p;
                }
            });

            if (winnerPlayer) {
                state.gameState = 'finished';
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
                progress: Math.min(100, (p.balloonSize / p.burstSize) * 100)
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
        if (!player) return;

        const now = Date.now();
        if (now - player.lastPumpTime < BALLOON_CONFIG.COOLDOWN) return;

        player.lastPumpTime = now;
        player.balloonSize += BALLOON_CONFIG.INFLATE_AMOUNT;

        // Check for burst (win condition)
        if (player.balloonSize >= player.burstSize) {
            player.balloonSize = player.burstSize;
            state.gameState = 'finished';
            state.winner = {
                id: player.id,
                name: player.name
            };
        }
    }

    cleanup(roomCode) {
        this.balloonStates.delete(roomCode);
    }
}

export default BalloonStateManager;

