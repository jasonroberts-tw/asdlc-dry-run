/**
 * `npm run pipeline:check` -- does `tools/pipeline/graph.ts` still describe this repository?
 *
 * The manifest is a hand-maintained record of a graph that moves. Every other consumer of it -- the
 * staleness gate, the generated mermaid block, and the `bd dep add` wiring that comes later -- is
 * only as good as the record, and the failure mode of a wrong record is the quiet one: an input
 * group that matches nothing folds to a constant digest and reports CURRENT forever.
 *
 * That is not hypothetical. `control-map.json` cited `artifacts/pilot-scope.json` for three days
 * after D-09 renamed it to `artifacts/slices/<id>/scope.json`, and nothing in the repository
 * reported the dead citation. An input glob matching zero files is exactly that shape, so it is an
 * ERROR here rather than a warning.
 *
 * This check runs no generator and needs no `../estate` checkout.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkFormulas } from './formulas.ts'
import { filesMatching } from './glob.ts'
import { NODES, edges, type PipelineNode } from './graph.ts'
import { ROOT } from './provenance.ts'

const problems: string[] = []
const notes: string[] = []
const formulaNotes: string[] = []

const fail = (node: string, msg: string): void => void problems.push(`${node}: ${msg}`)

const scripts = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts

const ids = new Set(NODES.map((n) => n.id))

/* ----------------------------------------------------------------------------------------------- *
 * Shape
 * ----------------------------------------------------------------------------------------------- */

const seen = new Set<string>()
for (const n of NODES) {
  if (seen.has(n.id)) fail(n.id, 'declared twice')
  seen.add(n.id)
}

for (const n of NODES) {
  for (const d of [...n.dependsOn, ...(n.advisoryOn ?? [])]) {
    if (!ids.has(d)) fail(n.id, `depends on "${d}", which is not a node`)
    if (d === n.id) fail(n.id, 'depends on itself')
  }

  // TWO SLICE CHECKS STOOD HERE until D-33 retired the kind: a SLICE node declared anything but
  // `'never'` without an `exceptionWhy`, and an `exceptionWhy` on a node needing no exception. The
  // enum was the decision -- a SLICE node that was not `'never'` queued work to rewrite a delivered
  // cut -- and with no SLICE nodes, no `'never'` value and no `exceptionWhy` field, the type system
  // now refuses what these two asserted. `pipeline:selftest` § 8 keeps the structural half.

  // A digest-stamped node must stamp one of its OWN outputs. Stamping something else would put the
  // record of what a node was built from in a file some other node overwrites.
  if (n.detection.via === 'digest' || n.detection.via === 'legacy-commit') {
    const stamped = n.detection.stamp.path
    const covered = n.outputs.some((g) => filesMatching(ROOT, [g]).includes(stamped))
    if (!covered) fail(n.id, `stamps ${stamped}, which none of its declared outputs matches`)
  }
  if (n.detection.via === 'digest' && !n.inputs.length) {
    fail(n.id, 'is digest-stamped but declares no inputs, so its digest is a constant')
  }
  if (n.detection.via === 'digest' && !n.generator.length) {
    fail(n.id, 'is digest-stamped but declares no generator source, so a code change is invisible')
  }
}

/* ----------------------------------------------------------------------------------------------- *
 * Cycles -- over BLOCKING edges only
 *
 * Advisory edges are excluded because the real one in this graph IS a cycle by construction: N-12
 * reconciles leaf labels against the route table its own output derives. Folding it in would make
 * this check permanently red and teach everyone to ignore it. (There were four such edges: N-20
 * reordering the backlog went with D-30; N-15 subtracting what N-16 and N-21 bought,
 * N-11 and N-22 reading each other, and N-01 cross-checking N-21's closure all went
 * with the SLICE kind under D-33.)
 * ----------------------------------------------------------------------------------------------- */

{
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (id: string): void => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      const from = stack.indexOf(id)
      problems.push(`cycle: ${[...stack.slice(from), id].join(' -> ')}`)
      return
    }
    state.set(id, 'visiting')
    stack.push(id)
    for (const d of NODES.find((n) => n.id === id)?.dependsOn ?? []) if (ids.has(d)) visit(d)
    stack.pop()
    state.set(id, 'done')
  }
  for (const n of NODES) visit(n.id)
}

/* ----------------------------------------------------------------------------------------------- *
 * Globs resolve to something
 * ----------------------------------------------------------------------------------------------- */

/*
 * THE SLICE EXEMPTION IS GONE, and this note records that it was removed rather than lost.
 *
 * Until D-33 an empty glob had exactly one exception, `existsOnlyWithAnAdmittedSlice`: a path under
 * `artifacts/slices/`, or N-03's merged contract derived from the admitted set, could not
 * exist until the node that wrote it had run for an admitted slice, and matching nothing was a fact
 * about lane position rather than a dead citation. Such a glob was reported as a NOTE, with
 * `noSliceAdmitted` choosing between "no slice is admitted yet" and "the node has not run for an
 * admitted slice". The exemption had its own history worth one line each: it was gated on
 * `noSliceAdmitted` at first, which made the repository un-green between N-21 and N-22 on any
 * branch the moment slice 004 landed the first `scope.json`; D-27's transitional exemption for
 * `specs/slices/` closed when that slice wrote its overview; and a tracked issue
 * carried a tighter prefix rule that D-30 unblocked and D-33 has now made moot.
 *
 * D-33 retired every SLICE node and N-03, and deleted every path the
 * exemption named. So the header's rule holds for every node without exception: an input, output or
 * generator glob that matches no file is an ERROR here, because the only thing it can now be is a
 * citation nothing reported.
 */

function checkGlobs(n: PipelineNode, what: string, globs: readonly string[]): void {
  for (const g of globs) {
    if (filesMatching(ROOT, [g]).length) continue
    fail(n.id, `${what} glob matches no file: ${g}`)
  }
}

for (const n of NODES) {
  for (const group of n.inputs) {
    if (group.kind === 'checkout') continue
    if (group.mayBeEmpty) continue
    if (!filesMatching(ROOT, group.globs).length) {
      fail(n.id, `input group "${group.name}" matches no file (globs: ${group.globs.join(', ')})`)
    }
  }
  checkGlobs(n, 'output', n.outputs)
  checkGlobs(n, 'generator', n.generator)
}

/* ----------------------------------------------------------------------------------------------- *
 * Every node's `prompt` names a file that is there
 *
 * This was the graph's least-checked claim and it stayed that way for a while: the manifest/prose
 * check below asserts that every node id APPEARS in `docs/pipeline.md` and never opened
 * `prompt` at all, so the field could name a file that had been retired, moved or never existed and
 * nothing said so.
 *
 * It cost something, and the instance is historical twice over -- the node it happened to is gone.
 * `S-BASELINE` (retired by D-24) named `verify-layout.md` -- a 226-line harness spec that D-12, D-15,
 * D-16 and D-18 had retired around a single surviving paragraph, and which carried no
 * `## S-BASELINE` heading at all, so the five references to a `§S-BASELINE` section of it resolved to
 * nothing. A tracked issue moved the live brief to `artifacts/design-system/CAPTURE-PROTOCOL.md` and
 * retired the remainder to `docs/retired/`; had this check existed, the retirement would have failed
 * a gate here instead of being found by an audit.
 *
 * Existence is the floor, deliberately. It cannot tell that a prompt still DESCRIBES its node -- only
 * that a reader following the pointer arrives at a file. That is the failure that actually happens: a
 * prompt is retired or moved on one side and the manifest is not updated on the other.
 *
 * `prompt` is repository-relative, not root-relative-with-a-directory-convention. Every live node's
 * now sits at the repository root -- `S-BASELINE`'s was the one exception, under `artifacts/`, and it
 * left with the node -- but joining against ROOT is what keeps both spellings one check, so a future
 * prompt that belongs beside its evidence rather than at the root needs no change here.
 * ----------------------------------------------------------------------------------------------- */

for (const n of NODES) {
  if (n.prompt === null) continue
  if (!existsSync(join(ROOT, n.prompt))) {
    fail(
      n.id,
      `names prompt "${n.prompt}", which does not exist. A retired or moved prompt leaves this` +
        ' field pointing at nothing, and a reader who follows it concludes the node is undocumented' +
        ' rather than that the record is wrong. Repoint it, or set `prompt: null` with a comment.',
    )
  }
}

/* ----------------------------------------------------------------------------------------------- *
 * npm scripts exist
 * ----------------------------------------------------------------------------------------------- */

for (const n of NODES) {
  if (n.regenerateScript && !(n.regenerateScript in scripts)) {
    fail(n.id, `regenerateScript "${n.regenerateScript}" is not in package.json`)
  }
  if (n.check && !(n.check in scripts)) {
    fail(n.id, `check "${n.check}" is not in package.json`)
  }
  if (n.detection.via === 'regeneration' && !(n.detection.script in scripts)) {
    fail(n.id, `detection script "${n.detection.script}" is not in package.json`)
  }
}

/* ----------------------------------------------------------------------------------------------- *
 * A `regeneration` node's `where` is verified against the hooks, not taken on trust
 *
 * `detection: { via: 'regeneration' }` is how a node opts OUT of the digest gate, on the grounds that
 * a stronger whole-output check already runs somewhere binding. When that claim is false the node has
 * no gate at all, AND `pipeline:stale` prints a reassuring "covered by `npm run X`" line about it --
 * which is worse than claiming nothing, because it reads as a green answer to a question nobody
 * asked. Existing in `package.json` is not the same as running; this asserts the second.
 * ----------------------------------------------------------------------------------------------- */

{
  const lefthook = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8')
  const ci = readFileSync(join(ROOT, '.github/workflows/verify.yml'), 'utf8')
  // Anchored on `run: npm run <script>` -- or `run: node --run <script>`, the pre-push hook's
  // launcher -- so that a mention inside a comment -- of which these two files
  // have many, several naming scripts they deliberately do NOT run -- is not counted.
  const runs = (haystack: string, script: string): boolean =>
    new RegExp(
      `\\brun:\\s*(?:npm run|node --run) ${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|")`,
      'm',
    ).test(haystack)

  for (const n of NODES) {
    if (n.detection.via !== 'regeneration') continue
    const { script, where } = n.detection
    const inCi = runs(ci, script)
    const inHook = runs(lefthook, script)
    const actual = inCi && inHook ? 'CI + pre-push' : inCi ? 'CI' : inHook ? 'pre-push' : 'nowhere'
    if (actual === 'nowhere') {
      fail(
        n.id,
        `claims its staleness is covered by \`npm run ${script}\`, but that script runs in neither` +
          ' lefthook.yml nor verify.yml. Either wire it up, or change detection to `none` with the' +
          ' gap written down -- a node must not report itself covered by a gate nobody runs.',
      )
    } else if (actual !== where) {
      fail(n.id, `declares \`${script}\` runs in "${where}"; it actually runs in "${actual}"`)
    }
  }
}

/* ----------------------------------------------------------------------------------------------- *
 * Edges cross-examined against the file sets
 *
 * A declared edge A -> B should be visible in the files: something A emits should be something B
 * reads. This cannot be an ERROR in both directions, and the asymmetry is the point.
 *
 *  - A declared edge with NO file-level justification is reported, not failed. Real edges are not
 *    always file edges: N-09 depends on N-10 through the corpus glob it shares with every
 *    node, and the retired N-05's dependence on N-04 was a schema keeping up with components
 *    rather than a file it opened.
 *  - An UNDECLARED file edge -- B digests a file A emits, and B does not name A -- IS an error. That
 *    is the manifest failing to describe a dependency the digest gate will otherwise cascade
 *    through silently, and it is the direction that produces a wrong `bd ready` frontier.
 * ----------------------------------------------------------------------------------------------- */

{
  const emits = new Map<string, Set<string>>()
  for (const n of NODES) emits.set(n.id, new Set(filesMatching(ROOT, n.outputs)))

  const declared = new Set(edges().map((e) => `${e.from}->${e.to}`))

  for (const n of NODES) {
    const reads = new Set(
      n.inputs.flatMap((g) => (g.kind === 'checkout' ? [] : filesMatching(ROOT, g.globs))),
    )
    if (!reads.size) continue
    for (const other of NODES) {
      if (other.id === n.id) continue
      const overlap = [...(emits.get(other.id) as Set<string>)].filter((f) => reads.has(f))
      if (!overlap.length) continue
      if (!declared.has(`${other.id}->${n.id}`)) {
        fail(
          n.id,
          `digests ${overlap.length} file(s) emitted by ${other.id} (e.g. ${overlap[0]}) but does` +
            ` not declare it in dependsOn or advisoryOn`,
        )
      }
    }
  }

  for (const e of edges()) {
    if (e.advisory) continue
    const to = NODES.find((n) => n.id === e.to) as PipelineNode
    if (!to.inputs.length) continue
    const reads = new Set(
      to.inputs.flatMap((g) => (g.kind === 'checkout' ? [] : filesMatching(ROOT, g.globs))),
    )
    const overlap = [...(emits.get(e.from) ?? new Set<string>())].filter((f) => reads.has(f))
    if (!overlap.length) notes.push(`${e.from} -> ${e.to} is declared but is not a file edge`)
  }
}

/* ----------------------------------------------------------------------------------------------- *
 * The manifest against the prose
 *
 * The design note is blunt about the risk this record itself carries:
 *
 *   > **Do not add a fifth prose copy of the graph.** If the manifest does not *generate* the
 *   > mermaid block and the STALE WHEN lines, it is one more thing to keep in sync.
 *
 * Generating them is the right answer and is a tracked issue. Until then this is the floor: every
 * node id here must appear in `docs/pipeline.md`, and every node id drawn in that file's
 * mermaid block must exist here. It cannot catch a wrong EDGE, but it does catch the failure that
 * actually happens -- a node added or renamed on one side and forgotten on the other -- which is how
 * the four existing copies came to disagree in the first place.
 * ----------------------------------------------------------------------------------------------- */

{
  const prompts = readFileSync(join(ROOT, 'docs/pipeline.md'), 'utf8')
  for (const n of NODES) {
    // NO EXEMPTION STANDS HERE. `N-13` was the last: a sub-node of N-12 in the prose, named
    // in the prompt file's N-12 row by its command rather than by an id, so an id search would have
    // failed on a node the docs did describe. `N-19` was the other and D-30 retired it;
    // D-37 retired N-13, so every node id is searched for exactly as written.
    if (!prompts.includes(n.id)) {
      fail(n.id, 'is not mentioned anywhere in docs/pipeline.md')
    }
  }

  const mermaid = prompts.slice(
    prompts.indexOf('```mermaid'),
    prompts.indexOf('```', prompts.indexOf('```mermaid') + 3),
  )
  // Node labels look like `CR["N-08<br/>archetypes"]` or `SA["N-16"]`. Some drawn labels put
  // prose straight after the id (`SP["N-17 bind"]`) and are not matched; the count is deliberately
  // not stated here, because it moved when D-24 removed `SB["S-BASELINE<br/>screenshots"]` and a
  // stale numeral in a comment is worse than none. This is a floor, not a parser, and generating
  // the block outright replaces it.
  for (const [, drawn] of mermaid.matchAll(/\["([A-Z]-[A-Z-]+?)(?:<|")/g)) {
    if (!ids.has(drawn as string)) {
      problems.push(`mermaid: draws "${drawn}", which is not a node in tools/pipeline/graph.ts`)
    }
  }
}

/* ----------------------------------------------------------------------------------------------- *
 * The manifest against the `bd` formula
 *
 * The prose check above closes the loop with `docs/pipeline.md`. This one closes it with
 * `.beads/formulas/corpus-regen.formula.toml`, which the header of `graph.ts` calls "another copy"
 * of the graph. (There were two formulas until D-33 deleted `slice.formula.toml` with the SLICE
 * kind.)
 *
 * The assertions, why each is a failure or a note, and the things deliberately NOT asserted are all
 * documented in `tools/pipeline/formulas.ts`. It lives in its own module for two reasons: this file
 * is long enough, and `pipeline:selftest` needs the logic importable so it can run it against a
 * fixture that reintroduces the drift -- an assertion nothing has ever watched fail is an assertion
 * on trust. The resolver of every declared gate, the absence of one at the lane's entry, the lane's
 * connectedness and -- since D-33 -- the cascade's coverage of every node
 * downstream of N-10 are FAILURES; a prose citation of a retired script is the one note.
 * ----------------------------------------------------------------------------------------------- */

{
  const formula = checkFormulas(ROOT, scripts)
  problems.push(...formula.problems)
  formulaNotes.push(...formula.notes)
}

/* ----------------------------------------------------------------------------------------------- *
 * Report
 * ----------------------------------------------------------------------------------------------- */

console.log(`pipeline:check -- ${NODES.length} nodes, ${edges().length} edges\n`)

if (notes.length) {
  console.log('Declared edges with no file-level justification (expected for non-file edges):')
  for (const n of notes) console.log(`  - ${n}`)
  console.log()
}

if (formulaNotes.length) {
  console.log('Formula observations (reported, not failed -- see tools/pipeline/formulas.ts):')
  for (const n of formulaNotes) console.log(`  - ${n}`)
  console.log()
}

if (problems.length) {
  console.error(`${problems.length} manifest problem(s):\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('\ntools/pipeline/graph.ts no longer describes this repository. Fix the record.')
  process.exit(1)
}

console.log('The manifest matches the repository.')
