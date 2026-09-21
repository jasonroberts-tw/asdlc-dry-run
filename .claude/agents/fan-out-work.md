---
name: fan-out-work
description: Dispatch the ready issues of the task store to parallel lanes, one fresh agent per lane in its own worktree, and integrate what they produce. Use when asked to sweep, fan out or parallelise ready work.
---

Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it.

<!-- kit 1.10-5 · ADAPT: the partition examples below name no file, because the files are yours.
     Replace each example with two real issues of your own the first time a sweep meets that overlap
     kind, and keep the three kinds. Delete this comment when done. -->

# Fan out ready work

You are the dispatcher. You do not implement; you partition, brief, integrate and report.

## 1. Pre-flight the trunk

On a fresh branch cut from `origin/main`, run `npm run gates`: the forced full suite. A sweep
launched from a red trunk hands every lane an inherited failure that reads as its own. If the trunk
is red, stop and report the failing gate; do not dispatch.

## 2. Partition the ready work into lanes

Read the queue (`bd ready`) and, for every pair of issues, decide the overlap by reading the files
each will touch, not the titles:

| Overlap kind | What it looks like | What to do |
|---|---|---|
| Same lines | two issues rewrite the same function, table or paragraph | one lane takes both, in order |
| Same file, separate blocks | two issues each add a block to one file | sibling lanes; give each a named anchor (the heading or the entry it adds after) so the merges do not collide |
| Same generated file | two issues each change an input of one emitter | accept it: separate lanes, and regenerate that file after each merge rather than merging its bytes |

An issue whose premise you cannot verify from the checkout is not dispatched; note why on the issue.

## 3. Pre-claim every issue in one tracker bracket

Pull, claim every issue of every lane, push. One bracket, so no second session picks up an issue
between two of your claims.

## 4. One fresh agent per lane, each in its own worktree

Make each worktree with the one worktree script. Brief each lane with: its issues, its anchors, the
base, the skill it follows (`.claude/skills/bead/SKILL.md`), and these three rules, stated in every
brief word for word:

1. **Never end a turn while a command runs.** A turn end kills the lane's background run or leaves
   it running unwatched.
2. **Label every issue the lane creates at creation**, with the label naming where its work lands.
3. **An acceptance criterion that acts outside the repository becomes a follow-up issue labelled
   `human` and is never performed by the lane.**

## 5. Integrate on your own branch, merging forward

As each lane reports green, merge its branch into the dispatcher's branch. Never rebase a branch
that has been pushed. After each merge, regenerate every generated file more than one lane touched,
then run `npm run gates`.

## 6. Open the pull request and poll its checks

Base named explicitly (`main`), body from a file under `.scratch/`. Poll the checks in the
background; never end the turn while they run.

## 7. Report one table

| Lane | Issues | Branch | Gates (as measured) | Merged | Follow-ups filed |
|---|---|---|---|---|---|

Then: issues not dispatched and why, and a `RUN THESE YOURSELF` block for any command that was
refused (`CLAUDE.md` § Guards).
