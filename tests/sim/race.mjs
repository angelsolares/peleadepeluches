// Race rules (real-delta ticks and hurdles), simulated against the real state manager with a fake clock.
//   node tests/sim/race.mjs
import { RaceStateManager, RACE_CONFIG } from '../../server/raceState.js';
import { check, summary, quietServerLogs } from '../helpers/check.mjs';

quietServerLogs();
let now = 1_000_000;
Date.now = () => now;
const approx = (a, b, rel = 0.02) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * rel + 1e-9;
const { JUMP_WINDOW_MIN, JUMP_WINDOW_MAX, JUMP_DURATION, STUMBLE_SPEED, STUMBLE_DURATION, TRACK_LENGTH, FINISH_TIMEOUT } = RACE_CONFIG;

function setup(n = 2) {
    now = 1_000_000;
    const players = new Map();
    for (let i = 0; i < n; i++) {
        players.set(`P${i}`, { id: `P${i}`, name: `Bot${i}`, number: i + 1, character: 'edgar', characterName: `Bot${i}` });
    }
    const rooms = new Map([['R', { gameMode: 'race', state: 'playing', players }]]);
    const rsm = new RaceStateManager({ rooms });
    rsm.initializeRace('R');
    const emitted = [];
    const io = { to: () => ({ emit: (ev, data) => emitted.push({ ev, data }) }) };
    rsm.startRace('R', io);
    const st = rsm.raceStates.get('R');
    let last = null;
    // Advance the clock `ms` and process one tick
    const tick = (ms) => { now += ms; last = rsm.processTick('R') || last; return last; };
    // Tick every `stepMs` for `totalMs`
    const runFor = (totalMs, stepMs) => {
        const end = now + totalMs;
        while (now < end) tick(Math.min(stepMs, end - now));
        return last;
    };
    const P = (id) => st.players.get(id);
    const me = (id) => last?.players.find(p => p.id === id);
    return { rsm, st, tick, runFor, emitted, P, me, get last() { return last; } };
}

// A) Real-delta ticks: the same second of coasting costs the same speed at 60 Hz and at 36 Hz
{
    const a = setup(1);
    a.P('P0').speed = 20;
    a.runFor(1000, 1000 / 60);
    const b = setup(1);
    b.P('P0').speed = 20;
    b.runFor(1000, 1000 / 36);
    check('Deceleration over 1 s is the same at 60 Hz and 36 Hz ticks (within 2%)',
        approx(a.P('P0').speed, b.P('P0').speed) && a.P('P0').speed > 0.1,
        `60Hz=${a.P('P0').speed.toFixed(3)} 36Hz=${b.P('P0').speed.toFixed(3)} expected=${(20 * Math.pow(RACE_CONFIG.DECELERATION, 60)).toFixed(3)}`);
    check('Distance covered over 1 s is the same at 60 Hz and 36 Hz (within 5%, Euler step error only)',
        approx(a.P('P0').position, b.P('P0').position, 0.05), `60Hz=${a.P('P0').position.toFixed(2)} 36Hz=${b.P('P0').position.toFixed(2)}`);

    const c = setup(1);
    c.P('P0').speed = 20;
    c.tick(500); // a stalled loop
    check('A tick delta is clamped to MAX_TICK_DELTA (a 500 ms stall moves 50 ms worth)',
        approx(c.P('P0').position, 20 * Math.pow(RACE_CONFIG.DECELERATION, 3) * RACE_CONFIG.MAX_TICK_DELTA, 0.001),
        `pos=${c.P('P0').position.toFixed(3)}`);
}

// B) Hurdle placement
{
    let ok = true, detail = '';
    for (let i = 0; i < 200 && ok; i++) {
        const s = setup(1);
        const h = s.st.hurdles;
        const inRange = h.length === 3 && h.every(x => x.position >= 25 && x.position <= 85);
        const sorted = h.every((x, k) => k === 0 || x.position > h[k - 1].position);
        const apart = h.every((x, k) => k === 0 || x.position - h[k - 1].position >= 15 - 1e-9);
        const ids = new Set(h.map(x => x.id)).size === 3;
        ok = inRange && sorted && apart && ids;
        detail = h.map(x => `${x.id}@${x.position}`).join(' ');
    }
    check('3 hurdles placed in [25, 85], sorted, >= 15 m apart, unique ids (200 races)', ok, detail);

    const s = setup(1);
    const start = s.emitted.find(e => e.ev === 'race-start');
    check("'race-start' carries the hurdles", !!start && JSON.stringify(start.data.hurdles) === JSON.stringify(s.st.hurdles));
    const state = s.tick(16);
    check('race-state carries the hurdles and per-player jumping/stumbled/nextHurdleDistance',
        JSON.stringify(state.hurdles) === JSON.stringify(s.st.hurdles)
        && state.players.every(p => p.jumping === false && p.stumbled === false && approx(p.nextHurdleDistance, s.st.hurdles[0].position - p.position, 0.01)),
        `next=${state.players[0].nextHurdleDistance}`);
}

// Jump in the window: hurdle cleared, no speed loss, jumping for JUMP_DURATION
{
    const s = setup(1);
    const h0 = s.st.hurdles[0];
    const p = s.P('P0');
    p.position = h0.position - 3;
    p.speed = 12;
    const res = s.rsm.processJump('P0', 'R');
    check('Jump 3 m before a hurdle is valid and clears it',
        res?.valid === true && res.hurdleId === h0.id && p.clearedHurdles.has(h0.id), JSON.stringify(res));
    check('Jump costs no speed', p.speed === 12, `speed=${p.speed}`);
    s.tick(16);
    check('State shows jumping and the NEXT hurdle distance right after the jump',
        s.me('P0').jumping === true && approx(s.me('P0').nextHurdleDistance, s.st.hurdles[1].position - p.position, 0.01),
        `next=${s.me('P0').nextHurdleDistance}`);
    check('A second jump while in the air is ignored', s.rsm.processJump('P0', 'R')?.valid === false);
    p.speed = 25; // enough momentum to coast over the hurdle
    const speedBefore = p.speed;
    let n = 0;
    while (p.position < h0.position + 0.5 && n++ < 200) s.tick(1000 / 60);
    check('Crossing a cleared hurdle: no stumble event and speed only decayed',
        p.position >= h0.position && s.rsm.drainEvents('R').length === 0 && !p.hitHurdles.has(h0.id)
        && approx(p.speed, speedBefore * Math.pow(RACE_CONFIG.DECELERATION, n), 0.02) && s.me('P0').stumbled === false,
        `speed=${p.speed.toFixed(2)} ticks=${n}`);
    s.runFor(JUMP_DURATION, 1000 / 60);
    check(`jumping is false after ${JUMP_DURATION} ms`, s.me('P0').jumping === false);
}

// Reaching a hurdle without jumping: stumble once
{
    const s = setup(1);
    const h0 = s.st.hurdles[0];
    const p = s.P('P0');
    p.position = h0.position - 0.1;
    p.speed = 12;
    const before = p.speed;
    const state = s.tick(1000 / 60); // moves ~0.19 m: onto the hurdle
    const events = s.rsm.drainEvents('R');
    check('Reaching a hurdle without jumping cuts the speed to 30%',
        p.position >= h0.position && approx(p.speed, before * RACE_CONFIG.DECELERATION * STUMBLE_SPEED, 0.001),
        `speed=${p.speed.toFixed(3)} expected=${(before * RACE_CONFIG.DECELERATION * STUMBLE_SPEED).toFixed(3)}`);
    check("One 'race-stumble' event {playerId, hurdleId} is queued",
        events.length === 1 && events[0].type === 'race-stumble' && events[0].playerId === 'P0' && events[0].hurdleId === h0.id,
        JSON.stringify(events));
    check('State shows stumbled and moves on to the next hurdle',
        state.players[0].stumbled === true && p.hitHurdles.has(h0.id)
        && approx(state.players[0].nextHurdleDistance, s.st.hurdles[1].position - p.position, 0.01));

    const tap = s.rsm.processTap('P0', 'R', 'left');
    check('Taps are ignored while stumbled', tap?.valid === false && tap.reason === 'stumbled' && approx(p.speed, before * RACE_CONFIG.DECELERATION * STUMBLE_SPEED, 0.001));
    check('Jumps are ignored while stumbled', s.rsm.processJump('P0', 'R')?.valid === false);
    s.runFor(STUMBLE_DURATION / 2, 1000 / 60);
    check('Still ignored halfway through the stumble', s.rsm.processTap('P0', 'R', 'left')?.valid === false && s.rsm.drainEvents('R').length === 0);
    s.runFor(STUMBLE_DURATION / 2 + 20, 1000 / 60);
    const tapAfter = s.rsm.processTap('P0', 'R', 'left');
    check(`Taps count again after ${STUMBLE_DURATION} ms and the hurdle is not hit twice`,
        tapAfter?.valid === true && s.me('P0').stumbled === false && s.rsm.drainEvents('R').length === 0, JSON.stringify(tapAfter));
}

// Too early / no hurdle ahead: nothing happens, nothing is lost
{
    const s = setup(1);
    const p = s.P('P0');
    p.position = s.st.hurdles[0].position - (JUMP_WINDOW_MAX + 3);
    p.speed = 10;
    const early = s.rsm.processJump('P0', 'R');
    s.tick(16);
    check('A jump more than 5 m before the hurdle does nothing and costs nothing',
        early?.valid === false && early.reason === 'early' && p.clearedHurdles.size === 0 && s.me('P0').jumping === false
        && approx(p.speed, 10 * Math.pow(RACE_CONFIG.DECELERATION, 0.016 * 60), 0.01),
        JSON.stringify(early));
    check('Jump exactly at the window edges counts (5 m and 1.5 m)', (() => {
        const a = setup(1); a.P('P0').position = a.st.hurdles[0].position - JUMP_WINDOW_MAX;
        const b = setup(1); b.P('P0').position = b.st.hurdles[0].position - JUMP_WINDOW_MIN;
        return a.rsm.processJump('P0', 'R')?.valid === true && b.rsm.processJump('P0', 'R')?.valid === true;
    })());
    check('Jump closer than 1.5 m is too late', (() => {
        const a = setup(1); a.P('P0').position = a.st.hurdles[0].position - 1;
        const r = a.rsm.processJump('P0', 'R');
        return r?.valid === false && r.reason === 'late';
    })());
    const t = setup(1);
    t.st.hurdles.forEach(h => t.P('P0').clearedHurdles.add(h.id));
    t.tick(16);
    const none = t.rsm.processJump('P0', 'R');
    check('No hurdle ahead: jump is a no-op and nextHurdleDistance is null',
        none?.valid === false && none.reason === 'no-hurdle' && t.me('P0').nextHurdleDistance === null);
}

// Full race: P0 taps and jumps, P1 taps but never jumps
function runRace({ p1StopsAfterFirstFinish = false } = {}) {
    const s = setup(2);
    const stumbles = [];
    let p0Finish = null, p1Stumbles = 0, p0Stumbles = 0;
    let n = 0;
    while (!s.last?.raceOver && n++ < 20000) {
        s.tick(50); // taps every 50 ms (cooldown is 40)
        for (const ev of s.rsm.drainEvents('R')) stumbles.push(ev);
        const me0 = s.me('P0'), me1 = s.me('P1');
        if (me0 && !me0.finished) {
            s.rsm.processTap('P0', 'R', n % 2 ? 'left' : 'right');
            if (me0.nextHurdleDistance != null && me0.nextHurdleDistance <= JUMP_WINDOW_MAX && me0.nextHurdleDistance >= JUMP_WINDOW_MIN && !me0.jumping) {
                s.rsm.processJump('P0', 'R');
            }
        }
        if (me1 && !me1.finished && !(p1StopsAfterFirstFinish && s.last.finishOrder.length > 0)) {
            s.rsm.processTap('P1', 'R', n % 2 ? 'left' : 'right');
        }
    }
    p0Stumbles = stumbles.filter(e => e.playerId === 'P0').length;
    p1Stumbles = stumbles.filter(e => e.playerId === 'P1').length;
    return { s, stumbles, p0Stumbles, p1Stumbles, ticks: n };
}
{
    const { s, p0Stumbles, p1Stumbles, ticks } = runRace();
    const st = s.last;
    check('Full race finishes with both runners across the line (raceOver when everyone finished)',
        st.raceOver === true && st.finishOrder.length === 2 && s.P('P0').finished && s.P('P1').finished,
        `order=${st.finishOrder.join(',')} ticks=${ticks} t=${((now - s.st.startTime) / 1000).toFixed(1)}s`);
    check('The jumper never stumbles and wins; the non-jumper stumbles once per hurdle',
        p0Stumbles === 0 && p1Stumbles === 3 && st.finishOrder[0] === 'P0', `P0=${p0Stumbles} P1=${p1Stumbles}`);
    const info = s.rsm.getWinnerInfo('R');
    check('Winner info lists P0 first with its time and P1 second',
        info.winnerId === 'P0' && info.positions.length === 2 && info.positions[0].time === s.P('P0').finishTime && info.positions[1].id === 'P1' && info.positions[1].time > 0,
        `${info.winnerName} ${info.winnerTime}ms`);
    check('Positions are capped at the track length', s.P('P0').position === TRACK_LENGTH && s.P('P1').position === TRACK_LENGTH);
}
{
    const { s } = runRace({ p1StopsAfterFirstFinish: true });
    const st = s.last;
    const elapsed = now - s.st.firstFinishAt;
    check(`Race ends ${FINISH_TIMEOUT / 1000}s after the first finisher when the other one stalls (DNF)`,
        st.raceOver === true && st.finishOrder.length === 1 && !s.P('P1').finished && elapsed >= FINISH_TIMEOUT && elapsed < FINISH_TIMEOUT + 100,
        `elapsed=${elapsed}ms`);
    const info = s.rsm.getWinnerInfo('R');
    check('DNF player is listed last with time null', info.positions[1].id === 'P1' && info.positions[1].time === null);
    s.rsm.endRace('R');
    check('processTick returns null once the race ended', s.rsm.processTick('R') === null);
}

// Rematch: a new init gets fresh hurdles and clean players
{
    const s = setup(2);
    const first = s.st.hurdles.map(h => h.position).join(',');
    let different = false;
    for (let i = 0; i < 20 && !different; i++) {
        s.rsm.initializeRace('R');
        different = s.rsm.raceStates.get('R').hurdles.map(h => h.position).join(',') !== first;
    }
    const fresh = s.rsm.raceStates.get('R').players.get('P0');
    check('Re-initializing (rematch/next round) re-rolls the hurdles and resets player hurdle state',
        different && fresh.clearedHurdles.size === 0 && fresh.hitHurdles.size === 0 && fresh.jumpUntil === 0 && fresh.stumbledUntil === 0);
}

summary();
