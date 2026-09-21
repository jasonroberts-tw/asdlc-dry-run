/**
 * Paths, in a module with NO side effects.
 *
 * This lives in `tools/lib/` because it is shared: more than one gate has to agree on where
 * the repository root and its artifacts are. It has outlived every node that first needed it --
 * each time one was retired, the import edge the other tools had into it is exactly why this file
 * moved rather than being deleted with it.
 *
 * WHAT A RETIREMENT TOOK OUT belongs in a note here, so nobody looks for it. Name the constants
 * and helpers that went, what they resolved, and where the principle they carried now lives: a
 * decision's principle usually outlives its mechanism, the authority moving rather than
 * disappearing, and that sentence is the one a reader needs.
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

/** A DECISION, hand-maintained -- not an artifact. `scripts/check-dispositions.mjs` gates it. */
export const DISPOSITIONS_PATH = join(ROOT, 'tools/archetypes/dispositions.json')

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
