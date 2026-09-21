# `.devcontainer/` — the whole machine setup, as an image

**The "new machine setup" half of the root `README.md`, baked into a container.** With Docker, VS
Code and the Dev Containers extension, the only prerequisite is the clone:

```bash
git clone https://github.com/<owner>/<repository>.git
code <repository>           # then: "Reopen in Container" when VS Code offers
```

The first build takes several minutes and is cached afterwards. You get Node, `bd`, the .NET SDK for
the C# extractors, `gh`, Claude Code and the beads plugin marketplace.

| File | What it holds |
|---|---|
| `Dockerfile` | Every tool, as a layer. Versions are `ARG`s at the top and match the ones the root `README.md` and CI already name — bump them here when you bump them there. |
| `devcontainer.json` | Almost nothing: a pointer at the Dockerfile, the `remoteUser`, three bind mounts and one passthrough env var. |
| `entrypoint.sh` | The three setup steps that read the repository, which is a bind mount and does not exist at build time. |

## Why the split is where it is

**Setup goes in a layer, not in a lifecycle command.** `features` resolve over the network every
time a container is created and fail differently on every machine; a `postCreateCommand` re-runs on
every rebuild. A layer is built once and is identical for everyone. If you add a tool, add a layer.

`entrypoint.sh` holds only what cannot be an image layer — `npm ci` (whose `node_modules` carries
native binaries and so belongs to the container's platform), installing the lefthook and `bd` git
hooks, and hydrating the Dolt issue database. It is wired to `ENTRYPOINT` so `devcontainer.json`
needs no lifecycle command, runs on every start, and is idempotent. **Nothing in it may fail the
container**: this is the process that starts the shell you would use to fix a setup problem, so
every step warns and carries on.

**The mounts are the one thing an image cannot bake**, because a login is yours and not the
project's. `~/.claude`, `~/.claude.json` and `~/.config/gh` are bind-mounted from the host, so:

- **Run `claude` and `gh` on the host once before you first open the container.** Docker answers a
  bind mount whose source is missing by creating it as an empty root-owned *directory*, and
  `~/.claude.json` then exists as a directory where a file belongs. `entrypoint.sh` detects both and
  says so, but the fix is on the host.
- Container sessions **share** your host's Claude Code state — history, projects, plugins. The mount
  is read-write because Claude Code rewrites `.credentials.json` on token refresh.
- On a Windows host, `gh` keeps its config in `%APPDATA%\GitHub CLI`, so that mount lands empty; set
  `GH_TOKEN` before launching VS Code and `devcontainer.json` passes it through. Your git identity
  does not come across — set `user.name` and `user.email` in the container once.

The container is Linux, so the root `README.md` caveat applies: a clone used from the container
should not also be built on Windows.
