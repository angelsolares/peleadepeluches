// Sumo rules against the real state manager with a fake clock: ring shrink, charged shoves,
// stun, ring-outs, placements, sudden death and leavers.
import SumoStateManager, { SUMO_CONFIG } from '../../server/sumoState.js';
import { check, summary, quietServerLogs } from '../helpers/check.mjs';

quietServerLogs();

let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;

function setup(n = 2) {
    now = 1_000_000;
    const rooms = new Map();
    const players = new Map();
    for (let i = 0; i < n; i++) {
        players.set(`P${i}`, { id: `P${i}`, name: `Bot${i}`, number: i + 1, color: '#fff', character: 'edgar', input: { left: false, right: false, up: false, down: false } });
    }
    const room = { gameMode: 'sumo', state: 'playing', players };
    rooms.set('R', room);
    const sm = new SumoStateManager({ rooms });
    const st = sm.initializeSumo('R');
    const events = [];
    let last = null;
    const tick = (ms, step = T) => {
        const end = now + ms;
        while (now < end) {
            now += step;
            last = sm.processTick('R') || last;
            events.push(...sm.drainEvents('R'));
        }
        return last;
    };
    const p = (i) => st.players.get(`P${i}`);
    const input = (i, o) => { players.get(`P${i}`).input = { left: false, right: false, up: false, down: false, ...o }; };
    // Skip the countdown
    tick(SUMO_CONFIG.COUNTDOWN * 1000 + T);
    return { sm, st, room, tick, events, p, input, last: () => last };
}

// Countdown and start
{
    const rooms = new Map();
    const players = new Map([['P0', { id: 'P0', name: 'A', number: 1, input: {} }], ['P1', { id: 'P1', name: 'B', number: 2, input: {} }]]);
    rooms.set('R', { gameMode: 'sumo', state: 'playing', players });
    const sm = new SumoStateManager({ rooms });
    sm.initializeSumo('R');
    const first = sm.processTick('R');
    check('Starts in countdown with 3 s and the full ring', first.gameState === 'countdown' && first.countdown === 3 && first.ringRadius === 8 && first.aliveCount === 2);
    now += 3100;
    const active = sm.processTick('R');
    check('Active after the countdown', active.gameState === 'active' && active.countdown === 0);
    check('Players spawn on a circle facing the center', Math.abs(Math.hypot(first.players[0].position.x, first.players[0].position.z) - 5) < 0.01);
}

// Movement: same distance at 60 Hz and 36 Hz (start from the left side so the walk stays inside)
{
    const a = setup(2); a.p(0).position = { x: -5, y: 0, z: 0 }; a.input(0, { right: true }); a.tick(1000); const d60 = a.p(0).position.x + 5;
    const b = setup(2); b.p(0).position = { x: -5, y: 0, z: 0 }; b.input(0, { right: true }); b.tick(1000, 1000 / 36); const d36 = b.p(0).position.x + 5;
    check('Walking 1 s covers the same distance at 60 Hz and 36 Hz', Math.abs(d60 - d36) / d60 < 0.02 && d60 > 4, `${d60.toFixed(2)} vs ${d36.toFixed(2)}`);
    const c = setup(2); c.p(0).position = { x: -5, y: 0, z: 0 }; c.input(0, { right: true }); c.sm.handleChargeStart('P0', 'R'); c.tick(1000);
    check('Charging slows the walk', (c.p(0).position.x + 5) < d60 * 0.5, `${(c.p(0).position.x + 5).toFixed(2)}`);
}

// Ring shrinks linearly to 3 over 60 s, then sudden death to 1 (players parked near the center)
{
    const s = setup(2);
    s.p(0).position = { x: -0.45, y: 0, z: 0 };
    s.p(1).position = { x: 0.45, y: 0, z: 0 };
    s.tick(30000);
    check('Ring is ~5.5 at 30 s', Math.abs(s.last().ringRadius - 5.5) < 0.15, `r=${s.last().ringRadius}`);
    check('ring-shrink events fire at integer radii', s.events.filter(e => e.type === 'ring-shrink').length >= 2);
    s.tick(31000);
    check('Sudden death at 60 s', s.last().gameState === 'suddenDeath' && s.events.some(e => e.type === 'sudden-death'));
    s.tick(10500);
    check('Ring reaches 1 after sudden death and the centered players survive', s.last().ringRadius <= 1.05 && s.last().gameState === 'suddenDeath', `r=${s.last().ringRadius} state=${s.last().gameState}`);
}

// Shove: charge, dash, hit, stun, knockback scales with charge
function shoveTest(chargeMs) {
    const s = setup(2);
    const a = s.p(0), b = s.p(1);
    a.position = { x: 0, y: 0, z: 0 }; a.facingAngle = Math.atan2(1, 0); // faces +x
    b.position = { x: 1.0, y: 0, z: 0 };
    s.tick(T);
    check(`Charge starts (${chargeMs} ms)`, s.sm.handleChargeStart('P0', 'R') === true);
    s.tick(chargeMs);
    const ratio = s.last().players[0].chargeRatio;
    const r = s.sm.handleShove('P0', 'R');
    s.tick(T * 2);
    const hit = s.events.find(e => e.type === 'shove-hit');
    return { s, a, b, ratio, r, hit, vb: Math.hypot(b.velocity.x, b.velocity.z) };
}
{
    // The fake clock is shared: run the strong test first so the weak one is the "current" state
    const strong = shoveTest(1200), weak = shoveTest(50);
    check('State exposes isCharging/chargeRatio while holding', weak.ratio >= 0 && strong.ratio === 1);
    check('Release dashes and hits the rival in front', weak.r.success && weak.hit && weak.hit.targetId === 'P1' && weak.b.stunnedUntil > now - 5000);
    check('Full charge launches much harder than a tap', strong.vb > weak.vb * 1.8, `${weak.vb.toFixed(1)} vs ${strong.vb.toFixed(1)}`);
    check('Shove power in the event matches the charge', strong.hit.power === 1 && weak.hit.power < 0.2);
    check('Cooldown: a second shove right away is refused', weak.s.sm.handleShove('P0', 'R').success === false);
    weak.s.tick(1100);
    check('Shove available again after 1 s', weak.s.sm.handleShove('P0', 'R').success === true);
}

// Shove misses behind / out of range
{
    const s = setup(2);
    const a = s.p(0), b = s.p(1);
    a.position = { x: 0, y: 0, z: 0 }; a.facingAngle = Math.atan2(1, 0);
    b.position = { x: -1.0, y: 0, z: 0 }; // behind
    s.tick(T);
    s.sm.handleShove('P0', 'R'); s.tick(T * 2);
    check('A rival behind is not hit', !s.events.some(e => e.type === 'shove-hit'));
}

// Ring-out, placement and credit
{
    const s = setup(3);
    const a = s.p(0), b = s.p(1);
    a.position = { x: 3.0, y: 0, z: 0 }; a.facingAngle = Math.atan2(1, 0); // the dash (~4.5 m) keeps A inside
    b.position = { x: 4.0, y: 0, z: 0 };
    s.p(2).position = { x: -3, y: 0, z: 0 };
    s.tick(T);
    s.sm.handleChargeStart('P0', 'R'); s.tick(1000);
    s.sm.handleShove('P0', 'R');
    s.tick(700);
    const out = s.events.find(e => e.type === 'ring-out');
    check('A full-charge shove near the rim rings the rival out, credited to the attacker', out && out.playerId === 'P1' && out.by === 'P0' && out.placement === 3, JSON.stringify(out));
    check('Eliminated player falls below the ring', !b.alive && b.falling && b.position.y < 0 && s.last().aliveCount === 2, `y=${b.position.y.toFixed(2)} falling=${b.falling} alive=${s.last().aliveCount}`);
    s.tick(2500);
    check('Fall stops at the floor', b.position.y === SUMO_CONFIG.FALL_FLOOR && !b.falling, `y=${b.position.y}`);
    check('Match keeps going with 2 alive', s.last().gameState !== 'finished' && a.alive, `A x=${a.position.x.toFixed(2)}`);
}

// Last one standing wins, ranking by placement
{
    const s = setup(3);
    s.p(1).position = { x: 20, y: 0, z: 0 };
    s.tick(T * 2);
    s.p(2).position = { x: 0, y: 0, z: 20 };
    s.tick(T * 2);
    check('The match lingers after the last ring-out (fall is streamed)', s.last().gameState !== 'finished' && s.last().aliveCount === 1 && s.p(2).falling);
    s.tick(1600);
    const st = s.last();
    check('Last one standing finishes the match with the winner and ranking', st.gameState === 'finished' && st.winner?.id === 'P0' && st.ranking.map(r => r.placement).join(',') === '1,2,3' && st.ranking[0].id === 'P0' && st.ranking[2].id === 'P1', JSON.stringify(st.ranking));
    check('processTick returns null once finished', s.sm.processTick('R') === null);
}

// Leaver is eliminated
{
    const s = setup(3);
    s.room.players.delete('P2');
    s.tick(T * 2);
    check('A player who leaves is out with the last placement', !s.p(2).alive && s.p(2).placement === 3 && s.events.some(e => e.type === 'ring-out' && e.playerId === 'P2' && e.by === null));
}

// Body collision keeps players apart; a stunned player can't act
{
    const s = setup(2);
    s.p(0).position = { x: -0.3, y: 0, z: 0 }; s.p(1).position = { x: 0.3, y: 0, z: 0 };
    s.tick(T * 5);
    check('Overlapping players are pushed apart', Math.abs(s.p(1).position.x - s.p(0).position.x) >= 0.85, `gap=${(s.p(1).position.x - s.p(0).position.x).toFixed(2)}`);
    s.p(1).stunnedUntil = now + 300;
    check('A stunned player cannot charge or shove', s.sm.handleChargeStart('P1', 'R') === false && s.sm.handleShove('P1', 'R').success === false);
}

// Cleanup
{
    const s = setup(2);
    s.sm.cleanup('R');
    check('cleanup removes the room state', !s.sm.sumoStates.has('R'));
}

summary();
