// Arena lucha libre fase 1: amarres, llaves, lona y cuenta de 3 (fake clock, no sockets).
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
    for (let i = 0; i < n; i++) players.set('P' + i, { id: 'P' + i, name: 'P' + i, number: i + 1, input: {} });
    rooms.set('R', { gameMode: 'arena', state: 'playing', players });
    const asm = new ArenaStateManager({ rooms });
    const st = asm.initializeArena('R');
    st.players.get('P0').position = { x: 0, y: 0.5, z: 0 };
    st.players.get('P1').position = { x: 1, y: 0.5, z: 0 };
    if (n > 2) st.players.get('P2').position = { x: -4, y: 0.5, z: 3 };
    const events = [];
    const tick = (ms) => {
        const end = now + ms;
        while (now < end) {
            now += T;
            asm.processTick('R');
            asm.processPendingAttacks('R');
            asm.checkRingOuts('R');
            events.push(...asm.drainEvents('R').map(e => e.name + (e.data.move ? ':' + e.data.move : '') + (e.data.reason ? ':' + e.data.reason : '') + (e.data.result ? ':' + e.data.result : '') + (e.data.count ? ':' + e.data.count : '')));
        }
    };
    return { asm, st, rooms, A: st.players.get('P0'), B: st.players.get('P1'), events, tick, input: (id, o) => { rooms.get('R').players.get(id).input = o; } };
}

// 1. Tie-up and timeout
{
    const s = setup();
    const r = s.asm.processGrab('P0', 'R');
    check('Grab starts a tie-up', r?.mode === 'tieup' && s.A.tieUp?.role === 'attacker' && s.B.tieUp?.role === 'defender');
    s.input('P1', { left: true });
    s.tick(500);
    check('Tie-up holds both players in place', Math.abs(s.B.position.x - 0.95) < 0.2, `B.x=${s.B.position.x.toFixed(2)}`);
    s.tick(2300);
    check('Tie-up breaks on timeout', !s.A.tieUp && !s.B.tieUp && s.events.includes('arena-tieup-end:timeout'), s.events.join(','));
}

// 2. Headbutt (punch, no stick) -> stun, no down
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    const m = s.asm.queueAttack('P0', 'punch', 'R');
    s.tick(1000);
    check('PUNCH without stick = headbutt', m?.grapple && m.attackType === 'headbutt' && s.B.health === 90 && !s.B.isDown, `health=${s.B.health}`);
}

// 3. Slam (punch + stick) -> down in front, getting up, stomp in between
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    s.input('P0', { right: true });
    s.tick(20);
    const m = s.asm.queueAttack('P0', 'punch', 'R');
    s.input('P0', {});
    s.tick(1400);
    check('PUNCH + stick = body slam, defender down in front', m?.attackType === 'slam' && s.B.isDown && s.B.health === 85 && s.B.position.x > 0.9, `x=${s.B.position.x.toFixed(2)} hp=${s.B.health}`);
    s.tick(600);
    const stomp = s.asm.queueAttack('P0', 'kick', 'R');
    s.tick(400);
    check('Strike next to a downed player = stomp', stomp?.attackType === 'stomp' && s.B.health === 79, `hp=${s.B.health}`);
    s.tick(1500);
    check('Downed player gets up after ~3 s', !s.B.isDown && (s.B.isGettingUp || s.events.includes('arena-getup')), s.events.join(','));
    s.tick(1600);
    check('Getting up ends and control returns', !s.B.isGettingUp);
}

// 4. Suplex (kick + stick) -> lands behind
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    s.input('P0', { left: true });
    s.tick(20);
    const m = s.asm.queueAttack('P0', 'kick', 'R');
    s.input('P0', {});
    s.tick(1600);
    check('KICK + stick = suplex, defender lands behind', m?.attackType === 'suplex' && s.B.isDown && s.B.position.x < -0.5 && s.B.health === 80, `x=${s.B.position.x.toFixed(2)}`);
}

// 5. Knee (kick, no stick)
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    const m = s.asm.queueAttack('P0', 'kick', 'R');
    s.tick(1000);
    check('KICK without stick = knee', m?.attackType === 'knee' && s.B.health === 88);
}

// 6. Pin -> pinfall at 3
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    s.input('P0', { right: true }); s.tick(20);
    s.asm.queueAttack('P0', 'punch', 'R');
    s.input('P0', {});
    s.tick(1400);
    s.A.position = { x: s.B.position.x - 0.8, y: 0.5, z: 0 };
    const pin = s.asm.processGrab('P0', 'R');
    check('GRAB next to a downed player = pin', pin?.mode === 'pin' && s.A.pin?.role === 'pinner');
    s.tick(3200);
    check('3-count eliminates by pinfall', s.B.isEliminated && s.events.includes('arena-pin-count:3') && s.events.some(e => e.startsWith('arena-elimination:pinfall')), s.events.filter(e => e.includes('pin') || e.includes('elim')).join(','));
}

// 7. Kick-out
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    s.input('P0', { right: true }); s.tick(20);
    s.asm.queueAttack('P0', 'punch', 'R');
    s.input('P0', {});
    s.tick(1400);
    s.A.position = { x: s.B.position.x - 0.8, y: 0.5, z: 0 };
    const pin = s.asm.processGrab('P0', 'R');
    let r;
    for (let i = 0; i < pin.tapsNeeded; i++) { r = s.asm.processEscape('P1', 'R'); s.tick(100); }
    check('Mashing kicks out of the pin before 3', r?.escaped && !s.B.isEliminated && !s.B.pin && s.B.isGettingUp && s.events.includes('arena-pin-end:kickout'), `needed=${pin.tapsNeeded}`);
}

// 8. Tie-up escape
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    let r;
    for (let i = 0; i < 5; i++) r = s.asm.processEscape('P1', 'R');
    s.tick(50);
    check('Defender mashes out of a tie-up', r?.escaped && !s.A.tieUp && s.A.isStunned && s.events.includes('arena-tieup-end:escape'));
}

// 9. Lift into carry, then throw
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    const lift = s.asm.processGrab('P0', 'R');
    s.tick(50);
    check('GRAB again in a tie-up = lift into carry', lift?.mode === 'carry' && s.A.isGrabbing && s.B.isGrabbed && s.events.includes('arena-grab'));
    let r;
    for (let i = 0; i < 5; i++) r = s.asm.processEscape('P1', 'R');
    check('Carry escape needs 6 taps (5 is not enough)', r?.escaped === false && s.B.isGrabbed);
    const t = s.asm.processThrow('P0', 'R', Math.PI / 2);
    check('Throw from the carry still works', !!t && !s.B.isGrabbed);
}

// 10. Third player interrupts a pin
{
    const s = setup(3);
    const C = s.st.players.get('P2');
    s.asm.processGrab('P0', 'R');
    s.input('P0', { right: true }); s.tick(20);
    s.asm.queueAttack('P0', 'punch', 'R');
    s.input('P0', {});
    s.tick(1400);
    s.A.position = { x: s.B.position.x - 0.8, y: 0.5, z: 0 };
    s.asm.processGrab('P0', 'R');
    C.position = { x: s.A.position.x - 1.0, y: 0.5, z: 0 };
    C.facingAngle = Math.PI / 2;
    s.asm.queueAttack('P2', 'punch', 'R');
    s.tick(400);
    check('Hitting the pinner breaks the pin', !s.A.pin && !s.B.pin && s.events.includes('arena-pin-end:interrupted') && !s.B.isEliminated);
}

// 11. Grappled players can't be hit mid-move
{
    const s = setup(3);
    const C = s.st.players.get('P2');
    s.asm.processGrab('P0', 'R');
    s.input('P0', { right: true }); s.tick(20);
    s.asm.queueAttack('P0', 'punch', 'R');
    s.input('P0', {});
    C.position = { x: s.B.position.x + 1.0, y: 0.5, z: 0 };
    C.facingAngle = -Math.PI / 2;
    s.asm.queueAttack('P2', 'kick', 'R');
    s.tick(300);
    check('A player inside a grapple move cannot be hit', s.B.health === 100, `hp=${s.B.health}`);
}

summary();
