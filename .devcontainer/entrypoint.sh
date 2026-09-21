#!/usr/bin/env bash
# The three setup steps that cannot be image layers, because each one reads the repository and the
# repository is a bind mount that does not exist at build time:
#
#   1. `npm ci`                   -- node_modules holds native binaries, so it belongs to the
#                                    container's platform, not the host's. This is also why
#                                    README.md tells people never to share a clone between Windows
#                                    and WSL.
#   2. the git hooks              -- lefthook and `bd hooks install`, both of which write .git/hooks.
#   3. the beads issue database   -- a Dolt DB under .beads/embeddeddolt/, not in git.
#
# ...and the wiring for the credential mounts declared in devcontainer.json, which is here for the
# same reason: it depends on what those mounts actually brought in, which is a fact about the host
# and unknown at build time.
#
# Wired to ENTRYPOINT by the Dockerfile so that devcontainer.json needs no lifecycle command. Runs
# on every container start, which is why every step below is idempotent and cheap when there is
# nothing to do.
#
# Nothing here is allowed to fail the container. This is the process that starts the shell you would
# use to fix a setup problem; exiting non-zero would lock you out of it. Every step warns and
# carries on.

set -uo pipefail

log() { printf '\033[36m[devcontainer]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[devcontainer]\033[0m %s\n' "$*"; }

setup() {
  local repo="${REPO_WORKSPACE:-}"

  # Which mounted directory is this repository? Named by package.json rather than by path, because
  # the mount point is the clone's directory name and people clone into whatever they like.
  if [ -z "$repo" ]; then
    local candidate
    for candidate in /workspaces/*/; do
      if grep -sq '"<package-name>"' "${candidate}package.json"; then
        repo="${candidate%/}"
        break
      fi
    done
  fi

  if [ -z "$repo" ] || [ ! -d "$repo" ]; then
    warn 'workspace not found; skipping setup (set REPO_WORKSPACE if it is mounted elsewhere)'
    return 0
  fi

  cd "$repo" || return 0

  # `npm ci`, but only when it would change something. The marker records the lockfile hash the
  # current node_modules was installed from, so a rebuild after a dependency bump reinstalls, and an
  # ordinary container restart costs one checksum. `ci` and not `install`: package-lock.json is
  # authoritative and CI installs the same way.
  local marker='node_modules/.devcontainer-lock-hash'
  local want have
  want="$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)"
  have="$(cat "$marker" 2>/dev/null)"
  if [ -n "$want" ] && [ "$want" != "$have" ]; then
    log 'npm ci'
    if npm ci; then
      printf '%s' "$want" >"$marker"
    else
      warn 'npm ci failed -- fix the cause and run it again yourself'
    fi
  fi

  # Both installers, and both are required. lefthook runs the format/lint gates on commit and the
  # heavier gates on push; `bd hooks install` restores beads' own git integration, which installing
  # lefthook otherwise turns off without telling anyone (see the comment in lefthook.yml).
  if [ -x node_modules/.bin/lefthook ]; then
    node_modules/.bin/lefthook install >/dev/null 2>&1 || warn 'lefthook install failed'
  fi
  bd hooks install --chain >/dev/null 2>&1 || warn 'bd hooks install failed'

  # The Dolt remote is already configured in .beads/config.yaml (refs/dolt/data on the GitHub
  # remote), so hydrating needs credentials for that remote. Until `gh auth login` has been run it
  # cannot work, which is a hint and not an error. Never `bd init` -- that creates a new tracker
  # rather than joining this one.
  if [ ! -d .beads/embeddeddolt ]; then
    log 'hydrating the beads issue database'
    bd bootstrap >/dev/null 2>&1 \
      || warn 'bd bootstrap failed -- run `gh auth login`, then `bd bootstrap` (never `bd init`)'
  fi

}

# The mounts declared in devcontainer.json carry your host logins in; this makes them usable. Each
# check exists because the corresponding failure is silent and looks like something else.
credentials() {
  # A bind mount whose source does not exist on the host is created by the daemon as an empty
  # root-owned directory, and the tool that owns it then fails on a write it should have been able
  # to make. `vscode` has passwordless sudo in this base image.
  local path
  for path in "$HOME/.claude" "$HOME/.config/gh"; do
    if [ -d "$path" ] && [ ! -w "$path" ]; then
      warn "taking ownership of $path (it arrived root-owned, so the host path was missing)"
      sudo chown -R "$(id -u):$(id -g)" "$path" 2>/dev/null || warn "chown $path failed"
    fi
  done

  # Same cause, worse symptom: Claude Code reads ~/.claude.json as a file, and a directory there is
  # a parse error rather than a missing login.
  if [ -d "$HOME/.claude.json" ]; then
    warn '~/.claude.json is a directory -- your host has no ~/.claude.json for the mount to bind.'
    warn 'Run `claude` once on the host, or drop that mount from .devcontainer/devcontainer.json.'
  fi

  # Teaches git to use gh's token, which is what makes `git push` and `gh pr create --base main` work
  # over https without a second credential. Idempotent; writes the container's own ~/.gitconfig,
  # which is why that file is deliberately NOT mounted from the host.
  if gh auth status >/dev/null 2>&1; then
    gh auth setup-git >/dev/null 2>&1 || warn 'gh auth setup-git failed'
  else
    warn 'gh is not authenticated -- run `gh auth login`, or see the ~/.config/gh mount in devcontainer.json'
  fi

  # The image registers the beads marketplace at build time, but a mounted ~/.claude hides the
  # image's copy of it, so the answer depends on the host's state and has to be re-checked here.
  # Missing it is the most common cause of "the beads skills aren't showing up".
  if ! claude plugin marketplace list 2>/dev/null | grep -q 'beads-marketplace'; then
    claude plugin marketplace add gastownhall/beads >/dev/null 2>&1 \
      || warn 'could not add the beads plugin marketplace -- `claude plugin marketplace add gastownhall/beads`'
  fi

  # ~/.gitconfig is container-local for the reason given above, so an identity set on the host does
  # not reach here, and a commit made without one is a commit nobody can attribute.
  if [ -z "$(git config --global user.email)" ]; then
    warn 'git identity unset: git config --global user.name "..." && git config --global user.email "you@example.com"'
  fi
}

setup || true
credentials || true

# Last, so that anything above it reads as a warning about a container that is otherwise ready.
log 'ready: bd ready | npm run lint | npm run typecheck | claude'

exec "$@"
