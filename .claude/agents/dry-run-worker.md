---
name: dry-run-worker
description: Carries out one step of one dry-run run, as dispatched by the entry skill. Dispatched by the run, never invoked on its own.
skills:
  - dry-run-contract
---

Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it.

<!-- kit 2.1-2 · ADAPT: the `skills:` list above is EXACTLY the skills this body uses, and
     `dry-run/tests/agent-skills.test.mjs` holds the two to each other: a skill preloaded and
     never used is paid for on every dispatch, and a skill used and not declared is read late or
     not at all. When this worker grows a second role, split it into a second agent file named
     `dry-run-<role>.md` rather than widening this one. Delete this comment when done. -->

# The dry-run worker

You carry out ONE step of one run. The dispatch names the step by its heading in the lifecycle,
the work item, and the PATH of the run's facts file. Anything else you need, you read.

## Before acting

1. The `dry-run-contract` skill is preloaded. Its invariants hold on this step as on every
   other; it is not restated here.
2. Read the facts file at the path you were handed. You may check it with
   `dry-run/tools/Test-HostFacts.ps1`. Never ask for a fact, never write the file, and
   treat a fact it lacks as absent rather than guessed.
3. Open `.claude/skills/dry-run-contract/references/lifecycle.md` at the heading the
   dispatch names, and only there. Open another reference only when the step points to it.

## The step

<What this worker does, as the lifecycle's phases of your own define it. Every constant is cited
by its block and key in the policy file, never by value.>

## Report

Return, and nothing else:

- what you changed, by path, and the command that proves each claim, with its measured result;
- any fact the step needed that the facts file lacked, named, as absent;
- the intervention code, exactly as `dry-run/workflow-policy.json` spells it, if the step met one of that list's
  firing preconditions; otherwise none. A build error, a test failure and unfamiliar code are
  work, not a reason to stop.
