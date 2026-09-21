/**
 * `npm run pipeline:stale` / `pipeline:stale:check` -- the cheap universal staleness gate.
 *
 * WHAT THIS IS FOR. Every other staleness gate here works by regenerating a node's whole output and
 * diffing it, so automated detection reaches exactly as far as the nodes whose inputs all live in
 * this repository. a node, a node and a node are the three it cannot reach: each one's `--check`
 * needs the sibling `../estate` checkout, so it is wired into neither `lefthook.yml` nor
 * `.github/workflows/verify.yml` and runs only when somebody remembers to type it. CI does not clone
 * that checkout and should not -- one node's deepest walk is minutes cold over the
 * whole estate.
 *
 * This gate does not run a generator. It re-folds each node's declared inputs and compares the fold
 * against the stamp the node wrote into its own output. That is a hash walk over `artifacts/**` --
 * milliseconds, no checkout -- which is what puts those three nodes behind an automated gate for the
 * first time.
 *
 * WHAT THIS IS NOT FOR. It does not replace `archetypes:check` / `portfolio:check` /
 * `navigation:check`, and those must NOT move into CI. They regenerate the whole output and diff it,
 * which catches strictly more than a digest can; they stay the deep local gate, run before quoting a
 * number out of their output. This gate is what makes FORGETTING to run them visible.
 *
 * IT ALSO DOES NOT QUEUE WORK. `--queue` is deliberately absent -- see the note at the foot of this
 * file.
 */
import { assess, fails, isDebt, type Report, type Verdict } from './assess.ts'
import { NODES } from './graph.ts'

const CHECK = process.argv.includes('--check')
const VERBOSE = process.argv.includes('--verbose')

const SYMBOL: Record<Verdict, string> = {
  current: 'OK      ',
  stale: 'STALE   ',
  unstamped: 'UNSTAMPED',
  absent: 'ABSENT  ',
  unverifiable: 'SKIPPED ',
  'pin-drift': 'PIN-DRIFT',
  'not-applicable': '--      ',
}

const reports = NODES.map((n) => assess(n))
const failing = reports.filter(fails)
const debt = reports.filter(isDebt)

const width = Math.max(...reports.map((r) => r.node.id.length))
const show = VERBOSE ? reports : reports.filter((r) => r.verdict !== 'not-applicable')

console.log(
  "PIPELINE STALENESS -- declared inputs re-folded against the stamp in each node's output\n",
)
for (const r of show) {
  console.log(`  ${SYMBOL[r.verdict]} ${r.node.id.padEnd(width)}  ${r.detail}`)
}
if (!VERBOSE) {
  const hidden = reports.length - show.length
  if (hidden)
    console.log(`\n  (${hidden} node(s) not assessed here -- \`--verbose\` says why for each)`)
}

const fixLines = (r: Report): void => {
  // PIN-DRIFT HAS NO "run this" LINE, deliberately. Printing the extractor command beside it would
  // read as an instruction to rebase the corpus, which is the single most expensive thing this
  // pipeline can be talked into doing casually -- `.beads/formulas/corpus-regen.formula.toml` is
  // four paragraphs of failure modes that all look like success. The choice is a human's.
  if (r.verdict === 'pin-drift') {
    console.log('      to CHECK this node: return the checkout to the pinned commit first.')
    console.log('      to MOVE the pin: bd mol wisp corpus-regen --var reason="<new commit>"')
    return
  }
  console.log(`      run: ${r.node.regenerate}`)
  if (r.node.check) console.log(`      then verify: npm run ${r.node.check}`)
  if (r.node.needsEstateCheckout) {
    console.log('      NEEDS the sibling ../estate checkout; cannot be done in CI.')
  }
}

if (debt.length) {
  console.log('\nREPORTED, NOT GATED')
  console.log('-------------------')
  // Said once, up front, because it invalidates the `then verify:` line printed against three of the
  // nodes below. With the checkout ahead of the pin, `archetypes:check` / `portfolio:check` /
  // `navigation:check` rebuild from newer source than the artifacts were built from and report a
  // correct artifact as stale.
  if (debt.some((r) => r.verdict === 'pin-drift')) {
    console.log(
      '\n  NOTE: the checkout is ahead of the pinned corpus commit, so any `npm run <node>:check`\n' +
        '  below will report STALE whether or not the artifact is. Return the checkout to the pin\n' +
        '  before trusting one.',
    )
  }
  for (const r of debt) {
    const why =
      r.verdict === 'pin-drift'
        ? 'NOT A DEFECT. The corpus is a deliberate snapshot and the checkout has simply been pulled past it. Returning the checkout to the pin, or rebasing the corpus onto the newer commit, are both decisions -- neither is a repair.'
        : r.node.staleness === 'grows'
          ? 'ASSET, `grows`: reopens because a run asked for something absent, not because time passed. Worth a bead, not worth failing a push.'
          : r.node.detection.via === 'legacy-commit'
            ? 'The sibling ../estate checkout has diverged from the pin. No commit in THIS repository caused it and none can fix it without a supervised re-extraction, so it is not a push gate.'
            : 'This artifact predates the provenance stamp, so there is nothing to compare it against. This node becomes gated the first time its emitter runs.'
    console.log(`\n  ${r.node.id} -- ${r.detail}`)
    console.log(`      why not gated: ${why}`)
    fixLines(r)
  }
}

if (failing.length) {
  console.error(`\n${failing.length} node(s) are out of date with their declared inputs:\n`)
  for (const r of failing) {
    console.error(`  ${r.node.id} -- ${r.detail}`)
    console.error(`      run: ${r.node.regenerate}`)
    if (r.node.check) console.error(`      then verify: npm run ${r.node.check}`)
    if (r.node.needsEstateCheckout) {
      console.error('      NEEDS the sibling ../estate checkout; this cannot be done in CI.')
    }
  }
  console.error(
    '\nThe digest gate never runs a generator, so it cannot tell you WHAT changed inside the\n' +
      "output -- only that the inputs it was justified against have moved. Run the node's own\n" +
      '`--check` for that.',
  )
  if (CHECK) process.exit(1)
}

const current = reports.filter((r) => r.verdict === 'current').length
console.log(
  `\npipeline: ${current} current, ${failing.length} stale and gated, ${debt.length} reported`,
)

/* ----------------------------------------------------------------------------------------------- *
 * `--queue` IS NOT HERE, AND ITS ABSENCE IS DELIBERATE.
 *
 * The design note places queueing on `post-merge`, never on `pre-push`: a
 * hook that writes to the issue tracker on every push is a hook that gets bypassed, and staleness
 * becomes WORK when a change lands on trunk rather than when somebody is trying to push. It also
 * branches -- an in-repo artifact digest gets per-node beads, but the upstream commit moving gets
 * `bd mol wisp corpus-regen`, because that formula already encodes invariants a generic
 * "regenerate a node" bead would lose.
 *
 * Neither belongs in a file wired into `pre-push`.
 * ----------------------------------------------------------------------------------------------- */
