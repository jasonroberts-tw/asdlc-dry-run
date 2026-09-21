# The dry-run workflow

<!-- kit 2.1 · ADAPT: this is a working skeleton. Its SUBJECT is yours: what a work item is, what the
     change looks like, which phases sit between approval and record. What is laid down is the part
     that does not depend on the subject: the layers, the one approval, the exhaustive list of
     reasons to stop, the facts file, the policy file, and tests over the prompts themselves.
     Replace the text in <angle brackets> here and in each layer. Delete this comment when done. -->

One run takes one <work item> from a read-only intake, through one approval, to a record. A
person starts it with `/dry-run <item>`; a model cannot.

## Layers

Each layer has one job, and each is read at a different moment. What a layer costs is when it is
read: the contract page is paid for on every dispatch, a reference only by the step that opens it.

| Layer | Where | Read by, and when |
|---|---|---|
| Entry skill | `.claude/skills/dry-run/SKILL.md` | the session a person starts a run in, once. Holds only what the contract leaves to its host (the Host Facts table) and executes the lifecycle by heading |
| Contract page | `.claude/skills/dry-run-contract/SKILL.md` | every worker, preloaded, on every dispatch. One page: the invariants that hold on EVERY step, ending with the table of references |
| References | `.claude/skills/dry-run-contract/references/` | a worker whose step points there, and only then. Procedure lives here; `lifecycle.md` is the one copy of the phases |
| Agents | `.claude/agents/dry-run-*.md` | the harness, per dispatch. Each declares exactly the skills its body uses |
| Policy file | `dry-run/workflow-policy.json` | tools, by block and key; prompts cite the block and the key and state no second number |
| Tools | `dry-run/tools/` | run by a step that names one. Every tool a prompt names exists, and the tests hold that |
| Facts file | `.dry-run/run/<item>/host-facts.json` | written once per run by the launcher, validated, and read by every worker BY PATH. Never committed, never restated in a dispatch |
| Tests | `dry-run/tests/` | `npm run dry-run:test`: validators over the prompts' structure, not over a model's output |

## Where a rule goes

A rule has one home. Before writing one, decide which:

- a rule about **how a run proceeds** goes in the contract: on the contract page if it holds on
  every step, in a reference if it is one step's procedure;
- a rule about **what the written change looks like** goes in the implementation skill, the skill
  a worker follows while it writes. The kit lays none down, because it is all subject: write it as
  `.claude/skills/dry-run-<what it implements>/SKILL.md`, and declare it in the frontmatter
  of each agent whose body uses it;
- a **constant a tool or a prompt reads** goes in `dry-run/workflow-policy.json`, under a key, with its reason,
  its source evidence and the date it was set, and never inline;
- a **fact owned by another team** goes to that team. It reaches a run as synced context (below),
  and is never copied into a prompt here.

## External servers

<!-- kit 2.5-1 · WRITE: one row per external server a run uses. The lifecycle's intake reads this
     table: a REQUIRED server is probed with one cheap read as the first action, and the run stops
     to ask for a reconnect if it fails; an OPTIONAL server's absence is recorded and the run
     continues. Every lookup tool returns a typed status (found, not found, source missing)
     rather than throwing. -->

| Server | Required or optional | The one cheap read that proves it | When it is absent |
|---|---|---|---|
| <the work tracker> | REQUIRED | <read one work item> | the run stops and asks for a reconnect |
| <a server a run can do without> | OPTIONAL | <one read> | its absence is recorded, and the run continues |

## The facts file and its two tools

`dry-run/tools/Write-CeHostFacts.ps1` writes the run's environment facts into one file under
the run directory, once, and runs `dry-run/tools/Test-CeHostFacts.ps1` on what it wrote; the
validator holds the file to `dry-run/host-facts.schema.json`, to its own run directory, and
refuses one that carries a secret value. The file's name and the environment variable that can
name the run directory are in the policy file (block `hostFacts`).

<!-- kit 2.1-3 · ADAPT: both tools were taken from a workflow with a subject, and still measure its
     facts. They run as laid down (`dry-run/tests/host-facts.test.mjs` proves the pair against
     the schema), and these are yours to change, writer and schema in the same commit:
       * `-Story` is the work item's id, and is an integer; rename it and widen it if yours is not;
       * the fact blocks for a browser-test platform override, a directory-service ticket, a live
         gate and a test-id check describe the other workflow's host; replace each with a fact your
         runs measure, or delete it from the writer and from the schema;
       * the writer's header names sibling tools (a workspace initialiser, a prerequisite checker,
         a validation initialiser) that the kit does not lay down. Nothing calls them. The shape of
         the prerequisite checker is `authored/reference/Test-HostPrerequisites-shape.ps1` in the kit;
       * the names of the environment variables the validator treats as secret default inside the
         tools; give them a block of their own in the policy file when you know yours. -->

## Generated and externally owned context

A run may need context this directory does not own: a reference tree an emitter of this
repository publishes, or a skill another team maintains. Neither is committed here. A sync step
copies both into gitignored directories under `dry-run/` before every launch, copying each
source's CONTENTS rather than its folder, so that a skill lands where the harness finds it and is
not nested and hidden. Every lookup reads the committed tree, never the copy, and the other
team's skill is never forked: a correction goes to its owner.

The kit lays down no sync step, because a skeleton has nothing to sync, and then the step is a
no-op nobody should write. Write it, with its gitignore entries and a validator that holds each
copy byte-identical to its source, on the day the first such context exists.

## Tests

`npm run dry-run:test` runs `dry-run/tests/run-tests.mjs`, which discovers every
`*.test.mjs` beside it, runs each in its own process with a timeout, several at a time (policy
block `tests`), prints pass, fail or skip by name in file order, never retries, and exits 1 on any
failure or when it finds nothing. `npm run dry-run:test:selftest` proves the runner itself.

| Validator | What it holds |
|---|---|
| `frontmatter.test.mjs` | the frontmatter of every skill and agent: required keys, the name its path gives it, no unknown key |
| `sections.test.mjs` | required sections, in order; the contract page ends with its references; the lifecycle's phases |
| `sentences.test.mjs` | the sentences a tidy-up would trim: the first line, the negative list, the exhaustiveness flag, the ladder |
| `named-tools.test.mjs` | every tool, path and script a prompt names exists; every reference has a row, and every row a file |
| `policy.test.mjs` | the policy file's shape, pinned values and retired keys; every block-and-key citation resolves; no unlisted reason, no second number |
| `entry-skill.test.mjs` | the operator-only flag, the line cap, the Host Facts rows, and no phase heading outside the lifecycle |
| `agent-skills.test.mjs` | each agent declares exactly the skills its body uses |
| `parses.test.mjs` | every JSON file and script under `dry-run/` parses |
| `host-facts.test.mjs` | the facts writer, validator, schema and policy agree, and a secret-shaped value is refused |
| `refusals.test.mjs` | every validator above fails, for its own reason, on a copy with one thing broken |

**The skip rule.** A validator skips, by name, printing `SKIP:`, only for an OPTIONAL dependency
that is ABSENT; here that is PowerShell, for the two validators that need it. A dependency that is
found and then fails is a failure. The runner counts a `SKIP:` line followed by a failing exit as a
failure, and the one way to skip is `optionalDependency()` in `dry-run/tests/lib/prompts.mjs`.

**Where it runs.** It reads only committed files, so it is a `.github/workflows/verify.yml` step. Whether it is also a
pre-push job is decided by measurement, on the slowest host that pushes: the job's comment in
`lefthook.yml` carries the figure and names the host it was measured on. Re-measure on yours.

Two checks the list above does not carry, because the skeleton has nothing for them to read: that
generated copies are byte-identical to their source (above), and that no file here names a thing
it must not, such as a retired platform or a repository a run must never touch. Add each as a
validator on the day the rule exists.

## Becoming a plugin

The workflow is laid down as plain skills and agents under `.claude/`, which is the right shape
while it runs only in this repository's sessions. The day it must run inside another repository's
session, or ship to a second host, make `dry-run/` a plugin directory:

1. move `.claude/skills/dry-run/` and `.claude/skills/dry-run-contract/` to
   `dry-run/skills/`, and `.claude/agents/dry-run-*.md` to `dry-run/agents/`;
   hooks of its own go in `dry-run/hooks/`. `tools/` and `tests/` stay where they are;
2. write `dry-run/.claude-plugin/plugin.json` with `name`, `version`, `description` and
   `author`, and nothing else: every behaviour lives in those directories, not in the manifest;
3. repoint the paths in the contract page's References table, the entry skill and the agents, and
   run the tests: they read both layouts, and `named-tools.test.mjs` finds every path you missed;
4. load it with `--plugin-dir dry-run/`.

The entry skill already carries `disable-model-invocation: true`, which is the property that
matters most once the workflow can be loaded somewhere else: only a person starts a run.
