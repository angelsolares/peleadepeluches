// La Trae (tag) rules, simulated against the real state manager with a fake clock:
// real-delta movement, power-ups (rayo / escudo), shields vs tags, spawn/expire timing.
//   node tests/sim/tag.mjs
import TagStateManager, { TAG_CONFIG } from '../../server/tagState.js';
import { check, summary } from '../helpers/check.mjs';

let now = 1_000_000;
Date.now = () => now;
const realRandom = Math.random;
const T60 = 1000 / 60;
const T36 = 1000 / 36;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const noInput = () => ({ left: false, right: false, up: false, down: false, run: false });

/**
 * Fresh room with n players (P0 is "It": Math.random is forced to 0 during init).
 * Players sit on a spawn circle of radius 7, so the center is clear for power-ups.
 */
function setup(n = 3, { random = () => 0.5 } = {}) {
    now = 1_000_000;
    Math.random = () => 0;
    const rooms = new Map();
    const players = new Map();
    for (let i = 0; i < n; i++) {
        players.set(`P${i}`, { id: `P${i}`, name: `Bot${i}`, number: i + 1, color: '#fff', character: 'edgar', input: noInput() });
    }
    rooms.set('R', { gameMode: 'tag', state: 'playing', players, hostId: 'H' });
    const tsm = new TagStateManager({ rooms, io: null });
    tsm.initializeTag('R');
    Math.random = random;
    const st = tsm.tagStates.get('R');
    let last = null;
    const events = [];
    // Advance the clock in `step` ms ticks until `target` (inclusive), ticking the manager
    const tickTo = (target, step = T60) => {
        while (now < target) {
            now = Math.min(target, now + step);
            last = tsm.processTick('R') || last;
            events.push(...tsm.drainEvents('R'));
        }
        return last;
    };
    const P = (id) => st.players.get(id);
    const setInput = (id, input) => { players.get(id).input = { ...noInput(), ...input }; };
    const place = (id, x, z) => { P(id).position.x = x; P(id).position.z = z; P(id).velocity.x = 0; P(id).velocity.z = 0; };
    return { tsm, st, players, tickTo, P, setInput, place, events, get last() { return last; } };
}

// Real delta: walking 1 s covers the same distance whatever the tick rate
{
    const walk = (step) => {
        const s = setup(2);
        s.place('P0', -8, 8); // "It" out of the way
        s.place('P1', 0, 0);
        s.setInput('P1', { right: true });
        s.tickTo(now + 1000, step);
        return s.P('P1').position.x;
    };
    const d60 = walk(T60);
    const d36 = walk(T36);
    const expected = TAG_CONFIG.MOVE_SPEED * TAG_CONFIG.FRICTION; // 5.95 m/s
    check('Walking 1 s at 60 Hz ticks moves ~MOVE_SPEED*FRICTION', Math.abs(d60 - expected) / expected < 0.02, `d60=${d60.toFixed(3)} expected=${expected.toFixed(3)}`);
    check('Walking 1 s at 36 Hz ticks moves the same distance (within 2%)', Math.abs(d36 - d60) / d60 < 0.02, `d36=${d36.toFixed(3)} d60=${d60.toFixed(3)}`);

    // Friction after releasing the stick is also tick-rate independent
    const coast = (step) => {
        const s = setup(2);
        s.place('P0', -8, 8);
        s.place('P1', 0, 0);
        s.setInput('P1', { right: true });
        s.tickTo(now + 500, step);
        s.setInput('P1', {});
        s.tickTo(now + 500, step);
        return s.P('P1').position.x;
    };
    const c60 = coast(T60), c36 = coast(T36);
    check('Coasting to a stop covers the same distance at 60 and 36 Hz (within 2%)', Math.abs(c36 - c60) / c60 < 0.02, `c60=${c60.toFixed(3)} c36=${c36.toFixed(3)}`);

    // A long stall is clamped so nobody teleports
    const s = setup(2);
    s.place('P1', 0, 0);
    s.setInput('P1', { right: true });
    now += 2000;
    s.tsm.processTick('R');
    check('A 2 s stall is clamped to MAX_DELTA (no teleport)', s.P('P1').position.x <= expected * TAG_CONFIG.MAX_DELTA + 1e-9, `x=${s.P('P1').position.x.toFixed(3)}`);
}

// Power-up spawns within 14 s, inside the boundary and away from the players
{
    const s = setup(3);
    const limit = TAG_CONFIG.BOUNDARY - TAG_CONFIG.POWERUP_MARGIN;
    s.tickTo(now + 14000);
    const spawn = s.events.find(e => e.type === 'spawn');
    const pu = s.last.powerUp;
    check('A power-up spawns within 14 s (spawn event + state.powerUp)', !!spawn && !!pu && pu.id === spawn.id && pu.kind === spawn.kind, pu ? `${pu.kind} at t+${((pu.expiresAt - TAG_CONFIG.POWERUP_LIFETIME) - s.st.startTime) / 1000}s` : 'none');
    check('Spawn delay is 10-14 s after the start', !!pu && (pu.expiresAt - TAG_CONFIG.POWERUP_LIFETIME) - s.st.startTime >= TAG_CONFIG.POWERUP_SPAWN_MIN - T60);
    check('Spawned inside |x|,|z| <= BOUNDARY - 1.5', !!pu && Math.abs(pu.position.x) <= limit && Math.abs(pu.position.z) <= limit, pu ? `(${pu.position.x.toFixed(2)}, ${pu.position.z.toFixed(2)})` : '');
    const nearest = pu ? Math.min(...[...s.st.players.values()].map(p => dist(p.position, pu.position))) : 0;
    check('Spawned at least 3 m from every player', nearest >= TAG_CONFIG.POWERUP_PLAYER_CLEARANCE, `nearest=${nearest.toFixed(2)}`);
    check('State payload carries powerUp {id, kind, position, expiresAt} and per-player effect fields',
        !!pu && typeof pu.id === 'string' && typeof pu.expiresAt === 'number' && typeof pu.position.x === 'number'
        && s.last.players.every(p => 'boosted' in p && 'shielded' in p && 'boostMsLeft' in p && 'shieldMsLeft' in p));

    // Uncollected: expires after 12 s and the next spawn timer starts afterwards
    const expiresAt = pu.expiresAt;
    s.tickTo(expiresAt - T60);
    check('Still on the map just before 12 s', !!s.last.powerUp && s.last.powerUp.id === pu.id);
    s.tickTo(expiresAt);
    const expire = s.events.find(e => e.type === 'expire');
    check('Expires after 12 s uncollected (expire event, powerUp null)', !!expire && expire.id === pu.id && s.last.powerUp === null);
    check('Next spawn timer starts after the expiry (>= 10 s later)', s.st.nextPowerUpAt - now >= TAG_CONFIG.POWERUP_SPAWN_MIN - 1, `in ${((s.st.nextPowerUpAt - now) / 1000).toFixed(1)}s`);
}

// Rayo: collecting makes the player faster for ~4 s
{
    const s = setup(2, { random: () => 0 }); // Math.random 0 -> 'rayo', spawn delay 10 s, spot (-8, -8)
    s.tickTo(s.st.nextPowerUpAt);
    const pu = s.last.powerUp;
    check('Forced Math.random = 0 spawns a rayo', !!pu && pu.kind === 'rayo', pu?.kind);
    // Put the non-"It" player on the power-up and watch 1 s of walking ("It" far away)
    s.place('P0', -8, 8);
    s.place('P1', pu.position.x, pu.position.z);
    s.setInput('P1', { right: true });
    const x0 = s.P('P1').position.x;
    s.tickTo(now + T60);
    const collect = s.events.find(e => e.type === 'collect');
    check('Walking within 1.2 m collects it (collect event with playerId/playerName, powerUp null)',
        !!collect && collect.playerId === 'P1' && collect.playerName === 'Bot1' && collect.kind === 'rayo' && s.last.powerUp === null);
    const me = s.last.players.find(p => p.id === 'P1');
    check('Collector is boosted with ~4 s left', me.boosted === true && me.boostMsLeft > 3900 && me.boostMsLeft <= 4000, `boostMsLeft=${me.boostMsLeft}`);
    s.place('P1', 0, 0);
    s.tickTo(now + 1000);
    const boostedDistance = s.P('P1').position.x;
    const normal = TAG_CONFIG.MOVE_SPEED * TAG_CONFIG.FRICTION;
    check('Boosted player walks 1.5x faster (distance over 1 s)', Math.abs(boostedDistance - normal * TAG_CONFIG.BOOST_MULTIPLIER) / normal < 0.03, `boosted=${boostedDistance.toFixed(2)} normal=${normal.toFixed(2)}`);
    s.tickTo(now + 3000 + T60);
    check('Boost is gone after 4 s', s.last.players.find(p => p.id === 'P1').boosted === false);
    s.place('P1', 0, 0);
    s.tickTo(now + 1000);
    check('Back to normal speed afterwards', Math.abs(s.P('P1').position.x - normal) / normal < 0.02, `d=${s.P('P1').position.x.toFixed(2)}`);
}

// Escudo: a shielded player can't be tagged until the shield ends; "It" can't collect it
{
    const s = setup(2, { random: () => 0.9 }); // 0.9 -> 'escudo' (first spawn), spawn delay 13.6 s
    s.tickTo(s.st.nextPowerUpAt);
    const pu = s.last.powerUp;
    check('Forced Math.random = 0.9 spawns an escudo', !!pu && pu.kind === 'escudo', pu?.kind);

    // "It" (P0) stands on it: not collected
    s.place('P0', pu.position.x, pu.position.z);
    s.tickTo(now + 500);
    check('"It" standing on the escudo does not collect it', !!s.last.powerUp && s.last.powerUp.id === pu.id && !s.events.some(e => e.type === 'collect'));

    // P1 takes it, then "It" runs into P1: no tag while shielded
    s.place('P0', 5, 5);
    s.place('P1', pu.position.x, pu.position.z);
    s.tickTo(now + T60);
    const collect = s.events.find(e => e.type === 'collect');
    check('Non-"It" player collects the escudo', !!collect && collect.playerId === 'P1' && collect.kind === 'escudo');
    const shieldedAt = now;
    s.place('P0', 0, 0);
    s.place('P1', 0.5, 0);
    s.tickTo(shieldedAt + TAG_CONFIG.SHIELD_DURATION - T60);
    const p1 = s.last.players.find(p => p.id === 'P1');
    check('Shielded player is not tagged while "It" stands next to them (~4 s)', s.st.itPlayerId === 'P0' && p1.shielded === true && p1.isIt === false, `shieldMsLeft=${p1.shieldMsLeft}`);
    s.tickTo(shieldedAt + TAG_CONFIG.SHIELD_DURATION + T60);
    check('Once the shield ends, the tag lands', s.st.itPlayerId === 'P1' && s.P('P1').isIt === true && s.P('P0').isIt === false);
    check('Tagged player gets the grace period as before', s.P('P0').graceUntil > now && s.last.players.find(p => p.id === 'P0').hasGrace === true);
    check('Penalty time keeps accruing for "It"', s.P('P0').penaltyTime > 4000, `penalty=${s.P('P0').penaltyTime.toFixed(0)}ms`);
}

// Never two escudos in a row (even when Math.random always picks escudo)
{
    const s = setup(2, { random: () => 0.9 });
    const kinds = [];
    for (let i = 0; i < 4; i++) { // 4 x (13.6 s + 12 s) fits in the 120 s match
        s.tickTo(s.st.nextPowerUpAt);
        kinds.push(s.last.powerUp?.kind);
        s.tickTo(s.last.powerUp.expiresAt); // let it expire
    }
    const twoShields = kinds.some((k, i) => i > 0 && k === 'escudo' && kinds[i - 1] === 'escudo');
    check('Four spawns with Math.random forced to escudo alternate (no two escudos in a row)', !twoShields && kinds.includes('escudo') && kinds.includes('rayo'), kinds.join(','));
    check('Only one power-up on the map at a time (4 spawns, 4 expiries, none overlapping)', s.events.filter(e => e.type === 'spawn').length === 4 && s.events.filter(e => e.type === 'expire').length === 4);
}

// Leaver handling and results still work with the new fields
{
    const s = setup(3);
    s.tickTo(now + 1000);
    s.players.delete('P0'); // "It" leaves
    s.tickTo(now + T60);
    check('When "It" leaves, another player becomes "It"', s.st.itPlayerId !== 'P0' && s.st.players.size === 2 && s.P(s.st.itPlayerId).isIt === true, `it=${s.st.itPlayerId}`);
    const final = s.tickTo(s.st.startTime + TAG_CONFIG.MATCH_DURATION * 1000 + 10);
    check('Match ends at 120 s with winner + ranking', final.gameState === 'finished' && !!final.winner && final.ranking.length === 2, `winner=${final.winner?.name}`);
    s.tsm.cleanup('R');
    check('cleanup drops the state and pending events', !s.tsm.tagStates.has('R') && s.tsm.drainEvents('R').length === 0);
}

Math.random = realRandom;
summary();
