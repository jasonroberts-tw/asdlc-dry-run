/**
 * estate-root.ts — where the sibling checkout this repository measures lives, and a git
 * environment that is safe to ask it questions with.
 *
 * EMITS. Nothing. Three functions: `gitEnv()`, `primaryCheckout(from)`, `resolveEstateRoot(from)`.
 *
 * THE FAILURE IT EXISTS TO PREVENT. Two, and either one makes a tool that reads a sibling checkout
 * answer about the wrong repository without saying so. (1) Git exports `GIT_DIR`, `GIT_WORK_TREE`
 * and `GIT_INDEX_FILE` to every hook, and `GIT_DIR` outranks `-C <dir>`: a `git -C ../estate
 * rev-parse HEAD` run from inside a pre-push hook answers for THIS repository, and a provenance
 * stamp records this repository's commit as the estate's. (2) A linked worktree lives under
 * `.claude/worktrees/<name>`, so `..` from a worktree is not where `..` from the primary checkout
 * is: resolving the sibling relative to the worktree finds nothing, and a tool that skips clean on
 * a missing checkout then skips on every agent's machine. If this file were wrong in either way
 * nothing would fail; the stamps would simply be about the wrong thing.
 *
 * INVOCATION. Imported, never run:
 *   import { gitEnv, resolveEstateRoot } from '../lib/estate-root.ts'
 *
 * NEEDS. `git` on the path. No sibling checkout: a caller decides what its absence means
 * (`existsSync(resolveEstateRoot(root))`), and a legitimately absent checkout skips clean and says
 * why. Set `ESTATE_ROOT` to point a by-hand run, or a selftest, at a fixture.
 *
 * kit 3.6-4 · ADAPT: "the estate" is a stand-in for whatever sibling checkout your emitters read.
 * Rename the directory in `resolveEstateRoot` to yours; delete this file, and the `checkout` input
 * group kind in `graph.ts`, if no emitter of yours reads outside this repository.
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

/** The name of the sibling directory, beside the PRIMARY checkout. */
const ESTATE_DIRECTORY = 'estate'

/** `process.env` without any `GIT_*` key, so `git -C <elsewhere>` means elsewhere inside a hook. */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value
  }
  return env
}

/**
 * The primary checkout that owns `from`: `from` itself in the primary checkout, and the checkout
 * the worktree was cut from when `from` is a linked worktree. Derived from `--git-common-dir`,
 * never `--show-toplevel`, which answers with the worktree. Falls back to `from` where git cannot
 * answer (not a repository, git missing): the caller's existence check then decides.
 */
export function primaryCheckout(from: string): string {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: from,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: gitEnv(),
    }).trim()
    if (!commonDir) return from
    return dirname(resolve(from, commonDir))
  } catch {
    return from
  }
}

/** The sibling checkout's root: `ESTATE_ROOT` when set, else `../estate` beside the primary checkout. */
export function resolveEstateRoot(from: string): string {
  const override = process.env['ESTATE_ROOT']
  if (override) return resolve(override)
  return resolve(primaryCheckout(from), '..', ESTATE_DIRECTORY)
}
