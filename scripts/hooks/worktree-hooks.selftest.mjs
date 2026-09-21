/**
 * Self-test for scripts/hooks/worktree-create.mjs, scripts/hooks/worktree-remove.mjs and
 * scripts/prune-worktree-branches.mjs.
 *
 * Covers the halves of the contract that are cheap to exercise and easy to get wrong: what the hooks
 * accept on stdin, what they refuse, and -- for the remove hook -- that stdout stays clean and the
 * sandbox fallback actually deletes a directory `git worktree remove` will not touch. It deliberately
 * does NOT provision a real worktree: `git worktree add` needs the primary checkout, and a
 * worktree-isolated session is refused it by scripts/hooks/guard-git.mjs. That one round trip is
 * verified by running the create hook from the primary checkout; see the PR body.
 *
 * THE PRUNE CASES ARE DIFFERENT IN KIND from everything else here, and the difference is the point:
 * that script DELETES BRANCHES AND REMOVES CHECKOUTS, so what is asserted is not that it works but
 * that it refuses, in each of the ways it can be asked to do damage. Two rules follow from that and
 * both were learned the hard way. First, every refusal is asserted by the REASON reported, not by
 * mere survival -- the checked-out case passed with the guard deleted, because `git branch -D`
 * refuses a checked-out branch by itself, which made the check vacuous; `git worktree remove` refuses
 * a dirty or locked tree by itself in exactly the same way. Second, nothing in this file may run the
 * sweep against THIS repository: `worktree:selftest` is a pre-push job, and an earlier version of the
 * remove hook swept the real repo on every invocation, deleting 104 local branches. The scratch
 * repository below and the hook's own ownership check are what keep that separated.
 *
 *   node scripts/hooks/worktree-hooks.selftest.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)))
const CREATE = join(HOOKS, 'worktree-create.mjs')
const REMOVE = join(HOOKS, 'worktree-remove.mjs')

let failures = 0

/**
 * Run a hook with `input` on stdin. Never throws; the exit code is part of what is asserted.
 *
 * `spawnSync` rather than `execFileSync` because stderr has to survive a SUCCESSFUL run:
 * `execFileSync` returns stdout only and reaches stderr through the thrown error, so on exit 0 it
 * dropped the stream on the floor. These hooks report everything they did on stderr -- stdout is
 * reserved for the harness -- which makes stderr the only evidence of what a zero-exit run actually
 * did, including whether it swept the real repository.
 */
function run(script, input) {
  const r = spawnSync('node', [script], { input, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`)
    failures += 1
  }
}

console.log('create hook: input it must refuse')
for (const [label, input] of [
  ['non-JSON stdin', 'not json at all'],
  ['no name field', '{"hook_event_name":"WorktreeCreate"}'],
  ['name with a slash', '{"hook_event_name":"WorktreeCreate","name":"a/b"}'],
  ['name with a backslash', '{"hook_event_name":"WorktreeCreate","name":"a\\\\b"}'],
  ['dot-segment name', '{"hook_event_name":"WorktreeCreate","name":".."}'],
  ['traversal name', '{"hook_event_name":"WorktreeCreate","name":"../escape"}'],
  ['empty name', '{"hook_event_name":"WorktreeCreate","name":""}'],
  ['non-string name', '{"hook_event_name":"WorktreeCreate","name":42}'],
  ['leading-dot name', '{"hook_event_name":"WorktreeCreate","name":".hidden"}'],
]) {
  const r = run(CREATE, input)
  // A refusal must be non-zero AND must not print a path, or the harness would try to use one.
  check(
    label,
    r.code !== 0 && r.stdout.trim() === '',
    `code=${r.code} stdout=${JSON.stringify(r.stdout)}`,
  )
}

console.log('remove hook: input it must refuse')
for (const [label, input] of [
  ['non-JSON stdin', 'not json at all'],
  ['no worktree_path', '{"hook_event_name":"WorktreeRemove"}'],
  ['empty worktree_path', '{"hook_event_name":"WorktreeRemove","worktree_path":""}'],
]) {
  const r = run(REMOVE, input)
  check(label, r.code !== 0, `code=${r.code}`)
}

console.log('remove hook: the sandbox fallback')
// A plain directory is not a registered worktree, so `git worktree remove` fails on it exactly as it
// does under the sandbox's bind mounts. The direct-removal branch is what must clear it.
const scratch = mkdtempSync(join(tmpdir(), 'wt-remove-'))
const victim = join(scratch, 'not-a-worktree')
mkdirSync(join(victim, 'nested'), { recursive: true })
writeFileSync(join(victim, 'nested', 'file.txt'), 'content')
const removed = run(
  REMOVE,
  JSON.stringify({ hook_event_name: 'WorktreeRemove', worktree_path: victim }),
)
check('exits zero', removed.code === 0, `code=${removed.code} stderr=${removed.stderr}`)
check('directory is gone', !existsSync(victim))
check('stdout stays empty', removed.stdout.trim() === '', JSON.stringify(removed.stdout))
// THE CHECK WHOSE ABSENCE COST 104 BRANCHES. The hook runs prune-worktree-branches.mjs after a
// removal, and that sweep mutates branches and `.git/config` -- shared state, in the REAL
// repository, since the sweep is keyed off the hook's own location and not off `worktree_path`.
// This case hands the hook a `/tmp` victim, and `worktree:selftest` is a pre-push job, so without
// the ownership check in the hook every push swept the real repo. Assert the refusal, by its
// reason, rather than trusting that a test directory is obviously not a worktree.
check(
  'a foreign path is not swept',
  removed.stderr.includes('sweep skipped') && !removed.stderr.includes('worktree gc:'),
  JSON.stringify(removed.stderr.slice(0, 400)),
)

console.log('remove hook: a path that cannot be removed')
// Nothing to delete is still "gone", so this must succeed rather than fail on a missing directory.
const absent = run(
  REMOVE,
  JSON.stringify({
    hook_event_name: 'WorktreeRemove',
    worktree_path: join(scratch, 'never-existed'),
  }),
)
check('absent path exits zero', absent.code === 0, `code=${absent.code} stderr=${absent.stderr}`)

/* --------------------------------------------------------------------------------------------- *
 * guard-git: the unprovisioned-worktree tripwire.
 *
 * The one failure the WorktreeCreate hook cannot catch is the one where no WorktreeCreate hook ran.
 * A session whose config snapshot predates the hook gets `EnterWorktree`'s native behaviour instead:
 * a `worktree-<name>` branch cut from `origin/main` rather than `agent/<name>` cut from
 * `origin/main`. Since both now use the same LOCATION, the branch name is the discriminator.
 * `guard-git.mjs` is a PreToolUse Bash hook, so it fires whatever the snapshot holds -- and this
 * asserts it does.
 *
 * Unlike the create-hook cases above, this one CAN provision real worktrees, because it builds a
 * throwaway repository in a temp directory. The header's "no real worktree" constraint is about
 * `git worktree add` against THIS repository from an isolated session; a scratch repo is untouched
 * by it.
 * --------------------------------------------------------------------------------------------- */
console.log('guard-git: the unprovisioned-worktree tripwire')
const GUARD = join(HOOKS, 'guard-git.mjs')
const repo = mkdtempSync(join(tmpdir(), 'wt-guard-'))
const primary = join(repo, 'primary')

/**
 * The environment for the scratch repository, with every `GIT_*` variable removed.
 *
 * THIS IS NOT HYGIENE, IT IS THE DIFFERENCE BETWEEN A TEST AND AN INCIDENT. `git push` exports
 * `GIT_DIR` into its hooks, so a `git` call made from a pre-push hook inherits it and operates on
 * THE REAL REPOSITORY no matter what `cwd` it is given. Run without this scrub, these cases
 * registered both scratch worktrees against the actual repo, created their branches in it, wrote
 * `user.email=selftest@example.invalid` into `.git/config` -- which would have misattributed every
 * later commit -- and flipped `core.bare` to `true` on the primary checkout. It passed under
 * `lefthook run pre-push`, where those variables are absent, and failed only under a real push: the
 * worst possible split, because the failing run is the one that also does the damage.
 *
 * `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are pinned to /dev/null for the same reason in the
 * other direction: the scratch repo must not read or write the developer's own git configuration.
 */
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

/** Run a git command in the scratch repo. Throws on failure, which fails the selftest loudly. */
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' })

execFileSync('git', ['init', '-q', '-b', 'main', primary], { env: GIT_ENV, encoding: 'utf8' })
writeFileSync(join(primary, 'f.txt'), 'hi\n')
git(primary, 'add', 'f.txt')
// Identity via -c, so the scratch repo needs no config file written to it at all.
const AS = ['-c', 'user.email=selftest@example.invalid', '-c', 'user.name=selftest']
git(primary, ...AS, 'commit', '-qm', 'init')
// `origin/main` has to exist for the base-distance corroboration to have anything to measure.
git(primary, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
// Both worktrees sit in the NEW sanctioned location; only the branch name separates them.
git(primary, 'worktree', 'add', '-q', '.claude/worktrees/native', '-b', 'worktree-native', 'HEAD')
git(primary, 'worktree', 'add', '-q', '.claude/worktrees/ours', '-b', 'agent/ours', 'HEAD')

/** Run guard-git as if the agent had typed a harmless command from `dir`. */
function guardFrom(dir) {
  try {
    execFileSync('node', [GUARD], {
      input: JSON.stringify({ tool_input: { command: 'echo hello' } }),
      cwd: dir,
      env: { ...GIT_ENV, CLAUDE_PROJECT_DIR: dir },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { code: 0, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stderr: err.stderr ?? '' }
  }
}

const native = guardFrom(join(primary, '.claude', 'worktrees', 'native'))
check('a worktree-* branch is refused', native.code === 2, `code=${native.code}`)
check(
  'the refusal names the branch',
  native.stderr.includes("'worktree-native'"),
  JSON.stringify(native.stderr.slice(0, 200)),
)
// Both controls matter: a tripwire that fires everywhere would block the whole repository. The
// agent/* worktree sits at the SAME path shape as the refused one, so this also proves the check
// keys on provenance rather than on location.
const ours = guardFrom(join(primary, '.claude', 'worktrees', 'ours'))
check('an agent/* worktree is allowed', ours.code === 0, `code=${ours.code} ${ours.stderr}`)
const prim = guardFrom(primary)
check('primary checkout is allowed', prim.code === 0, `code=${prim.code} ${prim.stderr}`)

/* --------------------------------------------------------------------------------------------- *
 * prune-worktree-branches: the safety rule.
 *
 * The script deletes branches and removes checkouts, so what has to be tested is not that it works
 * but that it REFUSES in each of the ways it can be asked to do damage. For branches: an unmerged
 * branch, a branch a kept worktree has checked out, and a branch that is not worktree-provisioned at
 * all. For worktrees, one case per condition of the abandonment proof: a dirty tree, a locked tree, a
 * tree whose branch is not in the trunk, a tree outside `.claude/worktrees/`, a tree with a process
 * inside it, and the tree the sweep itself runs from. The positive cases -- a rebase-merged branch,
 * a clean contained checkout nobody is in, and a registration whose directory is already gone -- are
 * only interesting because they prove the negatives are not vacuous: a script that deleted nothing
 * would pass every refusal.
 *
 * The interesting positive is the REBASE-MERGED shape, which is what this repository's pull requests
 * actually leave behind: the branch is not an ancestor of the trunk, its commit SHA appears nowhere
 * on it, and only the patch-id matches. Built below with a cherry-pick, because that is exactly what
 * a rebase merge does to one commit.
 *
 * Every worktree below is cut from the trunk commit and so trivially contained. Each differs from
 * `abandoned` in exactly one condition, which is what lets a refusal be pinned to its reason.
 * --------------------------------------------------------------------------------------------- */
console.log('prune-worktree-branches: the safety rule')
const GC = resolve(HOOKS, '..', 'prune-worktree-branches.mjs')
const gcRepo = mkdtempSync(join(tmpdir(), 'wt-gc-'))
const gcPrimary = join(gcRepo, 'primary')
const LINUX = process.platform === 'linux'

execFileSync('git', ['init', '-q', '-b', 'main', gcPrimary], { env: GIT_ENV, encoding: 'utf8' })
writeFileSync(join(gcPrimary, 'base.txt'), 'base\n')
git(gcPrimary, 'add', 'base.txt')
git(gcPrimary, ...AS, 'commit', '-qm', 'base')

// A branch whose one commit is later cherry-picked onto the trunk: same patch, different SHA.
git(gcPrimary, ...AS, 'checkout', '-q', '-b', 'agent/rebase-merged')
writeFileSync(join(gcPrimary, 'landed.txt'), 'landed\n')
git(gcPrimary, 'add', 'landed.txt')
git(gcPrimary, ...AS, 'commit', '-qm', 'work that landed')

// A branch carrying a commit that never reaches the trunk. This is the one that must survive.
git(gcPrimary, ...AS, 'checkout', '-q', 'main')
git(gcPrimary, ...AS, 'checkout', '-q', '-b', 'agent/unmerged')
writeFileSync(join(gcPrimary, 'pending.txt'), 'pending\n')
git(gcPrimary, 'add', 'pending.txt')
git(gcPrimary, ...AS, 'commit', '-qm', 'work still in flight')

git(gcPrimary, ...AS, 'checkout', '-q', 'main')
git(gcPrimary, ...AS, 'cherry-pick', 'agent/rebase-merged')
// The trunk the script measures against is the remote-tracking ref, not the local branch.
git(gcPrimary, 'update-ref', 'refs/remotes/origin/main', 'HEAD')

// A plain branch that is trivially contained -- it is the trunk commit itself -- and must still be
// spared, for a reason that has nothing to do with containment.
git(gcPrimary, 'branch', 'not-an-agent-branch', 'main')

// The worktrees. `wt` cuts `agent/<name>` from the trunk commit into the sanctioned location.
const WT = join(gcPrimary, '.claude', 'worktrees')
const wt = (name) => {
  const path = join(WT, name)
  git(gcPrimary, 'worktree', 'add', '-q', '-b', `agent/${name}`, path, 'main')
  return path
}
const abandoned = wt('abandoned') // clean, contained, nobody in it: THE ONE THAT GOES
const dirty = wt('dirty')
writeFileSync(join(dirty, 'wip.txt'), 'wip\n') // one untracked file is one uncommitted change
const locked = wt('locked')
git(gcPrimary, 'worktree', 'lock', locked)
const inflight = wt('inflight')
writeFileSync(join(inflight, 'flight.txt'), 'flight\n')
git(inflight, 'add', 'flight.txt')
git(inflight, ...AS, 'commit', '-qm', 'committed but not in the trunk')
const elsewhere = join(gcRepo, 'elsewhere') // same shape, wrong place
git(gcPrimary, 'worktree', 'add', '-q', '-b', 'agent/elsewhere', elsewhere, 'main')
const gone = wt('gone') // registered, directory deleted behind git's back: prunable
rmSync(gone, { recursive: true, force: true })
const busy = wt('busy') // clean and contained, but a process is standing in it
// The liveness check reads `/proc/<pid>/cwd`, so it exists only where `/proc` does. `spawn` forks
// synchronously with the child's cwd already set, so the link is readable as soon as it returns.
const sleeper = LINUX ? spawn('sleep', ['120'], { cwd: busy, stdio: 'ignore' }) : null
process.on('exit', () => sleeper?.kill())

// Tracking config of the shape provisioning leaves behind, plus one section whose branch does not
// exist at all -- the orphan case, which is collected on its own evidence and needs no trunk.
for (const b of [
  'agent/rebase-merged',
  'agent/unmerged',
  'agent/abandoned',
  'agent/dirty',
  'agent/gone',
  'not-an-agent-branch',
]) {
  git(gcPrimary, 'config', '--local', `branch.${b}.remote`, 'origin')
  git(gcPrimary, 'config', '--local', `branch.${b}.merge`, `refs/heads/${b}`)
}
git(gcPrimary, 'config', '--local', 'branch.agent/ghost.remote', 'origin')
git(gcPrimary, 'config', '--local', 'branch.agent/ghost.merge', 'refs/heads/agent/ghost')

/** The script's own output, run against the scratch repo. */
function runGc(...extra) {
  try {
    return execFileSync('node', [GC, '--repo', gcPrimary, ...extra], {
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return `EXIT ${err.status}: ${err.stdout ?? ''}${err.stderr ?? ''}`
  }
}

const branchExists = (b) => {
  try {
    git(gcPrimary, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`)
    return true
  } catch {
    return false
  }
}
const registered = (name) => existsSync(join(gcPrimary, '.git', 'worktrees', name))
const configKeys = () => {
  const out = git(gcPrimary, 'config', '--local', '--name-only', '--list')
  return out.split('\n').filter((k) => k.startsWith('branch.'))
}

// --dry-run first: it must report the same verdicts and change absolutely nothing.
const preview = runGc('--dry-run')
const keysBeforeGc = configKeys().length
check(
  'dry run reports the rebase-merged branch',
  preview.includes('agent/rebase-merged'),
  preview.slice(0, 300),
)
check(
  'dry run reports the abandoned worktree',
  preview.includes('.claude/worktrees/abandoned  agent/abandoned  (clean, ancestor of origin/main)'),
  preview.slice(0, 900),
)
// A prunable registration holds no checkout, so it must not shield its branch even before `prune`.
check(
  'dry run reports the branch behind a prunable registration',
  /agent\/gone {2}[0-9a-f]{8} {2}\(/.test(preview),
  preview.slice(0, 900),
)
check('dry run deletes nothing', branchExists('agent/rebase-merged') && branchExists('agent/gone'))
check('dry run removes nothing', existsSync(abandoned) && registered('abandoned'))
check('dry run changes no config', configKeys().length === keysBeforeGc)

// THE SWEEP MUST NEVER REMOVE THE WORKTREE IT RUNS FROM. `abandoned` qualifies on every other
// count, so running the sweep from inside it is the one way to reach this refusal -- in dry-run,
// since the run would otherwise collect everything else.
const fromInside = runGc('--dry-run', '--repo', abandoned)
check(
  'the worktree the sweep runs from is kept, by reason',
  fromInside.includes(
    '.claude/worktrees/abandoned  agent/abandoned  -- the worktree this sweep runs from',
  ),
  fromInside.slice(0, 900),
)

const report = runGc()
sleeper?.kill()

// The positives.
check(
  'the rebase-merged branch is gone',
  !branchExists('agent/rebase-merged'),
  report.slice(0, 400),
)
check('its config section is gone', !configKeys().some((k) => k.includes('agent/rebase-merged')))
check('the orphan config section is gone', !configKeys().some((k) => k.includes('agent/ghost')))
check('the abandoned worktree is gone', !existsSync(abandoned), report.slice(0, 900))
check('its registration is gone', !registered('abandoned'))
check('its branch went with it', !branchExists('agent/abandoned'))
check('and its config section', !configKeys().some((k) => k.includes('agent/abandoned')))
check(
  'the report says so',
  report.includes(`removed ${LINUX ? 1 : 2} abandoned worktree(s)`) &&
    report.includes(
      '.claude/worktrees/abandoned  agent/abandoned  (clean, ancestor of origin/main)',
    ),
  report.slice(0, 900),
)
check('the prunable registration is reconciled', !registered('gone'))
check('and the branch behind it is collected', !branchExists('agent/gone'))

// The worktree refusals, each by its reason. Survival alone would be VACUOUS for `dirty` and
// `locked`: `git worktree remove` refuses both on its own, exactly as `git branch -D` refuses a
// checked-out branch. The reason reported is the only evidence that the guard, not git, spared it.
check(
  'a dirty worktree is kept by its reason',
  report.includes('.claude/worktrees/dirty  agent/dirty  -- 1 uncommitted change(s)'),
  report.slice(0, 1200),
)
check('and survives', existsSync(dirty) && branchExists('agent/dirty'))
check(
  'its branch names the worktree and the reason, not "live"',
  report.includes(
    'agent/dirty  -- checked out by .claude/worktrees/dirty (1 uncommitted change(s))',
  ) && !report.includes('live worktree'),
  report.slice(0, 1200),
)
check(
  'its config survives with it',
  configKeys().some((k) => k === 'branch.agent/dirty.remote'),
)
check(
  'a locked worktree is kept by its reason',
  report.includes('.claude/worktrees/locked  agent/locked  -- locked'),
  report.slice(0, 1200),
)
check('and survives', existsSync(locked) && branchExists('agent/locked'))
check(
  'an in-flight worktree is kept by its reason',
  report.includes(
    '.claude/worktrees/inflight  agent/inflight  -- branch agent/inflight: 1 of 1 commit(s) not in origin/main',
  ),
  report.slice(0, 1200),
)
check('and survives', existsSync(inflight) && branchExists('agent/inflight'))
check(
  'a worktree outside .claude/worktrees/ is kept by its reason',
  report.includes('agent/elsewhere  -- outside .claude/worktrees/'),
  report.slice(0, 1200),
)
check('and survives', existsSync(elsewhere) && branchExists('agent/elsewhere'))
if (LINUX) {
  check(
    'a worktree with a process inside is kept by its reason',
    report.includes(`.claude/worktrees/busy  agent/busy  -- in use by process ${sleeper.pid}`),
    report.slice(0, 1200),
  )
  check('and survives', existsSync(busy) && branchExists('agent/busy'))
} else {
  console.log('  skip a worktree with a process inside (no /proc on this platform)')
}
check('the primary checkout is not reported as a worktree', !report.includes('  .  main  --'))

// The branch refusals.
check('an unmerged branch survives', branchExists('agent/unmerged'), report.slice(0, 400))
check(
  'its config survives with it',
  configKeys().some((k) => k === 'branch.agent/unmerged.remote'),
)
check('a non-agent branch survives', branchExists('not-an-agent-branch'))
check(
  'its config survives with it',
  configKeys().some((k) => k === 'branch.not-an-agent-branch.remote'),
)
check('the trunk survives', branchExists('main'))

// A missing trunk is no evidence of containment, so neither the worktree sweep nor the branch sweep
// may run -- while the orphan sweep, which never needed the trunk, still does.
const spare = wt('spare') // clean, contained, nobody in it: would go on any run with a trunk
git(gcPrimary, 'config', '--local', 'branch.agent/ghost2.remote', 'origin')
const noTrunk = runGc('--trunk', 'origin/does-not-exist')
check('a missing trunk skips both sweeps', noTrunk.includes('MISSING'), noTrunk.slice(0, 300))
check('and still deletes nothing', branchExists('agent/unmerged') && branchExists('agent/spare'))
check(
  'and still removes nothing',
  existsSync(spare) && !noTrunk.includes('abandoned worktree'),
  noTrunk.slice(0, 300),
)
check(
  'but still collects an orphan section',
  !configKeys().some((k) => k.includes('agent/ghost2')),
  noTrunk.slice(0, 300),
)

console.log(failures === 0 ? '\nall worktree hook checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
