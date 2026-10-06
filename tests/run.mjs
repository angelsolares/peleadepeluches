/**
 * Test runner: `npm test` (everything), `npm run test:sim` or `npm run test:server`.
 *
 * - tests/sim/*.mjs    offline simulations of the server state managers (fake clock, no sockets)
 * - tests/server/*.mjs socket tests against a real server that this runner starts on TEST_PORT
 *
 * Every test file prints PASS/FAIL lines and ends with "N/M passed" (see tests/helpers/check.mjs);
 * the runner shows one line per file and the FAIL lines of the files that did not fully pass.
 */

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer } from './helpers/server.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TESTS = path.join(ROOT, 'tests');
const groups = process.argv.slice(2).filter(a => a === 'sim' || a === 'server');
const wanted = groups.length ? groups : ['sim', 'server'];
const filter = process.argv.slice(2).find(a => a !== 'sim' && a !== 'server'); // substring of a file name

function listTests(group) {
    const dir = path.join(TESTS, group);
    return readdirSync(dir)
        .filter(f => f.endsWith('.mjs') && (!filter || f.includes(filter)))
        .sort()
        .map(f => path.join(dir, f));
}

function runFile(file, env) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const proc = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout.on('data', d => { out += d; });
        proc.stderr.on('data', d => { out += d; });
        proc.on('close', (code) => {
            const m = out.match(/(\d+)\/(\d+)\s+(?:checks\s+)?passed/);
            const passed = m ? Number(m[1]) : 0;
            const total = m ? Number(m[2]) : 0;
            const ok = code === 0 && m !== null && passed === total && total > 0;
            resolve({ file, ok, passed, total, code, out, seconds: (Date.now() - t0) / 1000 });
        });
    });
}

function report(r) {
    const name = path.relative(TESTS, r.file).replace(/\\/g, '/');
    const count = r.total ? `${r.passed}/${r.total}` : 'no summary';
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${name.padEnd(28)} ${count.padStart(7)}  ${r.seconds.toFixed(1)}s`);
    if (!r.ok) {
        const fails = r.out.split(/\r?\n/).filter(l => l.startsWith('FAIL'));
        const tail = fails.length ? fails : r.out.trim().split(/\r?\n/).slice(-15);
        for (const line of tail) console.log(`       ${line}`);
        if (r.code !== 0 && !fails.length) console.log(`       exit code ${r.code}`);
    }
}

const results = [];

if (wanted.includes('sim')) {
    console.log('\n== Simulations (offline) ==');
    for (const file of listTests('sim')) {
        const r = await runFile(file, {});
        results.push(r);
        report(r);
    }
}

if (wanted.includes('server')) {
    const files = listTests('server');
    if (files.length) {
        const port = Number(process.env.TEST_PORT || 3199);
        console.log(`\n== Server tests (node server/index.js on port ${port}) ==`);
        let server;
        try {
            server = await startServer(port);
        } catch (err) {
            console.log(`FAIL could not start the server: ${err.message}`);
            process.exit(1);
        }
        try {
            for (const file of files) {
                const r = await runFile(file, { TEST_SERVER_URL: server.url });
                results.push(r);
                report(r);
            }
        } finally {
            await server.stop();
        }
    }
}

const failed = results.filter(r => !r.ok);
const passed = results.reduce((s, r) => s + r.passed, 0);
const total = results.reduce((s, r) => s + r.total, 0);
console.log(`\n${results.length - failed.length}/${results.length} files, ${passed}/${total} checks passed`);
process.exit(failed.length ? 1 : 0);
