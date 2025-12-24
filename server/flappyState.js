/**
 * FlappyStateManager - Server-side state management for Flappy mode
 */

// Game Configuration
const FLAPPY_CONFIG = {
    gravity: -35,
    flapStrength: 14,
    gameSpeed: 8,
    pipeGap: 5.5,
    pipeWidth: 2,
    pipeSpacing: 10,
    groundY: -8,
    ceilingY: 10,
    playerStartX: -5,
    playerRadius: 0.8,
    countdownDuration: 3,
    maxPlayers: 4,
    tickRate: 60,
    pipeStartX: 15
};

class FlappyStateManager {
    constructor() {
        this.games = new Map(); // roomCode -> gameState
    }
    
    initializeGame(roomCode, players) {
        const playerStates = {};
        let lane = 0;
        
        for (const player of players) {
            playerStates[player.id] = {
                id: player.id,
                name: player.characterName || player.name || 'Player',
                character: player.character,
                lane: lane,
                x: FLAPPY_CONFIG.playerStartX,
                y: 0,
                velocity: 0,
                isAlive: true,
                distance: 0
            };
            lane++;
        }
        
        const gameState = {
            roomCode,
            players: playerStates,
            pipes: [],
            nextPipeId: 0,
            distance: 0,
            gameStarted: false,
            gameOver: false,
            lastPipeX: FLAPPY_CONFIG.pipeStartX,
            startTime: null
        };
        
        this.games.set(roomCode, gameState);
        return gameState;
    }
    
    startCountdown(roomCode, io) {
        const game = this.games.get(roomCode);
        if (!game) return;
        
        let count = FLAPPY_CONFIG.countdownDuration;
        
        const countdownInterval = setInterval(() => {
            io.to(roomCode).emit('flappy-countdown', { count });
            
            if (count <= 0) {
                clearInterval(countdownInterval);
                this.startGame(roomCode, io);
            }
            count--;
        }, 1000);
    }
    
    startGame(roomCode, io) {
        const game = this.games.get(roomCode);
        if (!game) return;
        
        game.gameStarted = true;
        game.startTime = Date.now();
        
        // Spawn initial pipes
        this.spawnPipe(game);
        this.spawnPipe(game);
        this.spawnPipe(game);
        
        io.to(roomCode).emit('flappy-start');
        
        // Start game loop
        this.startGameLoop(roomCode, io);
    }
    
    startGameLoop(roomCode, io) {
        const game = this.games.get(roomCode);
        if (!game) return;
        
        const tickInterval = 1000 / FLAPPY_CONFIG.tickRate;
        const deltaTime = tickInterval / 1000;
        
        game.loopInterval = setInterval(() => {
            if (!game.gameStarted || game.gameOver) {
                clearInterval(game.loopInterval);
                return;
            }
            
            this.processTick(roomCode, deltaTime, io);
        }, tickInterval);
    }
    
    processTick(roomCode, deltaTime, io) {
        const game = this.games.get(roomCode);
        if (!game || !game.gameStarted) return;
        
        let aliveCount = 0;
        
        // Update each player
        for (const playerId in game.players) {
            const player = game.players[playerId];
            
            if (!player.isAlive) continue;
            aliveCount++;
            
            // Apply gravity
            player.velocity += FLAPPY_CONFIG.gravity * deltaTime;
            player.y += player.velocity * deltaTime;
            
            // Check ground/ceiling collision
            if (player.y <= FLAPPY_CONFIG.groundY + FLAPPY_CONFIG.playerRadius) {
                player.y = FLAPPY_CONFIG.groundY + FLAPPY_CONFIG.playerRadius;
                this.killPlayer(game, playerId, io);
                continue;
            }
            
            if (player.y >= FLAPPY_CONFIG.ceilingY - FLAPPY_CONFIG.playerRadius) {
                player.y = FLAPPY_CONFIG.ceilingY - FLAPPY_CONFIG.playerRadius;
                player.velocity = 0;
            }
            
            // Check pipe collision
            for (const pipe of game.pipes) {
                if (this.checkPipeCollision(player, pipe)) {
                    this.killPlayer(game, playerId, io);
                    break;
                }
            }
            
            // Update distance
            player.distance = game.distance;
        }
        
        // Move pipes and spawn new ones
        for (const pipe of game.pipes) {
            pipe.x -= FLAPPY_CONFIG.gameSpeed * deltaTime;
        }
        
        // Remove pipes that are off screen
        game.pipes = game.pipes.filter(pipe => pipe.x > -15);
        
        // Spawn new pipes
        if (game.pipes.length === 0 || 
            game.pipes[game.pipes.length - 1].x < FLAPPY_CONFIG.pipeStartX - FLAPPY_CONFIG.pipeSpacing) {
            this.spawnPipe(game);
        }
        
        // Update game distance
        game.distance += FLAPPY_CONFIG.gameSpeed * deltaTime;
        
        // Emit game state
        io.to(roomCode).emit('flappy-state', {
            players: game.players,
            pipes: game.pipes,
            distance: game.distance
        });
        
        // Check for game over
        if (aliveCount === 0) {
            this.endGame(roomCode, io);
        } else if (aliveCount === 1 && Object.keys(game.players).length > 1) {
            // Last player standing wins after a delay
            if (!game.lastStandingTime) {
                game.lastStandingTime = Date.now();
            } else if (Date.now() - game.lastStandingTime > 3000) {
                this.endGame(roomCode, io);
            }
        }
    }
    
    spawnPipe(game) {
        // Calculate gap position (random within safe bounds)
        const minGapY = FLAPPY_CONFIG.groundY + FLAPPY_CONFIG.pipeGap / 2 + 2;
        const maxGapY = FLAPPY_CONFIG.ceilingY - FLAPPY_CONFIG.pipeGap / 2 - 2;
        const gapY = minGapY + Math.random() * (maxGapY - minGapY);
        
        const pipeX = game.pipes.length === 0 
            ? FLAPPY_CONFIG.pipeStartX 
            : game.pipes[game.pipes.length - 1].x + FLAPPY_CONFIG.pipeSpacing;
        
        game.pipes.push({
            id: game.nextPipeId++,
            x: pipeX,
            gapY: gapY
        });
    }
    
    checkPipeCollision(player, pipe) {
        const playerX = FLAPPY_CONFIG.playerStartX;
        const playerY = player.y;
        const radius = FLAPPY_CONFIG.playerRadius;
        
        // Check if player is within pipe X bounds
        const pipeLeft = pipe.x - FLAPPY_CONFIG.pipeWidth / 2;
        const pipeRight = pipe.x + FLAPPY_CONFIG.pipeWidth / 2;
        
        if (playerX + radius < pipeLeft || playerX - radius > pipeRight) {
            return false; // Not within pipe X range
        }
        
        // Check if player is within gap
        const gapTop = pipe.gapY + FLAPPY_CONFIG.pipeGap / 2;
        const gapBottom = pipe.gapY - FLAPPY_CONFIG.pipeGap / 2;
        
        if (playerY - radius < gapBottom || playerY + radius > gapTop) {
            return true; // Hit pipe
        }
        
        return false;
    }
    
    processFlap(roomCode, playerId) {
        const game = this.games.get(roomCode);
        if (!game || !game.gameStarted) return;
        
        const player = game.players[playerId];
        if (!player || !player.isAlive) return;
        
        // Apply flap
        player.velocity = FLAPPY_CONFIG.flapStrength;
    }
    
    killPlayer(game, playerId, io) {
        const player = game.players[playerId];
        if (!player || !player.isAlive) return;
        
        player.isAlive = false;
        
        io.to(game.roomCode).emit('flappy-player-died', {
            playerId: playerId,
            name: player.name,
            distance: player.distance
        });
    }
    
    endGame(roomCode, io) {
        const game = this.games.get(roomCode);
        if (!game) return;
        
        game.gameOver = true;
        game.gameStarted = false;
        
        if (game.loopInterval) {
            clearInterval(game.loopInterval);
        }
        
        // Calculate results
        const results = Object.values(game.players).map(player => ({
            id: player.id,
            name: player.name,
            distance: player.distance,
            isAlive: player.isAlive
        }));
        
        results.sort((a, b) => b.distance - a.distance);
        
        // Find winner (last alive or furthest distance)
        const winner = results.find(p => p.isAlive) || results[0];
        
        io.to(roomCode).emit('flappy-game-over', {
            winner: winner,
            results: results
        });
    }
    
    removeGame(roomCode) {
        const game = this.games.get(roomCode);
        if (game && game.loopInterval) {
            clearInterval(game.loopInterval);
        }
        this.games.delete(roomCode);
    }
    
    getGame(roomCode) {
        return this.games.get(roomCode);
    }
}

export { FlappyStateManager, FLAPPY_CONFIG };

