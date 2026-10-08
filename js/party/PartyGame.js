/**
 * PartyGame - host page of "Modo Fiesta" (party.html).
 *
 * Three views, chosen from the URL:
 *  - LOBBY  (no ?party= params): creates the room, shows code + QR, players, game count, start.
 *  - SCORES (?party=CODE&token=T&view=scores): re-attaches to the room and shows the result of
 *           the game that just ended, the cumulative standings and the countdown to the next one.
 *  - FINAL  (same URL, party.state === 'finished'): podium, final standings, games played,
 *           "OTRA FIESTA" / "MENÚ".
 *
 * Navigation between pages is always driven by the server ('party-go' { url }), which
 * installParty() from PartyClient already handles.
 */

import { SERVER_URL } from '../config.js';
import { getPartyParams, installParty } from './PartyClient.js';

/** Display name + emoji of every mode that can appear in a party (keyed by gameMode) */
export const PARTY_MODE_LABELS = {
    smash: { name: 'Pelea', emoji: '🥊' },
    sumo: { name: 'Sumo', emoji: '🥋' },
    tag: { name: 'La Trae', emoji: '💨' },
    race: { name: 'Carrera', emoji: '🏃' },
    flappy: { name: 'Flappy', emoji: '🐦' },
    tug: { name: 'Cuerda', emoji: '🪢' },
    paint: { name: 'Pinta el Piso', emoji: '🎨' },
    balloon: { name: 'Globo', emoji: '🎈' }
};

/** "🥋 Sumo" for a gameMode (falls back to the raw mode for unknown ones) */
export function partyModeLabel(mode, { emoji = true } = {}) {
    const info = PARTY_MODE_LABELS[mode];
    if (!info) return String(mode || '?');
    return emoji ? `${info.emoji} ${info.name}` : info.name;
}

/** Same table the phone controller uses to pick a character */
const CHARACTERS = {
    edgar: { name: 'Edgar', emoji: '👦' },
    isabella: { name: 'Isabella', emoji: '👧' },
    jesus: { name: 'Jesus', emoji: '🧔' },
    lia: { name: 'Lia', emoji: '👩' },
    hector: { name: 'Hector', emoji: '🧑' },
    katy: { name: 'Katy', emoji: '👱‍♀️' },
    mariana: { name: 'Mariana', emoji: '👩‍🦱' },
    sol: { name: 'Sol', emoji: '🌞' },
    yadira: { name: 'Yadira', emoji: '💃' },
    angel: { name: 'Angel', emoji: '😇' },
    lidia: { name: 'Lidia', emoji: '👩‍🦰' },
    fabian: { name: 'Fabian', emoji: '🧑‍🦲' },
    marile: { name: 'Marile', emoji: '👩‍🦳' },
    gabriel: { name: 'Gabriel', emoji: '👼' },
    baby: { name: 'Bebé', emoji: '👶' }
};

const MAX_PLAYERS = 8;
const MEDALS = ['🥇', '🥈', '🥉'];
const CONFETTI_COLORS = ['#ff8800', '#ffcc00', '#ff3366', '#00ffcc', '#ffffff', '#ff66cc'];

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

class PartyGame {
    constructor() {
        this.params = getPartyParams();           // null -> lobby, otherwise scores/final
        this.socket = null;
        this.roomCode = this.params ? this.params.roomCode : null;
        this.token = this.params ? this.params.token : null;
        this.total = 5;
        this.players = new Map();                 // lobby: id -> player
        this.party = null;                        // last party snapshot (scores/final)
        this.starting = false;
        this.countdownTimer = null;
        this.confettiDone = false;
        this.closed = false;

        this.bindUI();
        this.renderModeChips();
        this.connect();
    }

    // =========================================================
    // UI wiring
    // =========================================================

    bindUI() {
        for (const selectorId of ['lobby-games-selector', 'final-games-selector']) {
            const selector = $(selectorId);
            selector.querySelectorAll('.games-btn').forEach((btn) => {
                btn.addEventListener('click', () => this.setGames(Number(btn.dataset.count)));
            });
        }

        $('party-start-btn').addEventListener('click', () => this.startParty($('party-start-btn'), $('lobby-status')));
        $('party-again-btn').addEventListener('click', () => this.startParty($('party-again-btn'), $('final-status')));
        $('party-menu-btn').addEventListener('click', () => { window.location.href = 'index.html'; });
        $('closed-menu-btn').addEventListener('click', () => { window.location.href = 'index.html'; });
    }

    showView(name) {
        for (const id of ['view-loading', 'view-lobby', 'view-scores', 'view-final', 'view-closed']) {
            $(id).classList.toggle('hidden', id !== `view-${name}`);
        }
    }

    setHeaderInfo(text) {
        $('party-header-info').textContent = text || '';
    }

    setConnection(state) {
        const el = $('party-conn');
        el.classList.remove('online', 'offline');
        if (state === 'online') {
            el.classList.add('online');
            el.textContent = '● EN LÍNEA';
        } else if (state === 'offline') {
            el.classList.add('offline');
            el.textContent = '● RECONECTANDO…';
        } else {
            el.textContent = 'CONECTANDO…';
        }
    }

    setStatus(el, text, kind = '') {
        if (!el) return;
        el.textContent = text || '';
        el.classList.remove('error', 'ok');
        if (kind) el.classList.add(kind);
    }

    showOverlay(text) {
        $('party-overlay-text').textContent = text;
        $('party-overlay').classList.remove('hidden');
    }

    hideOverlay() {
        $('party-overlay').classList.add('hidden');
    }

    showClosed(title, reason) {
        this.closed = true;
        this.stopCountdown();
        this.hideOverlay();
        $('closed-title').textContent = title;
        $('closed-reason').textContent = reason || '';
        this.showView('closed');
    }

    renderModeChips() {
        $('lobby-modes').innerHTML = Object.entries(PARTY_MODE_LABELS)
            .map(([mode, info]) => `<li class="mode-chip" data-mode="${mode}"><span class="emoji">${info.emoji}</span>${escapeHtml(info.name)}</li>`)
            .join('');
    }

    updateGameSelectors() {
        document.querySelectorAll('.games-selector .games-btn').forEach((btn) => {
            btn.classList.toggle('selected', Number(btn.dataset.count) === this.total);
            btn.disabled = false;
        });
    }

    // =========================================================
    // Socket
    // =========================================================

    connect() {
        if (typeof io !== 'function') {
            this.showClosed('Sin conexión', 'No se pudo cargar Socket.IO. Revisa tu conexión a internet.');
            return;
        }

        console.log('[Party] Connecting to server:', SERVER_URL);
        this.socket = io(SERVER_URL);
        installParty(this.socket); // handles 'party-go' navigation (+ badge, hidden by css here)

        this.socket.on('connect', () => {
            // Recovered connection (Socket.IO connectionStateRecovery): same id, same room,
            // missed events are replayed. Re-creating the room here would orphan all phones.
            if (this.socket.recovered) {
                console.log(`[Party] Connection recovered, keeping room ${this.roomCode}`);
                this.setConnection('online');
                return;
            }
            console.log('[Party] Connected to server');
            this.setConnection('online');
            if (this.closed) return;

            if (this.params) {
                this.attachToParty();
            } else {
                this.createRoom();
            }
        });

        this.socket.on('disconnect', (reason) => {
            console.warn('[Party] Disconnected:', reason);
            this.setConnection('offline');
        });

        this.socket.on('connect_error', (err) => {
            console.warn('[Party] Connection error:', err && err.message);
            $('loading-text').textContent = 'No se pudo conectar con el servidor. Reintentando…';
            this.setConnection('offline');
        });

        // ---- Lobby events ----
        this.socket.on('player-joined', (data) => {
            if (data && data.room && Array.isArray(data.room.players)) {
                this.replacePlayers(data.room.players);
            } else if (data && data.player) {
                this.players.set(data.player.id, data.player);
            }
            this.renderPlayers();
        });

        this.socket.on('player-left', (data) => {
            if (data && data.room && Array.isArray(data.room.players)) {
                this.replacePlayers(data.room.players);
            } else if (data && data.playerId) {
                this.players.delete(data.playerId);
            }
            this.renderPlayers();
        });

        this.socket.on('character-selected', (data) => {
            if (!data) return;
            const player = this.players.get(data.playerId);
            if (player) {
                player.character = data.character;
                if (data.playerName) player.name = data.playerName;
            }
            this.renderPlayers();
        });

        this.socket.on('party-config', (data) => {
            if (data && Number.isFinite(data.total)) {
                this.total = data.total;
                this.updateGameSelectors();
            }
        });

        // ---- Scores / final refresh ----
        this.socket.on('party-info', (info) => {
            if (!info || !this.params) return;
            this.renderParty(info);
        });

        this.socket.on('room-closed', (data) => {
            console.warn('[Party] Room closed:', data);
            this.showClosed('La sala se cerró', 'La fiesta terminó o el servidor cerró la sala. Vuelve al menú para crear otra.');
        });
    }

    // =========================================================
    // LOBBY
    // =========================================================

    createRoom() {
        if (this.roomCode) {
            // Reconnected but the session could not be recovered: the old room is gone
            console.warn('[Party] Session lost, creating a new room');
            this.players.clear();
            this.starting = false;
            this.hideOverlay();
        }

        this.socket.emit('create-room', { gameMode: 'party' }, (response) => {
            if (!response || !response.success) {
                console.error('[Party] Could not create the room:', response);
                this.showClosed('No se pudo crear la sala', (response && response.error) || 'Error del servidor');
                return;
            }
            this.roomCode = response.roomCode;
            this.token = response.party && response.party.token ? response.party.token : null;
            if (response.party && Number.isFinite(response.party.total)) this.total = response.party.total;
            console.log(`[Party] Room created: ${this.roomCode}`);

            this.renderLobby();
            this.showView('lobby');
        });
    }

    renderLobby() {
        const code = this.roomCode;
        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mobileUrl)}`;

        $('lobby-room-code').textContent = code;
        $('lobby-qr').src = qrCodeUrl;
        $('lobby-url').textContent = mobileUrl;
        this.setHeaderInfo(`SALA ${code}`);
        this.updateGameSelectors();
        this.setStatus($('lobby-status'), 'Esperando jugadores…');
        this.renderPlayers();
    }

    replacePlayers(list) {
        this.players.clear();
        for (const p of list) this.players.set(p.id, p);
    }

    renderPlayers() {
        if (this.params) return; // only the lobby draws the slots

        const players = Array.from(this.players.values())
            .sort((a, b) => (a.number || 0) - (b.number || 0));

        const slots = [];
        for (let i = 0; i < MAX_PLAYERS; i++) {
            const p = players[i];
            if (!p) {
                slots.push(`<li class="player-slot empty">LIBRE</li>`);
                continue;
            }
            const char = p.character ? CHARACTERS[p.character] : null;
            const charHtml = char
                ? `<span class="slot-char">${char.emoji} ${escapeHtml(char.name)}</span>`
                : (p.character
                    ? `<span class="slot-char">${escapeHtml(p.character)}</span>`
                    : `<span class="slot-char pending">Eligiendo personaje…</span>`);
            slots.push(`
                <li class="player-slot" style="--player-color:${escapeHtml(p.color || '#888')}">
                    <div class="slot-avatar">${char ? char.emoji : '🧸'}</div>
                    <div class="slot-info">
                        <span class="slot-name">${escapeHtml(p.name)}</span>
                        ${charHtml}
                    </div>
                </li>`);
        }
        $('lobby-players').innerHTML = slots.join('');
        $('lobby-player-count').textContent = `${players.length} / ${MAX_PLAYERS}`;

        const startBtn = $('party-start-btn');
        startBtn.disabled = players.length < 1 || this.starting;
        if (!this.starting) {
            this.setStatus($('lobby-status'), players.length < 1
                ? 'Esperando jugadores…'
                : `${players.length} ${players.length === 1 ? 'jugador listo' : 'jugadores listos'} · ${this.total} juegos`);
        }
    }

    setGames(count) {
        if (!this.socket || !this.socket.connected) return;
        document.querySelectorAll('.games-selector .games-btn').forEach((btn) => { btn.disabled = true; });
        this.socket.emit('party-set-games', count, (response) => {
            if (response && response.success && Number.isFinite(response.total)) {
                this.total = response.total;
            } else {
                console.warn('[Party] Could not change the number of games:', response);
            }
            this.updateGameSelectors();
            if (!this.params) this.renderPlayers();
        });
    }

    startParty(button, statusEl) {
        if (this.starting || !this.socket || !this.socket.connected) return;
        this.starting = true;
        button.disabled = true;
        this.setStatus(statusEl, 'Barajando juegos…');

        // Dev/testing: ?seq=sumo,race forces the sequence (the server validates the modes)
        const seq = new URLSearchParams(window.location.search).get('seq');
        const startData = seq ? { sequence: seq.split(',').map(s => s.trim()).filter(Boolean) } : {};
        this.socket.emit('party-start', startData, (response) => {
            if (response && response.success) {
                const games = Array.isArray(response.games) ? response.games : [];
                const first = games[0];
                const label = first ? partyModeLabel(first, { emoji: false }).toUpperCase() : 'EL PRIMER JUEGO';
                this.clearHistory();
                this.setStatus(statusEl, `Juegos: ${games.map((g) => partyModeLabel(g)).join(' · ')}`, 'ok');
                this.showOverlay(`Preparando ${label}…`);
                // 'party-go' arrives next; installParty() navigates
            } else {
                const error = (response && response.error) || 'No se pudo empezar la fiesta';
                console.error('[Party] party-start failed:', response);
                this.starting = false;
                button.disabled = false;
                this.setStatus(statusEl, error, 'error');
                if (!this.params) this.renderPlayers();
            }
        });
    }

    // =========================================================
    // SCORES / FINAL
    // =========================================================

    attachToParty() {
        const { roomCode, token } = this.params;
        this.socket.emit('party-attach-host', { roomCode, token, page: 'scores' }, (response) => {
            if (!response || !response.success) {
                console.error('[Party] Could not attach to the party room:', response);
                this.showClosed('No se pudo retomar la fiesta', `${(response && response.error) || 'La sala ya no existe'}. Vuelve al menú para crear otra.`);
                return;
            }
            this.roomCode = response.roomCode || roomCode;
            this.renderParty(response.party);
        });
    }

    renderParty(party) {
        if (!party || this.closed) return;
        this.party = party;
        if (Number.isFinite(party.total)) this.total = party.total;
        this.rememberResult(party);

        if (party.state === 'finished') {
            this.renderFinal(party);
        } else {
            this.renderScores(party);
        }
    }

    renderScores(party) {
        const gameNo = (Number.isFinite(party.index) ? party.index : 0) + 1;
        const total = party.total || (Array.isArray(party.games) ? party.games.length : gameNo);
        const last = party.lastResult || {};
        const mode = last.gameMode || (Array.isArray(party.games) ? party.games[party.index] : null);
        const scores = Array.isArray(party.scores) ? party.scores : [];
        const colorOf = (id) => (scores.find((s) => s.id === id) || {}).color || '#888';

        this.setHeaderInfo(`SALA ${this.roomCode} · JUEGO ${gameNo}/${total}`);
        $('scores-game-no').textContent = `JUEGO ${gameNo}/${total}`;
        $('scores-title').innerHTML = `${partyModeLabel(mode)} <small>terminado</small>`;

        // Winner + ranking of the game that just ended
        const winnerEl = $('scores-winner');
        winnerEl.classList.toggle('tie', !last.winnerName);
        winnerEl.textContent = last.winnerName || 'Nadie ganó';
        // Re-trigger the pop animation on refresh
        winnerEl.style.animation = 'none';
        void winnerEl.offsetWidth;
        winnerEl.style.animation = '';

        const ranking = Array.isArray(last.ranking) ? [...last.ranking] : [];
        ranking.sort((a, b) => (a.placement || 99) - (b.placement || 99));
        $('scores-ranking').innerHTML = ranking.map((r, i) => {
            const place = r.placement || i + 1;
            const medal = MEDALS[place - 1] || `${place}º`;
            const pts = Number(r.points) || 0;
            return `
                <li style="--player-color:${escapeHtml(colorOf(r.id))}; animation-delay:${0.1 + i * 0.08}s">
                    <span class="place">${medal}</span>
                    <span class="name">${escapeHtml(r.name)}</span>
                    <span class="pts">+${pts}</span>
                </li>`;
        }).join('') || '<li class="empty"><span class="place">–</span><span class="name">Sin resultados</span><span class="pts"></span></li>';

        this.renderBars(scores);

        // Countdown to the next game (cosmetic: the server's 'party-go' is what navigates)
        const nextMode = party.nextGame;
        const nextEl = $('next-mode'); // may be gone once the footer switched to "Preparando…"
        if (nextEl) nextEl.textContent = nextMode ? partyModeLabel(nextMode) : '…';
        this.startCountdown(Number(party.nextInMs) || 0, nextMode);

        this.showView('scores');
    }

    renderBars(scores) {
        const container = $('scores-bars');
        const max = Math.max(1, ...scores.map((s) => Number(s.points) || 0));
        const top = scores.length ? Math.max(...scores.map((s) => Number(s.points) || 0)) : 0;

        container.innerHTML = scores.map((s, i) => {
            const points = Number(s.points) || 0;
            const delta = Number(s.delta) || 0;
            const pct = Math.max(2, Math.round((points / max) * 100));
            const leader = top > 0 && points === top;
            return `
                <div class="bar-row ${leader ? 'leader' : ''}" style="--player-color:${escapeHtml(s.color || '#888')}">
                    <span class="bar-rank">${leader ? '👑' : i + 1}</span>
                    <span class="bar-swatch"></span>
                    <span class="bar-name">${escapeHtml(s.name)}</span>
                    <div class="bar-track">
                        <div class="bar-fill" data-pct="${pct}"></div>
                        ${delta > 0 ? `<span class="bar-delta" data-pct="${pct}">+${delta}</span>` : ''}
                    </div>
                    <span class="bar-points">${points}</span>
                </div>`;
        }).join('') || '<div class="status-line">Sin jugadores</div>';

        // Grow the bars on the next frame so the width transition plays
        requestAnimationFrame(() => requestAnimationFrame(() => {
            container.querySelectorAll('.bar-fill').forEach((el) => { el.style.width = `${el.dataset.pct}%`; });
            container.querySelectorAll('.bar-delta').forEach((el) => { el.style.setProperty('--fill', `${el.dataset.pct}%`); });
        }));
    }

    startCountdown(ms, nextMode) {
        this.stopCountdown();
        const fill = $('next-progress-fill');
        const secsEl = $('next-secs');
        const textEl = $('next-text');

        if (!nextMode || ms <= 0) {
            textEl.innerHTML = nextMode
                ? `Preparando <b>${partyModeLabel(nextMode)}</b>…`
                : 'Preparando el siguiente juego…';
            fill.style.transition = 'none';
            fill.style.width = '100%';
            return;
        }

        textEl.innerHTML = `Siguiente: <b>${partyModeLabel(nextMode)}</b> en <span id="next-secs" class="next-secs">${Math.ceil(ms / 1000)}</span> s`;
        const liveSecs = $('next-secs') || secsEl;

        fill.style.transition = 'none';
        fill.style.width = '100%';
        void fill.offsetWidth;
        fill.style.transition = `width ${ms}ms linear`;
        fill.style.width = '0%';

        const deadline = Date.now() + ms;
        const tick = () => {
            const left = Math.max(0, deadline - Date.now());
            liveSecs.textContent = String(Math.ceil(left / 1000));
            if (left <= 0) {
                this.stopCountdown();
                textEl.innerHTML = `Preparando <b>${partyModeLabel(nextMode)}</b>…`;
            }
        };
        tick();
        this.countdownTimer = setInterval(tick, 200);
    }

    stopCountdown() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
    }

    renderFinal(party) {
        this.stopCountdown();
        const scores = Array.isArray(party.scores) ? party.scores : [];
        const games = Array.isArray(party.games) ? party.games : [];
        const total = party.total || games.length;
        const champion = scores[0];
        const topPoints = champion ? Number(champion.points) || 0 : 0;

        this.setHeaderInfo(`SALA ${this.roomCode} · ${games.length || total} JUEGOS`);
        $('final-champion').innerHTML = champion
            ? `CAMPEÓN: <b>${escapeHtml(champion.name)}</b> · ${Number(champion.points) || 0} pts`
            : 'Sin jugadores';

        // Podium: 2nd | 1st | 3rd
        const podium = $('podium');
        podium.innerHTML = [1, 0, 2].map((idx) => {
            const s = scores[idx];
            const place = idx + 1;
            if (!s) {
                return `<div class="podium-col place-${place} empty"><div class="podium-medal">${MEDALS[idx]}</div><div class="podium-name">—</div><div class="podium-pts">&nbsp;</div><div class="podium-block">${place}</div></div>`;
            }
            return `
                <div class="podium-col place-${place}" style="--player-color:${escapeHtml(s.color || '#888')}">
                    <div class="podium-medal">${MEDALS[idx]}</div>
                    <div class="podium-name">${escapeHtml(s.name)}</div>
                    <div class="podium-pts">${Number(s.points) || 0} pts</div>
                    <div class="podium-block">${place}</div>
                </div>`;
        }).join('');

        // Full standings
        $('final-table').innerHTML = scores.map((s, i) => {
            const points = Number(s.points) || 0;
            const leader = topPoints > 0 && points === topPoints;
            return `
                <tr class="${leader ? 'leader' : ''}" style="--player-color:${escapeHtml(s.color || '#888')}; animation-delay:${0.3 + i * 0.08}s">
                    <td class="t-rank">${MEDALS[i] || i + 1}</td>
                    <td class="t-name">${escapeHtml(s.name)}</td>
                    <td class="t-pts">${points}</td>
                </tr>`;
        }).join('') || '<tr><td class="t-name">Sin jugadores</td></tr>';

        // Games played with their winner (server history > what this page saw > last result)
        const history = this.mergedHistory(party);
        $('final-games').innerHTML = games.map((mode, i) => {
            const entry = history[i];
            const winner = entry && entry.winnerName;
            return `
                <li>
                    <span class="g-no">${i + 1}</span>
                    <span class="g-mode">${partyModeLabel(mode)}
                        <span class="g-winner ${winner ? '' : 'none'}">${winner ? `🏆 ${escapeHtml(winner)}` : '—'}</span>
                    </span>
                </li>`;
        }).join('') || '<li><span class="g-no">–</span><span class="g-mode">Sin juegos</span></li>';

        this.updateGameSelectors();
        this.starting = false;
        $('party-again-btn').disabled = false;
        this.setStatus($('final-status'), '');
        this.hideOverlay();
        this.spawnConfetti();
        this.showView('final');
    }

    spawnConfetti() {
        if (this.confettiDone) return;
        this.confettiDone = true;
        const box = $('confetti');
        const pieces = [];
        for (let i = 0; i < 70; i++) {
            const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
            const left = Math.random() * 100;
            const duration = 4 + Math.random() * 4;
            const delay = -Math.random() * 8;
            const w = 0.4 + Math.random() * 0.5;
            const round = Math.random() < 0.3 ? 'border-radius:50%;' : '';
            pieces.push(`<i style="left:${left.toFixed(1)}%;background:${color};width:${w.toFixed(2)}rem;height:${(w * 1.6).toFixed(2)}rem;animation-duration:${duration.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s;${round}"></i>`);
        }
        box.innerHTML = pieces.join('');
    }

    // ---- Per-game history (so the final view can list every winner even if the server
    //      only reports the last result) ----

    historyKey() {
        return `party-history:${this.roomCode}:${this.token}`;
    }

    loadHistory() {
        try {
            const raw = sessionStorage.getItem(this.historyKey());
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    rememberResult(party) {
        if (!party.lastResult || !Number.isFinite(party.index)) return;
        try {
            const history = this.loadHistory();
            history[party.index] = {
                gameMode: party.lastResult.gameMode,
                winnerName: party.lastResult.winnerName || null
            };
            sessionStorage.setItem(this.historyKey(), JSON.stringify(history));
        } catch (e) {
            /* sessionStorage unavailable: the final list simply shows fewer winners */
        }
    }

    clearHistory() {
        try { sessionStorage.removeItem(this.historyKey()); } catch (e) { /* ignore */ }
    }

    mergedHistory(party) {
        const local = this.loadHistory();
        const server = Array.isArray(party.history) ? party.history : [];
        const games = Array.isArray(party.games) ? party.games : [];
        const out = [];
        for (let i = 0; i < games.length; i++) {
            out[i] = server[i] || local[i] || null;
        }
        if (party.lastResult && Number.isFinite(party.index) && !out[party.index]) {
            out[party.index] = { gameMode: party.lastResult.gameMode, winnerName: party.lastResult.winnerName || null };
        }
        return out;
    }
}

function boot() {
    window.partyGame = new PartyGame();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
