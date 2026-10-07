// Race hurdles smoke test against a real server.
//   node tests/server/race.mjs   (TEST_SERVER_URL or http://localhost:3001)
// Host creates a race room, 2 bots join and ready up, host starts. Bot1 taps alternately and
// jumps when its nextHurdleDistance is in the 1.5-5 m window; Bot2 taps but never jumps.
// Asserts the hurdles arrive in 'race-start' and in every 'race-state', the jumper never
// stumbles, the other gets 'race-stumble' and 'race-winner' arrives.
import { connect, ack, waitFor, sleep } from '../helpers/server.mjs';
import { check, summary } from '../helpers/check.mjs';

const log = (...a) => console.log(`[${new Date().toISOString().slice(14, 23)}]`, ...a);

const host = await connect();
const created = await ack(host, 'create-room', { gameMode: 'race' });
check('create-room (race)', created.success === true, created.roomCode);
const roomCode = created.roomCode;

const chars = ['edgar', 'lia'];
const bots = [];
for (let i = 0; i < 2; i++) {
    const s = await connect();
    const j = await ack(s, 'join-room', { roomCode, playerName: `Bot${i + 1}` });
    const c = await ack(s, 'select-character', { characterId: chars[i], characterName: chars[i] });
    const r = await ack(s, 'player-ready', true);
    if (!j.success || !c.success || !r.success) log('bot setup failed', i, j.error, c.error, r.error);
    bots.push({ s, name: `Bot${i + 1}`, jumps: i === 0, tapTimer: null, side: 'left', jumpsSent: 0, stumbles: 0, maxSpeed: 0, sawWindow: false, jumpingSeen: false, stumbledSeen: false });
}
check('2 bots joined, picked a character and readied', bots.length === 2);

// Host view
const stats = { startPayload: null, states: 0, statesWithHurdles: 0, hurdleSig: null, sameHurdles: 0, fieldsOk: 0, stumbleEvents: [], finishes: [] };
let winner = null;
host.on('race-start', (d) => { stats.startPayload = d; log('race-start hurdles =', JSON.stringify(d?.hurdles)); });
host.on('race-state', (st) => {
    stats.states++;
    if (Array.isArray(st.hurdles) && st.hurdles.length === 3) {
        stats.statesWithHurdles++;
        const sig = JSON.stringify(st.hurdles);
        if (stats.hurdleSig === null) stats.hurdleSig = sig;
        if (sig === stats.hurdleSig) stats.sameHurdles++;
    }
    if (st.players.every(p => typeof p.jumping === 'boolean' && typeof p.stumbled === 'boolean' && (p.nextHurdleDistance === null || typeof p.nextHurdleDistance === 'number'))) stats.fieldsOk++;
});
host.on('race-stumble', (d) => { stats.stumbleEvents.push(d); log('race-stumble', d.playerId.slice(0, 6), 'hurdle', d.hurdleId); });
host.on('race-finish', (d) => { stats.finishes.push(d); log('race-finish', d.playerId.slice(0, 6), 'pos', d.position, 'time', d.time); });
host.on('race-winner', (d) => { winner = d; log('race-winner', d.winnerName, d.winnerTime); });

// Bots: tap alternately every 60 ms from race-start; Bot1 jumps in the window
for (const b of bots) {
    b.s.on('race-start', () => {
        b.tapTimer = setInterval(() => {
            b.side = b.side === 'left' ? 'right' : 'left';
            b.s.emit('race-tap', b.side);
        }, 60);
    });
    b.s.on('race-stumble', (d) => { if (d.playerId === b.s.id) b.stumbles++; });
    b.s.on('race-state', (st) => {
        const me = st.players.find(p => p.id === b.s.id);
        if (!me) return;
        b.maxSpeed = Math.max(b.maxSpeed, me.speed);
        if (me.jumping) b.jumpingSeen = true;
        if (me.stumbled) b.stumbledSeen = true;
        if (me.finished && b.tapTimer) { clearInterval(b.tapTimer); b.tapTimer = null; }
        const d = me.nextHurdleDistance;
        if (d !== null && d >= 1.5 && d <= 5) {
            b.sawWindow = true;
            if (b.jumps && !me.jumping) { b.s.emit('race-jump'); b.jumpsSent++; }
        }
    });
}

await sleep(300);
const st = await ack(host, 'start-game');
check('start-game from the host', st.success === true, st.error || '');

const t0 = Date.now();
while (!winner && Date.now() - t0 < 90000) await sleep(250);
for (const b of bots) if (b.tapTimer) clearInterval(b.tapTimer);

const jumper = bots[0], runner = bots[1];
log(`stats: states=${stats.states} withHurdles=${stats.statesWithHurdles} fieldsOk=${stats.fieldsOk} stumbles=${stats.stumbleEvents.length} finishes=${stats.finishes.length}`);
log(`       ${jumper.name}: jumps=${jumper.jumpsSent} stumbles=${jumper.stumbles} maxSpeed=${jumper.maxSpeed.toFixed(1)} jumpingSeen=${jumper.jumpingSeen}`);
log(`       ${runner.name}: stumbles=${runner.stumbles} maxSpeed=${runner.maxSpeed.toFixed(1)} stumbledSeen=${runner.stumbledSeen} sawWindow=${runner.sawWindow}`);

const hurdles = stats.startPayload?.hurdles;
check("'race-start' carries 3 hurdles in [25, 85], >= 15 m apart",
    Array.isArray(hurdles) && hurdles.length === 3 && hurdles.every(h => typeof h.id !== 'undefined' && h.position >= 25 && h.position <= 85)
    && hurdles.every((h, i) => i === 0 || h.position - hurdles[i - 1].position >= 15 - 1e-9),
    JSON.stringify(hurdles));
check('Every race-state carries the same hurdles as race-start',
    stats.states > 0 && stats.statesWithHurdles === stats.states && stats.sameHurdles === stats.states && stats.hurdleSig === JSON.stringify(hurdles),
    `${stats.sameHurdles}/${stats.states}`);
check('Every race-state has jumping/stumbled/nextHurdleDistance per player', stats.fieldsOk === stats.states, `${stats.fieldsOk}/${stats.states}`);
check('Both bots got the jump window at some point', jumper.sawWindow && runner.sawWindow);
check('The jumper jumped (>= 3 jumps) and was seen jumping in race-state', jumper.jumpsSent >= 3 && jumper.jumpingSeen, `jumps=${jumper.jumpsSent}`);
check('The jumper never stumbles', jumper.stumbles === 0 && !stats.stumbleEvents.some(e => e.playerId === jumper.s.id), `stumbles=${jumper.stumbles}`);
check("The non-jumper gets >= 1 'race-stumble' (host and phone) and is seen stumbled",
    runner.stumbles >= 1 && stats.stumbleEvents.filter(e => e.playerId === runner.s.id).length >= 1 && runner.stumbledSeen, `stumbles=${runner.stumbles}`);
check('Each stumble event names a hurdle id from the list',
    stats.stumbleEvents.length > 0 && stats.stumbleEvents.every(e => hurdles.some(h => h.id === e.hurdleId)));
check("'race-winner' arrives with the jumper as winner", !!winner && winner.winnerId === jumper.s.id && winner.positions?.length === 2,
    winner ? `${winner.winnerName} in ${((Date.now() - t0) / 1000).toFixed(1)}s` : 'no winner');
check("'race-finish' announced the winner first", stats.finishes.length >= 1 && stats.finishes[0].playerId === jumper.s.id && stats.finishes[0].position === 1);

// Rematch: fresh hurdles (new race-start) and the loop still runs
let restart = null;
host.once('round-starting', () => { restart = 'starting'; });
const rematch = await ack(bots[0].s, 'request-rematch');
const nextStart = await waitFor(host, 'race-start', 10000);
check('Rematch starts a new race that sends hurdles again',
    rematch?.success === true && restart === 'starting' && Array.isArray(nextStart?.hurdles) && nextStart.hurdles.length === 3,
    nextStart ? JSON.stringify(nextStart.hurdles) : JSON.stringify(rematch));

host.close();
for (const b of bots) b.s.close();
summary();
process.exit();
