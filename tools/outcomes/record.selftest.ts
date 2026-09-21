/**
 * outcomes:record:selftest — the run-outcome record's validator and writer, held to the committed
 * fixtures and to one doctored copy per rule.
 *
 * WHAT IT HOLDS
 *   fixtures    one committed fixture per terminal path under `dry-run/tests/fixtures/run-outcome/`
 *               (complete, failed, blocked), each accepted by the validator as committed.
 *   validator   an unknown version refused by name and FIRST; one case per cross-field rule; a
 *               schema that outgrew its reader (an unknown keyword, a bumped version) refused.
 *   writer      validates before it writes and writes nothing on refusal; never drops or rewrites an
 *               entry an existing record carries, and accepts the same correction as an addition;
 *               refuses a commit no remote-tracking ref contains, asked of a real repository.
 *   the tie     the schema's intervention enum equals the exhaustive list in `dry-run/workflow-policy.json`,
 *               wherever that file is present.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: a validator nobody has ever seen refuse anything.
 * Every rule in `record.ts` is a few lines a refactor can turn into a no-op, and a record gate that
 * accepts everything looks exactly like a repository whose records are all well formed.
 *
 * INVOCATION.  npm run outcomes:record:selftest
 * NEEDS.       only committed files, and git for the one case that asks it a real question (it
 *              skips clean, saying so, where git is absent).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RECORDS_DIR, REPO_ROOT, SCHEMA_PATH, WORKFLOW_POLICY_PATH } from './paths.ts'
import { canonicalJson, loadSchema, validateRecord } from './record.ts'
import type { RunOutcome } from './record.ts'
import { doctored, editJson, fixture, fixtureNames, git, hasGit, refusedWith, runCases, scratchRepository, throwsLike, tree } from './selftest-lib.ts'
import type { Case, Outcome } from './selftest-lib.ts'
import { commitIsPushed, writeRecord } from './write-record.ts'

const schema = loadSchema(REPO_ROOT)
const always = (): boolean => true
const refuses = (name: string, change: (record: any) => void, code: string, at?: string): Outcome =>
  refusedWith(validateRecord(doctored(name, change), schema), code, at)

function doctoredSchema(name: string, change: (doc: any) => void): string {
  const root = tree(name)
  editJson(root, SCHEMA_PATH, change)
  return root
}

/** The intervention enum against the workflow policy's exhaustive list. Null when they are the same list. */
function interventionTie(recordSchema: any, workflowPolicy: any): Outcome {
  const inSchema: unknown = recordSchema?.$defs?.intervention?.properties?.reasonCode?.enum
  const block = workflowPolicy?.intervention
  if (block?.exhaustive !== true) return 'block `intervention` of the policy file is not flagged `exhaustive: true`'
  const inPolicy: unknown = Array.isArray(block.codes) ? block.codes.map((c: any) => c?.code) : null
  return JSON.stringify(inSchema) === JSON.stringify(inPolicy)
    ? null
    : `the schema's enum is ${JSON.stringify(inSchema)} and the policy file's codes are ${JSON.stringify(inPolicy)}`
}

function writerRefuses(name: string, draft: unknown, code: string, pushed: () => boolean = always): Outcome {
  const result = writeRecord(draft, { root: tree(name), commitIsPushed: pushed })
  if (result.written) return 'WROTE it'
  return result.refusal.code === code ? null : `refused, but for ${result.refusal.code} (${result.refusal.message})`
}

const cases: Case[] = [
  /* the fixtures */
  {
    name: 'control: every committed fixture is accepted, and there is one per terminal path',
    run: () => {
      for (const n of fixtureNames) {
        const verdict = validateRecord(fixture(n), schema)
        if (!verdict.ok) return `${n} is refused: ${verdict.refusal.code} ${verdict.refusal.message}`
      }
      const statuses = fixtureNames.map((n) => fixture(n).status).sort().join(',')
      return statuses === 'blocked,complete,failed' ? null : `the fixtures cover ${statuses || 'nothing'}`
    },
  },

  /* the validator */
  { name: 'a version the reader does not know is refused by name', run: () => refuses('complete.json', (r) => { r.schemaVersion = 2 }, 'UNKNOWN_SCHEMA_VERSION') },
  { name: 'an unknown version is refused FIRST, even when the record is otherwise malformed', run: () => refuses('complete.json', (r) => { r.schemaVersion = 2; delete r.status }, 'UNKNOWN_SCHEMA_VERSION') },
  { name: 'a field the schema does not list', run: () => refuses('complete.json', (r) => { r.mood = 'fine' }, 'SCHEMA_VIOLATION', '#/mood') },
  { name: 'a required field missing', run: () => refuses('complete.json', (r) => { delete r.undecided }, 'SCHEMA_VIOLATION', '#/undecided') },
  { name: 'a terminal status outside complete, failed, blocked', run: () => refuses('complete.json', (r) => { r.status = 'done' }, 'SCHEMA_VIOLATION', '#/status') },
  { name: 'a correction whose stage is not in the enum', run: () => refuses('complete.json', (r) => { r.corrections[0].stage = 'guesswork' }, 'SCHEMA_VIOLATION', '#/corrections/0/stage') },
  { name: 'a correction whose asset is not in the enum', run: () => refuses('complete.json', (r) => { r.corrections[0].asset = 'a sticky note' }, 'SCHEMA_VIOLATION', '#/corrections/0/asset') },
  { name: 'a blocked run recording an unlisted intervention reason', run: () => refuses('blocked.json', (r) => { r.intervention.reasonCode = 'FELT_UNSURE' }, 'SCHEMA_VIOLATION', '#/intervention/reasonCode') },
  { name: 'a complete run that names no commit', run: () => refuses('complete.json', (r) => { r.commit = null; r.branch = null }, 'COMPLETE_WITHOUT_COMMIT') },
  { name: 'a commit without its branch', run: () => refuses('complete.json', (r) => { r.branch = null }, 'COMMIT_AND_BRANCH_NOT_NULL_TOGETHER') },
  { name: 'a failed run with no failure', run: () => refuses('failed.json', (r) => { r.failure = null }, 'FAILURE_DOES_NOT_MATCH_STATUS') },
  { name: 'a complete run carrying an intervention', run: () => refuses('complete.json', (r) => { r.intervention = fixture('blocked.json').intervention }, 'INTERVENTION_DOES_NOT_MATCH_STATUS') },
  { name: 'a retraction that states a fact', run: () => refuses('blocked.json', (r) => { r.corrections[0].fact = 'rounds half to even' }, 'RETRACTION_AND_FACT_NOT_NULL_TOGETHER') },
  { name: 'a correction that both supersedes and retracts', run: () => refuses('complete.json', (r) => { r.corrections[0].retracts = 'export-encoding' }, 'CORRECTION_SUPERSEDES_AND_RETRACTS') },
  { name: 'a correction pointing at an id that is not an earlier entry', run: () => refuses('complete.json', (r) => { r.corrections[0].supersedes = 'no-such-entry' }, 'CORRECTION_TARGET_NOT_EARLIER') },
  { name: 'a second correction pointing at an entry already superseded', run: () => refuses('complete.json', (r) => { r.corrections.push({ ...r.corrections[0], id: 'again' }) }, 'CORRECTION_TARGET_NOT_LIVE') },
  { name: 'an id used by a fact and by a correction', run: () => refuses('complete.json', (r) => { r.corrections[0].id = 'export-encoding' }, 'DUPLICATE_ENTRY_ID') },

  /* the schema against its reader */
  { name: 'a schema using a keyword the reader does not understand is refused, not half-read', run: () => throwsLike(() => loadSchema(doctoredSchema('schema-keyword', (d) => { d.properties.workflow.maxLength = 40 })), /keyword `maxLength` is not one record\.ts understands/) },
  { name: 'a schema whose version moved without its reader', run: () => throwsLike(() => loadSchema(doctoredSchema('schema-version', (d) => { d.properties.schemaVersion.const = 2 })), /declares schemaVersion 2 and record\.ts reads version 1/) },

  /* the writer */
  {
    name: 'control: the writer writes a valid record once, in canonical bytes, and is idempotent',
    run: () => {
      const root = tree('writer-control', { empty: true })
      const first = writeRecord(fixture('failed.json'), { root, commitIsPushed: always })
      const second = writeRecord(fixture('failed.json'), { root, commitIsPushed: always })
      if (!first.written || !second.written) return `refused: ${JSON.stringify([first, second])}`
      if (!first.changed || second.changed) return 'the second write of the same draft was not `unchanged`'
      return readFileSync(join(root, first.path), 'utf8') === canonicalJson(fixture('failed.json')) ? null : 'the bytes written are not canonical'
    },
  },
  {
    name: 'the writer refuses an invalid draft with its one named reason, and writes nothing',
    run: () => {
      const root = tree('writer-invalid', { empty: true })
      const result = writeRecord(doctored('failed.json', (r) => { r.failure = null }), { root, commitIsPushed: always })
      if (result.written) return 'WROTE an invalid record'
      if (result.refusal.code !== 'FAILURE_DOES_NOT_MATCH_STATUS') return `refused, but for ${result.refusal.code}`
      return existsSync(join(root, RECORDS_DIR)) ? 'refused, and still created the records directory' : null
    },
  },
  { name: 'a draft that drops a fact the existing record carries', run: () => writerRefuses('writer-delete', doctored('complete.json', (r) => { r.facts.splice(1, 1) }), 'ENTRY_DELETED_OR_EDITED') },
  { name: 'a draft that rewrites a fact in place instead of correcting it', run: () => writerRefuses('writer-edit', doctored('complete.json', (r) => { r.facts[1].fact = 'is written as UTF-16' }), 'ENTRY_DELETED_OR_EDITED') },
  {
    name: 'control: the same correction made as an ADDITION is written, and the record keeps both',
    run: () => {
      const root = tree('writer-add')
      const draft = doctored('complete.json', (r) => {
        r.corrections.push({ id: 'export-encoding-utf16', subject: 'the nightly export', fact: 'is written as UTF-16', stage: 'review', asset: 'test-oracle', supersedes: 'export-encoding', retracts: null, evidence: [] })
      })
      const result = writeRecord(draft, { root, commitIsPushed: always })
      if (!result.written) return `refused: ${result.refusal.code} ${result.refusal.message}`
      const onDisk = JSON.parse(readFileSync(join(root, result.path), 'utf8')) as RunOutcome
      return onDisk.facts.length === 2 && onDisk.corrections.length === 2 ? null : 'the record on disk lost an entry'
    },
  },
  {
    name: 'an existing record that does not validate is repaired before it is written over',
    run: () => {
      const root = tree('writer-existing-invalid')
      writeFileSync(join(root, RECORDS_DIR, 'EXAMPLE-101.json'), '{ "schemaVersion": 1 }\n')
      const result = writeRecord(fixture('complete.json'), { root, commitIsPushed: always })
      return result.written ? 'WROTE over a record it could not read' : result.refusal.code === 'EXISTING_RECORD_INVALID' ? null : `refused, but for ${result.refusal.code}`
    },
  },
  { name: 'a draft naming a commit the writer is told was never pushed', run: () => writerRefuses('writer-unpushed', fixture('complete.json'), 'COMMIT_NOT_PUSHED', () => false) },
  {
    name: 'asked of a real repository: a commit is unpushed until a remote-tracking ref contains it',
    run: () => {
      if (!hasGit) return 'skip'
      const { work, commit } = scratchRepository('pushed')
      if (commitIsPushed(work, commit)) return 'reported a commit as pushed before any push'
      git(work, 'push', '-q', 'origin', 'main')
      return commitIsPushed(work, commit) ? null : 'reported a pushed commit as unpushed'
    },
  },

  /* the tie to the workflow's policy file */
  {
    name: 'a policy file whose exhaustive list lost a code, or lost its flag, no longer ties to the schema',
    run: () => {
      const codes = (schema as any).$defs.intervention.properties.reasonCode.enum as string[]
      const policyOf = (list: string[], exhaustive = true) => ({ intervention: { exhaustive, codes: list.map((code) => ({ code })) } })
      if (interventionTie(schema, policyOf(codes)) !== null) return 'the control (the same list) does not tie'
      if (interventionTie(schema, policyOf(codes, false)) === null) return 'a list not flagged exhaustive ties'
      return interventionTie(schema, policyOf(codes.slice(1))) === null ? 'a shorter list ties' : null
    },
  },
  {
    name: `the schema's intervention enum is the exhaustive list in ${WORKFLOW_POLICY_PATH}`,
    run: () => {
      const path = join(REPO_ROOT, WORKFLOW_POLICY_PATH)
      return existsSync(path) ? interventionTie(schema, JSON.parse(readFileSync(path, 'utf8'))) : 'skip'
    },
  },
]

runCases('outcomes record selftest', cases)
