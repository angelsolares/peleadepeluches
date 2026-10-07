// Offline simulation of server/flappyState.js (real-delta ticks, varied gaps, moving pipes).
//   node tests/sim/flappy.mjs
import { FlappyStateManager, FLAPPY_CONFIG as C } from '../../server/flappyState.js';
import { check, summary, quietServerLogs } from '../helpers/check.mjs';

quietServerLogs();

let now = 1_000_000;
Date.now = () => now;

// Deterministic Math.random (LCG) so every run spawns the same pipes
let seed = 12345;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const f2 = (v) => Number(v).toFixed(2);
const PLAYER_X = C.playerStartX;

/** Fake io that records every emit */
function fakeIo() {
    const emits = [];
    return { emits, to() { return { emit(ev, data) { emits.push({ ev, data }); } }; } };
}

/**
 * Game with the loop's setInterval captured instead of scheduled: `loop()` runs one real tick
 * (the one startGameLoop installs, which measures its delta from Date.now()).
 */
function setup(ids = ['P0']) {
    const mgr = new FlappyStateManager();
    const io = fakeIo();
    mgr.initializeGame('R', ids.map((id) => ({ id, name: 'Bot' + id, character: 'edgar' })));
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    let loop = null;
    globalThis.setInterval = (fn) => { loop = fn; return { captured: true }; };
    globalThis.clearInterval = () => {};
    mgr.startGame('R', io);
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    const game = mgr.getGame('R');
    return {
        mgr, io, game,
        p: (id = ids[0]) => game.players[id],
        /** Advance the wall clock `ms` and run the captured loop tick */
        loop: (ms) => { now += ms; loop(); },
        /** Call processTick directly with a given delta (seconds) */
        tick: (dt) => mgr.processTick('R', dt, io),
        /** Run `seconds` of game at `hz` through the real loop, with `before(game)` called before every tick */
        run: (seconds, hz, before = () => {}) => {
            const ms = 1000 / hz;
            const end = now + seconds * 1000 - 1e-6;
            while (now < end) { before(game); now += ms; loop(); }
        }
    };
}

/** Keep a player alive: park it in the gap of the nearest pipe ahead (or at y=0) */
function pinToGap(game, id = 'P0') {
    const p = game.players[id];
    const ahead = game.pipes.filter((pipe) => pipe.x > PLAYER_X - C.pipeWidth / 2 - C.playerRadius - 0.5).sort((a, b) => a.x - b.x)[0];
    p.y = ahead ? ahead.gapY : 0;
    p.velocity = 0;
}

// 1. Real delta: a player falling for 1 s loses the same height at 60 Hz and 36 Hz
{
    const drop = (hz) => {
        const s = setup();
        s.p().velocity = 0;
        const y0 = s.p().y;
        s.run(1, hz);
        return y0 - s.p().y;
    };
    const d60 = drop(60), d36 = drop(36);
    check('Falling 1 s at 60 Hz and 36 Hz loses the same height (within 3%)', Math.abs(d60 - d36) / d60 < 0.03, `60Hz=${f2(d60)} 36Hz=${f2(d36)} analytic=3.00`);
    check('The drop matches gravity (~3 m, not 40% slow)', d60 > 2.9 && d60 < 3.2, `drop=${f2(d60)}`);
}

// 2. Real delta: distance after 5 s is the same at both rates; a stalled timer is clamped
{
    const dist = (hz) => {
        const s = setup();
        s.run(5, hz, pinToGap);
        return s.game.distance;
    };
    const s60 = dist(60), s36 = dist(36);
    check('Distance after 5 s is the same at 60 Hz and 36 Hz (within 3%)', Math.abs(s60 - s36) / s60 < 0.03, `60Hz=${f2(s60)}m 36Hz=${f2(s36)}m`);
    check('5 s at base speed covers ~18 m', s60 > 17 && s60 < 20, `${f2(s60)}m`);

    const s = setup();
    s.p().velocity = 0;
    const y0 = s.p().y;
    s.loop(500); // the timer stalled for half a second
    const expected = C.gravity * C.maxTickDelta * C.maxTickDelta; // one clamped Euler step
    check('A 500 ms stall integrates at most maxTickDelta (0.05 s)', Math.abs((s.p().y - y0) - expected) < 1e-9, `dy=${(s.p().y - y0).toFixed(4)} (0.5 s would be -1.5)`);
    check('flappy-state carries serverTime (Date.now of the tick)', s.io.emits.filter((e) => e.ev === 'flappy-state').every((e) => e.data.serverTime === now), `serverTime=${s.io.emits.at(-1).data.serverTime}`);
}

// 3. Pipes: varied gaps, moving pipes after 60 m (every third) and 150 m (every other)
{
    const s = setup();
    // The three pipes startGame spawned, then every pipe the loop spawns
    const spawned = s.game.pipes.map((pipe) => ({ pipe, atDistance: 0, currentGap: C.pipeGap, gapYs: [] }));
    const origSpawn = s.mgr.spawnPipe.bind(s.mgr);
    s.mgr.spawnPipe = (g) => {
        origSpawn(g);
        const pipe = g.pipes[g.pipes.length - 1];
        spawned.push({ pipe, atDistance: g.distance, currentGap: g.currentGap || C.pipeGap, gapYs: [] });
    };
    // Sample every moving pipe's gapY on every tick
    s.run(60, 60, (g) => {
        pinToGap(g);
        for (const rec of spawned) if (rec.pipe.moving && g.pipes.includes(rec.pipe)) rec.gapYs.push(rec.pipe.gapY);
    });
    check('Player survived 60 s pinned to the gaps (sim reached 250 m+)', s.p().isAlive && s.game.distance > 250, `distance=${f2(s.game.distance)}m pipes=${spawned.length}`);

    const gaps = spawned.map((r) => r.pipe.gapSize);
    check('Gap sizes vary per pipe', new Set(gaps.map(f2)).size > 3, `${gaps.slice(0, 6).map(f2).join(', ')}...`);
    check('Every gap is within currentGap +/- 1 and never below minPipeGap', spawned.every((r) => r.pipe.gapSize >= C.minPipeGap && r.pipe.gapSize <= r.currentGap + 1 + 1e-9 && r.pipe.gapSize >= Math.max(r.currentGap - 1, C.minPipeGap) - 1e-9), `min=${f2(Math.min(...gaps))} max=${f2(Math.max(...gaps))}`);

    const before60 = spawned.filter((r) => r.atDistance < 60);
    const mid = spawned.filter((r) => r.atDistance >= 60 && r.atDistance < 150);
    const late = spawned.filter((r) => r.atDistance >= 150);
    check('No moving pipes before 60 m', before60.length >= 3 && before60.every((r) => r.pipe.moving === false), `${before60.length} pipes`);
    const tag = (list) => list.map((r) => `#${r.pipe.id}${r.pipe.moving ? '*' : ''}`).join(' ');
    check('Between 60 m and 150 m the first pipe moves, then every third', mid.length >= 4 && mid.every((r, i) => r.pipe.moving === (i % 3 === 0)), tag(mid));
    check('After 150 m every other pipe moves', late.length >= 4 && late.every((r, i) => r.pipe.moving === (i % 2 === 0)) && late.filter((r) => r.pipe.moving).length >= 2, tag(late));

    const moving = spawned.filter((r) => r.pipe.moving && r.gapYs.length > 200);
    check('Moving pipes carry moving/amplitude/period/phase/baseGapY', moving.length >= 3 && moving.every((r) => r.pipe.moving === true && r.pipe.amplitude >= 1.5 && r.pipe.amplitude <= 2.5 && r.pipe.period >= 2.5 && r.pipe.period <= 3.5 && Number.isFinite(r.pipe.phase) && Number.isFinite(r.pipe.baseGapY)), `${moving.length} sampled`);
    const inBand = moving.every((r) => {
        const lo = C.groundY + r.pipe.gapSize / 2 + 1, hi = C.ceilingY - r.pipe.gapSize / 2 - 1;
        return r.gapYs.every((y) => y >= lo - 1e-9 && y <= hi + 1e-9);
    });
    check('Moving gapY stays within the safe bounds (ground/ceiling + gap/2 + 1)', inBand);
    const aroundBase = moving.every((r) => r.gapYs.every((y) => Math.abs(y - r.pipe.baseGapY) <= r.pipe.amplitude + 1e-9));
    check('Moving gapY stays within +/- amplitude of baseGapY', aroundBase);
    const swings = moving.map((r) => Math.max(...r.gapYs) - Math.min(...r.gapYs));
    check('Moving pipes really oscillate (swing > 1.5 x amplitude)', moving.every((r, i) => swings[i] > r.pipe.amplitude * 1.5), swings.map(f2).join(', '));
    check('Static pipes keep a fixed gapY', spawned.filter((r) => !r.pipe.moving).every((r) => r.gapYs.length === 0));
}

// 4. Collision uses the moved gapY: a player parked at the base centre dies once the gap swings away
{
    const place = (moving) => {
        const s = setup();
        const pipe = { id: 99, x: PLAYER_X, gapY: 0, gapSize: C.minPipeGap, moving, baseGapY: 0, amplitude: 2.5, phase: 0, period: 3 };
        s.game.pipes = [pipe];
        s.game.elapsed = 0;
        const dead = { at: null };
        s.run(1.5, 60, (g) => {
            pipe.x = PLAYER_X;      // keep the pipe over the player
            g.players.P0.y = 0;     // parked at the base gap centre
            g.players.P0.velocity = 0;
            if (!g.players.P0.isAlive && dead.at === null) dead.at = g.elapsed;
            if (!g.gameStarted) g.gameStarted = true; // keep ticking after the game ended for the sample
        });
        return { s, pipe, deadAt: dead.at };
    };
    const m = place(true);
    // gap bottom passes the player's bottom (-0.55) once sin > 0.78 -> t > 0.44 s
    check('Moving pipe kills the parked player once the gap moved away (0.3-0.7 s)', m.deadAt !== null && m.deadAt > 0.3 && m.deadAt < 0.7, `died at ${m.deadAt === null ? 'never' : f2(m.deadAt)}s gapY=${f2(m.pipe.gapY)}`);
    const died = m.s.io.emits.find((e) => e.ev === 'flappy-player-died');
    check('flappy-player-died emitted with name and distance', died && died.data.playerId === 'P0' && died.data.name === 'BotP0' && typeof died.data.distance === 'number');
    const over = m.s.io.emits.find((e) => e.ev === 'flappy-game-over');
    check('flappy-game-over with results follows (no tournament callback)', over && over.data.winner?.id === 'P0' && over.data.results.length === 1 && over.data.results[0].isAlive === false);
    const st = place(false);
    check('The same pipe without movement never kills the parked player', st.deadAt === null && st.s.p().isAlive);
}

summary();
