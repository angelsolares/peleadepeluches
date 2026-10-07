// Smash phase 2: stages, falling items (bat, bomb, food) and KO slow motion (fake clock).
import GameStateManager from '../../server/gameState.js';
import { check, summary, quietServerLogs } from '../helpers/check.mjs';

quietServerLogs();

let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;

function makePlayer(id, x) {
    return {
        id, name: id, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
        health: 0, stocks: 3, facingRight: true,
        input: { left: false, right: false, up: false, down: false, jump: false, punch: false, kick: false, run: false },
    };
}
function setup(bx = 0.6, stage) {
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms, getRoomInfo: () => ({}) });
    const a = makePlayer('A', 0), b = makePlayer('B', bx);
    const room = { code: 'R', state: 'playing', players: new Map([[a.id, a], [b.id, b]]) };
    if (stage) room.stage = stage;
    rooms.set('R', room);
    const events = [], hits = [], kos = [];
    let last = null;
    const tick = (ms) => {
        const end = now + ms;
        while (now < end) {
            now += T;
            last = gsm.processTick('R') || last;
            hits.push(...gsm.processPendingAttacks('R'));
            events.push(...gsm.drainEvents('R'));
            kos.push(...gsm.checkKOs('R'));
        }
        return last;
    };
    tick(T);
    // Wait for the next spawn, move the item over the main ground (x=-9: no floating platform
    // above it in 'clasico') and let it land
    const spawnOnGround = (x = -9) => {
        const seen = events.filter(e => e.type === 'item-spawn').length;
        while (events.filter(e => e.type === 'item-spawn').length === seen) tick(T);
        const item = room.items[0];
        item.x = x; item.y = 9; item.vy = 0;
        tick(1500);
        return item;
    };
    return { gsm, room, a, b, tick, events, hits, kos, spawnOnGround, last: () => last };
}

// Stages
{
    const s = setup(0.6, 'torres');
    check('Stage is reported in the tick payload', s.last().stage === 'torres');
    s.a.position.x = 8.5; s.a.previousY = 0;
    s.tick(1500);
    check('Torres: x=8.5 is past the narrow ground, the player falls', s.a.position.y < -1 || s.kos.length > 0, `y=${s.a.position.y.toFixed(2)}`);
    const c = setup(0.6, 'clasico');
    c.a.position.x = 8.5; c.a.previousY = 0;
    c.tick(500);
    check('Clasico: x=8.5 is still on the 20-wide ground', c.a.isGrounded && c.a.position.y === 0);
    check('setStage rejects unknown stages and accepts known ones', s.gsm.setStage('R', 'luna') === null && s.gsm.setStage('R', 'clasico') === 'clasico' && s.gsm.getStage('R') === 'clasico');
}

// Items spawn, fall and land
{
    Math.random = () => 0.5;
    const s = setup(5);
    const item = s.spawnOnGround();
    const spawn = s.events.find(e => e.type === 'item-spawn');
    check('An item spawns 8-12 s into the match', !!spawn && now - 1_000_000 < 14000, JSON.stringify(spawn));
    check('The item lands on the stage', item && item.landed && item.y === 0, item && `y=${item.y} landed=${item.landed}`);
    check('Tick payload lists the item', s.last().items.length === 1 && s.last().items[0].kind === spawn.kind);
    s.tick(10500);
    check('Unclaimed items expire after 10 s and the next spawn is scheduled', s.room.items.length === 0 && s.events.some(e => e.type === 'item-expire') && s.room.nextItemAt > now);
}

// Bat
{
    Math.random = () => 0.1; // weights: bate first
    const s = setup(0.6);
    const item = s.spawnOnGround();
    check('Weighted pick: bate', item?.kind === 'bate', item?.kind);
    s.a.position.x = item.x; s.b.position.x = item.x + 0.6;
    s.tick(T * 2);
    check('Walking over the bat picks it up', s.a.heldItem?.kind === 'bate' && s.a.heldItem.hitsLeft === 3 && s.events.some(e => e.type === 'item-pickup' && e.playerId === 'A'));
    check('Held item is serialized', s.last().players.find(p => p.id === 'A').heldItem?.kind === 'bate');
    const h0 = s.b.health;
    s.gsm.queueAttack('A', 'punch', 'R');
    s.tick(250);
    const hit = s.hits[0];
    check('Bat punch: 13 damage (8 x 1.6) and BATAZO', hit?.hits[0]?.damage === 13 && hit.moveName === 'BATAZO' && hit.bat === true, JSON.stringify(hit?.hits[0]));
    check('One hit used', s.a.heldItem?.hitsLeft === 2);
    for (let i = 0; i < 2; i++) {
        s.b.position = { x: s.a.position.x + 0.6, y: 0, z: 0 }; s.b.velocity = { x: 0, y: 0, z: 0 }; s.b.hitstunUntil = 0; s.b.freezeUntil = 0;
        now += 600;
        s.gsm.queueAttack('A', 'punch', 'R');
        s.tick(250);
    }
    check('The bat breaks after 3 hits', !s.a.heldItem && s.events.some(e => e.type === 'item-break' && e.playerId === 'A'), `hits=${s.hits.length}`);
}

// Bat wears off with time
{
    Math.random = () => 0.1;
    const s = setup(5);
    s.a.position.x = s.spawnOnGround().x;
    s.tick(T * 2);
    check('Bat picked up', s.a.heldItem?.kind === 'bate');
    s.tick(10100);
    check('Bat wears off after 10 s', !s.a.heldItem && s.events.filter(e => e.type === 'item-break').length === 1);
}

// Bomb
{
    Math.random = () => 0.5; // bate 4 / bomba 3 / pollo 3 -> 0.5*10 = 5 -> bomba
    const s = setup(1.5);
    const item = s.spawnOnGround();
    check('Weighted pick: bomba', item?.kind === 'bomba', item?.kind);
    s.a.position.x = item.x; s.b.position.x = item.x + 1.5;
    s.tick(T * 2);
    check('Picking the bomb starts a 2.5 s fuse', s.a.heldItem?.kind === 'bomba' && s.a.heldItem.until - now > 2300);
    s.tick(2600);
    const boom = s.events.find(e => e.type === 'item-explode');
    check('The bomb explodes: holder takes 10, the rival 20, both launched', boom && boom.hits.length === 2 && s.a.health === 10 && s.b.health === 20 && s.b.velocity.y > 3 && s.a.velocity.y > 3, JSON.stringify(boom?.hits));
    check('Bomb is gone after exploding', !s.a.heldItem);
    const far = setup(6);
    Math.random = () => 0.5;
    far.a.position.x = far.spawnOnGround().x; far.b.position.x = far.a.position.x + 6;
    far.tick(T * 2 + 2600);
    check('A rival 6 m away is not hit by the bomb', far.b.health === 0 && far.a.health === 10);
}

// Food
{
    Math.random = () => 0.9; // -> pollo
    const s = setup(5);
    s.a.health = 80;
    const food = s.spawnOnGround();
    check('Weighted pick: pollo', food?.kind === 'pollo');
    s.a.position.x = food.x;
    s.tick(T * 2);
    check('Food heals 30% on pickup (80 -> 50) and is not held', s.a.health === 50 && !s.a.heldItem && s.events.some(e => e.type === 'item-heal' && e.healed === 30));
}

// Launched players can't pick up, and only one item at a time
{
    Math.random = () => 0.1;
    const s = setup(5);
    s.a.position.x = s.spawnOnGround().x;
    s.a.hitstunUntil = now + 5000;
    s.tick(T * 3);
    check('A launched player cannot pick up items', !s.a.heldItem && s.room.items.length === 1);
    check('No second item while one is on the stage', s.room.items.length === 1 && s.room.nextItemAt === Infinity);
}

// KO slow motion
{
    const s = setup(5);
    s.a.input.right = true;
    s.tick(500);
    const x0 = s.a.position.x;
    s.tick(500);
    const normal = s.a.position.x - x0;
    s.b.position.x = 25; // B gets KO'd
    s.tick(T * 2); // the KO is detected after the first tick's payload
    const ko = s.kos[0];
    check('KO payload carries the position and slow-mo length', ko && ko.position.x === 25 && ko.slowMoMs === 800, JSON.stringify(ko));
    check('Tick payload flags slow motion', s.last().slowMo === true);
    const x1 = s.a.position.x;
    s.tick(500);
    const slow = s.a.position.x - x1;
    check('Everyone moves at ~30% speed during the slow motion', slow < normal * 0.4 && slow > normal * 0.2, `${slow.toFixed(2)} vs ${normal.toFixed(2)}`);
    s.tick(600);
    const x2 = s.a.position.x;
    s.tick(500);
    check('Normal speed again after 0.8 s', Math.abs((s.a.position.x - x2) - normal) < normal * 0.1 && s.last().slowMo === false);
}

// Reset
{
    Math.random = () => 0.1;
    const s = setup(5);
    s.a.position.x = s.spawnOnGround().x;
    s.tick(T * 2);
    s.gsm.resetGame('R');
    check('resetGame clears items, held items and slow motion', s.room.items.length === 0 && !s.a.heldItem && s.room.slowMoUntil === 0);
}

summary();
