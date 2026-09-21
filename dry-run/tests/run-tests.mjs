#!/usr/bin/env node
/**
 * run-tests.mjs — the runner for the validators over the `dry-run` workflow's prompts.
 *
 * CHECKS. It discovers every `*.test.mjs` beside it, runs each in its own process with a per-test
 * timeout, several at a time, and prints `pass`, `FAIL` or `skip` by name in file order, whatever
 * order they finished in. It echoes each test's own `SUMMARY:` lines, prints a failing test's full
 * output, never retries, and exits 1 on any failure or when it finds nothing.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A prompt is a program with no compiler, and these validators
 * are its type checks; a runner that is wrong turns them off without anyone seeing. Three ways,
 * each refused here and each a case of `--selftest`:
 *   - it discovers nothing and exits 0: a green gate nobody ran. Finding nothing is exit 1.
 *   - it retries: a flaky validator is a finding, and a retry hides it. One run per test, always.
 *   - a test prints `SKIP:` and then fails, and is counted as a skip. A skip is exit 0 AND a
 *     `SKIP:` line; any other exit, or a timeout, is a failure whatever was printed.
 *
 * INVOCATION.
 *   npm run dry-run:test             every validator
 *   npm run dry-run:test:selftest    the runner, over fixture validators it builds under the temporary directory
 *   node dry-run/tests/run-tests.mjs [--selftest]
 *
 * NEEDS. Node 22.18 or newer, nothing installed. The per-test timeout and the number run at once
 * are read from `dry-run/workflow-policy.json`, block `tests`, and stated nowhere else. `WORKFLOW_TESTS_DIR`
 * overrides the directory searched, and `WORKFLOW_POLICY` the policy file read (the selftest uses both).
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const TESTS_DIR = resolve(process.env.WORKFLOW_TESTS_DIR || here)
const POLICY_PATH = resolve(process.env.WORKFLOW_POLICY || join(here, '..', 'workflow-policy.json'))

function readLimits() {
  const tests = JSON.parse(readFileSync(POLICY_PATH, 'utf8')).tests
  const timeout = tests?.perTestTimeoutSeconds
  const concurrency = tests?.concurrency
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`${POLICY_PATH}: block \`tests\` must carry a positive \`perTestTimeoutSeconds\` and a whole \`concurrency\` of 1 or more`)
  }
  return { timeoutMs: timeout * 1000, concurrency }
}

/** One validator, once. Resolves, never rejects: a test that cannot start is a failed test. */
function runOne(file, timeoutMs) {
  return new Promise((done) => {
    const started = Date.now()
    let output = ''
    let timedOut = false
    const child = spawn(process.execPath, [join(TESTS_DIR, file)], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      done({ file, status: 'FAIL', reason: `could not start: ${err.message}`, output, ms: Date.now() - started })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const ms = Date.now() - started
      const skipLine = output.split('\n').find((l) => l.startsWith('SKIP:'))
      if (timedOut) done({ file, status: 'FAIL', reason: `timed out after ${timeoutMs / 1000}s`, output, ms })
      else if (code !== 0) done({ file, status: 'FAIL', reason: skipLine ? `printed SKIP: and then exited ${code}; a found dependency that fails is a failure` : `exited ${code}`, output, ms })
      else if (skipLine) done({ file, status: 'skip', reason: skipLine, output, ms })
      else done({ file, status: 'pass', reason: '', output, ms })
    })
  })
}

async function main() {
  const { timeoutMs, concurrency } = readLimits()
  const files = readdirSync(TESTS_DIR).filter((n) => n.endsWith('.test.mjs')).sort()
  if (!files.length) {
    console.log(`dry-run:test FAILED: no *.test.mjs under ${TESTS_DIR}. A runner that discovers nothing and exits 0 is a green gate nobody ran.`)
    return 1
  }
  const results = new Array(files.length)
  let next = 0
  const lane = async () => {
    while (next < files.length) {
      const i = next++
      results[i] = await runOne(files[i], timeoutMs)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, lane))

  for (const r of results) {
    console.log(`${r.status.padEnd(4)} ${r.file} (${r.ms} ms)${r.status === 'pass' ? '' : ` — ${r.reason}`}`)
    for (const line of r.output.split('\n')) if (line.startsWith('SUMMARY:')) console.log(`       ${line}`)
    if (r.status === 'FAIL') {
      console.log(`  ---- full output of ${r.file} ----`)
      for (const line of r.output.replace(/\n$/, '').split('\n')) console.log(`  ${line}`)
      console.log('  ----')
    }
  }
  const count = (s) => results.filter((r) => r.status === s).length
  const failed = count('FAIL')
  console.log(`dry-run:test ${failed ? 'FAILED' : 'passed'}: ${results.length} validators, ${count('pass')} passed, ${failed} failed, ${count('skip')} skipped`)
  return failed ? 1 : 0
}

// ---- selftest: fixture validators under the temporary directory, one broken thing per case ---------

function selftest() {
  const base = mkdtempSync(join(tmpdir(), 'dry-run-runner-'))
  const policyPath = join(base, 'policy.json')
  writeFileSync(policyPath, JSON.stringify({ tests: { perTestTimeoutSeconds: 2, concurrency: 2 } }))
  const PASS = "console.log('SUMMARY: fixture: 1 passed, 0 failed')\n"
  const cases = [
    { name: 'CONTROL: two passing validators exit 0, both named, a summary line echoed', files: { 'a.test.mjs': PASS, 'b.test.mjs': PASS }, exit: 0, expect: [/^pass a\.test\.mjs/m, /^pass b\.test\.mjs/m, /SUMMARY: fixture: 1 passed/, /2 validators, 2 passed, 0 failed, 0 skipped/] },
    { name: 'a directory with no validator is a failure, not an empty pass', files: { 'helper.mjs': PASS }, exit: 1, expect: [/no \*\.test\.mjs under/] },
    { name: 'one failing validator fails the run, and its full output is printed', files: { 'a.test.mjs': PASS, 'b.test.mjs': "console.log('the detail a reader needs')\nprocess.exit(1)\n" }, exit: 1, expect: [/^FAIL b\.test\.mjs .* exited 1/m, /the detail a reader needs/, /^pass a\.test\.mjs/m] },
    { name: 'a validator that hangs is killed at the timeout and fails', files: { 'a.test.mjs': 'setInterval(() => {}, 1000)\n' }, exit: 1, expect: [/^FAIL a\.test\.mjs .* timed out after 2s/m] },
    { name: 'a SKIP: line with exit 0 is a skip, by name, and does not fail the run', files: { 'a.test.mjs': PASS, 'b.test.mjs': "console.log('SKIP: some-tool is not installed; fixture')\n" }, exit: 0, expect: [/^skip b\.test\.mjs .* SKIP: some-tool is not installed/m, /1 passed, 0 failed, 1 skipped/] },
    { name: 'a SKIP: line followed by a failing exit is a failure', files: { 'a.test.mjs': "console.log('SKIP: some-tool is not installed; fixture')\nprocess.exit(3)\n" }, exit: 1, expect: [/^FAIL a\.test\.mjs .* printed SKIP: and then exited 3/m] },
    { name: 'results are printed in file order, whatever order they finish in', files: { 'a.test.mjs': `setTimeout(() => {}, 600)\n`, 'b.test.mjs': PASS }, exit: 0, expect: [/^pass a\.test\.mjs[^\n]*\n(?:\s+SUMMARY[^\n]*\n)*pass b\.test\.mjs/m] },
    { name: 'a failing validator is run once, never retried', files: { 'a.test.mjs': `import { appendFileSync } from 'node:fs'\nappendFileSync(new URL('./runs.log', import.meta.url), 'x')\nprocess.exit(1)\n` }, exit: 1, expect: [/^FAIL a\.test\.mjs/m], after: (dir) => (readFileSync(join(dir, 'runs.log'), 'utf8') === 'x' ? null : 'the validator ran more than once') },
  ]
  let failed = 0
  cases.forEach((c, i) => {
    const dir = join(base, `case-${i}`)
    mkdirSync(dir)
    for (const [name, text] of Object.entries(c.files)) writeFileSync(join(dir, name), text)
    const run = spawnSync(process.execPath, [SELF], { encoding: 'utf8', env: { ...process.env, WORKFLOW_TESTS_DIR: dir, WORKFLOW_POLICY: policyPath } })
    const out = `${run.stdout}${run.stderr}`
    const problems = []
    if (run.status !== c.exit) problems.push(`exit ${run.status}, expected ${c.exit}`)
    for (const re of c.expect) if (!re.test(out)) problems.push(`output does not match ${re}`)
    const late = c.after?.(dir)
    if (late) problems.push(late)
    if (problems.length) {
      failed++
      console.log(`FAILED: ${c.name}\n  ${problems.join('\n  ')}\n  ---- output ----\n  ${out.split('\n').join('\n  ')}`)
    } else console.log(`ok: ${c.name}`)
  })
  rmSync(base, { recursive: true, force: true })
  console.log(`dry-run:test:selftest ${failed ? 'FAILED' : 'passed'}: ${cases.length} cases, ${failed} failed`)
  return failed ? 1 : 0
}

process.exitCode = process.argv.includes('--selftest') ? selftest() : await main()
