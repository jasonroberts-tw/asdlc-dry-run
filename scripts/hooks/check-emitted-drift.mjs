/**
 * PostToolUse hook. After a write to anything an EMITTER reads, re-check that the committed output
 * still matches what that emitter produces.
 *
 * THE DEFECT THIS PREVENTS: editing an input and forgetting to re-run the emitter. The committed
 * output and its source then disagree, and nothing says so until CI -- by which point several more
 * changes are layered on top and the drift is no longer attributable to the edit that caused it.
 *
 * WAS `check-generator-drift.mjs`, and every trigger it had ran `generate:check`. That gate, and the
 * screen generator behind it, are deleted. What survives is the same defect against the emitters
 * that are still here: the catalogue emitter and its inputs, and N-14' two hand-authored
 * records. N-05's manifest validator had three triggers here until D-33 retired that node with
 * the SLICE kind and deleted `tools/spec-manifest/` and `specs/screens/`; the correction-log emitter
 * (N-20's until D-30) had one until D-36 deleted it. The file was renamed rather than deleted
 * because the failure mode is a property of emitted output, not of the generator that happened to
 * be the first example of it.
 *
 * Only fires for the inputs listed in `TRIGGERS`. A write to a README or a story file cannot change
 * emitted output, and paying two seconds to prove that on every edit is how a hook gets turned off.
 *
 * Exit 2 surfaces the drift to the agent as feedback. The tool call has already run, so this blocks
 * nothing -- it just makes the consequence visible at the moment it is created.
 */
import { npmRun, readHookInput, editTarget, toRepoRel } from './_shared.mjs'

/**
 * Paths whose contents an emitter reads, paired with the gates worth re-running.
 *
 * A `corrections:log` row STOOD HERE for `tools/ledger/{report.ts,corrections.json}` until D-36
 * (2026-09-08) deleted the emitter and froze its rendered log under docs/retired/; the shape it
 * guarded -- an input edited and its emitter not re-run -- is the catalogue's below.
 *
 * `catalogue:check` rebuilds the published skill tree in memory and diffs it. `catalogue/SKILL.md` is
 * the hand-authored source of the tree's `SKILL.md`, so an edit there that is not
 * followed by `npm run catalogue` is that defect exactly, 1.5s (`time npm run catalogue:check`,
 * real 1.481s, measured 2026-09-05 with the manifest hashing and the pointer report in place).
 */
const TRIGGERS = [
  { re: /^catalogue\/SKILL\.md$/, gates: ['catalogue:check'] },
  // The catalogue's hand-authored decision records are inputs too (D-33 added the verdict record
  // and the closure fixture beside the type resolutions and the capability seed) ...
  { re: /^tools\/catalogue\/[^/]+\.json$/, gates: ['catalogue:check'] },
  // ... and so is the kernel: every `catalogue/controls/<Type>.md` body is published verbatim as a
  // reference, and graph.ts declares `catalogue/**` an N-01 input because a body edit is a
  // staleness signal. README.md and not-carried.json match this pattern too; the emitter skips the
  // first and the gate is green over an unchanged tree, so the cost is the 1.5s above.
  { re: /^catalogue\/controls\/[^/]+\.md$/, gates: ['catalogue:check'] },
  // ... and so is THE EMITTER ITSELF. The rows above cover what `tools/catalogue/`
  // reads; this one covers what it IS. A change to emit-controls.mjs or coverage.mjs changes every
  // file the tree holds, and one to emit-skill.mjs re-renders SKILL.md and the manifest, so an
  // emitter edit not followed by `npm run catalogue` is the same defect as a kernel edit not
  // followed by it -- with the difference that the drift is now in every emitted file at once.
  // `selftest.mjs` matches too and is not an input; the gate is green over an unchanged tree, so
  // that costs the 1.5s and nothing else. The `.json` decision records have their own row above.
  { re: /^tools\/catalogue\/[^/]+\.mjs$/, gates: ['catalogue:check'] },
  // Node N-14' two hand-authored inputs: the policy record carrying the
  // recurrence threshold, the u3 sample size and the judge model, and the reader's pin of the writer's
  // run-outcome schema. An edit to either changes what `npm run outcomes` accepts or derives, and
  // `outcomes:check` is the gate that says so -- seconds where the sibling clone is present,
  // sub-second where it is not.
  {
    re: /^tools\/outcomes\/(?:policy\.json|run-outcome\.schema\.json)$/,
    gates: ['outcomes:check'],
  },
]

/** What to do about each gate's failure, appended to the report. */
const HINTS = {
  'catalogue:check':
    'Run `npm run catalogue` and commit the rendered tree under artifacts/catalogue/ alongside this change.',
  'outcomes:check':
    'Run `npm run outcomes` and commit the regenerated tree under artifacts/outcomes/ alongside this change.',
}

const input = await readHookInput()
if (input === null) process.exit(0)

const rel = toRepoRel(editTarget(input).filePath)
if (rel === null) process.exit(0)

const gates = TRIGGERS.find((t) => t.re.test(rel))?.gates
if (gates === undefined) process.exit(0)

// Concurrently: the gates are independent, and serialising them doubles the wall clock of a hook that
// fires on every edit to a watched input.
const results = await Promise.all(gates.map(async (g) => ({ gate: g, ...(await npmRun(g)) })))
const failed = results.filter((r) => r.code !== 0)

if (failed.length === 0) process.exit(0)

process.stderr.write(
  [
    `${rel} changed and the emitter gates now fail. Fix this before moving on.`,
    '',
    ...failed.flatMap((f) => [`--- npm run ${f.gate} (exit ${f.code}) ---`, f.out, '']),
    ...failed.map((f) => HINTS[f.gate] ?? 'The emitter output no longer matches its inputs.'),
    '',
  ].join('\n'),
)
process.exit(2)
