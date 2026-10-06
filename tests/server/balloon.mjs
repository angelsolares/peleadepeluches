// Socket smoke test for Infla el Globo (hold-to-blow, tie, pop, ranking) against a real server.
//   node tests/server/balloon.mjs   (TEST_SERVER_URL or http://localhost:3001)
import { io } from 'socket.io-client';
import { check, summary } from '../helpers/check.mjs';

const URL = process.env.TEST_SERVER_URL || 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ack = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...a);

// ---- host + bots ----
const mk = () => io(URL, { transports: ['websocket'] });
const host = mk(), A = mk(), B = mk(), C = mk();
for (const s of [host, A, B, C]) if (!s.connected) await new Promise(r => s.once('connect', r));

const created = await ack(host, 'create-room', { gameMode: 'balloon' });
check('create-room (balloon)', created.success, created.roomCode);
const ROOM = created.roomCode;

for (const [s, name, ch] of [[A, 'Calma', 'edgar'], [B, 'Loco', 'lia'], [C, 'Viejo', 'jesus']]) {
    const j = await ack(s, 'join-room', { roomCode: ROOM, playerName: name });
    check(`join-room ${name}`, j.success, j.error || '');
    await ack(s, 'select-character', { characterId: ch, characterName: ch });
    await ack(s, 'player-ready', true);
}

// State tracking
const latest = { host: null, A: null, B: null, C: null };
let hostStates = 0;
let gameOver = null;
let sawFields = false, sawBlowing = false, sawTension = false, sawLungDrop = false;
host.on('balloon-state', st => {
    hostStates++;
    latest.host = st;
    const a = st.players.find(p => p.id === A.id);
    if (a && ['lung', 'tension', 'tied', 'blowing', 'progress', 'balloonSize', 'isDQ'].every(k => k in a)) sawFields = true;
    if (st.players.some(p => p.blowing)) sawBlowing = true;
    if (st.players.some(p => p.tension > 0)) sawTension = true;
    if (st.players.some(p => p.lung < 60)) sawLungDrop = true;
});
host.on('balloon-game-over', d => { gameOver = d; log('balloon-game-over', d.endReason, d.winner?.name); });
A.on('balloon-state', st => { latest.A = st.players.find(p => p.id === A.id); });
B.on('balloon-state', st => { latest.B = st.players.find(p => p.id === B.id); });
C.on('balloon-state', st => { latest.C = st.players.find(p => p.id === C.id); });

let started = false;
A.on('game-started', d => { started = true; log('game-started', d.gameMode, d.players?.length, 'players'); });
const startAck = await ack(host, 'start-game');
check('start-game accepted', startAck.success, startAck.error || '');
for (let i = 0; i < 50 && !started; i++) await sleep(100);
check('phones got game-started', started);

// Bot A: breathes in bursts (hold 1.3 s / release 1.0 s) and ties at ~60
const botA = (async () => {
    while (!gameOver && !(latest.A?.tied) && !(latest.A?.isDQ)) {
        A.emit('balloon-blow', true);
        const tHold = Date.now() + 1300;
        while (Date.now() < tHold && !gameOver && (latest.A?.balloonSize ?? 0) < 60) await sleep(30);
        A.emit('balloon-blow', false);
        if ((latest.A?.balloonSize ?? 0) >= 60) {
            const sizeAtTie = latest.A.balloonSize;
            const res = await ack(A, 'balloon-tie');
            log('A ties at', sizeAtTie.toFixed(1), res);
            check('balloon-tie acked success', res?.success === true);
            return sizeAtTie;
        }
        await sleep(1000);
    }
    return null;
})();

// Bot B: blows until it pops (holds while it has air, releases to refill)
const botB = (async () => {
    while (!gameOver && !(latest.B?.isDQ)) {
        B.emit('balloon-blow', true);
        while (!gameOver && !(latest.B?.isDQ) && (latest.B?.lung ?? 100) > 0) await sleep(30);
        B.emit('balloon-blow', false);
        while (!gameOver && !(latest.B?.isDQ) && (latest.B?.lung ?? 0) < 95) await sleep(30);
    }
    if (latest.B?.isDQ) log('B popped at', latest.B.balloonSize.toFixed(1));
})();

// Bot C: old client, taps 'balloon-inflate' for 2 s, then ties whatever it has
const botC = (async () => {
    for (let i = 0; i < 40 && !gameOver; i++) { C.emit('balloon-inflate'); await sleep(50); }
    const tapSize = latest.C?.balloonSize ?? 0;
    check('Legacy balloon-inflate taps still inflate a little', tapSize > 1 && tapSize < 12, `size=${tapSize.toFixed(1)}`);
    await sleep(1500);
    const res = await ack(C, 'balloon-tie');
    log('C ties at', (latest.C?.balloonSize ?? 0).toFixed(1), res);
})();

const [aTieSize] = await Promise.all([botA, botB, botC]);

// Wait for the end (everyone tied/popped should end it before the 30 s timer)
for (let i = 0; i < 400 && !gameOver; i++) await sleep(100);
const matchTime = (Date.now() - t0) / 1000;

check('balloon-state ticks arrived at the host (~60 Hz)', hostStates > 200, `${hostStates} states`);
check('State carries lung/tension/tied/blowing/progress/balloonSize/isDQ', sawFields);
check('Saw blowing=true while a button was held', sawBlowing);
check('Saw lungs drain below 60', sawLungDrop);
check('Saw tension > 0 (someone passed 70)', sawTension);
check('A tied in the state', latest.A?.tied === true, `A size=${latest.A?.balloonSize?.toFixed(1)} lung=${latest.A?.lung}`);
check('A tie locked the size (no deflation after tying)', aTieSize !== null && latest.A && Math.abs(latest.A.balloonSize - aTieSize) < 1.0, `tie=${aTieSize?.toFixed(1)} final=${latest.A?.balloonSize?.toFixed(1)}`);
check('B popped (isDQ) between 85 and 95', latest.B?.isDQ === true && latest.B.balloonSize >= 85 && latest.B.balloonSize <= 95, `B size=${latest.B?.balloonSize?.toFixed(1)}`);
check('balloon-game-over arrived', !!gameOver, gameOver ? `reason=${gameOver.endReason}` : 'none');
if (gameOver) {
    check('Game ended because everyone was tied or popped', gameOver.endReason === 'all-tied', gameOver.endReason);
    check('Winner is A (largest non-popped)', gameOver.winner?.id === A.id, JSON.stringify(gameOver.winner));
    const r = gameOver.results || [];
    check('results has every player', r.length === 3, JSON.stringify(r));
    const sorted = r.every((x, i) => i === 0 || (r[i - 1].isDQ - x.isDQ) < 0 || (r[i - 1].isDQ === x.isDQ && r[i - 1].balloonSize >= x.balloonSize));
    check('results sorted (survivors by size desc, popped last)', sorted && r[0].id === A.id && r[2].id === B.id && r[2].isDQ);
    check('result rows: name, rounded size, tied, isDQ', r.every(x => typeof x.name === 'string' && Number.isInteger(x.balloonSize) && typeof x.tied === 'boolean' && typeof x.isDQ === 'boolean'));
}
check('Match ended before the 30 s timer', matchTime < 32, `${matchTime.toFixed(1)}s`);

// The loop stops at the end: no more state ticks, late actions are ignored
A.emit('balloon-blow', true);
const nStates = hostStates;
await sleep(400);
check('No balloon-state after game over', hostStates === nStates);

summary();
for (const s of [host, A, B, C]) s?.close();
process.exit();
