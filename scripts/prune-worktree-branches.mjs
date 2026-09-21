/**
 * Garbage-collects the git state a worktree leaves behind once its work is in the trunk: the ABANDONED
 * CHECKOUT still registered in `git worktree list`, the dead `agent/*` branch and, with it, the
 * `branch.<name>.remote` / `branch.<name>.merge` pair in `.git/config`.
 *
 *   node scripts/prune-worktree-branches.mjs [--dry-run] [--trunk <ref>] [--repo <path>]
 *   npm run worktree:gc
 *
 * THE TWO DEFECTS THIS PREVENTS.
 *
 * First, `.git/config` growing without bound. Provisioning sets up tracking twice over -- `git
 * worktree add -b agent/<name> ... origin/main` writes the pair once because the start point is a
 * remote-tracking branch, and the agent's `git push -u` rewrites it to point at its own pushed branch
 * -- and nothing ever takes it back out. `scripts/hooks/worktree-remove.mjs` removes the checkout and
 * deliberately not the branch, which is right (the branch is the work, and a pull request is how it
 * reaches trunk), but it means the branch and its two config keys outlive the worktree by design and
 * then outlive the merged pull request by neglect. Measured before this script existed: 222 of 241
 * local config keys were `branch.agent/*`, spread over 111 branches of which 9 had a live worktree.
 *
 * Second, REGISTERED CHECKOUTS NOBODY IS USING. The `WorktreeRemove` hook fires only when the harness
 * tears a worktree down. A background job that simply ends, or a session that answers "keep" at exit,
 * leaves the checkout on disk and registered, with its branch checked out. The first version of this
 * script read every registered worktree as live, so it spared those branches forever and reported
 * each one as "checked out by a live worktree" -- about checkouts whose pull requests had merged days
 * earlier. Measured 2026-09-14: 22 of 22 registered worktrees were in that state, every one clean,
 * none with a process inside it, 21 branches ancestors of `origin/main` and the 22nd contained by
 * patch-id. REGISTERED IS NOT LIVE, and the worktree sweep below is what tells them apart.
 *
 * THE SAFETY RULE, and it is the whole design: a branch is deleted only when its content is already
 * in the trunk. Two independent proofs are accepted, cheapest first --
 *
 *   1. the branch is an ANCESTOR of the trunk (`merge-base --is-ancestor`), or
 *   2. every commit on it has a patch-id that is already upstream (`git cherry` prints no `+`).
 *
 * Proof 2 is what catches the ordinary case here, where a pull request was rebase-merged: the commit
 * SHAs on trunk differ, so proof 1 fails, but the patches are identical. A SQUASH merge satisfies
 * neither -- N commits collapse into one new patch-id -- so a squash-merged branch is KEPT. That is
 * the intended bias. Every branch this script declines to delete is reported, with the reason, for a
 * human to decide about; nothing is deleted on a guess.
 *
 * A WORKTREE IS ABANDONED, and is removed with a plain `git worktree remove`, only when ALL of these
 * hold. Each is a separate refusal, and the report names the one that failed:
 *
 *   - it sits under `<primary>/.claude/worktrees/`, the one location this repository provisions;
 *   - it is not the worktree this sweep is running from;
 *   - it is not locked -- `git worktree lock` is how a human says "keep this", and it is honoured;
 *   - its HEAD is an `agent/*` or `worktree-*` branch: not detached, not `main`, not a human branch;
 *   - `git status --porcelain` there prints nothing -- no modified, staged or untracked file. Ignored
 *     files (`node_modules/`, `.worktree/`, `.scratch/`) do not count. `git worktree remove` without
 *     `--force` refuses a dirty tree on its own, which makes this a second layer over git's;
 *   - no process has its working directory inside it, read from `/proc/<pid>/cwd`. A Claude Code
 *     session `chdir`s into the worktree it enters, so a live session shows here, and so does a
 *     lingering MSBuild node for the minutes it takes to idle out -- conservative, and self-correcting
 *     on the next run. Linux and WSL2 only: where `/proc` is absent the check is skipped and the
 *     clean-and-contained proof stands alone;
 *   - its branch is contained in the trunk by one of the two proofs above.
 *
 * A kept worktree keeps its branch with it, reported as `checked out by <path> (<reason>)`.
 *
 * Consequently a stale `origin/main` cannot cause data loss. It can only make fewer branches look
 * contained, which is why this is safe to run from the offline agent sandbox where `git fetch`
 * cannot reach the network. If the trunk ref is missing altogether there is no evidence of
 * containment at all, and both the worktree sweep and the branch sweep are skipped entirely.
 *
 * WHAT IT WILL NOT TOUCH, regardless of proof:
 *   - the primary checkout, the worktree it runs from, a locked worktree, a worktree outside
 *     `.claude/worktrees/`, or any worktree with a change or a process in it;
 *   - any branch a kept worktree has checked out;
 *   - `main`, `main`, `release`, and anything not named `agent/*` or `worktree-*`. Human branches are
 *     not this script's business and prefix is how it knows.
 *
 * Deletions are logged to `<git-common-dir>/worktree-gc.log` as `<sha> <branch>` with a timestamp,
 * and the same restore command is printed. A deleted branch was provably contained in the trunk, so
 * its content is not gone; the log is there so the REF can be put back with one command anyway. A
 * removed checkout is not logged on its own line: its branch was contained and is deleted -- and
 * logged -- in the same run, and `git worktree add <path> <sha>` puts the checkout back.
 *
 * Exit status is 0 whenever the sweep ran, whether or not it found anything -- this is a gc, not a
 * gate, and `scripts/hooks/worktree-remove.mjs` calls it on a path where a non-zero exit would be
 * read as a failed teardown. Only a broken invocation (not a git repository, bad flag) exits 1.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/* ============================================================================================= *
 * Arguments
 * ============================================================================================= */

const argv = process.argv.slice(2)
let dryRun = false
let trunkArg = null
let repoArg = null

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--dry-run' || arg === '-n') dryRun = true
  else if (arg === '--trunk') trunkArg = argv[(i += 1)]
  else if (arg === '--repo') repoArg = argv[(i += 1)]
  else if (arg === '--help' || arg === '-h') {
    console.log(
      'usage: prune-worktree-branches.mjs [--dry-run] [--trunk <ref>] [--repo <path>]\n' +
        '\n' +
        '  --dry-run   report what would be removed and change nothing\n' +
        '  --trunk     the ref that proves containment (default origin/main, or $TRUNK_BRANCH)\n' +
        '  --repo      a path inside the repository to operate on (default: the cwd)',
    )
    process.exit(0)
  } else {
    console.error(`prune-worktree-branches: unknown argument ${arg}`)
    process.exit(1)
  }
}

/** Branches this script must never delete, whatever the proof says. */
const PROTECTED = new Set(['main', ...'main, release'.split(', '), 'HEAD'])
/** Only worktree-provisioned branch names are in scope. `worktree-*` is EnterWorktree's native
 *  fallback shape, documented in CLAUDE.md, and leaks the same two config keys. */
const OWNED = (name) => name.startsWith('agent/') || name.startsWith('worktree-')

/* ============================================================================================= *
 * git plumbing
 * ============================================================================================= */

const CWD = repoArg ?? process.cwd()

/** Trimmed stdout, or `null` if git failed or said nothing. Never throws. */
function gitOut(args, cwd = CWD) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const trimmed = out.trim()
    return trimmed === '' ? null : trimmed
  } catch {
    return null
  }
}

/** True if the command succeeded. Used for writes, where only success matters. */
function gitOk(args, cwd = CWD) {
  try {
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * `{ ok, out }`, for the one read where "said nothing" and "failed" must not be confused: a clean
 * `git status --porcelain` is empty, and a failed one must read as dirty rather than clean.
 */
function gitRun(args, cwd = CWD) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out: out.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

/** The path with symlinks resolved, or the path itself if it cannot be resolved. */
function realpath(p) {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

// The PRIMARY checkout. `--git-common-dir` is shared by every worktree and always resolves to the
// primary `.git`, so this script does the same thing whether it is run from the primary checkout,
// from a linked worktree, or from the teardown hook -- which matters because branches and
// `.git/config` are shared state and there is only one copy of each to clean.
const COMMON_DIR = gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'])
if (COMMON_DIR === null) {
  console.error(`prune-worktree-branches: ${CWD} is not a git repository`)
  process.exit(1)
}
const ROOT = gitOut(['rev-parse', '--path-format=absolute', '--show-toplevel']) ?? CWD

const TRUNK = trunkArg ?? process.env.TRUNK_BRANCH ?? 'origin/main'

/* ============================================================================================= *
 * Sweep A -- config sections whose branch is already gone
 * ============================================================================================= */

/**
 * Every `branch.<name>` section in the LOCAL config, as a set of branch names.
 *
 * Parsed from `--name-only` keys rather than `--get-regexp`, because a branch name may itself
 * contain dots (`agent/v1.2-fix`) and the only reliable split is: strip the `branch.` prefix,
 * then drop the final dot-segment, which is the variable.
 */
function configuredBranches() {
  const raw = gitOut(['config', '--local', '--name-only', '--list'])
  if (raw === null) return []
  const names = new Set()
  for (const key of raw.split('\n')) {
    if (!key.startsWith('branch.')) continue
    const body = key.slice('branch.'.length)
    const dot = body.lastIndexOf('.')
    if (dot > 0) names.add(body.slice(0, dot))
  }
  return [...names]
}

/** How many `branch.*` keys the local config holds, for the before/after report. */
function branchKeyCount() {
  const raw = gitOut(['config', '--local', '--name-only', '--list'])
  if (raw === null) return 0
  return raw.split('\n').filter((k) => k.startsWith('branch.')).length
}

const localBranches = new Set(
  (gitOut(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']) ?? '')
    .split('\n')
    .filter(Boolean),
)

const keysBefore = branchKeyCount()

// An orphan section is one describing a branch that no longer exists. `git branch -d` removes the
// section itself, so these are the leavings of a deletion that went around it -- `git update-ref -d`,
// a pruned packed-ref, or a config edited by hand. Cheap to find and unambiguously dead.
const orphans = configuredBranches().filter((name) => !localBranches.has(name))
for (const name of orphans) {
  if (!dryRun) gitOk(['config', '--local', '--remove-section', `branch.${name}`])
}

/* ============================================================================================= *
 * Containment -- the proof both remaining sweeps rest on
 * ============================================================================================= */

/**
 * Why `branch` may be deleted, or `null` with a reason when it may not.
 *
 * The two proofs are ordered by cost. `--is-ancestor` is a reachability walk; `git cherry` has to
 * compute a patch-id for every commit on both sides of the merge base, which is the expensive one
 * and is only reached for branches that are not ancestors.
 */
function containment(branch) {
  if (gitOk(['merge-base', '--is-ancestor', branch, TRUNK])) {
    return { contained: true, proof: 'ancestor of ' + TRUNK }
  }
  // `git cherry` SKIPS MERGE COMMITS, so its line count cannot be assumed to cover the range. That
  // is fine on its own -- a merge introduces no content of its own, and whatever it merged arrives
  // as the other parent's commits, which cherry does examine -- but it means the count has to be
  // reconciled against the non-merge commits explicitly. An unexplained gap is treated as no proof.
  const ahead = gitOut(['rev-list', '--count', `${TRUNK}..${branch}`])
  const aheadNoMerges = gitOut(['rev-list', '--count', '--no-merges', `${TRUNK}..${branch}`])
  const cherry = gitOut(['cherry', TRUNK, branch])

  if (ahead === null || aheadNoMerges === null) {
    return { contained: false, reason: 'could not compare against ' + TRUNK }
  }
  if (ahead === '0') return { contained: true, proof: 'no commits beyond ' + TRUNK }

  // Empty output is ambiguous -- no commits to report, or a failed invocation -- and the counts
  // above already rule out the innocent reading, since something is ahead.
  const lines = cherry === null ? [] : cherry.split('\n').filter(Boolean)
  if (lines.length !== Number(aheadNoMerges)) {
    return {
      contained: false,
      reason: `patch comparison covered ${lines.length} of ${aheadNoMerges} non-merge commit(s)`,
    }
  }

  const unapplied = lines.filter((l) => l.startsWith('+'))
  if (unapplied.length === 0) {
    return { contained: true, proof: `all ${lines.length} patch(es) already in ${TRUNK}` }
  }
  return {
    contained: false,
    reason: `${unapplied.length} of ${lines.length} commit(s) not in ${TRUNK}`,
  }
}

/* ============================================================================================= *
 * Sweep B -- abandoned worktrees
 * ============================================================================================= */

/**
 * Every registered worktree, parsed from `git worktree list --porcelain`. The main worktree is
 * listed first, which is how the primary checkout is identified without a second rev-parse.
 */
function listWorktrees() {
  const raw = gitOut(['worktree', 'list', '--porcelain'])
  const entries = []
  let cur = null
  for (const line of (raw ?? '').split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = {
        path: line.slice('worktree '.length),
        branch: null,
        locked: false,
        prunable: false,
        detached: false,
        bare: false,
      }
      entries.push(cur)
    } else if (cur === null) {
      continue
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === 'locked' || line.startsWith('locked ')) {
      cur.locked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      cur.prunable = true
    } else if (line === 'detached') {
      cur.detached = true
    } else if (line === 'bare') {
      cur.bare = true
    }
  }
  return entries
}

/**
 * PIDs whose working directory is `dir` or inside it, read from `/proc`. `null` where `/proc` is
 * not available, which the caller treats as "unknown" rather than "none". Another user's `cwd` link
 * is unreadable and is skipped; every process this repository cares about runs as the operator.
 */
function processesIn(dir) {
  let pids
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name))
  } catch {
    return null
  }
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  const hits = []
  for (const pid of pids) {
    let cwd
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`)
    } catch {
      continue
    }
    if (cwd === dir || cwd.startsWith(prefix)) hits.push(Number(pid))
  }
  return hits
}

const worktrees = listWorktrees()
const PRIMARY = worktrees.length > 0 ? realpath(worktrees[0].path) : realpath(ROOT)
const OWNED_DIR = join(PRIMARY, '.claude', 'worktrees') + sep
const SELF = realpath(ROOT)

/** A worktree path as the report prints it: relative to the primary checkout where it is inside. */
function shortPath(p) {
  const rel = relative(PRIMARY, p)
  return rel === '' ? '.' : rel.startsWith('..') ? p : rel
}

/**
 * Whether `wt` is abandoned -- `{ remove: true, proof }` -- or `{ remove: false, reason }` naming the
 * first condition it failed. Every refusal is a separate string so the report, and the selftest,
 * can tell them apart; that is what makes a refusal assertable by reason rather than by survival.
 */
function worktreeVerdict(wt, index) {
  const real = realpath(wt.path)
  if (index === 0) return { remove: false, reason: 'the primary checkout' }
  if (wt.bare) return { remove: false, reason: 'bare' }
  if (real === SELF) return { remove: false, reason: 'the worktree this sweep runs from' }
  if (!real.startsWith(OWNED_DIR)) return { remove: false, reason: 'outside .claude/worktrees/' }
  if (wt.locked) return { remove: false, reason: 'locked' }
  if (wt.detached || wt.branch === null) return { remove: false, reason: 'detached HEAD' }
  if (PROTECTED.has(wt.branch) || !OWNED(wt.branch)) {
    return { remove: false, reason: `branch ${wt.branch} is not worktree-provisioned` }
  }
  const status = gitRun(['status', '--porcelain'], wt.path)
  if (!status.ok) return { remove: false, reason: 'git status failed there' }
  if (status.out !== '') {
    const count = status.out.split('\n').length
    return { remove: false, reason: `${count} uncommitted change(s)` }
  }
  const pids = processesIn(real)
  if (pids !== null && pids.length > 0) {
    const shown = pids.slice(0, 3).join(', ') + (pids.length > 3 ? ', ...' : '')
    return { remove: false, reason: `in use by process ${shown}` }
  }
  const verdict = containment(wt.branch)
  if (!verdict.contained) return { remove: false, reason: `branch ${wt.branch}: ${verdict.reason}` }
  return { remove: true, proof: `clean, ${verdict.proof}` }
}

const removedWorktrees = []
const keptWorktrees = []
/** Branch name -> the kept worktree holding it, for the branch sweep's report. */
const heldBy = new Map()
let trunkMissing = false

if (gitOut(['rev-parse', '--verify', '--quiet', TRUNK]) === null) {
  // No trunk ref, no evidence, no deletions. The config sweep above still stands on its own.
  trunkMissing = true
} else {
  // A prunable entry is a registration whose directory is already gone. It holds no work and blocks
  // its branch for nothing; `prune` is git's own reconciliation and touches no checkout that exists.
  if (!dryRun) gitOk(['worktree', 'prune'])

  worktrees.forEach((wt, index) => {
    if (wt.prunable) return
    const verdict = worktreeVerdict(wt, index)
    if (!verdict.remove) {
      if (index > 0) keptWorktrees.push({ wt, reason: verdict.reason })
      if (wt.branch !== null) heldBy.set(wt.branch, { wt, reason: verdict.reason })
      return
    }
    if (dryRun) {
      removedWorktrees.push({ wt, proof: verdict.proof })
      return
    }
    // No `--force`: a tree that turned dirty between the status read and this call is refused by git
    // itself, and reported below as kept rather than removed.
    if (gitOk(['worktree', 'remove', wt.path])) {
      removedWorktrees.push({ wt, proof: verdict.proof })
    } else {
      const reason = 'git worktree remove refused it'
      keptWorktrees.push({ wt, reason })
      heldBy.set(wt.branch, { wt, reason })
    }
  })
}

/* ============================================================================================= *
 * Sweep C -- branches whose work is already in the trunk
 * ============================================================================================= */

const deleted = []
const kept = []

if (!trunkMissing) {
  for (const branch of [...localBranches].sort()) {
    if (PROTECTED.has(branch) || !OWNED(branch)) continue
    const holder = heldBy.get(branch)
    if (holder !== undefined) {
      kept.push({
        branch,
        reason: `checked out by ${shortPath(holder.wt.path)} (${holder.reason})`,
      })
      continue
    }
    const verdict = containment(branch)
    if (!verdict.contained) {
      kept.push({ branch, reason: verdict.reason })
      continue
    }
    const sha = gitOut(['rev-parse', branch]) ?? '?'
    if (dryRun) {
      deleted.push({ branch, sha, proof: verdict.proof })
      continue
    }
    if (gitOk(['branch', '-D', branch])) {
      // `git branch -D` drops the branch's config section itself. Doing it again explicitly is what
      // makes the config guarantee unconditional rather than dependent on that behaviour, and
      // `--remove-section` on an absent section is a harmless non-zero exit.
      gitOk(['config', '--local', '--remove-section', `branch.${branch}`])
      deleted.push({ branch, sha, proof: verdict.proof })
    } else {
      kept.push({ branch, reason: 'git branch -D refused it' })
    }
  }
}

/* ============================================================================================= *
 * Report
 * ============================================================================================= */

if (deleted.length > 0 && !dryRun) {
  const stamp = new Date().toISOString()
  const lines = deleted.map(({ branch, sha }) => `${stamp} ${sha} ${branch}\n`).join('')
  try {
    appendFileSync(join(COMMON_DIR, 'worktree-gc.log'), lines)
  } catch {
    /* the log is a convenience; losing it must not fail the sweep */
  }
}

const verb = dryRun ? 'would remove' : 'removed'
console.log(`worktree gc: ${ROOT}`)
console.log(
  `  trunk: ${TRUNK}${trunkMissing ? ' (MISSING -- worktree and branch sweeps skipped)' : ''}`,
)

if (orphans.length > 0) {
  console.log(`  ${verb} ${orphans.length} config section(s) with no branch:`)
  for (const name of orphans) console.log(`    branch.${name}.*`)
}

if (removedWorktrees.length > 0) {
  console.log(`  ${verb} ${removedWorktrees.length} abandoned worktree(s):`)
  for (const { wt, proof } of removedWorktrees) {
    console.log(`    ${shortPath(wt.path)}  ${wt.branch}  (${proof})`)
  }
}

if (deleted.length > 0) {
  console.log(`  ${verb} ${deleted.length} branch(es) whose work is already in ${TRUNK}:`)
  for (const { branch, sha, proof } of deleted) {
    console.log(`    ${branch}  ${sha.slice(0, 8)}  (${proof})`)
  }
  if (!dryRun) {
    console.log(`  restore any of them with:  git branch <name> <sha>`)
    console.log(`  logged to ${join(COMMON_DIR, 'worktree-gc.log')}`)
  }
}

if (keptWorktrees.length > 0) {
  console.log(`  kept ${keptWorktrees.length} worktree(s):`)
  for (const { wt, reason } of keptWorktrees) {
    console.log(`    ${shortPath(wt.path)}  ${wt.branch ?? '(detached)'}  -- ${reason}`)
  }
}

if (kept.length > 0) {
  console.log(`  kept ${kept.length} branch(es):`)
  for (const { branch, reason } of kept) console.log(`    ${branch}  -- ${reason}`)
}

const keysAfter = dryRun ? keysBefore : branchKeyCount()
if (dryRun) {
  console.log(`  branch.* config keys: ${keysBefore} (unchanged, --dry-run)`)
} else {
  console.log(`  branch.* config keys: ${keysBefore} -> ${keysAfter}`)
}
if (orphans.length === 0 && removedWorktrees.length === 0 && deleted.length === 0) {
  console.log('  nothing to collect')
}
