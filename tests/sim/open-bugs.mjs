// Regression checks for bugs found in the first Smash/Arena reviews (elimination, cooldowns, leavers, cleanup).
import GameStateManager from '../../server/gameState.js';
import ArenaStateManager from '../../server/arenaState.js';

const realLog = console.log;
console.log = (...a) => { if (!String(a[0]).startsWith('[') && !String(a[0]).startsWith('  -')) realLog(...a); };
let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;
import { check, summary } from '../helpers/check.mjs';

// ---------------- Smash ----------------
{
    const mk = (id, x) => ({ id, name: id, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, health: 0, stocks: 1, facingRight: true, input: {} });
    const rooms = new Map();
    const g = new GameStateManager({ rooms });
    const a = mk('A', 0), b = mk('B', 0.6), c = mk('C', -3);
    c.stocks = 3;
    rooms.set('R', { state: 'playing', players: new Map([['A', a], ['B', b], ['C', c]]) });
    const tick = n => { const k = []; for (let i = 0; i < n; i++) { now += T; g.processTick('R'); g.processPendingAttacks('R'); k.push(...g.checkKOs('R')); } return k; };

    tick(1);
    // Cooldown
    const first = g.queueAttack('A', 'punch', 'R');
    now += 100;
    const spam = g.queueAttack('A', 'punch', 'R');
    now += 350;
    const later = g.queueAttack('A', 'punch', 'R');
    check('Smash cooldown blocks a second punch within 400 ms', first !== null && spam === null && later !== null);

    // Eliminate B: push it into the blast zone
    tick(30);
    b.position.x = 25;
    const kos = tick(1);
    check('Smash final KO marks the player eliminated', kos.some(k => k.playerId === 'B' && k.eliminated));
    const parked = { ...b.position };
    tick(60);
    check('Smash eliminated player is not respawned or simulated', b.position.x === parked.x && b.position.y === parked.y, JSON.stringify(b.position));
    check('Smash eliminated player is not KO\'d again', b.stocks === 0);
    now += 1000;
    check('Smash eliminated player cannot attack', g.queueAttack('B', 'kick', 'R') === null);

    // Eliminated players can't be hit: put B right in front of A
    b.position = { x: 0.6, y: 0, z: 0 };
    a.facingRight = true;
    now += 1000;
    g.queueAttack('A', 'kick', 'R');
    const before = b.health;
    tick(15);
    check('Smash eliminated player cannot be hit', b.health === before);
    const go = g.checkGameOver('R');
    check('Smash game continues while 2 players have stocks', go === null);
}

// ---------------- Arena ----------------
function arenaSetup(n) {
    const rooms = new Map();
    const players = new Map();
    for (let i = 0; i < n; i++) players.set('P' + i, { id: 'P' + i, name: 'P' + i, number: i + 1, input: {} });
    rooms.set('R', { gameMode: 'arena', state: 'playing', players });
    const asm = new ArenaStateManager({ rooms });
    const st = asm.initializeArena('R');
    return { asm, st, rooms };
}

{
    // Escape knockout
    const { asm, st } = arenaSetup(3);
    const p0 = st.players.get('P0'), p1 = st.players.get('P1');
    p0.position = { x: 0, y: 0.5, z: 0 };
    p1.position = { x: 1, y: 0.5, z: 0 };
    asm.processGrab('P0', 'R'); check('Arena grab works', asm.processGrab('P0', 'R') !== null);
    p0.health = 5;
    let r; for (let k = 0; k < 6; k++) r = asm.processEscape('P1', 'R');
    check('Arena escape that drops the grabber to 0 HP eliminates them', r.grabberEliminated === true && p0.isEliminated === true);
    check('Arena round keeps going with 2 alive', st.roundState === 'active');
}

{
    // Throw knockout ends the round outside the tick -> checkGameOver must report it
    const { asm, st } = arenaSetup(2);
    const p0 = st.players.get('P0'), p1 = st.players.get('P1');
    p0.position = { x: 0, y: 0.5, z: 0 };
    p1.position = { x: 1, y: 0.5, z: 0 };
    asm.processGrab('P0', 'R'); asm.processGrab('P0', 'R');
    p1.health = 20;
    const t = asm.processThrow('P0', 'R', Math.PI);
    const tickResult = asm.processTick('R');
    const go = asm.checkGameOver('R');
    check('Arena throw knockout: tick stops and game over is available', t.eliminated && tickResult === null && go?.winner?.id === 'P0');
}

{
    // Player leaves mid-round
    const { asm, st, rooms } = arenaSetup(2);
    rooms.get('R').players.delete('P1');
    const e = asm.removePlayer('R', 'P1');
    const go = asm.checkGameOver('R');
    check('Arena leaver is eliminated and removed', e !== null && !st.players.has('P1'));
    check('Arena leaver ends a 2-player round with the other as winner', go?.winner?.id === 'P0');
}

{
    // Grabber leaves while carrying: victim must be released
    const { asm, st, rooms } = arenaSetup(3);
    const p0 = st.players.get('P0'), p1 = st.players.get('P1');
    p0.position = { x: 0, y: 0.5, z: 0 };
    p1.position = { x: 1, y: 0.5, z: 0 };
    asm.processGrab('P0', 'R'); asm.processGrab('P0', 'R');
    rooms.get('R').players.delete('P0');
    asm.removePlayer('R', 'P0');
    for (let i = 0; i < 60; i++) { now += T; asm.processTick('R'); }
    check('Arena victim is released when the grabber leaves', !p1.isGrabbed && p1.grabbedBy === null && Math.abs(p1.position.y - 0.5) < 0.01, `y=${p1.position.y.toFixed(2)}`);
    check('Arena round continues with 2 alive', st.roundState === 'active');
}

{
    // Cleanup frees memory
    const { asm } = arenaSetup(2);
    asm.cleanup('R');
    check('Arena cleanup removes room state', !asm.arenaStates.has('R'));
}

summary();
