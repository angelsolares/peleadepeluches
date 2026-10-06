/**
 * Helpers for the socket tests in tests/server/: start/stop a real game server and
 * small promise wrappers around socket.io-client.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { io } from 'socket.io-client';

const SERVER_DIR = fileURLToPath(new URL('../../server/', import.meta.url));

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** emit with an ack callback -> promise of the ack payload */
export const ack = (socket, event, ...args) => new Promise(res => socket.emit(event, ...args, res));

/** Resolve with the event payload (or `true` when it has none), or null after `ms` */
export const waitFor = (socket, event, ms = 5000) => new Promise((res) => {
    const t = setTimeout(() => { socket.off(event, h); res(null); }, ms);
    const h = (d) => { clearTimeout(t); socket.off(event, h); res(d ?? true); };
    socket.on(event, h);
});

/** URL of the server under test (tests/run.mjs sets it; a running dev server works too) */
export const serverUrl = () => process.env.TEST_SERVER_URL || 'http://localhost:3001';

/** Connect a websocket client to the server under test */
export const connect = (url = serverUrl()) => new Promise((res, rej) => {
    const s = io(url, { transports: ['websocket'] });
    s.once('connect', () => res(s));
    s.once('connect_error', rej);
});

/**
 * Start `node server/index.js` on a port and wait until it listens.
 * @returns {Promise<{ url: string, port: number, stop: () => Promise<void> }>}
 */
export async function startServer(port = 3199) {
    const proc = spawn(process.execPath, [path.join(SERVER_DIR, 'index.js')], {
        cwd: SERVER_DIR,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { out += d; });

    for (let i = 0; i < 100; i++) {
        if (out.includes(`port ${port}`)) break;
        if (proc.exitCode !== null) break;
        await sleep(100);
    }
    if (!out.includes(`port ${port}`)) {
        proc.kill();
        throw new Error(`server did not start on port ${port}:\n${out}`);
    }

    return {
        url: `http://localhost:${port}`,
        port,
        output: () => out,
        stop: async () => {
            proc.kill();
            await sleep(300);
        }
    };
}
