/**
 * Register-status gate: the header of `docs/decisions.md` agrees with its body.
 *
 *   npm run check:register             the gate
 *   npm run check:register:selftest    its fixtures -- every assertion exercised on a doctored copy
 *
 * THE JOB THIS EXISTS FOR. The register's status line said "every decision from D-01 to D-22 is
 * recorded and applied" while D-23 through D-32 were recorded in the same file, and its
 * `## Decisions — recorded and applied` table stopped at D-16. Ten consecutive decisions were
 * appended without touching either -- the convention that actually emerged was additive only. The
 * line's own blockquote had predicted this twice ("all 16 decisions" with D-18 recorded, then
 * `D-01 … D-18` with D-20 recorded) and named the mechanism that was supposed to stop it: the range
 * "is checked by reading the `### D-` headings below, which is the same act as adding one". It was
 * not the same act. Four more hand-maintained files restated the range at four different stale
 * values (D-30, D-26, D-18, D-16) -- the multi-copy drift `count-index.md` exists to stop, for a
 * figure that deliberately gets no `CNT-*` key because it moves when somebody records a decision,
 * not when the estate is re-measured.
 *
 * WHAT THE RECORD IS. The `### D-NN` headings -- EXACTLY three hashes. `## D-13 · The corpus is a
 * census again (2026-08-24)` is a level-two NARRATIVE heading further down the file, not a second
 * D-13: a gate keyed on `^#{2,3} D-` reports a duplicate and is red on arrival. Do not widen the
 * anchor to "tidy" it. N is max(id), not the last heading, because D-09 is filed before D-06.
 *
 * WHAT FAILS THE JOB:
 *   1. no `### D-` heading at all, a duplicate id, or a gap (the ids must be exactly 1..N)
 *   2. the status line's `D-01 to D-NN` bound is not N -- or the line is gone
 *   3. the blockquote's `` `D-01 … D-NN` is checked by `` bound is not N -- or the sentence is gone
 *   4. the decisions table's `| **D-NN** |` id set differs from the heading set in either
 *      direction, or the table heading is gone
 *   5. a citing file that RESTATES the range carries a bound other than N, or stops carrying one; a
 *      citing file that cites the register WITHOUT a bound grows one, even at N; an allowlisted
 *      narrower range is no longer present (a stale allowlist entry is a hole in the gate)
 *   6. the status line's parenthetical -- `(D-09 added 2026-08-21; D-10 and D-11 added 2026-08-23;
 *      …)` -- dates a decision on a day other than the one its section's opening `**Recorded
 *      <date>` line carries, names an id with no heading or no Recorded line, or omits a decision
 *      that has one; or a decision from the first one that carries a Recorded line onward (D-09
 *      today; derived, not hard-coded) has none. The dates were "copied from each
 *      section's Recorded line and not gated" until the tier-a sweep's wave-1 fix-up
 *      corrected a D-13/D-14 date swap BY HAND -- exactly the drift an ungated hand-copied
 *      parenthetical produces, and exactly the shape items 2-5 exist for.
 *
 * An anchor that finds nothing FAILS. Update the prose from the headings, never the headings from the
 * prose, and never delete a line to silence this gate. The one exception to that direction is item
 * 6: a parenthetical date is corrected FROM the Recorded line, never the Recorded line from the
 * parenthetical -- the section is the record, the header summarises it.
 *
 * WHAT IS NOT CHECKED, deliberately: the Decision and Applied-as text of the table rows (they
 * paraphrase, so title equality would be red on arrival); the "All twelve tasks are complete" count
 * on the same line; the Recorded lines of D-01 to D-08, which have none (the parenthetical starts at
 * D-09, and the rule is anchored on the first section that carries one rather than on a numeral);
 * and range mentions anywhere but the citing files -- D-22 is this repository's precedent for
 * refusing a repository-wide regex, and the legitimately narrower ranges elsewhere
 * (a design note's D-01…D-15, say) are exactly what such a regex would flag.
 *
 * NEGATIVE TESTING. `--selftest` copies the register and the citing files under `os.tmpdir()` and
 * doctors ONE thing per case, asserting the run fails FOR THAT REASON -- plus a control that the
 * undoctored copy passes, without which every other case could be failing on the copy. By hand,
 * point `CHECK_REGISTER_ROOT` at a copy of the tree, as `check-provenance.mjs` does:
 *
 *   CHECK_REGISTER_ROOT=/tmp/doctored node scripts/check-register-status.mjs
 *
 * Reads only committed files; no `../estate` checkout, no network, milliseconds.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = process.env.CHECK_REGISTER_ROOT ?? REPO_ROOT

const REGISTER = 'docs/decisions.md'

/** A decision heading: three hashes exactly -- see the header for why not `^#{2,3}`. */
const HEADING_RE = /^### D-(\d{2})\b/
/** The status line's opening clause. The parenthetical follows on the same line; the tasks count is not read. */
const STATUS_RE = /^\*\*Status: every decision from D-01 to D-(\d{2}) is recorded and applied\b/
/** The parenthetical on that line: the first `(...)` after the opening clause. */
const PARENTHETICAL_RE = /\(([^()]*)\)/
/**
 * One clause of it: `D-12 and D-14 added 2026-08-24`, `D-22, D-23, D-24, D-25 and D-26 added
 * 2026-08-31`, `D-33 added 2026-09-06`. Ids are pulled out of group 1 with ID_RE.
 */
const CLAUSE_RE = /^((?:D-\d{2}(?:,\s*|\s+and\s+))*D-\d{2})\s+added (\d{4}-\d{2}-\d{2})$/
const ID_RE = /D-(\d{2})/g
/**
 * A section's opening date line: `**Recorded 2026-08-21, when …`, `**Recorded 2026-08-23**, together
 * with D-11 …`, `**Recorded 2026-08-28.**`. Anchored at column 0 so an amendment blockquote's
 * `> **Recorded` never counts, and read only between a `### D-` heading and the next heading.
 */
const RECORDED_RE = /^\*\*Recorded (\d{4}-\d{2}-\d{2})\b/
/** Any heading ends a section for the Recorded search; a `####` inside one never precedes the date line. */
const ANY_HEADING_RE = /^#{1,6} /
/**
 * The blockquote's mechanism sentence. Anchored on the trailing "is checked by" so that the same
 * blockquote's QUOTATIONS of past stale claims -- `D-01 … D-18`, `D-01 … D-22` -- are never read as
 * the live bound; CLAUDE.md's count-index rule says a quoted numeral stays literal.
 */
const BLOCKQUOTE_RE = /`D-01 … D-(\d{2})` is checked by/
const TABLE_HEADING = '## Decisions — recorded and applied'
/** A decisions-table row. Only the id is compared; the other two columns paraphrase. */
const ROW_RE = /^\| \*\*D-(\d{2})\*\* \|/
/** A full-range mention in a citing file, in every spelling the prose has used. */
const RANGE_RE = /\bD-01\s*(?:…|\.\.\.|to|through|–|—)\s*D-(\d{2})\b/g

/**
 * The hand-maintained files that mention the range. Two policies:
 *
 *   restates            the file states the full range and must carry the current bound (at least
 *                       once, and never any other value). One file, on purpose: it declares itself
 *                       the pointer to "the full register" and says not to quote a bound without
 *                       checking it there.
 *   cites-without-bound the file points at the register and must NOT carry a full-range bound at
 *                       all, N included -- the register's status line is the one home of the figure
 *                       and a copy that is right today is the copy that goes stale next.
 *
 * `allow` lists the legitimately NARROWER ranges in each file, by bound and reason, never by line
 * number. Every entry must match at least once or the run fails: an exemption for a mention that no
 * longer exists is a hole nobody is watching.
 */
const CITING_FILES = [{ path: 'CLAUDE.md', policy: 'cites-without-bound', allow: [] }]

const pad = (id) => String(id).padStart(2, '0')

/**
 * Run every assertion against the tree at `root`. Returns the failures rather than exiting, so the
 * selftest can run it against doctored copies.
 */
export function runCheck(root) {
  const failures = []
  const fail = (message) => failures.push(message)

  const registerPath = join(root, REGISTER)
  if (!existsSync(registerPath)) {
    fail(`${REGISTER} is missing at ${registerPath}.`)
    return { failures, n: null }
  }
  const lines = readFileSync(registerPath, 'utf8').split('\n')

  /* ------------------------------------------------- 1. the headings are the record ------------ */

  const headings = new Map()
  lines.forEach((line, index) => {
    const m = HEADING_RE.exec(line)
    if (!m) return
    const id = Number(m[1])
    if (headings.has(id)) {
      fail(
        `duplicate heading: \`### D-${m[1]}\` at ${REGISTER}:${headings.get(id)} and :${index + 1}.` +
          ` Two sections cannot carry one id; a second reading of a decision is an amendment` +
          ` blockquote under the first, not a second heading.`,
      )
      return
    }
    headings.set(id, index + 1)
  })
  if (headings.size === 0) {
    fail(
      `${REGISTER} has no \`### D-NN\` headings (three hashes exactly). The headings are the record` +
        ` this gate reads; if they were restyled, restore them rather than widening the anchor.`,
    )
    return { failures, n: null }
  }
  const n = Math.max(...headings.keys())
  const nn = pad(n)
  for (let id = 1; id <= n; id++) {
    if (!headings.has(id)) {
      fail(
        `gap: D-${pad(id)} has no \`### D-\` heading while D-${nn} does (${REGISTER}:${headings.get(n)}).` +
          ` Ids are contiguous and never reused; a withdrawn decision keeps its heading and a note.`,
      )
    }
  }

  /* ------------------------------------------------- 2. the status line ------------------------- */

  const status = matchOnce(lines, STATUS_RE)
  if (status.count === 0) {
    fail(
      `status line: no line in ${REGISTER} matches "**Status: every decision from D-01 to D-NN is` +
        ` recorded and applied". Do not delete or reword the line to silence this gate; the bound is` +
        ` what it holds.`,
    )
  } else if (status.count > 1) {
    fail(
      `status line: ${status.count} lines in ${REGISTER} look like the status line; there is one.`,
    )
  } else if (status.bound !== n) {
    fail(
      `status line (${REGISTER}:${status.line}) says "D-01 to D-${pad(status.bound)}"; the highest` +
        ` \`### D-\` heading is D-${nn} (:${headings.get(n)}). Update the line from the headings,` +
        ` never the headings from the line.`,
    )
  }

  /* ------------------------------------------------- 2b. the parenthetical's dates -------------- */

  // Each section's opening `**Recorded <date>` line, by id. Only the ids that carry one.
  const recorded = new Map()
  for (const [id, headingLine] of headings) {
    for (let index = headingLine; index < lines.length; index++) {
      if (ANY_HEADING_RE.test(lines[index])) break
      const m = RECORDED_RE.exec(lines[index])
      if (m) {
        recorded.set(id, { date: m[1], line: index + 1 })
        break
      }
    }
  }
  // Every decision from the first one that carries a Recorded line onward must carry one, or the
  // parenthetical check below has nothing to hold a new decision to.
  if (recorded.size > 0) {
    const first = Math.min(...recorded.keys())
    for (const [id, headingLine] of headings) {
      if (id >= first && !recorded.has(id)) {
        fail(
          `\`### D-${pad(id)}\` (${REGISTER}:${headingLine}) has no opening \`**Recorded <date>\`` +
            ` line. Every decision from D-${pad(first)} (:${recorded.get(first).line}) on carries one,` +
            ` and it is what the status line's parenthetical date is held to; add it.`,
        )
      }
    }
  }

  if (status.count === 1) {
    const statusText = lines[status.line - 1]
    const paren = PARENTHETICAL_RE.exec(
      statusText.slice(statusText.indexOf('is recorded and applied')),
    )
    if (!paren) {
      fail(
        `status line (${REGISTER}:${status.line}) carries no parenthetical of addition dates after` +
          ` "is recorded and applied". Do not delete it to silence this gate; each date is held to` +
          ` its section's Recorded line.`,
      )
    } else {
      const dated = new Map()
      for (const clause of paren[1].split(';')) {
        const text = clause.trim()
        if (text === '') continue
        const m = CLAUSE_RE.exec(text)
        if (!m) {
          fail(
            `parenthetical (${REGISTER}:${status.line}): the clause "${text}" is not of the form` +
              ` "D-NN[, D-NN…][ and D-NN] added YYYY-MM-DD". Reword it; the dates in it cannot be` +
              ` checked otherwise.`,
          )
          continue
        }
        for (const idMatch of m[1].matchAll(ID_RE)) {
          const id = Number(idMatch[1])
          if (dated.has(id)) {
            fail(
              `parenthetical (${REGISTER}:${status.line}): D-${idMatch[1]} is dated twice` +
                ` (${dated.get(id)} and ${m[2]}).`,
            )
            continue
          }
          dated.set(id, m[2])
        }
      }
      for (const [id, date] of dated) {
        if (!headings.has(id)) {
          fail(
            `parenthetical (${REGISTER}:${status.line}): D-${pad(id)} added ${date} has no` +
              ` \`### D-${pad(id)}\` heading. Record the decision first; the parenthetical summarises` +
              ` the sections.`,
          )
          continue
        }
        const rec = recorded.get(id)
        if (!rec) {
          fail(
            `parenthetical (${REGISTER}:${status.line}): D-${pad(id)} added ${date}, but its section` +
              ` (:${headings.get(id)}) has no opening \`**Recorded <date>\` line to hold that to.`,
          )
          continue
        }
        if (rec.date !== date) {
          fail(
            `parenthetical (${REGISTER}:${status.line}): D-${pad(id)} is dated ${date}, but its` +
              ` section opens **Recorded ${rec.date}** (:${rec.line}). Correct the parenthetical from` +
              ` the Recorded line, never the Recorded line from the parenthetical.`,
          )
        }
      }
      for (const [id, rec] of recorded) {
        if (!dated.has(id)) {
          fail(
            `parenthetical (${REGISTER}:${status.line}): D-${pad(id)} opens **Recorded ${rec.date}**` +
              ` (:${rec.line}) but the parenthetical does not date it. Add "D-${pad(id)} added` +
              ` ${rec.date}" -- every decision that carries a Recorded line is listed there.`,
          )
        }
      }
    }
  }

  /* ------------------------------------------------- 3. the blockquote's own claim -------------- */

  const quote = matchOnce(lines, BLOCKQUOTE_RE)
  if (quote.count === 0) {
    fail(
      `blockquote: no line in ${REGISTER} carries "\`D-01 … D-NN\` is checked by". That sentence is` +
        ` the record of what checks the range; do not delete it to silence this gate.`,
    )
  } else if (quote.count > 1) {
    fail(
      `blockquote: ${quote.count} lines in ${REGISTER} carry the mechanism sentence; there is one.`,
    )
  } else if (quote.bound !== n) {
    fail(
      `blockquote (${REGISTER}:${quote.line}) says "\`D-01 … D-${pad(quote.bound)}\` is checked by";` +
        ` the highest \`### D-\` heading is D-${nn}. Update the sentence from the headings.`,
    )
  }

  /* ------------------------------------------------- 4. the decisions table --------------------- */

  const tableAt = lines.findIndex((line) => line.trim() === TABLE_HEADING)
  if (tableAt === -1) {
    fail(
      `decisions table: no \`${TABLE_HEADING}\` heading in ${REGISTER}. The table is the reader's` +
        ` index of every decision; do not delete or rename its heading to silence this gate.`,
    )
  } else {
    let end = lines.findIndex((line, index) => index > tableAt && /^#{1,6} /.test(line))
    if (end === -1) end = lines.length
    const rows = new Map()
    for (let index = tableAt + 1; index < end; index++) {
      const m = ROW_RE.exec(lines[index])
      if (!m) continue
      const id = Number(m[1])
      if (rows.has(id)) {
        fail(
          `decisions table: D-${m[1]} has two rows (${REGISTER}:${rows.get(id)} and :${index + 1}).`,
        )
        continue
      }
      rows.set(id, index + 1)
    }
    for (const [id, line] of headings) {
      if (!rows.has(id)) {
        fail(
          `decisions table: \`### D-${pad(id)}\` (${REGISTER}:${line}) has no \`| **D-${pad(id)}** |\`` +
            ` row. Add one, with its Applied-as cell taken from the section's own Recorded and` +
            ` Applied sentences rather than from its title.`,
        )
      }
    }
    for (const [id, line] of rows) {
      if (!headings.has(id)) {
        fail(
          `decisions table: row \`| **D-${pad(id)}** |\` (${REGISTER}:${line}) has no` +
            ` \`### D-${pad(id)}\` heading. A row is an index entry; record the decision first.`,
        )
      }
    }
  }

  /* ------------------------------------------------- 5. the files that cite the range ----------- */

  for (const { path, policy, allow } of CITING_FILES) {
    const full = join(root, path)
    if (!existsSync(full)) {
      fail(
        `${path} is listed in CITING_FILES but does not exist under ${root}. If it was retired,` +
          ` remove the entry with a reason; the list must describe the tree.`,
      )
      continue
    }
    const used = new Set()
    let current = 0
    readFileSync(full, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const m of line.matchAll(RANGE_RE)) {
          const bound = Number(m[1])
          if (allow.some((entry) => entry.bound === bound)) {
            used.add(bound)
            continue
          }
          if (policy === 'restates') {
            if (bound === n) current++
            else {
              fail(
                `${path}:${index + 1} restates the range as \`${m[0]}\`; the register runs to D-${nn}.` +
                  ` This file is the one place outside the register allowed to state the bound, and` +
                  ` it must state the current one.`,
              )
            }
            continue
          }
          fail(
            `${path}:${index + 1} carries the bound \`${m[0]}\`. This file cites the register without` +
              ` a bound -- the register's status line is the one home of that figure, and a copy that` +
              ` is right today is the copy that goes stale next. Drop the bound, or move the file to` +
              ` the "restates" policy with a reason.`,
          )
        }
      })
    if (policy === 'restates' && current === 0) {
      fail(
        `${path} no longer restates the range as D-01…D-${nn}. If that is deliberate, move it to the` +
          ` "cites-without-bound" policy; a "restates" entry that restates nothing checks nothing.`,
      )
    }
    for (const entry of allow) {
      if (!used.has(entry.bound)) {
        fail(
          `${path}: the allowlist entry for D-01…D-${pad(entry.bound)} (${entry.why}) matched nothing.` +
            ` A stale allowlist entry is a hole in the gate; remove it.`,
        )
      }
    }
  }

  return { failures, n, recorded }
}

/** Find the lines matching `re`; report how many, and the bound and line number of the first. */
function matchOnce(lines, re) {
  let count = 0
  let bound = null
  let line = null
  lines.forEach((text, index) => {
    const m = re.exec(text)
    if (!m) return
    count++
    if (bound === null) {
      bound = Number(m[1])
      line = index + 1
    }
  })
  return { count, bound, line }
}

/* --------------------------------------------------------------------------------- the gate ----- */

function main() {
  const { failures, n, recorded } = runCheck(ROOT)
  if (failures.length === 0) {
    console.log(
      `register: ${n} decisions (D-01 … D-${pad(n)}); status line, its ${recorded.size} parenthetical` +
        ` dates, blockquote, decisions table and ${CITING_FILES.length} citing files agree.`,
    )
    process.exit(0)
  }
  console.error(`register: ${failures.length} failure(s). ${REGISTER}.\n`)
  for (const failure of failures) console.error(`  - ${failure}\n`)
  process.exit(1)
}

/* --------------------------------------------------------------------------------- selftest ----- */

/**
 * One doctoring per case, in a fresh copy; the run must fail FOR THAT REASON. `expect` is a regex
 * over the failure messages, or 'pass'. Each doctoring must change the file it edits, or the fixture
 * is broken and the case throws rather than testing nothing.
 */
function selftest() {
  const files = [REGISTER, ...CITING_FILES.map((entry) => entry.path)]
  const base = mkdtempSync(join(tmpdir(), 'check-register-'))
  const results = []
  try {
    const pristine = copyTree(base, 'pristine', files)
    const control = runCheck(pristine)
    if (control.failures.length > 0 || control.n === null) {
      console.error(
        'selftest: the undoctored copy does not pass, so no case below can be trusted:\n',
      )
      for (const failure of control.failures) console.error(`  - ${failure}\n`)
      process.exit(1)
    }
    const ctx = {
      nn: pad(control.n),
      prev: pad(control.n - 1),
      next: pad(control.n + 1),
      // The highest decision's own Recorded date, so the parenthetical cases doctor a real clause.
      date: control.recorded.get(control.n)?.date ?? null,
    }
    if (ctx.date === null) {
      console.error(
        `selftest: D-${ctx.nn} carries no Recorded line, so the parenthetical cases have nothing to doctor.`,
      )
      process.exit(1)
    }

    for (const { name, doctor, expect } of cases(ctx)) {
      const dir = copyTree(base, name.replace(/[^a-z0-9]+/gi, '-'), files)
      doctor(dir)
      const { failures } = runCheck(dir)
      let ok
      let detail
      if (expect === 'pass') {
        ok = failures.length === 0
        detail = ok ? 'passes' : `unexpected failure(s): ${failures.join(' | ')}`
      } else {
        ok = failures.some((failure) => expect.test(failure))
        detail = ok
          ? `fails for that reason (${failures.length} failure(s))`
          : failures.length === 0
            ? 'PASSED, but should have failed'
            : `failed, but not for that reason: ${failures.join(' | ')}`
      }
      results.push({ name, ok, detail })
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  const failed = results.filter((result) => !result.ok)
  for (const { name, ok, detail } of results) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} -- ${detail}`)
  }
  console.log(
    `register selftest: ${results.length - failed.length}/${results.length} cases hold` +
      ` (control plus ${results.length - 1} doctored copies).`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

function copyTree(base, name, files) {
  const dir = join(base, name)
  for (const relative of files) {
    const dest = join(dir, relative)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(REPO_ROOT, relative), dest)
  }
  return dir
}

/** Rewrite one file in a doctored copy; a rewrite that changes nothing is a broken fixture. */
function edit(dir, relative, transform) {
  const path = join(dir, relative)
  const before = readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === before) {
    throw new Error(
      `selftest fixture for ${relative} changed nothing -- the doctoring missed its target`,
    )
  }
  writeFileSync(path, after)
}

function cases({ nn, prev, next, date }) {
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    {
      name: 'control: the undoctored copy passes',
      doctor: () => {},
      expect: 'pass',
    },
    {
      name: `parenthetical dates D-${nn} on a day other than its Recorded line`,
      doctor: (dir) =>
        edit(dir, REGISTER, (t) => t.replace(`D-${nn} added ${date}`, `D-${nn} added 2000-01-01`)),
      expect: new RegExp(
        `^parenthetical \\(.*\\): D-${nn} is dated 2000-01-01, but its section opens \\*\\*Recorded ${date}\\*\\*`,
      ),
    },
    {
      name: `parenthetical omits D-${nn}, which carries a Recorded line`,
      // The separator is optional: a register with one decision has a one-clause parenthetical.
      doctor: (dir) =>
        edit(dir, REGISTER, (t) => t.replace(new RegExp(`(?:; )?D-${nn} added ${date}`), '')),
      expect: new RegExp(
        `^parenthetical \\(.*\\): D-${nn} opens \\*\\*Recorded ${date}\\*\\* \\(:\\d+\\) but the parenthetical does not date it`,
      ),
    },
    {
      name: `parenthetical dates D-${next}, which has no heading`,
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t.replace(`D-${nn} added ${date}`, `D-${nn} and D-${next} added ${date}`),
        ),
      expect: new RegExp(
        `^parenthetical \\(.*\\): D-${next} added ${date} has no \`### D-${next}\` heading`,
      ),
    },
    {
      name: `the D-${nn} section loses its Recorded line`,
      doctor: (dir) =>
        edit(dir, REGISTER, (t) => {
          // Blank the first `**Recorded` line after the D-nn heading and before the next heading.
          const lines = t.split('\n')
          const at = lines.findIndex((line) => line.startsWith(`### D-${nn} `))
          for (let index = at + 1; index < lines.length; index++) {
            if (ANY_HEADING_RE.test(lines[index])) break
            if (RECORDED_RE.test(lines[index])) {
              lines[index] = lines[index].replace(/^\*\*Recorded /, '**Noted ')
              break
            }
          }
          return lines.join('\n')
        }),
      expect: new RegExp(
        `^parenthetical \\(.*\\): D-${nn} added ${date}, but its section \\(:\\d+\\) has no opening`,
      ),
    },
    {
      name: 'the parenthetical is deleted',
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t.replace(/is recorded and applied \([^()]*\)\./, 'is recorded and applied.'),
        ),
      expect: /^status line \(.*\) carries no parenthetical of addition dates/,
    },
    {
      name: `status line bound at D-${prev} with D-${nn} recorded`,
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t.replace(`from D-01 to D-${nn} is recorded`, `from D-01 to D-${prev} is recorded`),
        ),
      expect: new RegExp(`^status line \\(.*\\) says "D-01 to D-${prev}"`),
    },
    {
      name: 'status line deleted',
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t
            .split('\n')
            .filter((line) => !STATUS_RE.test(line))
            .join('\n'),
        ),
      expect: /^status line: no line in/,
    },
    {
      name: `blockquote bound at D-${prev}`,
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t.replace(`\`D-01 … D-${nn}\` is checked by`, `\`D-01 … D-${prev}\` is checked by`),
        ),
      expect: new RegExp(`^blockquote \\(.*\\) says "\`D-01 … D-${prev}\` is checked by"`),
    },
    {
      name: 'blockquote mechanism sentence deleted',
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t.replace(`\`D-01 … D-${nn}\` is checked by`, 'it is checked by'),
        ),
      expect: /^blockquote: no line in/,
    },
    {
      name: `decisions table missing the D-${nn} row`,
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t
            .split('\n')
            .filter((line) => !line.startsWith(`| **D-${nn}** |`))
            .join('\n'),
        ),
      expect: new RegExp(
        `^decisions table: \`### D-${nn}\` \\(.*\\) has no \`\\| \\*\\*D-${nn}\\*\\* \\|\` row`,
      ),
    },
    {
      name: 'decisions table row with no heading',
      doctor: (dir) =>
        edit(dir, REGISTER, (t) =>
          t.replace(`| **D-${nn}** |`, `| **D-99** | doctored | doctored |\n| **D-${nn}** |`),
        ),
      expect: /^decisions table: row `\| \*\*D-99\*\* \|` \(.*\) has no `### D-99` heading/,
    },
    {
      name: 'decisions table heading renamed',
      doctor: (dir) => edit(dir, REGISTER, (t) => t.replace(TABLE_HEADING, '## Decisions')),
      expect: new RegExp(`^decisions table: no \`${escaped(TABLE_HEADING)}\` heading`),
    },
    {
      name: `duplicate \`### D-${nn}\` heading`,
      doctor: (dir) => edit(dir, REGISTER, (t) => `${t}\n### D-${nn} · doctored duplicate\n`),
      expect: new RegExp(`^duplicate heading: \`### D-${nn}\``),
    },
    {
      name: `gap: the D-${nn} heading renumbered to D-${next}`,
      doctor: (dir) => edit(dir, REGISTER, (t) => t.replace(`### D-${nn} ·`, `### D-${next} ·`)),
      expect: new RegExp(`^gap: D-${nn} has no \`### D-\` heading while D-${next} does`),
    },
    {
      name: 'no `### D-` headings at all',
      doctor: (dir) => edit(dir, REGISTER, (t) => t.replace(/^### D-/gm, '### X-')),
      expect: /has no `### D-NN` headings/,
    },
    {
      name: 'a level-two `## D-99` narrative heading is not a decision',
      doctor: (dir) => edit(dir, REGISTER, (t) => `${t}\n## D-99 · doctored narrative heading\n`),
      expect: 'pass',
    },
    {
      name: `a bound creeps into CLAUDE.md, even at the current D-${nn}`,
      doctor: (dir) => edit(dir, 'CLAUDE.md', (t) => `${t}\nThe register runs D-01…D-${nn}.\n`),
      expect: new RegExp(`^CLAUDE\\.md:\\d+ carries the bound \`D-01…D-${nn}\``),
    },
    {
      name: 'a bound creeps into CLAUDE.md, spelled with "to"',
      doctor: (dir) => edit(dir, 'CLAUDE.md', (t) => `${t}\nSee the register, D-01 to D-${prev}.\n`),
      expect: new RegExp(`^CLAUDE\\.md:\\d+ carries the bound \`D-01 to D-${prev}\``),
    },
    {
      name: 'the register is missing',
      doctor: (dir) => rmSync(join(dir, REGISTER)),
      expect: new RegExp(`^${escaped(REGISTER)} is missing`),
    },
    {
      name: 'a listed citing file is missing',
      doctor: (dir) => rmSync(join(dir, 'CLAUDE.md')),
      expect: /^CLAUDE\.md is listed in CITING_FILES but does not exist/,
    },
  ]
}

if (process.argv.includes('--selftest')) selftest()
else main()
