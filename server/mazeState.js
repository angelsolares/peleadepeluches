/**
 * Baby Maze State Manager
 */

const MAZE_CONFIG = {
    SIZE: 15, // 15x15 grid
    GAME_DURATION: 120, // 2 minutes
    FINISH_X: 14,
    FINISH_Z: 14,
    START_X: 0,
    START_Z: 0
};

class MazeStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.mazeStates = new Map();
    }

    initializeMaze(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;

        const mazeGrid = this.generateMaze(MAZE_CONFIG.SIZE, MAZE_CONFIG.SIZE);
        
        const state = {
            roomCode,
            grid: mazeGrid,
            size: MAZE_CONFIG.SIZE,
            players: new Map(),
            startTime: Date.now(),
            endTime: Date.now() + (MAZE_CONFIG.GAME_DURATION * 1000),
            gameState: 'active',
            winners: [] // Order of finishing
        };

        room.players.forEach(player => {
            state.players.set(player.id, {
                id: player.id,
                name: player.name,
                color: player.color,
                x: MAZE_CONFIG.START_X,
                z: MAZE_CONFIG.START_Z,
                finished: false,
                finishTime: null
            });
        });

        this.mazeStates.set(roomCode, state);
        return state;
    }

    // Simple DFS Maze Generation
    generateMaze(width, height) {
        const grid = Array(height).fill().map(() => Array(width).fill(1)); // 1 = wall, 0 = path
        
        const walk = (x, y) => {
            grid[y][x] = 0;
            
            const dirs = [[0, 2], [2, 0], [0, -2], [-2, 0]].sort(() => Math.random() - 0.5);
            
            for (const [dx, dy] of dirs) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height && grid[ny][nx] === 1) {
                    grid[y + dy/2][x + dx/2] = 0;
                    walk(nx, ny);
                }
            }
        };

        walk(0, 0);
        grid[MAZE_CONFIG.FINISH_Z][MAZE_CONFIG.FINISH_X] = 0; // Ensure finish is reachable
        // Ensure finish has a path to it if DFS missed it
        if (grid[MAZE_CONFIG.FINISH_Z-1][MAZE_CONFIG.FINISH_X] === 1 && grid[MAZE_CONFIG.FINISH_Z][MAZE_CONFIG.FINISH_X-1] === 1) {
            grid[MAZE_CONFIG.FINISH_Z-1][MAZE_CONFIG.FINISH_X] = 0;
        }

        return grid;
    }

    processTick(roomCode) {
        const state = this.mazeStates.get(roomCode);
        if (!state) return null;

        const now = Date.now();
        state.timeLeft = Math.max(0, (state.endTime - now) / 1000);

        if (state.gameState === 'active') {
            if (state.timeLeft <= 0) {
                state.gameState = 'finished';
            }

            // Process movement for all players
            const room = this.lobbyManager.rooms.get(roomCode);
            if (room) {
                state.players.forEach(player => {
                    if (player.finished) return;
                    
                    const lobbyPlayer = room.players.get(player.id);
                    if (!lobbyPlayer || !lobbyPlayer.input) return;

                    let nx = player.x;
                    let nz = player.z;
                    const moveSpeed = 0.15; // Adjusted for 30fps

                    if (lobbyPlayer.input.up) nz -= moveSpeed;
                    if (lobbyPlayer.input.down) nz += moveSpeed;
                    if (lobbyPlayer.input.left) nx -= moveSpeed;
                    if (lobbyPlayer.input.right) nx += moveSpeed;

                    // Simple collision detection
                    const gridX = Math.round(nx);
                    const gridZ = Math.round(nz);

                    if (gridX >= 0 && gridX < state.size && gridZ >= 0 && gridZ < state.size) {
                        if (state.grid[gridZ][gridX] === 0) {
                            player.x = nx;
                            player.z = nz;
                        }
                    }

                    // Check finish
                    if (Math.abs(player.x - MAZE_CONFIG.FINISH_X) < 0.5 && Math.abs(player.z - MAZE_CONFIG.FINISH_Z) < 0.5) {
                        player.finished = true;
                        player.finishTime = Date.now();
                        state.winners.push({ id: player.id, name: player.name });

                        // Check if everyone finished
                        const allFinished = Array.from(state.players.values()).every(p => p.finished);
                        if (allFinished) {
                            state.gameState = 'finished';
                        }
                    }
                });
            }
        }

        return {
            roomCode,
            gameState: state.gameState,
            grid: state.grid,
            size: state.size,
            timeLeft: Math.ceil(state.timeLeft),
            players: Array.from(state.players.values()),
            winners: state.winners
        };
    }

    handleMove(playerId, roomCode, direction) {
        // Now handled in processTick
    }

    cleanup(roomCode) {
        this.mazeStates.delete(roomCode);
    }
}

export default MazeStateManager;

