// La Trae (tag) power-up smoke test against a real server.
//   node tests/server/tag.mjs [bots=3]   (TEST_SERVER_URL or http://localhost:3001)
// Host creates a tag room, bots join and ready up, host starts. Bots walk toward the
// power-up whenever one is on the map (from tag-state.powerUp). Asserts the new state
// fields arrive, at least one 'tag-powerup' spawn and one collect happen, and the match
// keeps running. Ends after ~40 s (the match itself lasts 120 s).
import { connect, ack, sleep } from '../helpers/server.mjs';
import { check, summary } from '../helpers/check.mjs';

const BOTS = Number(process.argv[2] || 3);
const RUN_MS = 40000;
const log = (...a) => console.log(`[${new Date().toISOString().slice(14, 23)}]`, ...a);

const host = await connect();
const created = await ack(host, 'create-room', { gameMode: 'tag' });
check('create-room (tag)', created.success === true, created.roomCode);
const roomCode = created.roomCode;

const chars = ['edgar', 'lia', 'hector', 'katy', 'sol', 'angel', 'jesus', 'isabella'];
const bots = [];
for (let i = 0; i < BOTS; i++) {
    const s = await connect();
    const j = await ack(s, 'join-room', { roomCode, playerName: `Bot${i + 1}` });
    const c = await ack(s, 'select-character', { characterId: chars[i % chars.length], characterName: chars[i % chars.length] });
    const r = await ack(s, 'player-ready', true);
    if (!j.success || !c.success || !r.success) log('bot setup failed', i, j.error, c.error, r.error);
    bots.push({ s, name: `Bot${i + 1}`, input: null, collected: 0 });
}
check(`${BOTS} bots joined, picked a character and readied`, bots.length === BOTS);

// Stats from the host's view
const stats = {
    states: 0, fieldsOk: 0, statesWithPowerUp: 0, powerUpIds: new Set(), powerUpInBounds: true,
    boostedTicks: 0, shieldedTicks: 0, kinds: new Set(), lastStateAt: 0, firstStateAt: 0,
    minRemaining: Infinity, transfers: 0
};
const events = [];
let gameOver = null;
let started = false;

host.on('game-started', () => { started = true; log('game-started'); });
host.on('tag-state', (st) => {
    const now = Date.now();
    stats.states++;
    if (!stats.firstStateAt) stats.firstStateAt = now;
    stats.lastStateAt = now;
    if (st.gameState !== 'active' || !Array.isArray(st.players)) return;
    stats.minRemaining = Math.min(stats.minRemaining, st.remainingTime);
    const ok = 'powerUp' in st && st.players.every(p =>
        typeof p.boosted === 'boolean' && typeof p.shielded === 'boolean'
        && typeof p.boostMsLeft === 'number' && typeof p.shieldMsLeft === 'number' && typeof p.hasGrace === 'boolean');
    if (ok) stats.fieldsOk++;
    if (st.powerUp) {
        stats.statesWithPowerUp++;
        stats.powerUpIds.add(st.powerUp.id);
        stats.kinds.add(st.powerUp.kind);
        const { x, z } = st.powerUp.position;
        if (!(Math.abs(x) <= 8 && Math.abs(z) <= 8) || typeof st.powerUp.expiresAt !== 'number') stats.powerUpInBounds = false;
    }
    for (const p of st.players) {
        if (p.boosted) stats.boostedTicks++;
        if (p.shielded) stats.shieldedTicks++;
    }
});
host.on('tag-powerup', (ev) => {
    events.push(ev);
    log('tag-powerup', ev.type, ev.kind, ev.playerName || '');
    if (ev.type === 'collect') {
        const b = bots.find(b => b.s.id === ev.playerId);
        if (b) b.collected++;
    }
});
host.on('tag-transfer', () => { stats.transfers++; });
host.on('tag-game-over', (d) => { gameOver = d; });

// Bots: walk toward the power-up when there is one, otherwise stand still
const DIRS = ['left', 'right', 'up', 'down'];
const sameInput = (a, b) => a && b && DIRS.every(k => a[k] === b[k]);
for (const b of bots) {
    b.s.on('tag-state', (st) => {
        if (st.gameState !== 'active' || !Array.isArray(st.players)) return;
        const me = st.players.find(p => p.id === b.s.id);
        const pu = st.powerUp;
        let input = { left: false, right: false, up: false, down: false, run: false };
        if (me && pu && !(pu.kind === 'escudo' && me.isIt)) {
            const dx = pu.position.x - me.position.x;
            const dz = pu.position.z - me.position.z;
            input = { left: dx < -0.3, right: dx > 0.3, up: dz < -0.3, down: dz > 0.3, run: false };
        }
        if (!sameInput(input, b.input)) {
            b.input = input;
            b.s.emit('player-input', input);
        }
    });
}

await sleep(500);
const st = await ack(host, 'start-game');
check('start-game from the host', st.success === true, st.error || '');

const t0 = Date.now();
while (!gameOver && Date.now() - t0 < RUN_MS) await sleep(250);

const spawns = events.filter(e => e.type === 'spawn');
const collects = events.filter(e => e.type === 'collect');
const expires = events.filter(e => e.type === 'expire');
log(`stats: states=${stats.states} fieldsOk=${stats.fieldsOk} withPowerUp=${stats.statesWithPowerUp} ids=${stats.powerUpIds.size} kinds=${[...stats.kinds].join('/')}`);
log(`       spawns=${spawns.length} collects=${collects.length} expires=${expires.length} boostedTicks=${stats.boostedTicks} shieldedTicks=${stats.shieldedTicks} transfers=${stats.transfers}`);
log(`       collected per bot: ${bots.map(b => `${b.name}=${b.collected}`).join(' ')} remaining=${(stats.minRemaining / 1000).toFixed(1)}s`);

check('Game started and tag-state keeps arriving', started && stats.states > 500, `states=${stats.states}`);
check('Every active tag-state carries powerUp + boosted/shielded/boostMsLeft/shieldMsLeft', stats.fieldsOk > 0 && stats.fieldsOk === stats.states, `${stats.fieldsOk}/${stats.states}`);
check('At least one tag-powerup spawn arrived (with id + kind)', spawns.length >= 1 && spawns.every(e => typeof e.id === 'string' && ['rayo', 'escudo'].includes(e.kind)), `spawns=${spawns.length}`);
check('State showed the power-up inside the boundary with expiresAt', stats.statesWithPowerUp > 0 && stats.powerUpInBounds, `withPowerUp=${stats.statesWithPowerUp}`);
check('At least one tag-powerup collect arrived (playerId/playerName)', collects.length >= 1 && collects.every(e => typeof e.playerId === 'string' && typeof e.playerName === 'string'), `collects=${collects.length}`);
check('Collect events match a bot and its effect showed in the state', collects.length >= 1 && bots.some(b => b.collected > 0) && (stats.boostedTicks + stats.shieldedTicks) > 0, `boosted=${stats.boostedTicks} shielded=${stats.shieldedTicks}`);
check('Power-up ids are unique and every spawn ends in a collect or expiry (at most one pending)', stats.powerUpIds.size === spawns.length && spawns.length - collects.length - expires.length <= 1);
check('Match keeps running after 40 s (no game over, states still arriving)', !gameOver && Date.now() - stats.lastStateAt < 1000 && stats.minRemaining > 60000, `remaining=${(stats.minRemaining / 1000).toFixed(1)}s`);

host.close();
for (const b of bots) b.s.close();
summary();
process.exit();
