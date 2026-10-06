// Tug of War rhythm rules, simulated against the real state manager with a fake clock.
//   node sim_tug.mjs
import TugStateManager, { TUG_CONFIG } from '../../server/tugState.js';

const realLog = console.log;
let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;
const INTERVAL = TUG_CONFIG.PULSE_INTERVAL;
import { check, summary } from '../helpers/check.mjs';
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// Teams are shuffled at init, so force a deterministic split: P0,P2 left / P1,P3 right
Math.random = () => 0.5;

function setup(n = 2) {
    now = 1_000_000;
    const rooms = new Map();
    const players = new Map();
    for (let i = 0; i < n; i++) {
        players.set(`P${i}`, { id: `P${i}`, name: `Bot${i}`, number: i + 1, color: '#fff', character: 'edgar' });
    }
    rooms.set('R', { gameMode: 'tug', state: 'playing', players });
    const tsm = new TugStateManager({ rooms });
    tsm.initializeTug('R');
    const st = tsm.tugStates.get('R');
    let last = null;
    // Advance the clock in 60 Hz ticks until `target` (inclusive), ticking the manager
    const tickTo = (target) => {
        while (now < target) {
            now = Math.min(target, now + T);
            last = tsm.processTick('R') || last;
        }
        return last;
    };
    const pulse = (k) => st.startTime + k * INTERVAL;
    // Pull `offset` ms from pulse k (negative = early) and process the tick right after
    const pullAt = (id, k, offset = 0) => {
        tickTo(pulse(k) + offset);
        tsm.handlePull(id, 'R');
        now += T;
        last = tsm.processTick('R');
        return last.players.find(p => p.id === id);
    };
    // Make the countdown pass and settle on the active state
    tickTo(st.startTime + 1);
    return { tsm, st, tickTo, pulse, pullAt, P: (id) => st.players.get(id), get last() { return last; } };
}

// Schedule and payload fields
{
    const s = setup(2);
    const state = s.tickTo(s.pulse(2) + 10);
    check('Pulses are anchored to startTime (beat index, nextPulseTime)',
        state.beat === 2 && state.nextPulseTime === s.pulse(3) && state.pulseInterval === INTERVAL && state.serverTime === now,
        `beat=${state.beat} next-start=${state.nextPulseTime - s.st.startTime}`);
    check('State exposes teams and per-player streak/pullQuality',
        state.teams.left.size === 1 && state.teams.right.size === 1 && 'syncCombo' in state.teams.left && 'syncRatio' in state.teams.left
        && state.players.every(p => 'streak' in p && 'pullQuality' in p));
    s.tickTo(s.pulse(40));
    check('Schedule never drifts after 40 pulses', s.st.nextPulseTime === s.pulse(41) && s.st.beat === 40, `beat=${s.st.beat}`);
}

// Timing quality
{
    const s = setup(2);
    const me = s.pullAt('P0', 1, 0);
    check('Pull exactly on a pulse -> pullQuality 2 (perfect)', me.pullQuality === 2 && me.streak === 1, `q=${me.pullQuality}`);
    const before = s.st.markerPos;
    const me2 = s.pullAt('P0', 2, 200);
    check('200 ms off -> pullQuality 1 (good)', me2.pullQuality === 1 && me2.streak === 2, `q=${me2.pullQuality} streak=${me2.streak}`);
    check('Good pull still moves the rope toward the left team', s.st.markerPos < before, `marker ${before.toFixed(2)} -> ${s.st.markerPos.toFixed(2)}`);
    const beforeBad = s.st.markerPos;
    const me3 = s.pullAt('P0', 3, 400);
    const badMove = beforeBad - s.st.markerPos;
    check('400 ms off -> bad: pullQuality 0, streak reset', me3.pullQuality === 0 && me3.streak === 0, `q=${me3.pullQuality} streak=${me3.streak}`);
    // Bad = 0.2 timing bonus, no streak/team bonus; compare with a fresh perfect pull on the same stamina
    check('Bad pull has no timing bonus (moves 20% of a perfect pull at most)', badMove > 0 && badMove < 0.25 * (TUG_CONFIG.BASE_PULL_POWER * TUG_CONFIG.ROPE_SENSITIVITY), `move=${badMove.toFixed(3)}`);
}

// Anti-mash: only the first pull per pulse window counts
{
    const s = setup(2);
    s.pullAt('P0', 1, 0);
    const marker = s.st.markerPos;
    const stamina = s.P('P0').stamina;
    const me = s.pullAt('P0', 1, 100); // same window
    check('Second pull in the same window -> 0 force, costs stamina, mashed flag, streak reset',
        s.st.markerPos === marker && s.P('P0').stamina < stamina && me.mashed === true && me.streak === 0,
        `marker=${s.st.markerPos.toFixed(2)} stamina ${stamina.toFixed(1)}->${s.P('P0').stamina.toFixed(1)}`);
}

// Personal streak
{
    const s = setup(2);
    let me;
    for (let k = 1; k <= 3; k++) me = s.pullAt('P0', k, 0);
    check('3 consecutive on-beat pulses -> streak 3', me.streak === 3, `streak=${me.streak}`);
    check('Streak multiplier for 3 is 1.3', approx(s.tsm.streakMultiplier(3), 1.3) && approx(s.tsm.streakMultiplier(9), 1.5));
    // Skip pulse 4 entirely: the window close resets the streak
    s.tickTo(s.pulse(4) + TUG_CONFIG.GREEN_ZONE_WINDOW + T);
    check('Skipping a pulse resets the streak to 0', s.P('P0').streak === 0, `streak=${s.P('P0').streak}`);
}

// Team sync (2 vs 2: P0,P2 left / P1,P3 right)
{
    const s = setup(4);
    check('Deterministic split: P0,P2 left / P1,P3 right', s.st.teams.left.join() === 'P0,P2' && s.st.teams.right.join() === 'P1,P3', s.st.teams.left.join() + ' | ' + s.st.teams.right.join());
    const closeOf = (k) => s.pulse(k) + TUG_CONFIG.GREEN_ZONE_WINDOW + T;
    s.pullAt('P0', 1, -50); s.pullAt('P2', 1, 50);
    s.tickTo(closeOf(1));
    check('Two of two left players on beat -> left syncCombo 1, ratio 1', s.st.teamStats.left.syncCombo === 1 && s.st.teamStats.left.syncRatio === 1, `combo=${s.st.teamStats.left.syncCombo}`);
    s.pullAt('P0', 2, 0); s.pullAt('P2', 2, -100);
    s.tickTo(closeOf(2));
    check('... and 2 on the next pulse', s.st.teamStats.left.syncCombo === 2, `combo=${s.st.teamStats.left.syncCombo}`);
    s.pullAt('P0', 3, 0); // only one of two
    s.tickTo(closeOf(3));
    check('One of two (ratio 0.5) still counts -> syncCombo 3', s.st.teamStats.left.syncCombo === 3 && s.st.teamStats.left.syncRatio === 0.5, `combo=${s.st.teamStats.left.syncCombo} ratio=${s.st.teamStats.left.syncRatio}`);
    check('Team multiplier for syncCombo 3 is 1.45, capped at 1.6', approx(s.tsm.syncMultiplier(3), 1.45) && approx(s.tsm.syncMultiplier(7), 1.6));
    s.tickTo(closeOf(4)); // nobody pulls
    check('Zero of two on a pulse -> syncCombo reset to 0', s.st.teamStats.left.syncCombo === 0 && s.st.teamStats.left.syncRatio === 0, `combo=${s.st.teamStats.left.syncCombo}`);
    check('Right team never pulled -> syncCombo 0', s.st.teamStats.right.syncCombo === 0);
    const state = s.last;
    check('Payload teams mirror the stats', state.teams.left.syncCombo === 0 && state.teams.left.size === 2 && state.teams.right.size === 2);
}

// Team multiplier makes a synced pull stronger than an unsynced one
{
    const s = setup(4);
    const closeOf = (k) => s.pulse(k) + TUG_CONFIG.GREEN_ZONE_WINDOW + T;
    // Build sync combo 2 for left (pulses 1-2), then measure one perfect pull of P0 on pulse 3
    for (const k of [1, 2]) { s.pullAt('P0', k, 0); s.pullAt('P2', k, 0); s.tickTo(closeOf(k)); }
    s.tickTo(s.pulse(3) - 50);
    const before = s.st.markerPos;
    const st0 = s.P('P0').stamina;
    s.pullAt('P0', 3, 0);
    const moveSynced = before - s.st.markerPos;
    // Expected: BASE * 1.0 * staminaFactor * streakMult(3) * syncMult(2) / 2^alpha * sens * comeback(right gets no bonus; left is winning so right gets it, not left)
    const staminaFactor = Math.max(0.2, (st0 - TUG_CONFIG.STAMINA_COST) / 100);
    const expected = TUG_CONFIG.BASE_PULL_POWER * staminaFactor * 1.3 * 1.3 / Math.pow(2, TUG_CONFIG.ALPHA_BALANCING) * TUG_CONFIG.ROPE_SENSITIVITY;
    check('Perfect pull force = base * stamina * streak(1.3) * sync(1.3) / size^alpha', approx(moveSynced, expected, 1e-9), `move=${moveSynced.toFixed(4)} expected=${expected.toFixed(4)}`);
}

// A full-sync team beats a mashing team of equal size over 20 s
{
    const s = setup(4);
    const end = s.st.startTime + 20000;
    let nextMash = now;
    let k = 1;
    while (now < end) {
        // Left: both pull exactly on each beat
        const pk = s.pulse(k);
        if (now >= pk) { s.tsm.handlePull('P0', 'R'); s.tsm.handlePull('P2', 'R'); k++; }
        // Right: both mash every 100 ms
        if (now >= nextMash) { s.tsm.handlePull('P1', 'R'); s.tsm.handlePull('P3', 'R'); nextMash += 100; }
        now += T;
        s.tsm.processTick('R');
    }
    const st = s.st;
    check('Full-sync team (left) beats the mashing team over 20 s (marker toward left)', st.markerPos < -20, `marker=${st.markerPos.toFixed(1)} leftCombo=${st.teamStats.left.syncCombo} rightCombo=${st.teamStats.right.syncCombo} P0streak=${s.P('P0').streak}`);
    check('Mashers never build a sync combo', st.teamStats.right.syncCombo === 0 && s.P('P1').streak === 0);
    // (the sim's mashers start exactly on pulse 0, which is a legitimate hit; nothing after that)
    check('Mashers never land a hit after pulse 0, even after running out of stamina', s.P('P1').hitPulse <= 0 && s.P('P3').hitPulse <= 0 && s.P('P1').stamina < 40, `hitPulse=${s.P('P1').hitPulse} stamina=${s.P('P1').stamina.toFixed(1)}`);
    check('Synced team keeps the combo capped at the bonus but counting', st.teamStats.left.syncCombo >= 10);
}

// Full match still ends with a winner and a finished payload
{
    const s = setup(2);
    let state = null;
    const end = s.st.endTime + 100;
    let k = 1;
    while (now < end && (!state || state.gameState !== 'finished')) {
        if (now >= s.pulse(k)) { s.tsm.handlePull('P0', 'R'); k++; }
        now += T;
        state = s.tsm.processTick('R') || state;
    }
    check('Match finishes with the pulling team as winner', state.gameState === 'finished' && state.winnerTeam === 'left', `winner=${state.winnerTeam} marker=${state.markerPos.toFixed(1)} t=${((now - s.st.startTime) / 1000).toFixed(1)}s`);
    check('processTick returns null once finished', s.tsm.processTick('R') === null);
}

summary();
