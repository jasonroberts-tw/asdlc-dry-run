/**
 * write-record — the ONE writer of a run-outcome record: `artifacts/outcomes/records/<item>.json`, one per work
 * item, in canonical bytes.
 *
 * The workflow's terminal step calls it on EVERY terminal path (complete, failed and blocked
 * alike, never only on success) and AFTER its last push, so the commit the record names exists
 * where a reader can fetch it. A later stage that found a fact wrong calls it again with the same
 * record plus a correction; it never edits or drops what is already there.
 *
 * INVARIANTS   validates before it writes, through the same `validateRecord` every reader uses;
 *              refuses with ONE named reason and writes nothing; never deletes or rewrites an entry
 *              an existing record carries; never writes outside `artifacts/outcomes/records/`.
 * RE-ENTRY     idempotent: the same draft writes the same bytes and reports `unchanged`.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one, three of them. A record written only on success
 * leaves the loop nothing to learn from but what went well. A record written before the last push
 * names a commit that may never reach the remote, and every source line the filing step later
 * checks "at the record's commit" is checked against nothing. And a correction made by editing the
 * fact it corrects erases the evidence that the run was ever wrong, which is the one thing the
 * recurrence report counts.
 *
 * WHAT IT REFUSES, beyond what `record.ts` refuses for every reader:
 *   ENTRY_DELETED_OR_EDITED  the item already has a record and the draft does not carry each of its
 *                            facts and corrections unchanged, in place. Corrections are additions.
 *   EXISTING_RECORD_INVALID  the record already on disk does not validate; repair that first.
 *   COMMIT_NOT_PUSHED        the draft names a commit no remote-tracking ref contains. Push, then
 *                            write the record.
 *
 * INVOCATION.  node tools/outcomes/write-record.ts <draft.json>
 *              node tools/outcomes/write-record.ts -          (the draft on stdin)
 *              then `npm run outcomes`, so the reports carry the new record.
 * NEEDS.       git, and the checkout's remote-tracking refs (it reads them; it fetches nothing).
 *              `OUTCOMES_ROOT` points it at a doctored copy.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RECORDS_DIR, defaultRoot, isMain } from './paths.ts'
import { canonicalJson, loadSchema, readRecordFile, validateRecord } from './record.ts'
import type { Refusal, RunOutcome } from './record.ts'

export type WriteResult =
  | { written: true; path: string; changed: boolean }
  | { written: false; refusal: Refusal }

export interface WriteOptions {
  root: string
  /** Is `commit` contained in a remote-tracking ref of the checkout at `root`? Replaceable in a selftest. */
  commitIsPushed?: (root: string, commit: string) => boolean
}

/** True when some `refs/remotes/**` ref contains `commit`: it was pushed, or fetched from where it was. */
export function commitIsPushed(root: string, commit: string): boolean {
  const run = spawnSync('git', ['for-each-ref', '--count=1', '--contains', commit, 'refs/remotes'], {
    cwd: root,
    encoding: 'utf8',
  })
  return run.status === 0 && run.stdout.trim() !== ''
}

/** The first entry of `before` that `after` does not carry unchanged at the same position, or null. */
function firstLostEntry(before: RunOutcome, after: RunOutcome): string | null {
  for (const list of ['facts', 'corrections'] as const) {
    for (const [i, entry] of before[list].entries()) {
      if (canonicalJson(after[list][i] ?? null) !== canonicalJson(entry)) return `${list}/${String(i)} (\`${entry.id}\`)`
    }
  }
  return null
}

export function writeRecord(draft: unknown, options: WriteOptions): WriteResult {
  const { root } = options
  const pushed = options.commitIsPushed ?? commitIsPushed
  const no = (code: string, at: string, message: string): WriteResult => ({
    written: false,
    refusal: { code, at, message },
  })

  const schema = loadSchema(root)
  const verdict = validateRecord(draft, schema)
  if (!verdict.ok) return { written: false, refusal: verdict.refusal }
  const record = verdict.record
  const relative = `${RECORDS_DIR}${record.item}.json`
  const path = join(root, relative)

  if (existsSync(path)) {
    const existing = readRecordFile(path, schema)
    if (!existing.ok) {
      return no(
        'EXISTING_RECORD_INVALID',
        relative,
        `the record already on disk is refused (${existing.refusal.code}: ${existing.refusal.message}) and` +
          ' cannot be held to the draft. Repair it first.',
      )
    }
    const lost = firstLostEntry(existing.record, record)
    if (lost !== null) {
      return no(
        'ENTRY_DELETED_OR_EDITED',
        `#/${lost}`,
        `${relative} already carries this entry and the draft drops or rewrites it. A fact found wrong` +
          ' is superseded or retracted by a NEW correction; the record keeps both for the audit.',
      )
    }
  }

  if (record.commit !== null && !pushed(root, record.commit)) {
    return no(
      'COMMIT_NOT_PUSHED',
      '#/commit',
      `no remote-tracking ref contains ${record.commit}. The record is written after the run's last` +
        ' push, so it names a commit that exists for whoever reads it. Push, then write the record.',
    )
  }

  const bytes = canonicalJson(record)
  const changed = !existsSync(path) || readFileSync(path, 'utf8') !== bytes
  if (changed) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }
  return { written: true, path: relative, changed }
}

function main(): void {
  const source = process.argv[2]
  if (source === undefined) {
    console.error('usage: node tools/outcomes/write-record.ts <draft.json | ->')
    process.exit(2)
  }
  let draft: unknown
  try {
    draft = JSON.parse(readFileSync(source === '-' ? 0 : source, 'utf8'))
  } catch (error) {
    console.error(`write-record REFUSED: NOT_JSON at ${source}: ${(error as Error).message}\nNothing was written.`)
    process.exit(1)
  }
  const result = writeRecord(draft, { root: defaultRoot() })
  if (!result.written) {
    const { code, at, message } = result.refusal
    console.error(`write-record REFUSED: ${code} at ${at}: ${message}\nNothing was written.`)
    process.exit(1)
  }
  console.log(`write-record: ${result.path} ${result.changed ? 'written' : 'unchanged'}. Now run \`npm run outcomes\`.`)
}

if (isMain(import.meta.url)) main()
