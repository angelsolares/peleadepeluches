// Socket smoke test for Flappy (real-delta ticks, serverTime, moving pipes, game over) against a real server.
//   node tests/server/flappy.mjs   (TEST_SERVER_URL or http://localhost:3001)
import { check, summary } from '../helpers/check.mjs';
import { connect, ack, waitFor, sleep } from '../helpers/server.mjs';

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...a);

const PLAYER_X = -5, PIPE_HALF = 1, RADIUS = 0.55;

// ---- host + bots ----
const host = await connect(), A = await connect(), B = await connect();

const created = await ack(host, 'create-room', { gameMode: 'flappy' });
check('create-room (flappy)', created.success, created.roomCode);
const ROOM = created.roomCode;

for (const [s, name, ch] of [[A, 'Alas', 'edgar'], [B, 'Pluma', 'lia']]) {
    const j = await ack(s, 'join-room', { roomCode: ROOM, playerName: name });
    check(`join-room ${name}`, j.success, j.error || '');
    await ack(s, 'select-character', { characterId: ch, characterName: ch });
    await ack(s, 'player-ready', true);
}

// ---- state tracking on the host ----
let hostStates = 0, serverTimes = 0, serverTimeOk = true, allPipesHaveMoving = true;
let sawMovingPipe = null, movedGapY = false, maxDistance = 0;
const movingTrack = new Map(); // pipe id -> { min, max, amplitude, baseGapY }
let gameOver = null, died = null;
host.on('flappy-state', (st) => {
    hostStates++;
    if (typeof st.serverTime === 'number') {
        serverTimes++;
        if (Math.abs(st.serverTime - Date.now()) > 5000) serverTimeOk = false;
    }
    maxDistance = Math.max(maxDistance, st.distance || 0);
    for (const p of st.pipes || []) {
        if (typeof p.moving !== 'boolean') allPipesHaveMoving = false;
        if (p.moving) {
            if (!sawMovingPipe) { sawMovingPipe = { ...p }; log('first moving pipe', p.id, `amp=${p.amplitude?.toFixed(2)} at ${st.distance.toFixed(1)}m`); }
            const t = movingTrack.get(p.id) || { min: p.gapY, max: p.gapY, amplitude: p.amplitude, baseGapY: p.baseGapY };
            t.min = Math.min(t.min, p.gapY); t.max = Math.max(t.max, p.gapY);
            movingTrack.set(p.id, t);
            if (t.max - t.min > 0.5) movedGapY = true;
        }
    }
});
host.on('flappy-player-died', (d) => { died = d; log('flappy-player-died', d.name, `${d.distance.toFixed(1)}m`); });
host.on('flappy-game-over', (d) => { gameOver = d; log('flappy-game-over winner', d.winner?.name); });

// ---- bots: flap when below the gap of the nearest pipe ahead ----
let stopB = false;
function pilot(sock, shouldFly) {
    sock.on('flappy-state', (st) => {
        if (!shouldFly()) return;
        const me = st.players[sock.id];
        if (!me || !me.isAlive) return;
        const ahead = (st.pipes || []).filter((p) => p.x > PLAYER_X - PIPE_HALF - RADIUS).sort((a, b) => a.x - b.x)[0];
        const target = ahead ? ahead.gapY : 1;
        if (me.y < target - 1.4) sock.emit('flappy-tap');
    });
}
pilot(A, () => true);
pilot(B, () => !stopB);

const startedA = waitFor(A, 'game-started', 5000);
const flappyStart = waitFor(host, 'flappy-start', 8000);
const startAck = await ack(host, 'start-game');
check('start-game accepted', startAck.success, startAck.error || '');
check('phones got game-started', !!(await startedA));
check('flappy-start after the countdown', !!(await flappyStart));

// B stops flapping once a moving pipe exists (past 60 m), so the game ends with A alive
for (let i = 0; i < 600 && !gameOver; i++) {
    if (sawMovingPipe && !stopB) { stopB = true; log('B stops flapping at', maxDistance.toFixed(1), 'm'); }
    await sleep(100);
}
const matchTime = (Date.now() - t0) / 1000;

check('flappy-state ticks arrived at the host', hostStates > 100, `${hostStates} states in ${matchTime.toFixed(1)}s`);
check('Every flappy-state carries serverTime (close to now)', serverTimes === hostStates && serverTimeOk, `${serverTimes}/${hostStates}`);
check('Every pipe carries a boolean moving flag', allPipesHaveMoving);
check('Bots passed 60 m', maxDistance > 60, `max distance ${maxDistance.toFixed(1)}m`);
check('A moving pipe appeared (moving=true with amplitude/period/baseGapY)', sawMovingPipe && sawMovingPipe.amplitude >= 1.5 && sawMovingPipe.amplitude <= 2.5 && sawMovingPipe.period >= 2.5 && typeof sawMovingPipe.baseGapY === 'number', sawMovingPipe ? JSON.stringify({ id: sawMovingPipe.id, amplitude: +sawMovingPipe.amplitude.toFixed(2), period: +sawMovingPipe.period.toFixed(2) }) : 'none');
check('Moving pipes change gapY across states', movedGapY, [...movingTrack.values()].map((t) => `${t.min.toFixed(1)}..${t.max.toFixed(1)}`).join(' '));
check('Moving gapY stays within +/- amplitude of baseGapY', [...movingTrack.values()].every((t) => t.min >= t.baseGapY - t.amplitude - 0.01 && t.max <= t.baseGapY + t.amplitude + 0.01));
check('flappy-player-died for B', died && died.playerId === B.id, died ? died.name : 'none');
check('flappy-game-over arrived', !!gameOver, gameOver ? `after ${matchTime.toFixed(1)}s` : 'none');
if (gameOver) {
    check('Winner is A (last one flying)', gameOver.winner?.id === A.id && gameOver.winner.isAlive === true, JSON.stringify(gameOver.winner));
    const r = gameOver.results || [];
    check('results has every player with name/distance/isAlive', r.length === 2 && r.every((x) => typeof x.name === 'string' && typeof x.distance === 'number' && typeof x.isAlive === 'boolean'), JSON.stringify(r));
    check('results sorted: alive first', r[0].id === A.id && r[1].id === B.id);
}

// The loop stops at the end
const nStates = hostStates;
await sleep(400);
check('No flappy-state after game over', hostStates === nStates);

summary();
for (const s of [host, A, B]) s.close();
process.exit();
