/**
 * Every bead in the tracker stands on its own: it names where its work lands, and every identifier
 * it cites resolves from THIS checkout.
 *
 *   npm run beads:check
 *
 * THE FAILURE THIS EXISTS TO PREVENT. A bead is a set of instructions an agent executes months
 * after a human wrote it, and the tracker is the only thing that travels with it. When a bead cites
 * an id from another repository's tracker for the rule that justifies the gate it is asking for,
 * that id resolves in a DIFFERENT repository's database, on one developer's laptop. `bd show`
 * errors on it here. The fact does not travel; only a pointer to it does, and the pointer is dead
 * everywhere except the machine it was written on.
 *
 * That is not hypothetical. One bead cited a predecessor id, an emitter hard-coded the same id,
 * and it was PUBLISHED into a generated artifact as the stated authority for a hard exclusion
 * rule. The smell escaped the tracker and shipped.
 *
 * WHY A REGISTRY RATHER THAN A BAN. A bead that CORRECTS a stale foreign citation has to name the
 * id it is correcting, so a flat prohibition would forbid the fix along with the defect. This is the
 * same trade `tools/citations/scan.ts` makes with its `QUOTED` list, and the same reasoning: each
 * exemption is registered individually, with a reason, rather than by a wholesale exemption that
 * would stop saying anything.
 *
 * WHY IT IS NOT A CI STEP. It reads the Dolt database through `bd export`. CI has neither the
 * database nor the binary, so it would compare against nothing and pass. It is a `pre-push` job.
 * Where `bd` is unavailable it SKIPS CLEAN and says so -- a gate that is red on every fresh clone
 * gets bypassed with `--no-verify`, which costs you every other gate too.
 *
 * "UNAVAILABLE" MEANS NOT FOUND, AND NOTHING ELSE. `tools/lib/bd-launcher.ts` resolves `bd` on PATH
 * and starts it without a shell; only its `found: false` answer is a skip. A `bd` that IS found and
 * then cannot be started, exits non-zero, or writes nothing is a FAILURE, printed with the launcher
 * and the spawn error, because the mirror of the paragraph above happened: on native Windows `bd` is
 * the npm shim `%APPDATA%\npm\bd`, `execFileSync('bd')` threw ENOENT on it, and this gate reported
 * "skipped" over a tracker that `bd export` in the same shell had just written 107 issues from.
 * A green run prints the bead count it read and which `bd` it read
 * through, so it cannot be mistaken for the skip in a pre-push log.
 *
 * THREE HARD FAILURES:
 *
 *   1. An unregistered id carrying PREDECESSOR_PREFIX in any bead field: an id from the predecessor
 *      repository's tracker. Register it below with a reason, or copy the fact in. With no
 *      predecessor, PREDECESSOR_PREFIX stays null and this rule goes.
 *   2. An open bead with no `repo:` label. A bead that does not say where its work lands is not
 *      self-describing, and the reader has to guess which checkout it means.
 *   3. A bead whose work lands in a foreign repository and which does not cite its context bead.
 *      Those beads carry the copied bundle facts; a cross-repo bead that does not point at one is
 *      asking the reader to go and open another checkout.
 *
 * Plus one consistency check: a context bead cited by rule 3 must itself exist in the export, so
 * this gate cannot be satisfied by pointing at an id that is as dead as the ones it forbids.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeLauncher, resolveBd, runBd } from '../tools/lib/bd-launcher.ts'

/**
 * The predecessor tracker's id prefix, and this tracker's own. With no predecessor repository,
 * PREDECESSOR_PREFIX stays null and rule 1 goes. A foreign id is the predecessor's prefix plus
 * hyphenated alphanumeric tokens, optionally with a `.N` sub-id.
 *
 * A FILENAME IS NOT AN ID. A tracker export's filename, spelled with the prefix, matched the first
 * cut of this pattern and was reported against the very bead that proposed the filename, which is
 * the failure mode a gate like this has to avoid: a false positive teaches people that the gate is
 * noise. Matches followed by a file extension are dropped below rather than excluded in the
 * pattern, because doing it in the pattern lets backtracking find a shorter bogus match and report
 * that instead.
 */
const PREDECESSOR_PREFIX = null
const OWN_PREFIX = null
const FOREIGN_ID = PREDECESSOR_PREFIX
  ? new RegExp(`\\b${PREDECESSOR_PREFIX}-[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.\\d+)?`, 'gi')
  : null

/** A match immediately followed by `.<ext>` is a filename, not a bead id. */
const EXTENSION_AFTER = /^\.[a-z]{2,5}\b/i

/**
 * A BRANCH NAME IS NOT AN ID EITHER. A branch named with the predecessor's prefix, quoted by the
 * notes that record work landing on it, matches FOREIGN_ID and resolves in no tracker anywhere; so
 * does an adjective built on the prefix. Each is listed by exact literal with its reason, like
 * QUOTED_IDS and unlike a pattern, so that no real predecessor id can ride in on the exemption.
 * Check every entry against the frozen predecessor export first: a token that DOES hit there is a
 * real id and belongs in QUOTED_IDS instead.
 *
 * Shape: { token: 'the literal, lower case', why: 'why it is not an id' }
 */
const NOT_IDS = []

/**
 * Foreign ids that MAY appear, each with the reason. Three reasons are on this list today, and a new
 * entry should be rare enough to argue for in review:
 *
 *   - A correction note has to name the id it is correcting (most entries).
 *   - A bead that carries a predecessor chore forward has to name the chore it is carrying, and it
 *     qualifies only because it copies the fact in and cites the in-repo files that hold it.
 *   - A bead about the foreign ids themselves -- the residue list, the export's coverage -- has to
 *     name the ids it is reporting on.
 *
 * Every id here resolves in `history/predecessor-tracker.jsonl` (`grep '"id":"<id>"'`); one that
 * does not is not an id and belongs in NOT_IDS.
 */
// Shape: { bead: 'the citing bead', id: 'the foreign id', why: 'the reason it may appear' }
const QUOTED_IDS = []

/**
 * A bead whose work lands outside this repository must cite the bead carrying that surface's copied
 * facts. The context beads are closed on purpose: they are reference, not work.
 *
 * Shape: a `repo:` label naming a foreign repository, mapped to the id of its context bead. Empty
 * until work lands outside this repository.
 */
const CONTEXT_BEAD = {}

const FIELDS = ['description', 'acceptance_criteria', 'design', 'notes']

const textOf = (bead) => FIELDS.map((f) => (typeof bead[f] === 'string' ? bead[f] : '')).join('\n')

/**
 * Three outcomes, and only the first is a skip:
 *
 *   { kind: 'absent', reason }        no `bd` on PATH at all -- a fresh clone, CI
 *   { kind: 'failed', detail }        a `bd` was found and the export did not happen
 *   { kind: 'ok', beads, launcher }   the export, parsed
 *
 * Nothing here catches an error into "absent": the only route to a skip is the resolver saying the
 * command does not exist.
 */
function loadBeads() {
  const resolved = resolveBd()
  if (!resolved.found) return { kind: 'absent', reason: resolved.reason }
  if (!resolved.runnable) {
    return {
      kind: 'failed',
      detail: `\`bd\` was found at ${resolved.location} but cannot be started: ${resolved.reason}`,
    }
  }
  const { launcher } = resolved
  const through = describeLauncher(launcher)
  let dir
  try {
    dir = mkdtempSync(join(tmpdir(), 'beads-check-'))
    const out = join(dir, 'export.jsonl')
    const run = runBd(launcher, ['export', '--output', out])
    if (run.error) {
      return { kind: 'failed', detail: `spawning ${through} failed: ${run.error.message}` }
    }
    if (run.status !== 0) {
      return {
        kind: 'failed',
        detail:
          `\`bd export\` through ${through} exited ${String(run.status)}` +
          (run.stderr.trim() ? `:\n    ${run.stderr.trim().split('\n').join('\n    ')}` : ''),
      }
    }
    if (!existsSync(out)) {
      return {
        kind: 'failed',
        detail: `\`bd export\` through ${through} exited 0 and wrote nothing at ${out}`,
      }
    }
    const lines = readFileSync(out, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
    try {
      return { kind: 'ok', beads: lines.map((l) => JSON.parse(l)), launcher }
    } catch (err) {
      return {
        kind: 'failed',
        detail: `\`bd export\` through ${through} wrote ${String(lines.length)} line(s) that do not parse as JSONL: ${err.message}`,
      }
    }
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

const loaded = loadBeads()

if (loaded.kind === 'absent') {
  console.log(
    `beads:check -- skipped: \`bd\` is not installed here (${loaded.reason}).\n` +
      '  This gate reads the Dolt issue database, which a fresh clone and CI do not carry.\n',
  )
  process.exit(0)
}

if (loaded.kind === 'failed') {
  console.error(
    'beads:check FAILED -- `bd` is installed here and the export did not happen:\n' +
      `  ${loaded.detail}\n\n` +
      '  A found `bd` is never reported as absent: the skip above is for machines with no tracker,\n' +
      '  and this machine has one. Fix the launcher or the tracker, then re-run.\n',
  )
  process.exit(1)
}

const { beads } = loaded

const failures = []
const isQuoted = (bead, id) =>
  QUOTED_IDS.some((q) => q.bead === bead && q.id.toLowerCase() === id.toLowerCase())

const known = new Set(beads.map((b) => b.id))

for (const bead of beads) {
  const text = textOf(bead)
  const labels = bead.labels ?? []
  const closed = bead.status === 'closed'

  // 1. Unregistered foreign ids.
  for (const m of FOREIGN_ID ? text.matchAll(FOREIGN_ID) : []) {
    const raw = m[0]
    const id = raw.toLowerCase()
    if (OWN_PREFIX && id.startsWith(`${OWN_PREFIX}-`)) continue
    if (EXTENSION_AFTER.test(text.slice(m.index + raw.length))) continue
    if (NOT_IDS.some((n) => n.token === id)) continue
    if (isQuoted(bead.id, id)) continue
    failures.push(
      `${bead.id}: cites \`${raw}\`, an id from the predecessor repository's tracker.\n` +
        `    It does not resolve here -- \`bd show ${raw}\` errors -- so the fact it stands for does\n` +
        `    not travel with the bead. Copy the fact in and cite the in-repo file that carries it,\n` +
        `    or register the id in QUOTED_IDS in scripts/check-beads.mjs with a reason.`,
    )
  }

  // 2. Every open bead says where its work lands.
  if (!closed && !labels.some((l) => l.startsWith('repo:'))) {
    failures.push(
      `${bead.id}: no \`repo:\` label. A bead that does not say which checkout its work lands in\n` +
        `    leaves the reader guessing between this repository and every other one its work could land in.`,
    )
  }

  // 3. Cross-repo beads cite their context bead.
  for (const [label, ctx] of Object.entries(CONTEXT_BEAD)) {
    if (closed) continue
    if (!labels.includes(label)) continue
    if (bead.id === ctx) continue
    if (text.includes(ctx)) continue
    failures.push(
      `${bead.id}: labelled \`${label}\` but does not cite \`${ctx}\`.\n` +
        `    That bead carries the rooted file map and the copied facts for this surface. Without\n` +
        `    it the reader has to open another checkout to find out what a bare basename means.`,
    )
  }
}

// Consistency: the context beads this gate points people at must themselves exist.
for (const [label, ctx] of Object.entries(CONTEXT_BEAD)) {
  if (!known.has(ctx)) {
    failures.push(
      `CONTEXT_BEAD maps ${label} to \`${ctx}\`, which is not in the export.\n` +
        `    This gate would send readers to an id as dead as the ones it forbids. Fix the mapping\n` +
        `    in scripts/check-beads.mjs.`,
    )
  }
}

if (failures.length) {
  console.error('beads:check FAILED\n')
  for (const f of failures) console.error(`  ${f}\n`)
  console.error(
    `${failures.length} problem(s) across ${beads.length} beads.\n` +
      'A bead is read by an agent long after its author is gone, and the tracker is all that\n' +
      'travels with it. Every identifier in it has to resolve from this checkout.\n',
  )
  process.exit(1)
}

console.log(
  `beads:check -- ${beads.length} beads: every identifier resolves here, every open bead names its\n` +
    `  repository, and every cross-repo bead cites its context bead.\n` +
    `  (read through ${describeLauncher(loaded.launcher)})\n`,
)
