/**
 * outcomes:propose — the filing step. Every proposal the records yield becomes ONE issue in
 * `bd`, unless the committed reference already describes it.
 *
 * THE IDEMPOTENCY KEY IS A LABEL, NEVER THE TITLE: `proposal:<16 hex of sha256(subject, fact)>`
 * (the prefix is `proposalLabelPrefix` in policy.json). Before filing, the tracker is asked for ANY
 * issue carrying that label, open or closed. A person rewords a title while triaging, and a closed
 * issue keeps its labels, so a proposal that was promoted or rejected is found again and is never
 * re-filed under new wording. Closing a proposal that does not hold, with its reason, is therefore
 * final; removing its label is the only way to see it again.
 *
 * BEFORE FILING, each proposal is checked against the committed reference (`already-named.ts`):
 *   strong   printed with where the reference says it, NOT filed
 *   weak     filed, with "a mention in passing" and the place in the body
 *   absent   filed, with that in the body
 * THE BODY carries the proposal's siblings on the same subject, so contradictions are read together,
 * and its evidence CLASSED (source line, path, URL, prose); a source line is checked to exist at the
 * commit the record names, and the body says what was found, before a person reads it.
 *
 * A PROGRAM PROPOSES; ONLY A PERSON PROMOTES. Nothing here edits the reference, and nothing it
 * files filters or instructs anything. Promotion is a person editing the hand-maintained source and
 * re-running its emitter.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one, two of them. Keyed on the title, every re-run after
 * a triager's rewording files the same proposal again, and a rejected proposal comes back for ever.
 * And filed without the reference check, a share of proposals state what the reference already
 * carries, the promoter opens each to find the entry written, and stops opening them.
 *
 * INVOCATION.  npm run outcomes:propose -- --dry-run   print what would be filed and what is already
 *                                                      named; spawn nothing but read-only git; touch
 *                                                      nothing. Exits 0 with zero records, and
 *                                                      without the tracker's CLI installed.
 *              npm run outcomes:propose                pull, file what is new, push
 * NEEDS.       to file: the tracker's CLI (`bd`, through `tools/lib/bd-launcher.ts`, which
 *              section 1.3 lays down) and its remote. It runs in no hook and no CI step, because it
 *              reads and writes the tracker. `OUTCOMES_ROOT` points it at a doctored copy.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { alreadyNamed, loadReference } from './already-named.ts'
import type { Naming } from './already-named.ts'
import { readRecords } from './emit.ts'
import { RECORDS_DIR, defaultRoot, isMain } from './paths.ts'
import { loadPolicy } from './policy.ts'
import { deriveProposals } from './reports.ts'
import type { Proposal } from './reports.ts'

/* --------------------------------------------------------------------------- evidence, classed -- */

export type EvidenceClass = 'source-line' | 'path' | 'url' | 'prose'

export interface ClassedEvidence {
  cite: string
  class: EvidenceClass
  /** For a source line: what checking it at the record's commit found. Null for every other class. */
  checked: string | null
}

const SOURCE_LINE = /^([^\s:]+):(\d+)(?:-\d+)?$/

export function classify(cite: string): EvidenceClass {
  if (/^https?:\/\/\S+$/.test(cite)) return 'url'
  if (SOURCE_LINE.test(cite)) return 'source-line'
  if (/^\S+$/.test(cite) && /[/.]/.test(cite)) return 'path'
  return 'prose'
}

/** Does `path` have a line `line` at `commit`? Read-only git; every way of not knowing is said, not thrown. */
export function checkSourceLine(root: string, commit: string | null, cite: string): string {
  if (commit === null) return 'UNCHECKED: the record names no commit (the run pushed nothing)'
  const [, path, line] = SOURCE_LINE.exec(cite)!
  const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (git(['cat-file', '-e', `${commit}^{commit}`]).status !== 0) {
    return `UNVERIFIABLE HERE: commit ${commit.slice(0, 12)} is not in this checkout (fetch it, or the source is another repository's)`
  }
  const shown = git(['show', `${commit}:${path}`])
  if (shown.status !== 0) return `MISSING: no file \`${path}\` at ${commit.slice(0, 12)}`
  const lines = shown.stdout.split('\n').length - (shown.stdout.endsWith('\n') ? 1 : 0)
  return Number(line) >= 1 && Number(line) <= lines
    ? `exists at ${commit.slice(0, 12)}`
    : `MISSING: \`${path}\` has ${String(lines)} line(s) at ${commit.slice(0, 12)}`
}

/* ---------------------------------------------------------------------------------- the plan -- */

export interface Filing {
  proposal: Proposal
  naming: Naming
  /** The idempotency key. */
  keyLabel: string
  labels: string[]
  title: string
  body: string
}

export interface Plan {
  records: number
  /** Proposals the reference already describes: printed, never filed. */
  alreadyNamed: Filing[]
  toFile: Filing[]
  /** What a reader should know about the reference itself: not configured, or a configured path missing. */
  referenceNotes: string[]
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

function bodyOf(root: string, proposal: Proposal, naming: Naming, keyLabel: string, all: Proposal[]): string {
  const lines = [
    '## Proposal',
    '',
    `- Subject: ${proposal.subject}`,
    `- Fact: ${proposal.fact}`,
    `- Asset that would absorb it: ${proposal.assets.join(', ')}`,
    `- Stage that produced the correction: ${proposal.stages.join(', ')}`,
    `- Items: ${proposal.items.join(', ')}`,
    `- Key: \`${keyLabel}\` (a label, hashed from the subject and the fact; this title may be reworded freely)`,
    '',
    '## Disposition against the committed reference',
    '',
    `${naming.disposition.toUpperCase()}. ${naming.note}`,
    '',
    '## Evidence, classed and checked',
    '',
  ]
  for (const evidence of proposal.evidence) {
    lines.push(`- Item \`${evidence.item}\`, record commit ${evidence.commit ?? 'none'}:`)
    if (evidence.cites.length === 0) lines.push('  - (the record cites no evidence for this entry)')
    for (const cite of evidence.cites) {
      const kind = classify(cite)
      const checked = kind === 'source-line' ? ` — ${checkSourceLine(root, evidence.commit, cite)}` : ''
      lines.push(`  - [${kind}] ${cite}${checked}`)
    }
  }
  lines.push('', '## Siblings on the same subject', '')
  if (proposal.siblings.length === 0) lines.push('None.')
  for (const key of proposal.siblings) {
    const sibling = all.find((p) => p.key === key)!
    lines.push(`- \`${key}\` (items ${sibling.items.join(', ')}): ${sibling.fact}`)
  }
  lines.push(
    '',
    '## Promotion',
    '',
    'A program proposes; only a person promotes. If this holds, edit the hand-maintained source of the' +
      ' reference, re-run its emitter, and close this issue. If it does not hold, close it with the' +
      ' reason. Either way leave the key label on: it is what stops this proposal being filed again.',
  )
  return `${lines.join('\n')}\n`
}

/** Everything the filing step would do, decided without touching the tracker. Throws on a refused record. */
export function plan(root: string): Plan {
  const { records, refused } = readRecords(root)
  if (refused.length > 0) {
    const first = refused[0]
    throw new Error(
      `${String(refused.length)} file(s) under ${RECORDS_DIR} are not records; the first is ${first.path}` +
        ` (${first.refusal.code}: ${first.refusal.message}). Run \`npm run outcomes\` for the full list.`,
    )
  }
  const policy = loadPolicy(root)
  const reference = loadReference(root, policy)
  const referenceNotes: string[] = []
  if (!reference.configured) {
    referenceNotes.push('no reference is configured (`referencePaths` in policy.json is empty): every proposal is `absent` and none can be recognised as already named.')
  }
  for (const path of reference.missing) referenceNotes.push(`the configured reference path \`${path}\` does not exist; correct \`referencePaths\`.`)

  const proposals = deriveProposals(records)
  const result: Plan = { records: records.length, alreadyNamed: [], toFile: [], referenceNotes }
  for (const proposal of proposals) {
    const naming = alreadyNamed(proposal.subject, proposal.fact, reference, policy)
    const keyLabel = `${policy.proposalLabelPrefix}${proposal.key}`
    const filing: Filing = {
      proposal,
      naming,
      keyLabel,
      labels: [...policy.proposalLabels, keyLabel],
      title: clip(`Proposal: ${proposal.subject} — ${proposal.fact}`, 120),
      body: bodyOf(root, proposal, naming, keyLabel, proposals),
    }
    if (naming.disposition === 'strong') result.alreadyNamed.push(filing)
    else result.toFile.push(filing)
  }
  return result
}

/* ------------------------------------------------------------------------------- the tracker -- */

export interface Tracker {
  /** Every issue carrying `label`, OPEN OR CLOSED. */
  find(label: string): { id: string; status: string }[]
  /** Files one issue and returns its id. */
  create(filing: Filing): string
}

export interface FileResult {
  filed: { keyLabel: string; id: string }[]
  skipped: { keyLabel: string; id: string; status: string }[]
}

/** File what is new. The label decides; the title is never consulted. */
export function file(toFile: Filing[], tracker: Tracker): FileResult {
  const result: FileResult = { filed: [], skipped: [] }
  for (const filing of toFile) {
    const existing = tracker.find(filing.keyLabel)
    if (existing.length > 0) result.skipped.push({ keyLabel: filing.keyLabel, ...existing[0] })
    else result.filed.push({ keyLabel: filing.keyLabel, id: tracker.create(filing) })
  }
  return result
}

/** The real tracker: `bd`, started without a shell through the launcher section 1.3 lays down. */
async function bdTracker(root: string): Promise<Tracker & { bracket(step: 'pull' | 'push'): void }> {
  const launcherPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'bd-launcher.ts')
  if (!existsSync(launcherPath)) {
    throw new Error(`${launcherPath} is missing. The filing step starts \`bd\` through it; take section 1.3 of the kit, which lays it down.`)
  }
  const { resolveBd, runBd } = await import(pathToFileURL(launcherPath).href)
  const resolved = resolveBd()
  if (!resolved.found) throw new Error(`\`bd\` is not installed (${resolved.reason}). Filing needs the tracker; \`--dry-run\` does not.`)
  if (!resolved.runnable) throw new Error(`\`bd\` was found at ${resolved.location} but cannot be started: ${resolved.reason}`)
  const bd = (args: string[]): string => {
    const run = runBd(resolved.launcher, args, { cwd: root })
    if (run.status !== 0) {
      throw new Error(`\`bd ${args.join(' ')}\` failed (exit ${String(run.status)}): ${(run.error?.message ?? run.stderr).trim()}`)
    }
    return run.stdout
  }
  const scratch = mkdtempSync(join(tmpdir(), 'outcomes-propose-'))
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }))
  return {
    // Every run of tracker writes is bracketed: pull before the first, push after the last. A
    // rejected push is reported with its exact command and error, never forced.
    bracket: (step) => void bd(['dolt', step]),
    find: (label) => {
      const rows = JSON.parse(bd(['list', '--all', '--label', label, '--limit', '0', '--json']) || '[]') as { id: string; status: string }[]
      return rows.map(({ id, status }) => ({ id, status }))
    },
    create: (filing) => {
      const bodyFile = join(scratch, `${filing.proposal.key}.md`)
      writeFileSync(bodyFile, filing.body)
      return bd(['create', '--title', filing.title, '--body-file', bodyFile, '--labels', filing.labels.join(','), '--type', 'task', '--silent']).trim()
    },
  }
}

/* ---------------------------------------------------------------------------------- the CLI -- */

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const root = defaultRoot()
  let planned: Plan
  try {
    planned = plan(root)
  } catch (error) {
    console.error(`outcomes:propose REFUSED: ${(error as Error).message}`)
    process.exit(1)
  }

  const source = planned.records === 0 ? `${RECORDS_DIR} holds no record yet (a legal state)` : `${String(planned.records)} record(s) under ${RECORDS_DIR}`
  console.log(`outcomes:propose${dryRun ? ' --dry-run' : ''}: ${source}; ${String(planned.toFile.length)} to file, ${String(planned.alreadyNamed.length)} already named by the reference.`)
  for (const note of planned.referenceNotes) console.log(`  note: ${note}`)
  for (const named of planned.alreadyNamed) {
    console.log(`\nALREADY NAMED, not filed: ${named.keyLabel}  ${named.title}\n  ${named.naming.note}`)
  }

  const placeholders = planned.toFile.length > 0 ? planned.toFile[0].labels.filter((l) => /<[^>]+>/.test(l)) : []
  if (dryRun) {
    for (const filing of planned.toFile) {
      console.log(`\nWOULD FILE: ${filing.title}\n  labels: ${filing.labels.join(', ')}\n  disposition: ${filing.naming.disposition}\n`)
      console.log(filing.body.replace(/^/gm, '  | '))
    }
    if (placeholders.length > 0) console.log(`note: filing would be refused until \`proposalLabels\` in policy.json replaces ${placeholders.join(', ')}.`)
    console.log('\nDry run: the tracker was not consulted, so a key already filed is not shown as skipped. Nothing was filed or written.')
    return
  }

  if (planned.toFile.length === 0) {
    console.log('Nothing to file.')
    return
  }
  if (placeholders.length > 0) {
    console.error(`outcomes:propose REFUSED: \`proposalLabels\` in policy.json still carries ${placeholders.join(', ')}. Replace it with this repository's label; an issue filed without it fails the tracker gate. Nothing was filed.`)
    process.exit(1)
  }
  try {
    const tracker = await bdTracker(root)
    tracker.bracket('pull')
    const result = file(planned.toFile, tracker)
    for (const s of result.skipped) console.log(`  already filed, not re-filed: ${s.keyLabel} is ${s.id} (${s.status})`)
    for (const f of result.filed) console.log(`  filed: ${f.keyLabel} as ${f.id}`)
    if (result.filed.length > 0) tracker.bracket('push')
    console.log(`outcomes:propose: ${String(result.filed.length)} filed, ${String(result.skipped.length)} already filed.`)
  } catch (error) {
    console.error(`outcomes:propose FAILED: ${(error as Error).message}`)
    process.exit(1)
  }
}

if (isMain(import.meta.url)) await main()
