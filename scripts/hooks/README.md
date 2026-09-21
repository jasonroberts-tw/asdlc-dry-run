# `scripts/hooks/`

**Harness hooks only: the in-session tier of the gate ladder, run on every matching tool call,
inside a budget of a few hundred milliseconds.** A git pre-commit or pre-push job is a script under
`scripts/`, never here. A hook may be unsound, because a slower tier never trusts it
(`CLAUDE.md` § The gate ladder); it may not be slow, and it never blocks a stop.

A file here runs only when `.claude/settings.json` registers it, and a session reads that file once,
at its start. Where this table and the settings file disagree, the settings file wins.
The settings file registers `CNT-HOOKS` hooks.
Every hook carries the same four-part header as a gate (`CLAUDE.md` § Standing rules for prompts and
gates), and every one can be run by hand with empty input, where it exits clean with nothing to do.

<!-- kit 4.1-1 · WRITE: one row per file, added in the same change as the file and its
     registration. The kit lists only what it laid down. -->

| File | Event | Blocks? | What it is, or what it refuses |
|---|---|---|---|
| `_shared.mjs` | none: imported | | The helpers every hook here shares: the stdin reader that returns null on empty input, the repository root, and the generated-output predicates. `node` and `fs` only, because it is loaded on every tool call. |
| `block-generated-edit.mjs` | `PreToolUse` on Write and Edit | yes | Refuses an edit to generated output, and names the hand-maintained source where the change belongs. |
| `check-emitted-drift.mjs` | `PostToolUse` on Write and Edit | never | Re-runs the `:check` twin of any emitter whose input was just edited. |
| `gate-summary.mjs` | `Stop` | never | Runs the fastest gates concurrently and prints one verdict line. It never denies the stop: a hook people disable is a lie in version control. |
| `guard-git.mjs` | `PreToolUse` on Bash | yes, in a linked worktree | Tokenises the command and refuses, from a worktree, a push, checkout, branch write or merge against a protected branch, and `git worktree`, `gc` and `prune`. A no-op in the primary checkout. Fails closed when it cannot read its input. |
| `worktree-create.mjs` | `WorktreeCreate` | yes | Provisions through `scripts/new-worktree.sh`, so a worktree is always `agent/<name>` cut from `origin/main` with a rendered briefing, never the harness's native fallback. |
| `worktree-remove.mjs` | `WorktreeRemove` | no | Removes the checkout, keeps the branch, and runs the branch sweep for paths under `.claude/worktrees/` only. |
| `worktree-hooks.selftest.mjs` | none: `worktree:selftest` | | The negative tests for the two worktree hooks, the guard and the branch sweep. Each case asserts the reason a refusal reports, not the refusal alone. A pre-push job. |
