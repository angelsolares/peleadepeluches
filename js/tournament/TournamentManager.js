/**
 * TournamentManager - Shared tournament logic for all game modes
 * Handles round tracking, winner display, localStorage persistence, and UI overlays
 */

const STORAGE_KEY = 'peluches_tournament';

class TournamentManager {
    constructor(socket, gameMode) {
        this.socket = socket;
        this.gameMode = gameMode;
        this.tournamentRounds = 1;
        this.currentRound = 1;
        this.roundWinners = [];
        this.playerScores = {};
        this.isActive = false;
        
        // UI Elements (will be set up when needed)
        this.hudElement = null;
        this.roundEndOverlay = null;
        this.tournamentEndOverlay = null;
        
        this.setupSocketEvents();
        this.setupUIElements();
    }
    
    setupSocketEvents() {
        if (!this.socket) return;
        
        // Listen for tournament config from server
        this.socket.on('tournament-config', (data) => {
            console.log('[Tournament] Config received:', data);
            this.tournamentRounds = data.tournamentRounds;
            this.currentRound = data.currentRound || 1;
            this.isActive = this.tournamentRounds > 1;
            this.updateHUD();
        });
        
        // Listen for round ended
        this.socket.on('round-ended', (data) => {
            console.log('[Tournament] Round ended:', data);
            this.handleRoundEnded(data);
        });
        
        // Listen for tournament ended
        this.socket.on('tournament-ended', (data) => {
            console.log('[Tournament] Tournament ended:', data);
            this.handleTournamentEnded(data);
        });
        
        // Listen for round starting
        this.socket.on('round-starting', (data) => {
            console.log('[Tournament] Round starting:', data);
            this.currentRound = data.round;
            this.hideRoundEndOverlay();
            this.updateHUD();
        });
        
        // Listen for game started to update tournament state
        this.socket.on('game-started', (data) => {
            if (data.tournamentRounds) {
                this.tournamentRounds = data.tournamentRounds;
                this.currentRound = data.currentRound || 1;
                this.playerScores = data.playerScores || {};
                this.isActive = this.tournamentRounds > 1;
                this.updateHUD();
                this.saveToLocalStorage();
            }
        });
    }
    
    setupUIElements() {
        this.hudElement = document.getElementById('tournament-hud');
        this.roundEndOverlay = document.getElementById('round-end-overlay');
        this.tournamentEndOverlay = document.getElementById('tournament-end-overlay');
    }
    
    /**
     * Set tournament rounds (called from UI)
     */
    setRounds(rounds) {
        this.tournamentRounds = rounds;
        this.isActive = rounds > 1;
        
        if (this.socket) {
            this.socket.emit('set-tournament-rounds', rounds);
        }
    }
    
    /**
     * Handle round ended event
     */
    handleRoundEnded(data) {
        this.playerScores = data.playerScores || {};
        this.roundWinners.push({
            round: data.currentRound,
            winnerName: data.roundWinner,
            winnerId: data.roundWinnerId
        });
        
        this.saveToLocalStorage();
        this.showRoundEndOverlay(data);
    }
    
    /**
     * Handle tournament ended event
     */
    handleTournamentEnded(data) {
        this.playerScores = data.playerScores || {};
        this.hideRoundEndOverlay();
        this.showTournamentEndOverlay(data);
        this.clearLocalStorage();
    }
    
    /**
     * Show round end overlay with countdown
     */
    showRoundEndOverlay(data) {
        if (!this.roundEndOverlay) return;
        
        // Update content
        const roundNumber = this.roundEndOverlay.querySelector('#round-number');
        const roundWinner = this.roundEndOverlay.querySelector('#round-winner');
        const roundScores = this.roundEndOverlay.querySelector('#round-scores');
        const countdownEl = this.roundEndOverlay.querySelector('#countdown-number') || 
                           this.roundEndOverlay.querySelector('#countdown-timer');
        
        if (roundNumber) roundNumber.textContent = data.currentRound;
        if (roundWinner) roundWinner.textContent = `¡${data.roundWinner} GANA!`;
        
        // Build scores display
        if (roundScores && data.playerScores) {
            roundScores.innerHTML = this.buildScoresHTML(data.playerScores);
        }
        
        // Show overlay
        this.roundEndOverlay.classList.remove('hidden');
        
        // Start countdown
        let countdown = 5;
        if (countdownEl) countdownEl.textContent = countdown;
        
        const countdownInterval = setInterval(() => {
            countdown--;
            if (countdownEl) countdownEl.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                // Overlay will be hidden by round-starting event
            }
        }, 1000);
    }
    
    /**
     * Hide round end overlay
     */
    hideRoundEndOverlay() {
        if (this.roundEndOverlay) {
            this.roundEndOverlay.classList.add('hidden');
        }
    }
    
    /**
     * Show tournament end overlay with champion
     */
    showTournamentEndOverlay(data) {
        if (!this.tournamentEndOverlay) return;
        
        const champion = this.tournamentEndOverlay.querySelector('#tournament-champion');
        const finalScores = this.tournamentEndOverlay.querySelector('#tournament-final-scores');
        
        if (champion) champion.textContent = data.tournamentWinner;
        
        // Build final scores display
        if (finalScores && data.playerScores) {
            finalScores.innerHTML = this.buildFinalScoresHTML(data.playerScores, data.tournamentWinner);
        }
        
        // Show overlay
        this.tournamentEndOverlay.classList.remove('hidden');
        
        // Play confetti animation (if available)
        this.triggerConfetti();
    }
    
    /**
     * Build scores HTML for round end overlay
     */
    buildScoresHTML(scores) {
        const maxWins = Math.max(...Object.values(scores), 0);
        
        return Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .map(([name, wins]) => `
                <div class="round-score-player ${wins === maxWins ? 'leader' : ''}">
                    <div class="player-name">${name}</div>
                    <div class="player-wins">${wins}</div>
                </div>
            `).join('');
    }
    
    /**
     * Build final scores HTML for tournament end overlay
     */
    buildFinalScoresHTML(scores, champion) {
        return Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .map(([name, wins], index) => `
                <div class="final-score-player ${name === champion ? 'champion' : ''}">
                    <div class="player-rank">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}°`}</div>
                    <div class="player-name">${name}</div>
                    <div class="player-wins">${wins}</div>
                </div>
            `).join('');
    }
    
    /**
     * Update tournament HUD
     */
    updateHUD() {
        if (!this.hudElement) return;
        
        if (!this.isActive) {
            this.hudElement.classList.add('hidden');
            return;
        }
        
        this.hudElement.classList.remove('hidden');
        
        const currentRound = this.hudElement.querySelector('#current-round');
        const totalRounds = this.hudElement.querySelector('#total-rounds');
        const roundIndicators = this.hudElement.querySelector('#round-indicators');
        const scoresContainer = this.hudElement.querySelector('#tournament-scores');
        
        if (currentRound) currentRound.textContent = this.currentRound;
        if (totalRounds) totalRounds.textContent = this.tournamentRounds;
        
        // Update round indicators
        if (roundIndicators) {
            let dotsHTML = '';
            for (let i = 1; i <= this.tournamentRounds; i++) {
                let dotClass = 'round-dot';
                if (i < this.currentRound) dotClass += ' completed';
                else if (i === this.currentRound) dotClass += ' current';
                dotsHTML += `<div class="${dotClass}"></div>`;
            }
            roundIndicators.innerHTML = dotsHTML;
        }
        
        // Update scores
        if (scoresContainer && Object.keys(this.playerScores).length > 0) {
            scoresContainer.innerHTML = Object.entries(this.playerScores)
                .map(([name, wins]) => `
                    <span class="tournament-score-item">
                        ${name}: <span class="wins">${wins}</span>
                    </span>
                `).join('');
        }
    }
    
    /**
     * Trigger confetti effect (simple CSS version)
     */
    triggerConfetti() {
        // Create simple confetti container if not exists
        let confetti = document.getElementById('tournament-confetti');
        if (!confetti) {
            confetti = document.createElement('div');
            confetti.id = 'tournament-confetti';
            confetti.innerHTML = this.generateConfettiHTML();
            
            const style = document.createElement('style');
            style.textContent = `
                #tournament-confetti {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 250;
                    overflow: hidden;
                }
                .confetti-piece {
                    position: absolute;
                    width: 10px;
                    height: 10px;
                    background: #ffcc00;
                    animation: confetti-fall 4s ease-out forwards;
                }
                @keyframes confetti-fall {
                    0% {
                        transform: translateY(-100vh) rotate(0deg);
                        opacity: 1;
                    }
                    100% {
                        transform: translateY(100vh) rotate(720deg);
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
            document.body.appendChild(confetti);
        } else {
            confetti.innerHTML = this.generateConfettiHTML();
        }
        
        // Remove confetti after animation
        setTimeout(() => {
            if (confetti) confetti.innerHTML = '';
        }, 5000);
    }
    
    generateConfettiHTML() {
        const colors = ['#ff3366', '#00ffcc', '#ffcc00', '#9966ff', '#ff6600'];
        let html = '';
        
        for (let i = 0; i < 50; i++) {
            const left = Math.random() * 100;
            const delay = Math.random() * 2;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = 5 + Math.random() * 10;
            
            html += `<div class="confetti-piece" style="
                left: ${left}%;
                animation-delay: ${delay}s;
                background: ${color};
                width: ${size}px;
                height: ${size}px;
                border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
            "></div>`;
        }
        
        return html;
    }
    
    /**
     * Save tournament state to localStorage
     */
    saveToLocalStorage() {
        const state = {
            roomCode: this.roomCode,
            gameMode: this.gameMode,
            totalRounds: this.tournamentRounds,
            currentRound: this.currentRound,
            roundWinners: this.roundWinners,
            playerScores: this.playerScores
        };
        
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('[Tournament] Failed to save to localStorage:', e);
        }
    }
    
    /**
     * Load tournament state from localStorage
     */
    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const state = JSON.parse(saved);
                // Only restore if same game mode
                if (state.gameMode === this.gameMode) {
                    this.tournamentRounds = state.totalRounds || 1;
                    this.currentRound = state.currentRound || 1;
                    this.roundWinners = state.roundWinners || [];
                    this.playerScores = state.playerScores || {};
                    this.isActive = this.tournamentRounds > 1;
                    return true;
                }
            }
        } catch (e) {
            console.warn('[Tournament] Failed to load from localStorage:', e);
        }
        return false;
    }
    
    /**
     * Clear tournament state from localStorage
     */
    clearLocalStorage() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.warn('[Tournament] Failed to clear localStorage:', e);
        }
    }
    
    /**
     * Check if tournament is active (more than 1 round)
     */
    get isTournamentActive() {
        return this.isActive && this.tournamentRounds > 1;
    }
    
    /**
     * Get current tournament status
     */
    getStatus() {
        return {
            isActive: this.isActive,
            tournamentRounds: this.tournamentRounds,
            currentRound: this.currentRound,
            roundWinners: this.roundWinners,
            playerScores: this.playerScores
        };
    }
    
    /**
     * Cleanup
     */
    dispose() {
        // Remove socket listeners
        if (this.socket) {
            this.socket.off('tournament-config');
            this.socket.off('round-ended');
            this.socket.off('tournament-ended');
            this.socket.off('round-starting');
        }
    }
}

export default TournamentManager;

