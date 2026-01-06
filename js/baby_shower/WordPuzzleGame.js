/**
 * WORD PUZZLE GAME - Baby Shower Mode
 */

import { SERVER_URL } from '../config.js';

class WordPuzzleGame {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.wordListElem = document.getElementById('word-list');
        this.scrambledLettersElem = document.getElementById('scrambled-letters');
        
        this.init();
    }

    init() {
        this.connectToServer();
    }

    connectToServer() {
        this.socket = io(SERVER_URL);

        this.socket.on('connect', () => {
            this.socket.emit('create-room', { 
                gameMode: 'word_puzzle',
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
        });

        this.socket.on('puzzle-state', (state) => this.updateGameState(state));
    }

    updateGameState(state) {
        if (!state) return;

        // Update word list
        this.wordListElem.innerHTML = '';
        state.words.forEach(w => {
            const item = document.createElement('div');
            item.className = `word-item ${w.found ? 'found' : ''}`;
            item.innerHTML = `
                <span>${w.found ? w.word : '???????'}</span>
                ${w.found ? `<span class="found-by" style="background: ${w.foundBy.color}">${w.foundBy.name}</span>` : ''}
            `;
            this.wordListElem.appendChild(item);
        });

        // Update current scrambled word
        if (state.currentWord) {
            this.scrambledLettersElem.innerHTML = '';
            state.currentWord.scrambled.split('').forEach((letter, i) => {
                const bubble = document.createElement('div');
                bubble.className = 'letter-bubble';
                bubble.textContent = letter;
                bubble.style.animationDelay = `${i * 0.2}s`;
                this.scrambledLettersElem.appendChild(bubble);
            });
        }

        if (state.gameState === 'finished') {
            this.showGameOver(state.winner);
        }
    }

    showRoomUI(code, roomData) {
        const overlay = document.createElement('div');
        overlay.id = 'room-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(162, 210, 255, 0.95); z-index: 1000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: 'Orbitron', sans-serif;
        `;

        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mobileUrl)}`;

        overlay.innerHTML = `
            <h1 style="font-size: 3.5rem; color: white; margin-bottom: 10px;">BABY SCRAMBLE</h1>
            <div style="font-size: 5rem; color: #555; letter-spacing: 15px; margin-bottom: 20px;">${code}</div>
            <div style="background: white; padding: 20px; border-radius: 20px; margin-bottom: 20px;">
                <img src="${qrCodeUrl}" alt="QR" />
            </div>
            <div id="player-count-lobby" style="font-size: 1.5rem; color: white; margin-bottom: 30px;">Jugadores: ${roomData ? roomData.playerCount : 0} / 8</div>
            <button id="start-btn" style="
                padding: 20px 60px; font-size: 1.5rem; background: #FFC8DD; color: white;
                border: none; border-radius: 50px; cursor: pointer;
            " ${roomData && roomData.playerCount >= 1 ? '' : 'disabled'}>¡INICIAR!</button>
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
            <h1 style="font-size: 4rem; margin-bottom: 20px;">¡PUZZLE COMPLETADO!</h1>
            <h2 style="font-size: 3rem; color: #A2D2FF;">GANADOR: ${winner ? winner.name : 'NADIE'}</h2>
            <button onclick="window.location.href='baby_shower.html'" style="
                margin-top: 40px; padding: 15px 40px; font-size: 1.2rem;
                background: white; color: #555; border: none; border-radius: 50px;
            ">VOLVER AL MENÚ</button>
        `;
        document.body.appendChild(overlay);
    }
}

new WordPuzzleGame();

