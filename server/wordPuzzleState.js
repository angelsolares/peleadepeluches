/**
 * Baby Scramble State Manager
 */

const PUZZLE_CONFIG = {
    MAX_WORDS: 5,
    POINTS_PER_WORD: 100
};

const BABY_WORDS = [
    { word: "BIBERON", hint: "Para tomar leche" },
    { word: "PAÑALES", hint: "Para no ensuciarse" },
    { word: "CIGÜEÑA", hint: "La que trae a los bebés" },
    { word: "CHUPON", hint: "Para calmar al bebé" },
    { word: "SONAJA", hint: "Hace ruido al agitarla" },
    { word: "CARRIOLA", hint: "Para pasear al bebé" },
    { word: "GATREAR", hint: "Como se mueven antes de caminar" },
    { word: "PAPILLA", hint: "Comida suavecita" },
    { word: "TALCO", hint: "Para las rozaduras" },
    { word: "MAMILA", hint: "Sinónimo de biberón" }
];

class WordPuzzleStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.puzzleStates = new Map();
    }

    initializePuzzle(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;

        // Pick random words
        const selectedWords = [...BABY_WORDS]
            .sort(() => Math.random() - 0.5)
            .slice(0, PUZZLE_CONFIG.MAX_WORDS)
            .map(w => ({
                ...w,
                scrambled: this.scramble(w.word),
                found: false,
                foundBy: null
            }));

        const state = {
            roomCode,
            words: selectedWords,
            currentWordIndex: 0,
            gameState: 'active', // 'active', 'finished'
            players: new Map()
        };

        room.players.forEach(player => {
            state.players.set(player.id, {
                id: player.id,
                name: player.name,
                color: player.color,
                score: 0
            });
        });

        this.puzzleStates.set(roomCode, state);
        return state;
    }

    scramble(word) {
        return word.split('').sort(() => Math.random() - 0.5).join('');
    }

    processTick(roomCode) {
        const state = this.puzzleStates.get(roomCode);
        if (!state) return null;

        return {
            roomCode,
            gameState: state.gameState,
            currentWord: state.gameState === 'finished' ? null : state.words[state.currentWordIndex],
            words: state.words,
            players: Array.from(state.players.values()).sort((a, b) => b.score - a.score),
            winner: state.winner
        };
    }

    handleGuess(playerId, roomCode, guess) {
        const state = this.puzzleStates.get(roomCode);
        if (!state || state.gameState !== 'active') return;

        const currentWord = state.words[state.currentWordIndex];
        const normalizedGuess = guess.toUpperCase().trim();

        if (normalizedGuess === currentWord.word) {
            const player = state.players.get(playerId);
            if (!player) return;

            currentWord.found = true;
            currentWord.foundBy = { id: player.id, name: player.name, color: player.color };
            player.score += PUZZLE_CONFIG.POINTS_PER_WORD;

            state.currentWordIndex++;
            if (state.currentWordIndex >= state.words.length) {
                state.gameState = 'finished';
                // Determine winner
                let maxScore = -1;
                let winner = null;
                state.players.forEach(p => {
                    if (p.score > maxScore) {
                        maxScore = p.score;
                        winner = { id: p.id, name: p.name };
                    }
                });
                state.winner = winner;
            }
        }
    }

    cleanup(roomCode) {
        this.puzzleStates.delete(roomCode);
    }
}

export default WordPuzzleStateManager;

