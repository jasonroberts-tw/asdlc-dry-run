/**
 * The uniform provenance stamp: what a node was built FROM, written into what it built.
 *
 * The convention half-existed already and in four incompatible shapes -- `classification.json` and
 * `coverage.json` open with `node` + `estateHead`, `routes.json` has a `source` block,
 * `control-map.json` has `generatedFrom`. All four are keyed on the wrong thing.
 * The design note measured why:
 *
 *   > **`estateHead` cannot detect the change that actually happened.** The pinned commit is
 *   > the same today as it was weeks ago. It did not move. What moved was
 *   > one input group, from 1,205 documents to 1,257.
 *
 * So the stamp is over CONTENT. The existing `estateHead` / `source` blocks are left exactly
 * where they are: they are cited in prose and read by `tools/portfolio/coverage.ts` and
 * `tools/navigation/spec-routes.ts`, and this block is additive rather than a replacement.
 *
 * ---------------------------------------------------------------------------------------------
 * `generatedAtUtc` IS STICKY, AND THAT IS NOT A ROUNDING OF THE TRUTH.
 *
 * `tools/portfolio/index.ts` states the rule this repository runs on, beside `estateHead`:
 *
 *   > NOT a timestamp: a committed artifact carrying a wall clock makes two runs of an unchanged
 *   > repo differ and breaks every `git diff --exit-code` gate downstream.
 *
 * That rule is right and every `--check` in this repository is a byte-exact compare that depends on
 * it. A naive `new Date().toISOString()` here would turn `archetypes:check`, `portfolio:check` and
 * `navigation:check` permanently red.
 *
 * The field is kept because the design note asks for it and because it answers a real question --
 * *when was this content last justified?* -- and it is made deterministic by CARRYING IT FORWARD:
 * when the freshly-computed digests equal the ones already on disk, the prior timestamp is reused
 * verbatim. Two runs of an unchanged repository are byte-identical. A run whose inputs or generator
 * moved gets a new timestamp, which is the only time the answer to that question has changed.
 * ---------------------------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitEnv, resolveEstateRoot } from '../lib/estate-root.ts'
import { digestGlobs, foldGroups, stringDigest, type Digest } from './digest.ts'
import { byId, type PipelineNode } from './graph.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** This checkout -- the worktree when running in one, the primary checkout otherwise. */
export const ROOT = resolve(HERE, '../..')

/** The value recorded for an input group whose commit could not be read. Never silently ''. */
export const UNKNOWN_COMMIT = 'unknown'

export interface ProvenanceStamp {
  /** The node id from `graph.ts`. Present so an artifact says what produced it. */
  node: string
  /** ISO-8601 UTC, second precision. Sticky -- see the header. */
  generatedAtUtc: string
  /** Digest of the node's declared `generator` source globs. */
  generatorDigest: string
  /** Input group name -> group digest, or a commit id for the `checkout` group. */
  inputs: Record<string, string>
  /** Fold of `inputs`. The single value `pipeline:stale` compares. */
  inputsDigest: string
}

/**
 * How the live checkout stands relative to the commit an artifact was pinned at.
 *
 *  - `'same'`     — the checkout is at the pin. The only state in which the three corpus `--check`s
 *                   are meaningful.
 *  - `'ahead'`    — the pin is an ANCESTOR of HEAD: somebody pulled. This is the ordinary state of a
 *                   working checkout and is NOT a defect. The corpus is a deliberate snapshot, and
 *                   `layout-extraction.md` says so outright: *"every downstream artifact is pinned to
 *                   the commit in provenance.json, so a re-run invalidates comparisons across the
 *                   boundary."* Moving to the newer commit is a DECISION, not a repair.
 *  - `'diverged'` — the pin is not reachable from HEAD. That one IS suspicious: the artifacts cite a
 *                   commit this checkout cannot produce, which is the shape of a resurrected or
 *                   force-pushed branch.
 *  - `'unknown'`  — no checkout, or git could not answer.
 */
export type CommitRelation = 'same' | 'ahead' | 'diverged' | 'unknown'

export function commitRelation(pinned: string, live: string, root: string = ROOT): CommitRelation {
  if (live === UNKNOWN_COMMIT || pinned === UNKNOWN_COMMIT) return 'unknown'
  if (live === pinned) return 'same'
  try {
    const bo = resolveEstateRoot(root)
    execFileSync('git', ['-C', bo, 'merge-base', '--is-ancestor', pinned, live], {
      stdio: 'ignore',
      env: gitEnv(),
    })
    return 'ahead'
  } catch {
    return 'diverged'
  }
}

/** How many commits the checkout has moved past the pin. `null` where git cannot say. */
export function commitsAhead(pinned: string, live: string, root: string = ROOT): number | null {
  try {
    const bo = resolveEstateRoot(root)
    const n = execFileSync('git', ['-C', bo, 'rev-list', '--count', `${pinned}..${live}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: gitEnv(),
    }).trim()
    return Number.isFinite(Number(n)) ? Number(n) : null
  } catch {
    return null
  }
}

/** The live `../estate` HEAD, or `'unknown'` where there is no checkout (CI, a fresh clone). */
export function estateCommit(root: string = ROOT): string {
  try {
    const bo = resolveEstateRoot(root)
    if (!existsSync(bo)) return UNKNOWN_COMMIT
    return execFileSync('git', ['-C', bo, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      // `GIT_DIR` outranks `-C`, and git exports it to every hook.
      env: gitEnv(),
    }).trim()
  } catch {
    return UNKNOWN_COMMIT
  }
}

/** Per-group digests plus the files each group resolved to, for reporting. */
export interface ComputedInputs {
  inputs: Record<string, string>
  inputsDigest: string
  /** Group name -> the files it matched. A `checkout` group has none. */
  files: Record<string, string[]>
  /** Group names whose value is a commit id rather than a digest of content. */
  unhashable: string[]
}

export function computeInputs(node: PipelineNode, root: string = ROOT): ComputedInputs {
  const inputs: Record<string, string> = {}
  const files: Record<string, string[]> = {}
  const unhashable: string[] = []
  for (const g of node.inputs) {
    if (g.kind === 'checkout') {
      inputs[g.name] = estateCommit(root)
      unhashable.push(g.name)
      continue
    }
    const { digest, files: matched } = digestGlobs(root, g.globs)
    inputs[g.name] = digest
    files[g.name] = matched
  }
  return { inputs, inputsDigest: foldGroups(inputs), files, unhashable }
}

/**
 * The node's OWN declared record, canonicalised for hashing.
 *
 * `tools/pipeline/graph.ts` used to be listed in `STAMP_SOURCES`, which made this a byte digest of
 * the entire 21-node manifest: appending one comment moved every stamped node's `generatorDigest`,
 * turning `pipeline:stale:check` red for a node, a node and a node together, in `pre-push` and
 * in CI, with the only printed remedy being a generator run CI cannot perform. See the note on
 * `STAMP_SOURCES`.
 *
 * The claim it was reaching for is real and is kept here: `stampFor(nodeId)` reads this node's
 * record, so the record decides what the stamp SAYS. Only these four fields do, and each is here for
 * a reason rather than for completeness:
 *
 *  - `id`      -> written to the stamp verbatim as `node`.
 *  - `inputs`  -> the group NAMES and GLOBS become the stamp's `inputs` keys and values. This is the
 *                 field that matters: adding, renaming, re-globbing or dropping a group changes the
 *                 stamp even when not one byte under `artifacts/**` has moved.
 *  - `generator` -> the glob LIST, so widening or narrowing it is visible even where the resolved
 *                 file set happens to be unchanged.
 *  - `detection.stamp` -> which file and key the prior stamp is read from, and therefore what the
 *                 sticky `generatedAtUtc` is carried forward from.
 *
 * Everything else in a `PipelineNode` -- `kind`, `title`, `prompt`, `staleness`, `dependsOn`,
 * `advisoryOn`, `outputs`, `regenerate`, `check`, `needsEstateCheckout` -- cannot alter a byte of
 * the emitted stamp, so folding it in would restamp three artifacts to record a prose edit. That is
 * the same argument that keeps `stale.ts` and `check.ts` out of `STAMP_SOURCES`.
 *
 * NAMES AND GLOBS ARE SORTED, so re-ordering a record in the manifest is inert -- `foldGroups`
 * already sorts the computed groups for the same reason, and a reviewer expects a moved record to be
 * a no-op. This makes the check strictly STRONGER than the byte digest it replaces: reformatting the
 * file no longer registers, and a changed glob registers even when the file's length is unchanged.
 */
export function nodeRecordDigest(node: PipelineNode): Digest {
  const canonical = {
    id: node.id,
    inputs: [...node.inputs]
      .map((g) =>
        g.kind === 'checkout'
          ? { name: g.name, kind: g.kind }
          : { name: g.name, kind: g.kind, globs: [...g.globs].sort() },
      )
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    generator: [...node.generator].sort(),
    stamp:
      node.detection.via === 'digest' || node.detection.via === 'legacy-commit'
        ? node.detection.stamp
        : null,
  }
  return stringDigest(JSON.stringify(canonical))
}

/**
 * The digest of the code that turns this node's inputs into its output.
 *
 * Two halves, folded by name so neither can mask the other: the CONTENT of the declared generator
 * source, and the node's own declared RECORD (above). The manifest is data rather than code, so
 * hashing the whole file was the wrong instrument for the right worry.
 */
export const computeGeneratorDigest = (node: PipelineNode, root: string = ROOT): string =>
  foldGroups({
    source: digestGlobs(root, node.generator).digest,
    record: nodeRecordDigest(node),
  })

/**
 * The stamp already on disk, or `null` where the output is missing, unparseable, or carries none.
 *
 * The shape is VALIDATED rather than cast. A `JSON.parse` cast would let the rest of this module
 * believe every field is present, and the one field where that belief is dangerous is
 * `generatedAtUtc`: a stamp missing it would be carried forward as `undefined`, which `JSON.stringify`
 * drops, silently emitting an artifact whose provenance block has no timestamp at all. Anything that
 * does not satisfy the four required fields is treated as "no stamp to compare", which is the same
 * answer as a missing file and produces the same UNSTAMPED verdict.
 *
 * `priorPath` names the file to read the stamp from, defaulting to the node's declared stamp path
 * under `root`. An emitter writing under an OUTPUT OVERRIDE passes the file it is about to overwrite
 * (a node under `ARCHETYPES_OUT`, `tools/archetypes/paths.ts`): the sticky timestamp has to be carried
 * forward from the output being replaced, or a scratch emit and the scratch `--check` a second later
 * differ on `generatedAtUtc` alone -- which is how `archetypes:selftest` found this.
 * In production the two paths are the same file, so nothing about the committed bytes moves.
 */
export function readStamp(
  node: PipelineNode,
  root: string = ROOT,
  priorPath?: string,
): ProvenanceStamp | null {
  if (node.detection.via !== 'digest') return null
  const abs = priorPath ?? join(root, node.detection.stamp.path)
  if (!existsSync(abs)) return null
  let block: unknown
  try {
    block = (JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>)[
      node.detection.stamp.key
    ]
  } catch {
    // A malformed output is a louder problem than a stale one, and it is not this module's to
    // report: the node's own emitter will fail on it.
    return null
  }
  if (!block || typeof block !== 'object') return null
  const b = block as Record<string, unknown>
  if (
    typeof b['node'] !== 'string' ||
    typeof b['generatedAtUtc'] !== 'string' ||
    typeof b['generatorDigest'] !== 'string' ||
    typeof b['inputsDigest'] !== 'string' ||
    !b['inputs'] ||
    typeof b['inputs'] !== 'object'
  ) {
    return null
  }
  return b as unknown as ProvenanceStamp
}

/** ISO-8601 UTC at second precision. Milliseconds are noise in a field compared for equality. */
const nowUtc = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * Build the stamp an emitter should write.
 *
 * Call this from the emitter and splice the result into its output document. The prior stamp is read
 * from that emitter's OWN committed output, which is the only place a sticky timestamp can come
 * from -- so this is one of the two functions in this repository that reads an artifact in order to
 * write it. The other is `tools/archetypes/index.ts`, which reads the prior classification to report
 * the delta, and for the same underlying reason: some facts about an artifact are only knowable by
 * comparison with its predecessor.
 */
export function stampFor(nodeId: string, root: string = ROOT, priorPath?: string): ProvenanceStamp {
  const node = byId(nodeId)
  if (!node) throw new Error(`stampFor: no node "${nodeId}" in tools/pipeline/graph.ts`)
  return buildStamp(node, root, priorPath)
}

/**
 * `stampFor` by node rather than by id.
 *
 * Exported so `tools/pipeline/selftest.ts` can drive the sticky-timestamp rule against a synthetic
 * node under a temp root. Asserting that rule against a REAL node would need the real corpus and the
 * real `../estate` checkout, which is exactly the coupling that makes a test unrunnable in CI --
 * and this is the rule that, if it breaks, turns three `--check` gates permanently red.
 */
export function buildStamp(
  node: PipelineNode,
  root: string = ROOT,
  priorPath?: string,
): ProvenanceStamp {
  if (node.detection.via !== 'digest') {
    throw new Error(
      `buildStamp: node "${node.id}" declares detection.via "${node.detection.via}", not "digest".` +
        ' Only a digest-stamped node carries a provenance block; change graph.ts or stop calling this.',
    )
  }

  const { inputs, inputsDigest } = computeInputs(node, root)
  const generatorDigest = computeGeneratorDigest(node, root)
  const prior = readStamp(node, root, priorPath)

  // Narrowed inline rather than through a `const unchanged: boolean`, so the true branch can read
  // `prior.generatedAtUtc` without an assertion that would outlive the check that justified it.
  const generatedAtUtc =
    prior !== null &&
    prior.inputsDigest === inputsDigest &&
    prior.generatorDigest === generatorDigest
      ? prior.generatedAtUtc
      : nowUtc()

  return {
    node: node.id,
    generatedAtUtc,
    generatorDigest,
    inputs,
    inputsDigest,
  }
}
