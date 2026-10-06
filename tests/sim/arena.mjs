// Arena physics basics: knockback, throws, ropes, apron, carrying and body collisions (fake clock).
import ArenaStateManager from '../../server/arenaState.js';
import { check, summary, quietServerLogs } from '../helpers/check.mjs';

quietServerLogs();

let fakeNow = 1_000_000;
Date.now = () => fakeNow;
const TICK = 1000 / 60;

function setup(positions) {
    const rooms = new Map();
    const players = new Map();
    positions.forEach((pos, i) => {
        const id = 'P' + i;
        players.set(id, { id, name: id, number: i + 1, input: { left: false, right: false, up: false, down: false, run: false } });
    });
    rooms.set('R', { gameMode: 'arena', state: 'playing', players });
    const asm = new ArenaStateManager({ rooms });
    const st = asm.initializeArena('R');
    positions.forEach((pos, i) => {
        const ps = st.players.get('P' + i);
        ps.position = { x: pos[0], y: 0.5, z: pos[1] };
        ps.facingAngle = pos[2] ?? 0;
    });
    return { asm, st, room: rooms.get('R') };
}

function tick(asm, n = 1) {
    const events = [];
    for (let i = 0; i < n; i++) {
        fakeNow += TICK;
        const s = asm.processTick('R');
        if (!s) { events.push({ tick: i, stopped: true }); break; }
        for (const r of asm.processPendingAttacks('R')) events.push({ tick: i, hit: r.hits.map(h => h.targetId) });
        for (const r of asm.checkRingOuts('R')) events.push({ tick: i, ringout: r.playerId });
    }
    return events;
}

const fmt = p => `(${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)})`;

// 1. Kick knockback moves the victim while stunned
{
    const { asm, st } = setup([[0, 0, Math.PI / 2], [1.2, 0]]); // P0 faces +X toward P1
    const v = st.players.get('P1');
    asm.queueAttack('P0', 'kick', 'R');
    tick(asm, 60);
    check('Kick knockback pushes the victim away', v.position.x - 1.2 > 0.5, `moved ${(v.position.x - 1.2).toFixed(2)}`);
}

// 2. Throws toward the right rope (+X): the flight is never frozen, far throws ring out
for (const startX of [0, 2, 3, 4, 5, 6]) {
    const { asm, st, room } = setup([[startX, 0, Math.PI / 2], [startX + 1, 0]]);
    const victim = st.players.get('P1');
    room.players.get('P1').input.left = true; // victim tries to steer back in during the flight
    asm.processGrab('P0', 'R'); const g = asm.processGrab('P0', 'R');
    tick(asm, 5); // carry a bit
    asm.processThrow('P0', 'R', Math.PI / 2);
    let maxX = victim.position.x;
    let frozenTicks = 0, prevX = victim.position.x;
    for (let i = 0; i < 180 && !victim.isEliminated; i++) {
        tick(asm, 1);
        if (Math.abs(victim.position.x - prevX) < 1e-6 && victim.position.y > 0.6) frozenTicks++;
        prevX = victim.position.x;
        maxX = Math.max(maxX, victim.position.x);
    }
    const expectRingOut = startX >= 5;
    check(`Throw from x=${startX}: grabbed, flight never freezes, ${expectRingOut ? 'rings out' : 'lands inside'}`,
        !!g && frozenTicks === 0 && victim.isEliminated === expectRingOut && maxX > startX + 3,
        `maxX=${maxX.toFixed(2)} final=${fmt(victim)} frozen=${frozenTicks}`);
}

// 3. Walking into the rope still bounces
{
    const { asm, st, room } = setup([[7, 0]]);
    const p = st.players.get('P0');
    room.players.get('P0').input.right = true;
    tick(asm, 120);
    check('Walking into the ropes stops at the rope line', p.position.x <= 8.25 && p.position.x > 7.5 && !p.isEliminated, `x=${p.position.x.toFixed(2)}`);
}

// 4. Player on the apron (outside ropes) is not pulled back in
{
    const { asm, st } = setup([[8.6, 0]]);
    const p = st.players.get('P0');
    tick(asm, 30);
    check('Standing on the apron is not pulled back inside', Math.abs(p.position.x - 8.6) < 0.05, `x=${p.position.x.toFixed(2)}`);
}

// 5. Walking off the apron falls and rings out
{
    const { asm, st, room } = setup([[8.6, 0]]);
    const p = st.players.get('P0');
    room.players.get('P0').input.right = true;
    const ev = tick(asm, 120);
    check('Walking off the apron falls and rings out', p.isEliminated && ev.some(e => e.ringout === 'P0') && p.position.y < 0, fmt(p));
}

// 6. Carried victim follows the grabber; escape releases near the grabber
{
    const { asm, st, room } = setup([[0, 0, Math.PI / 2], [1, 0]]);
    const grabber = st.players.get('P0');
    const victim = st.players.get('P1');
    asm.processGrab('P0', 'R'); asm.processGrab('P0', 'R');
    room.players.get('P0').input.up = true; // walk toward -Z carrying the victim
    tick(asm, 60);
    const dist = Math.hypot(victim.position.x - grabber.position.x, victim.position.z - grabber.position.z);
    check('Carried victim follows the grabber overhead', dist < 0.6 && victim.position.y > 1.2 && grabber.position.z < -1, `dist=${dist.toFixed(2)} victim=${fmt(victim)}`);
    room.players.get('P0').input.up = false;
    for (let k = 0; k < 6; k++) asm.processEscape('P1', 'R');
    tick(asm, 60);
    check('Escaping drops the victim back on the mat', !victim.isGrabbed && Math.abs(victim.position.y - 0.5) < 0.01, fmt(victim));
}

// 7. Two players walking into each other stay apart
{
    const { asm, st, room } = setup([[-2, 0], [2, 0]]);
    room.players.get('P0').input.right = true;
    room.players.get('P1').input.left = true;
    tick(asm, 90);
    const a = st.players.get('P0'), b = st.players.get('P1');
    const gap = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
    check('Two players walking into each other stay apart', gap >= 0.79, `gap=${gap.toFixed(2)}`);
}

// 8. Throw direction 0 ("down" = +Z) is honored, not replaced by facing
{
    const { asm, st } = setup([[0, 0, Math.PI / 2], [1, 0]]);
    const victim = st.players.get('P1');
    asm.processGrab('P0', 'R'); asm.processGrab('P0', 'R');
    tick(asm, 2);
    asm.processThrow('P0', 'R', 0);
    tick(asm, 60);
    check('Throw direction is honored (down = +Z)', victim.position.z > 2 && Math.abs(victim.position.x) < 0.5, fmt(victim));
}

summary();
