/**
 * Cross-document citations, resolved against the documents they name.
 *
 * WHAT THIS IS FOR. A citation written as `some-file.md:96` is a fact about another file that
 * nothing recomputes when that file changes. It rots silently and in the worst possible direction:
 * the pointer still LOOKS authoritative, so a reader who follows it and lands on unrelated prose
 * concludes they have misunderstood, not that the citation is wrong. The same is true of a citation
 * to a SECTION that does not exist.
 *
 * Both have bitten repeatedly, which is why this exists rather than a convention:
 *
 *   - `verify-layout.md:96`, cited by `tools/formhost/types.ts` and `tools/FormHostCapture/README.md`
 *     as the source of the capture-conditions set, resolved to a Playwright line. The text was at
 *     `:144`. `verify-layout.md:203`, cited by `claude-code-prompts.md`, resolved to a BLANK line;
 *     the text was at `:76`.
 *   - That same file had ZERO markdown headings while FIVE places cited a `§S-BASELINE` section of
 *     it. The anchor had never existed at any point in the file's life.
 *   - Roughly twenty `portfolio-model.md:NN` citations drifted twice; by the time a tracked issue was
 *     worked, 17 of the 18 distinct ones resolved to unrelated prose -- a horizontal rule, a blank
 *     line, the header row of the wrong table.
 *
 * THIS IS THE FLOOR, NOT THE CEILING. `tools/portfolio/model-citations.ts` is the strong form: a
 * citation is a registered key whose value is a distinctive PHRASE, so `cite()` recomputes the line
 * on every run and the passage is checked by content. That is better and should keep spreading. But
 * it only covers citations that have adopted it, and the estate holds hundreds that have not. This
 * takes citations exactly as they are WRITTEN, anywhere in the repository, and asserts the cheap
 * thing: that a reader following the pointer arrives somewhere real.
 *
 * So the two are complements, and the division is deliberate:
 *
 *   - adopted citation  -> `model-citations.ts`, checked by CONTENT, cannot drift at all
 *   - unadopted citation -> here, checked by RESOLUTION, catches the pointer that now lands on
 *     nothing, on a line past the end of the file, on a blank, or on a file that has since been
 *     RETIRED out from under its old name
 *
 * That last one was added after review, and it is the case where resolving too helpfully would have
 * been worse than not checking: retirement moves a file without rewriting the pointers into it, so
 * the basename fallback below finds the retired copy, checks the line inside it, and reports a
 * citation healthy that a reader following it as written cannot follow at all. See `RETIRED_ROOTS`.
 *
 * WHY IT SCANS EVERYTHING BY DEFAULT. `model-citations.selftest.ts` scans an allowlist of two
 * directories, and the history of that decision is the argument against copying it: its first
 * version covered ONE document, which left every citation into a sibling prompt exactly as exposed
 * as before -- and three had already drifted, one of them into a SHIPPED artifact, because no gate
 * could see them. An allowlist does not grow when the repository does. This scans every tracked text
 * file and takes exemptions one at a time, so a new citation is covered the day it is written and
 * every exemption is a line in a diff with a reason attached.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK.
 *
 *   - QUOTATIONS. A retest log quotes stale citations on purpose, and
 *     `docs/retired/` records what a retired document said (the correction log frozen there since
 *     a later decision records what a correction SAID at the time). CLAUDE.md exempts quotations from the count index for exactly
 *     this reason, and the same logic applies here: a gate that fails on the record of a past defect
 *     is a gate nobody can make green, so it gets deleted and checks nothing. See `HISTORY`.
 *   - WHETHER THE CITED LINE SAYS WHAT THE CITER CLAIMS. That needs a phrase, which is what
 *     `model-citations.ts` is. Resolution is the half that can be checked without one.
 *   - NUMERALS restated from another document. A prompt that repeats a corpus count it did not
 *     derive is a real and more expensive defect, but it needs a policy about prompt-embedded
 *     numerals rather than a scanner. Tracked separately.
 *   - BARE FILENAME MENTIONS -- a backticked `X.md` carrying no `:NN` and no `§`. `LINE_RE` and
 *     `SECTION_RE` below both require a locator, so a bare name is outside the definition of a
 *     citation used here. **That was measured and refused, not overlooked: see a later decision.** A tracked
 *     issue walked every one of them. A blanket rule produces 327 findings, of which the large
 *     majority are correct writing: shorthand for a path the document states once, deliberate
 *     mentions of files a later decision deleted (where the mention IS the record), and per-slice deliverables
 *     that `tools/pipeline/check.ts:139` already tolerates as "no slice is admitted yet". The
 *     narrow version -- a live file naming a RETIRED file by bare basename must spell the
 *     `docs/retired/` path -- flags 11, of which 10 are correct; one of those 10 is a frozen grep
 *     result its own document declares literal, so the rule would demand falsifying evidence.
 *     **Do not add either rule here.** The residue is real but semantic -- a bare name is a defect
 *     only when the passage presents the file as extant -- so a later decision makes it a review habit and
 *     names the one mechanical shape worth fixing on sight: a source attribution, "per `X.md`",
 *     with no locator.
 *
 * Reads only this repository, needs no `../estate` checkout and no network.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ROOT } from '../lib/paths.ts'

/** Text files worth scanning. Anything else is either binary or has no citations in it. */
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|md|json|ya?ml|cs|sql)$/

/**
 * Where a RETIRED document lives once it stops being the live one.
 *
 * Two directions, and only one of them is history:
 *
 *   - a citation written INSIDE one of these is history, and is exempt (see `HISTORY` below);
 *   - a citation FROM a live file INTO one of these is a FINDING, unless it spells the path.
 *
 * The second half is what `retiredWithoutPath` exists for, and it is not a nicety. Retirement moves
 * a file; it does not rewrite the pointers into it. A live comment that still says
 * `verify-layout.md:96` names a file that is no longer at the root, and a reader who follows it as
 * written arrives nowhere -- which is the whole defect this gate is for. The basename fallback in
 * `resolveTarget` would otherwise paper over exactly that: it finds the only file with that name,
 * which is the retired copy, checks line 96 of it, and reports the pointer healthy.
 *
 * Spelling `docs/retired/verify-layout.md:96` is fine and stays fine. That citation is honest about
 * where it points, which is all this asks for.
 */
export const RETIRED_ROOTS = ['docs/retired/', 'history/'] as const

/** Whether `path` is a retired or historical document. */
export const isRetired = (path: string): boolean => RETIRED_ROOTS.some((r) => path.startsWith(r))

/**
 * A live file citing a retired one WITHOUT naming the `docs/retired/` or `history/` path it now
 * lives under. The citation reads as a pointer to a file that is not there any more.
 */
export function retiredWithoutPath(from: string, target: string, resolved: string): boolean {
  if (!isRetired(resolved)) return false
  if (isRetired(from)) return false
  return !isRetired(target)
}

/**
 * Files whose `<file>.md:NN` and `§<Name>` occurrences are HISTORY, not live pointers.
 *
 * Every entry is a path or a path prefix, and every entry states why. The bar is that the document's
 * PURPOSE is to record what something said at a moment in time -- not merely that it happens to
 * contain a stale citation, which is the thing this gate exists to make someone fix.
 *
 * Keep this short. An entry here is a hole in the gate, and the failure mode of a generous exemption
 * list is a green check over a repository nobody is actually checking.
 */
export const HISTORY: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: 'docs/retired/',
    why:
      'A retired document and its retirement note record what the document SAID. Its citations' +
      ' are frozen with it -- repointing them would be editing the historical record rather than' +
      ' fixing a pointer anyone follows.',
  },
  {
    path: 'history/',
    why:
      'A history directory, whose whole purpose is holding what live documents used to say --' +
      ' superseded figures, withdrawn citations. Its citations quote superseded readings, and' +
      ' several name files that were deleted with the thing being recorded.',
  },
  {
    path: 'tools/citations/',
    why: 'This gate and its selftest. Both quote the citations they exist to catch.',
  },
  // ADD YOUR OWN ENTRIES HERE, one at a time, each with its reason: a retest log that quotes the
  // defective citations it records, the working behind a decision whose subject was deleted, an
  // inbound record whose citations are a correspondent's. REMOVE an entry with its subject: an
  // entry matching nothing is a hole dressed as an exemption.
]

/**
 * Single citations, inside otherwise-live files, that are QUOTATIONS of a dead pointer.
 *
 * The whole-file exemptions above are for documents whose PURPOSE is to record the past. This is for
 * the other shape: a live document that quotes one dead citation as the evidence for a decision.
 * Repointing it would erase the finding, and exempting the whole file would take its live
 * citations out of the gate along with it. Remove an entry with its citation: an entry matching
 * nothing is the hole dressed as an exemption the comments above describe.
 *
 * KEYED BY THE CITATION TEXT, NEVER BY LINE NUMBER. An allowlist of `file.md:112` entries would be a
 * list of line numbers that nothing recomputes, which is the exact disease this gate treats; the
 * suppressions would slide off their citations the first time someone edited above them and start
 * silently exempting whatever moved into their place. The pair (citing file, citation as written) is
 * stable under every edit that does not change the citation itself.
 */
export const QUOTED: ReadonlyArray<{ from: string; cites: string; why: string }> = [
  {
    from: 'scripts/hooks/_shared.mjs',
    cites: 'generate-screen.md:15',
    why:
      'A hook comment explaining a heuristic by the case that defeated it. The prompt it names was' +
      ' retired with its generator; the example is why the code is shaped as it is.',
  },
  // ADD YOUR OWN ENTRIES HERE, keyed by (citing file, citation as written) and never by line
  // number: a register entry quoting a file a later decision deleted, a frozen record citing a
  // regenerated artifact by line, a prompt naming a file its own node has not emitted yet. A
  // register entry is amended by a dated note and never rewritten, so its citation stays literal.
]

/**
 * Whether this citation, in this file, is a registered quotation.
 *
 * By PREFIX on the citation text, because a section name written inline runs on into the sentence
 * around it -- `` `fidelity-findings.md` §4 both claimed the client-area diff... `` is one citation
 * whose captured name is the whole rest of the clause. Requiring an exact match would mean writing
 * that clause into the registry and re-writing it whenever the prose was edited, which is a line
 * number by another name.
 */
export function isQuoted(from: string, cites: string): string | null {
  for (const q of QUOTED) if (q.from === from && cites.startsWith(q.cites)) return q.why
  return null
}

/** A `<file>.md:NN` or `<file>.md:NN-MM` pointer, as written. */
export interface LineCitation {
  kind: 'line'
  /** Repository-relative path of the file the citation is written in. */
  from: string
  /** 1-based line of `from` the citation sits on. */
  at: number
  /** The path as written, e.g. `journey-plane.md` or `specs/screens/Foo.md`. */
  target: string
  first: number
  last: number
  /** The whole source line, for the failure message. */
  context: string
}

/** A `` `<file>.md` § <Name> `` pointer, as written. */
export interface SectionCitation {
  kind: 'section'
  from: string
  at: number
  target: string
  /** The section name as written, with quotes/emphasis stripped. */
  section: string
  context: string
}

export type Citation = LineCitation | SectionCitation

/**
 * `foo.md:12`, `docs/foo.md:12-18`.
 *
 * The path may not start with `-` or `/`, so a range's second half (`:583` in `md:561, :583`) is not
 * mistaken for a new citation. Continuation spellings like that are NOT matched, and that is a known
 * floor rather than an oversight: catching them needs the parser this file's header declines to be.
 */
const LINE_RE = /([A-Za-z0-9._][A-Za-z0-9._/-]*\.md):(\d+)(?:-(\d+))?/g

/**
 * `` `foo.md` § Name ``, with an optional `"`, `*` or `` ` `` wrapper around the name.
 *
 * The name is taken up to the first delimiter that cannot appear in a heading being NAMED inline
 * (comma, semicolon, closing bracket, backtick, newline). Prose regularly runs straight on past the
 * heading -- "§ Measurement gives the failure condition for this node" -- which is why the resolver
 * below matches by PREFIX rather than requiring the captured text to be the whole heading.
 */
const SECTION_RE = /`([A-Za-z0-9._][A-Za-z0-9._/-]*\.md)`[^\S\n]*§[^\S\n]*([^`\n,;)|]{2,80})/g

/** Every git-tracked path, repository-relative. */
export function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\0')
    .filter(Boolean)
}

/** Whether `file` is exempt, and the reason if so. */
export function historyReason(file: string): string | null {
  for (const h of HISTORY) {
    if (file === h.path || file.startsWith(h.path)) return h.why
  }
  return null
}

/**
 * The file a citation names, repository-relative, or a reason it cannot be resolved.
 *
 * Three strategies, in order. Most citations are written relative to the repository root, but plenty
 * are written relative to the citing file's own directory, and a third group names only a BASENAME
 * (`SKILL.md:78` from inside a mirror's README, describing a mirrored tree one directory down -- the
 * shape the `reference/` skill mirror's README had until a later decision deleted that mirror; the selftest
 * keeps the case on synthetic paths). The basename strategy demands a UNIQUE match: two files with the same name make the
 * citation genuinely ambiguous, and guessing which was meant is how a checker starts asserting the
 * wrong thing confidently.
 */
export function resolveTarget(
  from: string,
  target: string,
  tracked: ReadonlySet<string>,
  byName: ReadonlyMap<string, string[]>,
): { path: string } | { error: string } {
  // REPOSITORY-ROOT FIRST, because that is this repository's convention -- CLAUDE.md writes every
  // path from the root, and so does almost every citation. Trying the citing file's own directory
  // first read `README.md:368` in `docs/some-plan.md` as `docs/README.md`, which is 37
  // lines long, and reported a live pointer into the 440-line root README as past the end of a file.
  const atRoot = normalise(stripRepoPrefix(target))
  if (tracked.has(atRoot)) return { path: atRoot }
  const beside = normalise(join(dirname(from), target))
  if (tracked.has(beside)) return { path: beside }

  const suffix = byName.get(target.split('/').pop() as string) ?? []
  const ending = suffix.filter((p) => p === target || p.endsWith(`/${target}`))
  if (ending.length === 1) return { path: ending[0] as string }
  if (ending.length > 1) {
    // NEAREST WINS. `SKILL.md` was the name of five tracked files when this was written, four of
    // them Claude Code skills; cited from inside the `reference/` skill mirror's README (deleted by
    // a later decision) it unambiguously meant the one in the mirrored tree beside it. Preferring the deepest shared
    // prefix with the citing file is how a human reads a bare filename, and without it every common
    // basename is reported ambiguous forever.
    const nearest = ending
      .map((p) => ({ p, shared: sharedPrefixLength(from, p) }))
      .sort((a, b) => b.shared - a.shared)
    const best = nearest[0] as { p: string; shared: number }
    const tied = nearest.filter((n) => n.shared === best.shared)
    if (tied.length === 1 && best.shared > 0) return { path: best.p }
    return {
      error:
        `names "${target}", which matches ${ending.length} tracked files (${ending.join(', ')}) and` +
        ' none of them is nearer to this file than the others. Write enough of the path to pick' +
        ' one -- an ambiguous citation cannot be followed.',
    }
  }
  return {
    error:
      `names "${target}", which is not a tracked file. It was moved, retired or never existed,` +
      ' and a reader following this pointer arrives nowhere.',
  }
}

const normalise = (p: string): string =>
  resolve(ROOT, p)
    .slice(ROOT.length + 1)
    .split('\\')
    .join('/')

/**
 * `<this-checkout>/docs/foo.md` -> `docs/foo.md`: the prefix is the name of the checkout's
 * own directory, read from `ROOT` rather than written here.
 *
 * A handful of citations name the repository directory as well as the path inside it, usually
 * written by someone working across both checkouts at once. It resolves to the same file either way,
 * and reporting it as a dead reference would be false.
 */
const REPO_PREFIX = `${ROOT.split(/[\\/]/).pop() as string}/`
const stripRepoPrefix = (p: string): string =>
  p.startsWith(REPO_PREFIX) ? p.slice(REPO_PREFIX.length) : p

/** How many leading path SEGMENTS two repository-relative paths share. */
function sharedPrefixLength(a: string, b: string): number {
  const x = a.split('/')
  const y = b.split('/')
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

/**
 * AN `isDeliveredPackage(file)` PREDICATE STOOD HERE, matching `artifacts/slices/<id>/handoff/**`,
 * and a later decision deleted it with the packages. The argument is kept because the SHAPE will recur the next
 * time this repository copies documents under new paths.
 *
 * It excluded a delivered handoff package from this gate on BOTH sides, for two different reasons.
 * AS A CITING FILE: most of a package's `.md` files were byte-identical copies of documents living
 * elsewhere, so their citations were already checked at the source, and the prompt forbade editing a
 * path inside a copy -- a gate whose only available fix is forbidden is a gate nobody can make green.
 * AS A CITATION TARGET, which is the half that actually broke: `resolveTarget` falls back to a bare
 * BASENAME and demands a unique match, so the moment slice 004's ~60-file package was committed,
 * `legacy-visual-spec.md` and `api-surface-report.md` each matched two tracked files and five
 * long-standing citations elsewhere became ambiguous -- none of them touched.
 *
 * IF A FUTURE NODE COPIES DOCUMENTS UNDER NEW PATHS, that second failure returns on the day the copy
 * lands, and the fix is this predicate again: filter the BASENAME INDEX and never `trackedSet`, so a
 * citation spelling the copy's path out in full still resolves while a bare basename cannot silently
 * reach it. Recover the original from `git show <a later decision>^:tools/citations/scan.ts`.
 */

/** Index of basename -> every tracked path with that basename. */
export function indexByName(tracked: readonly string[]): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const p of tracked) {
    const base = p.split('/').pop() as string
    const bucket = byName.get(base)
    if (bucket) bucket.push(p)
    else byName.set(base, [p])
  }
  return byName
}

/** Every citation written in `text`, which is the content of `from`. */
export function citationsIn(from: string, text: string): Citation[] {
  const out: Citation[] = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(LINE_RE)) {
      const first = Number(m[2])
      out.push({
        kind: 'line',
        from,
        at: i + 1,
        target: m[1] as string,
        first,
        last: m[3] ? Number(m[3]) : first,
        context: line.trim(),
      })
    }
    for (const m of line.matchAll(SECTION_RE)) {
      const section = stripWrapper((m[2] as string).trim())
      if (section && looksLikeSectionName(section)) {
        out.push({
          kind: 'section',
          from,
          at: i + 1,
          target: m[1] as string,
          section,
          context: line.trim(),
        })
      }
    }
  })
  return out
}

/**
 * `"Measured state"` -> `Measured state`; `*S-BASELINE*` -> `S-BASELINE`.
 *
 * The trailing `(line 32)` is stripped because that is `cite()`'s OWN render format -- it appends a
 * recomputed line number to a section reference. Reading it back as part of the section name would
 * make this gate fail on the output of the mechanism it is the floor under, which is the one result
 * that would be actively worse than not checking.
 */
function stripWrapper(s: string): string {
  // A QUOTED name ENDS AT ITS CLOSING QUOTE. `§ "Location parity per file" is the authoritative
  // table.` names a section called "Location parity per file"; reading the trailing sentence as part
  // of the name is how a correct citation gets reported as a dead one. Same for `*emphasis*`.
  const quoted = /^(["'])(.+?)\1/.exec(s) ?? /^\*+([^*]+)\*+/.exec(s)
  if (quoted) return (quoted[2] ?? quoted[1] ?? '').trim()

  const withoutLine = s.replace(/\s*\((?:line|lines)\s+\d+(?:[-–]\d+)?\)?\s*$/i, '').trim()
  const m = /^["'*_]+(.+?)["'*_]+$/.exec(withoutLine)
  return (m ? (m[1] as string) : withoutLine).replace(/^["'*_]+/, '').trim()
}

/** Markdown ATX headings of a document, as their text. */
export function headingsOf(lines: readonly string[]): string[] {
  return lines
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/[*_`"]/g, '')
        .trim(),
    )
}

/** A line reduced to the text a section name would be written as. */
const bare = (l: string): string =>
  l
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/[*_`"]/g, '')
    .trim()
    .toLowerCase()

/**
 * Whether any section of `lines` is named by `section`.
 *
 * NOT ATX-ONLY, and that matters here more than it would in most repositories: the prompt files use
 * bare uppercase labels as section markers. `archetype-classification.md` has no `#` heading in it
 * anywhere and its sections are lines reading `STALE WHEN` and `CONFIDENCE`; `DATABASE CHANGE
 * POLICY` in a second prompt is the same. A checker that recognised only `#` would
 * report every citation into those files as a dead section, which is a gate nobody could make green.
 * So a section is any line that BEGINS with the name -- heading or not.
 *
 * By PREFIX on the name, too, because prose runs straight on past the heading it names: "§
 * Measurement gives the failure condition for this node" cites a section called "Measurement".
 * Successive trailing words are dropped until something matches, so the assertion is the honest one:
 * does ANY leading part of what was written name a real section? A citation whose very first word
 * begins no line of the file is what this fails on, and that is the case that has actually bitten.
 *
 * The direction of the remaining error is deliberate. Matching any line, not just headings, lets a
 * table row or a body sentence satisfy a citation it was not meant to. That is a false PASS, and for
 * a floor gate a false pass costs a defect this run while a false FAIL costs the gate itself.
 */
export function namesSection(section: string, lines: readonly string[]): boolean {
  const candidates = lines.map(bare).filter(Boolean)
  // An ATX heading matches by CONTAINMENT, not prefix. Headings here regularly carry a part or node
  // qualifier ahead of the name a citation uses -- `## PART 5 — a node` is cited as `§ a node` --
  // and requiring the citation to reproduce the whole heading would fail every one of them.
  const headings = headingsOf(lines).map((h) => h.toLowerCase())
  const words = section
    .replace(/[*_`"]/g, '')
    .split(/\s+/)
    .filter(Boolean)

  // NUMBERED SECTIONS FIRST. `§5`, `§3.2`, `§5.3` and `§3.2/§3.5` name headings written `## 5. The
  // models in play` and `### 3.2 Three names in the brief`. The number alone is one character, so
  // the word-prefix loop below skips it as too short to be distinctive -- which it is as free text
  // and is not as a section number. Anchored to the number followed by a boundary so that `§5` does
  // not satisfy itself against `## 51.`.
  const numbered = /^(\d+(?:\.\d+)*)/.exec(words[0] ?? '')
  if (numbered) {
    const num = numbered[1] as string
    if (candidates.some((c) => new RegExp(`^${num.replace(/\./g, '\\.')}([.)\\s]|$)`).test(c))) {
      return true
    }
  }

  for (let n = words.length; n > 0; n--) {
    const probe = words
      .slice(0, n)
      .join(' ')
      .replace(/[.,;:)\]]+$/, '')
      .toLowerCase()
    if (probe.length < 2) continue
    if (candidates.some((c) => c.startsWith(probe))) return true
    if (headings.some((h) => h.includes(probe))) return true
  }
  return false
}

/**
 * Whether `§ <text>` is naming a SECTION at all, rather than running on into prose.
 *
 * Section names in this repository are capitalised (`§ Closure`, `§ INVARIANTS`, `§ a later decision`), quoted
 * (`§ "Measured state"`) or numbered (`§5`). A lowercase first word means the `§` was used as a
 * preposition in a sentence -- `` `artifacts/extraction-report.md` § header, "Runtime" line `` means
 * the document's header block, not a heading called "header" -- and asserting a heading exists for
 * it would be the gate inventing a claim the author never made.
 */
export function looksLikeSectionName(section: string): boolean {
  const first = section.replace(/[*_`"]/g, '').trim()
  return /^[A-Z0-9]/.test(first)
}

/** Read a file's lines, cached. */
export function lineReader(): (path: string) => string[] {
  const cache = new Map<string, string[]>()
  return (path) => {
    let lines = cache.get(path)
    if (!lines) {
      lines = readFileSync(join(ROOT, path), 'utf8').split('\n')
      cache.set(path, lines)
    }
    return lines
  }
}

export { SCANNED_EXTENSIONS }
