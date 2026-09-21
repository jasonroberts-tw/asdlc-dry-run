/**
 * parses.test.mjs — every script and JSON file under `dry-run/` parses.
 *
 * CHECKS. Every `.json` parses; every `.mjs`, `.cjs` and `.js` passes `node --check`; every `.ps1`
 * and `.psm1` parses under PowerShell's own parser, without being run.
 *
 * THE SKIP RULE, applied. PowerShell is an OPTIONAL dependency of this validator: on a host
 * without `pwsh` the PowerShell half prints `SKIP:` by name and the JSON and Node halves have
 * already run. On a host WITH `pwsh`, a file that does not parse is a failure; so is a `pwsh` that
 * is found and cannot start. Absent is the only thing that skips.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A workflow's tools are run by an agent in the middle of a run,
 * which is the worst place to meet a syntax error: the agent reads the parser's message as a
 * failed step, not a broken tool, and works around it.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/parses.test.mjs`.
 * NEEDS. Nothing installed; `pwsh` when present. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { spawnSync } from 'node:child_process'
import { WORKFLOW_DIR, abs, optionalDependency, read, suite, walk } from './lib/prompts.mjs'

const t = suite('parses')
const files = walk(WORKFLOW_DIR)
t.ok(`${WORKFLOW_DIR} holds files to parse`, files.length > 0)

for (const f of files.filter((x) => x.endsWith('.json'))) {
  let error = ''
  try {
    JSON.parse(read(f))
  } catch (err) {
    error = err.message
  }
  t.ok(`${f} parses as JSON`, error === '', error)
}
for (const f of files.filter((x) => /\.(mjs|cjs|js)$/.test(x))) {
  const run = spawnSync(process.execPath, ['--check', abs(f)], { encoding: 'utf8' })
  t.ok(`${f} passes node --check`, run.status === 0, run.stderr)
}

const ps = files.filter((x) => /\.psm?1$/.test(x))
// The JSON and Node halves report here when they failed, before a skip could hide them.
if (!ps.length || t.failed()) t.done()
const pwsh = optionalDependency('pwsh', `${ps.length} PowerShell file(s) under ${WORKFLOW_DIR} were not parsed`)
const PARSE = [
  '$bad = 0',
  "foreach ($p in ($env:WORKFLOW_PARSE_FILES -split '\\|')) {",
  '  $tokens = $null; $errors = $null',
  '  [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errors)',
  '  foreach ($e in $errors) { $bad++; "{0}:{1}: {2}" -f $p, $e.Extent.StartLineNumber, $e.Message }',
  '}',
  'exit $bad',
].join('\n')
const run = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', PARSE], { encoding: 'utf8', env: { ...process.env, WORKFLOW_PARSE_FILES: ps.map(abs).join('|') } })
t.ok(`${ps.length} PowerShell file(s) parse: ${ps.join(', ')}`, run.status === 0, `${run.error?.message ?? ''}${run.stdout}${run.stderr}`)
t.done()
