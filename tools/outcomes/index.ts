/**
 * outcomes — reads every run-outcome record under `artifacts/outcomes/records/`, validates it against
 * `dry-run/run-outcome.schema.json`, normalises it to canonical bytes, and derives the learning loop's reports under
 * `artifacts/outcomes/` from the records and nothing else: what recurs, where runs disagree,
 * what they could not decide, what looks dead or blocked, and the proposal list.
 *
 * KIND         re-runs whole whenever a record, the schema, the policy file or this emitter moves.
 * INVARIANTS   never writes outside `artifacts/outcomes/`; never changes what a record says
 *              (normalising re-serialises it, key order and spacing only); never reads the tracker,
 *              the reference, the network or a clock; writes nothing at all while any record is
 *              refused.
 * RE-ENTRY     idempotent: the same records write the same bytes. `--check` re-derives in memory,
 *              diffs against the tree, prints each differing path on its own line, exits 1 on any
 *              difference or stale file, and writes nothing.
 * STALE WHEN   `artifacts/outcomes/records/**`, `dry-run/run-outcome.schema.json`, `tools/outcomes/**`.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: a loop whose reports are written by hand after
 * reading a few records, which is a report of what its author remembered. Every figure here is
 * re-derived from every record on every run, the check twin makes a stale report a red gate, and an
 * EMPTY records directory is a legal state every report names, not an error and not a blank page.
 *
 * INVOCATION.  npm run outcomes          normalise the records, write the reports, remove stale files
 *              npm run outcomes:check    re-derive, diff, write nothing
 * NEEDS.       only committed files. `OUTCOMES_ROOT` points it at a doctored copy.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build, differences } from './emit.ts'
import { RECORDS_DIR, REPORTS_DIR, defaultRoot } from './paths.ts'

const CHECK = process.argv.includes('--check')
const root = defaultRoot()

const { records, refused, outputs } = build(root)
if (refused.length > 0) {
  console.error(`outcomes REFUSED: ${String(refused.length)} file(s) under ${RECORDS_DIR} are not records. Nothing was written.`)
  for (const { path, refusal } of refused) console.error(`  ${path}  ${refusal.code} at ${refusal.at}: ${refusal.message}`)
  console.error('A record is written by write-record.ts, which validates first; correct it through the writer.')
  process.exit(1)
}

const differing = differences(root, outputs)
const source =
  records.length === 0
    ? `${RECORDS_DIR}, which holds no record yet (a legal state; every report says so)`
    : `${String(records.length)} record(s) under ${RECORDS_DIR}`

if (CHECK) {
  if (differing.length === 0) {
    console.log(`outcomes:check: ${String(outputs.size)} file(s) under ${REPORTS_DIR} match a fresh run over ${source}.`)
    process.exit(0)
  }
  console.error(`outcomes:check: ${String(differing.length)} file(s) differ from a fresh run over ${source}:`)
  for (const [path, why] of differing) console.error(`  ${path}  ${why}`)
  console.error('Run `npm run outcomes` and commit what it changes. Nothing was written.')
  process.exit(1)
}

for (const [path, why] of differing) {
  const full = join(root, path)
  if (outputs.has(path)) {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, outputs.get(path)!)
  } else {
    rmSync(full)
  }
  console.log(`  ${path}  ${outputs.has(path) ? 'written' : `removed (${why})`}`)
}
console.log(`outcomes: ${String(outputs.size)} file(s) under ${REPORTS_DIR} from ${source}; ${String(differing.length)} changed.`)
