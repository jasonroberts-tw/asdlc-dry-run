# `.claude/`

**Session configuration, not project content.** What the harness loads when a session starts here.

| Path | What it is |
|---|---|
| `settings.json` | Tracked. Two things and nothing else: the enabled plugins and the hook registrations, each with a `statusMessage` and an explicit `timeout` sized to the hook. |
| `settings.local.json` | Untracked (`.gitignore`). Machine-specific permissions: the allow-list that pre-empts the permission classifier on command shapes it cannot resolve. Never a hook, never a plugin. |
| `skills/<name>/SKILL.md` | Skills a session can invoke. Each opens with "Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it." |
| `agents/<name>.md` | Agent definitions the harness can spawn, under the same opening line. |
| `worktree-CONTEXT.md.tmpl` | The briefing `scripts/render-worktree-context.mjs` renders into a new worktree as `.worktree/CONTEXT.md`, which `CLAUDE.md` imports. |
| `worktrees/` | Where the harness provisions worktrees. Gitignored; the rule is load-bearing (see `.gitignore`). |

## The hooks

Every hook is a Node script under `scripts/hooks/`, registered in `settings.json`, and can be run by
hand with `node scripts/hooks/<name>.mjs < /dev/null` because the shared stdin reader returns null on
empty input.

| Event | Script | Blocks? | What it does |
|---|---|---|---|
| `PreToolUse` on Bash | `guard-git.mjs` | yes, in a linked worktree | Tokenises the command; refuses pushes, checkouts, branch writes and merges against the protected branches, and `git worktree`, `gc` and `prune`, from a worktree. A no-op in the primary checkout. Fails closed when it cannot read its input. |
| `PreToolUse` on Write and Edit | `block-generated-edit.mjs` | yes | Refuses an edit to generated output and names where the change belongs. |
| `PostToolUse` on Write and Edit | `check-emitted-drift.mjs` | never | Re-runs the `:check` twin of any emitter whose input was just edited. |
| `Stop` | `gate-summary.mjs` | never | Runs the fastest gates concurrently and prints one verdict line into the transcript. It never denies the stop: a hook people disable is a lie in version control. |
| `WorktreeCreate` | `worktree-create.mjs` | yes | Provisions through `scripts/new-worktree.sh`: `agent/<name>` cut from `origin/main`, with a rendered briefing, never the harness's native fallback off the default branch. |
| `WorktreeRemove` | `worktree-remove.mjs` | no | Removes the checkout, keeps the branch, and runs the branch sweep for paths under `.claude/worktrees/` only. |

**Hook configuration is snapshotted at session start.** A session that began before a hook was
added never sees it and silently gets the native behaviour; restart the session after changing
`settings.json`. The hook budget is a few hundred milliseconds: an in-session hook may be unsound
(a cached lint is) but must be fast, and a slower tier of the gate ladder never trusts a faster one.
