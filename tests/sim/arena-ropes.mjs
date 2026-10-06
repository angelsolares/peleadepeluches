// Arena lucha libre fase 3: cuerdas, látigo irlandés, lariat/dropkick y battle royal (fake clock).
import ArenaStateManager from '../../server/arenaState.js';

const realLog = console.log;
console.log = (...a) => { if (!String(a[0]).startsWith('[') && !String(a[0]).startsWith('  -')) realLog(...a); };
let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;
import { check, summary } from '../helpers/check.mjs';

function setup(n = 2) {
    const rooms = new Map();
    const players = new Map();
    for (let i = 0; i < n; i++) players.set('P' + i, { id: 'P' + i, name: 'N' + i, number: i + 1, character: 'edgar', input: {} });
    rooms.set('R', { gameMode: 'arena', state: 'playing', players });
    const asm = new ArenaStateManager({ rooms });
    const st = asm.initializeArena('R');
    const A = st.players.get('P0'), B = st.players.get('P1');
    A.position = { x: 0, y: 0.5, z: 0 }; A.facingAngle = Math.PI / 2;
    B.position = { x: 1, y: 0.5, z: 0 };
    if (n > 2) st.players.get('P2').position = { x: -4, y: 0.5, z: 4 };
    const events = [];
    const tick = (ms) => {
        const end = now + ms;
        while (now < end) {
            now += T;
            asm.processTick('R');
            const hits = asm.processPendingAttacks('R');
            events.push(...asm.drainEvents('R'));
            events.push(...asm.checkRingOuts('R').map(r => ({ name: 'ringout', data: r })));
            hits.forEach(h => events.push({ name: 'hit', data: h }));
        }
    };
    const input = (id, o) => { rooms.get('R').players.get(id).input = o; };
    return { asm, st, A, B, events, tick, input };
}

// Irish whip -> rebound -> lariat counter
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    s.input('P0', { right: true });
    s.tick(20);
    const w = s.asm.processGrab('P0', 'R');
    s.input('P0', {});
    check('GRAB + stick in a tie-up = Irish whip', w?.mode === 'whip' && s.B.whip?.phase === 'out');
    let reboundAt = null;
    for (let i = 0; i < 200 && !reboundAt; i++) { s.tick(T); if (s.B.whip?.phase === 'back') reboundAt = s.B.position.x; }
    check('Whipped player runs to the ropes and rebounds', reboundAt !== null && reboundAt > 8, `x=${reboundAt?.toFixed(2)}`);
    check('Rebound event queued', s.events.some(e => e.name === 'arena-rebound'));
    // Wait until B is coming back close to A, then punch -> lariat
    for (let i = 0; i < 120 && s.B.position.x - s.A.position.x > 1.6; i++) s.tick(T);
    s.A.facingAngle = Math.PI / 2;
    s.asm.queueAttack('P0', 'punch', 'R');
    s.tick(250);
    const hit = s.events.filter(e => e.name === 'hit').pop()?.data.hits[0];
    check('Punching a rebounding player = clothesline, knocked down', hit?.move === 'lariat' && hit.knockdown && s.B.isDown && !s.B.whip, `hp=${s.B.health}`);
}

// Whip ends on its own if nobody hits
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    s.input('P0', { right: true }); s.tick(20);
    s.asm.processGrab('P0', 'R');
    s.input('P0', {});
    s.tick(3000);
    check('Whip ends after the rebound run', !s.B.whip && s.events.some(e => e.name === 'arena-whip-end'));
}

// GRAB without stick in a tie-up still lifts
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    const l = s.asm.processGrab('P0', 'R');
    check('GRAB without stick in a tie-up still lifts into the carry', l?.mode === 'carry');
}

// Running lariat
{
    const s = setup();
    s.A.position = { x: -4, y: 0.5, z: 0 };
    s.B.position = { x: 0, y: 0.5, z: 0 };
    s.input('P0', { right: true, run: true });
    for (let i = 0; i < 120 && s.B.position.x - s.A.position.x > 1.7; i++) s.tick(T);
    const r = s.asm.queueAttack('P0', 'punch', 'R');
    s.tick(250);
    check('Running + PUNCH = lariat that knocks down', r?.attackType === 'lariat' && s.B.isDown && s.B.health === 86, `hp=${s.B.health}`);
}

// Running dropkick knocks both down
{
    const s = setup();
    s.A.position = { x: -4, y: 0.5, z: 0 };
    s.B.position = { x: 0, y: 0.5, z: 0 };
    s.input('P0', { right: true, run: true });
    for (let i = 0; i < 120 && s.B.position.x - s.A.position.x > 1.8; i++) s.tick(T);
    const r = s.asm.queueAttack('P0', 'kick', 'R');
    s.input('P0', {});
    s.tick(400);
    check('Running + KICK = dropkick: defender down and attacker down too', r?.attackType === 'dropkick' && s.B.isDown && s.A.isDown && s.B.health === 84, `hp=${s.B.health}`);
}

// Rope running
{
    const s = setup();
    s.A.position = { x: 5, y: 0.5, z: 0 };
    s.B.position = { x: -6, y: 0.5, z: 5 };
    s.input('P0', { right: true, run: true });
    let bounced = false;
    for (let i = 0; i < 120 && !bounced; i++) { s.tick(T); bounced = s.A.ropeRunUntil > now; }
    const vx = s.A.velocity.x;
    check('Running into the ropes bounces you back at speed', bounced && vx < -8 && s.events.some(e => e.name === 'arena-rope-bounce'), `vx=${vx.toFixed(1)}`);
    s.tick(50);
    const r = s.asm.queueAttack('P0', 'punch', 'R');
    check('Bouncing off the ropes counts as running (lariat)', r?.attackType === 'lariat');
}

// Ring-out credit
{
    const s = setup(3);
    s.A.position = { x: 5, y: 0.5, z: 0 };
    s.B.position = { x: 6, y: 0.5, z: 0 };
    s.asm.processGrab('P0', 'R');
    s.asm.processGrab('P0', 'R');
    s.tick(100);
    s.asm.processThrow('P0', 'R', Math.PI / 2);
    s.tick(2500);
    const ro = s.events.find(e => e.name === 'ringout');
    check('Ring-out is credited to the last attacker', ro?.data.eliminatedBy === 'P0', JSON.stringify(ro?.data));
    check('Alive counter for the battle royal', s.asm.countAlive('R') === 2);
}

summary();
