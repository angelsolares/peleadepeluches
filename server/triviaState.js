/**
 * Trivia de Bebés State Manager
 */

const TRIVIA_CONFIG = {
    TIME_PER_QUESTION: 15, // seconds
    POINTS_PER_CORRECT: 100,
    SPEED_BONUS_MAX: 50,
    COOLDOWN_BETWEEN_QUESTIONS: 3000 // ms (Reduced from 5000)
};

const TRIVIA_QUESTIONS = [
    {
        q: "¿Cuántos pañales usa un recién nacido en promedio al día?",
        a: "A) 2-4",
        b: "B) 6-10",
        c: "C) 12-15",
        d: "D) 20+",
        correct: "b"
    },
    {
        q: "¿A qué edad suelen empezar a gatear la mayoría de los bebés?",
        a: "A) 3-5 meses",
        b: "B) 7-10 meses",
        c: "C) 12-14 meses",
        d: "D) 18 meses",
        correct: "b"
    },
    {
        q: "¿Cuál es el primer sentido que desarrolla un bebé en el vientre?",
        a: "A) Vista",
        b: "B) Oído",
        c: "C) Tacto",
        d: "D) Olfato",
        correct: "c"
    },
    {
        q: "¿Cuántos huesos tiene un bebé al nacer?",
        a: "A) 206",
        b: "B) 300",
        c: "C) 150",
        d: "D) 250",
        correct: "b"
    },
    {
        q: "¿Cuál es el color de ojos más común en los bebés recién nacidos?",
        a: "A) Café",
        b: "B) Azul/Gris",
        c: "C) Verde",
        d: "D) Negro",
        correct: "b"
    }
];

class TriviaStateManager {
    constructor(lobbyManager) {
        this.lobbyManager = lobbyManager;
        this.triviaStates = new Map();
    }

    initializeTrivia(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!room) return null;

        const state = {
            roomCode,
            questions: [...TRIVIA_QUESTIONS].sort(() => Math.random() - 0.5),
            currentQuestionIndex: 0,
            gameState: 'active', // 'active', 'showing_answer', 'finished'
            timeLeft: TRIVIA_CONFIG.TIME_PER_QUESTION,
            questionStartTime: Date.now(),
            players: new Map(),
            totalQuestions: 5
        };

        room.players.forEach(player => {
            state.players.set(player.id, {
                id: player.id,
                name: player.name,
                score: 0,
                currentAnswer: null,
                answeredAt: null,
                isCorrect: false
            });
        });

        this.triviaStates.set(roomCode, state);
        return state;
    }

    processTick(roomCode) {
        const state = this.triviaStates.get(roomCode);
        if (!state || state.gameState === 'finished') return null;

        const now = Date.now();
        const room = this.lobbyManager.rooms.get(roomCode);
        
        if (state.gameState === 'active') {
            const elapsed = (now - state.questionStartTime) / 1000;
            state.timeLeft = Math.max(0, TRIVIA_CONFIG.TIME_PER_QUESTION - elapsed);

            // Check if everyone (who is still in the room) answered
            let allAnswered = true;
            if (room) {
                for (const [playerId, player] of state.players) {
                    if (room.players.has(playerId) && player.currentAnswer === null) {
                        allAnswered = false;
                        break;
                    }
                }
            }
            
            if (state.timeLeft <= 0 || allAnswered) {
                this.endQuestion(roomCode);
            }
        }

        return this.getPublicState(roomCode);
    }

    handleAnswer(playerId, roomCode, answer) {
        const state = this.triviaStates.get(roomCode);
        if (!state || state.gameState !== 'active') return;

        const player = state.players.get(playerId);
        if (!player || player.currentAnswer !== null) return;

        const now = Date.now();
        player.currentAnswer = answer.toLowerCase();
        player.answeredAt = now;

        const currentQ = state.questions[state.currentQuestionIndex];
        if (player.currentAnswer === currentQ.correct) {
            player.isCorrect = true;
            // Calculate speed bonus
            const timeTaken = (now - state.questionStartTime) / 1000;
            const speedFactor = Math.max(0, 1 - (timeTaken / TRIVIA_CONFIG.TIME_PER_QUESTION));
            const bonus = Math.round(speedFactor * TRIVIA_CONFIG.SPEED_BONUS_MAX);
            player.score += TRIVIA_CONFIG.POINTS_PER_CORRECT + bonus;
        } else {
            player.isCorrect = false;
        }
    }

    endQuestion(roomCode) {
        const state = this.triviaStates.get(roomCode);
        if (!state) return;

        state.gameState = 'showing_answer';
        
        setTimeout(() => {
            this.nextQuestion(roomCode);
        }, TRIVIA_CONFIG.COOLDOWN_BETWEEN_QUESTIONS);
    }

    nextQuestion(roomCode) {
        const state = this.triviaStates.get(roomCode);
        if (!state) return;

        state.currentQuestionIndex++;
        
        if (state.currentQuestionIndex >= state.totalQuestions) {
            state.gameState = 'finished';
            // Find winner
            let maxScore = -1;
            let winner = null;
            state.players.forEach(p => {
                if (p.score > maxScore) {
                    maxScore = p.score;
                    winner = { id: p.id, name: p.name };
                }
            });
            state.winner = winner;
        } else {
            state.gameState = 'active';
            state.questionStartTime = Date.now();
            state.timeLeft = TRIVIA_CONFIG.TIME_PER_QUESTION;
            // Reset player answers
            state.players.forEach(p => {
                p.currentAnswer = null;
                p.answeredAt = null;
                p.isCorrect = false;
            });
        }
    }

    getPublicState(roomCode) {
        const state = this.triviaStates.get(roomCode);
        if (!state) return null;

        const currentQ = state.questions[state.currentQuestionIndex];
        
        return {
            roomCode,
            gameState: state.gameState,
            currentQuestion: state.gameState === 'finished' ? null : {
                q: currentQ.q,
                a: currentQ.a,
                b: currentQ.b,
                c: currentQ.c,
                d: currentQ.d,
                index: state.currentQuestionIndex,
                total: state.totalQuestions,
                correct: state.gameState === 'showing_answer' ? currentQ.correct : null
            },
            timeLeft: Math.ceil(state.timeLeft),
            players: Array.from(state.players.values()).sort((a, b) => b.score - a.score),
            winner: state.winner
        };
    }

    cleanup(roomCode) {
        this.triviaStates.delete(roomCode);
    }
}

export default TriviaStateManager;

