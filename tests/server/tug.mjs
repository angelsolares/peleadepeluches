// Tug of War rhythm smoke test against a real server.
//   node tests/server/tug.mjs [bots=4]   (TEST_SERVER_URL or http://localhost:3001)
// Host creates a tug room, bots join and ready up, host starts. Bots on the LEFT team pull on
// the beat (using serverTime/nextPulseTime from tug-state); bots on the RIGHT team mash.
// Asserts the new protocol fields arrive, left syncCombo/streak grow, right never syncs,
// the rope moves left and the match ends with 'tug-game-over'.
import { io } from 'socket.io-client';
import { check, summary } from '../helpers/check.mjs';

const BOTS = Number(process.argv[2] || 4);
const URL = process.env.TEST_SERVER_URL || 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ack = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));
const log = (...a) => console.log(`[${new Date().toISOString().slice(14, 23)}]`, ...a);
const connect = () => new Promise((res, rej) => {
    const s = io(URL, { transports: ['websocket'] });
    s.once('connect', () => res(s));
    s.once('connect_error', rej);
});

const host = await connect();
const created = await ack(host, 'create-room', { gameMode: 'tug' });
check('create-room (tug)', created.success === true, created.roomCode);
const roomCode = created.roomCode;

const chars = ['edgar', 'lia', 'hector', 'katy', 'sol', 'angel', 'jesus', 'isabella'];
const bots = [];
for (let i = 0; i < BOTS; i++) {
    const s = await connect();
    const j = await ack(s, 'join-room', { roomCode, playerName: `Bot${i + 1}` });
    const c = await ack(s, 'select-character', { characterId: chars[i % chars.length], characterName: chars[i % chars.length] });
    const r = await ack(s, 'player-ready', true);
    if (!j.success || !c.success || !r.success) log('bot setup failed', i, j.error, c.error, r.error);
    bots.push({ s, name: `Bot${i + 1}`, team: null, offset: 0, scheduledBeat: -1, mashTimer: null });
}
check(`${BOTS} bots joined, picked a character and readied`, bots.length === BOTS);

// Stats collected from the host's view of tug-state
const stats = {
    states: 0, fieldsOk: 0, maxLeftCombo: 0, maxRightCombo: 0, maxLeftStreak: 0, maxRightStreak: 0,
    perfect: 0, good: 0, mashed: 0, minMarker: 0, maxMarker: 0, beats: new Set(), lastBeat: -1, beatJumps: 0,
    minSyncRatioLeft: 1, pulseInterval: 0
};
let gameOver = null;
let started = false;

host.on('game-started', (d) => {
    started = true;
    for (const p of d.players || []) {
        const b = bots.find(b => b.s.id === p.id);
        if (b) b.team = p.team;
    }
    log('game-started; teams:', bots.map(b => `${b.name}=${b.team}`).join(' '));
});
host.on('tug-state', (st) => {
    stats.states++;
    const ok = typeof st.serverTime === 'number' && typeof st.pulseInterval === 'number' && typeof st.nextPulseTime === 'number'
        && typeof st.beat === 'number' && st.teams && st.teams.left && st.teams.right
        && typeof st.teams.left.syncCombo === 'number' && typeof st.teams.left.syncRatio === 'number' && typeof st.teams.left.size === 'number'
        && st.players.every(p => typeof p.streak === 'number' && typeof p.pullQuality === 'number');
    if (ok) stats.fieldsOk++;
    stats.pulseInterval = st.pulseInterval;
    if (st.gameState !== 'active') return;
    if (st.beat !== stats.lastBeat) {
        if (stats.lastBeat >= 0 && st.beat !== stats.lastBeat + 1) stats.beatJumps++;
        stats.lastBeat = st.beat;
        stats.beats.add(st.beat);
        if (st.beat >= 2) stats.minSyncRatioLeft = Math.min(stats.minSyncRatioLeft, st.teams.left.syncRatio);
    }
    stats.maxLeftCombo = Math.max(stats.maxLeftCombo, st.teams.left.syncCombo);
    stats.maxRightCombo = Math.max(stats.maxRightCombo, st.teams.right.syncCombo);
    stats.minMarker = Math.min(stats.minMarker, st.markerPos);
    stats.maxMarker = Math.max(stats.maxMarker, st.markerPos);
    for (const p of st.players) {
        if (p.team === 'left') stats.maxLeftStreak = Math.max(stats.maxLeftStreak, p.streak);
        else stats.maxRightStreak = Math.max(stats.maxRightStreak, p.streak);
        if (p.pullQuality === 2) stats.perfect++;
        if (p.pullQuality === 1) stats.good++;
        if (p.mashed) stats.mashed++;
    }
});
host.on('tug-game-over', (d) => { gameOver = d; log('tug-game-over winner =', d.winnerTeam, 'marker =', d.markerPos?.toFixed(1)); });

// Bots: left pulls on the beat (scheduled from the server clock), right mashes
for (const b of bots) {
    b.s.on('tug-state', (st) => {
        if (typeof st.serverTime === 'number') b.offset = st.serverTime - Date.now();
        if (st.gameState !== 'active' || !b.team) return;
        if (b.team === 'left') {
            const nextBeat = st.beat + 1;
            if (b.scheduledBeat >= nextBeat) return;
            b.scheduledBeat = nextBeat;
            const delay = Math.max(0, st.nextPulseTime - b.offset - Date.now());
            setTimeout(() => b.s.emit('tug-pull'), delay);
        } else if (!b.mashTimer) {
            // Start off-beat (the first active state is exactly pulse 0, a legitimate hit otherwise)
            b.mashTimer = setTimeout(() => { b.mashTimer = setInterval(() => b.s.emit('tug-pull'), 120); }, 400);
        }
    });
}

await sleep(500);
const st = await ack(host, 'start-game');
check('start-game from the host', st.success === true, st.error || '');

const t0 = Date.now();
while (!gameOver && Date.now() - t0 < 75000) await sleep(250);
for (const b of bots) if (b.mashTimer) { clearInterval(b.mashTimer); clearTimeout(b.mashTimer); }

const leftBots = bots.filter(b => b.team === 'left').length;
const rightBots = bots.filter(b => b.team === 'right').length;
log(`stats: states=${stats.states} fieldsOk=${stats.fieldsOk} beats=${stats.beats.size} beatJumps=${stats.beatJumps} interval=${stats.pulseInterval}`);
log(`       leftCombo max=${stats.maxLeftCombo} rightCombo max=${stats.maxRightCombo} leftStreak max=${stats.maxLeftStreak} rightStreak max=${stats.maxRightStreak}`);
log(`       perfect ticks=${stats.perfect} good ticks=${stats.good} mashed ticks=${stats.mashed} marker min=${stats.minMarker.toFixed(1)} max=${stats.maxMarker.toFixed(1)} minLeftSyncRatio=${stats.minSyncRatioLeft}`);

check('Game started with both teams filled', started && leftBots >= 1 && rightBots >= 1, `left=${leftBots} right=${rightBots}`);
check('Every tug-state carries serverTime/pulseInterval/nextPulseTime/beat/teams/streak', stats.states > 0 && stats.fieldsOk === stats.states, `${stats.fieldsOk}/${stats.states}`);
check('Beats advance one by one (anchored schedule)', stats.beats.size >= 5 && stats.beatJumps === 0, `beats=${stats.beats.size}`);
check('On-beat bots land perfect pulls', stats.perfect >= 5, `perfect=${stats.perfect}`);
check('Left (on-beat) syncCombo grows to >= 3', stats.maxLeftCombo >= 3, `max=${stats.maxLeftCombo}`);
check('Left streak grows to >= 3', stats.maxLeftStreak >= 3, `max=${stats.maxLeftStreak}`);
check('Right (mashing) never builds a sync combo or a streak', stats.maxRightCombo === 0 && stats.maxRightStreak === 0, `combo=${stats.maxRightCombo} streak=${stats.maxRightStreak}`);
check('Mashing is flagged (mashed ticks > 0)', stats.mashed > 0, `mashed=${stats.mashed}`);
check('Rope moves toward the left team', stats.minMarker <= -30, `min=${stats.minMarker.toFixed(1)}`);
check('tug-game-over arrives with left as winner and the new fields', !!gameOver && gameOver.winnerTeam === 'left' && gameOver.teams && typeof gameOver.beat === 'number', gameOver ? `winner=${gameOver.winnerTeam} in ${((Date.now() - t0) / 1000).toFixed(1)}s` : 'no game over');

// Rematch: a fresh round must start with reset beat/sync state
let starts = 0, freshState = null;
host.on('game-started', () => { starts++; });
host.once('round-starting', () => { host.once('tug-state', (s) => { freshState = s; }); });
const rematch = await ack(bots[0].s, 'request-rematch');
const t1 = Date.now();
while (!(starts >= 1 && freshState) && Date.now() - t1 < 10000) await sleep(200);
check('Rematch restarts the match with reset beat and sync combos',
    rematch?.success === true && starts >= 1 && !!freshState && freshState.beat === -1 && freshState.gameState === 'countdown'
    && freshState.teams.left.syncCombo === 0 && freshState.teams.right.syncCombo === 0 && freshState.players.every(p => p.streak === 0),
    freshState ? `beat=${freshState.beat} state=${freshState.gameState}` : JSON.stringify(rematch));

host.close();
for (const b of bots) b.s.close();
summary();
process.exit();
