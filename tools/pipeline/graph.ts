/**
 * graph.ts — THE RECORD of this repository's generated artifacts: one machine-readable record per
 * node, and the only place an edge between two of them is declared.
 *
 * EMITS. Nothing. It is data with three accessors (`byId`, `digestNodes`, `edges`). Its readers
 * are `check.ts` (does the record still describe the repository?), `stale.ts` through `assess.ts`
 * (has a node's declared input moved since it stamped its output?) and `provenance.ts` (the stamp an
 * emitter writes into its own output, built from this record's input groups).
 *
 * THE FAILURE IT EXISTS TO PREVENT. "Regenerate in the right order" is a question somebody has to
 * answer, and without a record it is answered from memory, a diagram and the comments of several
 * emitters, which disagree. On day one, with no incident of your own yet: if this record were
 * wrong, an input group that matches nothing would fold to a constant digest and report CURRENT
 * forever, and an edge nobody declared would let a change cascade through the staleness gate
 * without one line of output. `npm run pipeline:check` is what holds the record to the files, and
 * the first incident of yours replaces this paragraph.
 *
 * EDGES ARE DECLARED, NOT DERIVED. A derived edge (B reads a file A writes, so A -> B) is silent
 * about a node whose artifacts do not exist yet, and cannot be wrong in a way a check can catch.
 * A declared edge can: `check.ts` fails an UNDECLARED file edge, and reports a declared edge that
 * no file justifies. The point of the record is that it can be wrong out loud.
 *
 * THE PROSE COPY IS HELD TO THIS RECORD BY A GATE THAT IS A FLOOR. `docs/pipeline.md`
 * describes the graph for a reader: a diagram block and a paragraph per node. `check.ts` asserts
 * that every node id here appears on that page and that every node id drawn in its diagram exists
 * here. That catches a node added on one side and forgotten on the other, which is the failure
 * that actually happens. IT CANNOT CATCH A WRONG EDGE; do not mistake it for the real fix. The
 * real fix is to GENERATE the diagram and the per-node lines from this record, so the page cannot
 * disagree with it; until an emitter does that, the page is a second copy and the gate is its floor.
 *
 * THE RETIREMENT RULE. A node KIND whose defining property is that nothing depends on it
 * describes a tool, not a node. Retire the kind with its last member: narrow `NodeKind`, delete the
 * assertion in `check.ts` that existed only for that kind, and leave a note where the records
 * stood, in this shape, so nobody adds it back:
 *
 *   // <KIND> -- RETIRED BY D-NN (<date>), AND THIS COMMENT STANDS WHERE ITS RECORDS STOOD.
 *   // What it was: <one sentence>. Why it went: nothing depended on it, so it was a tool run on
 *   // demand and not a node. DO NOT RE-ADD IT: <what a restored record would wrongly claim>.
 *
 * A single retired NODE leaves the same note in place of its record, and its paragraph and diagram
 * label leave `docs/pipeline.md` in the same commit; `npm run pipeline:check` names the side
 * that was forgotten.
 *
 * INVOCATION. Imported, never run: `import { NODES, byId, edges } from './graph.ts'`.
 * NEEDS. Nothing. No checkout, no network; importing it reads no file.
 *
 * kit 3.6-1 · ADAPT: the two kinds are yours to rename; two is the right number until a third
 * proves itself. `X-EXAMPLE` below is a worked example over three files under
 * `tools/pipeline/example/`, there so that both gates assert something on day one. It is
 * laid down UNSTAMPED, because a stamp folds the paths of your checkout and the kit cannot know
 * them: `npm run pipeline:stale` reports it until you run `npm run pipeline:example` once and
 * commit the result, and from then on the gate binds. TO REMOVE IT once a node of your own exists:
 * delete its record here, the directory `tools/pipeline/example/`, its section and diagram
 * label in `docs/pipeline.md`, the `pipeline:example` script in `package.json` and its name in
 * the table of `scripts/check-jobs.mjs`. `npm run check:jobs` and `npm run pipeline:check`
 * name whatever you miss.
 */

/**
 * A node's lifecycle. `DERIVED` re-runs whole whenever its source moves; `ASSET` is built once and
 * grows on demand. A node id is a capital letter, a hyphen and capitals (`X-EXAMPLE`): that is the
 * shape `check.ts` looks for in the prose page's diagram labels.
 */
export type NodeKind = 'DERIVED' | 'ASSET'

/**
 * What makes a node's output stale. `inputs`: a declared input moved, and the staleness gate FAILS.
 * `grows`: it reopens because a run asked for something absent, not because time passed; reported,
 * never failed, because a push blocked on it is a push sent with `--no-verify`.
 */
export type Staleness = 'inputs' | 'grows'

/**
 * A NAMED group of inputs. The name is what a stale report cites: "X is stale because `<name>`
 * moved" is actionable and "X is stale" is not. A `files` group is digested by content; a
 * `checkout` group is the sibling checkout, recorded as a COMMIT ID and never as a digest (name it
 * `../estate@commit`: `assess.ts` reads that key from a stamp by name).
 */
export type InputGroup =
  | { name: string; kind: 'files'; globs: string[]; mayBeEmpty?: true; note?: string }
  | { name: string; kind: 'checkout'; note?: string }

/**
 * How staleness is detected for a node, or the declaration that it is not, with the reason the
 * gate prints.
 *  - `digest`: the emitter writes `stampFor(id)` into its own output under `stamp.key`, and
 *    `pipeline:stale:check` re-folds the declared inputs against it without running anything.
 *  - `legacy-commit`: the output records only the sibling checkout's commit under `stamp.key`.
 *  - `regeneration`: a `:check` script rebuilds the whole output in memory and byte-compares it;
 *    `where` says which tiers run it, and `check.ts` verifies that claim against the hook runner's
 *    configuration and `.github/workflows/verify.yml` rather than taking it on trust. Prefer it wherever every input is a
 *    committed file of this repository: it catches strictly more than a digest can.
 *  - `none`: no gate. `why` is printed on every `pipeline:stale --verbose`, so the gap stays visible.
 */
export type Detection =
  | { via: 'digest'; stamp: { path: string; key: string } }
  | { via: 'legacy-commit'; stamp: { path: string; key: string } }
  | { via: 'regeneration'; script: string; where: 'CI' | 'pre-push' | 'CI + pre-push' }
  | { via: 'none'; why: string }

export interface PipelineNode {
  id: string
  kind: NodeKind
  title: string
  /** The prompt file that drives this node, repository-relative, or null where none does. */
  prompt: string | null
  staleness: Staleness
  detection: Detection
  /** BLOCKING edges: ids of the nodes this one must run after. Checked for cycles. */
  dependsOn: string[]
  /** Non-blocking edges: read for reconciliation only, and allowed to form a cycle. */
  advisoryOn?: string[]
  inputs: InputGroup[]
  /** Globs of every file this node writes. */
  outputs: string[]
  /** Globs of the source that turns the inputs into the outputs; a code change is an input too. */
  generator: string[]
  /** The command line a stale report prints. */
  regenerate: string
  /** The `package.json` script behind `regenerate`, or null where it is not one. */
  regenerateScript: string | null
  /** The `package.json` script that checks the output, or null. */
  check: string | null
  /** True where the generator reads the sibling checkout, so CI cannot run it. */
  needsEstateCheckout: boolean
}

/**
 * The source every digest stamp's arithmetic lives in; spread it into a digest node's `generator`
 * so that a change to how stamps are computed restamps the nodes that carry one. NOT this file: it
 * is data, and hashing the whole record would restamp every node for a comment edit.
 * `provenance.ts` folds each node's OWN record fields instead.
 */
export const STAMP_SOURCES: string[] = [
  'tools/pipeline/glob.ts',
  'tools/pipeline/digest.ts',
  'tools/pipeline/provenance.ts',
]

export const NODES: PipelineNode[] = [
  {
    /*
     * THE WORKED EXAMPLE. One hand-maintained input, one emitter, one output that carries the
     * stamp. Every glob is a literal path under `tools/pipeline/example/`, so it couples to
     * nothing else in the repository and leaves with its directory.
     *
     * Its detection is `digest` so that the staleness gate has a stamp to read; that is the
     * mechanism the example is here to show. A node of yours whose inputs are all committed files
     * would declare `regeneration` and job its `:check` twin instead. `check` is null because the
     * example's twin (`emit.ts --check`) has no package script of its own: one more public name to
     * delete. A real node names its `:check` script here, and a stale report prints it.
     */
    id: 'X-EXAMPLE',
    kind: 'DERIVED',
    title: 'The worked example: a summary of one hand-maintained list',
    prompt: null,
    staleness: 'inputs',
    detection: {
      via: 'digest',
      stamp: { path: 'tools/pipeline/example/summary.json', key: 'provenance' },
    },
    dependsOn: [],
    inputs: [
      {
        name: 'example entries',
        kind: 'files',
        globs: ['tools/pipeline/example/entries.json'],
        note: 'Hand-maintained. The emitter reads it and nothing writes it.',
      },
    ],
    outputs: ['tools/pipeline/example/summary.json'],
    generator: ['tools/pipeline/example/emit.ts', ...STAMP_SOURCES],
    regenerate: 'npm run pipeline:example',
    regenerateScript: 'pipeline:example',
    check: null,
    needsEstateCheckout: false,
  },

  /*
   * THE SHAPE OF A SECOND NODE, downstream of the first, for the first emitter of yours that CI
   * cannot re-run (it reads the sibling checkout, a token, a network). The edge is DECLARED in
   * `dependsOn`; `check.ts` fails the record if the input glob below matched a file `X-EXAMPLE`
   * writes and the edge were missing.
   *
   *   {
   *     id: 'D-MEASURE',
   *     kind: 'DERIVED',
   *     title: '<what it measures>',
   *     prompt: '<the prompt file that drives it>',
   *     staleness: 'inputs',
   *     detection: { via: 'digest', stamp: { path: 'artifacts/measure/result.json', key: 'provenance' } },
   *     dependsOn: ['X-EXAMPLE'],
   *     inputs: [
   *       { name: 'example summary', kind: 'files', globs: ['tools/pipeline/example/summary.json'] },
   *       { name: '../estate@commit', kind: 'checkout' },
   *     ],
   *     outputs: ['artifacts/measure/**'],
   *     generator: ['tools/measure/**', ...STAMP_SOURCES],
   *     regenerate: 'npm run measure',
   *     regenerateScript: 'measure',
   *     check: 'measure:check',
   *     needsEstateCheckout: true,
   *   },
   *
   * A stamped output is committed by the run that stamps it. Never write a stamp by hand: it folds
   * this record's own group names and globs, so a copied stamp is stale on arrival.
   */
]

const BY_ID = new Map(NODES.map((n) => [n.id, n]))

export const byId = (id: string): PipelineNode | undefined => BY_ID.get(id)

/** The nodes whose staleness is read from a stamp in their own output. */
export const digestNodes = (): PipelineNode[] =>
  NODES.filter((n) => n.detection.via === 'digest' || n.detection.via === 'legacy-commit')

/** Every declared edge, `from` the dependency `to` the dependant, in record order. */
export function edges(): { from: string; to: string; advisory: boolean }[] {
  const out: { from: string; to: string; advisory: boolean }[] = []
  for (const n of NODES) {
    for (const d of n.dependsOn) out.push({ from: d, to: n.id, advisory: false })
    for (const d of n.advisoryOn ?? []) out.push({ from: d, to: n.id, advisory: true })
  }
  return out
}
