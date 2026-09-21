# `scripts/`

**Single-file gates and git-job scripts: each one either refuses something or does one job a hook
or an operator calls.** An emitter, or a check that is a multi-file module, lives under
`tools/`; a harness hook lives under `scripts/hooks/`.

Each file's header is the authority on it: what it checks, the failure it exists to prevent, its
invocation and what it needs (`CLAUDE.md` § Standing rules for prompts and gates). Where a row here
and a header disagree, the header wins and the row is corrected.

<!-- kit 4.1-1 · WRITE: one row per file, added in the same change as the file. For a gate, say
     what it refuses. The kit lists only what it laid down. -->

| File | Kind | What it is, or what it refuses |
|---|---|---|
| `assert-not-hand-edited.mjs` | pre-commit job | Refuses a staged file that a generator owns and that no longer matches what the generator produces, and names where the change belongs. One verifier per generator, chosen by path; a suspect nothing can verify is reported, never waved through. |
| `check-beads.mjs` | gate, `beads:check` | Refuses an open issue that does not name where its work lands, and an issue citing an identifier that does not resolve from this checkout. Pre-push only: it reads the tracker's database. It skips clean only when `bd` is not found; a `bd` that is found and fails is a failure. |
| `check-count-index.mjs` | gate, `counts:check` | Refuses a value in `count-index.md` that differs from what its source gives, a key with no source, and a deriver whose key is gone. The table is updated from what it reports, never the reverse. |
| `check-jobs.mjs` | gate, `check:jobs` | Refuses a job in `lefthook.yml` or `.github/workflows/verify.yml` that names a package script that does not exist, and a package script no job runs that its own table does not declare by kind. |
| `check-reference-mirrors.mjs` | gate | Refuses an imported file under `reference/` whose hash or byte count disagrees with its manifest row, a manifest row with no file, and an import that ships without its manifest or its README. |
| `check-register-status.mjs` | gate, `check:register` | Refuses a register whose header range, summary table or dates disagree with the entries below them. |
| `lint-ratchet.mjs` | gate, not wired until you choose a linter | Warning counts in existing code may fall and never rise, against a committed baseline; an error is refused at any count. |
| `new-worktree.sh` | operator command | The one way a worktree is provisioned: `agent/<name>` cut from `origin/main`, a checked pair of ports, and a rendered briefing. Run from the primary checkout. |
| `prune-worktree-branches.mjs` | operator command, `worktree:gc` | Removes registered checkouts nobody is using and deletes an agent branch only when its content is already in the trunk. It refuses everything else, and `--dry-run` prints what it would do. |
| `python.mjs` | launcher | Runs a Python script with whichever Python 3 this machine has, probed in a per-platform order, and passes the exit code through. Fails when no interpreter is found. |
| `render-worktree-context.mjs` | helper | Probes and allocates a worktree's ports and renders its briefing from `.claude/worktree-CONTEXT.md.tmpl`. Called by `new-worktree.sh`. |
| `lib/bin-path.mjs` | helper | Resolves a `node_modules/.bin` executable by walking up, as the package manager does, so a gate that spawns a tool runs in a linked worktree. Never `npx`: a gate fails on a missing tool, it does not download one. |
