// Arena lucha libre fase 2: barra de ánimo, burlas y remates por personaje (fake clock).
import ArenaStateManager from '../../server/arenaState.js';

const realLog = console.log;
console.log = (...a) => { if (!String(a[0]).startsWith('[') && !String(a[0]).startsWith('  -')) realLog(...a); };
let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;
import { check, summary } from '../helpers/check.mjs';

function setup(charA = 'edgar', charB = 'lia') {
    const rooms = new Map();
    const players = new Map([
        ['P0', { id: 'P0', name: 'A', number: 1, character: charA, input: {} }],
        ['P1', { id: 'P1', name: 'B', number: 2, character: charB, input: {} }]
    ]);
    rooms.set('R', { gameMode: 'arena', state: 'playing', players });
    const asm = new ArenaStateManager({ rooms });
    const st = asm.initializeArena('R');
    const A = st.players.get('P0'), B = st.players.get('P1');
    A.position = { x: 0, y: 0.5, z: 0 }; A.facingAngle = Math.PI / 2;
    B.position = { x: 1, y: 0.5, z: 0 };
    const events = [];
    const tick = (ms) => {
        const end = now + ms;
        while (now < end) {
            now += T;
            asm.processTick('R');
            asm.processPendingAttacks('R');
            asm.checkRingOuts('R');
            events.push(...asm.drainEvents('R'));
        }
    };
    const fill = (p) => { asm.addSpirit(st, p, 100); events.push(...asm.drainEvents('R')); };
    return { asm, st, A, B, events, tick, fill, input: (id, o) => { rooms.get('R').players.get(id).input = o; } };
}

// Spirit gains and losses
{
    const s = setup();
    s.asm.queueAttack('P0', 'punch', 'R');
    s.tick(300);
    check('A landed punch gives the attacker spirit', s.A.spirit === 5, `A=${s.A.spirit}`);
    s.B.spirit = 10;
    now += 600;
    s.asm.queueAttack('P0', 'kick', 'R');
    s.tick(300);
    check('Taking a hit lowers spirit a little', s.B.spirit === 7, `B=${s.B.spirit}`);
}

// Taunting fills spirit, ends on its own and is refused while grappling
{
    const s = setup();
    const ok = s.asm.setPlayerTaunting('P0', 'R', true);
    s.tick(2000);
    check('Taunting fills the meter (~22/s)', ok && s.A.spirit > 40 && s.A.spirit < 48, `A=${s.A.spirit.toFixed(1)}`);
    s.tick(700);
    check('Taunt ends after 2.5 s', !s.A.isTaunting);
    s.asm.processGrab('P0', 'R');
    check('Cannot taunt while in a tie-up', s.asm.setPlayerTaunting('P0', 'R', true) === false);
}

// Reaching 100 -> SPECIAL, timeout -> 60
{
    const s = setup();
    s.fill(s.A);
    check('Full meter turns SPECIAL', s.asm.isSpecial(s.A) && s.events.some(e => e.name === 'arena-special'));
    s.tick(12100);
    check('Unused SPECIAL ends after 12 s and the meter drops to 60', !s.asm.isSpecial(s.A) && s.A.spirit === 60 && s.events.some(e => e.name === 'arena-special-end'));
}

// Finisher requires SPECIAL
{
    const s = setup();
    s.asm.processGrab('P0', 'R');
    check('Finisher refused without SPECIAL', s.asm.processFinisher('P0', 'R').error === 'not-special');
}

// Powerbomb (Edgar) from a tie-up
{
    const s = setup('edgar');
    s.fill(s.A);
    check('Powerbomb needs a tie-up', s.asm.processFinisher('P0', 'R').error === 'need-tieup');
    s.asm.processGrab('P0', 'R');
    const r = s.asm.processFinisher('P0', 'R');
    s.tick(1400);
    check('EDGARBOMBA: 30 damage, defender down, meter spent', r.success && r.finisher.name === 'EDGARBOMBA' && s.B.health === 70 && s.B.isDown && s.A.spirit === 0 && !s.asm.isSpecial(s.A), `hp=${s.B.health}`);
    check('Finisher events are queued', s.events.some(e => e.name === 'arena-finisher') && s.events.some(e => e.name === 'arena-grapple-impact' && e.data.move === 'finisher'));
}

// Piledriver (Jesus) and DDT (Lia)
for (const [ch, type, dmg] of [['jesus', 'piledriver', 32], ['lia', 'ddt', 28]]) {
    const s = setup(ch, 'edgar');
    s.fill(s.A);
    s.asm.processGrab('P0', 'R');
    const r = s.asm.processFinisher('P0', 'R');
    s.tick(1800);
    check(`${type} (${ch}): ${dmg} damage and down`, r.finisher?.finisher === type && s.B.health === 100 - dmg && s.B.isDown, `hp=${s.B.health}`);
}

// Superkick (Hector): launches the defender, who lands on the mat
{
    const s = setup('hector');
    s.fill(s.A);
    const r = s.asm.processFinisher('P0', 'R');
    s.tick(600);
    const flying = s.B.isBeingThrown;
    s.tick(1500);
    check('Superkick launches the defender', r.success && flying && s.B.health === 72, `hp=${s.B.health}`);
    check('Superkicked defender lands on the mat (or out of the ring)', s.B.isDown || s.B.isEliminated, `x=${s.B.position.x.toFixed(2)} down=${s.B.isDown}`);
}

// Superkick near the ropes rings out
{
    const s = setup('katy');
    s.A.position = { x: 6, y: 0.5, z: 0 };
    s.B.position = { x: 7, y: 0.5, z: 0 };
    s.fill(s.A);
    s.asm.processFinisher('P0', 'R');
    s.tick(2500);
    check('Superkick near the ropes can ring out', s.B.isEliminated, `x=${s.B.position.x.toFixed(2)}`);
}

// Splash (Angel) needs a downed opponent
{
    const s = setup('angel');
    s.fill(s.A);
    check('Splash needs a downed opponent', s.asm.processFinisher('P0', 'R').error === 'no-target');
    s.B.isDown = true; s.B.downUntil = now + 3000;
    s.B.position = { x: 2.5, y: 0.5, z: 0 };
    const r = s.asm.processFinisher('P0', 'R');
    s.tick(900);
    check('SALTO DEL ÁNGEL: 30 damage, attacker lands next to the victim', r.success && s.B.health === 70 && Math.abs(s.A.position.x - 1.9) < 0.05 && s.B.isDown, `A.x=${s.A.position.x.toFixed(2)}`);
}

// Finisher can knock out
{
    const s = setup('edgar');
    s.B.health = 20;
    s.fill(s.A);
    s.asm.processGrab('P0', 'R');
    s.asm.processFinisher('P0', 'R');
    s.tick(1400);
    check('A finisher can eliminate', s.B.isEliminated && s.events.some(e => e.name === 'arena-elimination'));
}

// Serialization
{
    const s = setup('fabian');
    s.fill(s.A);
    const st = s.asm.getPlayerStateForClient(s.A);
    check('State exposes spirit, special and the finisher', st.spirit === 100 && st.isSpecial && st.finisher.name === 'PATADA HURACÁN' && st.finisher.variant === 'hurricane' && st.specialMsLeft > 0);
}

summary();
