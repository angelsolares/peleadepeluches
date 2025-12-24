/**
 * Race State Manager
 * Server-side game state for Race mode
 * Handles player tapping, speed, and race progression
 */

const RACE_CONFIG = {
    TRACK_LENGTH: 100,
    MAX_PLAYERS: 8,
    
    // Movement physics
    TAP_BOOST: 0.8,         // Speed boost per valid alternating tap
    MAX_SPEED: 15,          // Maximum speed
    DECELERATION: 0.92,     // Speed decay per tick
    
    // Tap validation
    TAP_COOLDOWN: 50,       // Minimum ms between taps
    WRONG_TAP_PENALTY: 0.3, // Speed reduction for wrong tap
    
    // Countdown
    COUNTDOWN_DURATION: 3   // Seconds
};

class RaceStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.raceStates = new Map();
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
            countdownValue: RACE_CONFIG.COUNTDOWN_DURATION
        };
        
        // Initialize player states
        let lane = 0;
        room.players.forEach((player, socketId) => {
            raceState.players.set(socketId, {
                id: socketId,
                name: player.name,
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
        
        console.log(`[Race] Race started for room ${roomCode}!`);
        
        io.to(roomCode).emit('race-start');
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
     * Process game tick - update positions
     */
    processTick(roomCode, delta) {
        const raceState = this.raceStates.get(roomCode);
        if (!raceState || raceState.state !== 'racing') return null;
        
        const players = [];
        
        raceState.players.forEach((player, socketId) => {
            if (!player.finished) {
                // Apply deceleration
                player.speed *= RACE_CONFIG.DECELERATION;
                
                // Minimum speed threshold
                if (player.speed < 0.1) player.speed = 0;
                
                // Update position
                player.position += player.speed * delta;
                
                // Check finish
                if (player.position >= RACE_CONFIG.TRACK_LENGTH) {
                    player.position = RACE_CONFIG.TRACK_LENGTH;
                    player.finished = true;
                    player.finishTime = Date.now() - raceState.startTime;
                    player.finishPosition = raceState.finishOrder.length + 1;
                    raceState.finishOrder.push(socketId);
                    
                    console.log(`[Race] ${player.name} finished in position ${player.finishPosition}!`);
                }
            }
            
            players.push({
                id: player.id,
                name: player.name,
                position: player.position,
                speed: player.speed,
                finished: player.finished,
                finishTime: player.finishTime,
                finishPosition: player.finishPosition
            });
        });
        
        // Check if race is over (all finished or first finished)
        const finishedCount = raceState.finishOrder.length;
        const totalPlayers = raceState.players.size;
        
        let raceOver = false;
        if (finishedCount > 0 && finishedCount === totalPlayers) {
            raceOver = true;
        }
        
        return {
            roomCode,
            state: raceState.state,
            players,
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
     * Remove race state
     */
    removeRace(roomCode) {
        this.raceStates.delete(roomCode);
    }
}

export { RaceStateManager, RACE_CONFIG };

