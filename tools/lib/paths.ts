/**
 * Paths, in a module with NO side effects.
 *
 * This lives in `tools/lib/` because it is shared: the citation gate and the portfolio citation
 * anchors need to agree on where the repository root and its artifacts are (the gridsweep tooling
 * and the correction-log emitter were importers too, until D-36 deleted them). It was `tools/generator/paths.ts` until the generator was
 * retired, and the import edge every one of those tools had into a retired node is exactly why it
 * moved rather than being deleted with it. The same has now happened three times over: S-VERIFY
 * went with D-15, N-20 with D-30, and N-05 with the whole SLICE kind at D-33 -- and each time
 * this file outlived the node that first needed it.
 *
 * WHAT D-33 TOOK OUT, so nobody looks for it here. `SLICES_DIR`, `sliceDir()`, `allSlices()` and
 * `sliceScreens()` resolved `artifacts/slices/<id>/scope.json`, the D-09 membership authority, and
 * applied the D-11 dispositions at slice admission (`admissible()`); `BEHAVIOUR_DIR`,
 * `SPEC_SCREENS_DIR`, `manifestFor()` and `ManifestLocation` located the behaviour manifests node
 * N-05 validated. Their only importers were `tools/spec-manifest/{origin-ratchet,
 * validate-manifests}.ts`, deleted with the node. D-09's principle carries over with the authority
 * moved: the catalogue's `index.json` computed closure is the one authority on closure, and no
 * per-slice membership file exists any more. The D-11 dispositions are still read by
 * `scripts/check-dispositions.mjs`, from `DISPOSITIONS_PATH` below; nothing applies them at an
 * admission, because there is no admission.
 *
 * Side-effect free, deliberately. Anything that imports this must be able to ask where the artifacts
 * are without running a build step.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The repository root. Every other path here is relative to this. */
export const ROOT = resolve(HERE, '../..')

export const FORMS_DIR = join(ROOT, 'artifacts/forms')

/** D-11. A DECISION, hand-maintained -- not an artifact. `scripts/check-dispositions.mjs` gates it. */
export const DISPOSITIONS_PATH = join(ROOT, 'tools/archetypes/dispositions.json')

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
