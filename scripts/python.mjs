#!/usr/bin/env node
/**
 * Runs a python script with whichever Python 3 interpreter this machine actually has.
 *
 *   node scripts/python.mjs <script.py> [args...]
 *
 * THE FAILURE THIS PREVENTS. `package.json` spelled the two goldens scripts `python3 ...`, which is
 * the interpreter's name on Ubuntu, in WSL2 and on the CI runner -- and on native Windows is the
 * Microsoft Store App Execution Alias: a stub that prints an install prompt to stderr and exits 49,
 * so the `goldens` pre-push job went red on this machine with no output from the gate itself.
 * Spelling it `python` instead breaks the other way: a stock WSL2 Ubuntu has no `python`
 * on PATH without `python-is-python3`. So the interpreter is PROBED rather than spelled: the first of
 * the candidates that runs `import sys` and reports major version 3 is used, and the script's exit
 * code is passed through unchanged. Nothing is cached.
 *
 * THE ORDER IS PER PLATFORM. Probing `python3` first on native Windows means running
 * the Store alias first, and on the owner's machine that alias takes 1.9-2.2s to fail with exit 9009
 * (measured 2026-09-09) -- a probe the header used to call "milliseconds" was the slowest step of
 * the goldens gate. So win32 tries the launcher `py -3` and then `python` (0.65s each there) before
 * `python3`; everywhere else `python3` stays first, because that is the interpreter's name on
 * Ubuntu, in WSL2 and on the CI runner.
 *
 * It fails, exit 1, when no interpreter is found. That is deliberate and is not the skip-clean rule:
 * the goldens gate reads only committed files, and Python 3 is the suite's own runtime
 * (the one script it launches is standard-library Python 3 and always was), so a
 * machine without it has a setup gap to report, not an input that is legitimately absent -- and CI
 * installs one beside the step (`actions/setup-python@v5` in `.github/workflows/verify.yml`). Reads
 * nothing; writes nothing; needs no `../estate` checkout.
 */
import { spawnSync } from 'node:child_process'

/** Interpreter spellings, in the order tried. Each is the command followed by its fixed arguments. */
const CANDIDATES =
  process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python'], ['py', '-3']]

/** Exit 0 from a real Python 3; the Store alias, a Python 2 and a missing binary all fail this. */
const PROBE = 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)'

function isPython3([cmd, ...fixed]) {
  const run = spawnSync(cmd, [...fixed, '-c', PROBE], { stdio: 'ignore' })
  return run.status === 0
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node scripts/python.mjs <script.py> [args...]')
  process.exit(2)
}

const found = CANDIDATES.find(isPython3)
if (!found) {
  console.error(
    `python.mjs: no Python 3 interpreter found on PATH; tried ${CANDIDATES.map((c) => c.join(' ')).join(', ')}.`,
  )
  process.exit(1)
}

const [cmd, ...fixed] = found
const run = spawnSync(cmd, [...fixed, ...args], { stdio: 'inherit' })
if (run.error) {
  console.error(`python.mjs: ${cmd} failed to start: ${run.error.message}`)
  process.exit(1)
}
process.exit(run.status ?? 1)
