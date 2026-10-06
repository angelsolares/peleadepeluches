// Server-only checks for sanitization, rematch, reconnection and race fixes (no browser host needed).
import { sleep, ack, waitFor, connect, serverUrl } from '../helpers/server.mjs';
import { check, summary } from '../helpers/check.mjs';


async function makeRoom(mode, names) {
    const host = await connect();
    const created = await ack(host, 'create-room', { gameMode: mode });
    const code = created.roomCode;
    const phones = [];
    for (const [i, n] of names.entries()) {
        const p = await connect();
        const j = await ack(p, 'join-room', { roomCode: code, playerName: n });
        await ack(p, 'select-character', { characterId: ['edgar', 'lia', 'jesus', 'hector'][i], characterName: 'X' });
        await ack(p, 'player-ready', true);
        phones.push({ s: p, join: j });
    }
    return { host, code, phones };
}

// 1. Sanitization ----------------------------------------------------
{
    const { host, phones } = await makeRoom('smash', ['<img src=x onerror=alert(1)>Ana', 'Beto']);
    const name = phones[0].join.player?.name;
    check('Name is sanitized on join', name && !/[<>"']/.test(name), JSON.stringify(name));
    const bad = await ack(phones[1].s, 'select-character', { characterId: '"><script>', characterName: 'x' });
    check('Invalid character id is rejected', bad.success === false);
    host.close(); phones.forEach(p => p.s.close());
}

// 2. Rematch (smash) -------------------------------------------------
{
    const { host, phones } = await makeRoom('smash', ['Ana', 'Beto']);
    const early = await ack(phones[0].s, 'request-rematch');
    check('Rematch refused before the game starts', early.success === false, early.error);
    await ack(host, 'start-game');
    await sleep(500);
    const phoneMid = await ack(phones[0].s, 'request-rematch');
    check('Phone cannot restart a running match', phoneMid.success === false, phoneMid.error);
    const roundStarting = waitFor(phones[1].s, 'round-starting');
    const gameStarted = waitFor(phones[1].s, 'game-started');
    const hostRe = await ack(host, 'request-rematch');
    const rs = await roundStarting;
    const gs = await gameStarted;
    check('Host rematch accepted and announced', hostRe.success && rs?.rematch === true && rs?.round === 1, JSON.stringify(rs));
    check('Rematch sends game-started with all players', gs?.players?.length === 2 && gs?.currentRound === 1);
    const st = await waitFor(host, 'game-state', 2000);
    check('Smash loop runs again after rematch', !!st);
    host.close(); phones.forEach(p => p.s.close());
}

// 3. Rematch (tug) - used to fall through to the smash loop ----------
{
    const { host, phones } = await makeRoom('tug', ['Ana', 'Beto']);
    await ack(host, 'start-game');
    await sleep(500);
    const gs = waitFor(host, 'game-started');
    await ack(host, 'request-rematch');
    const g = await gs;
    const tugState = await waitFor(host, 'tug-state', 3000);
    const smashState = await waitFor(host, 'game-state', 1000);
    check('Tug rematch restarts tug (players carry teams)', !!g && g.players.every(p => p.team), JSON.stringify(g?.players?.map(p => p.team)));
    check('Tug rematch runs the tug loop, not the smash loop', !!tugState && !smashState);
    host.close(); phones.forEach(p => p.s.close());
}

// 4. Reconnection: a transport drop is recovered, the player keeps the slot ---
{
    const { host, phones } = await makeRoom('smash', ['Ana', 'Beto']);
    const phone = phones[0].s;
    const idBefore = phone.id;
    let playerLeft = false;
    host.on('player-left', () => { playerLeft = true; });
    phone.io.engine.close(); // simulate a network drop (not an intentional leave)
    await waitFor(phone, 'connect', 10000);
    check('Phone recovers the same session after a drop', phone.recovered === true && phone.id === idBefore, `recovered=${phone.recovered}`);
    await sleep(500);
    const r = await ack(phone, 'player-ready', true);
    check('Recovered phone is still in the room', r.success === true, r.error);
    check('Host did not see the player leave', !playerLeft);
    host.close(); phones.forEach(p => p.s.close());
}

// 5. Intentional leave is immediate ----------------------------------
{
    const { host, phones } = await makeRoom('smash', ['Ana', 'Beto']);
    const left = waitFor(host, 'player-left', 3000);
    phones[0].s.disconnect();
    check('Intentional disconnect removes the player right away', !!(await left));
    host.close(); phones.forEach(p => p.s.close());
}

// 6. Race: finish announced once, race ends 15 s after first finisher --
{
    const { host, phones } = await makeRoom('race', ['Ana', 'Beto']);
    let finishEvents = 0, winner = null;
    host.on('race-finish', () => finishEvents++);
    host.on('race-winner', w => { winner = w; });
    await ack(host, 'start-game');
    // wait for racing
    await waitFor(host, 'race-state', 10000);
    const tapper = phones[0].s;
    let side = 'left';
    const t0 = Date.now();
    while (finishEvents === 0 && Date.now() - t0 < 30000) {
        tapper.emit('race-tap', side);
        side = side === 'left' ? 'right' : 'left';
        await sleep(45);
    }
    const firstFinishAt = Date.now();
    while (!winner && Date.now() - firstFinishAt < 25000) await sleep(200);
    const waited = (Date.now() - firstFinishAt) / 1000;
    check('race-finish announced exactly once for the single finisher', finishEvents === 1, `events=${finishEvents}`);
    check('Race ends ~15 s after the first finisher even with an AFK player', !!winner && waited > 13 && waited < 18, `waited=${waited.toFixed(1)}s winner=${winner?.winnerName}`);
    host.close(); phones.forEach(p => p.s.close());
}

summary();
process.exit();
