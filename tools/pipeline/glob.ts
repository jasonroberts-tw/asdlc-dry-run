/**
 * A deliberately small glob matcher, and the file walk that feeds it.
 *
 * `node:fs`'s own `globSync` would replace this file with one line, and it is NOT used here on
 * purpose. It landed in Node 22.0.0 behind an `ExperimentalWarning`, and this module backs a gate
 * that runs in `pre-push` on a maintainer's Node 26 and in CI on Node 22
 * (`.github/workflows/verify.yml` pins `node-version: '22'`). A staleness gate whose file set can
 * differ between those two runtimes is worse than no gate at all: it folds a different digest on CI
 * than on the machine that stamped the artifact, and every stamped node reports stale forever with
 * nothing in the diff to explain it. The matcher below has one behaviour, written down.
 *
 * The vocabulary is exactly what `tools/pipeline/graph.ts` declares and no more:
 *
 *   `**`  zero or more whole path segments
 *   `*`   zero or more characters WITHIN one segment -- never crosses a `/`
 *   `?`   exactly one character within one segment
 *
 * Everything else is a literal. No braces, no character classes, no negation. A manifest entry that
 * wants one of those is describing something it should be naming outright, and `pipeline:check`
 * fails an input glob that matches nothing -- so an unsupported construct surfaces as a red gate
 * rather than as a silently-empty input group.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Directories never descended into, whatever a glob says.
 *
 * `.claude/worktrees` is the load-bearing one. CLAUDE.md places every agent worktree INSIDE the
 * working tree, so a walk of `artifacts/**` from the primary checkout would otherwise descend into
 * a sibling agent's in-progress copy of the same artifacts and fold their half-finished work into
 * this checkout's digest. `.gitignore` hides them from git; nothing hides them from `readdirSync`.
 */
const PRUNE = new Set(['node_modules', '.git', '.claude', 'dist', 'storybook-static'])

/** Regex-escape everything that is not part of the glob vocabulary above. */
const escape = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/** One path segment's worth of pattern, where `*` and `?` may not cross a `/`. */
const segment = (s: string): string => escape(s).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')

/**
 * Compile a glob to an anchored RegExp over POSIX-separated, repo-relative paths.
 *
 * `**` is handled at segment granularity rather than as `.*` so that `a/**` + `/b` cannot match
 * `a/xb`: a `**` that is not the final segment consumes its own trailing slash, which is what makes
 * `a/**\/b` match both `a/b` (zero segments) and `a/x/y/b`.
 */
export function globToRegExp(glob: string): RegExp {
  const segs = glob.split('/')
  let source = '^'
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] as string
    const last = i === segs.length - 1
    if (s === '**') {
      source += last ? '.*' : '(?:[^/]+/)*'
      continue
    }
    source += segment(s)
    if (!last) source += '/'
  }
  return new RegExp(source + '$')
}

export const matchesGlob = (path: string, glob: string): boolean => globToRegExp(glob).test(path)

/**
 * The longest leading run of literal segments, which is the only directory a glob can match under.
 *
 * Walking from the repository root for every glob would read `artifacts/` -- 1,257 form documents
 * and a 51 MB `procedures.json` -- once per input group. Rooting the walk at `artifacts/forms` for
 * `artifacts/forms/*.json` keeps a whole-graph digest to the files that can actually match.
 */
function walkRoot(glob: string): string {
  const segs = glob.split('/')
  const literal: string[] = []
  for (const s of segs) {
    if (s.includes('*') || s.includes('?')) break
    literal.push(s)
  }
  // A fully-literal glob names a file; its parent is the directory to walk.
  if (literal.length === segs.length) literal.pop()
  return literal.join('/')
}

/** Every file under `dir` (repo-relative, POSIX separators), pruned per `PRUNE`. */
function walk(root: string, dir: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true })
  } catch {
    // A declared glob under a directory that does not exist yet is not this module's error to
    // raise -- it resolves to zero files, and `pipeline:check` is what decides whether zero is
    // wrong for that particular input group.
    return
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (PRUNE.has(e.name)) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) walk(root, rel, out)
    else if (e.isFile()) out.push(rel)
    else if (e.isSymbolicLink()) {
      // Follow only to regular files. A symlinked directory is a second route to files the walk
      // already has, and folding them twice makes the digest depend on link layout.
      try {
        if (statSync(join(root, rel)).isFile()) out.push(rel)
      } catch {
        /* broken link: not a file, not an error */
      }
    }
  }
}

/**
 * Every repo-relative file matching any of `globs`, sorted, de-duplicated.
 *
 * Sorted because the digest folds this list in order and two machines must fold it identically;
 * `readdirSync` order is filesystem order, which is not that. De-duplicated because two input
 * groups may legitimately overlap and a file must contribute once.
 */
export function filesMatching(root: string, globs: readonly string[]): string[] {
  const found = new Set<string>()
  const walked = new Map<string, string[]>()
  for (const glob of globs) {
    const base = walkRoot(glob)
    let files = walked.get(base)
    if (!files) {
      files = []
      walk(root, base, files)
      walked.set(base, files)
    }
    const re = globToRegExp(glob)
    for (const f of files) if (re.test(f)) found.add(f)
  }
  return [...found].sort()
}

/** `a\b` -> `a/b`. Every path this module reports or compares is POSIX-separated. */
export const toPosix = (p: string): string => (sep === '/' ? p : p.split(sep).join('/'))

/** Repo-relative, POSIX-separated, for reporting an absolute path back to a human. */
export const relPosix = (root: string, abs: string): string => toPosix(relative(root, abs))
