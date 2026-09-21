# The dry-run lifecycle

<!-- kit 2.2 · ADAPT: this is the ONE copy of the lifecycle. The entry skill executes it by heading and
     restates none of it; `dry-run/tests/entry-skill.test.mjs` refuses a phase heading anywhere
     else. Replace the text in <angle brackets>, add the phases your workflow has between Approval
     and Record (renumber Record; `dry-run/tests/sections.test.mjs` holds the order, not the
     count), and keep Intake, Approval, Record and the Intervention section. Delete this comment
     when done. -->

Procedure for one run, by phase. The invariants are on the contract page
(`.claude/skills/dry-run-contract/SKILL.md`); nothing here repeats them.

## Phase 0 · Intake (read-only)

Intake changes nothing: no branch, no edit, no push, no comment. It:

1. makes one cheap read against each external server the workflow's README declares REQUIRED, as
   its first action, and raises `REQUIRED_SERVER_UNAVAILABLE` if one fails; an OPTIONAL server that
   is absent is recorded as absent, and intake continues;
2. verifies the facts file at the path the launcher handed it, with
   `dry-run/tools/Test-HostFacts.ps1`, and raises `HOST_PREREQUISITES_INCOMPLETE`, once,
   naming every failed check, when the facts say the host is not ready;
3. reads the <work item> and every comment on it, in order, every author;
4. resolves the subject: <what the work item is about, and the files that decide it>;
5. inspects branch state: whether a branch for this item exists, and what it holds.

Its output is a read-only findings summary and the mutation list for Phase 1.

## Phase 1 · Approval (asked once)

The run names EVERY mutation it will make, and asks once:

- the branches it will create or push to;
- local edits and builds;
- checkpoint pushes;
- the record it writes on its terminal path;
- the pull requests it will open or update.

That one approval covers those operations. The run asks again only at an intervention boundary
(below) or for an operation outside the list (`OUT_OF_SCOPE_MUTATION`). Declined, the run stops
with its read-only findings and the command that restarts it.

## Phase 2 · <your work>

<One numbered list per phase of your own. Every step names the tool or the file that decides it,
and cites a constant by its block and key in the policy file, never by value.>

## Phase 3 · Record (every terminal path)

Complete, failed and blocked alike end here: the run writes its one record, validated before it is
written and after its last push, with every intervention it raised under the code it raised it
with.

## Intervention

A run stops to ask a person only for a code in `dry-run/workflow-policy.json`, block `intervention`, key `codes`;
the firing preconditions and what an answer does are beside each code there, and are not repeated
here. To raise one, the run:

1. checks the code's firing preconditions against what it has measured, not what it expects;
2. states the code, what it found, and the one question the answer must settle, in one message,
   through the intervention channel the entry skill's Host Facts table names;
3. waits; it does not continue on a guess, and it does not ask a second question in the meantime;
4. records the code, the question and the answer, and resumes as the code's entry says.

A reason that is not on the list is not a reason to ask: the run records a failure and ends at
the Record phase.
