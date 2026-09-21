# The whole "new machine setup" of README.md, baked into an image.
#
# Everything a person would otherwise do by hand -- Node, `bd`, `gh`, Claude Code and the tracker's plugin marketplace -- is a layer here
# rather than a devcontainer.json `feature` or `postCreateCommand`. That is deliberate: features
# resolve at container-create time over the network and fail differently on every machine, and a
# `postCreateCommand` re-runs on every rebuild. A layer is built once, cached, and identical for
# everyone. devcontainer.json next to this file does nothing but point at it.
#
# The only steps NOT in a layer are the three that need the repository itself, which is a bind mount
# that does not exist at build time: `npm ci`, the git hooks, and hydrating the issue database.
# Those live in entrypoint.sh, which this file copies in and wires to ENTRYPOINT -- so the setup is
# still owned by the image, and devcontainer.json still has no lifecycle command in it.
#
# Versions are the ARGs below, and they are the ones README.md and CI already name. Bump them here
# when you bump them there.

FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# 22 LTS, matching .github/workflows/verify.yml. Development happens on 26 and nothing in this
# toolchain is version-sensitive, so the container matches CI rather than any one desk.
ARG NODE_MAJOR=22
# Matches .beads/.local_version.
ARG BD_VERSION=1.2.2

ENV DEBIAN_FRONTEND=noninteractive

# The extractors are console apps; neither the telemetry ping nor the first-run banner has anywhere
# useful to go from here.
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

# bd 1.2.2 sniffs terminal capability by writing OSC 11 to the tty and exiting without reading the
# reply; the terminal's answer lands in the shell's input queue and is executed as if typed
# (`11: command not found`). NO_COLOR makes it skip the probe entirely. Same reason as the NO_COLOR
# on every bd job in lefthook.yml -- CI=1 and BD_NO_COLOR=1 do not work.
ENV NO_COLOR=1

# --- base packages ------------------------------------------------------------------------------
# build-essential is README.md's WSL step 1: some npm dependencies still compile on install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        gnupg \
        jq \
        less \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# --- Node ---------------------------------------------------------------------------------------
# NodeSource rather than the nvm dance in README.md: nvm is a shell function, so it exists only in
# an interactive login shell, and every hook, ENTRYPOINT and `docker exec` would miss it.
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node -v \
    && npm -v

# --- GitHub CLI ---------------------------------------------------------------------------------
# Every pull request here is `gh pr create --base dev` (CLAUDE.md), and in a linked worktree a pull
# request is the only route to trunk.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# --- a language toolchain, if your project needs one ---------------------------------------------
# NOTHING IS INSTALLED HERE BY DEFAULT. Add the SDK your own projects build with, and take it from
# the base image's own archive where it carries one, so the layer costs no third-party repository.
#
# THE VERSION HAS TO TRACK WHAT THE PROJECTS TARGET, and that is the failure worth writing down
# here: a change once bumped every project's target framework and updated the README's setup step
# without touching this file, so the image went on installing the older SDK and failed every build
# with a "does not support targeting" error. Pin ONE version, not two -- keeping the old one
# alongside only hides the next mismatch.

# --- global npm tools ---------------------------------------------------------------------------
# `bd` is pinned to the database's version. Claude Code deliberately is not: it self-updates, so a
# pin here would only ever be stale.
RUN npm install -g \
        "@beads/bd@${BD_VERSION}" \
        @anthropic-ai/claude-code \
    && npm cache clean --force

# --- git configuration --------------------------------------------------------------------------
# The workspace is a bind mount owned by the host user, whose uid rarely matches the container's;
# without safe.directory git calls the whole repository untrusted and every hook fails.
# core.autocrlf input is README.md's line-endings step -- scripts/*.sh must stay LF or bash dies on
# an invisible carriage return.
RUN git config --system --add safe.directory '*' \
    && git config --system core.autocrlf input

# --- workspace setup, deferred to container start ------------------------------------------------
# npm ci, the git hooks and the issue database all read files that arrive only when the workspace is
# mounted, so they cannot be layers. ENTRYPOINT is how they stay in the image anyway: the
# devcontainer CLI replaces the container's *command* with a sleep, and leaves the image's
# entrypoint alone.
COPY entrypoint.sh /usr/local/bin/workspace-entrypoint
RUN chmod 0755 /usr/local/bin/workspace-entrypoint

USER vscode

# .claude/settings.json (committed) enables `beads@beads-marketplace`, but the marketplace itself is
# a per-user registration, and skipping it is the most common cause of "the beads skills aren't
# showing up" (README.md step 7). Non-fatal, and belt-and-braces: an image build that cannot reach
# GitHub should still produce a working container, and devcontainer.json's ~/.claude mount hides
# this copy whenever it is present. entrypoint.sh asks `claude plugin marketplace list` at start and
# adds it if whatever ended up at ~/.claude does not have it.
RUN claude plugin marketplace add gastownhall/beads || true

ENTRYPOINT ["/usr/local/bin/workspace-entrypoint"]
CMD ["sleep", "infinity"]
