/**
 * Where the learning loop's inputs and outputs are, in a module with NO side effects.
 *
 * Every path the record writer, the report emitter, the filing step and their selftest share is
 * stated here once, repository-relative, so the four cannot disagree about where a record lives.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: a writer that writes records under one directory
 * and an emitter that reads another both succeed, the emitter over zero records, and "no records
 * yet" is a legal answer that nobody would question.
 *
 * ROOT OVERRIDE. `OUTCOMES_ROOT` names a doctored copy of the repository, so a by-hand run of any
 * of the four can be pointed at a fixture tree without editing it. Unset, the root is the nearest
 * directory above this file that holds a `package.json`.
 *
 * NEEDS. Nothing: it reads the file system only to find that `package.json`.
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function nearestPackageRoot(from: string): string {
  let dir = from
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const up = dirname(dir)
    if (up === dir) throw new Error(`no package.json above ${from}; set OUTCOMES_ROOT`)
    dir = up
  }
}

/** The checkout this module sits in, whatever `OUTCOMES_ROOT` says: where the tools themselves are. */
export const REPO_ROOT = nearestPackageRoot(HERE)

/** The tree the tools read and write: `OUTCOMES_ROOT` when set, else the checkout. */
export const defaultRoot = (): string =>
  process.env.OUTCOMES_ROOT ? resolve(process.env.OUTCOMES_ROOT) : REPO_ROOT

/**
 * Is the module at `url` the script node was started on? Compared through `realpath`, because the
 * temporary directory is a symlink on some hosts and a plain string comparison then says no.
 */
export function isMain(url: string): boolean {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url))
  } catch {
    return false
  }
}

/** One record per work item, `<item>.json`, written by `write-record.ts` and by nothing else. */
export const RECORDS_DIR = 'artifacts/outcomes/records/'
/** Everything the emitter owns. The records directory sits inside it and is normalised, not derived. */
export const REPORTS_DIR = 'artifacts/outcomes/'
/** The one schema the writer and every reader share. */
export const SCHEMA_PATH = 'dry-run/run-outcome.schema.json'
/** The loop's constants, each with its reason. */
export const POLICY_PATH = 'tools/outcomes/policy.json'
/** One committed fixture per terminal path, beside the workflow's tests. */
export const FIXTURES_DIR = 'dry-run/tests/fixtures/run-outcome/'
/** The workflow's policy file, whose exhaustive intervention list the schema's enum repeats. */
export const WORKFLOW_POLICY_PATH = 'dry-run/workflow-policy.json'
/** How the emitter names itself in every banner. */
export const EMITTER = 'tools/outcomes/index.ts'
