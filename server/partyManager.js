/**
 * Party Manager - "Modo Fiesta": a sequence of minigames with a cumulative scoreboard.
 *
 * The host screen moves between pages (party.html <-> <mode>.html) while the phones stay in
 * the room. Each page re-attaches as host with the party token; the server starts the games,
 * awards points when they end and tells the host where to go next.
 */

import crypto from 'node:crypto';

const PARTY_CONFIG = {
    MODES: ['smash', 'sumo', 'tag', 'race', 'flappy', 'tug', 'paint', 'balloon'],
    DEFAULT_GAMES: 5,
    ALLOWED_COUNTS: [3, 5, 8],
    POINTS: [5, 3, 2, 1],        // By placement; everyone else 0
    TEAM_WIN_POINTS: 3,          // Tug of war: every member of the winning team
    START_DELAY_MS: 2500,        // After a game page attaches, before the match starts
    SCORES_AFTER_MS: 6000,       // Game over screen time before going to the scoreboard
    NEXT_GAME_AFTER_MS: 8000,    // Scoreboard time before the next game
    HOST_SWITCH_GRACE_MS: 25000  // The room survives this long without a host while pages change
};

const MODE_LABELS = {
    smash: 'Pelea', sumo: 'Sumo', tag: 'La Trae', race: 'Carrera',
    flappy: 'Flappy', tug: 'Cuerda', paint: 'Pinta el Piso', balloon: 'Globo'
};

class PartyManager {
    /**
     * @param {object} lobbyManager
     * @param {object} io
     * @param {{ startGame: Function, scheduleTimer: Function, clearTimer: Function, closeRoom: Function }} hooks
     */
    constructor(lobbyManager, io, hooks) {
        this.lobbyManager = lobbyManager;
        this.io = io;
        this.hooks = hooks;
        this.hostTimers = new Map(); // roomCode -> timeout waiting for a new host page
    }

    isParty(room) {
        return !!(room && room.party);
    }

    /**
     * Turn a freshly created room into a party room
     */
    create(room) {
        room.party = {
            token: crypto.randomBytes(8).toString('hex'),
            total: PARTY_CONFIG.DEFAULT_GAMES,
            games: [],
            index: -1,
            state: 'lobby',          // lobby | transition | playing | scores | finished
            scores: new Map(),       // playerId -> { id, name, color, points, delta }
            results: [],             // [{ gameMode, winnerName, ranking }]
            lastResult: null,
            hostLeavingUntil: 0,
            nextAt: 0
        };
        return room.party;
    }

    setGames(roomCode, count) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!this.isParty(room)) return { success: false, error: 'Not a party room' };
        const n = Number(count);
        if (!PARTY_CONFIG.ALLOWED_COUNTS.includes(n)) return { success: false, error: 'Invalid count' };
        if (room.party.state !== 'lobby' && room.party.state !== 'finished') return { success: false, error: 'Party in progress' };
        room.party.total = n;
        this.io.to(roomCode).emit('party-config', { total: n });
        return { success: true, total: n };
    }

    /**
     * Shuffle a sequence and launch the first game (also used for "otra fiesta")
     * @param {string[]} [sequence] Forced sequence (tests)
     */
    start(roomCode, sequence) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!this.isParty(room)) return { success: false, error: 'Not a party room' };
        if (room.players.size === 0) return { success: false, error: 'No players in room' };
        const party = room.party;
        if (party.state !== 'lobby' && party.state !== 'finished') return { success: false, error: 'Party in progress' };

        let games;
        if (Array.isArray(sequence) && sequence.length && sequence.every(m => PARTY_CONFIG.MODES.includes(m))) {
            games = sequence.slice(0, 12);
        } else {
            games = [];
            while (games.length < party.total) {
                const pool = PARTY_CONFIG.MODES.slice().sort(() => Math.random() - 0.5);
                for (const m of pool) {
                    if (games.length >= party.total) break;
                    if (games.length && games[games.length - 1] === m) continue; // no back-to-back repeats
                    games.push(m);
                }
            }
        }
        party.games = games;
        party.total = games.length;
        party.index = 0;
        party.results = [];
        party.lastResult = null;
        party.scores = new Map();
        room.players.forEach(p => party.scores.set(p.id, { id: p.id, name: p.name, color: p.color, points: 0, delta: 0 }));
        room.tournamentRounds = 1;

        this.launch(roomCode);
        return { success: true, games };
    }

    /**
     * Send the host to the current game's page
     */
    launch(roomCode) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!this.isParty(room)) return;
        const party = room.party;
        const game = party.games[party.index];
        room.gameMode = game;
        room.state = 'lobby';
        party.state = 'transition';
        party.hostLeavingUntil = Date.now() + PARTY_CONFIG.HOST_SWITCH_GRACE_MS;
        this.io.to(roomCode).emit('party-info', this.summary(room));
        this.goHost(room, `${game}.html?party=${roomCode}&token=${party.token}`, 'game');
        console.log(`[Party] ${roomCode}: game ${party.index + 1}/${party.total} -> ${game}`);
    }

    goHost(room, url, reason) {
        if (room.hostId) this.io.to(room.hostId).emit('party-go', { url, reason });
        else room.party.pendingGo = { url, reason }; // delivered when a host attaches
    }

    /**
     * A new host page takes over the room
     */
    attachHost(socket, { roomCode, token, page }) {
        const code = String(roomCode || '').toUpperCase();
        const room = this.lobbyManager.rooms.get(code);
        if (!this.isParty(room)) return { success: false, error: 'Party not found' };
        if (room.party.token !== token) return { success: false, error: 'Invalid token' };

        const previousHost = room.hostId;
        if (previousHost && previousHost !== socket.id) this.lobbyManager.playerRooms.delete(previousHost);
        room.hostId = socket.id;
        this.lobbyManager.playerRooms.set(socket.id, code);
        socket.join(code);
        room.party.hostLeavingUntil = 0;
        this.clearHostTimer(code);

        const party = room.party;
        if (page === 'scores') {
            if (party.state === 'scores' || party.state === 'transition') {
                party.state = party.index + 1 < party.total ? 'scores' : 'finished';
                if (party.state === 'scores') {
                    // Next game after the scoreboard time
                    party.index += 1;
                    party.nextAt = Date.now() + PARTY_CONFIG.NEXT_GAME_AFTER_MS;
                    const nextIndex = party.index;
                    this.hooks.scheduleTimer(code, () => {
                        const r = this.lobbyManager.rooms.get(code);
                        if (r && r.party && r.party.index === nextIndex && r.party.state === 'scores') this.launch(code);
                    }, PARTY_CONFIG.NEXT_GAME_AFTER_MS);
                    // summary() reports the finished game as index-1 while on the scoreboard
                    party.showingIndex = party.index - 1;
                } else {
                    party.showingIndex = party.index;
                    console.log(`[Party] ${code}: finished`);
                }
                // Phones show the standings / the final result
                this.io.to(code).emit('party-info', this.summary(room));
            }
            return { success: true, roomCode: code, gameMode: 'party', players: this.playersInfo(room), party: this.summary(room) };
        }

        // A game page: start the match shortly
        if (party.state === 'transition' && page === room.gameMode) {
            party.state = 'playing';
            room.players.forEach(p => { p.ready = true; });
            this.hooks.scheduleTimer(code, () => {
                const r = this.lobbyManager.rooms.get(code);
                if (r && r.party && r.party.state === 'playing' && r.state !== 'playing') this.hooks.startGame(code);
            }, PARTY_CONFIG.START_DELAY_MS);
        }
        return { success: true, roomCode: code, gameMode: room.gameMode, players: this.playersInfo(room), party: this.summary(room) };
    }

    /**
     * Called by every mode when a match ends (single-round branch)
     * @param {{ winnerId?: string, ranking?: string[], winningTeam?: string[] }} result
     */
    onGameFinished(roomCode, gameMode, result = {}) {
        const room = this.lobbyManager.rooms.get(roomCode);
        if (!this.isParty(room) || room.party.state !== 'playing') return;
        const party = room.party;
        party.state = 'scores';

        // Make sure late joiners have a score row
        room.players.forEach(p => {
            if (!party.scores.has(p.id)) party.scores.set(p.id, { id: p.id, name: p.name, color: p.color, points: 0, delta: 0 });
        });
        party.scores.forEach(s => { s.delta = 0; });

        const ranking = [];
        if (Array.isArray(result.winningTeam) && result.winningTeam.length) {
            result.winningTeam.forEach(id => {
                const s = party.scores.get(id);
                if (s) { s.points += PARTY_CONFIG.TEAM_WIN_POINTS; s.delta = PARTY_CONFIG.TEAM_WIN_POINTS; ranking.push({ id, name: s.name, placement: 1, points: PARTY_CONFIG.TEAM_WIN_POINTS }); }
            });
        } else {
            const order = Array.isArray(result.ranking) && result.ranking.length ? result.ranking : (result.winnerId ? [result.winnerId] : []);
            order.forEach((id, i) => {
                const s = party.scores.get(id);
                if (!s) return;
                const pts = PARTY_CONFIG.POINTS[i] || 0;
                s.points += pts; s.delta = pts;
                ranking.push({ id, name: s.name, placement: i + 1, points: pts });
            });
        }
        const winnerName = ranking[0]?.name || null;
        party.lastResult = { gameMode, winnerName, ranking };
        party.results.push(party.lastResult);
        party.showingIndex = party.index;
        party.hostLeavingUntil = Date.now() + PARTY_CONFIG.SCORES_AFTER_MS + PARTY_CONFIG.HOST_SWITCH_GRACE_MS;
        this.io.to(roomCode).emit('party-info', this.summary(room));
        console.log(`[Party] ${roomCode}: ${gameMode} finished, winner ${winnerName}`);

        // Let the game page show its own result, then the scoreboard
        this.hooks.scheduleTimer(roomCode, () => {
            const r = this.lobbyManager.rooms.get(roomCode);
            if (!r || !r.party) return;
            r.party.hostLeavingUntil = Date.now() + PARTY_CONFIG.HOST_SWITCH_GRACE_MS;
            this.goHost(r, `party.html?party=${roomCode}&token=${r.party.token}&view=scores`, 'scores');
        }, PARTY_CONFIG.SCORES_AFTER_MS);
    }

    /**
     * The host socket left: keep the room while it is switching pages
     * @returns {boolean} true when the room was kept (caller must not close it)
     */
    onHostDisconnected(socket) {
        const roomCode = this.lobbyManager.getRoomCodeBySocketId(socket.id);
        const room = roomCode && this.lobbyManager.rooms.get(roomCode);
        if (!this.isParty(room) || room.hostId !== socket.id) return false;
        if (room.party.hostLeavingUntil <= Date.now()) return false;

        room.hostId = null;
        this.lobbyManager.playerRooms.delete(socket.id);
        this.clearHostTimer(roomCode);
        this.hostTimers.set(roomCode, setTimeout(() => {
            this.hostTimers.delete(roomCode);
            const r = this.lobbyManager.rooms.get(roomCode);
            if (r && r.hostId === null) {
                console.log(`[Party] ${roomCode}: no host page came back, closing`);
                this.hooks.closeRoom(roomCode);
            }
        }, PARTY_CONFIG.HOST_SWITCH_GRACE_MS));
        console.log(`[Party] ${roomCode}: host page left, waiting for the next one`);
        return true;
    }

    clearHostTimer(roomCode) {
        const t = this.hostTimers.get(roomCode);
        if (t) { clearTimeout(t); this.hostTimers.delete(roomCode); }
    }

    playersInfo(room) {
        return Array.from(room.players.values()).map(p => ({
            id: p.id, name: p.name, number: p.number, color: p.color, character: p.character || 'edgar'
        }));
    }

    /**
     * Snapshot sent to pages and phones
     */
    summary(room) {
        const party = room.party;
        const scores = Array.from(party.scores.values()).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
        const index = typeof party.showingIndex === 'number' && party.state !== 'transition' && party.state !== 'playing' ? party.showingIndex : party.index;
        const nextGame = party.state === 'scores' ? party.games[party.index] : (party.state === 'transition' || party.state === 'playing' ? party.games[party.index] : null);
        return {
            index,
            total: party.total,
            games: party.games.slice(),
            labels: MODE_LABELS,
            current: party.state === 'playing' || party.state === 'transition' ? party.games[party.index] : null,
            state: party.state,
            scores,
            lastResult: party.lastResult,
            results: party.results.slice(),
            history: party.results.map(r => ({ gameMode: r.gameMode, winnerName: r.winnerName })),
            nextGame: party.state === 'scores' ? nextGame : null,
            nextInMs: party.state === 'scores' ? Math.max(0, party.nextAt - Date.now()) : 0
        };
    }

    cleanup(roomCode) {
        this.clearHostTimer(roomCode);
    }
}

export default PartyManager;
export { PARTY_CONFIG, MODE_LABELS };
