/**
 * Memory citations: pointers into a store this repository does not use.
 *
 * CLAUDE.md § *Rules for agents live in tracked files, and nowhere else* gives every rule an agent
 * has to follow exactly one home, a tracked file, and names the two stores that are NOT it: the
 * `bd remember` / `bd recall` / `bd memories` store and the harness's per-project auto-memory
 * directory. A prompt that says "see memory `some-key`" or tells its reader to `bd recall` one
 * points at a store that is empty here by rule, and it fails in the worst direction: the pointer
 * reads as authoritative, so the reader concludes they lack access rather than that the sentence
 * beside it is the whole rule. One skill re-acquired such citations three reviews running, and the fourth
 * review found that none of the five keys it cited resolved. That is why this is a gate and not a
 * convention, and why it runs where `citations:check` already runs: a memory
 * key is a citation whose target cannot exist, which is the resolution gate's failure taken to its
 * limit.
 *
 * WHAT IS A FINDING. Two shapes, taken exactly as written:
 *
 *   - a backticked span preceded by the word `memory` -- `` memory `bd-deps-blocks-direction` ``,
 *     the spelling the 2026-09-11 reviews use for every key they name, including the line-wrapped
 *     form where the word ends one line and the key opens the next (the review's `(memory` on one
 *     line and `` `bd-deps-blocks-direction` `` on the one below);
 *   - the tokens `bd recall`, `bd remember` and `bd memories`, backticked or bare.
 *
 * A paragraph break between the word and the span is NOT a match: `stays in memory` closing one
 * paragraph and a code span opening the next are two sentences, not a citation. `bd forget` is not
 * matched either -- the three tokens are the bead's and no review found a fourth; widen the list
 * when one appears, with the review that found it.
 *
 * WHERE IT LOOKS. The prompt homes that CLAUDE.md section names, and only those: `.claude/`,
 * a workflow's own directory once one exists, `.beads/formulas/`, `CLAUDE.md` and `README.md`
 * (`MEMORY_SCOPE`) -- every tracked
 * file under them regardless of extension, because the formulas are `.toml` and the plugin's tools
 * carry their prompts in `.ps1` headers, neither of which `scan.ts`'s `SCANNED_EXTENSIONS` covers.
 * A roster rather than the whole tree, unlike `scan.ts`, on purpose: the word `memory` before a
 * code span is ordinary prose in a tool's comment and a defect only where an agent reads it as an
 * instruction, and a whole-tree scan would begin by exempting this file.
 *
 * WHAT IS EXEMPT, and the design problem it answers. CLAUDE.md names the forbidden commands twice:
 * once in the section that forbids them, and once in the `bd`-generated Beads block, which says
 * "Use `bd remember` for persistent knowledge", is regenerated from the hash in its marker, and
 * cannot be edited (the section above it says so). Three ways to exempt those; this takes the third.
 *
 *   - NOT the whole of CLAUDE.md. It is the most-read prompt in the repository and the bead puts
 *     it in scope by name; exempting it wholesale is the hole dressed as an exemption every list in
 *     `scan.ts` warns about.
 *   - NOT a line that also carries a negation. That is a semantic rule: it passes the generated
 *     line for the wrong reason (its negation is about `MEMORY.md`, not about `bd remember`) and it
 *     passes "never skip `bd remember`" too.
 *   - TWO REGIONS OF CLAUDE.md, each keyed on its own delimiter (`MEMORY_EXEMPT_REGIONS`). The
 *     forbidding section by its `## ` heading text, from the heading to the next level-1 or level-2
 *     heading, on the argument `HISTORY` in `scan.ts` already makes for `tools/citations/`: it
 *     quotes the thing it exists to forbid. The generated block by `bd`'s own
 *     `<!-- BEGIN BEADS INTEGRATION` / `<!-- END BEADS INTEGRATION -->` markers, because those
 *     delimit exactly the region nobody can edit, and the headings inside them are `bd`'s to
 *     rename. A region applies to the one file it names, so the same heading in a skill exempts
 *     nothing and cannot be copied to route around the gate. And a registered region that is not
 *     found in its file is a FINDING, not a silent pass: rename the heading or lose the markers and
 *     the gate says so on the next run, rather than going quietly green over the whole file.
 *
 * `docs/prompt-reviews/` is exempt as history (`MEMORY_HISTORY`), the way `scan.ts` exempts
 * `docs/retired/`: a review's purpose is to record what a prompt said, memory keys included, and
 * the 2026-09-11 reviews quote five of them. The directory is outside the roster today; the entry
 * is stated anyway so that widening the roster to `docs/` cannot put the reviews in the gate by
 * accident, and `check.ts` counts the reviews as exempt by name rather than silently passing them by.
 *
 * Reads only this repository, needs no `../estate` checkout and no network.
 */

/** The prompt homes the rule covers: a directory prefix (trailing `/`) or one exact file. */
export const MEMORY_SCOPE: ReadonlyArray<string> = [
  '.claude/',
  'dry-run/',
  '.beads/formulas/',
  'CLAUDE.md',
  'README.md',
]

/** Whether the rule covers `file` at all. */
export function inMemoryScope(file: string): boolean {
  return MEMORY_SCOPE.some((s) => (s.endsWith('/') ? file.startsWith(s) : file === s))
}

/**
 * Files whose memory mentions are HISTORY -- a record of what a prompt said, not a live pointer.
 * Every entry states why, on the same bar as `HISTORY` in `scan.ts`.
 */
export const MEMORY_HISTORY: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: 'docs/prompt-reviews/',
    why:
      'A prompt review records what the prompt said on the day. The 2026-09-11 reviews of the bead' +
      ' skill quote the five memory keys it cited in order to record that none of them resolved;' +
      ' rewriting them would erase the finding this rule exists because of.',
  },
]

/** Whether `file` is exempt as history, and the reason if so. */
export function memoryHistoryReason(file: string): string | null {
  for (const h of MEMORY_HISTORY) if (file === h.path || file.startsWith(h.path)) return h.why
  return null
}

/**
 * A region of ONE named file inside which the forbidden spellings are the rule stating itself.
 *
 * `section` names a `#` or `##` heading by its text; the region runs from that heading to the line
 * before the next `#` or `##` heading. `between` names a pair of line prefixes; the region runs from
 * the first line starting with the opener through the next line starting with the closer.
 */
export type ExemptRegion =
  | { file: string; section: string; why: string }
  | { file: string; between: readonly [string, string]; why: string }

export const MEMORY_EXEMPT_REGIONS: ReadonlyArray<ExemptRegion> = [
  {
    file: 'CLAUDE.md',
    section: 'Rules for agents live in tracked files, and nowhere else',
    why:
      'The section that forbids the store names the commands it forbids, exactly as' +
      ' `tools/citations/` quotes the citations it exists to catch. Keyed on the heading text, so' +
      ' renaming the heading turns every mention in the section into a finding until this entry' +
      ' follows it.',
  },
  // ADD THE TRACKER PLUGIN'S BLOCK HERE ONCE IT EXISTS. When the tracker's set-up writes its managed
  // block into CLAUDE.md, that block tells its reader to use the memory commands, nobody can edit
  // it, and the section above it says it is overridden; register it then, keyed on its own markers:
  //   { file: 'CLAUDE.md', between: ['<!-- BEGIN BEADS INTEGRATION', '<!-- END BEADS INTEGRATION -->'], why: '...' },
  // Registered BEFORE the block exists it is a finding, by the rule in the header: a region that is
  // not found is reported, never silently passed.
]

/** A registered region located in a file: 1-based, inclusive. */
export interface FoundRegion {
  first: number
  last: number
  why: string
}

const HEADING_RE = /^#{1,2}\s/

function sectionSpan(
  heading: string,
  lines: readonly string[],
): { first: number; last: number } | null {
  const start = lines.findIndex(
    (l) => HEADING_RE.test(l) && l.replace(/^#{1,2}\s+/, '').trim() === heading,
  )
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !HEADING_RE.test(lines[end] ?? '')) end++
  // `end` is the 0-based index of the next heading (or one past the last line), so the region's
  // last 1-based line is `end` itself: the line before that heading.
  return { first: start + 1, last: end }
}

function markerSpan(
  [begin, close]: readonly [string, string],
  lines: readonly string[],
): { first: number; last: number } | null {
  const first = lines.findIndex((l) => l.startsWith(begin))
  if (first < 0) return null
  const last = lines.findIndex((l, i) => i > first && l.startsWith(close))
  if (last < 0) return null
  return { first: first + 1, last: last + 1 }
}

/**
 * The registered regions of `file`, located in its `lines` -- and the registered regions that
 * could NOT be located, which the caller must report. An exemption matching nothing is a hole
 * dressed as an exemption, and here it would be a hole over the one file that matters most.
 */
export function exemptRegionsIn(
  file: string,
  lines: readonly string[],
): { found: FoundRegion[]; missing: ExemptRegion[] } {
  const found: FoundRegion[] = []
  const missing: ExemptRegion[] = []
  for (const r of MEMORY_EXEMPT_REGIONS) {
    if (r.file !== file) continue
    const span = 'section' in r ? sectionSpan(r.section, lines) : markerSpan(r.between, lines)
    if (span) found.push({ ...span, why: r.why })
    else missing.push(r)
  }
  return { found, missing }
}

/** The reason line `at` is exempt, or null when no found region covers it. */
export function regionReason(at: number, found: readonly FoundRegion[]): string | null {
  return found.find((r) => at >= r.first && at <= r.last)?.why ?? null
}

/** How a registered region is spelled in a report. */
export function describeRegion(r: ExemptRegion): string {
  return 'section' in r
    ? `section "## ${r.section}"`
    : `the lines between ${r.between.join(' and ')}`
}

/** One forbidden spelling, as written. */
export interface MemoryCitation {
  /** Repository-relative path of the file it is written in. */
  from: string
  /** 1-based line the match begins on. */
  at: number
  /** `key` for `` memory `x` ``, `token` for `bd recall` / `bd remember` / `bd memories`. */
  kind: 'key' | 'token'
  /** The match as written, whitespace collapsed. */
  text: string
  /** The source line(s) the match spans, trimmed and joined. */
  context: string
}

/**
 * `` memory `key` ``, case-insensitive on the word, with at most ONE line break between the word
 * and the span. `[ \t]*(?:\r?\n[ \t]*)?` is the line-wrapped spelling the review records; a second
 * newline would be a paragraph break, which is two sentences and not a citation. `(?<!-)` refuses
 * a hyphenated compound -- `in-memory `index.json``, `auto-memory` -- where `\b` alone would not,
 * because a hyphen is a word boundary.
 */
const KEY_RE = /(?<!-)\bmemory\b[ \t]*(?:\r?\n[ \t]*)?`[^`\n]+`/gi

/** The three `bd` memory-store commands, as tokens. Case-sensitive: `bd` is the binary's name. */
const TOKEN_RE = /\bbd[ \t]+(?:recall|remember|memories)\b/g

/** Every forbidden spelling in `text`, which is the content of `from`, in line order. */
export function memoryCitationsIn(from: string, text: string): MemoryCitation[] {
  const lines = text.split('\n')
  const out: MemoryCitation[] = []
  const shapes: ReadonlyArray<readonly [RegExp, MemoryCitation['kind']]> = [
    [KEY_RE, 'key'],
    [TOKEN_RE, 'token'],
  ]
  for (const [re, kind] of shapes) {
    for (const m of text.matchAll(re)) {
      const at = text.slice(0, m.index).split('\n').length
      const spanned = m[0].split('\n').length
      out.push({
        from,
        at,
        kind,
        text: m[0].replace(/\s+/g, ' '),
        context: lines
          .slice(at - 1, at - 1 + spanned)
          .map((l) => l.trim())
          .join(' '),
      })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

export interface MemoryProblem {
  where: string
  what: string
  context: string
}

/** The whole rule applied to one file: what `check.ts` reports and what the selftest asserts. */
export interface MemoryScan {
  /** Why the file was not scanned at all, or null when it was. */
  skipped: string | null
  problems: MemoryProblem[]
  /** Forbidden spellings inside a registered exempt region. */
  exempted: number
}

const RULE = 'CLAUDE.md § *Rules for agents live in tracked files, and nowhere else*'

/**
 * Scope, history, registered regions and the two shapes, in that order, over one file's text.
 *
 * ONE FUNCTION rather than a pipeline the gate assembles, so that the selftest exercises the exact
 * derivation `check.ts` runs: a fixture that fails here fails the gate, and a fixture that passes
 * here passes it, with nothing in between to drift.
 */
export function memoryProblemsIn(file: string, text: string): MemoryScan {
  // History before scope, so a review is skipped WITH its reason whether or not the roster reaches
  // it, and the gate can count it as exempt rather than as merely elsewhere.
  const history = memoryHistoryReason(file)
  if (history !== null) return { skipped: history, problems: [], exempted: 0 }
  if (!inMemoryScope(file)) {
    return {
      skipped: `outside MEMORY_SCOPE (${MEMORY_SCOPE.join(', ')})`,
      problems: [],
      exempted: 0,
    }
  }
  // A NUL means the file is binary whatever its name. Nothing to read as a prompt.
  if (text.includes('\0')) return { skipped: 'binary', problems: [], exempted: 0 }

  const lines = text.split('\n')
  const { found, missing } = exemptRegionsIn(file, lines)
  const problems: MemoryProblem[] = []
  for (const r of missing) {
    problems.push({
      where: file,
      what:
        `registers ${describeRegion(r)} as exempt from the memory rule, but no such region is in the` +
        ' file. The heading was renamed or the markers are gone; without the region every mention' +
        ' it covered is live, so the gate reports the exemption rather than silently keeping it.' +
        ' Repoint the entry in `MEMORY_EXEMPT_REGIONS` (`tools/citations/memory.ts`).',
      context: r.why,
    })
  }
  let exempted = 0
  for (const c of memoryCitationsIn(file, text)) {
    if (regionReason(c.at, found) !== null) {
      exempted++
      continue
    }
    problems.push({
      where: `${file}:${c.at}`,
      what:
        c.kind === 'key'
          ? `cites ${c.text}. This repository keeps no memory store (${RULE}), so the key resolves` +
            ' to nothing and a reader following it concludes they lack access. State the rule in' +
            ' this file, or cite the tracked file that carries it.'
          : `tells its reader to \`${c.text}\`. The store is not used here (${RULE}); a prompt that` +
            ' names the command sends its reader to an empty store. Name the tracked file that' +
            ' holds the fact instead, or cite the CLAUDE.md section if the sentence is the rule.',
      context: c.context,
    })
  }
  return { skipped: null, problems, exempted }
}
