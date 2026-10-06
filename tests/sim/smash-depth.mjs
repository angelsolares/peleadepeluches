// Smash depth checks: double jump, directional moves, shield and hitstop (fake clock).
import GameStateManager from '../../server/gameState.js';

let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;
import { check, summary } from '../helpers/check.mjs';

function makePlayer(id, x) {
    return {
        id, name: id, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
        health: 0, stocks: 3, facingRight: true,
        input: { left: false, right: false, up: false, down: false, jump: false, punch: false, kick: false, run: false },
    };
}
function setup(bx = 0.6) {
    const rooms = new Map();
    const gsm = new GameStateManager({ rooms });
    const a = makePlayer('A', 0), b = makePlayer('B', bx);
    rooms.set('R', { code: 'R', state: 'playing', players: new Map([[a.id, a], [b.id, b]]) });
    const events = [];
    const hits = [];
    const kos = [];
    const tick = (ms) => {
        const end = now + ms;
        while (now < end) {
            now += T;
            gsm.processTick('R');
            hits.push(...gsm.processPendingAttacks('R'));
            events.push(...gsm.drainEvents('R'));
            kos.push(...gsm.checkKOs('R'));
        }
    };
    tick(T);
    return { gsm, a, b, tick, events, hits, kos };
}

// Double jump
{
    const s = setup();
    s.a.input.jump = true; s.tick(T);                      // ground jump (edge)
    s.a.input.jump = false; s.tick(300);
    const yBefore = s.a.position.y, vyBefore = s.a.velocity.y;
    s.a.input.jump = true; s.tick(T);                      // air jump
    check('Second press in the air jumps again', s.a.velocity.y > vyBefore && s.a.velocity.y > 10 && s.a.airJumps === 0, `vy ${vyBefore.toFixed(1)} -> ${s.a.velocity.y.toFixed(1)} y=${yBefore.toFixed(2)}`);
    s.a.input.jump = false; s.tick(100);
    s.a.input.jump = true; s.tick(T);
    check('Third press does nothing (only one air jump)', s.a.velocity.y < 10 && s.a.airJumps === 0, `vy=${s.a.velocity.y.toFixed(1)}`);
    s.a.input.jump = false;
    s.tick(2000);
    check('Air jump refills on landing', s.a.isGrounded && s.a.airJumps === 1);
    check('doubleJumpSeq counts the air jump', s.gsm.serializePlayer(s.a).doubleJumpSeq === 1);
}

// Holding the stick up doesn't bounce on landing
{
    const s = setup();
    s.a.input.jump = true;
    let jumps = 0, wasGrounded = true;
    for (let i = 0; i < 240; i++) { s.tick(T); if (wasGrounded && !s.a.isGrounded) jumps++; wasGrounded = s.a.isGrounded; }
    check('Holding jump = 1 ground jump + 1 air jump, no bouncing', jumps === 1 && s.a.isGrounded, `takeoffs=${jumps}`);
}

// Directional variants
{
    const s = setup();
    check('Neutral punch', s.gsm.queueAttack('A', 'punch', 'R').variant === 'neutral');
    const s2 = setup(); s2.a.input.right = true;
    check('Stick sideways = side smash', s2.gsm.queueAttack('A', 'punch', 'R').variant === 'side');
    const s3 = setup(); s3.a.input.jump = true;
    check('Stick up = uppercut', s3.gsm.queueAttack('A', 'kick', 'R').variant === 'up');
    const s4 = setup(); s4.a.input.down = true;
    check('Stick down on the ground = sweep', s4.gsm.queueAttack('A', 'kick', 'R').variant === 'sweep');
    const s5 = setup(); s5.a.input.jump = true; s5.tick(T); s5.a.input.jump = false; s5.tick(200); s5.a.input.down = true;
    const r5 = s5.gsm.queueAttack('A', 'kick', 'R');
    check('Stick down in the air = meteor', r5?.variant === 'meteor' && r5.moveName === 'METEORO', JSON.stringify(r5 && { v: r5.variant, grounded: s5.a.isGrounded }));
}

// Knockback angles per variant
function landHit(variant, type = 'kick', bx = 0.6, airborneB = false) {
    const s = setup(bx);
    if (airborneB) { s.b.position.y = 1.2; s.b.previousY = 1.2; s.a.position.y = 1.5; s.a.previousY = 1.5; s.a.isGrounded = false; }
    if (variant === 'side') s.a.input.right = true;
    if (variant === 'up') s.a.input.jump = true;
    if (variant === 'sweep') s.a.input.down = true;
    if (variant === 'meteor') { s.a.input.down = true; s.a.isGrounded = false; }
    const q = s.gsm.queueAttack('A', type, 'R');
    s.a.input = { ...s.a.input, right: false, jump: false, down: false };
    s.tick(250);
    const hit = s.hits[0]?.hits[0];
    return { s, q, hit };
}
{
    const n = landHit('neutral'), side = landHit('side'), up = landHit('up'), sw = landHit('sweep');
    check('Side smash: more damage, flatter and stronger horizontally', side.hit && side.hit.damage === 16 && side.hit.knockback.x > n.hit.knockback.x && side.hit.knockback.y < n.hit.knockback.y, `n=${JSON.stringify(n.hit?.knockback)} side=${JSON.stringify(side.hit?.knockback)}`);
    check('Uppercut launches mostly up', up.hit && up.hit.knockback.y > up.hit.knockback.x * 2, JSON.stringify(up.hit?.knockback));
    check('Sweep: low launch, long hitstun', sw.hit && sw.hit.knockback.y < 2 && sw.hit.hitstun > n.hit.hitstun * 1.5, `hitstun ${n.hit?.hitstun.toFixed(2)} -> ${sw.hit?.hitstun.toFixed(2)}`);
    const met = landHit('meteor', 'kick', 0.6, true);
    check('Meteor in the air sends the rival DOWN', met.hit && met.hit.knockback.y < -3, JSON.stringify(met.hit?.knockback));
    const metG = landHit('meteor');
    check('Meteor on a grounded rival bounces them up instead', metG.hit && metG.hit.knockback.y > 0, JSON.stringify(metG.hit?.knockback));
    check('Hit payload carries the move name', side.hits === undefined && side.s.hits[0].moveName === 'SMASH');
}

// Knockback direction: a rival on the LEFT is pushed left
{
    const s = setup(-0.6);
    s.a.facingRight = false;
    s.gsm.queueAttack('A', 'punch', 'R');
    s.tick(250);
    check('Rival on the left is launched to the left', s.hits[0]?.hits[0]?.knockback.x < 0, JSON.stringify(s.hits[0]?.hits[0]?.knockback));
}

// Hitstop: both freeze for a moment, then the launch happens
{
    const s = setup();
    s.gsm.queueAttack('A', 'kick', 'R');
    s.tick(150);                                            // hit lands at ~110 ms
    const hit = s.hits[0]?.hits[0];
    const xAtHit = s.b.position.x;
    s.tick(T);                                              // one frozen tick
    const movedDuringFreeze = Math.abs(s.b.position.x - xAtHit) > 0.001;
    check('Hitstop freezes the victim right after the hit', hit && hit.hitstop >= 70 && !movedDuringFreeze, `hitstop=${hit?.hitstop}ms`);
    check('Attacker is frozen too and cannot attack during hitstop', s.gsm.queueAttack('A', 'punch', 'R') === null);
    s.tick(hit.hitstop + 50);
    check('Momentum is released after the hitstop', s.b.position.x > xAtHit + 0.1, `x ${xAtHit.toFixed(2)} -> ${s.b.position.x.toFixed(2)}`);
}

// Shield: drains while held, blocked hits cost shield, breaks at 0 with a stun
{
    const s = setup();
    check('Shield can be raised at 100', s.gsm.setPlayerBlocking('B', 'R', true) === true);
    s.tick(2000);
    check('Holding block drains the shield (~10/s)', s.b.shield > 78 && s.b.shield < 82, `shield=${s.b.shield.toFixed(1)}`);
    s.gsm.queueAttack('A', 'kick', 'R');
    s.tick(250);
    const h = s.hits[0]?.hits[0];
    check('Blocked kick: 3 damage, shield -42 (plus the hold drain)', h && h.blocked && h.damage === 3 && s.b.shield < 40 && s.b.shield > 34, `shield=${s.b.shield.toFixed(1)} dmg=${h?.damage}`);
    s.tick(300);
    s.gsm.queueAttack('A', 'kick', 'R');
    s.tick(250);
    const h2 = s.hits[1]?.hits[0];
    check('Second kick breaks the shield: full damage + break event', h2 && h2.shieldBroke && !h2.blocked && h2.damage === 12 && s.events.some(e => e.type === 'shield-break' && e.playerId === 'B'), JSON.stringify(h2));
    check('Broken shield: not blocking, stunned ~2 s', !s.b.isBlocking && s.b.shieldStunUntil > now + 1500);
    check('Cannot raise a broken shield', s.gsm.setPlayerBlocking('B', 'R', true) === false);
    s.tick(2200);
    check('After the stun the shield restarts at ~30', s.b.shield >= 30 && s.b.shield < 40, `shield=${s.b.shield.toFixed(1)}`);
    s.tick(5000);
    check('Shield regenerates to 100 while down', s.b.shield === 100);
}

// Holding block until it breaks on its own
{
    const s = setup();
    s.gsm.setPlayerBlocking('B', 'R', true);
    s.tick(10500);
    check('Holding block for 10 s breaks it', s.events.some(e => e.type === 'shield-break') && !s.b.isBlocking, `shield=${s.b.shield}`);
}

// Serialization / KO reset
{
    const s = setup();
    const st = s.gsm.serializePlayer(s.b);
    check('State exposes shield, isBlocking, airJumps', st.shield === 100 && st.isBlocking === false && st.airJumps === 1);
    s.b.shield = 5; s.b.position.x = 25;
    s.tick(T);
    check('KO resets the shield', s.kos.length === 1 && s.b.shield === 100);
}

summary();
