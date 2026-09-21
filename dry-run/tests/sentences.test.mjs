/**
 * sentences.test.mjs — the sentences a prompt must carry, by pattern.
 *
 * CHECKS. Every skill and agent opens its body with the standing first line. The contract page
 * carries the facts-by-path rule, the exhaustiveness of the intervention list, the negative list
 * (what is NOT a reason to ask) and the source-authority ladder with a person's latest
 * clarification on top. The lifecycle carries read-only intake, the one approval with its restart
 * command, and the record on every terminal path. Patterns are matched over the text with its
 * line breaks folded, so re-wrapping a paragraph never fails this.
 *
 * THE FAILURE IT EXISTS TO PREVENT. These sentences are the ones an editor trims: they read as
 * emphasis, and each is a rule. A contract page that loses "a run never asks merely whether it may
 * continue" still parses, still loads, and produces a run that asks at every step.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/sentences.test.mjs`.
 * NEEDS. Nothing installed. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { FIRST_LINE, contractPage, lifecycle, prompts, suite } from './lib/prompts.mjs'

// ADAPT: one row per sentence you would not want a tidy-up to remove. Match the rule's words, not
// its punctuation.
const CONTRACT = [
  ['facts are passed by path and never restated', /passes that file's PATH and never restates its contents/],
  ['a worker treats a missing fact as absent', /treats a fact it lacks as absent rather than guessed/],
  ['a prompt states no second number', /cites the block and the key and states no second number/],
  ['nothing is mutated before the one approval', /mutates nothing before the mutation-scope approval/],
  ['the intervention list is flagged exhaustive', /\*\*That list is exhaustive\*\*/],
  ['the negative list: a build error', /not reasons to ask:\*\*[^.]*\bbuild error\b/],
  ['the negative list: a test failure', /not reasons to ask:\*\*[^.]*\btest failure\b/],
  ['the negative list: unfamiliar code', /not reasons to ask:\*\*[^.]*\bunfamiliar code\b/],
  ['the negative list: a missing capability with a truthful unavailable state', /not reasons to ask:\*\*[^.]*\bmissing capability that has a truthful unavailable state\b/],
  ['a run never asks merely whether it may continue', /never asks merely whether it may continue/],
  ["the ladder puts a person's latest clarification on top", /1\. the latest explicit clarification from a person/],
  ['an open conflict goes to the person, never to a heuristic', /goes to the person \(`SOURCE_CONFLICT`\), never to a heuristic/],
]
const LIFECYCLE = [
  ['intake changes nothing', /Intake changes nothing/],
  ['intake reads every comment', /every comment on it, in order, every author/],
  ['the run names every mutation and asks once', /names EVERY mutation it will make, and asks once/],
  ['declined, the run stops with its findings and the restart command', /Declined, the run stops with its read-only findings and the command that restarts it/],
  ['the record is written on every terminal path', /Complete, failed and blocked alike end here/],
  ['an unlisted reason is a recorded failure, not a question', /A reason that is not on the list is not a reason to ask/],
]

const fold = (text) => text.replace(/\s+/g, ' ')
const t = suite('sentences')

for (const p of prompts().filter((x) => x.kind !== 'reference')) {
  const first = p.body.split('\n').find((l) => l.trim().length > 0)
  t.ok(`${p.path}: the body opens with the standing first line`, first === FIRST_LINE, `found: ${first}`)
}
const contract = fold(contractPage().text)
for (const [label, re] of CONTRACT) t.ok(`contract page: ${label}`, re.test(contract), `no match for ${re}`)
const life = lifecycle()
t.ok('the lifecycle reference exists', Boolean(life))
if (life) for (const [label, re] of LIFECYCLE) t.ok(`lifecycle: ${label}`, re.test(fold(life.text)), `no match for ${re}`)
t.done()
