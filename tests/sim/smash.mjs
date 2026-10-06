// Smash physics basics: launches grow with damage, blast zones, no invisible walls, body collisions (fake clock).
import GameStateManager from '../../server/gameState.js';
import { check, summary, quietServerLogs } from '../helpers/check.mjs';

quietServerLogs();

let fakeNow = 1_000_000;
Date.now = () => fakeNow;
const TICK = 1000 / 60;

function makePlayer(id, x) {
    return {
        id, name: id, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
        health: 0, stocks: 3, facingRight: true,
        input: { left: false, right: false, jump: false, punch: false, kick: false, run: false },
    };
}

function makeRoom(code, players) {
    return { code, state: 'playing', players: new Map(players.map(p => [p.id, p])) };
}

function runTicks(gsm, codes, n, onTick) {
    const kos = [];
    for (let i = 0; i < n; i++) {
        fakeNow += TICK;
        for (const code of codes) {
            gsm.processTick(code);
            gsm.processPendingAttacks(code);
            kos.push(...gsm.checkKOs(code).map(k => ({ ...k, tick: i, code })));
        }
        onTick?.(i);
    }
    return kos;
}

/** B stands 0.6 to the right of A and takes one hit at `startDamage` */
function launchTest(attackType, startDamage, holdTowardAttacker) {
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms });
    const a = makePlayer('A', 0);
    const b = makePlayer('B', 0.6);
    b.health = startDamage;
    rooms.set('R1', makeRoom('R1', [a, b]));
    runTicks(gsm, ['R1'], 1);
    gsm.queueAttack('A', attackType, 'R1');
    if (holdTowardAttacker) b.input.left = true;
    let maxX = 0, maxY = 0;
    const kos = runTicks(gsm, ['R1'], 240, () => {
        if (b.stocks === 3) {
            maxX = Math.max(maxX, b.position.x);
            maxY = Math.max(maxY, b.position.y);
        }
    });
    const ko = kos.find(k => k.playerId === 'B');
    return { maxX, maxY, koTick: ko ? ko.tick : null };
}

// Launch distance by damage
{
    const p0 = launchTest('punch', 0), k0 = launchTest('kick', 0);
    const p60 = launchTest('punch', 60), k60 = launchTest('kick', 60);
    const k130 = launchTest('kick', 130), k130di = launchTest('kick', 130, true);
    check('Fresh punch barely moves the rival and never KOs', p0.maxX < 3 && p0.koTick === null, `maxX=${p0.maxX.toFixed(2)}`);
    check('Kick launches further than a punch', k0.maxX > p0.maxX && k60.maxX > p60.maxX, `kick ${k0.maxX.toFixed(2)} vs punch ${p0.maxX.toFixed(2)}`);
    check('Launch distance grows with damage', p60.maxX > p0.maxX * 2 && k60.maxX > k0.maxX * 2, `punch ${p0.maxX.toFixed(2)} -> ${p60.maxX.toFixed(2)}`);
    check('A kick at 130% KOs off the side', k130.koTick !== null && k130.koTick < 60, `KO at tick ${k130.koTick}`);
    check('Holding toward the attacker (DI) shortens the launch but cannot save a 130% kick', k130di.maxX < k130.maxX && k130di.koTick !== null, `maxX ${k130.maxX.toFixed(2)} -> ${k130di.maxX.toFixed(2)}`);
}

// Fall below the stage, then drift back under it: must keep falling (no teleport)
{
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms });
    const p = makePlayer('P', 11); // just past the right edge of the main ground (±10)
    p.position.y = -1;
    p.previousY = -1;
    rooms.set('R', makeRoom('R', [p]));
    p.input.left = true;
    let teleported = false;
    const kos = runTicks(gsm, ['R'], 120, () => { if (p.position.y === 0 && p.stocks === 3) teleported = true; });
    check('Falling under the stage never teleports back on top, and KOs below', !teleported && kos.length === 1, kos.length ? `KO at tick ${kos[0].tick}` : 'no KO');
}

// Walking off the edge: no invisible wall at ±14
{
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms });
    const p = makePlayer('P', 9);
    rooms.set('R', makeRoom('R', [p]));
    p.input.right = true;
    p.input.run = true;
    let maxX = 0;
    const kos = runTicks(gsm, ['R'], 200, () => { if (p.stocks === 3) maxX = Math.max(maxX, p.position.x); });
    // After the KO the player respawns and keeps running, so more KOs can follow
    check('Running off the edge passes x=14 and falls to a KO', maxX > 14 && kos.length >= 1, `maxX=${maxX.toFixed(2)} kos=${kos.length}`);
}

// Two rooms at once: both must move at full speed
{
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms });
    const p1 = makePlayer('P1', 0), p2 = makePlayer('P2', 0);
    p1.input.right = true; p2.input.right = true;
    rooms.set('R1', makeRoom('R1', [p1]));
    rooms.set('R2', makeRoom('R2', [p2]));
    runTicks(gsm, ['R1', 'R2'], 60);
    check('Two rooms ticking at once both move at full speed (~4 units/s)', Math.abs(p1.position.x - 4) < 0.1 && Math.abs(p2.position.x - 4) < 0.1, `${p1.position.x.toFixed(2)} / ${p2.position.x.toFixed(2)}`);
}

// Body collision: two players walking into each other stay apart
{
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms });
    const p1 = makePlayer('P1', -2), p2 = makePlayer('P2', 2);
    p1.input.right = true; p2.input.left = true;
    rooms.set('R', makeRoom('R', [p1, p2]));
    runTicks(gsm, ['R'], 90);
    const gap = p2.position.x - p1.position.x;
    check('Two players walking into each other stay apart', gap >= 0.79, `gap=${gap.toFixed(2)}`);
}

// Attacker in hitstun cannot attack
{
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms });
    const a = makePlayer('A', 0), b = makePlayer('B', 0.6);
    rooms.set('R', makeRoom('R', [a, b]));
    runTicks(gsm, ['R'], 1);
    gsm.queueAttack('A', 'kick', 'R');
    runTicks(gsm, ['R'], 8);
    check('A player in hitstun cannot counter-attack', gsm.queueAttack('B', 'punch', 'R') === null);
}

summary();
