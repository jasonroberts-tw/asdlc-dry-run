/**
 * sections.test.mjs — the required sections of every prompt, in order.
 *
 * CHECKS. The level-2 headings of the contract page, the lifecycle, the entry skill and every
 * agent: each required heading is present, the required ones come in the stated order, the
 * contract page ENDS with its References table, and the lifecycle's phases are numbered from 0
 * without a gap, open with Intake and Approval, close with Record, and are followed by Intervention.
 *
 * THE FAILURE IT EXISTS TO PREVENT. Every other prompt executes these by HEADING. A renamed or
 * reordered heading breaks nothing a compiler would see: the entry skill still says "carry out the
 * headings in order", and the run quietly does them in the new order, or skips the one it can no
 * longer find.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/sections.test.mjs`.
 * NEEDS. Nothing installed. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { contractPage, entrySkill, headings, lifecycle, prompts, suite } from './lib/prompts.mjs'

// ADAPT: the headings are part of the contract between prompts. Rename one here and in every
// prompt that names it, in the same change.
const CONTRACT = ['What a run is', 'Invariants', 'When the run asks a person', 'Which source wins', 'References']
const ENTRY = ['Host Facts', 'Run']
const AGENT = ['Before acting', 'The step', 'Report']

const h2 = (p) => headings(p.text).filter((h) => h.level === 2).map((h) => h.text)

function inOrder(t, p, required) {
  const have = h2(p)
  const missing = required.filter((r) => !have.includes(r))
  t.ok(`${p.path}: carries ${required.map((r) => `"${r}"`).join(', ')}`, missing.length === 0, `missing: ${missing.join(', ')}\nfound: ${have.join(' | ')}`)
  const positions = required.map((r) => have.indexOf(r)).filter((i) => i >= 0)
  t.ok(`${p.path}: the required sections come in that order`, positions.every((v, i) => i === 0 || v > positions[i - 1]), `found: ${have.join(' | ')}`)
  return have
}

const t = suite('sections')

const contract = contractPage()
const contractHave = inOrder(t, contract, CONTRACT)
t.ok(`${contract.path}: the page ends with "References"`, contractHave.at(-1) === 'References', `the last section is "${contractHave.at(-1)}"; the references table is the last thing a worker reads on the page`)

inOrder(t, entrySkill(), ENTRY)
for (const p of prompts().filter((x) => x.kind === 'agent')) inOrder(t, p, AGENT)

const life = lifecycle()
t.ok('the lifecycle reference exists beside the contract page', Boolean(life), 'expected references/lifecycle.md under the contract skill')
if (life) {
  const have = h2(life)
  const phases = have.filter((h) => /^Phase \d+ · /.test(h))
  const numbers = phases.map((h) => Number(/^Phase (\d+)/.exec(h)[1]))
  t.ok(`${life.path}: phases are numbered from 0 without a gap`, numbers.length >= 3 && numbers.every((n, i) => n === i), `found: ${phases.join(' | ')}`)
  t.ok(`${life.path}: Phase 0 is Intake and is marked read-only`, /^Phase 0 · Intake \(read-only\)$/.test(phases[0] ?? ''), phases[0])
  t.ok(`${life.path}: Phase 1 is Approval and is asked once`, /^Phase 1 · Approval \(asked once\)$/.test(phases[1] ?? ''), phases[1])
  t.ok(`${life.path}: the last phase is Record, on every terminal path`, /^Phase \d+ · Record \(every terminal path\)$/.test(phases.at(-1) ?? ''), phases.at(-1))
  t.ok(`${life.path}: every level-2 heading is a phase or "Intervention", and "Intervention" is last`, have.at(-1) === 'Intervention' && have.slice(0, -1).every((h) => /^Phase \d+ · /.test(h)), `found: ${have.join(' | ')}`)
}
t.done()
