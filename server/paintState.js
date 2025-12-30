/**
 * Paint State Manager
 * Server-side game state and grid for Paint the Floor mode
 */

const PAINT_CONFIG = {
    // Grid dimensions
    GRID_SIZE: 60,         // 60x60 cells
    WORLD_SIZE: 20,        // Total width/depth in world units (18 ring + margin)
    
    // Physics (borrowed from Arena)
    MOVE_SPEED: 7,         
    RUN_SPEED: 11,         
    FRICTION: 0.85,
    
    // Game timing
    ROUND_DURATION: 90000, // 90 seconds
    COUNTDOWN_DURATION: 3000,
};

class PaintStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.paintStates = new Map();
    }

    /**
     * Initialize paint state for a room
     */
    initializePaint(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;

        const players = new Map();
        let index = 0;
        const totalPlayers = room.players.size;

        room.players.forEach((player, socketId) => {
            const angle = (index / totalPlayers) * Math.PI * 2;
            const radius = 6;
            players.set(socketId, {
                id: player.id,
                name: player.name,
                number: player.number,
                color: player.color,
                position: { 
                    x: Math.cos(angle) * radius, 
                    y: 0.5, 
                    z: Math.sin(angle) * radius 
                },
                velocity: { x: 0, y: 0, z: 0 },
                facingAngle: angle + Math.PI,
                score: 0,
                isEliminated: false,
                input: { left: false, right: false, up: false, down: false, run: false }
            });
            index++;
        });

        const grid = new Int8Array(PAINT_CONFIG.GRID_SIZE * PAINT_CONFIG.GRID_SIZE).fill(-1);

        const paintState = {
            roomCode,
            players,
            grid, // Flattened array of player indices (or -1 for none)
            startTime: Date.now() + PAINT_CONFIG.COUNTDOWN_DURATION,
            endTime: Date.now() + PAINT_CONFIG.COUNTDOWN_DURATION + PAINT_CONFIG.ROUND_DURATION,
            roundState: 'countdown', // 'countdown', 'active', 'finished'
            lastScoreUpdate: 0
        };

        this.paintStates.set(roomCode, paintState);
        return paintState;
    }

    /**
     * Process a game tick
     */
    processTick(roomCode) {
        const state = this.paintStates.get(roomCode);
        if (!state) return null;

        const now = Date.now();
        const delta = 1 / 60;

        if (state.roundState === 'countdown') {
            if (now >= state.startTime) {
                state.roundState = 'active';
            }
        }

        if (state.roundState === 'active') {
            if (now >= state.endTime) {
                state.roundState = 'finished';
                return this.getFinalResults(state);
            }

            // Update movements and painting
            state.players.forEach((player, socketId) => {
                const room = this.lobbyManager.rooms.get(roomCode);
                const roomPlayer = room ? room.players.get(socketId) : null;
                if (roomPlayer) {
                    player.input = { ...roomPlayer.input };
                }

                this.updatePlayerMovement(player, delta);
                this.paintCell(state, player);
            });

            // Periodically calculate scores (every 500ms)
            if (now - state.lastScoreUpdate > 500) {
                this.calculateScores(state);
                state.lastScoreUpdate = now;
            }
        }

        return {
            roomCode,
            roundState: state.roundState,
            timeLeft: Math.max(0, state.endTime - now),
            players: Array.from(state.players.values()).map(p => ({
                id: p.id,
                position: p.position,
                facingAngle: p.facingAngle,
                score: p.score,
                color: p.color
            })),
            // We only send grid updates when cells change, or in a compressed format if needed.
            // For now, let's keep it simple and send grid changes via a different mechanism if possible,
            // or just include it in the tick if it's small enough. 
            // 60x60 = 3600 bytes, which is fine for a few players.
            grid: state.grid 
        };
    }

    updatePlayerMovement(player, delta) {
        let dirX = 0, dirZ = 0;
        if (player.input.left) dirX -= 1;
        if (player.input.right) dirX += 1;
        if (player.input.up) dirZ -= 1;
        if (player.input.down) dirZ += 1;

        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (length > 0) {
            dirX /= length;
            dirZ /= length;
            const speed = player.input.run ? PAINT_CONFIG.RUN_SPEED : PAINT_CONFIG.MOVE_SPEED;
            player.velocity.x = dirX * speed;
            player.velocity.z = dirZ * speed;
            player.facingAngle = Math.atan2(dirX, dirZ);
        }

        player.velocity.x *= PAINT_CONFIG.FRICTION;
        player.velocity.z *= PAINT_CONFIG.FRICTION;

        player.position.x += player.velocity.x * delta;
        player.position.z += player.velocity.z * delta;

        // Keep within bounds
        const halfWorld = PAINT_CONFIG.WORLD_SIZE / 2 - 0.5;
        player.position.x = Math.max(-halfWorld, Math.min(halfWorld, player.position.x));
        player.position.z = Math.max(-halfWorld, Math.min(halfWorld, player.position.z));
    }

    paintCell(state, player) {
        // Convert world position to grid coordinates
        const halfWorld = PAINT_CONFIG.WORLD_SIZE / 2;
        const gx = Math.floor(((player.position.x + halfWorld) / PAINT_CONFIG.WORLD_SIZE) * PAINT_CONFIG.GRID_SIZE);
        const gz = Math.floor(((player.position.z + halfWorld) / PAINT_CONFIG.WORLD_SIZE) * PAINT_CONFIG.GRID_SIZE);

        if (gx >= 0 && gx < PAINT_CONFIG.GRID_SIZE && gz >= 0 && gz < PAINT_CONFIG.GRID_SIZE) {
            const index = gz * PAINT_CONFIG.GRID_SIZE + gx;
            // Use player number as the value in the grid
            state.grid[index] = player.number;
        }
    }

    calculateScores(state) {
        const counts = new Map();
        state.players.forEach(p => counts.set(p.number, 0));

        for (let i = 0; i < state.grid.length; i++) {
            const val = state.grid[i];
            if (val !== -1) {
                counts.set(val, (counts.get(val) || 0) + 1);
            }
        }

        const totalCells = PAINT_CONFIG.GRID_SIZE * PAINT_CONFIG.GRID_SIZE;
        state.players.forEach(p => {
            p.score = Math.round((counts.get(p.number) / totalCells) * 1000) / 10;
        });
    }

    getFinalResults(state) {
        this.calculateScores(state);
        const results = Array.from(state.players.values())
            .map(p => ({
                id: p.id,
                name: p.name,
                number: p.number,
                score: p.score,
                color: p.color
            }))
            .sort((a, b) => b.score - a.score);

        return {
            roomCode: state.roomCode,
            roundState: 'finished',
            winner: results[0],
            results
        };
    }

    cleanup(roomCode) {
        this.paintStates.delete(roomCode);
    }
}

export default PaintStateManager;

