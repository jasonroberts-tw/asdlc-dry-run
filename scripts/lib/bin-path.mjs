/**
 * Resolve a `node_modules/.bin` executable the way npm does: by WALKING UP, not by assuming the
 * nearest directory has one.
 *
 * WHY THIS EXISTS. `resolve(ROOT, 'node_modules/.bin/<tool>')` is correct in the primary checkout and
 * wrong in a linked worktree. A worktree under `.claude/worktrees/<name>/` has a nearly-empty
 * `node_modules` -- npm itself resolves binaries by walking up to the primary checkout, so nothing
 * ever installs a full tree there -- and the hardcoded path simply does not exist. `scripts/`
 * spawned two tools that way and both died before doing any work: `lint-ratchet.mjs` with ENOENT on
 * eslint, and `generate-api-client.mjs` with the friendlier but equally wrong "openapi-typescript is
 * not installed. Run `npm install` first." (That second script is gone: a later decision retired
 * a node and replaced it with `merge-slice-schemas.mjs`, which spawned nothing (and which
 * a later decision has since deleted with a node). The account
 * stays because it is what the bead was about, and because the failure it describes is a property of
 * worktrees rather than of either script.)
 *
 * The consequence was not a broken build, which is why it survived: it is that an agent working in a
 * worktree cannot run two of the gates it is expected to satisfy, and finds out at CI. Every agent
 * lane in this repository runs in a worktree (the slice lane did too, until a later decision retired it).
 *
 * NOT `npx`. `npx` would also find the binary, and would also silently DOWNLOAD one that is not
 * installed -- turning a missing devDependency into a network fetch of whatever version resolves
 * today. These scripts are gates; they must fail on a missing tool, not paper over it.
 */
import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

/**
 * The platform's executable name for a bin entry: npm writes a `.cmd` shim on Windows.
 */
export function binName(tool) {
  return process.platform === 'win32' ? `${tool}.cmd` : tool
}

/**
 * Walk up from `startDir` looking for `node_modules/.bin/<tool>`, returning the first hit.
 *
 * Returns `null` when no ancestor has it, so the caller decides whether that is fatal and can say
 * something useful about which tool is missing. Never throws.
 */
export function findBin(tool, startDir) {
  const exe = binName(tool)
  let dir = startDir
  for (;;) {
    const candidate = join(dir, 'node_modules', '.bin', exe)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir || dir === parse(dir).root) return null
    dir = parent
  }
}
