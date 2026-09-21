---
name: dry-run-contract
description: The dry-run workflow's contract - the invariants every worker obeys on every step, and the table of references a step opens. Preloaded by every dry-run agent; never invoked on its own.
---

Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it.

<!-- kit 2.1-1 · ADAPT: this page holds ONLY what every worker obeys on EVERY step. Every line here is
     paid for on every dispatch, so procedure does not live here: it lives in a reference, and a
     worker opens a reference only when its step points there. Replace the text in <angle brackets>;
     keep the headings, which `dry-run/tests/sections.test.mjs` holds in this order. Delete this
     comment when done. -->

# The dry-run contract

## What a run is

One run takes one <work item> from intake to a terminal state: complete, failed or blocked. The
entry skill starts it, a person approves its mutations once, and workers carry out its steps.

## Invariants

1. **Facts by path.** The run's environment facts are one file under `.dry-run/run/<item>/`, written once by
   the launcher. Every dispatch passes that file's PATH and never restates its contents. A worker
   reads the file, never asks for the facts, never writes it, and treats a fact it lacks as absent
   rather than guessed.
2. **Constants by key.** Every constant a tool or a prompt reads lives in `dry-run/workflow-policy.json` under a
   key, with its reason beside it. A prompt cites the block and the key and states no second number.
3. **References by name.** A worker opens a reference below only when its step points there.
4. **One approval.** A run mutates nothing before the mutation-scope approval, and nothing outside
   the scope that approval named.
5. **Synced context is a copy.** Context the launcher syncs into `dry-run/` before a launch (a
   reference tree an emitter of this repository publishes, a skill another team maintains) lands in
   gitignored directories. Every lookup reads the committed tree, never the copy, and the other
   team's skill is never forked.
6. **Generated output is never edited by hand**, and a correction goes into the hand-maintained
   source (`CLAUDE.md` § Three kinds of file, and never a fourth).
7. <an invariant of your own that holds on every step; if it holds on one step only, it is
   procedure and belongs in a reference>

## When the run asks a person

The reasons a run may stop and ask are the intervention codes in `dry-run/workflow-policy.json`, block
`intervention`, key `codes`. **That list is exhaustive**: a run that wants to ask for a reason not
on it does not ask; it records a failure. Each code's firing preconditions, and what an answer
does, are beside the code; how a run raises one is in the lifecycle reference, under Intervention.

**These are not reasons to ask:** a build error, a test failure, unfamiliar code, and a missing
capability that has a truthful unavailable state. Each is work, or a recorded degradation. A run
never asks merely whether it may continue.

## Which source wins

When two inputs disagree, the higher one wins, in this order:

1. the latest explicit clarification from a person, in the run or on the <work item>;
2. the <work item>'s own text, then its comments, read in order, every author;
3. <the committed reference your workflow reads>;
4. <the code as it stands>.

A conflict the inputs leave open goes to the person (`SOURCE_CONFLICT`), never to a heuristic, and
is never resolved by discarding an author.

## References

| Reference | Who opens it | When |
|---|---|---|
| `.claude/skills/dry-run-contract/references/lifecycle.md` | the entry skill, and a worker whose step names a heading in it | at the start of each phase, by heading |
| `dry-run/workflow-policy.json` | any tool, and a worker whose step cites a key | when a step cites a constant, by block and key |
| `.dry-run/run/<item>/host-facts.json` | every worker, before acting | once per dispatch, by the path it was handed |
