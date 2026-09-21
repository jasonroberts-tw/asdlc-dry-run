/**
 * policy.test.mjs — the policy file, and every prompt's use of it.
 *
 * CHECKS.
 *   - `dry-run/workflow-policy.json` answers a reader's questions before its data: `describes`,
 *     `whyThisFileExists`, `gatedBy`, `whatItDoesNOTDo`, `provenance`.
 *   - every block carries `reason`, `sourceEvidence` and a dated `setOn` beside its constants;
 *   - every pinned key holds its pinned value (PINNED), and every retired key is absent (RETIRED);
 *   - the intervention list is flagged exhaustive, and each code has its firing preconditions and
 *     what an answer does beside it;
 *   - every citation a prompt makes, written "block `x`, key `y`", resolves;
 *   - a prompt names no constant the policy does not hold: every backticked UPPER_SNAKE name in a
 *     prompt is an intervention code or a value of the policy file, so a run cannot be told to stop
 *     for an unlisted reason;
 *   - a prompt states no second number: no pinned numeric value of two or more digits appears in
 *     a prompt as a numeral.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A constant with two homes has one that is stale. The pins make
 * a change to a value a change in two files, which is what makes it deliberate; the citation check
 * is what lets a prompt say "block `entrySkill`, key `maxLines`" instead of a number, and know the
 * pointer lands.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/policy.test.mjs`.
 * NEEDS. Nothing installed. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { POLICY_FILE, policy, prompts, suite } from './lib/prompts.mjs'

const HEADER = ['describes', 'whyThisFileExists', 'gatedBy', 'whatItDoesNOTDo', 'provenance']

// ADAPT: one row per constant. Changing a value in the policy file means changing it here too.
const PINNED = [
  ['intervention.exhaustive', true],
  ['intervention.codes', ['SOURCE_CONFLICT', 'OUT_OF_SCOPE_MUTATION', 'REQUIRED_SERVER_UNAVAILABLE', 'HOST_PREREQUISITES_INCOMPLETE']],
  ['hostFacts.file', 'host-facts.json'],
  ['hostFacts.runDirectoryEnvironmentVariable', 'WORKFLOW_RUN_DIRECTORY'],
  ['entrySkill.maxLines', 120],
  ['tests.perTestTimeoutSeconds', 60],
  ['tests.concurrency', 4],
]

// ADAPT: a key you remove goes here, as `block.key`, with the reason in a comment beside it, so a
// merge or a copied block cannot bring it back unnoticed. Shape:
//   'tests.retries', // retired: the runner never retries; a flaky validator is a finding.
const RETIRED = []

const at = (object, dotted) => dotted.split('.').reduce((o, k) => (o !== null && typeof o === 'object' ? o[k] : undefined), object)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const t = suite('policy')
const pol = policy()

for (const key of HEADER) t.ok(`${POLICY_FILE}: \`${key}\` says something`, typeof pol[key] === 'string' && pol[key].trim().length > 20)

const blocks = Object.keys(pol).filter((k) => !HEADER.includes(k))
t.ok(`${POLICY_FILE}: holds at least one block`, blocks.length > 0)
for (const b of blocks) {
  const block = pol[b]
  t.ok(`${POLICY_FILE}: \`${b}\` is a block`, block !== null && typeof block === 'object' && !Array.isArray(block))
  for (const k of ['reason', 'sourceEvidence']) t.ok(`${POLICY_FILE}: block \`${b}\` carries \`${k}\``, typeof block?.[k] === 'string' && block[k].trim().length > 20)
  t.ok(`${POLICY_FILE}: block \`${b}\` carries a dated \`setOn\``, /^\d{4}-\d{2}-\d{2}$/.test(block?.setOn ?? ''), `setOn: ${JSON.stringify(block?.setOn)}`)
}

for (const [key, value] of PINNED) {
  const have = key === 'intervention.codes' ? (at(pol, key) ?? []).map((c) => c.code) : at(pol, key)
  t.ok(`${POLICY_FILE}: \`${key}\` holds its pinned value`, same(have, value), `pinned ${JSON.stringify(value)}, found ${JSON.stringify(have)}`)
}
for (const key of RETIRED) t.ok(`${POLICY_FILE}: the retired key \`${key}\` is absent`, at(pol, key) === undefined)

t.ok(`${POLICY_FILE}: the intervention list is flagged exhaustive`, pol.intervention?.exhaustive === true, 'block `intervention`, key `exhaustive` must be true: the list is the whole list, and the record schema takes it as its enum')
const codes = (pol.intervention?.codes ?? []).map((c) => c.code)
t.ok(`${POLICY_FILE}: every intervention code is UPPER_SNAKE and written once`, codes.length > 0 && codes.every((c) => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(c)) && new Set(codes).size === codes.length, codes.join(', '))
for (const c of pol.intervention?.codes ?? []) {
  t.ok(`${POLICY_FILE}: ${c.code} states when it fires and what an answer does`, typeof c.firesWhen === 'string' && c.firesWhen.length > 20 && typeof c.anAnswer === 'string' && c.anAnswer.length > 20)
}

// Every string the policy holds, at any depth: the names a prompt is allowed to spell in capitals.
const held = new Set()
const collect = (node) => {
  if (typeof node === 'string') held.add(node)
  else if (node !== null && typeof node === 'object') for (const v of Object.values(node)) collect(v)
}
collect(pol)

const numerals = PINNED.filter(([, v]) => typeof v === 'number' && v >= 10)
for (const p of prompts()) {
  for (const m of p.text.replace(/\s+/g, ' ').matchAll(/block `([^`]+)`, key `([^`]+)`/g)) {
    t.ok(`${p.path}: block \`${m[1]}\`, key \`${m[2]}\` resolves in ${POLICY_FILE}`, at(pol, `${m[1]}.${m[2]}`) !== undefined)
  }
  for (const m of new Set([...p.text.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((x) => x[1]))) {
    t.ok(`${p.path}: \`${m}\` is an intervention code or a value the policy holds`, held.has(m), 'a reason to stop that the policy does not list is not a reason to stop; a named constant lives in the policy file')
  }
  for (const [key, value] of numerals) {
    t.ok(`${p.path}: does not restate \`${key}\` as a numeral`, !new RegExp(`(?<![\\w.-])${value}(?![\\w-])`).test(p.text), `found ${value}; cite the block and the key instead`)
  }
}
t.done()
