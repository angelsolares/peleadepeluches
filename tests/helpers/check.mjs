/**
 * Tiny assertion helper shared by every test file.
 * Each file prints one PASS/FAIL line per check and ends with `summary()`,
 * which prints "N/M passed" (what tests/run.mjs parses) and sets the exit code.
 */

const results = [];

/**
 * @param {string} name   What is being checked
 * @param {boolean} ok    Result
 * @param {string} [extra] Details shown after the name (values, ids...)
 */
export function check(name, ok, extra = '') {
    results.push(!!ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
    return !!ok;
}

/**
 * Print the final count and set the process exit code (1 if anything failed)
 * @returns {boolean} Whether every check passed
 */
export function summary() {
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exitCode = passed === results.length ? 0 : 1;
    return passed === results.length;
}

/**
 * Silence the state managers' console chatter ("[Arena] ...", "  - Angle: ...")
 * so the test output only shows PASS/FAIL lines.
 * @returns {Function} The original console.log
 */
export function quietServerLogs() {
    const realLog = console.log;
    console.log = (...a) => {
        const first = String(a[0]);
        if (!first.startsWith('[') && !first.startsWith('  -')) realLog(...a);
    };
    return realLog;
}
