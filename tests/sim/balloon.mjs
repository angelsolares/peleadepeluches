// Offline simulation of server/balloonState.js (hold-to-blow, lungs, tie, burst, ranking).
//   node sim_balloon.mjs
import BalloonStateManager from '../../server/balloonState.js';

let now = 1_000_000;
Date.now = () => now;
const T = 1000 / 60;
import { check, summary } from '../helpers/check.mjs';
const f1 = (v) => Number(v).toFixed(1);

function setup(ids = ['P0', 'P1'], burst = null) {
    const rooms = new Map();
    const players = new Map(ids.map((id, i) => [id, { id, name: 'Bot' + id, number: i + 1, color: '#fff', character: 'edgar' }]));
    rooms.set('R', { gameMode: 'balloon', state: 'playing', players });
    const bsm = new BalloonStateManager({ rooms });
    const st = bsm.initializeBalloon('R');
    if (burst !== null) st.players.forEach(p => { p.burstSize = burst; });
    let last = null;
    const tick = (ms) => {
        const end = now + ms;
        while (now < end) {
            now += T;
            const out = bsm.processTick('R');
            if (out) last = out;
        }
        return last;
    };
    return { bsm, st, tick, p: (id) => st.players.get(id), last: () => last };
}

// 1. Holding 1 s at full lungs
{
    const s = setup();
    s.bsm.handleBlow('P0', 'R', true);
    s.tick(1000);
    const A = s.p('P0');
    check('Holding 1 s at full lungs inflates ~15 (formula gives 14.7)', A.balloonSize > 13 && A.balloonSize < 20, `size=${f1(A.balloonSize)}`);
    check('Holding 1 s drains ~55 lung', A.lung > 43 && A.lung < 47, `lung=${f1(A.lung)}`);
    const out = s.last();
    const me = out.players.find(p => p.id === 'P0');
    check('State carries lung/tension/tied/blowing/progress', me.lung === Math.round(A.lung) && me.tension === 0 && me.tied === false && me.blowing === true && typeof me.progress === 'number', JSON.stringify({ lung: me.lung, tension: me.tension, tied: me.tied, blowing: me.blowing }));
    check('Hidden burstSize is not sent to clients', !('burstSize' in me));
}

// 2. Holding 3 s: growth stops once the lungs are empty; releasing regenerates
{
    const s = setup();
    s.bsm.handleBlow('P0', 'R', true);
    s.tick(1900); // lungs empty at ~1.82 s
    const A = s.p('P0');
    const sizeAtEmpty = A.balloonSize;
    check('Lungs are empty after ~1.9 s of holding', A.lung === 0, `lung=${A.lung}`);
    s.tick(1100);
    check('Holding with empty lungs adds nothing (balloon even deflates a bit)', A.balloonSize <= sizeAtEmpty && A.balloonSize > sizeAtEmpty - 2.5, `size ${f1(sizeAtEmpty)} -> ${f1(A.balloonSize)}`);
    check('Lungs do NOT regenerate while held', A.lung === 0, `lung=${A.lung}`);
    s.bsm.handleBlow('P0', 'R', false);
    s.tick(1000);
    check('Releasing regenerates ~50 lung/s', A.lung > 48 && A.lung < 52, `lung=${f1(A.lung)}`);
    const before = A.balloonSize;
    s.tick(1000);
    check('Released balloon deflates at 1.5/s', Math.abs((before - A.balloonSize) - 1.5) < 0.1, `${f1(before)} -> ${f1(A.balloonSize)}`);
}

// 3. Tied balloon: no growth, no deflation, no pop
{
    const s = setup(['P0', 'P1'], 90);
    s.bsm.handleBlow('P0', 'R', true);
    s.tick(1000);
    const A = s.p('P0');
    const ok = s.bsm.handleTie('P0', 'R');
    const sizeTied = A.balloonSize;
    check('Tie accepted and stops the blow', ok && A.tied && !A.blowing);
    s.bsm.handleBlow('P0', 'R', true); // ignored
    s.bsm.handleInflate('P0', 'R');     // ignored
    s.tick(3000);
    check('Tied balloon neither grows nor deflates', A.balloonSize === sizeTied && !A.blowing, `size=${f1(A.balloonSize)}`);
    A.balloonSize = 89.9; // right under the burst, still locked
    s.bsm.handleBlow('P0', 'R', true);
    s.tick(2000);
    check('Tied balloon cannot pop', !A.isDQ && A.balloonSize === 89.9);
    check('Tie refused twice / for a popped player', s.bsm.handleTie('P0', 'R') === false);
    const me = s.last().players.find(p => p.id === 'P0');
    check('State shows tied=true', me.tied === true);
}

// 4. Blowing past burstSize pops (isDQ) and the game keeps going for the others
{
    const s = setup(['P0', 'P1', 'P2'], 86);
    s.bsm.handleBlow('P0', 'R', true);
    // Breathe: hold until empty, release, repeat
    let popped = false;
    for (let cycle = 0; cycle < 8 && !popped; cycle++) {
        s.bsm.handleBlow('P0', 'R', true);
        s.tick(1850);
        s.bsm.handleBlow('P0', 'R', false);
        s.tick(2500);
        popped = s.p('P0').isDQ;
    }
    const A = s.p('P0');
    check('Blowing past burstSize pops (isDQ) within a few breaths', popped && A.balloonSize === A.burstSize && !A.blowing, `size=${f1(A.balloonSize)} burst=${f1(A.burstSize)} t=${f1((now - s.st.startTime) / 1000)}s`);
    const out = s.last();
    check('Game continues with 2 survivors', out.gameState === 'active');
    const me = out.players.find(p => p.id === 'P0');
    check('Popped player state: isDQ, progress 100, tension > 0', me.isDQ && me.progress === 100 && me.tension > 0.6, `tension=${me.tension.toFixed(2)}`);
}

// 5. Tension ramps from 70 to 95
{
    const s = setup(['P0'], 200);
    const A = s.p('P0');
    const t = (size) => { A.balloonSize = size; return s.bsm.getTension(A); };
    check('tension is 0 at 70, 0.5 at 82.5, 1 at 95+', t(60) === 0 && t(70) === 0 && Math.abs(t(82.5) - 0.5) < 1e-9 && t(95) === 1 && t(99) === 1);
}

// 6. Tapping 'balloon-inflate' 20 times in 1 s vs holding 1 s
{
    const s = setup();
    for (let i = 0; i < 20; i++) {
        s.bsm.handleInflate('P0', 'R');
        s.tick(50);
    }
    const tapSize = s.p('P0').balloonSize;
    const s2 = setup();
    s2.bsm.handleBlow('P0', 'R', true);
    s2.tick(1000);
    const holdSize = s2.p('P0').balloonSize;
    check('20 taps in 1 s add far less than holding 1 s', tapSize < holdSize * 0.75, `tap=${f1(tapSize)} hold=${f1(holdSize)}`);
    // Sustained mashing for 10 s (every 50 ms) vs breathing for 10 s
    const s3 = setup(['P0'], 500);
    for (let i = 0; i < 200; i++) { s3.bsm.handleInflate('P0', 'R'); s3.tick(50); }
    const s4 = setup(['P0'], 500);
    for (let c = 0; c < 3; c++) { s4.bsm.handleBlow('P0', 'R', true); s4.tick(1850); s4.bsm.handleBlow('P0', 'R', false); s4.tick(1500); }
    check('Mashing for 10 s is also worse than breathing for 10 s', s3.p('P0').balloonSize < s4.p('P0').balloonSize, `mash=${f1(s3.p('P0').balloonSize)} breathe=${f1(s4.p('P0').balloonSize)}`);
}

// 7. Game finishes when everyone is tied; winner is the largest non-popped; results sorted
{
    const s = setup(['P0', 'P1', 'P2', 'P3'], 90);
    s.p('P0').balloonSize = 40;
    s.p('P1').balloonSize = 75;
    s.p('P2').balloonSize = 60;
    s.p('P3').balloonSize = 89;
    s.bsm.handleTie('P0', 'R');
    s.bsm.handleTie('P1', 'R');
    s.bsm.handleTie('P2', 'R');
    s.bsm.handleBlow('P3', 'R', true); // P3 will pop
    let out = s.tick(500);
    check('Not finished while someone can still play', out.gameState === 'active' || s.p('P3').isDQ);
    out = s.tick(2000);
    check('Finished once everyone is tied or popped (reason all-tied)', out.gameState === 'finished' && out.endReason === 'all-tied', `state=${out.gameState} reason=${out.endReason}`);
    check('Winner is the largest non-popped balloon (P1 @75, not P3 who popped at 90)', out.winner && out.winner.id === 'P1', JSON.stringify(out.winner));
    const order = out.results.map(r => r.id).join(',');
    check('Results sorted: survivors by size desc, popped last', order === 'P1,P2,P0,P3', order);
    const r = out.results[0];
    check('Result rows: id, name, rounded balloonSize, tied, isDQ', r.name === 'BotP1' && r.balloonSize === 75 && r.tied === true && r.isDQ === false && out.results[3].isDQ === true, JSON.stringify(out.results));
    check('processTick returns null after finishing', s.bsm.processTick('R') === null);
}

// 8. Last survivor rule still ends the match immediately
{
    const s = setup(['P0', 'P1'], 86);
    s.p('P0').balloonSize = 85.5;
    s.p('P1').balloonSize = 10;
    s.bsm.handleBlow('P0', 'R', true);
    const out = s.tick(500);
    check('Last survivor wins immediately', out.gameState === 'finished' && out.endReason === 'last-survivor' && out.winner?.id === 'P1', `reason=${out.endReason} winner=${out.winner?.id}`);
}

// 9. Timeout: biggest non-popped wins, popped ranked last
{
    const s = setup(['P0', 'P1', 'P2'], 200);
    s.p('P0').balloonSize = 50;
    s.p('P1').balloonSize = 20;
    s.p('P2').balloonSize = 70;
    s.bsm.handleTie('P2', 'R');
    const out = s.tick(30500);
    check('Timeout ends the game with the biggest balloon as winner', out.gameState === 'finished' && out.endReason === 'time' && out.winner?.id === 'P2', `reason=${out.endReason} winner=${out.winner?.id} t=${out.timeLeft}`);
}

// 10. Everyone pops -> no winner
{
    const s = setup(['P0', 'P1'], 10);
    s.bsm.handleBlow('P0', 'R', true);
    s.bsm.handleBlow('P1', 'R', true);
    const out = s.tick(2000);
    check('Everyone popped: finished, no winner, results all isDQ', out.gameState === 'finished' && out.endReason === 'all-popped' && out.winner === null && out.results.every(r => r.isDQ));
}

// 11. Real-delta integration: a 30 Hz tick inflates the same as 60 Hz
{
    const s = setup(['P0'], 500);
    s.bsm.handleBlow('P0', 'R', true);
    const end = now + 1000;
    while (now < end) { now += 1000 / 30; s.bsm.processTick('R'); }
    const size30 = s.p('P0').balloonSize;
    const s2 = setup(['P0'], 500);
    s2.bsm.handleBlow('P0', 'R', true);
    s2.tick(1000);
    // Forward Euler: a coarser step overshoots a little (ramp/lung sampled at step start)
    check('Tick rate barely changes the inflation (real dt, not a fixed 1/60)', Math.abs(size30 - s2.p('P0').balloonSize) < 1.0, `30Hz=${f1(size30)} 60Hz=${f1(s2.p('P0').balloonSize)}`);
}

summary();
