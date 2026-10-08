// Sumo end to end against a real server: host creates the room, 3 bots join, one hunts the
// others with charged shoves; asserts the state/events protocol and the game-over ranking.
//   TEST_SERVER_URL=http://localhost:3199 node tests/server/sumo.mjs
import { sleep, ack, waitFor, connect } from '../helpers/server.mjs';
import { check, summary } from '../helpers/check.mjs';

const host = await connect();
const created = await ack(host, 'create-room', { gameMode: 'sumo' });
check('create-room (sumo)', created.success === true, created.roomCode);
const roomCode = created.roomCode;

const bots = [];
for (const [name, ch] of [['Toro', 'edgar'], ['Pato', 'lia'], ['Foca', 'hector']]) {
    const s = await connect();
    const j = await ack(s, 'join-room', { roomCode, playerName: name });
    await ack(s, 'select-character', { characterId: ch, characterName: name });
    await ack(s, 'player-ready', true);
    bots.push({ s, name, ok: j.success });
}
check('3 bots joined and readied', bots.every(b => b.ok));

const stats = { states: 0, fieldsOk: 0, countdownSeen: false, activeSeen: false, maxCharge: 0, shoving: 0, events: [], minRadius: 99 };
let state = null, gameOver = null;
host.on('sumo-state', s => {
    state = s; stats.states++;
    const ok = typeof s.ringRadius === 'number' && typeof s.aliveCount === 'number' && typeof s.serverTime === 'number'
        && s.players.every(p => 'isCharging' in p && 'chargeRatio' in p && 'isShoving' in p && 'stunned' in p && 'alive' in p && 'falling' in p && 'placement' in p && p.position && p.velocity);
    if (ok) stats.fieldsOk++;
    if (s.gameState === 'countdown') stats.countdownSeen = true;
    if (s.gameState === 'active') stats.activeSeen = true;
    stats.minRadius = Math.min(stats.minRadius, s.ringRadius);
    for (const p of s.players) { stats.maxCharge = Math.max(stats.maxCharge, p.chargeRatio); if (p.isShoving) stats.shoving++; }
});
host.on('sumo-event', e => stats.events.push(e));
host.on('sumo-game-over', d => { gameOver = d; });

const started = waitFor(host, 'game-started', 5000);
const startAck = await ack(host, 'start-game');
check('start-game accepted', startAck.success === true, startAck.error || '');
check('game-started arrived', !!(await started));

// Hunter: walks toward the nearest alive rival, charges 0.8 s and shoves when close
const hunter = bots[0].s;
const input = (s, o) => s.emit('player-input', { left: false, right: false, up: false, down: false, ...o });
const t0 = Date.now();
let charging = false, chargeAt = 0, shoves = 0;
while (!gameOver && Date.now() - t0 < 70000) {
    const me = state?.players.find(p => p.id === hunter.id);
    const rival = state?.players.filter(p => p.id !== hunter.id && p.alive).sort((a, b) => Math.hypot(a.position.x - me.position.x, a.position.z - me.position.z) - Math.hypot(b.position.x - me.position.x, b.position.z - me.position.z))[0];
    if (state?.gameState !== 'countdown' && me && me.alive && rival) {
        const dx = rival.position.x - me.position.x, dz = rival.position.z - me.position.z;
        const dist = Math.hypot(dx, dz);
        input(hunter, { left: dx < -0.2, right: dx > 0.2, up: dz < -0.2, down: dz > 0.2 });
        if (dist < 3.5 && !charging) { charging = true; chargeAt = Date.now(); hunter.emit('sumo-charge'); }
        if (charging && Date.now() - chargeAt > 800 && dist < 1.6) {
            charging = false;
            const r = await ack(hunter, 'sumo-shove');
            if (r?.success) shoves++;
        }
    }
    await sleep(50);
}
input(hunter, {});

const shoveHits = stats.events.filter(e => e.type === 'shove-hit');
const ringOuts = stats.events.filter(e => e.type === 'ring-out');
console.log(`states=${stats.states} fieldsOk=${stats.fieldsOk} shoves=${shoves} hits=${shoveHits.length} ringOuts=${ringOuts.length} maxCharge=${stats.maxCharge} minRadius=${stats.minRadius.toFixed(2)} events=${stats.events.map(e => e.type).join(',')}`);

check('sumo-state ticks arrived with every field', stats.states > 100 && stats.fieldsOk === stats.states, `${stats.fieldsOk}/${stats.states}`);
check('Countdown then active', stats.countdownSeen && stats.activeSeen);
check('Charging is visible in the state (the hunter holds ~0.8 s)', stats.maxCharge >= 0.7, `max=${stats.maxCharge}`);
check('Dashes are visible in the state', stats.shoving > 0);
check('The hunter landed at least one shove', shoveHits.length >= 1 && shoveHits.every(h => h.attackerId === hunter.id));
check('Ring shrank over time', stats.minRadius < 7.95, `min=${stats.minRadius.toFixed(2)}`);
check('At least one rival rang out, credited to the hunter', ringOuts.length >= 1 && ringOuts.some(r => r.by === hunter.id), JSON.stringify(ringOuts.map(r => ({ p: r.playerName, by: r.by === hunter.id ? 'hunter' : r.by, place: r.placement }))));
check('sumo-game-over with winner and a full ranking', !!gameOver && gameOver.winner && gameOver.ranking?.length === 3 && gameOver.ranking[0].placement === 1, gameOver ? `winner=${gameOver.winner?.name} ranking=${gameOver.ranking.map(r => `${r.placement}:${r.name}`).join(' ')}` : 'none');

// Rematch restarts with a fresh ring and everyone alive
let fresh = null;
host.once('round-starting', () => { host.once('sumo-state', s => { fresh = s; }); });
const rematch = await ack(host, 'request-rematch');
for (let i = 0; i < 40 && !fresh; i++) await sleep(100);
check('Rematch restarts the match (countdown, ring 8, everyone alive)', rematch?.success === true && fresh && fresh.gameState === 'countdown' && fresh.ringRadius === 8 && fresh.players.every(p => p.alive && p.placement === null), fresh ? `${fresh.gameState} r=${fresh.ringRadius}` : JSON.stringify(rematch));

host.close();
bots.forEach(b => b.s.close());
summary();
process.exit();
