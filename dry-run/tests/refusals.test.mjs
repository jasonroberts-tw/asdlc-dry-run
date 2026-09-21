/**
 * refusals.test.mjs — every validator here refuses what it exists to refuse, for its own reason.
 *
 * CHECKS. It copies the workflow's prompts, `dry-run/` and `package.json` under the temporary
 * directory, and for each case breaks exactly ONE thing in a fresh copy, runs the one validator
 * that should notice (with `WORKFLOW_ROOT` naming the copy), and asserts that it fails AND that its
 * output gives the reason. One undoctored control runs every validator over the plain copy and
 * requires them all to pass, without which every other case could be failing on the copy itself.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A validator that passes on everything is indistinguishable,
 * from outside, from one that checks something: both are green. A pattern that stopped matching
 * after a reword, a loop over a list that became empty, a check whose condition was inverted: each
 * leaves the suite green and the prompt unchecked. Asserting the REASON matters as much as the
 * failure: a case that only sees "failed" keeps passing when something else breaks first.
 *
 * The two validators that need PowerShell are not doctored here: `host-facts.test.mjs` carries its
 * own doctored cases, and `parses.test.mjs` has a Node-only case below.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/refusals.test.mjs`.
 * NEEDS. Nothing installed.
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POLICY_FILE, ROOT, WORKFLOW, WORKFLOW_DIR, contractPage, entrySkill, lifecycle, prompts, suite } from './lib/prompts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ENTRY = entrySkill().path
const CONTRACT = contractPage().path
const LIFECYCLE = lifecycle().path
const AGENT = prompts().find((p) => p.kind === 'agent').path
const NO_POWERSHELL = ['frontmatter', 'sections', 'sentences', 'named-tools', 'policy', 'entry-skill', 'agent-skills']

const base = mkdtempSync(join(tmpdir(), `${WORKFLOW}-refusals-`))
let copies = 0
function freshCopy() {
  const root = join(base, `copy-${copies++}`)
  for (const rel of ['.claude/skills', '.claude/agents', WORKFLOW_DIR.replace(/\/$/, ''), 'package.json']) {
    if (existsSync(join(ROOT, rel))) cpSync(join(ROOT, rel), join(root, rel), { recursive: true })
  }
  return root
}
const edit = (root, rel, change) => writeFileSync(join(root, rel), change(readFileSync(join(root, rel), 'utf8')))
const editPolicy = (root, change) => edit(root, POLICY_FILE, (text) => JSON.stringify(change(JSON.parse(text)), null, 2))
const run = (validator, root) => spawnSync(process.execPath, [join(here, `${validator}.test.mjs`)], { encoding: 'utf8', env: { ...process.env, WORKFLOW_ROOT: root } })

/** Replace, and refuse to go on if the text to replace is not there: a doctoring that changes nothing proves nothing. */
const swap = (from, to) => (text) => {
  if (!text.includes(from)) throw new Error(`refusals: the text to doctor is not in the file: ${from}`)
  return text.replace(from, to)
}
const swapLines = (a, b) => (text) => {
  const lines = text.split('\n')
  if (!lines.includes(a) || !lines.includes(b)) throw new Error(`refusals: the lines to swap are not both in the file: ${a} / ${b}`)
  return lines.map((l) => (l === a ? b : l === b ? a : l)).join('\n')
}

// ADAPT: one case per thing a validator refuses. Add the case in the change that adds the check.
const CASES = [
  ['frontmatter', 'an agent without a description', (r) => edit(r, AGENT, (x) => x.replace(/^description:.*\n/m, '')), /`description` is one non-empty line/],
  ['frontmatter', 'a skill whose name is not its directory', (r) => edit(r, CONTRACT, swap(`name: ${WORKFLOW}-contract`, `name: ${WORKFLOW}-rules`)), /`name` is .*-contract, as its path says/],
  ['frontmatter', 'a misspelt frontmatter key', (r) => edit(r, ENTRY, swap('disable-model-invocation:', 'disable-model-invokation:')), /no key outside/],
  ['sections', 'the contract page no longer ends with its references', (r) => edit(r, CONTRACT, swap('## References', '## Appendix')), /carries "What a run is".*"References"/],
  ['sections', 'two sections of the contract page swapped', (r) => edit(r, CONTRACT, swapLines('## What a run is', '## Invariants')), /the required sections come in that order/],
  ['sections', 'a lifecycle whose record phase lost its terminal-path marker', (r) => edit(r, LIFECYCLE, swap('· Record (every terminal path)', '· Record')), /the last phase is Record, on every terminal path/],
  ['sentences', 'an agent that lost the standing first line', (r) => edit(r, AGENT, swap('Read CLAUDE.md first. ', '')), /the body opens with the standing first line/],
  ['sentences', 'the exhaustiveness flag trimmed from the contract page', (r) => edit(r, CONTRACT, swap('**That list is exhaustive**', 'That list is long')), /the intervention list is flagged exhaustive/],
  ['sentences', 'the negative list lost an item', (r) => edit(r, CONTRACT, swap('a test failure, ', '')), /the negative list: a test failure/],
  ['sentences', 'a run that may ask whether it may continue', (r) => edit(r, CONTRACT, swap('never asks merely', 'may ask')), /never asks merely whether it may continue/],
  ['named-tools', 'a step names a tool that does not exist', (r) => edit(r, LIFECYCLE, swap('tools/Test-HostFacts.ps1', 'tools/Test-HostFactz.ps1')), /Test-HostFactz\.ps1` exists/],
  ['named-tools', 'a reference file with no row in the table', (r) => writeFileSync(join(r, dirname(LIFECYCLE), 'orphan.md'), '# Orphan\n'), /orphan\.md has a row in the contract's References table/],
  ['policy', 'the intervention list no longer flagged exhaustive', (r) => editPolicy(r, (p) => ({ ...p, intervention: { ...p.intervention, exhaustive: false } })), /the intervention list is flagged exhaustive/],
  ['policy', 'a block without its date', (r) => editPolicy(r, (p) => ({ ...p, tests: { ...p.tests, setOn: undefined } })), /block `tests` carries a dated `setOn`/],
  ['policy', 'a value changed without its pin', (r) => editPolicy(r, (p) => ({ ...p, entrySkill: { ...p.entrySkill, maxLines: 400 } })), /`entrySkill\.maxLines` holds its pinned value/],
  ['policy', 'a prompt cites a key the policy does not hold', (r) => edit(r, CONTRACT, swap('key `codes`', 'key `reasons`')), /block `intervention`, key `reasons` resolves/],
  ['policy', 'a prompt names an unlisted reason to stop', (r) => edit(r, LIFECYCLE, swap('`OUT_OF_SCOPE_MUTATION`', '`UNLISTED_REASON`')), /`UNLISTED_REASON` is an intervention code or a value the policy holds/],
  ['policy', 'a prompt restates a constant as a numeral', (r) => edit(r, ENTRY, (x) => `${x}\nKeep this file under 120 lines.\n`), /does not restate `entrySkill\.maxLines` as a numeral/],
  ['entry-skill', 'a model may start a run', (r) => edit(r, ENTRY, swap('disable-model-invocation: true', 'disable-model-invocation: false')), /so only a person can start a run/],
  ['entry-skill', 'the entry skill grew a phase heading', (r) => edit(r, ENTRY, (x) => `${x}\n## Phase 0 · Intake\n\nRead the item.\n`), /"Phase 0 · Intake" is not a phase heading/],
  ['entry-skill', 'the entry skill outgrew its cap', (r) => edit(r, ENTRY, (x) => x + 'One more helpful line.\n'.repeat(400)), /is within the policy's line cap/],
  ['entry-skill', 'a Host Facts row removed', (r) => edit(r, ENTRY, (x) => x.replace(/^\| Secrets \|.*\n/m, '')), /the Host Facts table carries/],
  ['entry-skill', 'an agent carries a phase heading', (r) => edit(r, AGENT, (x) => `${x}\n## Phase 2 · Build\n`), /carries no phase heading/],
  ['agent-skills', 'a skill used and not declared', (r) => edit(r, AGENT, swap(`skills:\n  - ${WORKFLOW}-contract\n`, 'skills: []\n')), /uses `.*-contract` and declares it/],
  ['agent-skills', 'a skill declared and never used', (r) => edit(r, AGENT, swap(`  - ${WORKFLOW}-contract\n`, `  - ${WORKFLOW}-contract\n  - ${WORKFLOW}\n`)), /declares `[^`]+` and uses it/],
  ['agent-skills', 'a declared skill that does not exist', (r) => edit(r, AGENT, swap(`  - ${WORKFLOW}-contract\n`, `  - ${WORKFLOW}-contract\n  - no-such-skill\n`)), /the declared skill `no-such-skill` exists/],
  ['parses', 'a JSON file under the workflow directory that does not parse', (r) => edit(r, POLICY_FILE, (x) => x.replace(/\}\s*$/, '')), /parses as JSON/],
]

const t = suite('refusals')
try {
  const control = freshCopy()
  for (const v of NO_POWERSHELL) {
    const r = run(v, control)
    t.ok(`CONTROL: ${v} passes over the undoctored copy`, r.status === 0, `${r.stdout}${r.stderr}`)
  }
  for (const [validator, name, doctor, reason] of CASES) {
    const root = freshCopy()
    doctor(root)
    const r = run(validator, root)
    const out = `${r.stdout}${r.stderr}`
    const line = out.split('\n').find((l) => l.includes('FAILED:') && reason.test(l))
    t.ok(`${validator} refuses ${name}`, r.status === 1 && Boolean(line), `exit ${r.status}; expected a FAILED line matching ${reason}\n${out}`)
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}
t.done()
