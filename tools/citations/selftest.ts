/**
 * `npm run citations:selftest` -- does the citation scanner still BITE?
 *
 * A resolution gate has one characteristic failure and it is not a false alarm: it is going quietly
 * green. Narrow the regex by a character, resolve a path one strategy too eagerly, or let the
 * section matcher accept any line at all, and `citations:check` prints the same reassuring summary
 * over a repository it is no longer checking. Nothing in the repository's own citations would say
 * so, because the gate passing IS the expected outcome.
 *
 * So this holds the scanner to synthetic fixtures where the answer is known: every failure it is
 * supposed to catch, and -- just as important -- every shape it must NOT report, because a gate that
 * cries wolf is deleted and then checks nothing at all. The repository-level assertion at the end is
 * the other half: the scan must still be finding citations to check.
 *
 * Needs no `../estate` checkout and no network.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/paths.ts'
import {
  MEMORY_EXEMPT_REGIONS,
  MEMORY_HISTORY,
  describeRegion,
  exemptRegionsIn,
  inMemoryScope,
  memoryHistoryReason,
  memoryProblemsIn,
} from './memory.ts'
import {
  QUOTED,
  HISTORY,
  citationsIn,
  headingsOf,
  historyReason,
  indexByName,
  isQuoted,
  isRetired,
  looksLikeSectionName,
  namesSection,
  resolveTarget,
  retiredWithoutPath,
  RETIRED_ROOTS,
  trackedFiles,
} from './scan.ts'

/**
 * The one element of `xs`, or a thrown error naming what was expected.
 *
 * A test helper rather than `xs[0]`, and the reason is worth recording: `tsc --noEmit` and
 * `@typescript-eslint/no-unnecessary-condition` disagree about whether an index or a `.find()` can
 * be undefined here, so every optional-chain spelling is rejected by one of the two. A length check
 * on a number is a condition neither disputes, and asserting exactly one is a stronger claim than
 * reading the first of several anyway.
 */
function only<T>(xs: readonly T[], what: string): T {
  if (xs.length !== 1) throw new Error(`expected exactly one ${what}, got ${xs.length}`)
  return xs[0] as T
}

let failures = 0
let checks = 0
const ok = (what: string, cond: boolean, detail = ''): void => {
  checks++
  if (cond) console.log(`  ok   ${what}`)
  else {
    failures++
    console.error(`  FAIL ${what}${detail ? ` -- ${detail}` : ''}`)
  }
}

console.log('citation scanner selftest\n')

/* --------------------------------------------------------------------------------------------- *
 * 1. What the line-citation regex must and must not see
 * --------------------------------------------------------------------------------------------- */

{
  const found = (text: string) => citationsIn('a/b.ts', text).filter((c) => c.kind === 'line')

  const one = only(found('see `foo.md:12` for the rule'), 'line citation')
  ok('a bare `<file>.md:NN` is a citation', one.target === 'foo.md' && one.first === 12)

  const ranged = only(found('`docs/foo.md:12-18` states it'), 'range citation')
  ok(
    'a range keeps both ends',
    ranged.first === 12 && ranged.last === 18,
    `got ${ranged.first}-${ranged.last}`,
  )

  ok(
    'a path with directories is kept whole',
    only(found('x `a/b/c.md:3`'), 'line citation').target === 'a/b/c.md',
  )

  // The continuation spelling `md:561, :583` names two lines. Only the first is matched, and that is
  // a documented floor -- but the `:583` must not be read as a citation to a file called `583`.
  ok('a `, :NN` continuation does not become a second citation', found('`a.md:5, :9`').length === 1)

  ok(
    'a line with no citation yields none',
    found('nothing here, just prose about foo.md').length === 0,
  )
}

/* --------------------------------------------------------------------------------------------- *
 * 2. Section citations, and the prose the scanner must decline to read as one
 * --------------------------------------------------------------------------------------------- */

{
  const sections = (text: string) => citationsIn('a/b.ts', text).filter((c) => c.kind === 'section')

  // The captured name runs on into the sentence; `namesSection` resolves it by prefix, so the
  // scanner's job here is only to capture the citation with its name at the front.
  const inv = only(sections('`foo.md` § INVARIANTS says so'), 'section citation')
  ok(
    '`§ Name` is a section citation',
    inv.target === 'foo.md' && inv.section.startsWith('INVARIANTS'),
    JSON.stringify(inv.section),
  )

  const quoted = only(
    sections('`foo.md` § "Location parity" is the authority.'),
    'section citation',
  )
  ok(
    'a quoted name ends at its closing quote',
    quoted.section === 'Location parity',
    JSON.stringify(quoted.section),
  )

  const withLine = only(sections('`foo.md` § INVARIANTS (line 7) requires it'), 'section citation')
  ok(
    "cite()'s own `(line N)` suffix is not part of the name",
    withLine.section === 'INVARIANTS',
    JSON.stringify(withLine.section),
  )

  // THE FALSE-ALARM GUARD. `§` is also used as a preposition mid-sentence. Asserting a heading
  // exists for `§ header, "Runtime" line` would invent a claim the author never made.
  ok(
    'a lowercase word after § is prose, not a section name',
    sections('`foo.md` § header, "Runtime" line').length === 0,
  )
  ok('capitalised names are section names', looksLikeSectionName('Measured state'))
  ok('numbered names are section names', looksLikeSectionName('5.3'))
  ok('lowercase names are not', !looksLikeSectionName('header'))
}

/* --------------------------------------------------------------------------------------------- *
 * 3. Section resolution -- including the two shapes this repository actually uses
 * --------------------------------------------------------------------------------------------- */

{
  const atx = ['# Title', '', '## 5. Validation', 'body', '### 5.1 The corpus counts', 'more']
  ok('an ATX heading is found by name', namesSection('Validation', atx))
  ok('a numbered section is found by its number', namesSection('5', atx))
  ok('a dotted number is found too', namesSection('5.1', atx))
  ok('a number that is only a prefix of another does not match', !namesSection('51', atx))
  ok(
    'prose running on past the name still resolves',
    namesSection('Validation is the rule here', atx),
  )
  ok('a name in no heading fails', !namesSection('Permissions', atx))

  // NOT ATX-ONLY. The prompt files mark sections with bare uppercase labels and have no `#` at all;
  // a matcher that understood only `#` would report every citation into them as dead.
  const bare = ['A preamble line', '', 'STALE WHEN', 'the threshold is 15%', '', 'CONFIDENCE', 'x']
  ok('a bare uppercase label is a section', namesSection('STALE WHEN', bare))
  ok('the document genuinely has no ATX headings', headingsOf(bare).length === 0)
  ok('a label that is not there still fails', !namesSection('DATABASE CHANGE POLICY', bare))

  // THE PATHOLOGICAL CASE, and the one that actually happened: `verify-layout.md` had zero headings
  // while five places cited a `§S-BASELINE` of it.
  ok(
    'no headings and no matching line is a failure',
    !namesSection('S-BASELINE', ['just prose', 'more prose']),
  )
}

/* --------------------------------------------------------------------------------------------- *
 * 4. Path resolution, in the order the repository writes paths
 * --------------------------------------------------------------------------------------------- */

{
  // SYNTHETIC paths, every one. Nothing here reads the real tree, so the names are chosen not to
  // look like files that exist: an earlier fixture spelled a real file's path, and a reader could
  // mistake the case for a claim about it.
  const tracked = new Set([
    'README.md',
    'docs/README.md',
    'docs/retired/fixture-overview.md',
    'reference/fixture-mirror/skill-tree/SKILL.md',
    '.claude/skills/bead/SKILL.md',
  ])
  const byName = indexByName([...tracked])
  const at = (from: string, target: string) => resolveTarget(from, target, tracked, byName)

  // ROOT FIRST. Reading `README.md` from `docs/` as `docs/README.md` reported a live pointer into
  // the root README as past the end of a 37-line file.
  const r = at('docs/some-plan.md', 'README.md')
  ok('a bare name resolves at the repository root first', 'path' in r && r.path === 'README.md')

  const s = at('docs/plans/Foo.md', 'fixture-overview.md')
  ok(
    'a basename resolves to the nearest file with that name',
    'path' in s && s.path === 'docs/retired/fixture-overview.md',
  )

  const k = at('reference/fixture-mirror/README.md', 'SKILL.md')
  ok(
    "an ambiguous basename resolves to the one in the citing file's own subtree",
    'path' in k && k.path === 'reference/fixture-mirror/skill-tree/SKILL.md',
    'path' in k ? k.path : k.error,
  )

  const repo = at('anywhere.md', `${ROOT.split(/[\\/]/).pop() as string}/docs/retired/fixture-overview.md`)
  ok(
    'a path over-qualified with the repository name still resolves',
    'path' in repo && repo.path === 'docs/retired/fixture-overview.md',
  )

  const gone = at('a.md', 'deleted-prompt.md')
  ok('a file that is not tracked is an error', 'error' in gone)

  const tied = at('elsewhere/x.md', 'SKILL.md')
  ok('a basename with no nearer candidate is reported ambiguous', 'error' in tied)
}

/* --------------------------------------------------------------------------------------------- *
 * 4b. A live file pointing at a retired one by its OLD name
 *
 * The hole this closes was found by review, and it is the one that would have mattered most: the
 * basename fallback resolves `verify-layout.md:96` to `docs/retired/verify-layout.md`, checks line
 * 96 of the retired copy, and reports the pointer healthy -- while a reader following the citation
 * as WRITTEN finds no such file. Papering over a dead pointer is the exact failure this gate exists
 * to catch, so resolution succeeding is not sufficient; the citation has to name where the file
 * actually is now.
 * --------------------------------------------------------------------------------------------- */

{
  ok(
    'a live file citing a retired file by its bare name is a finding',
    retiredWithoutPath(
      'tools/pipeline/digest.ts',
      'verify-layout.md',
      'docs/retired/verify-layout.md',
    ),
  )
  ok(
    'the same citation is fine once it spells the retired path',
    !retiredWithoutPath(
      'tools/pipeline/digest.ts',
      'docs/retired/verify-layout.md',
      'docs/retired/verify-layout.md',
    ),
  )
  ok(
    'history/ counts as retired too',
    retiredWithoutPath('claude-code-prompts.md', 'throughput.md', 'history/throughput.md'),
  )
  ok(
    'a retired file citing its own neighbour is history, not a finding',
    !retiredWithoutPath('docs/retired/a.md', 'b.md', 'docs/retired/b.md'),
  )
  ok(
    'a live file citing a live file is untouched by this rule',
    !retiredWithoutPath('tools/x.ts', 'portfolio-model.md', 'portfolio-model.md'),
  )
  // Not `RETIRED_ROOTS.length === 2` -- `as const` makes that statically true, so it asserts
  // nothing. Exercise the predicate instead: every declared root must actually be recognised.
  ok(
    'every declared retired root is recognised by isRetired',
    RETIRED_ROOTS.every((r) => isRetired(`${r}anything.md`)),
  )
  ok('a live path is not', !isRetired('tools/pipeline/digest.ts'))
}

/* --------------------------------------------------------------------------------------------- *
 * 5. The exemptions are exemptions, not holes
 * --------------------------------------------------------------------------------------------- */

{
  ok('a history directory is exempt', historyReason('docs/retired/verify-layout.md') !== null)
  ok('a live file is not', historyReason('tools/journey/model.ts') === null)

  // A DELIVERED-HANDOFF-PACKAGE EXEMPTION was asserted here on both sides, and D-30 removed it with
  // the packages. `tools/citations/scan.ts` keeps the argument for why it existed, because the SHAPE
  // recurs the next time a node copies documents under new paths: committing slice 004's package
  // broke five long-standing citations elsewhere in the tree -- none of them touched -- because ~60
  // copies landed under new paths and made `legacy-visual-spec.md` and `api-surface-report.md`
  // ambiguous basenames.
  //
  // WHAT SURVIVES IT is the property that made the fix possible, and it is not about packages at all:
  // an AMBIGUOUS bare basename must be refused rather than guessed, while a fully-spelled path
  // resolves. That is `resolveTarget`'s own rule and it is what a future exemption would lean on, so
  // it is asserted here directly instead of through a filter with nothing left to filter.
  {
    // Synthetic paths (see § 4): two copies of one basename under directories that need not exist,
    // NEITHER of which shares a leading segment with the citing file -- the nearest-wins rule in
    // `resolveTarget` would otherwise pick the copy under the citer's own directory, and this case
    // is about the tie it refuses to break.
    const tracked = new Set([
      'artifacts/design-system/legacy-visual-spec.md',
      'reference/copies/legacy-visual-spec.md',
    ])
    const byName = indexByName([...tracked])
    const ambiguous = resolveTarget(
      'docs/decisions.md',
      'legacy-visual-spec.md',
      tracked,
      byName,
    )
    ok(
      'a bare basename matching two tracked files is refused, not guessed',
      'error' in ambiguous,
      'error' in ambiguous ? ambiguous.error : ambiguous.path,
    )
    const full = resolveTarget(
      'docs/x.md',
      'reference/copies/legacy-visual-spec.md',
      tracked,
      byName,
    )
    ok(
      'but a fully-spelled path still resolves',
      'path' in full && full.path === 'reference/copies/legacy-visual-spec.md',
      'path' in full ? full.path : full.error,
    )
  }
  ok(
    'every HISTORY entry states a reason',
    HISTORY.every((h) => h.why.trim().length > 20),
  )
  ok(
    'every QUOTED entry states a reason',
    QUOTED.every((q) => q.why.trim().length > 20),
  )

  const q = QUOTED[0] as { from: string; cites: string }
  ok('a registered quotation is exempt in its own file', isQuoted(q.from, q.cites) !== null)
  ok('the same quotation elsewhere is NOT exempt', isQuoted('some/other/file.ts', q.cites) === null)
  ok('a different citation in that file is not exempt', isQuoted(q.from, 'unrelated.md:1') === null)
}

/* --------------------------------------------------------------------------------------------- *
 * 6. The scan still has subjects
 *
 * Every assertion above runs on fixtures, so all of them pass over an empty repository. This is what
 * says the gate is pointed at something: if a regex change silently stopped matching, the check
 * would go green and only this would notice.
 * --------------------------------------------------------------------------------------------- */

{
  const tracked = trackedFiles()
  ok('the repository has tracked files to scan', tracked.length > 100, `${tracked.length} files`)

  let lines = 0
  let sections = 0
  for (const f of tracked) {
    if (!f.endsWith('.ts') && !f.endsWith('.md')) continue
    if (historyReason(f)) continue
    let text: string
    try {
      text = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const c of citationsIn(f, text)) {
      if (c.kind === 'line') lines++
      else sections++
    }
  }
  // The floors are "more than a handful", not a count of the estate. The line-citation floor read
  // `> 50` until D-33 deleted the slice specs, prompts and admissions that carried most of the
  // repository's `<file>.md:NN` pointers, and the count has only fallen since. The current figure is whatever
  // `npm run citations:check` prints today and is deliberately not written here, where it would
  // drift like every other numeral. A floor a legitimate deletion can cross is a gate that fails
  // for a reason no commit repairs, so it sits well below the measured value while still refusing
  // an empty scan.
  ok('the scan finds line citations to resolve', lines > 20, `${lines} found`)
  ok('the scan finds section citations to resolve', sections > 50, `${sections} found`)
}

/* --------------------------------------------------------------------------------------------- *
 * 7. The memory rule: a citation whose target cannot exist
 *
 * `tools/citations/memory.ts` carries the argument. Every assertion here goes through
 * `memoryProblemsIn`, the one function `check.ts` calls, so a fixture that fails here fails the
 * gate and one that passes here passes it. The DERIVATION is asserted, never a count of the live
 * tree: how many mentions CLAUDE.md's two regions exempt today is whatever `citations:check`
 * prints, and written here it would drift like every other numeral.
 * --------------------------------------------------------------------------------------------- */

{
  const prompt = '.claude/skills/fixture/SKILL.md'
  const problemsIn = (file: string, text: string) => memoryProblemsIn(file, text).problems

  // The spelling the 2026-09-11 reviews record for every key they name, and the three tokens.
  const key = only(
    problemsIn(prompt, 'see memory `register-no-foreign-short-shas` for the remedy'),
    'problem',
  )
  ok(
    '`memory `key`` in a prompt is a finding at its line',
    key.where === `${prompt}:1` && key.what.includes('register-no-foreign-short-shas'),
    `${key.where} -- ${key.what}`,
  )
  ok(
    'the word is matched case-insensitively',
    problemsIn(prompt, 'Memory `x-y` says so').length === 1,
  )
  const wrapped = only(
    problemsIn(prompt, 'the direction gotcha (memory\n  `bd-deps-blocks-direction`).'),
    'problem',
  )
  ok(
    'the line-wrapped spelling is one finding, reported at the line the word is on',
    wrapped.where === `${prompt}:1` && wrapped.context.includes('`bd-deps-blocks-direction`'),
    `${wrapped.where} -- ${wrapped.context}`,
  )
  ok(
    'a paragraph break between the word and the span is prose',
    problemsIn(prompt, 'stays in memory\n\n`bd dolt push` closes the bracket').length === 0,
  )
  for (const token of ['bd recall', 'bd remember', 'bd memories']) {
    ok(
      `\`${token}\` is a finding, backticked`,
      problemsIn(prompt, `run \`${token} <key>\` first`).length === 1,
    )
    ok(`\`${token}\` is a finding, bare`, problemsIn(prompt, `then ${token} it`).length === 1)
  }
  ok(
    'two shapes on one line are two findings',
    problemsIn(prompt, 'memory `k` via `bd recall k`').length === 2,
  )
  ok(
    'a negation does not exempt a line by itself',
    problemsIn(prompt, 'never in `bd remember` and never in a memory file').length === 1,
  )

  // THE FALSE-ALARM GUARD: a gate that cries wolf is deleted and then checks nothing.
  ok(
    'the auto-memory directory path is not a key',
    problemsIn(prompt, 'the per-project `memory/` directory the harness keeps').length === 0,
  )
  ok(
    'a hyphenated compound before a code span is not a key',
    problemsIn(prompt, 'rebuilt in-memory `index.json` and byte-compared').length === 0,
  )
  ok(
    '`memory` followed by prose is not a key',
    problemsIn(prompt, 'measured timings stay in memory. The skill is a checklist').length === 0,
  )
  ok(
    '`bd` commands that are not the store are untouched',
    problemsIn(prompt, 'run `bd ready`, `bd show <id>` and `bd dolt push`').length === 0,
  )
  ok(
    '`memories` without `bd` is prose',
    problemsIn(prompt, 'loads the issue tracker context and stored project memories').length === 0,
  )

  // SCOPE: the roster, and nothing outside it.
  for (const f of [
    '.claude/agents/fixture.md',
    '.claude/settings.json',
    'dry-run/skills/fixture/SKILL.md',
    'dry-run/skills/fixture/tools/Fixture.ps1',
    '.beads/formulas/fixture.formula.toml',
    'CLAUDE.md',
    'README.md',
  ]) {
    ok(`${f} is in scope`, inMemoryScope(f))
  }
  const outside = memoryProblemsIn('tools/citations/memory.ts', 'bd recall')
  ok(
    'a file outside the roster is skipped with the reason, not scanned',
    outside.skipped !== null && outside.problems.length === 0,
    outside.skipped ?? 'scanned',
  )
  ok('`docs/` is outside the roster', !inMemoryScope('docs/decisions.md'))

  // EXEMPT AS HISTORY: the same line, in a prompt review, passes with the reason stated.
  const line = 'Fixed by one sentence pointing at memory `sibling-repo-runs-from-worktree-session`.'
  ok('the fixture line fails in a prompt', problemsIn(prompt, line).length === 1)
  const reviewPath = 'docs/prompt-reviews/fixture.2026-01-01.md'
  const review = memoryProblemsIn(reviewPath, line)
  ok(
    'the same line in docs/prompt-reviews/ passes as history, with its reason',
    review.problems.length === 0 &&
      review.skipped !== null &&
      review.skipped === memoryHistoryReason(reviewPath),
    review.skipped ?? 'scanned',
  )
  ok(
    'every MEMORY_HISTORY entry states a reason',
    MEMORY_HISTORY.every((h) => h.why.trim().length > 20),
  )
  ok(
    'every exempt region states a reason and names CLAUDE.md',
    MEMORY_EXEMPT_REGIONS.every((r) => r.why.trim().length > 20 && r.file === 'CLAUDE.md'),
  )

  // THE TWO CLAUDE.md REGIONS, on a fixture shaped like the file: the forbidding section runs from
  // its heading to the next heading; the generated block runs between bd's markers; a mention after
  // both is live. Four mentions inside, one outside.
  const claude = [
    '## Some earlier section',
    'prose',
    '## Rules for agents live in tracked files, and nowhere else',
    '- **`bd remember` is not used.** `bd memories` prints an empty list.',
    '  do not tell a reader to `bd recall` one.',
    '<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:deadbeef -->',
    '## Beads Issue Tracker',
    '- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files',
    '<!-- END BEADS INTEGRATION -->',
    '## After the block',
    'see memory `late-key` here',
  ]
  const shaped = memoryProblemsIn('CLAUDE.md', claude.join('\n'))
  ok(
    'mentions inside the forbidding section and the generated block are exempt',
    shaped.exempted === 4,
    `${shaped.exempted} exempt`,
  )
  const late = only(shaped.problems, 'problem')
  ok('a mention after both regions is a finding', late.where === 'CLAUDE.md:11', late.where)

  // The exemption is keyed on the FILE as well as the delimiter: the heading cannot be copied.
  ok(
    'the same heading and markers in a skill exempt nothing',
    problemsIn(prompt, claude.join('\n')).length === 5,
    `${problemsIn(prompt, claude.join('\n')).length} problems`,
  )

  // A registered region that is not in the file is a FINDING, not a silent pass: the renamed
  // heading is reported, the absent markers are reported, and the mention the section covered goes
  // live -- three problems from one line of prose.
  const renamed = memoryProblemsIn(
    'CLAUDE.md',
    ['## Rules for agents live somewhere else', '`bd remember` is not used.'].join('\n'),
  )
  ok(
    'a renamed heading is reported as a missing region and its mention goes live',
    renamed.problems.length === 3 &&
      renamed.problems.filter((p) => p.what.includes('no such region')).length === 2,
    renamed.problems.map((p) => p.where).join(', '),
  )

  // THE LIVE TREE. Both registered regions are present in CLAUDE.md -- an exemption matching
  // nothing is a hole -- and the roster is clean.
  const liveClaude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
  const regions = exemptRegionsIn('CLAUDE.md', liveClaude.split('\n'))
  ok(
    'both registered regions are found in the live CLAUDE.md',
    regions.missing.length === 0 && regions.found.length === MEMORY_EXEMPT_REGIONS.length,
    regions.missing.map(describeRegion).join('; '),
  )
  const live = memoryProblemsIn('CLAUDE.md', liveClaude)
  ok(
    'the live CLAUDE.md passes, with its mentions exempted rather than absent',
    live.problems.length === 0 && live.exempted > 0,
    live.problems.map((p) => p.where).join(', '),
  )
  let scanned = 0
  const liveProblems: string[] = []
  for (const f of trackedFiles()) {
    if (!inMemoryScope(f)) continue
    let text: string
    try {
      text = readFileSync(join(ROOT, f), 'utf8')
    } catch {
      continue
    }
    const s = memoryProblemsIn(f, text)
    if (s.skipped === null) scanned++
    liveProblems.push(...s.problems.map((p) => p.where))
  }
  ok('the roster has prompt files to scan', scanned > 10, `${scanned} files`)
  ok(
    'no tracked prompt cites a memory key or names the store',
    liveProblems.length === 0,
    liveProblems.join(', '),
  )
}

console.log(
  failures ? `\n${failures} of ${checks} assertions FAILED` : `\n${checks} assertions pass`,
)
process.exit(failures ? 1 : 0)
