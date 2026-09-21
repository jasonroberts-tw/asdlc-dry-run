/**
 * The body of the outcomes emitter, as functions over a root, so `index.ts` runs it on the checkout
 * and the selftest runs it on doctored copies: read every record, refuse on the first invalid one
 * per file, and build in memory every byte the emitter owns.
 *
 * WHAT IT OWNS: everything under `artifacts/outcomes/`. The records there are written by
 * `write-record.ts` and are NORMALISED here (re-serialised to canonical bytes), never derived; every
 * other file is derived from them. A file under the root that a fresh run would not write is stale.
 * Names starting with `.` are left alone, so a `.gitkeep` may hold the records directory open.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: one malformed record among many. An emitter that
 * skipped it would publish reports over the rest, every count in them quietly short by one run, and
 * the run most likely to be malformed is the one that ended badly. So one refused record refuses the
 * whole build, by file and by reason, and nothing is written.
 *
 * INVOCATION. Imported by `index.ts`, `propose.ts` and `selftest.ts`; never run.
 * NEEDS. Only committed files.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { RECORDS_DIR, REPORTS_DIR } from './paths.ts'
import { loadPolicy } from './policy.ts'
import { canonicalJson, loadSchema, readRecordFile } from './record.ts'
import type { Refusal, RunOutcome } from './record.ts'
import { byCodePoint, deriveReports } from './reports.ts'

export interface Build {
  records: RunOutcome[]
  /** One per record file that is not a record. Non-empty means nothing may be written. */
  refused: { path: string; refusal: Refusal }[]
  /** Repository-relative path -> the bytes a fresh run writes. Empty when anything was refused. */
  outputs: Map<string, string>
}

export function readRecords(root: string): Pick<Build, 'records' | 'refused'> {
  const schema = loadSchema(root)
  const dir = join(root, RECORDS_DIR)
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')).sort(byCodePoint) : []
  const records: RunOutcome[] = []
  const refused: Build['refused'] = []
  for (const name of names) {
    const path = `${RECORDS_DIR}${name}`
    if (!name.endsWith('.json') || statSync(join(root, path)).isDirectory()) {
      refused.push({ path, refusal: { code: 'NOT_A_RECORD_FILE', at: path, message: `${RECORDS_DIR} holds records, one \`<item>.json\` each, and nothing else.` } })
      continue
    }
    const verdict = readRecordFile(join(root, path), schema)
    if (verdict.ok) records.push(verdict.record)
    else refused.push({ path, refusal: verdict.refusal })
  }
  return { records, refused }
}

export function build(root: string): Build {
  const { records, refused } = readRecords(root)
  const outputs = new Map<string, string>()
  if (refused.length > 0) return { records, refused, outputs }
  for (const record of records) outputs.set(`${RECORDS_DIR}${record.item}.json`, canonicalJson(record))
  for (const [path, bytes] of deriveReports(records, loadPolicy(root).minimumSampleSize)) outputs.set(path, bytes)
  return { records, refused, outputs }
}

/** Every file under the owned root, repository-relative, dot-names skipped. */
export function ownedFiles(root: string, relative: string = REPORTS_DIR): string[] {
  const full = join(root, relative)
  if (!existsSync(full)) return []
  const out: string[] = []
  for (const name of readdirSync(full).sort(byCodePoint)) {
    if (name.startsWith('.')) continue
    const child = `${relative}${name}`
    if (statSync(join(root, child)).isDirectory()) out.push(...ownedFiles(root, `${child}/`))
    else out.push(child)
  }
  return out
}

/** What differs between the tree at `root` and a fresh run: `[path, why]`, sorted by path. */
export function differences(root: string, outputs: Map<string, string>): [string, string][] {
  const found: [string, string][] = []
  for (const [path, bytes] of outputs) {
    const full = join(root, path)
    if (!existsSync(full)) found.push([path, 'is missing; a fresh run writes it'])
    else if (readFileSync(full, 'utf8') !== bytes) {
      found.push([path, path.startsWith(RECORDS_DIR) ? 'is not in canonical bytes; it was edited by hand or never normalised' : 'differs from what a fresh run derives'])
    }
  }
  for (const path of ownedFiles(root)) {
    if (!outputs.has(path)) found.push([path, 'is stale; a fresh run would not write it'])
  }
  return found.sort(([a], [b]) => byCodePoint(a, b))
}
