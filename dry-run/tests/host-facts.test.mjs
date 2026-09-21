/**
 * host-facts.test.mjs — the facts writer, the facts validator, the schema and the policy agree.
 *
 * CHECKS, against a scratch run directory under the temporary directory:
 *   CONTROL  the writer writes the file the policy names, and the validator accepts it;
 *   a key the schema does not describe is refused, by the schema;
 *   a token-shaped value is refused as HOST_FACTS_SECRET_SHAPE, and the message does not carry it;
 *   a copy of the file lying outside its run directory is refused, by placement.
 * One thing is broken per case, and each case asserts the REASON the validator gives.
 *
 * THE FAILURE IT EXISTS TO PREVENT. The writer, the schema and the policy are three files that
 * change at different times. A fact added to the writer and not the schema makes every run's first
 * step fail; a schema loosened to let it through stops refusing anything, including the secret the
 * validator exists to refuse. Every dispatch hands this file's path to a worker, so a secret in it
 * is a secret in every worker's context.
 *
 * PowerShell is an OPTIONAL dependency here, under the skip rule: absent, this prints `SKIP:`;
 * found, anything the tools get wrong is a failure.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/host-facts.test.mjs`.
 * NEEDS. `pwsh` when present. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKFLOW, WORKFLOW_DIR, abs, optionalDependency, policy, suite } from './lib/prompts.mjs'

const pwsh = optionalDependency('pwsh', 'the host-facts writer and validator were not exercised')
const t = suite('host-facts')
const pol = policy()
const writer = abs(`${WORKFLOW_DIR}tools/Write-HostFacts.ps1`)
const validator = abs(`${WORKFLOW_DIR}tools/Test-HostFacts.ps1`)

// The run directory must come from the writer's own derivation, not from this shell.
const env = { ...process.env }
delete env[pol.hostFacts.runDirectoryEnvironmentVariable]
const ps = (file, args) => spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', file, ...args], { encoding: 'utf8', env })
const json = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const target = mkdtempSync(join(tmpdir(), `${WORKFLOW}-host-facts-`))
try {
  // `-KlistPath` is the writer's seam for the one external command it runs; a name that resolves
  // to nothing keeps this test from depending on the host's ticket state.
  const wrote = ps(writer, ['-Story', '1', '-TargetRoot', target, '-KlistPath', 'no-such-command-for-this-test'])
  const summary = json(wrote.stdout)
  t.ok('CONTROL: the writer exits 0 and reports a written, valid file', wrote.status === 0 && summary?.status === 'written' && summary?.validation?.status === 'valid', `${wrote.stdout}${wrote.stderr}`)
  const factsPath = join(target, `.${WORKFLOW}`, 'run', '1', pol.hostFacts.file)
  t.ok(`CONTROL: the file is the one the policy names, under the run directory (${pol.hostFacts.file})`, existsSync(factsPath), `expected ${factsPath}; the writer reported ${summary?.path}`)
  if (existsSync(factsPath)) {
    const good = readFileSync(factsPath, 'utf8')
    const control = ps(validator, ['-Path', factsPath])
    t.ok('CONTROL: the validator accepts what the writer wrote', control.status === 0 && json(control.stdout)?.status === 'valid', `${control.stdout}${control.stderr}`)
    t.ok('the written file declares that it reports no secret value', json(good)?.secretValuesReported === false)

    const refuses = (label, doctor, reason, mustNotCarry = null) => {
      writeFileSync(factsPath, JSON.stringify(doctor(JSON.parse(good)), null, 2))
      const run = ps(validator, ['-Path', factsPath])
      const errors = (json(run.stdout)?.errors ?? []).join('\n')
      t.ok(label, run.status === 1 && reason.test(errors), `exit ${run.status}; errors:\n${errors || run.stdout + run.stderr}`)
      if (mustNotCarry) t.ok(`${label}: the message does not carry the value`, !`${run.stdout}${run.stderr}`.includes(mustNotCarry))
      writeFileSync(factsPath, good)
    }
    refuses('a key the schema does not describe is refused by the schema', (f) => ({ ...f, anUndeclaredFact: true }), /^schema:/m)
    // Built here rather than written down, so no token-shaped literal sits in the repository.
    const tokenShaped = `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}`
    refuses('a token-shaped value is refused as HOST_FACTS_SECRET_SHAPE', (f) => ({ ...f, host: { ...f.host, osRelease: tokenShaped } }), /HOST_FACTS_SECRET_SHAPE: facts\.host\.osRelease/, tokenShaped)

    const elsewhere = join(target, 'elsewhere')
    mkdirSync(elsewhere)
    copyFileSync(factsPath, join(elsewhere, pol.hostFacts.file))
    const moved = ps(validator, ['-Path', join(elsewhere, pol.hostFacts.file)])
    t.ok('a copy outside its run directory is refused by placement', moved.status === 1 && /^placement:/m.test((json(moved.stdout)?.errors ?? []).join('\n')), `${moved.stdout}${moved.stderr}`)
  }
} finally {
  rmSync(target, { recursive: true, force: true })
}
t.done()
