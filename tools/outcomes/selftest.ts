/**
 * outcomes:selftest — the report emitter and the filing step, held to scratch trees built from the
 * committed fixtures under the temporary directory. (The record's own validator and writer are
 * held by `record.selftest.ts`.)
 *
 * WHAT IT HOLDS
 *   emitter   a fresh tree checks clean; a hand-edited report, an un-normalised record, a stale file,
 *             a refused record and a misnamed one each fail BY PATH AND REASON; the empty state is
 *             legal and every report says so with its source named; a rate is withheld below the
 *             declared minimum sample and printed at it; the check twin exits 1, names the path on
 *             its own indented line (the pre-commit verifier reads that line) and writes nothing.
 *   filing    the key ignores case and spacing and nothing else; a strong match is printed and not
 *             filed, a mention in passing is filed as weak with the place; the generic words
 *             matched with are the policy file's, the ONE list; a key already filed, even closed
 *             and retitled, is not re-filed; evidence is classed and a source line checked at the
 *             record's commit; `--dry-run` exits 0 with zero records and with the fixtures, with no
 *             tracker CLI and no git on PATH, and changes no byte.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: a check twin that compares a fresh run with itself.
 * It is green over any tree, and the only way to know is to hand it a tree that is wrong.
 *
 * INVOCATION.  npm run outcomes:selftest
 * NEEDS.       only committed files, and git for the one case that asks it a real question (it
 *              skips clean, saying so, where git is absent).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, differences } from './emit.ts'
import { POLICY_PATH, RECORDS_DIR, REPORTS_DIR } from './paths.ts'
import { checkSourceLine, classify, file, plan } from './propose.ts'
import type { Filing, Tracker } from './propose.ts'
import { canonicalJson } from './record.ts'
import { proposalKey } from './reports.ts'
import { base, doctored, editJson, fixture, fixtureNames, hasGit, runCases, scratchRepository, snapshot, tree } from './selftest-lib.ts'
import type { Case, Outcome } from './selftest-lib.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** A scratch tree with every output a fresh run writes already in place. */
function emitted(name: string, options: { empty?: boolean } = {}): string {
  const root = tree(name, options)
  const built = build(root)
  if (built.refused.length > 0) throw new Error(`the fixture tree is refused: ${JSON.stringify(built.refused)}`)
  for (const [path, bytes] of built.outputs) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), bytes)
  }
  return root
}

/** The fixtures, plus a reference that DESCRIBES the first proposal's fact and only MENTIONS its subject before that. */
function referenceTree(name: string): string {
  const root = tree(name)
  mkdirSync(join(root, 'reference'), { recursive: true })
  writeFileSync(
    join(root, 'reference/formatter-notes.txt'),
    'See also the legacy date formatter, which the export module calls.\n\nThe legacy date formatter pads a single-digit day with a space, not a zero.\n',
  )
  editJson(root, POLICY_PATH, (p) => { p.referencePaths = ['reference/'] })
  return root
}

/** Does a fresh run over `root` name `path` as differing, for that reason? */
function names(root: string, path: string, why: RegExp): Outcome {
  const found = differences(root, build(root).outputs)
  return found.some(([p, w]) => p === path && why.test(w)) ? null : `did not name ${path} for that reason: ${JSON.stringify(found)}`
}

const cases: Case[] = [
  /* the emitter */
  {
    name: 'control: a freshly emitted tree over the fixtures has no difference',
    run: () => {
      const root = emitted('emit-control')
      const found = differences(root, build(root).outputs)
      return found.length === 0 ? null : `a fresh tree differs from itself: ${JSON.stringify(found)}`
    },
  },
  {
    name: 'an empty records directory is legal, and every report says so with its source named',
    run: () => {
      const root = emitted('emit-empty', { empty: true })
      const built = build(root)
      if (built.refused.length > 0 || built.outputs.size === 0) return 'the empty state was refused or wrote nothing'
      for (const [path, bytes] of built.outputs) {
        if (!bytes.includes('holds no record yet') || !bytes.includes(RECORDS_DIR)) return `${path} does not say the records directory is empty`
      }
      return differences(root, built.outputs).length === 0 ? null : 'the empty tree does not check clean'
    },
  },
  {
    name: 'a hand-edited report',
    run: () => {
      const root = emitted('emit-edited')
      const path = join(root, REPORTS_DIR, 'recurring.md')
      writeFileSync(path, `${readFileSync(path, 'utf8')}\nA line added by hand.\n`)
      return names(root, `${REPORTS_DIR}recurring.md`, /differs from what a fresh run derives/)
    },
  },
  {
    name: 'a record that was never normalised',
    run: () => {
      const root = emitted('emit-raw-record')
      writeFileSync(join(root, RECORDS_DIR, 'EXAMPLE-102.json'), JSON.stringify(fixture('failed.json'), null, 4))
      return names(root, `${RECORDS_DIR}EXAMPLE-102.json`, /not in canonical bytes/)
    },
  },
  {
    name: 'a stale file a fresh run would not write',
    run: () => {
      const root = emitted('emit-stale')
      writeFileSync(join(root, REPORTS_DIR, 'retired-report.md'), 'left behind\n')
      return names(root, `${REPORTS_DIR}retired-report.md`, /is stale/)
    },
  },
  {
    name: 'one refused record refuses the whole build, by file and reason, and nothing is derived',
    run: () => {
      const root = emitted('emit-refused')
      writeFileSync(join(root, RECORDS_DIR, 'EXAMPLE-102.json'), canonicalJson(doctored('failed.json', (r) => { r.failure = null })))
      const built = build(root)
      if (built.outputs.size > 0) return 'derived reports over the records it could read'
      const [first] = built.refused
      return first?.path === `${RECORDS_DIR}EXAMPLE-102.json` && first.refusal.code === 'FAILURE_DOES_NOT_MATCH_STATUS' ? null : `refused: ${JSON.stringify(built.refused)}`
    },
  },
  {
    name: 'a record whose file is not named for its item',
    run: () => {
      const root = emitted('emit-misnamed')
      writeFileSync(join(root, RECORDS_DIR, 'EXAMPLE-999.json'), canonicalJson(fixture('failed.json')))
      const refused = build(root).refused
      return refused.length === 1 && refused[0].refusal.code === 'FILE_NAME_IS_NOT_THE_ITEM' ? null : `refused: ${JSON.stringify(refused)}`
    },
  },
  {
    name: 'below the declared minimum sample a rate is withheld; at it, the rate is printed',
    run: () => {
      const root = tree('emit-sample')
      const path = `${REPORTS_DIR}dead-or-blocked.md`
      editJson(root, POLICY_PATH, (p) => { p.minimumSampleSize = fixtureNames.length + 1 })
      const below = build(root).outputs.get(path) ?? ''
      editJson(root, POLICY_PATH, (p) => { p.minimumSampleSize = fixtureNames.length })
      const at = build(root).outputs.get(path) ?? ''
      if (!below.includes('rate withheld') || /\d%/.test(below)) return 'printed a rate below the minimum sample'
      return /\d%/.test(at) && !at.includes('rate withheld') ? null : 'withheld the rate at the minimum sample'
    },
  },
  {
    name: 'the four reports and the proposal list say what the fixtures hold',
    run: () => {
      const out = build(tree('emit-content')).outputs
      const has = (name: string, ...parts: string[]): boolean => parts.every((part) => (out.get(`${REPORTS_DIR}${name}`) ?? '').includes(part))
      if (!has('recurring.md', '| research | reference-page |', 'EXAMPLE-101, EXAMPLE-102')) return 'recurring.md misses the pair two items share'
      if (!has('disagreements.md', '| empty-input | throw |', '| empty-input | return an empty string |')) return 'disagreements.md misses the decision made two ways'
      if (!has('undecided.md', 'which rounding the totals column keeps')) return 'undecided.md misses the open question'
      if (!has('dead-or-blocked.md', '| EXAMPLE-102 | build |', '| EXAMPLE-103 | SOURCE_CONFLICT |')) return 'dead-or-blocked.md misses a failed or a blocked run'
      const proposals = (JSON.parse(out.get(`${REPORTS_DIR}proposals.json`) ?? '{}') as { proposals: { fact: string; siblings: string[] }[] }).proposals
      if (proposals.length !== 2) return `expected the two live corrections with an asset as proposals, got ${String(proposals.length)}`
      if (proposals.some((p) => p.fact === 'pads a single-digit day with a zero')) return 'proposed a fact its own record superseded'
      return proposals.every((p) => p.siblings.length === 1) ? null : "two proposals on one subject are not each other's siblings"
    },
  },
  {
    name: 'the check twin exits 1, prints the differing path on its own indented line, and writes nothing',
    run: () => {
      const root = emitted('emit-cli')
      const check = () => spawnSync(process.execPath, [join(HERE, 'index.ts'), '--check'], { encoding: 'utf8', env: { ...process.env, OUTCOMES_ROOT: root } })
      const clean = check()
      if (clean.status !== 0) return `the control tree fails --check: ${clean.stderr}`
      writeFileSync(join(root, REPORTS_DIR, 'undecided.md'), 'edited\n')
      const before = snapshot(root)
      const dirty = check()
      if (dirty.status !== 1) return `exit ${String(dirty.status)} over an edited report`
      if (snapshot(root) !== before) return '--check wrote something'
      return new RegExp(`^\\s+${REPORTS_DIR}undecided\\.md\\s`, 'm').test(dirty.stderr) ? null : `did not name the path: ${dirty.stderr}`
    },
  },

  /* the filing step */
  {
    name: 'the key ignores case and spacing, and nothing else',
    run: () => {
      const key = proposalKey('The Legacy  Date Formatter', 'pads with a SPACE')
      if (key !== proposalKey('the legacy date formatter', ' pads with a space ')) return 'case or spacing made a new key'
      return key !== proposalKey('the legacy date formatter', 'pads with a zero') ? null : 'two different facts share a key'
    },
  },
  {
    name: 'control: with no reference configured every proposal is filed as absent, and the plan says why',
    run: () => {
      const planned = plan(tree('propose-control'))
      if (planned.toFile.length !== 2 || planned.alreadyNamed.length !== 0) return `planned ${String(planned.toFile.length)} to file`
      if (!planned.toFile.every((f) => f.naming.disposition === 'absent')) return 'a disposition other than absent with no reference'
      return planned.referenceNotes.some((n) => n.includes('no reference is configured')) ? null : 'did not say the reference is not configured'
    },
  },
  {
    name: 'a strong match is printed and not filed; a mention in passing is filed as weak, with the place',
    run: () => {
      const planned = plan(referenceTree('propose-dedup'))
      const strong = planned.alreadyNamed.map((f) => f.proposal.items.join())
      const weak = planned.toFile.filter((f) => f.naming.disposition === 'weak')
      if (strong.join() !== 'EXAMPLE-101') return `already named: ${JSON.stringify(strong)}`
      if (weak.length !== 1 || weak[0].naming.where !== 'reference/formatter-notes.txt:1') return `weak: ${JSON.stringify(planned.toFile.map((f) => f.naming))}`
      return weak[0].body.includes('WEAK.') && weak[0].body.includes(`\`${planned.alreadyNamed[0].keyLabel.split(':')[1]}\``) ? null : 'the body does not carry the disposition and the sibling'
    },
  },
  {
    name: "the generic words matched with are the policy file's: moving the fact's words into the list turns strong into weak",
    run: () => {
      const root = referenceTree('propose-generic')
      editJson(root, POLICY_PATH, (p) => { p.genericWords.push('pads', 'single', 'digit', 'day', 'space', 'zero', 'not') })
      const planned = plan(root)
      return planned.alreadyNamed.length === 0 && planned.toFile.every((f) => f.naming.disposition === 'weak') ? null : `still strong: ${JSON.stringify(planned.alreadyNamed.map((f) => f.naming))}`
    },
  },
  {
    name: 'a configured reference path that does not exist is reported, not read as "absent"',
    run: () => {
      const root = tree('propose-missing-reference')
      editJson(root, POLICY_PATH, (p) => { p.referencePaths = ['reference/moved.txt'] })
      return plan(root).referenceNotes.some((n) => n.includes('`reference/moved.txt` does not exist')) ? null : 'said nothing about the missing path'
    },
  },
  {
    name: 'a key already filed is not re-filed, even closed and under another title; the rest are filed',
    run: () => {
      const planned = plan(tree('propose-idempotent'))
      const [known, fresh] = planned.toFile
      const created: Filing[] = []
      const tracker: Tracker = {
        find: (label) => (label === known.keyLabel ? [{ id: 'fake-1', status: 'closed' }] : []),
        create: (filing) => { created.push(filing); return 'fake-2' },
      }
      const result = file(planned.toFile, tracker)
      if (created.length !== 1 || created[0].keyLabel !== fresh.keyLabel) return `created ${JSON.stringify(created.map((f) => f.keyLabel))}`
      if (!created[0].labels.includes(fresh.keyLabel)) return 'the filed issue does not carry its key as a label'
      return result.skipped.length === 1 && result.skipped[0].id === 'fake-1' ? null : 'did not report the key already filed'
    },
  },
  {
    name: 'evidence is classed, and a source line is checked at the commit the record names',
    run: () => {
      const classes = ['src/a.ext:12', 'src/a.ext', 'https://example.invalid/x', 'seen in a hex viewer'].map(classify).join()
      if (classes !== 'source-line,path,url,prose') return `classed as ${classes}`
      if (!checkSourceLine(base, null, 'src/a.ext:12').startsWith('UNCHECKED')) return 'a record with no commit was not reported unchecked'
      if (!hasGit) return 'skip'
      const { work, commit } = scratchRepository('evidence')
      if (!checkSourceLine(work, commit, 'src/three-lines.ext:3').startsWith('exists at')) return 'line 3 of a three-line file was not found'
      if (!checkSourceLine(work, commit, 'src/three-lines.ext:4').startsWith('MISSING')) return 'line 4 of a three-line file was found'
      if (!checkSourceLine(work, commit, 'src/no-such.ext:1').startsWith('MISSING')) return 'a file that is not at the commit was found'
      return checkSourceLine(work, '0'.repeat(40), 'src/three-lines.ext:1').startsWith('UNVERIFIABLE HERE') ? null : 'a commit that is not in the checkout was not reported unverifiable'
    },
  },
  {
    name: '--dry-run exits 0 over the fixtures and over zero records, with no tracker CLI and no git on PATH, and changes no byte',
    run: () => {
      // node is started by its absolute path, so PATH can be a directory that holds nothing at all.
      const nothingOnPath = join(base, 'empty-path')
      mkdirSync(nothingOnPath, { recursive: true })
      for (const [name, empty] of [['dry-fixtures', false], ['dry-empty', true]] as const) {
        const root = emitted(name, { empty })
        const before = snapshot(root)
        const run = spawnSync(process.execPath, [join(HERE, 'propose.ts'), '--dry-run'], {
          encoding: 'utf8',
          env: { PATH: nothingOnPath, OUTCOMES_ROOT: root },
        })
        if (run.status !== 0) return `${name}: exit ${String(run.status)}: ${run.stderr}`
        if (snapshot(root) !== before) return `${name}: the dry run changed the tree`
        if (!run.stdout.includes(empty ? 'holds no record yet' : 'WOULD FILE')) return `${name}: did not print what it would file: ${run.stdout}`
      }
      return null
    },
  },
]

runCases('outcomes selftest', cases)
