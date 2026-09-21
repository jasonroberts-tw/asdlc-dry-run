/**
 * What the two selftests here share (`record.selftest.ts` for the record, `selftest.ts` for the
 * loop): the committed fixtures, doctored copies of them, scratch trees and scratch repositories
 * under the temporary directory, and the runner that prints one line per case.
 *
 * THE SHAPE EVERY CASE KEEPS. One thing is broken per case, in a fresh copy, and the case asserts
 * the run fails FOR THAT REASON (the refusal's code, the path named), never the refusal alone: a
 * case that only sees "refused" still passes with its rule deleted whenever another rule refuses
 * first. Each group keeps an undoctored control, without which every other case could be failing on
 * the copy.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: a doctoring that misses its target. A case whose
 * edit changed nothing tests the control again and passes for ever, so `doctored` and `editJson`
 * throw when the copy comes out equal to what went in.
 *
 * INVOCATION. Imported by the two selftests; never run.
 * NEEDS. Only committed files; git only for the cases that build a scratch repository.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { FIXTURES_DIR, POLICY_PATH, RECORDS_DIR, REPO_ROOT, SCHEMA_PATH } from './paths.ts'
import { canonicalJson } from './record.ts'
import type { RunOutcome, Verdict } from './record.ts'

// A hook may export these, and they would point every git call below at the wrong repository.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[name]

export const base = mkdtempSync(join(tmpdir(), 'outcomes-selftest-'))

/** null when the case holds; otherwise what happened instead. `skip` when its input is absent here. */
export type Outcome = string | null
export interface Case {
  name: string
  run: () => Outcome | 'skip'
}

/* ------------------------------------------------------------------------------- the fixtures -- */

export const fixtureNames = readdirSync(join(REPO_ROOT, FIXTURES_DIR)).filter((n) => n.endsWith('.json')).sort()

export const fixture = (name: string): RunOutcome =>
  JSON.parse(readFileSync(join(REPO_ROOT, FIXTURES_DIR, name), 'utf8')) as RunOutcome

/** A deep copy of a committed fixture with ONE thing changed. Throws if the change changed nothing. */
export function doctored(name: string, change: (record: any) => void): unknown {
  const copy = fixture(name)
  change(copy)
  if (JSON.stringify(copy) === JSON.stringify(fixture(name))) throw new Error(`the doctoring of ${name} changed nothing`)
  return copy
}

/** A copy of what the tools read: the schema, the policy file where there is one and, unless `empty`, the fixtures as records. */
export function tree(name: string, options: { empty?: boolean } = {}): string {
  const root = join(base, name)
  for (const relative of [SCHEMA_PATH, POLICY_PATH]) {
    if (!existsSync(join(REPO_ROOT, relative))) continue
    mkdirSync(dirname(join(root, relative)), { recursive: true })
    copyFileSync(join(REPO_ROOT, relative), join(root, relative))
  }
  if (!options.empty) {
    mkdirSync(join(root, RECORDS_DIR), { recursive: true })
    for (const n of fixtureNames) writeFileSync(join(root, RECORDS_DIR, `${fixture(n).item}.json`), canonicalJson(fixture(n)))
  }
  return root
}

/** Rewrite one JSON file of a scratch tree through its parsed form. Throws if nothing changed. */
export function editJson(root: string, relative: string, change: (doc: any) => void): void {
  const path = join(root, relative)
  const before = readFileSync(path, 'utf8')
  const doc = JSON.parse(before)
  change(doc)
  const after = `${JSON.stringify(doc, null, 2)}\n`
  if (JSON.stringify(JSON.parse(before)) === JSON.stringify(doc)) throw new Error(`the doctoring of ${relative} changed nothing`)
  writeFileSync(path, after)
}

/** Every file under `root` with a digest of its bytes: what "writes nothing" is measured against. */
export function snapshot(root: string, relative = ''): string {
  return readdirSync(join(root, relative))
    .sort()
    .map((name) => {
      const child = join(relative, name)
      return statSync(join(root, child)).isDirectory()
        ? snapshot(root, child)
        : `${child} ${createHash('sha256').update(readFileSync(join(root, child))).digest('hex')}`
    })
    .join('\n')
}

/* ---------------------------------------------------------------------------- the assertions -- */

/** `at` narrows a code many rules share (every schema violation has one code) to the field that broke it. */
export function refusedWith(verdict: Verdict, code: string, at?: string): Outcome {
  if (verdict.ok) return 'ACCEPTED, but should have been refused'
  const { refusal } = verdict
  if (refusal.code !== code) return `refused, but for ${refusal.code} (${refusal.message})`
  return at === undefined || refusal.at === at ? null : `refused for ${code}, but at ${refusal.at} and not at ${at}`
}

export function throwsLike(run: () => unknown, expect: RegExp): Outcome {
  try {
    run()
  } catch (error) {
    return expect.test((error as Error).message) ? null : `threw, but not for that reason: ${(error as Error).message}`
  }
  return 'did not throw'
}

/* ------------------------------------------------------------------------ scratch repositories -- */

export const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0

export function git(cwd: string, ...args: string[]): string {
  const run = spawnSync(
    'git',
    ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8' },
  )
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`)
  return run.stdout.trim()
}

/** A repository with one commit holding a three-line file, and a bare remote it has NOT pushed to yet. */
export function scratchRepository(name: string): { work: string; commit: string } {
  const work = join(base, name, 'work')
  const remote = join(base, name, 'remote.git')
  mkdirSync(join(work, 'src'), { recursive: true })
  git(base, 'init', '-q', '--bare', '-b', 'main', remote)
  git(work, 'init', '-q', '-b', 'main')
  writeFileSync(join(work, 'src/three-lines.ext'), 'one\ntwo\nthree\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'fixture')
  git(work, 'remote', 'add', 'origin', remote)
  return { work, commit: git(work, 'rev-parse', 'HEAD') }
}

/* ---------------------------------------------------------------------------------- the run -- */

/** Runs every case, prints one line each, removes the scratch directory, and exits 0 only if none failed. */
export function runCases(title: string, cases: Case[]): never {
  let failed = 0
  let skipped = 0
  try {
    for (const { name, run } of cases) {
      let outcome: Outcome | 'skip'
      try {
        outcome = run()
      } catch (error) {
        outcome = `threw: ${(error as Error).stack ?? String(error)}`
      }
      if (outcome === 'skip') {
        skipped++
        console.log(`  skip ${name} -- its input is not present here`)
      } else if (outcome === null) {
        console.log(`  ok   ${name}`)
      } else {
        failed++
        console.log(`  FAIL ${name} -- ${outcome}`)
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  console.log(`${title}: ${String(cases.length - failed - skipped)}/${String(cases.length)} cases hold, ${String(skipped)} skipped, ${String(failed)} failed.`)
  process.exit(failed === 0 ? 0 : 1)
}
