/**
 * PartyClient - what a host page needs to take part in "Modo Fiesta".
 *
 * In a party the host screen chains several minigames: party.html creates the room, the
 * server picks the sequence and tells the host which page to open for each game
 * ('party-go' { url }). Each game page, instead of creating a new room, re-attaches to the
 * existing one ('party-attach-host') using the roomCode + token from its URL; the server
 * then starts the match on its own (no click needed), and when it ends sends the host to
 * party.html for the scoreboard, then to the next game.
 *
 *   import { openRoom, installParty } from '../party/PartyClient.js';
 *   installParty(socket);                          // once, after creating the socket
 *   openRoom(socket, 'sumo', { isBabyShower }, (response) => { ... });  // instead of 'create-room'
 */

/** Party parameters from the page URL (null when this is a normal, standalone match) */
export function getPartyParams() {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('party');
    const token = params.get('token');
    if (!roomCode || !token) return null;
    return { roomCode: roomCode.toUpperCase(), token };
}

export function isPartyMode() {
    return getPartyParams() !== null;
}

/**
 * Create a room, or re-attach to the party room this page was opened for.
 * The callback gets the same shape in both cases: { success, roomCode, error?, party? }.
 */
export function openRoom(socket, gameMode, options = {}, callback) {
    const party = getPartyParams();
    if (!party) {
        socket.emit('create-room', { gameMode, ...options }, callback);
        return;
    }
    socket.emit('party-attach-host', { roomCode: party.roomCode, token: party.token, page: gameMode }, (response) => {
        if (response && response.success) {
            document.body.classList.add('party-mode');
            renderPartyBadge(response.party);
        } else {
            console.error('[Party] Could not attach to the party room:', response);
            showPartyError(response && response.error);
        }
        if (typeof callback === 'function') callback(response);
    });
}

/**
 * Listen for the party events every host page needs:
 *  - 'party-go'   { url }      -> navigate (next game / scoreboard)
 *  - 'party-info' { ... }      -> refresh the badge (game i/n, standings)
 */
export function installParty(socket) {
    socket.on('party-go', (data) => {
        if (data && data.url) {
            console.log('[Party] Going to', data.url);
            window.location.href = data.url;
        }
    });
    socket.on('party-info', (info) => {
        document.body.classList.add('party-mode');
        renderPartyBadge(info);
    });
    if (isPartyMode()) document.body.classList.add('party-mode');
}

/** Small fixed badge: "🎉 FIESTA · Juego 2/5" plus the top three standings */
export function renderPartyBadge(info) {
    if (!info) return;
    let badge = document.getElementById('party-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'party-badge';
        badge.innerHTML = '<div class="party-badge-title"></div><div class="party-badge-scores"></div>';
        document.body.appendChild(badge);
    }
    const title = badge.querySelector('.party-badge-title');
    const scores = badge.querySelector('.party-badge-scores');
    const gameNo = typeof info.index === 'number' ? info.index + 1 : null;
    const titleText = gameNo ? `🎉 FIESTA · Juego ${gameNo}/${info.total}` : '🎉 FIESTA';
    if (title.textContent !== titleText) title.textContent = titleText;
    const top = Array.isArray(info.scores) ? info.scores.slice(0, 3) : [];
    const html = top.map((s, i) => `<span>${['🥇', '🥈', '🥉'][i]} ${escapeHtml(s.name)} <b>${s.points}</b></span>`).join('');
    if (scores.innerHTML !== html) scores.innerHTML = html;
}

function showPartyError(error) {
    const div = document.createElement('div');
    div.id = 'party-error';
    div.textContent = `No se pudo retomar la fiesta (${error || 'error'}). Vuelve al menú.`;
    document.body.appendChild(div);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}
