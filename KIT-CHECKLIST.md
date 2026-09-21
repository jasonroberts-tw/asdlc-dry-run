# Kit checklist

Written by the kit's `tools/bootstrap.mjs` from templates extracted from the source at commit b910b553f6598242692fbfc13776aab3a33e6d97. One line per Take bullet of the source catalogue; a ticked box means this run laid the file down (or an authored template covers it), and an adapt bullet still needs adapting. Re-running the bootstrap regenerates this file and refuses to overwrite a file you have changed unless `--force`. Delete this file and `.kit/` when every box is ticked or deliberately skipped.

## Parameters used

| Parameter | Value |
|---|---|
| `<trunk>` | `main` |
| `<protected-branches>` | `main, release` |
| `<agent-branch-prefix>` | `agent/` |
| `<task-store>` | `bd` |
| `<hook-runner>` | `lefthook` |
| `<package-runner>` | `npm` |
| `<checks-dir>` | `scripts/` |
| `<emitters-dir>` | `tools/` |
| `<hooks-dir>` | `scripts/hooks/` |
| `<generated-root>` | `artifacts/` |
| `<imports-dir>` | `reference/` |
| `<scratch-dir>` | `.scratch/` |
| `<gates-command>` | `npm run gates` |
| `<ci>` | `.github/workflows/verify.yml` |
| `<docs-dir>` | `docs/` |
| `<register>` | `docs/decisions.md` |
| `<decision-id>` | `D-NN` |
| `<risk-id>` | `R-NN` |
| `<retired-dir>` | `docs/retired/` |
| `<count-index>` | `count-index.md` |
| `<count-key-prefix>` | `CNT-` |
| `<prompt-reviews-dir>` | `docs/prompt-reviews/` |
| `<workflow-name>` | `dry-run` |
| `<workflow-dir>` | `dry-run/` |
| `<run-dir>` | `.dry-run/run/<item>/` |
| `<policy-file>` | `dry-run/workflow-policy.json` |
| `<records-dir>` | `artifacts/outcomes/records/` |
| `<record-schema>` | `dry-run/run-outcome.schema.json` |

## A. The first commit

### Step 1 · § 1.1 One home for agent rules (Full)

- [x] **write** — write `CLAUDE.md` at the root as the only home for a rule an agent must follow, and state in it that such a rule has exactly one home: `CLAUDE.md`, a skill under `.claude/skills/`, an agent under `.claude/agents/`, or the header of the tool or gate that enforces it
  - unchanged → `CLAUDE.md`
- [x] **adapt** — adapt `CLAUDE.md` § Rules for agents live in tracked files, and nowhere else, into it: the tracker's memory commands (in Beads, `remember`, `recall` and `memories`) and the harness's per-project memory directory under `~/.claude/projects/` are not used, named as such, and a fact worth keeping goes in a tracked file or, if it is work, in `<task-store>`
  - authored (authored/CLAUDE.md.tmpl), unchanged; now adapt as the bullet says
- [x] **write** — write `AGENTS.md` as one line pointing at `CLAUDE.md`, so a second agent-instruction home never grows
  - unchanged → `AGENTS.md`
- [x] **write** — write, as the first line of every substantial skill and agent, "Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it." (a standing rule; the first skill arrives with 1.10)
  - unchanged → `CLAUDE.md`

  Adapt: The block a tracker plugin manages inside `CLAUDE.md` is guidance, not permission to override the rest of the file; say so above it, and keep your own sections outside it, because the plugin regenerates its block.

  Skip when: Never. This is the first commit.

### Step 2 · § 1.2 Bash command style, and Guards (Full)

- [x] **adapt** — adapt `CLAUDE.md` § Bash Command Style into your `CLAUDE.md`: run each gate, test and git command as its own Bash call; no `&&`, `;` or `|` chains, no heredocs; never `cd` and never name a directory; name the file as an explicit repository-relative argument; keep long prose out of the command line and pass it from a file with `-F`, `--body-file` or the tool's equivalent; prefer the Read, Edit and Write tools over `cat`, `sed -n` and shell redirection; read anything outside the repository in its own call; never let a secret-shaped read share a call with real work
  - authored (authored/CLAUDE.md.tmpl), unchanged; now adapt as the bullet says
- [x] **adapt** — adapt `CLAUDE.md` § Guards: a command the permission classifier refuses is skipped, never worked around, and every such command is collected into one `RUN THESE YOURSELF` block at the end of the report, in order
  - authored (authored/CLAUDE.md.tmpl), unchanged; now adapt as the bullet says
- [x] **write** — write `<scratch-dir>/` at the checkout root, gitignored, for commit messages, pull-request bodies and tracker notes; pass each by file
  - unchanged → `.gitignore`

  Adapt: The classifier is a model's judgement, so the rules move the odds rather than guarantee the outcome; keep the Guards block as the fallback. If your harness has no permission classifier, keep the one-command-per-call rule anyway: it is what makes a failing step attributable.

  Skip when: Never while an agent runs shell commands.

### Step 3 · § 1.12 Small hygiene worth copying (Brief)

- [x] **adapt** — `.gitattributes` with `* text=auto eol=lf` moves line endings out of per-machine settings; before widening a pattern, measure with `git ls-files --eol` as its header did (11 of 2,133 tracked files were affected, none mixed), and carve imported bytes out with `-text`.
  - unchanged; now adapt as the bullet says → `.gitattributes`
- [x] **adapt** — `.git-blame-ignore-revs` lists only pure-formatting commits and explains the big reformat it deliberately omits, because the setting works per commit, not per file.
  - unchanged; now adapt as the bullet says → `.git-blame-ignore-revs`
- [x] **adapt** — `NO_COLOR: '1'` on every job that runs a third-party CLI, with the reason (`lefthook.yml`): one tool probed the terminal and left its replies in the shell's input queue.
  - authored (authored/lefthook.yml), unchanged; now adapt as the bullet says → `lefthook.yml`
- [x] **adapt** — `scripts/python.mjs` probes for a real interpreter instead of assuming a name; on one platform the obvious name is a store alias that exits with no output.
  - unchanged; now adapt as the bullet says → `scripts/python.mjs`
- [x] **adapt** — `scripts/lib/bin-path.mjs` resolves a `node_modules/.bin` tool by walking up, never `npx`, because a linked worktree has an almost empty `node_modules` and "these scripts are gates; they must fail on a missing tool, not paper over it".
  - unchanged; now adapt as the bullet says → `scripts/lib/bin-path.mjs`
- [x] **adapt** — `package.json` pins `engines` to the runtime feature it needs and allow-lists install scripts.
  - authored (authored/package.json), unchanged; now adapt as the bullet says → `package.json`, `package-lock.json`
- [x] **adapt** — `.devcontainer/` stays almost empty: nothing that resolves over the network at create time, and each bind mount documented with its failure mode.
  - unchanged; now adapt as the bullet says → `.devcontainer/Dockerfile`, `.devcontainer/README.md`, `.devcontainer/devcontainer.json`, `.devcontainer/entrypoint.sh`
- [x] **adapt** — `.gitignore` entries that are load-bearing carry a paragraph saying why.
  - authored (authored/gitignore), unchanged; now adapt as the bullet says → `.gitignore`
- [x] **adapt** — A platform workaround lives in the committed file with the upstream issue number and the measurement (`lefthook.yml`; `lefthook-windows.yml` is the three-line local override for a platform where the runner hangs in parallel).
  - authored (authored/lefthook.yml), unchanged; now adapt as the bullet says → `lefthook.yml`, `lefthook-windows.yml`

### Step 4 · § 3.1 The decision register, and how things retire (Full)

- [x] **write** — write `<register>`: one file of numbered decisions and risks, `<decision-id>` and `<risk-id>`, each entry with a fixed skeleton — a heading carrying the id and a title; a **Recorded** date with the issue that carried it; what it amends or builds on; the decision; why; the file-level record of what changed; and every figure with the command that re-derives it beside it; and, at the head of the file, a status line stating the recorded range and a summary table of ids and titles, which the gate below holds to the headings
  - unchanged → `docs/decisions.md`
- [x] **write** — write the amendment rule: an entry is never rewritten; a later decision adds a dated `**Amended <date> by <id>.**` blockquote under each entry it changes and lists them in its own body; a superseded entry keeps its heading, marked superseded; a withdrawn risk keeps its id, which is never reused, and is never reported as closed or met
  - unchanged → `docs/decisions.md`
- [x] **write** — write the precedence sentence into the documentation index — when a document and the register disagree, the register wins — and into `CLAUDE.md`: no agent re-litigates a recorded decision
  - unchanged → `docs/README.md`, `docs/decisions.md`, `CLAUDE.md`
- [x] **copy** — copy `scripts/check-register-status.mjs` → `<checks-dir>/` and adapt its anchors: the header's range, its summary table and the per-entry dates are held to the actual headings in both directions, and a file that cites the register without a bound must not grow one
  - unchanged → `scripts/check-register-status.mjs`, `package.json`, `package-lock.json`, `lefthook.yml`, `.github/workflows/verify.yml`
- [x] **write** — write the three retirement dispositions into `<retired-dir>/README.md` — move a file there under a head banner naming the decision and what survived, when a live gate or citation still needs its lineage and no live reader reads any part of it; delete it outright under a register entry, with `git show` as the recovery, when nothing live reads it (a row in an index does not count); move the paragraph, not the file, when one paragraph is all that keeps it alive — and the rule over all three: moving a file out is a register decision with a checklist, not a tidy-up
  - unchanged → `docs/retired/README.md`
- [x] **copy** — copy `.claude/skills/retire-asset/SKILL.md`
  - unchanged → `.claude/skills/retire-asset/SKILL.md`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 3.1`):

  ```bash
  npm run check:register
  ```

  Adapt: `<register>` may be one file or one per decision; the skeleton, the amendment rule and the gate are the value. The id schemes are defaults.

  Skip when: Never. The first decision worth writing down arrives before the first gate.

### Step 5 · § 4.1 Every directory and document says what it is, and who wins (Full)

- [x] **write** — write a `README.md` in every directory that holds more than one file of one kind: a bolded one-sentence thesis of the directory's role, then a table with one row per file saying what it is or, for a gate, what it refuses
  - unchanged → `scripts/README.md`, `scripts/hooks/README.md`, `tools/README.md`
- [x] **write** — write a documentation index at `<docs-dir>/README.md`: one row per document, and a Conventions block stating that a dated document stays true about its date and is superseded rather than refreshed, that numbers cite their source, and that the status of work lives in `<task-store>` and never in a document
  - unchanged → `docs/README.md`
- [x] **write** — write, at the head of every dated document, a `**Written:**` line and, once something amends it, a `**Status:**` line naming what did
  - unchanged → `docs/README.md`, `CLAUDE.md`
- [x] **write** — write, in every document that can disagree with another, one sentence saying which wins
  - unchanged → `docs/README.md`, `CLAUDE.md`
- [x] **write** — write the root `README.md`'s setup numbered per platform, ending with a table of what runs automatically: trigger, effect, and the file that wires it
  - unchanged → `README.md`

  Adapt: The thesis-plus-table shape is the whole convention; the wording is yours. The table of what runs automatically is only as long as your hooks.

  Skip when: A directory holds one file, or a repository has one document.

### Step 6 · § 4.2 The tool-header convention (Full)

- [x] **write** — write, at the top of every script under `<checks-dir>/` and every emitter under `<emitters-dir>/`, a header with four parts in this order: what it emits or checks; **the failure it exists to prevent**, as the incident that happened, dated, with the wrong fix tried first where there was one; the invocation with its flags; and what it needs (another checkout, a token, a network); on day one, with no incident yet, the paragraph says what the script would let through if it were wrong, and the first incident replaces it
  - unchanged → `CLAUDE.md`
- [ ] **adapt** — adapt the header block of `tools/navigation/index.ts` for an emitter: four labelled lines, `KIND` (its lifecycle), `INVARIANTS` (what it never does), `RE-ENTRY` (whether a second run is idempotent and what `--check` does), `STALE WHEN` (the inputs whose change makes its output stale)
  - read authored/reference/emitter-shape.mjs in the kit (the source's own file was excluded as mostly its subject)
- [x] **write** — write the same shape into every hook under `<hooks-dir>/`
  - unchanged → `CLAUDE.md`

  Adapt: Keep the four parts; drop the capitalised labels if your team finds them loud. The incident paragraph is the one to keep when cutting.

  Skip when: Never for a gate or an emitter. A ten-line helper can carry one sentence.

## B. The tracker

### Step 8 · § 1.3 One task store the agent drives (Full)

- [ ] **install** — install `<task-store>`: one issue tracker with a command-line interface the agent can query, claim, note and close, whose state syncs through the same remote as the code; the default is Beads (`bd`), whose database syncs over a git ref, initialised with `bd bootstrap` and never `bd init`, which would take over the git hooks directory
  - install by hand
- [x] **write** — write into `CLAUDE.md`: every task is an issue there, never a markdown checklist or an in-session todo list; `bd ready` is the queue; every run of writes is bracketed by a pull before the first and a push after the last, and a rejected push is reported, never forced; long descriptions and notes go in by file
  - unchanged → `CLAUDE.md`
- [x] **adapt** — adapt `.beads/config.yaml`: its remote. copy the `beads` jobs of `lefthook.yml` (one per git hook the tracker owns) into `<hook-runner>`'s configuration once 1.6 has installed it, so installing the hook runner does not silently turn the tracker's git integration off
  - unchanged, authored (authored/lefthook.yml); now adapt as the bullet says → `.beads/config.yaml`, `lefthook.yml`
- [x] **copy** — copy `scripts/check-beads.mjs` → `<checks-dir>/` and adapt its label vocabulary: every open issue carries a label naming where its work lands; its second rule, that an id from a predecessor tracker resolves only in a frozen export committed here, applies only when you have a predecessor and goes otherwise
  - unchanged → `scripts/check-beads.mjs`
- [x] **adapt** — adapt `.beads/formulas/corpus-regen.formula.toml` only when you have a multi-step cycle worth templating: replace its steps and keep its header's two rules (cite headings, never line numbers; cite count keys, never numerals); a formula declares variables and dependent steps, and the instance is thrown away once the cycle's commits and closed issues are the record
  - authored (authored/corpus-regen.formula.toml), unchanged; now adapt as the bullet says → `.beads/formulas/corpus-regen.formula.toml`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 1.3`):

  ```bash
  bd dolt pull
  bd ready
  bd dolt push
  ```

  Adapt: Any tracker with a CLI and a syncable store fits; the bracket, the labels and the rule that status lives in the tracker are the value. The label names are yours.

  Skip when: A solo repository with no agent sessions. As soon as two sessions can run, adopt it.

## C. Hooks and gates

### Step 9 · § 1.6 The gate ladder: where a check runs, and why (Full)

- [x] **write** — write the ladder into `CLAUDE.md`: the same checks at four latencies — in-session hooks (milliseconds; may be unsound; never block), pre-commit (seconds; sequential; over staged files), pre-push (tens of seconds; parallel; scoped by glob), and `<ci>` (every gate, binding on every pull request and on every push to `<trunk>`) — and a slower tier never trusts a faster one
  - unchanged → `CLAUDE.md`
- [x] **write** — write the placement rule into `CLAUDE.md`: a check that reads only committed files is a pre-push job **and** a `<ci>` step; a check that reads something outside the repository (another checkout, a token, a network, a language model) runs in neither, and a digest gate stands in for it (a check that re-hashes the input's last accepted bytes and fails on drift; the last bullet is one); a legitimately absent input skips clean and prints why; a tool that is found and then fails is a failure, never a skip
  - unchanged → `CLAUDE.md`
- [x] **install** — install `<hook-runner>` and adapt `lefthook.yml`: pre-commit `parallel: false` with the reason; pre-push `parallel: true`; every pre-push job with a `glob` re-derived from what its script reads and imports (wider when in doubt), launched as `node --run <name>`, with a comment stating its measured cost and the host it was measured on, re-measured on yours because the copied notes are this host's; deliberately absent gates named at the site with the reason; retired jobs left as a comment carrying the rule text worth keeping and the shape the job would take if it came back
  - authored (authored/lefthook.yml), unchanged → `lefthook.yml`, `package-lock.json`
- [x] **write** — write `<gates-command>` as the hook runner's forced full suite (`lefthook run pre-push --force` here), and use only that by hand: the bare runner skips every job when the push file list is empty and exits 0 in a tenth of a second, which reads exactly like a clean run
  - unchanged → `package.json`, `package-lock.json`, `CLAUDE.md`
- [x] **adapt** — adapt `.github/workflows/verify.yml` into `<ci>`: cheapest first, a concurrency group that cancels superseded runs, minimal permissions, a timeout, and retired steps kept as comments saying why a restored step would be wrong
  - authored (authored/ci-verify.yml), unchanged; now adapt as the bullet says → `.github/workflows/verify.yml`
- [x] **write** — write, when the repository imports a tree it does not produce, for every such tree under `<imports-dir>/`, a `README.md` recording the pin and a `MANIFEST.sha256` recording digest and byte count per file; copy `scripts/check-reference-mirrors.mjs` → `<checks-dir>/` to re-hash both directions; carve the tree out of the formatter and out of end-of-line conversion
  - unchanged → `scripts/check-reference-mirrors.mjs`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 1.6`):

  ```bash
  npm run gates
  ```

  Adapt: `<hook-runner>`, `<ci>` and `<package-runner>` are parameters; the four tiers, the placement rule and the forced-suite rule are not. Cost notes name the host they were measured on, because the same job costs several times more behind endpoint security on native Windows.

  Skip when: Never. A repository with one test has a ladder of one rung, and the placement rule still decides where it runs.

### Step 10 · § 1.7 Gates on the gates: every script wired or declared, every gate negative-tested (Full)

- [x] **copy** — copy `scripts/check-jobs.mjs` → `<checks-dir>/` and adapt its file names: every `run:` token in the hook runner's configuration and in `<ci>` resolves to a script in the package manifest; every script no job invokes is declared in the file's exception table with its kind and reason, and a gate-shaped name (`check:*`, `*:check`, `*:selftest`) is told to wire itself or name its exception; a declared exception that has since gained a job, or names a script that no longer exists, fails too; a script naming a path that is not on disk fails
  - unchanged → `scripts/check-jobs.mjs`
- [x] **write** — write a `--selftest` mode into every gate, a standing rule from the first gate: copy the gate's inputs under the temporary directory, break exactly one thing per case, assert the run fails **for that reason**, and keep one undoctored control case that must pass; expose it as `<name>:selftest` and run it as its own pre-push job
  - unchanged → `CLAUDE.md`
- [x] **write** — write a root override (an environment variable naming a doctored copy) into each gate, so a by-hand run can point it at a fixture without editing it
  - unchanged → `CLAUDE.md`
- [x] **adapt** — adapt every guard's selftest to assert the **reason** a refusal reports, not the refusal alone
  - unchanged; now adapt as the bullet says → `CLAUDE.md`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 1.7`):

  ```bash
  npm run check:jobs
  npm run check:jobs:selftest
  ```

  Adapt: The exception table is data: reversing an ungated decision means adding the job and deleting the entry in the same change, or the gate fails.

  Skip when: Fewer than three gates. The selftest rule applies from the first gate that can refuse something.

### Step 11 · § 1.5 The script suffix contract, and generated output never hand-edited (Full)

- [x] **write** — write the contract into `CLAUDE.md` or a skill: a script named `<group>:<verb>` in the package manifest is a public name; the bare name writes the artifact; `:check` re-derives it in memory, diffs against what is committed, exits 1 on any difference or on a stale file a fresh run would not write, and writes nothing; `:selftest` asserts invariants from fixtures it builds under the temporary directory; `:update` moves a baseline
  - unchanged → `CLAUDE.md`
- [x] **write** — write, beside the contract, the emitter rules, standing from the first emitter: no timestamp, no randomness, one canonical serialiser, every sort by code point so two runtimes agree, the `:check` twin in the same change; an emitted tree lives under `<generated-root>/` with a banner naming the emitter and is never edited by hand; a correction goes into the hand-maintained source (3.2 in part 3) and the next run carries it
  - unchanged → `CLAUDE.md`
- [ ] **adapt** — adapt the refusal in `tools/catalogue/index.mjs` for any emitter that walks a graph: compare the walk with a hand-ratified fixture (a decision record, 3.2) and refuse to write on disagreement, because a wrong walk returns a smaller answer and says nothing
  - read authored/reference/emitter-shape.mjs in the kit (the source's own file was excluded as mostly its subject)
- [x] **copy** — copy `scripts/assert-not-hand-edited.mjs` → `<checks-dir>/` as a `<hook-runner>` pre-commit job over staged paths only, and adapt its table: one verifier per generator, chosen by path; a suspect nothing can verify is reported as unverified
  - overwritten → `scripts/assert-not-hand-edited.mjs`
- [x] **copy** — copy `scripts/hooks/block-generated-edit.mjs` → `<hooks-dir>/` as a `PreToolUse` hook on Write and Edit, and adapt its redirect table: the refusal names where the change belongs
  - unchanged → `scripts/hooks/block-generated-edit.mjs`
- [x] **copy** — copy `scripts/hooks/check-emitted-drift.mjs` → `<hooks-dir>/` as a `PostToolUse` hook, and adapt its trigger table to your emitters' inputs and the emitters themselves: it re-runs the `:check` only for those, and never blocks
  - unchanged → `scripts/hooks/check-emitted-drift.mjs`
- [x] **copy** — copy `.claude/skills/add-npm-script/SKILL.md` into your `.claude/skills/` and adapt the README section it names: the seven steps of adding, renaming or removing a script
  - unchanged → `.claude/skills/add-npm-script/SKILL.md`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 1.5`):

  ```bash
  npm run <emitter>
  npm run <emitter>:check
  ```

  Adapt: `<package-runner>` decides the spelling of the suffixes, not the contract. The drift hook's trigger table is your emitters' inputs, and the emitter itself belongs in it.

  Skip when: Nothing in the repository is generated. The moment one file is, adopt all of it.

### Step 12 · § 3.2 Hand-maintained source, decision records read and never written, and the policy file prompts cite (Full)

- [x] **write** — write the split into `CLAUDE.md`: three kinds of file and never a fourth — hand-maintained source that a person edits; hand-authored decision records (JSON) that emitters read and nothing writes; and generated output under `<generated-root>/` that nothing edits by hand (1.5 in part 1)
  - unchanged → `CLAUDE.md`
- [x] **write** — write every decision record self-describing, with keys that answer the questions a reader asks before the data: `describes`, `whyThisFileExists`, `gatedBy`, `whatItDoesNOTDo`, `provenance`, and for each constant a `<key>Means` sibling stating what the value decides and where it is changed
  - unchanged → `CLAUDE.md`
- [x] **write** — write `<policy-file>` for every workflow: every constant a tool or a prompt reads lives there under a key, with its reason, its source evidence and the date it was decided beside it; a prompt cites the block and the key and states no second number
  - overwritten → `dry-run/workflow-policy.json`
- [x] **write** — write the placement rule, once a workflow exists (part 2), where its README explains its layers: a rule about how a run proceeds goes in the contract; a rule about what the written code looks like goes in the implementation skill; a constant a tool reads goes in `<policy-file>`, never inline; a fact owned by another team goes to that team
  - overwritten → `dry-run/README.md`

  Adapt: The key names are a convention; the contract (every constant has one home and a stated meaning) is the value. A workflow without tools has no policy file yet; write it the day the first tool reads a constant.

  Skip when: No emitter reads a hand-authored input. Keep the three-kinds rule anyway.

### Step 13 · § 1.4 Committed harness-hook configuration and a hook micro-runtime (Full)

- [x] **write** — write `.claude/settings.json` with two things in it and nothing else: the enabled plugins (here the tracker's) and the hook registrations, each with a `statusMessage` and an explicit `timeout` sized to the hook; write into `.claude/README.md` that machine-specific permissions go in `.claude/settings.local.json`, which is untracked
  - unchanged → `.claude/settings.json`, `.claude/README.md`
- [x] **copy** — copy `scripts/hooks/_shared.mjs` → `<hooks-dir>/`: a stdin reader that returns null on a TTY, empty or unparseable input, so every hook can be run by hand; an edit-target reader that accepts both payload spellings; a repository-relative path helper that returns null outside the repository; a bounded header read; a spawn helper with a timeout
  - overwritten → `scripts/hooks/_shared.mjs`
- [x] **copy** — copy `scripts/hooks/gate-summary.mjs` → `<hooks-dir>/` as your `Stop` hook once 1.6 has given you gates, and adapt its gate list to the three fastest: it runs them concurrently, prints one verdict line into the transcript, and never blocks
  - unchanged → `scripts/hooks/gate-summary.mjs`
- [x] **write** — write into `.claude/README.md` that hook configuration is snapshotted at session start, so a session that began before a hook was added never sees it
  - unchanged → `.claude/README.md`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 1.4`):

  ```bash
  node scripts/hooks/gate-summary.mjs < /dev/null
  ```

  Adapt: The gate list in the Stop hook is the three fastest gates you have. Note in its header which of them is unsound (a cached lint is) and that nowhere else may use that spelling.

  Skip when: No agent runs in the repository. The settings split still applies to a human team.

### Step 14 · § 1.8 The citations gate (Full)

- [x] **copy** — copy `tools/citations/` → `<emitters-dir>/citations/` (TypeScript, run directly by Node; a multi-file check lives with the emitters, a single-file one under `<checks-dir>`) and adapt its exemption registries: every pointer of the forms `<file>.md:NN` and `<file>.md § <Name>` in every tracked text file must resolve — the file exists, the line is in range and not blank, the section exists, and a pointer into a retired file fails until it names the new path
  - unchanged → `tools/citations/check.ts`, `tools/citations/memory.ts`, `tools/citations/scan.ts`, `tools/citations/selftest.ts`
- [x] **write** — write the strip step this gate forces on day one: every file copied from this repository carries header citations to sections, reviews, tracker ids and commits you do not have, and every copied prompt ends in a `Reviewed:` trailer naming reviews of runs here; replace each with your own or drop it before the gate's first run
  - unchanged → `CLAUDE.md`
- [x] **write** — write it as a pre-push job with no glob and a `<ci>` step, scanning every tracked text file rather than an allowlist; take exemptions one at a time, each a line in a diff with a reason: quotations of what a stale claim said, frozen history directories, the retired root
  - unchanged → `lefthook.yml`, `.github/workflows/verify.yml`
- [x] **write** — write into `CLAUDE.md` that a section pointer is preferred over a line pointer, because a line pointer rots on every edit above it, and that a proposed widening of the gate is measured before it is adopted and, if refused, recorded as a decision
  - unchanged → `CLAUDE.md`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 1.8`):

  ```bash
  npm run citations:check
  ```

  Adapt: The two pointer forms are the whole contract; the exemption lists are yours. If your documents cite by heading only, the line half never fires and costs nothing.

  Skip when: No document cites another. That lasts about a week.

### Step 15 · § 1.11 Warning ratchet (Brief)

- [x] **take** — Take `scripts/lint-ratchet.mjs` → `<checks-dir>/` with its `lint:ratchet` and `lint:ratchet:update` pair and a committed baseline file: warning counts in the pre-existing code may fall and never rise, and errors are never tolerated at any count.
  - unchanged; now adapt as the bullet says → `scripts/lint-ratchet.mjs`

## D. Knowledge

### Step 16 · § 4.3 The count index, Verification Before Claiming, and reporting honesty (Full)

- [x] **write** — write `<count-index>`: a table of key, value and what it counts, for every figure that describes the current measured state of the thing you measure; a second table naming the command or file each value re-derives from; and a *How to use it* section carrying the rules below
  - unchanged → `count-index.md`
- [x] **write** — write the rules into that file and into `CLAUDE.md`: prose writes the backticked key where the numeral would go, never both; a key is admitted only for a count that moves when the source is re-measured **and** is restated in more than one hand-maintained file; a quotation keeps its numeral; a frozen or historical figure gets no key; a string an emitter writes interpolates what it measured at emit time or carries no figure; name the denominator when two exist
  - unchanged → `count-index.md`, `CLAUDE.md`
- [x] **adapt** — adapt `scripts/check-count-index.mjs` → `<checks-dir>/`: a check that re-derives every value from its source and fails when the table disagrees, with one deriver per key; update the table from what the check reports, never the check from the table
  - authored (authored/check-count-index.mjs), unchanged; now adapt as the bullet says → `scripts/check-count-index.mjs`, `package.json`, `package-lock.json`, `lefthook.yml`, `.github/workflows/verify.yml`
- [x] **write** — write into `CLAUDE.md` the rule behind it all: never state a count, a figure or a "resolved" status from titles, memory or inference; re-derive it at the time of writing and cite the source inline, or say it could not be verified
  - unchanged → `CLAUDE.md`
- [x] **write** — write, for any rate a report computes, a declared sample size below which the report prints the count and no rate; define every metric once, in one hand-maintained file or one generated from a hand-maintained source, as what is counted, who counts it, where it is recorded, and the value that would mean the project is not viable
  - unchanged → `count-index.md`, `CLAUDE.md`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 4.3`):

  ```bash
  npm run counts:check
  ```

  Adapt: `<count-key-prefix>` is any prefix that greps cleanly. The check's derivers are yours to write, one per key, in the same change as the key, or the gate reports the key as unbacked.

  Skip when: Nothing you measure is restated anywhere. The verification rule in `CLAUDE.md` is never skipped.

### Step 17 · § 3.6 The graph as authority (Optional)

Adopt when: more than two generated artifacts feed each other, so that "regenerate in the right order" is a question somebody has to answer.

- [x] **write** — write one machine-readable record per node in `<emitters-dir>/pipeline/graph.ts` (a name and a language that are defaults): id, kind (its lifecycle), the edges it depends on, named input groups, outputs, the generator and its check, and a detection field that names how staleness is detected or declares none with a reason the gate prints
  - unchanged → `tools/pipeline/graph.ts`
- [x] **write** — write the edges declared, not derived: a derived edge is silent about a node whose artifacts do not exist yet, and the point of the record is that it can be wrong in a way a check can catch
  - unchanged → `tools/pipeline/graph.ts`
- [x] **write** — write the prose page that describes the graph for a reader, a diagram block and a paragraph per node; the check below holds it to the record
  - unchanged → `docs/pipeline.md`
- [x] **copy** — copy `tools/pipeline/check.ts` and `tools/pipeline/stale.ts` beside it and adapt: the check asserts no cycle, no unknown edge, every input glob matches at least one file, every stamped path is one of the node's outputs, every script named exists, and every node id appears in the prose that describes the graph; the staleness gate re-folds each node's declared inputs into a digest and compares it with the stamp the node wrote into its own output, so forgetting to regenerate is visible without regenerating
  - unchanged → `tools/pipeline/check.ts`, `tools/pipeline/stale.ts`, `package.json`, `package-lock.json`, `lefthook.yml`, `.github/workflows/verify.yml`, `tools/pipeline/formulas.ts`, `tools/pipeline/selftest.ts`, `tools/lib/estate-root.ts`, `tools/pipeline/example/emit.ts`, `tools/pipeline/example/entries.json`, `tools/pipeline/example/summary.json`
- [x] **write** — write into the record's header that the prose copy is held to the record by a gate that is a floor: it catches a node added on one side and forgotten on the other and cannot catch a wrong edge, and the fix is to generate the prose from the record
  - unchanged → `tools/pipeline/graph.ts`
- [x] **write** — write the retirement rule: a node kind whose defining property is that nothing depends on it describes a tool, not a node; retire the kind with its last member, narrow the type, delete the assertion, and leave a do-not-re-add note
  - unchanged → `tools/pipeline/graph.ts`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 3.6`):

  ```bash
  npm run pipeline:check
  npm run pipeline:stale:check
  ```

  Adapt: The kinds are your lifecycles: here, one that re-runs whole whenever its source moves and one that is built once and grows on demand; two is the right number until a third proves itself. The staleness stamp needs every emitter to write its input digest into its output.

## E. Parallel agent work

### Step 18 · § 1.9 One way to make a worktree, the guard that holds it, and collecting what it leaves (Full)

- [x] **copy** — copy `scripts/new-worktree.sh` → `<checks-dir>/` and adapt `<trunk>` and `<agent-branch-prefix>`: it cuts `<agent-branch-prefix><name>` from `origin/<trunk>` at `.claude/worktrees/<name>`, the harness's own location; derives the primary checkout from `--git-common-dir`, never `--show-toplevel`; undoes `worktree add` on any later failure; warns and continues when the fetch fails; and prints that `npm ci` is the first command inside
  - unchanged → `scripts/new-worktree.sh`
- [x] **copy** — copy `scripts/hooks/worktree-create.mjs` and `scripts/hooks/worktree-remove.mjs` → `<hooks-dir>/` and register them as the `WorktreeCreate` and `WorktreeRemove` hooks, so the harness's worktree tool provisions through the one script and never natively
  - unchanged → `scripts/hooks/worktree-create.mjs`, `scripts/hooks/worktree-remove.mjs`
- [x] **copy** — copy `scripts/render-worktree-context.mjs` → `<checks-dir>/` and `.claude/worktree-CONTEXT.md.tmpl` → `.claude/`, and adapt the briefing: branch, base, task, merge window; "you are not alone in this repository"; `npm ci` first; how to finish. It renders to `.worktree/CONTEXT.md` inside the worktree, which `CLAUDE.md` imports with an `@.worktree/CONTEXT.md` line that is harmless where the file is absent; the renderer is Node because `sed` and `date -d` each failed
  - unchanged → `scripts/render-worktree-context.mjs`, `.claude/worktree-CONTEXT.md.tmpl`
- [x] **write** — write `.claude/worktrees/` into `.gitignore` with a comment saying the rule is load-bearing
  - unchanged → `.gitignore`
- [x] **copy** — copy `scripts/hooks/guard-git.mjs` → `<hooks-dir>/` as a `PreToolUse` hook on Bash and adapt its one constants block: it tokenises the command rather than pattern-matching it; refuses pushes, checkouts, branch writes and merges against `<protected-branches>` from a linked worktree; refuses `git worktree`, `gc` and `prune` there; fails closed when it cannot read its input; and is a no-op in the primary checkout
  - unchanged → `scripts/hooks/guard-git.mjs`
- [x] **copy** — copy `scripts/prune-worktree-branches.mjs` → `<checks-dir>/` as the sweep the remove hook runs and as `npm run worktree:gc`: teardown removes the checkout and never the branch; the sweep deletes a branch only on proof its content is in `<trunk>` (an ancestor, or every patch-id upstream, so a squash-merged branch is kept); removes an abandoned checkout only when seven conditions all hold, and reports the one that failed; logs every deletion with its restore command; and refuses to run for a path outside `.claude/worktrees/`
  - unchanged → `scripts/prune-worktree-branches.mjs`
- [x] **copy** — copy `scripts/hooks/worktree-hooks.selftest.mjs` and run it as a pre-push job
  - unchanged → `scripts/hooks/worktree-hooks.selftest.mjs`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 1.9`):

  ```bash
  npm run worktree:selftest
  npm run worktree:gc -- --dry-run
  ```

  Adapt: `<trunk>` and `<protected-branches>` are one constants block, which is what made the trunk rename cheap here. If your default branch is not your trunk, keep the guard's repository-wide rule that a pull request names its base explicitly. Delete the port probing unless something in your repository listens.

  Skip when: One agent at a time and no parallel sessions. The gitignore rule and the guard cost nothing to keep anyway.

### Step 19 · § 1.10 The skills and agents (Full)

- [x] **adapt** — adapt `.claude/skills/bead/SKILL.md`: drop the bullets that name a language toolchain, sibling checkouts or this repository's gates, and keep the spine — verify the premise before any work, with file and line citations, deciding whether the issue is still valid, already fixed or obsolete, and behaving differently with a live user (show and stop) and in an autonomous session (note it and leave the issue open); partition several issues before claiming; then claim, implement, regenerate, gate, rebase and gate again, open the pull request, poll its checks in the background, close on green with a reason naming the pull request, and report
  - authored (authored/skill-bead.md), unchanged; now adapt as the bullet says → `.claude/skills/bead/SKILL.md`
- [x] **copy** — copy `.claude/skills/explore/SKILL.md`: list every assumption and every fact to look up, with a current guess for each, and stop; then an evidence-only inventory, file paths and quotations, no recommendations
  - unchanged → `.claude/skills/explore/SKILL.md`
- [x] **copy** — copy `.claude/skills/retire-asset/SKILL.md` (three lines: a retired asset says why, a live asset references it only if it must and marks the reference, and it moves to the retired directory) and `.claude/skills/human-plan/SKILL.md` (one line: draft what a person must do to drive an issue that needs a human); adapt the directory in the first to `<retired-dir>`
  - unchanged → `.claude/skills/retire-asset/SKILL.md`, `.claude/skills/human-plan/SKILL.md`
- [x] **copy** — copy `.claude/agents/continuous-prompt-improvement.md`: nine lines that turn a session's self-analysis into a recommendation for the prompt it ran
  - unchanged → `.claude/agents/continuous-prompt-improvement.md`
- [x] **adapt** — adapt `.claude/agents/fan-out-work.md`: replace the files its examples name, and keep the steps — pre-flight the trunk with the full gate suite; partition ready work into lanes by three overlap kinds (two issues rewriting the same lines take one lane; two adding separate blocks to one file are siblings with named anchors; two regenerating the same generated file are accepted and regenerated after each merge); pre-claim every issue in one tracker bracket; one fresh agent per lane in its own worktree; integrate on the dispatcher's own branch by merging lanes forward, never rebasing a pushed branch; poll the checks; report one table
  - authored (authored/agent-fan-out-work.md), unchanged; now adapt as the bullet says → `.claude/agents/fan-out-work.md`
- [x] **write** — write, into that agent's brief for each lane, the three rules every lane states: never end a turn while a command runs; label every issue the lane creates at creation; an acceptance criterion that acts outside the repository becomes a follow-up issue labelled `human` (a default label name) and is never performed by the lane
  - unchanged → `.claude/agents/fan-out-work.md`
- [x] **write** — write, at the end of every substantial prompt once its first review exists, a `Reviewed:` line citing the review file (3.5 in part 3); until then none, and strip the trailers the copied prompts carry
  - unchanged → `CLAUDE.md`

  Adapt: About half of the `bead` skill's nested bullets name this repository's stack and go. The fan-out agent's partition examples name files here; the three overlap kinds do not.

  Skip when: No autonomous sessions. `explore` and `retire-asset` are worth having on day one regardless.

### Step 19 · § 3.5 Prompt reviews (Full)

- [x] **write** — write into `CLAUDE.md`: after a prompt is executed from a file, an analysis of the run goes to the `continuous-prompt-improvement` agent (1.10 in part 1), and a retained review lands at `<prompt-reviews-dir>/<prompt-basename>.<run-date>.md`, never beside the prompt
  - unchanged → `CLAUDE.md`
- [x] **write** — write the review's shape: the prompt and the run reviewed, with verifiable identifiers; what the earlier reviews' changes did in this run; what the run cost that the prompt did not prevent, as numbered findings each with its fix; corrections to the run's own analysis; *Deliberately not changed*; *What this review could not verify*
  - unchanged → `docs/prompt-reviews/README.md`
- [x] **write** — write the append rule: a second review of the same prompt is appended to its file under a dated heading, so the prompt keeps one live citation; write a `Reviewed:` trailer at the end of the prompt naming the file and the runs behind it, and keep that citation live
  - unchanged → `docs/prompt-reviews/README.md`
- [x] **write** — write that a review is not obsolete once applied: it is the evidence for why the prompt says what it says; delete it only with the prompt it reviews
  - unchanged → `docs/prompt-reviews/README.md`

  Adapt: The section names are a default; the two closing sections are the value. The improvement agent is nine lines and needs no adaptation.

  Skip when: No prompt runs more than once. A prompt that runs twice deserves a review.

## F. The supervised workflow

### Step 20 · § 2.1 Context budget: a page of invariants, references by name, facts by path (Full)

- [x] **write** — write the workflow's contract as one page and a set of references: the page holds only the invariants every worker obeys on every step, and ends with a table of its reference files, each row naming who opens it and when; procedure lives in the references, and a worker opens one only when its step points there
  - unchanged, overwritten → `.claude/skills/dry-run-contract/SKILL.md`, `.claude/skills/dry-run-contract/references/lifecycle.md`
- [x] **write** — write each agent's frontmatter to declare exactly the skills its body uses, and write a test that holds the declaration to the body (2.3)
  - overwritten, unchanged → `.claude/agents/dry-run-worker.md`, `dry-run/tests/agent-skills.test.mjs`
- [x] **adapt** — adapt `migration/skills/migration-contract/tools/Write-HostFacts.ps1` and `migration/skills/migration-contract/tools/Test-HostFacts.ps1`: the launcher writes the environment facts a run measures into one file under `<run-dir>`, once, and the validator refuses one that carries a secret value; pass the file's path in every dispatch and never restate its contents; a worker reads the file, never asks for the facts, never writes it, and treats a fact it lacks as absent rather than guessed
  - overwritten, unchanged; now adapt as the bullet says → `dry-run/tools/Write-HostFacts.ps1`, `dry-run/tools/Test-HostFacts.ps1`, `.gitignore`, `dry-run/host-facts.schema.json`, `dry-run/tests/host-facts.test.mjs`
- [x] **write** — write generated context (a reference tree your own emitter publishes) and externally owned context (a skill another team maintains) into `<workflow-dir>` by a sync step before every launch, into gitignored directories, copying contents rather than the folder so the skill is not nested and hidden; every lookup reads the committed tree, never the copy; the external skill is never forked
  - overwritten, unchanged → `dry-run/README.md`, `.claude/skills/dry-run-contract/SKILL.md`

  Adapt: The page-and-references split is the value; the reference file names are yours. If no context is generated or externally owned, the sync step is a no-op you do not write.

  Skip when: One agent, one skill. Adopt it the day a second agent preloads the same document.

### Step 21 · § 2.3 Tests over the prompts themselves (Full)

- [x] **write** — write a runner beside the workflow's tests that discovers every validator file, runs each in its own process with a per-test timeout, several at a time, prints pass, fail or skip by name in file order, echoes each test's own summary lines, prints a failing test's full output, never retries, and exits 1 on any failure **or when it finds nothing**
  - unchanged → `package.json`, `package-lock.json`, `dry-run/tests/run-tests.mjs`
- [x] **write** — write validators over the prompts' structure, not the model's output: frontmatter shape; required sections in order; required sentences, by pattern; every tool a step names exists; every policy key holds its value and every retired key is absent; when 2.4 applies, the entry skill is under its line cap and carries no phase heading; generated copies are byte-identical to their source; every script and JSON file parses; where you have such a rule, no file under `<workflow-dir>` names a thing it must not (a retired platform, a repository it must never touch)
  - unchanged, overwritten → `dry-run/tests/lib/prompts.mjs`, `dry-run/tests/frontmatter.test.mjs`, `dry-run/tests/sections.test.mjs`, `dry-run/tests/sentences.test.mjs`, `dry-run/tests/named-tools.test.mjs`, `dry-run/tests/policy.test.mjs`, `dry-run/tests/entry-skill.test.mjs`, `dry-run/tests/agent-skills.test.mjs`, `dry-run/tests/parses.test.mjs`, `dry-run/tests/refusals.test.mjs`
- [x] **write** — write the skip rule: a validator skips by name, printing `SKIP:`, only for an optional dependency that is absent; a found dependency that fails is a failure
  - unchanged, overwritten → `dry-run/tests/lib/prompts.mjs`, `dry-run/tests/parses.test.mjs`, `dry-run/tests/host-facts.test.mjs`
- [x] **write** — write it as a `<ci>` step, and decide by measurement whether it is also a pre-push job
  - unchanged → `lefthook.yml`, `.github/workflows/verify.yml`

  Verify (`node <kit>/tools/verify.mjs --target . --sections 2.3`):

  ```bash
  npm run dry-run:test
  ```

  Adapt: The validators' language is whatever your workflow's tools are written in; the runner's contract is the value. Start with three validators: frontmatter, required sections, every named tool exists.

  Skip when: One prompt that one person edits. Two prompts that cite each other need the third validator already.

### Step 22 · § 3.3 One record per work item, on every terminal path (Full)

- [x] **write** — write, for any workflow that runs per work item, one record per item under `<records-dir>/`, written on every terminal path — complete, failed and blocked alike — never only on success, and written after the last push so it names a commit that exists
  - unchanged → `dry-run/run-outcome.schema.json`, `tools/outcomes/write-record.ts`
- [x] **write** — write `<record-schema>` once and have the writer and every reader share it, with a version field the reader refuses when it does not know it, so a schema change is a version bump and never a silent edit; the record type is yours to choose, and a framework that already defines a per-change record (OpenSpec is one) can supply it, provided these invariants hold
  - unchanged → `dry-run/run-outcome.schema.json`, `tools/outcomes/paths.ts`, `tools/outcomes/record.ts`
- [x] **write** — write the writer to validate before it writes and to refuse an invalid record with one named reason; write a validator for the cross-field rules a schema cannot state (which fields are set for which terminal status; which pairs are null together)
  - unchanged → `tools/outcomes/record.ts`, `tools/outcomes/write-record.ts`, `tools/outcomes/record.selftest.ts`
- [x] **write** — write corrections as additions: a fact a later stage found wrong is superseded or retracted by a new entry, never deleted, so the record keeps both for the audit
  - unchanged → `dry-run/run-outcome.schema.json`, `tools/outcomes/record.ts`, `tools/outcomes/write-record.ts`
- [x] **write** — write one committed fixture per terminal path, beside the workflow's tests, and hold the validator to them
  - unchanged → `dry-run/tests/fixtures/run-outcome/complete.json`, `dry-run/tests/fixtures/run-outcome/failed.json`, `dry-run/tests/fixtures/run-outcome/blocked.json`, `tools/outcomes/selftest-lib.ts`, `tools/outcomes/record.selftest.ts`
- [x] **write** — write into the record the two fields that make the loop in 3.4 possible, each an enum you define: the **stage** of your workflow that produced each correction (research, build, review, the environment, the reference it read), and the **asset** that would absorb it so the next run does not meet it (a reference page, a policy constant, a test oracle, a convention pin, or none)
  - unchanged → `dry-run/run-outcome.schema.json`

  Adapt: Everything about the record's content is yours: its fields, its evidence forms, its status vocabulary. What this repository adds beyond the invariants — an evidence-token grammar, a check that every cited source line exists at the record's own base commit, a writer that deletes a file that fails re-validation — is worth reading and not required.

  Skip when: No workflow runs per work item. The moment one does, write the record before the reports that read it.

### Step 23 · § 2.2 When the run talks to the human: one approval, an exhaustive list of reasons to stop, an order of authority (Full)

- [x] **write** — write the entry skill's intake as read-only (the entry skill is whatever a human invokes to start a run: the one skill under `.claude/skills/` that does, or 2.4's when the workflow is a plugin): it reads the work item and every comment, resolves the subject, inspects branch state, and changes nothing
  - overwritten → `.claude/skills/dry-run-contract/references/lifecycle.md`, `.claude/skills/dry-run/SKILL.md`
- [x] **write** — write one mutation-scope approval: the run names every mutation it will make (the branches, local edits and builds, checkpoint pushes, the record it writes, the pull requests) and asks once; that approval covers those operations, and the run asks again only at an intervention boundary or for something outside the list; declined, it stops with its read-only findings and the restart command
  - overwritten → `.claude/skills/dry-run-contract/references/lifecycle.md`
- [x] **write** — write the intervention reason codes into `<policy-file>` as an exhaustive list, flag it exhaustive, and make the same list the enum of the record's intervention field, so a blocked run cannot record an unlisted reason (the record is 3.3 in part 3; write the list first, and tie it to the record's schema when the record exists); write, beside each code, its firing preconditions and what an answer does (resume, and how the answer is recorded)
  - overwritten, unchanged → `dry-run/workflow-policy.json`, `dry-run/tests/policy.test.mjs`
- [x] **write** — write the negative list into the contract: build errors, test failures, unfamiliar code and a missing capability with a truthful unavailable state are not reasons to ask; a run never asks merely whether it may continue
  - unchanged → `.claude/skills/dry-run-contract/SKILL.md`
- [x] **write** — write a source-authority ladder into the contract page: which input wins a conflict, in order, with the latest explicit human clarification on top; a conflict the inputs leave open goes to the human, never to a heuristic
  - unchanged → `.claude/skills/dry-run-contract/SKILL.md`

  Adapt: The codes are yours; the exhaustiveness flag, the schema tie-in, the negative list and the ladder are not. A declared, typed, tested degradation path for a missing dependency is what keeps the list short.

  Skip when: The workflow mutates nothing outside a sandbox. Even then, keep the ladder.

### Step 24 · § 2.5 Declare what a run needs, and what happens when it is missing (Brief)

- [ ] **take** — Take the shape of `migration/tools/Test-HostPrerequisites.ps1`: a read-only checker that emits one row per prerequisite with a status, a named code, a remedy and the README anchor whose last line verifies it; the launcher aggregates every failure into one stop naming all of them; a separate script installs; only a real end-to-end read proves authentication, made twice a few seconds apart to tell a policy refusal from a broken session; and a remedy that is an environment variable is applied to the launcher's own process so every child inherits it. Declare each external server the run uses as required or optional in the README, probe the required one with one cheap read as the first action and stop to ask for a reconnect if it fails, and record an optional one's absence and continue. Write every lookup tool to return a typed status (found, not found, source missing) rather than throw.
  - read authored/reference/Test-HostPrerequisites-shape.ps1 in the kit (the source's own file was excluded as mostly its subject)

### Step 24 · § 2.6 Idempotent external mutations with narrow retry (Brief)

- [ ] **take** — Take the rule from `migration/skills/migration-contract/tools/New-DraftPullRequest.ps1`: every write to an external system is preceded by a read (list the pull request and reuse it; list the links and add only what is absent; find the thread by a marker substring and reuse it); the result reports what was already done; retry happens only on an enumerated set of authentication failures, with backoff, and every other failure throws at once, because a request the service refused as wrong is not made right by repeating it. Choose a marker's encoding per transport: one transport strips HTML comments, so its marker is inline code.
  - read authored/reference/New-DraftPullRequest-shape.ps1 in the kit (the source's own file was excluded as mostly its subject)

### Step 25 · § 2.4 The workflow as a plugin directory, with one operator-only entry skill (Optional)

Adopt when: the workflow is packaged as a Claude Code plugin rather than as plain skills and agents under `.claude/`; a plugin is the right shape once the workflow runs inside another repository's session, or ships to more than one host.

- [ ] **write** — write `<workflow-dir>/.claude-plugin/plugin.json` with name, version, description and author, and nothing else; put every behaviour in the harness's conventional subdirectories `agents/`, `skills/` and `hooks/`, plus `tools/` and `tests/`, which are this repository's own convention; load it with `--plugin-dir <workflow-dir>`
  - write by hand
- [x] **write** — write the entry point as a skill, not a command, with `disable-model-invocation: true` in its frontmatter, so only a human can start a run
  - overwritten → `.claude/skills/dry-run/SKILL.md`
- [x] **write** — write the entry skill to hold only what the contract leaves to its host — a *Host Facts* table (trigger, input, secrets, approval, intervention channel, tool paths, final output) — and to execute the contract's lifecycle **by heading** from the reference file; cap the entry skill (120 lines here) and refuse any phase heading in it by a validator (2.3), so there is never a second copy of the lifecycle
  - overwritten, unchanged → `.claude/skills/dry-run/SKILL.md`, `dry-run/tests/entry-skill.test.mjs`

  Adapt: The host-facts rows are yours. Keep the line cap tight enough that the entry skill cannot grow a procedure.

### Step 26 · § 3.4 The learning loop: records, reports, proposals, promotion (Full)

- [x] **write** — write a script that reads every record under `<records-dir>/`, validates and normalises it, and derives pure reports from the records and nothing else: what recurs across runs (the same stage and asset pair from 3.3 on distinct items), where runs disagree (the same kind of decision made two ways), what runs could not decide, and what looks dead or blocked, plus a proposal list keyed on subject and fact
  - unchanged → `dry-run/run-outcome.schema.json`, `tools/outcomes/paths.ts`, `tools/outcomes/record.ts`, `dry-run/tests/fixtures/run-outcome/complete.json`, `dry-run/tests/fixtures/run-outcome/failed.json`, `dry-run/tests/fixtures/run-outcome/blocked.json`, `tools/outcomes/selftest-lib.ts`, `tools/outcomes/policy.json`, `tools/outcomes/policy.ts`, `tools/outcomes/reports.ts`, `tools/outcomes/emit.ts`, `tools/outcomes/index.ts`, `tools/outcomes/selftest.ts`, `artifacts/outcomes/dead-or-blocked.md`, `artifacts/outcomes/disagreements.md`, `artifacts/outcomes/proposals.json`, `artifacts/outcomes/proposals.md`, `artifacts/outcomes/recurring.md`, `artifacts/outcomes/undecided.md`
- [x] **write** — write the filing step: every proposal becomes an issue in `<task-store>` whose idempotency key is a label carrying a hash of subject and fact, never the title, so a promoted or rejected proposal is never re-filed under new wording; the body carries the proposal's siblings on the same subject, so contradictions are read together, and its evidence classed and, where it cites a source line, checked to exist at the source commit the record names, before a human reads it
  - unchanged → `tools/outcomes/propose.ts`
- [x] **write** — write the deduplication step: before filing, check whether the committed reference already names the proposal's subject; a strong match is printed, not filed; a weak match (the reference mentions the name in passing) or an absent one is filed with the disposition in the body; the list of generic words that count as a mention rather than a description is one list, held equal on the writer's side and the reader's by a selftest
  - unchanged → `tools/outcomes/policy.json`, `tools/outcomes/already-named.ts`, `tools/outcomes/propose.ts`, `tools/outcomes/selftest.ts`
- [x] **write** — write the promotion rule into `CLAUDE.md` and into the reference's own page: a program proposes; only a person promotes, by editing the hand-maintained source (3.2) and re-running the emitter; a proposal that does not hold is closed with its reason, and its key stays
  - unchanged → `CLAUDE.md`
- [ ] **write** — write the gate that closes the loop at the source: the plan a run writes lists every fact of the reference it relies on; the gate looks each up in the reference's index, and a fact found in neither the reference nor the plan's own proposals fails the plan, so discovery and proposal are one act
  - write by hand

  Verify (`node <kit>/tools/verify.mjs --target . --sections 3.4`):

  ```bash
  npm run outcomes
  npm run outcomes:propose -- --dry-run
  ```

  Adapt: The four report shapes are the general ones for any per-item workflow; their columns are yours. The reference the proposals target may be a skill, a document or a configuration file.

  Skip when: Fewer than two runs have happened. Write the record (3.3) first; the loop is cheap once the records exist.

### Step 27 · § 4.4 The two operator-facing documents (Brief)

- [ ] **take** — Take the shapes of `docs/playbook.md` and `docs/plain-language-guide.md`. The playbook is a route through one unit of work, dated, declared "a route, not an authority", where every step names the file or command that decides it, with a glossary of the words the reader will meet, a where-the-truth-lives table mapping questions to files, and a crib sheet of commands at the end. The plain-language guide is for a reader who runs nothing; it says up front that where it and a technical document disagree the technical document is right, and it still cites counts by key.
  - read authored/reference/playbook-shape.md in the kit (the source's own file was excluded as mostly its subject); read authored/reference/plain-language-guide-shape.md in the kit (the source's own file was excluded as mostly its subject)

