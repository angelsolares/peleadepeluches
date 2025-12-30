/**
 * Paint Mode HUD
 * Handles UI updates for territory percentages and timer
 */

class PaintHUD {
    constructor() {
        this.timerElement = document.getElementById('time-left');
        this.scoreContainer = document.getElementById('paint-scores');
        this.resultsOverlay = document.getElementById('results-overlay');
        this.winnerElement = document.getElementById('winner-text');
        this.rankingsContainer = document.getElementById('final-rankings');
    }

    updateTimer(ms) {
        if (!this.timerElement) return;
        const totalSeconds = Math.ceil(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    updateScores(players) {
        if (!this.scoreContainer) return;
        
        // Sort players by score for the ranking
        const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
        
        this.scoreContainer.innerHTML = sortedPlayers.map(p => `
            <div class="paint-score-item" style="--player-color: ${p.color}">
                <span class="paint-score-name">${p.name || 'Jugador'}</span>
                <span class="paint-score-percent">${p.score}%</span>
            </div>
        `).join('');
    }

    showResults(results, winner) {
        if (!this.resultsOverlay) return;
        
        this.resultsOverlay.classList.remove('hidden');
        this.winnerElement.textContent = `¡GANADOR: ${winner.name}!`;
        this.winnerElement.style.color = winner.color;

        this.rankingsContainer.innerHTML = results.map((r, i) => `
            <div class="ranking-item ${i === 0 ? 'winner' : ''}">
                <span>${i + 1}. ${r.name}</span>
                <span>${r.score}%</span>
            </div>
        `).join('');
    }

    showNextRoundCountdown(seconds) {
        const countdownContainer = document.getElementById('next-round-countdown');
        const countdownNumber = document.getElementById('countdown-number');
        
        if (countdownContainer && countdownNumber) {
            countdownContainer.classList.remove('hidden');
            let timeLeft = seconds;
            countdownNumber.textContent = timeLeft;
            
            const interval = setInterval(() => {
                timeLeft--;
                countdownNumber.textContent = timeLeft;
                if (timeLeft <= 0) clearInterval(interval);
            }, 1000);
        }
    }
}

export default PaintHUD;

