/**
 * Paint Mode HUD
 * Handles UI updates for territory percentages and timer
 */

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class PaintHUD {
    constructor() {
        this.timerElement = document.getElementById('time-left');
        this.scoreContainer = document.getElementById('paint-scores');
        this.resultsOverlay = document.getElementById('results-overlay');
        this.winnerElement = document.getElementById('winner-text');
        this.rankingsContainer = document.getElementById('final-rankings');
        this.countdownInterval = null;
        this.initialTimerText = this.timerElement ? this.timerElement.textContent : '01:30';
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
            <div class="paint-score-item" style="--player-color: ${escapeHtml(p.color)}">
                <span class="paint-score-name">${escapeHtml(p.name || 'Jugador')}</span>
                <span class="paint-score-percent">${escapeHtml(p.score)}%</span>
            </div>
        `).join('');
    }

    /**
     * @param {Array} results - [{id, name, score, color}] sorted by score
     * @param {object|string|null} winner - {id?, name, color?} (a bare name is also accepted)
     */
    showResults(results, winner) {
        if (!this.resultsOverlay) return;
        results = Array.isArray(results) ? results : [];

        // Resolve the winner (fill in missing color from the results list)
        let w = typeof winner === 'string' ? { name: winner } : (winner || null);
        if (w) {
            const match = results.find(r => (w.id && r.id === w.id) || (w.name && r.name === w.name));
            if (match) w = { ...match, ...w, color: w.color || match.color };
        } else if (results.length > 0) {
            w = results[0];
        }

        this.resultsOverlay.classList.remove('hidden');
        if (w && w.name) {
            this.winnerElement.textContent = `¡GANADOR: ${w.name}!`;
            this.winnerElement.style.color = w.color || '';
        } else {
            this.winnerElement.textContent = '¡FIN DEL JUEGO!';
            this.winnerElement.style.color = '';
        }

        this.rankingsContainer.innerHTML = results.map((r, i) => `
            <div class="ranking-item ${i === 0 ? 'winner' : ''}">
                <span>${i + 1}. ${escapeHtml(r.name)}</span>
                <span>${escapeHtml(r.score)}%</span>
            </div>
        `).join('');
    }

    hideResults() {
        if (this.resultsOverlay) this.resultsOverlay.classList.add('hidden');
        this.hideNextRoundCountdown();
    }

    showNextRoundCountdown(seconds) {
        const countdownContainer = document.getElementById('next-round-countdown');
        const countdownNumber = document.getElementById('countdown-number');

        if (countdownContainer && countdownNumber) {
            this.clearCountdownInterval();
            countdownContainer.classList.remove('hidden');
            let timeLeft = seconds;
            countdownNumber.textContent = timeLeft;

            this.countdownInterval = setInterval(() => {
                timeLeft--;
                countdownNumber.textContent = Math.max(0, timeLeft);
                if (timeLeft <= 0) this.clearCountdownInterval();
            }, 1000);
        }
    }

    hideNextRoundCountdown() {
        this.clearCountdownInterval();
        document.getElementById('next-round-countdown')?.classList.add('hidden');
    }

    clearCountdownInterval() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
    }

    /**
     * Show/hide the end-of-match buttons (REVANCHA / VOLVER AL MENÚ)
     */
    setEndButtonsVisible(visible) {
        document.getElementById('btn-return-menu')?.classList.toggle('hidden', !visible);
        const rematchBtn = document.getElementById('btn-rematch');
        if (rematchBtn) {
            rematchBtn.classList.toggle('hidden', !visible);
            if (visible) this.setRematchPending(false);
        }
    }

    setRematchPending(pending, label) {
        const rematchBtn = document.getElementById('btn-rematch');
        if (!rematchBtn) return;
        rematchBtn.disabled = pending;
        rematchBtn.textContent = label || (pending ? 'PREPARANDO...' : 'REVANCHA');
    }

    updateRound(currentRound, totalRounds) {
        const hud = document.getElementById('tournament-hud');
        if (!hud) return;
        if (totalRounds > 1) {
            hud.classList.remove('hidden');
            const cur = document.getElementById('current-round');
            const tot = document.getElementById('total-rounds');
            if (cur) cur.textContent = currentRound;
            if (tot) tot.textContent = totalRounds;
        } else {
            hud.classList.add('hidden');
        }
    }

    /**
     * Back to a fresh-match state (used by rematch / new rounds)
     */
    reset() {
        this.hideResults();
        this.setEndButtonsVisible(false);
        if (this.timerElement) this.timerElement.textContent = this.initialTimerText;
        if (this.scoreContainer) this.scoreContainer.innerHTML = '';
        if (this.rankingsContainer) this.rankingsContainer.innerHTML = '';
    }
}

export default PaintHUD;
