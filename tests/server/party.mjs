// Modo Fiesta end to end against a real server, without browser pages: the test plays the host
// pages (party lobby -> sumo page -> scoreboard -> race page -> final) by re-attaching sockets,
// while 2 bots stay in the room the whole time.
//   TEST_SERVER_URL=http://localhost:3199 node tests/server/party.mjs
import { sleep, ack, waitFor, connect } from '../helpers/server.mjs';
import { check, summary } from '../helpers/check.mjs';

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---- lobby page ----
const lobby = await connect();
const created = await ack(lobby, 'create-room', { gameMode: 'party' });
check('create-room (party) returns the token', created.success === true && typeof created.party?.token === 'string' && created.party.total === 5, JSON.stringify(created.party));
const roomCode = created.roomCode;
const token = created.party.token;

const bots = [];
for (const [name, ch] of [['Toro', 'edgar'], ['Pato', 'lia']]) {
    const s = await connect();
    const j = await ack(s, 'join-room', { roomCode, playerName: name });
    await ack(s, 'select-character', { characterId: ch, characterName: name });
    await ack(s, 'player-ready', true);
    bots.push({ s, name, ok: j.success, closed: false, infos: [], starts: [] });
    s.on('room-closed', () => { bots[bots.length - 1].closed = true; });
}
bots.forEach(b => {
    b.s.on('party-info', i => b.infos.push(i));
    b.s.on('game-started', d => b.starts.push(d.gameMode));
});
check('2 bots joined', bots.every(b => b.ok));

const setGames = await ack(lobby, 'party-set-games', 3);
check('party-set-games 3 accepted', setGames.success === true && setGames.total === 3);
const bad = await ack(bots[0].s, 'party-start', {});
check('A phone cannot start the party', bad.success === false);

const goSumo = waitFor(lobby, 'party-go', 5000);
const started = await ack(lobby, 'party-start', { sequence: ['sumo', 'race'] });
check('party-start with a forced sequence', started.success === true && started.games.join(',') === 'sumo,race', JSON.stringify(started));
const go1 = await goSumo;
check('Host is sent to the sumo page', !!go1 && go1.url === `sumo.html?party=${roomCode}&token=${token}` && go1.reason === 'game', JSON.stringify(go1));

// The lobby page unloads before the game page connects: the room must survive without a host
lobby.disconnect();
await sleep(600);
check('Room survives the host page switch (bots not kicked)', bots.every(b => !b.closed));

// ---- sumo page ----
const sumoPage = await connect();
let sumoState = null;
sumoPage.on('sumo-state', s => { sumoState = s; });
const sumoOver = waitFor(sumoPage, 'sumo-game-over', 90000);
const att1 = await ack(sumoPage, 'party-attach-host', { roomCode, token, page: 'sumo' });
check('Game page attaches as host', att1.success === true && att1.gameMode === 'sumo' && att1.players.length === 2 && att1.party.state === 'playing' && att1.party.index === 0, JSON.stringify(att1.party && { s: att1.party.state, i: att1.party.index }));
const gs1 = await waitFor(sumoPage, 'game-started', 6000);
check('Match starts on its own ~2.5 s after the attach', !!gs1 && gs1.gameMode === 'sumo' && gs1.party && gs1.party.total === 2, gs1 && `${gs1.gameMode} party=${!!gs1.party}`);
const rematch = await ack(sumoPage, 'request-rematch');
check('Rematch is refused during a party', rematch.success === false);

// Bot Toro hunts Pato with charged shoves; Pato stays near the center
const hunter = bots[0].s, prey = bots[1].s;
const input = (s, o) => s.emit('player-input', { left: false, right: false, up: false, down: false, ...o });
let charging = false, chargeAt = 0, over = null;
sumoOver.then(d => { over = d; });
while (!over && Date.now() - t0 < 100000) {
    const me = sumoState?.players.find(p => p.id === hunter.id);
    const rival = sumoState?.players.find(p => p.id === prey.id);
    if (sumoState?.gameState !== 'countdown' && me?.alive && rival?.alive) {
        const dx = rival.position.x - me.position.x, dz = rival.position.z - me.position.z, dist = Math.hypot(dx, dz);
        input(hunter, { left: dx < -0.2, right: dx > 0.2, up: dz < -0.2, down: dz > 0.2 });
        input(prey, { left: rival.position.x > 0.3, right: rival.position.x < -0.3, up: rival.position.z > 0.3, down: rival.position.z < -0.3 });
        if (dist < 3.5 && !charging) { charging = true; chargeAt = Date.now(); hunter.emit('sumo-charge'); }
        if (charging && Date.now() - chargeAt > 800 && dist < 1.6) { charging = false; await ack(hunter, 'sumo-shove'); }
    }
    await sleep(50);
}
input(hunter, {}); input(prey, {});
check('Sumo finished with a winner', !!over && !!over.winner, over && over.winner?.name);
const sumoWinner = over?.winner?.id;

const goScores1 = await waitFor(sumoPage, 'party-go', 12000);
check('After the game-over the host is sent to the scoreboard (~6 s)', !!goScores1 && goScores1.reason === 'scores' && goScores1.url.includes('view=scores'), JSON.stringify(goScores1));
const phoneInfo = bots[0].infos.find(i => i.state === 'scores');
check('Phones got party-info with the standings', !!phoneInfo && phoneInfo.scores.length === 2 && phoneInfo.scores[0].id === sumoWinner && phoneInfo.scores[0].points === 5 && phoneInfo.scores[1].points === 3, phoneInfo && JSON.stringify(phoneInfo.scores.map(s => [s.name, s.points, s.delta])));
sumoPage.disconnect();
await sleep(400);

// ---- scoreboard page ----
const scores1 = await connect();
const goRace = waitFor(scores1, 'party-go', 15000);
const att2 = await ack(scores1, 'party-attach-host', { roomCode, token, page: 'scores' });
check('Scoreboard attaches: finished game 1/2, next = race in ~8 s', att2.success === true && att2.party.state === 'scores' && att2.party.index === 0 && att2.party.nextGame === 'race' && att2.party.nextInMs > 6000 && att2.party.lastResult?.gameMode === 'sumo' && att2.party.lastResult.ranking.length === 2, JSON.stringify(att2.party && { s: att2.party.state, i: att2.party.index, n: att2.party.nextGame, ms: att2.party.nextInMs }));
const go2 = await goRace;
check('Scoreboard is sent to the race page', !!go2 && go2.url.startsWith('race.html?party='), JSON.stringify(go2));
scores1.disconnect();
await sleep(400);

// ---- race page ----
const racePage = await connect();
let raceState = null;
racePage.on('race-state', s => { raceState = s; });
const raceWinner = waitFor(racePage, 'race-winner', 90000);
const att3 = await ack(racePage, 'party-attach-host', { roomCode, token, page: 'race' });
check('Race page attaches (game 2/2)', att3.success === true && att3.gameMode === 'race' && att3.party.index === 1 && att3.party.state === 'playing');
const gs2 = await waitFor(racePage, 'game-started', 6000);
check('Race starts on its own', !!gs2 && gs2.gameMode === 'race');
let side = 'left', raceDone = null;
raceWinner.then(w => { raceDone = w; });
while (!raceDone && Date.now() - t0 < 160000) {
    if (raceState?.state === 'racing') {
        hunter.emit('race-tap', side); if (Math.random() < 0.7) prey.emit('race-tap', side);
        side = side === 'left' ? 'right' : 'left';
        const me = raceState.players.find(p => p.id === hunter.id);
        if (me && me.nextHurdleDistance !== null && me.nextHurdleDistance <= 4 && !me.jumping) hunter.emit('race-jump');
    }
    await sleep(80);
}
check('Race finished', !!raceDone && !!raceDone.winnerId, raceDone && raceDone.winnerName);
const goFinal = await waitFor(racePage, 'party-go', 12000);
check('Race page is sent to the final scoreboard', !!goFinal && goFinal.reason === 'scores');
racePage.disconnect();
await sleep(400);

// ---- final page ----
const finalPage = await connect();
const att4 = await ack(finalPage, 'party-attach-host', { roomCode, token, page: 'scores' });
const total = att4.party?.scores?.reduce((s, x) => s + x.points, 0);
check('Final: state finished, 2 results, points add up (5+3 per game)', att4.success === true && att4.party.state === 'finished' && att4.party.results.length === 2 && total === 16 && att4.party.scores[0].points >= att4.party.scores[1].points, JSON.stringify(att4.party && { s: att4.party.state, r: att4.party.results.length, scores: att4.party.scores.map(x => [x.name, x.points]) }));
check('Phones got the finished standings', bots[1].infos.some(i => i.state === 'finished'));
check('Bots saw both game-started (sumo, race) and were never kicked', bots.every(b => b.starts.join(',') === 'sumo,race' && !b.closed), bots.map(b => b.starts.join(',')).join(' | '));

// "Otra fiesta": restart from the final page
const goAgain = waitFor(finalPage, 'party-go', 5000);
const again = await ack(finalPage, 'party-start', { sequence: ['tag'] });
const go3 = await goAgain;
check('OTRA FIESTA restarts with reset scores and sends the host to the first game', again.success === true && !!go3 && go3.url.startsWith('tag.html?party=') && bots[0].infos.at(-1).scores.every(s => s.points === 0));

finalPage.disconnect();
bots.forEach(b => b.s.close());
summary();
process.exit();
