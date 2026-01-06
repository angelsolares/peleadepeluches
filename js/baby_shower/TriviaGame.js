/**
 * TRIVIA GAME - Baby Shower Mode
 */

import { SERVER_URL } from '../config.js';

class TriviaGame {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.gameState = 'waiting';
        this.players = [];
        
        // UI Elements
        this.questionText = document.getElementById('question-text');
        this.options = {
            a: document.getElementById('option-a-text'),
            b: document.getElementById('option-b-text'),
            c: document.getElementById('option-c-text'),
            d: document.getElementById('option-d-text')
        };
        this.timerFill = document.getElementById('timer-fill');
        this.rankingList = document.getElementById('ranking-list');
        this.answeredCount = document.getElementById('answered-count');
        this.totalPlayers = document.getElementById('total-players');
        
        this.init();
    }

    init() {
        this.connectToServer();
    }

    connectToServer() {
        this.socket = io(SERVER_URL);

        this.socket.on('connect', () => {
            console.log('[Trivia] Connected to server');
            this.socket.emit('create-room', { 
                gameMode: 'trivia',
                isBabyShower: true 
            }, (response) => {
                if (response.success) {
                    this.roomCode = response.roomCode;
                    this.showRoomUI(this.roomCode, response.room);
                }
            });
        });

        this.socket.on('player-joined', (data) => {
            if (data && data.room) {
                this.updatePlayerCountUI(data.room);
            }
        });

        this.socket.on('game-started', (data) => {
            this.hideRoomUI();
            this.gameState = 'playing';
        });

        this.socket.on('trivia-state', (state) => this.updateGameState(state));
    }

    updateGameState(state) {
        if (!state) return;

        // Update question and options
        if (state.currentQuestion) {
            this.questionText.textContent = state.currentQuestion.q;
            this.options.a.textContent = state.currentQuestion.a;
            this.options.b.textContent = state.currentQuestion.b;
            this.options.c.textContent = state.currentQuestion.c;
            this.options.d.textContent = state.currentQuestion.d;
            
            // Highlight correct answer if showing
            if (state.currentQuestion.correct) {
                this.highlightCorrect(state.currentQuestion.correct);
            } else {
                this.resetHighlights();
            }
        }

        // Update timer
        const timerPercent = (state.timeLeft / 15) * 100;
        this.timerFill.style.width = `${timerPercent}%`;

        // Update ranking
        this.updateRanking(state.players);

        // Update answered count
        const answered = state.players.filter(p => p.currentAnswer !== null).length;
        this.answeredCount.textContent = answered;
        this.totalPlayers.textContent = state.players.length;

        if (state.gameState === 'finished') {
            this.showGameOver(state.winner);
        }
    }

    highlightCorrect(correct) {
        this.resetHighlights();
        const letter = correct.toLowerCase();
        const optionItem = document.querySelector(`.letter-${letter}`).parentElement;
        optionItem.style.borderColor = '#2ecc71';
        optionItem.style.backgroundColor = '#d0f4de';
    }

    resetHighlights() {
        document.querySelectorAll('.option-item').forEach(item => {
            item.style.borderColor = '#eee';
            item.style.backgroundColor = 'white';
        });
    }

    updateRanking(players) {
        this.rankingList.innerHTML = '';
        players.forEach((p, idx) => {
            const item = document.createElement('div');
            item.className = 'rank-item';
            item.innerHTML = `
                <span>${idx + 1}. ${p.name}</span>
                <span>${p.score} pts</span>
            `;
            this.rankingList.appendChild(item);
        });
    }

    showRoomUI(code, roomData) {
        const overlay = document.createElement('div');
        overlay.id = 'room-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(255, 200, 221, 0.95); z-index: 1000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: 'Orbitron', sans-serif;
        `;

        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mobileUrl)}`;

        overlay.innerHTML = `
            <h1 style="font-size: 3.5rem; color: #FF85A1; margin-bottom: 10px;">TRIVIA DE BEBÉS</h1>
            <div style="font-size: 5rem; color: #555; letter-spacing: 15px; margin-bottom: 20px;">${code}</div>
            <div style="background: white; padding: 20px; border-radius: 20px; margin-bottom: 20px;">
                <img src="${qrCodeUrl}" alt="QR" />
            </div>
            <p style="color: #888; margin-bottom: 20px;">Escanea para jugar desde tu celular</p>
            <div id="player-count-lobby" style="font-size: 1.5rem; margin-bottom: 30px;">Jugadores: ${roomData ? roomData.playerCount : 0} / 8</div>
            <button id="start-btn" style="
                padding: 20px 60px; font-size: 1.5rem; background: #A2D2FF; color: white;
                border: none; border-radius: 50px; cursor: pointer; transition: transform 0.2s;
            " ${roomData && roomData.playerCount >= 1 ? '' : 'disabled'}>¡EMPEZAR!</button>
        `;

        document.body.appendChild(overlay);

        document.getElementById('start-btn').onclick = () => {
            this.socket.emit('start-game');
        };
    }

    updatePlayerCountUI(roomData) {
        const countElem = document.getElementById('player-count-lobby');
        if (countElem) {
            countElem.textContent = `Jugadores: ${roomData.playerCount} / 8`;
        }
        const startBtn = document.getElementById('start-btn');
        if (startBtn) {
            startBtn.disabled = roomData.playerCount < 1;
        }
    }

    hideRoomUI() {
        document.getElementById('room-overlay')?.remove();
    }

    showGameOver(winner) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); z-index: 2000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            color: white; font-family: 'Orbitron', sans-serif;
        `;
        overlay.innerHTML = `
            <h1 style="font-size: 4rem; margin-bottom: 20px;">¡FIN DE LA TRIVIA!</h1>
            <h2 style="font-size: 3rem; color: #FFC8DD;">GANADOR: ${winner ? winner.name : 'NADIE'}</h2>
            <button onclick="window.location.href='baby_shower.html'" style="
                margin-top: 40px; padding: 15px 40px; font-size: 1.2rem;
                background: white; color: #555; border: none; border-radius: 50px;
            ">VOLVER AL MENÚ</button>
        `;
        document.body.appendChild(overlay);
    }
}

new TriviaGame();

