#!/usr/bin/env bash
# scripts/new-worktree.sh <task-ref> <slug>
#
# Creates one isolated worktree per agent task: a branch off origin/main, a checked pair of
# dev-server ports, and a rendered .worktree/CONTEXT.md briefing that the committed CLAUDE.md
# @-imports.
#
# There is no database, container stack or .env to provision -- this repository is a Node/TypeScript
# Storybook. An earlier version of this script copied .env, certs and appsettings.Development.json
# and wrote COMPOSE_PROJECT_NAME/DB_NAME/DB_PORT into .env; none of those files or services exist
# here, so every line of it was inert. Ports are the only real isolation, and
# scripts/render-worktree-context.mjs owns them.
#
# It also does not install dependencies. node_modules is gitignored and platform-native, so the new
# checkout has none; `npm ci` is the first command inside the worktree, and both the summary printed
# below and the rendered briefing say so.
#
# Run from the primary checkout.

set -euo pipefail

# Two calling conventions. `<task-ref> <slug>` is the orchestrator's, and the one the briefing's
# prose is written around. The single-argument form takes an already-composed name, and exists for
# scripts/hooks/worktree-create.mjs: the harness hands that hook one opaque worktree name with no way
# to split it back into a bead ref and a slug. Both forms land on the same NAME, so there is one code
# path below and no second way for a worktree to get provisioned.
TASK_REF="${1:?usage: new-worktree.sh <task-ref> <slug> | new-worktree.sh <name>}"
SLUG="${2:-}"
if [ -n "$SLUG" ]; then NAME="${TASK_REF}-${SLUG}"; else NAME="$TASK_REF"; fi

# The PRIMARY checkout, never the current one. `--show-toplevel` answers with the worktree you are
# standing in, so running this from inside a worktree nested the next one underneath it -- measured
# as ../worktrees/worktrees/<name>. `--git-common-dir` is shared by every worktree and is always
# `<primary>/.git`, so stripping that suffix gives the primary working tree from anywhere.
REPO_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
# Worktrees live INSIDE the repository, at the path the Claude Code `EnterWorktree` tool uses
# natively, so the tool and this script agree on WHERE and there is nothing left to fight about.
# `.gitignore` covers `.claude/worktrees/`, which is what keeps each checkout's own `.git` from
# reading to the parent as a gitlink and being committed as a phantom submodule.
WORKTREE_ROOT="${WORKTREE_ROOT:-$REPO_ROOT/.claude/worktrees}"
LIFETIME_HOURS="${LIFETIME_HOURS:-2}"

BRANCH="agent/${NAME}"
WORKTREE_PATH="${WORKTREE_ROOT}/${NAME}"

# Anything that fails AFTER `worktree add` succeeds has to undo it. Without this, a failure in the
# renderer left the worktree and the branch on disk, and the obvious fix -- run the script again --
# died on `fatal: a branch named 'agent/...' already exists` with no hint that the way out is
# `git worktree remove` plus `git branch -D`.
CREATED=0
cleanup() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$CREATED" -eq 1 ]; then
    echo "provisioning failed (exit $code); removing the worktree and branch" >&2
    git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
    git -C "$REPO_ROOT" branch -D "$BRANCH" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup EXIT

# The trunk is `main` -- see CLAUDE.md. Overridable so a hotfix worktree can be cut
# from a release branch without editing this script.
TRUNK="${TRUNK_BRANCH:-main}"

# A failed fetch must not block provisioning. `set -e` used to abort here, which was tolerable when a
# human ran the script and could retry, but scripts/hooks/worktree-create.mjs calls this from inside
# the agent sandbox where the network is unreachable -- an aborted fetch there means the harness
# cannot create a worktree at all. Basing off a local `origin/main` that is minutes stale is strictly
# better than that, so the failure warns and continues. It is not silent: the base commit's date is
# printed below, which is what tells the operator the ref is old.
if ! git -C "$REPO_ROOT" fetch origin "$TRUNK" --quiet 2>/dev/null; then
  echo "warning: could not fetch origin/$TRUNK (offline or sandboxed); using the local ref" >&2
fi
BASE_SHA="$(git -C "$REPO_ROOT" rev-parse --short "origin/$TRUNK")"
BASE_DATE="$(git -C "$REPO_ROOT" log -1 --format=%ci "origin/$TRUNK")"
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_PATH" "origin/$TRUNK"
CREATED=1

# Ports, timestamps and the briefing. See the renderer's header for why this is not another `sed`.
RENDER="$(node "$REPO_ROOT/scripts/render-worktree-context.mjs" \
  "$WORKTREE_PATH" "$BRANCH" "$BASE_SHA" "$TASK_REF" "$LIFETIME_HOURS")"

value_of() { printf '%s\n' "$RENDER" | sed -n "s/^$1=//p"; }

echo "worktree: $WORKTREE_PATH"
echo "branch:   $BRANCH (from $BASE_SHA, $BASE_DATE)"
echo "ports:    vite $(value_of APP_PORT) / storybook $(value_of SB_PORT)"
echo "deadline: $(value_of DEADLINE)"
echo
echo "start the agent with:  cd '$WORKTREE_PATH' && claude"
# node_modules is gitignored, so `git worktree add` does not bring it across and nothing here
# installs it -- an unprovisioned checkout fails every gate on a missing binary. The briefing says
# so too; this line is for whoever is reading the terminal instead.
echo "first command there:   npm ci   (a fresh worktree has no node_modules)"
