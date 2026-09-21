/**
 * PreToolUse hook. Refuses a Bash command that would damage state SHARED between git worktrees.
 *
 * THE DEFECT THIS PREVENTS: a task agent running in a linked worktree reaching past its branch. The
 * object store, the packed refs and the trunk branch itself are shared with every sibling worktree,
 * so `git push origin main`, `git gc` and `git worktree remove` are not local mistakes -- they land on
 * work an agent cannot see and did not consent to. `.worktree/CONTEXT.md` asks the agent not to do
 * this, but context is advice; this is the part that holds.
 *
 * THE GIT RULES ARE A NO-OP IN THE PRIMARY CHECKOUT. Committing and pushing `main` from the primary
 * checkout is this repository's normal workflow (see CLAUDE.md), so the guard asks git whether it
 * is in a linked worktree and skips every git rule if not. The PR-base rule below is the one
 * exception and applies everywhere, because what it guards is not worktree isolation.
 *
 * IT FAILS CLOSED, unlike the three advisory hooks beside it. A guard that allows the command when
 * it cannot read the payload is not a guard: the shell version of this file needed `jq`, which is
 * not installed here, and its `[ -z "$cmd" ] && exit 0` therefore allowed every command -- including
 * the one command it existed to stop.
 *
 * IT PARSES, it does not glob. The shell version matched substrings of the raw command, which
 * refused `git push origin agent/BD-12-fix-main-nav`, `git switch development` and
 * `echo 'see docs/git worktree notes'` while allowing `git -C /repo push origin main` and
 * `git push --all`. Wrong in both directions. Commands here are split into statements, tokenised
 * quote-aware, and matched on the git SUBCOMMAND and the resolved REF.
 *
 * IT ALSO GUARDS THE PR BASE, EVERYWHERE. `gh pr create` with no `--base` uses the repository's
 * DEFAULT branch, which is `main` here -- unchangeable, and protected by rules an agent cannot
 * satisfy. Whoever omits the flag opens the PR against a branch that will reject it, and the
 * mistake is invisible until a human looks. That trap has nothing to do with worktrees, so unlike
 * the git rules it is enforced in the primary checkout too. The trunk is `main`; the base is typed,
 * never inferred.
 *
 * Exit 2 is the documented way for a PreToolUse hook to block, and stderr becomes the reason shown
 * to the agent -- which is what turns a blocked attempt into a course correction rather than a
 * confused retry loop.
 */
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { readHookInput } from './_shared.mjs'

/* ============================================================================================= *
 * Are we in a linked worktree?
 * ============================================================================================= */

/** Where the command would have run. Claude Code sets this to the session's project root. */
const CWD = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

/** One `git rev-parse` path, or `null` if git cannot answer (not a repository, git missing). */
function gitPath(flag) {
  return gitOut(['rev-parse', '--path-format=absolute', flag])
}

/**
 * The trimmed stdout of a git command, or `null` if it fails or says nothing.
 *
 * Every caller treats `null` as "do not judge", so a missing git, a detached HEAD or an absent
 * `origin/main` degrades to allowing the command rather than blocking on a question git could not
 * answer.
 */
function gitOut(args) {
  const r = spawnSync('git', args, { cwd: CWD, encoding: 'utf8', windowsHide: true })
  if (r.status !== 0 || typeof r.stdout !== 'string') return null
  const out = r.stdout.trim()
  return out === '' ? null : out
}

/**
 * True only in a LINKED worktree. `--git-dir` is `<common>/worktrees/<name>` there, and equal to
 * `--git-common-dir` in the primary checkout. Anything unanswerable counts as "not a worktree", so
 * an environment without git is never blocked.
 */
function inLinkedWorktree() {
  const gitDir = gitPath('--git-dir')
  const common = gitPath('--git-common-dir')
  if (gitDir === null || common === null) return false
  return gitDir !== common
}

/* ============================================================================================= *
 * Did the sanctioned provisioner actually make this worktree?
 * ============================================================================================= */

/**
 * A description of how this worktree is wrong, or `null` if it looks properly provisioned.
 *
 * WHY THIS EXISTS. Worktrees live at `.claude/worktrees/<name>` -- the location the `EnterWorktree`
 * tool uses natively -- and `scripts/hooks/worktree-create.mjs` routes that tool through
 * `scripts/new-worktree.sh` so each one is cut from `origin/main` onto `agent/<name>` with a probed
 * port pair and a rendered briefing. Since the tool and the script now agree on WHERE, location
 * carries no information and this guard does not look at it.
 *
 * What the tool and the script still disagree about is the BASE, and that is the half that hurt.
 * Claude Code snapshots hook configuration at session start, so a session that began before the
 * hook was added carries a config without it and `EnterWorktree` silently falls back to its native
 * behaviour: branch `worktree-<name>` cut from `origin/<default branch>`. The default branch here is
 * `main`, which CLAUDE.md warns twice is the wrong trunk, and no `worktree.baseRef` setting can
 * express `origin/main` -- it offers only `fresh` and `head`. Measured on 2026-08-23: the fallback
 * produced a base eight commits behind `origin/main`. The worktree did not contain the
 * fix the agent had been sent there to verify, and nothing said so.
 *
 * A WorktreeCreate hook cannot cover this, because the failure is that no WorktreeCreate hook ran.
 * This one is a PreToolUse Bash hook, so it fires on the agent's first command whatever the
 * session's hook snapshot contains -- the only place left to catch it.
 *
 * THE SIGNAL IS THE BRANCH NAME, corroborated by the base. `new-worktree.sh` always names the branch
 * `agent/<name>`; the native fallback always names it `worktree-<name>`. That is a clean, cheap
 * discriminator that does not depend on the network or on how far `origin/main` has moved since. The
 * base distance is measured only to put a number in the message, and never on its own decides,
 * because a legitimately long-lived `agent/*` branch may sit far behind `origin/main` for good
 * reasons.
 */
function unprovisionedWorktree() {
  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === null || branch === 'HEAD') return null // detached; not a shape we judge
  if (branch.startsWith('agent/')) return null

  // Corroboration only. `null` whenever git cannot answer -- offline, no origin/main, a shallow
  // clone -- because the branch name has already decided and this must never be what blocks.
  let behind = null
  const counts = gitOut(['rev-list', '--left-right', '--count', `origin/${TRUNK}...HEAD`])
  if (counts !== null) {
    const [left] = counts.split(/\s+/)
    if (/^\d+$/.test(left)) behind = Number(left)
  }
  return { branch, behind }
}

/* ============================================================================================= *
 * Parsing.
 * ============================================================================================= */

/** Characters that end one statement and begin another, outside quotes. Covers `&&` and `||`. */
const SEPARATORS = new Set([';', '|', '&', '\n', '\r', '(', ')', '{', '}'])

/**
 * Split a command line into statements of tokens, quote-aware.
 *
 * The quoting matters in both directions: `echo 'see docs/git worktree notes'` becomes ONE token
 * that is not a git invocation (the old false positive), while a `git push origin main` hidden in a
 * `bash -c` string is recovered by `inlineScripts` below (the old bypass).
 */
function parse(command) {
  const statements = []
  let tokens = []
  let cur = ''
  let open = false
  let quote = null

  const endToken = () => {
    if (open) tokens.push(cur)
    cur = ''
    open = false
  }
  const endStatement = () => {
    endToken()
    if (tokens.length > 0) statements.push(tokens)
    tokens = []
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote !== null) {
      // Inside single quotes a backslash is literal; inside double quotes it escapes.
      if (quote === '"' && ch === '\\' && i + 1 < command.length) {
        cur += command[++i]
        open = true
        continue
      }
      if (ch === quote) {
        quote = null
        continue
      }
      cur += ch
      open = true
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      open = true
      continue
    }
    if (ch === '\\' && i + 1 < command.length) {
      cur += command[++i]
      open = true
      continue
    }
    if (ch === ' ' || ch === '\t') {
      endToken()
      continue
    }
    if (ch === '$' && command[i + 1] === '(') {
      i++
      endStatement()
      continue
    }
    if (ch === '`' || SEPARATORS.has(ch)) {
      endStatement()
      continue
    }
    cur += ch
    open = true
  }
  endStatement()
  return statements
}

/** `FOO=bar git push` -- environment assignments come before the command name. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** The command name, lowercased and stripped of any directory. */
function commandName(token) {
  return basename(token.replace(/\\/g, '/')).toLowerCase()
}

/** Index of the command name in a statement, past any environment assignments. */
function nameIndex(tokens) {
  let i = 0
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i])) i++
  return i < tokens.length ? i : -1
}

/** git's own options that take a SEPARATE argument, which must be skipped along with their value. */
const GIT_OPTS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
])

/**
 * The git subcommand and its arguments, or `null` if the statement is not a git invocation.
 *
 * Skipping git's global options is what closes the `git -C /repo push origin main` bypass: the
 * subcommand is found by position past the options, not by looking for the string `git push`.
 */
function gitCall(tokens) {
  const start = nameIndex(tokens)
  if (start === -1) return null
  const name = commandName(tokens[start])
  if (name !== 'git' && name !== 'git.exe') return null

  let i = start + 1
  while (i < tokens.length) {
    const t = tokens[i]
    if (GIT_OPTS_WITH_VALUE.has(t)) {
      i += 2
      continue
    }
    if (t.startsWith('-')) {
      i++
      continue
    }
    break
  }
  if (i >= tokens.length) return null
  return { sub: tokens[i].toLowerCase(), rest: tokens.slice(i + 1) }
}

/** Shells whose `-c` argument is another command line, and must therefore be parsed as one. */
const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell'])
const INLINE_FLAGS = new Set(['-c', '-command', '--command', '/c', '-e'])

/** Command lines embedded in a `bash -c '...'` style invocation. */
function inlineScripts(tokens) {
  const start = nameIndex(tokens)
  if (start === -1) return []
  if (!INTERPRETERS.has(commandName(tokens[start]).replace(/\.exe$/, ''))) return []
  const out = []
  for (let i = start + 1; i < tokens.length; i++) {
    if (INLINE_FLAGS.has(tokens[i].toLowerCase()) && i + 1 < tokens.length) out.push(tokens[i + 1])
  }
  return out
}

/**
 * The `gh` command group, subcommand and arguments -- `gh pr create --fill` becomes
 * `{ group: 'pr', sub: 'create', rest: ['--fill'] }` -- or `null` if this is not a `gh` invocation.
 *
 * Only the two leading bare words are consumed, so a flag between them (`gh --repo x pr create`)
 * ends the scan and the call is simply not matched rather than being mis-parsed into a rule.
 */
function ghCall(tokens) {
  const start = nameIndex(tokens)
  if (start === -1) return null
  if (commandName(tokens[start]).replace(/\.exe$/, '') !== 'gh') return null
  const words = []
  let i = start + 1
  while (i < tokens.length && words.length < 2 && !tokens[i].startsWith('-')) {
    words.push(tokens[i])
    i++
  }
  if (words.length < 2) return null
  return { group: words[0].toLowerCase(), sub: words[1].toLowerCase(), rest: tokens.slice(i) }
}

/* ============================================================================================= *
 * Refs.
 * ============================================================================================= */

/**
 * The branch a ref token would land on: `+HEAD:refs/heads/main` -> `main`.
 *
 * The DESTINATION half of a refspec is the half that matters -- `git push origin HEAD:main` and
 * `git push origin :main` (which deletes it) both target `main` without containing `main` as a
 * standalone word.
 */
function refTarget(token) {
  const parts = token.replace(/^\+/, '').split(':')
  return parts[parts.length - 1].replace(/^refs\/heads\//, '')
}

const isOption = (t) => t.startsWith('-')
const nonOptions = (rest) => rest.filter((t) => !isOption(t) && t !== '')

/* ============================================================================================= *
 * Rules.
 * ============================================================================================= */

/**
 * The repository's trunk -- the branch checked out in the primary worktree, the base every agent
 * branch is cut from, and the target of every pull request. Renaming trunk is this one line rather
 * than a dozen scattered string literals, and the only reason a rename
 * is cheap is that it is named once.
 */
const TRUNK = 'main'
const TRUNK_REMOTE = `origin/${TRUNK}`

/**
 * Every long-lived branch, not just the trunk. `main` and `release` outlived the trunk rename and
 * are still shared with the primary checkout and with humans, so a task agent has no more business
 * pushing them than pushing `main` -- the rename must not quietly hand back the branches the guard
 * already protected.
 */
const PROTECTED = new Set([TRUNK, ...'main, release'.split(', ')])
const protectedNames = [...PROTECTED].join(', ')

/** Does this ref token land on a branch a task agent must not write? */
const isProtected = (t) => PROTECTED.has(refTarget(t))

const PUSH = `you cannot push to a long-lived branch (${protectedNames}). Push your own branch and open a PR against ${TRUNK}.`
const CHECKOUT = `you cannot switch to or rewrite a long-lived branch (${protectedNames}); ${TRUNK} is checked out in the primary worktree and git would refuse anyway. Stay on your branch.`
const MERGE = `rebase onto ${TRUNK_REMOTE} rather than merging ${TRUNK} into your branch.`
const WORKTREE = 'worktree management belongs to the orchestrator, not to a task agent.'
const OBJECTS = 'the object store is shared with sibling worktrees currently in use.'

/** Flags that create or reset a branch; the name that FOLLOWS one is the branch being written. */
const BRANCH_CREATE = new Set(['-b', '-B', '-c', '-C'])
/** Flags that make `git branch` a write rather than a read. */
const BRANCH_WRITE = new Set(['-f', '--force', '-m', '-M', '-d', '-D', '--delete', '--move'])

/**
 * The reason to deny this git call, or `null` to allow it.
 *
 * `rebase` is deliberately absent: `.worktree/CONTEXT.md` instructs agents to rebase onto
 * `origin/main`, and forbidding it here would contradict the briefing.
 */
function denialFor({ sub, rest }) {
  switch (sub) {
    case 'push': {
      // `--all` and `--mirror` name no ref and push every local branch, the protected ones
      // included. This is the case the substring version allowed outright.
      if (rest.some((t) => t === '--all' || t === '--mirror')) return PUSH
      return nonOptions(rest).some(isProtected) ? PUSH : null
    }
    case 'checkout':
    case 'switch': {
      // `git checkout main -- path` restores one file FROM main without switching branches, which
      // is not the thing this rule exists to stop. An explicit `--` says the command is about
      // paths, so nothing is being checked out.
      if (rest.includes('--')) return null
      // `-b agent/x main` creates a branch FROM main, which is fine. `-B main` rewrites main.
      // Same for the other protected names.
      const created = rest.findIndex((t) => BRANCH_CREATE.has(t))
      if (created !== -1) return isProtected(rest[created + 1] ?? '') ? CHECKOUT : null
      return nonOptions(rest).some(isProtected) ? CHECKOUT : null
    }
    case 'branch': {
      if (!rest.some((t) => BRANCH_WRITE.has(t))) return null
      return nonOptions(rest).some(isProtected) ? CHECKOUT : null
    }
    case 'merge':
      return nonOptions(rest).some((t) =>
        t.startsWith('origin/') ? PROTECTED.has(t.slice(7)) : isProtected(t),
      )
        ? MERGE
        : null
    case 'worktree':
      return WORKTREE
    case 'gc':
    case 'prune':
      return OBJECTS
    case 'reflog':
      return rest.some((t) => t.toLowerCase() === 'expire') ? OBJECTS : null
    default:
      return null
  }
}

/* ============================================================================================= *
 * Pull requests.
 * ============================================================================================= */

const PR_BASE =
  `a pull request must name \`${TRUNK}\` as its base: \`gh pr create --base ${TRUNK} ...\`. ` +
  `This repository's GitHub default branch is \`main\`, it cannot be changed, and it is protected ` +
  `by rules a task agent cannot satisfy -- so an omitted or wrong \`--base\` opens the PR against a ` +
  `branch that will reject it.`
const PR_MERGE = `merging is the orchestrator's call, not a task agent's. Open the PR and stop.`

/**
 * Does this `gh pr create` explicitly target the trunk?
 *
 * FALSE WHEN THE FLAG IS ABSENT, which is the whole point: `gh pr create` with no `--base` silently
 * uses the repository's default branch. That default is `main` here and cannot be changed, so
 * "unspecified" is the exact failure this rule exists to catch -- not a case to wave through.
 */
function basesTrunk(rest) {
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]
    if (t === '--base' || t === '-B') return refTarget(rest[i + 1] ?? '') === TRUNK
    if (t.startsWith('--base=')) return refTarget(t.slice('--base='.length)) === TRUNK
  }
  return false
}

/**
 * The reason to deny this `gh` call, or `null` to allow it. Only `gh pr` is judged.
 *
 * `linked` separates two different kinds of rule that happen to share a command. The BASE rule is a
 * fact about this repository's GitHub configuration -- the default branch is `main`, protected, and
 * not ours to change -- so it is just as true in the primary checkout and applies everywhere. The
 * MERGE rule is about worktree isolation: merging is the orchestrator's call, and in the primary
 * checkout the orchestrator is the person typing, so blocking them there would be wrong.
 */
function denialForGh({ group, sub, rest }, linked) {
  if (group !== 'pr') return null
  if (sub === 'create') return basesTrunk(rest) ? null : PR_BASE
  if (sub === 'merge') return linked ? PR_MERGE : null
  return null
}

/* ============================================================================================= *
 * Walk.
 * ============================================================================================= */

/**
 * Walk every statement, descending into `bash -c` strings. Returns the first reason to deny.
 *
 * The git rules are worktree-only and are skipped entirely when `linked` is false; the `gh pr`
 * rules decide for themselves (see `denialForGh`).
 */
function inspect(command, linked, depth = 0) {
  if (depth > 2) return null
  for (const tokens of parse(command)) {
    if (linked) {
      const call = gitCall(tokens)
      if (call !== null) {
        const reason = denialFor(call)
        if (reason !== null) return reason
      }
    }
    const gh = ghCall(tokens)
    if (gh !== null) {
      const reason = denialForGh(gh, linked)
      if (reason !== null) return reason
    }
    for (const script of inlineScripts(tokens)) {
      const reason = inspect(script, linked, depth + 1)
      if (reason !== null) return reason
    }
  }
  return null
}

/* ============================================================================================= *
 * Entry point.
 * ============================================================================================= */

function deny(reason) {
  process.stderr.write(`BLOCKED by repository policy: ${reason}\n`)
  process.exit(2)
}

// Run by hand, with no payload on stdin: nothing to judge.
if (process.stdin.isTTY) process.exit(0)

// Read stdin BEFORE deciding anything, so the writer never meets a closed pipe.
const input = await readHookInput()
const linked = inLinkedWorktree()

// THE WORKTREE WAS NOT PROVISIONED BY THE SCRIPT. Refuse everything, not just git: the agent is
// about to do real work against a commit it did not choose, and every command it runs deepens that.
// Escaping does not need the shell -- `ExitWorktree` is a tool -- so refusing every Bash command
// leaves a way out rather than a deadlock.
const unprovisioned = linked ? unprovisionedWorktree() : null
if (unprovisioned !== null) {
  const { branch, behind } = unprovisioned
  const distance =
    behind === null
      ? `and its base was not taken from ${TRUNK_REMOTE}`
      : behind > 0
        ? `and it is ${behind} commit(s) behind ${TRUNK_REMOTE}`
        : `and its base was not taken from ${TRUNK_REMOTE}`
  deny(
    `this worktree is on '${branch}', not an agent/* branch, ${distance}. Every worktree here is ` +
      `provisioned by scripts/new-worktree.sh, which cuts agent/<name> from ${TRUNK_REMOTE}. A ` +
      "'worktree-*' branch is the EnterWorktree tool's native fallback, which it uses when the " +
      'WorktreeCreate hook is not registered -- Claude Code snapshots hook config at session start, ' +
      'so a session that began before the hook was added never sees it and bases the worktree off ' +
      'origin/main instead. Do not work here; the checkout may not contain what you were sent to ' +
      'see. Leave with ExitWorktree (action: "remove"), then re-enter -- restarting an old session ' +
      're-reads the hook configuration.',
  )
}

// FAILING CLOSED IS A WORKTREE RULE, NOT A GLOBAL ONE. Inside a linked worktree an unreadable
// payload must not be waved through -- that was the original defect. In the primary checkout the
// same strictness would block every command in the repository over a hook plumbing fault, which is
// far worse than the one mistake left unguarded there, so an unreadable payload is allowed instead.
if (input === null || typeof input?.tool_input?.command !== 'string') {
  if (!linked) process.exit(0)
  deny(
    'the hook payload could not be read, so this command cannot be checked against the worktree ' +
      'rules. This guard fails closed by design.',
  )
}

const command = input.tool_input.command
if (command.trim() === '') process.exit(0)

const reason = inspect(command, linked)
if (reason !== null) deny(reason)
process.exit(0)
