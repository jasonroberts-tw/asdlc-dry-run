---
name: bead
description: Work one or more issues from the task store end to end - verify the premise, claim, implement, gate, open the pull request, close on green. Use when asked to work, pick up or finish an issue.
---

Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it.

<!-- kit 1.10-1 · ADAPT: this is the spine only. Add, under the step it belongs to, what your
     repository needs that the spine cannot know: the toolchain a change must build with, the
     artifacts a change must regenerate, the gates that are yours. Delete this comment when done. -->

# Work an issue

The argument is one issue id, several, or nothing (then take the top of `bd ready`). Every tracker
write below sits inside the bracket `CLAUDE.md` § The task store describes: pull before the first
write, push after the last, and report a rejected push rather than forcing it.

## 1. Verify the premise before any work

An issue's title is not evidence. Read the issue, then read the code it talks about, and decide
which of three things is true, citing file and line for each claim:

- **still valid**: the defect or the gap is there, as described;
- **already fixed**: name the commit or the pull request that fixed it;
- **obsolete**: what it asks for no longer applies, and why.

What happens next depends on who is listening:

- **With a live user:** when the premise does not hold, show the evidence and stop. The user decides
  whether the issue closes, changes or stands.
- **In an autonomous session:** write the evidence into the issue as a note, leave the issue open,
  and move to the next one. Never close an issue on your own reading of its premise.

## 2. Partition before claiming

With several issues, decide before claiming any of them which can share a branch and which cannot:
two issues that rewrite the same lines belong together; two that touch nothing in common do not.
Claim only what this session will finish.

## 3. Claim, then work in a worktree

Claim the issue in the tracker. Make the worktree with the one worktree script, never natively, and
run `npm ci` first inside it. Read `.worktree/CONTEXT.md` there: it names the branch, the base and
the rules of a shared repository.

## 4. Implement, regenerate, gate

Make the change. Regenerate every derived artifact the change touches, with its emitter, never by
hand. Run `npm run gates`: the forced full suite, never the bare hook runner. A red gate is fixed
or reported, never bypassed.

## 5. Rebase and gate again

Fetch, rebase onto `origin/main`, and run `npm run gates` again: the first run proved the change,
the second proves it against what landed meanwhile.

## 6. Open the pull request and watch its checks

Push the branch and open the pull request with its base named explicitly (`main`), its body passed
from a file under `.scratch/`. Poll the checks in the background and never end the turn while
they run. A failing check is read, fixed on the same branch and pushed again.

## 7. Close on green, with a reason

When every check is green, close the issue with a reason that names the pull request. An acceptance
criterion that acts outside the repository is not performed: it becomes a follow-up issue labelled
`human`, created with its label at creation.

## 8. Report

One short report: what was verified in step 1 and where, what changed, what was regenerated, both
gate runs as measured, the pull request, the issue's final state, every follow-up filed, and a
`RUN THESE YOURSELF` block for any command that was refused (`CLAUDE.md` § Guards).
