---
name: dry-run
description: Start one supervised dry-run run for one work item. Operator-only - a person starts a run, never a model.
argument-hint: <item>
disable-model-invocation: true
---

Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it.

<!-- kit 2.4-3 · ADAPT: this skill holds ONLY what the contract leaves to its host: the Host Facts
     table, and the instruction to execute the lifecycle by heading. It restates no phase.
     `dry-run/tests/entry-skill.test.mjs` caps its length (`dry-run/workflow-policy.json`, block `entrySkill`,
     key `maxLines`) and refuses a phase heading in it, so there is never a second copy of the
     lifecycle. Fill the rows in <angle brackets>. Delete this comment when done. -->

# Run dry-run

`disable-model-invocation: true` is load-bearing: a run mutates repositories, so it cannot be
started by a model deciding it would help.

## Host Facts

| Fact | On this host |
|---|---|
| Trigger | a person types `/dry-run <item>` in a session opened at the checkout root |
| Input | `<item>`: <the id of one work item, and where it is read from> |
| Secrets | <the NAMES of the environment variables a run needs; a value never appears in a prompt, a dispatch or the facts file> |
| Approval | asked once, in this session, by the lifecycle's approval phase; the answer is the person's next message |
| Intervention channel | <where a run asks and reads the answer: this session, or a thread on the work item> |
| Tool paths | `dry-run/tools/`; constants in `dry-run/workflow-policy.json`; the facts file under `.dry-run/run/<item>/` |
| Final output | <what the person is handed at the end: the pull request, the record's path, the restart command> |

## Run

1. **Write the facts, once.** This skill is the launcher: run
   `dry-run/tools/Write-CeHostFacts.ps1` for `<item>` with the checkout root as its target,
   and keep the path it reports. The run directory is ignored by git, and this file is the only
   thing written before the approval. Never restate the file's contents in a dispatch.
2. **Execute the lifecycle by heading.** Open
   `.claude/skills/dry-run-contract/references/lifecycle.md` and carry out its headings in
   the order it gives them, first to last, reading each when you reach it. The contract page
   (`.claude/skills/dry-run-contract/SKILL.md`) holds the invariants; obey them on every
   step.
3. **Dispatch by path.** A step a heading delegates goes to the `dry-run-worker` agent. The
   dispatch names the step's heading, `<item>`, and the facts file's PATH, and nothing the worker
   can read for itself.
4. **End with the final output.** Whatever path the run ends on, the person is handed the row
   *Final output* above; a declined approval hands over the read-only findings and the restart
   command instead.
