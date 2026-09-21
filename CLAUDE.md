# CLAUDE.md

Read this file first. It is the only home for a rule an agent must follow in this repository.

## What this repository is

<!-- kit 1.1-1 · WRITE: one paragraph on what this repository is, what it produces, and what it is
     not. Name the files that decide the shape of the work, so a reader goes there rather than here. -->

## Rules for agents live in tracked files, and nowhere else

A rule an agent has to follow has exactly one home: this file, a skill under `.claude/skills/`, an
agent under `.claude/agents/`, or the header of the tool or gate that enforces it. Change it there,
through a pull request. A rule with two homes has one that is stale, and the stale one is the one a
reader finds.

Two other stores could hold such a rule, and neither is used here. The tracker's memory commands
(in Beads, `remember`, `recall` and `memories`) are not used; do not write a memory and do not cite
one from a tracked file. The harness's per-project memory directory under `~/.claude/projects/` is
not used either. A fact worth keeping goes in a tracked file or, if it is work, in `bd`.

The block a tracker plugin manages inside this file is task-tracking guidance, not permission to
override the rest of the file. Keep every section of your own outside it; the plugin regenerates
its block from the hash in its marker, and anything moved inside is erased on the next
regeneration.

## Verification before claiming

Never state a count, a figure or a "resolved" status derived from titles, memory or inference. Every
number in a document, an issue, a pull-request body or an analysis is re-derived from the repository
at the time of writing, with the source path cited inline. If a figure cannot be verified, say so
instead of estimating.

## Stateful counts live in `count-index.md`, under a key

Every count describing the current measured state of what this repository measures has a
`CNT-*` key in `count-index.md`, with its value and the command or file it re-derives
from. Prose writes the backticked key where the numeral would go, never both. A key is admitted only
for a count that moves when the source is re-measured **and** is restated in more than one
hand-maintained file; a number used once stays inline. A quotation keeps its numeral. A frozen or
historical figure gets no key. A string an emitter writes interpolates what it measured at emit
time or carries no figure. When two denominators exist, name the one you mean. Update the table from
what its check reports; never edit the check to agree with the table.

**Reporting honesty.** Any rate a report computes declares a sample size below which the report
prints the count and no rate. Every metric is defined once, in `count-index.md` § Rates and metrics,
as what is counted, who counts it, where it is recorded, and the value that would mean the project
is not viable; every other file points at that row.

## Bash command style

Run each gate, test and git command as its own Bash call. No `&&`, `;` or `|` chains and no
heredocs; use the Edit and Write tools for file content. Never `cd`, and never name a directory:
every call starts at the checkout root, so name the file as an explicit repository-relative
argument. Keep long prose out of the command line and pass it from a file under `.scratch/`
with `-F`, `--body-file` or the tool's equivalent. Prefer the Read, Edit and Write tools over `cat`,
`head`, `sed -n` and shell redirection. Read anything outside the repository in its own call. Never
let a secret-shaped read share a call with real work: a compound command is refused as a unit.

The permission classifier is a model's judgement on the command, so these rules move the odds
rather than guarantee the outcome. When a call is refused anyway, follow Guards.

## Guards

If a command you need is refused by the permission classifier, do not attempt a workaround. Skip
it, keep going with everything else, and give one `RUN THESE YOURSELF` code block at the end of the
report with the exact commands, in order.

## The task store

Every task is an issue in `bd`, never a markdown checklist or an in-session todo list.
`bd ready` is the queue; do not add a status table to a document. Every run of tracker writes is
bracketed: pull before the first write and push after the last, and a rejected push is reported
with its exact command and error, never forced. Long descriptions and notes go in by file. Every
open issue carries a label naming where its work lands.

## Decisions live in the register

`docs/decisions.md` holds the numbered decisions (`D-NN`) and risks (`R-NN`) that no agent
re-litigates. An entry is never rewritten: a later decision adds a dated amendment under each entry
it changes. When a document and the register disagree, the register wins. Retiring a file is a
register decision with a checklist, not a tidy-up; what retires moves to `docs/retired/` under a
banner naming the decision, or is deleted under an entry with `git show` as the recovery.

## Every directory and document says what it is, and who wins

A directory that holds more than one file of one kind has a `README.md`: a bolded one-sentence
thesis of the directory's role, then a table with one row per file saying what it is or, for a
gate, what it refuses. The row lands in the same change as the file. Every dated document opens
with a `**Written:**` line and, once something amends it, a `**Status:**` line naming what did; it
stays true about its date and is superseded rather than refreshed. Every document that can
disagree with another says, in one sentence, which wins. The documentation index and its
conventions are `docs/README.md` § Conventions.

## Three kinds of file, and never a fourth

Hand-maintained source, which a person edits. Hand-authored decision records (JSON), which emitters
read and nothing writes, each self-describing with `describes`, `whyThisFileExists`, `gatedBy`,
`whatItDoesNOTDo` and `provenance` before its data, and for each constant a `<key>Means` sibling
stating what the value decides and where it is changed: a JSON file cannot carry a header comment,
and a reader needs to know what a record changes and what it leaves alone before the array.
Generated output under `artifacts/`, which nothing edits by hand: it carries a banner naming its emitter, and a correction goes into the
hand-maintained source, so the next run carries it. A constant a tool or a prompt reads lives in a
policy file under a key, with its reason beside it, and is stated nowhere else.

## The script suffix contract

A script named `<group>:<verb>` in `package.json` is a public name. The bare name writes the
artifact. `:check` re-derives it in memory, diffs against what is committed, exits 1 on any
difference or on a stale file a fresh run would not write, and writes nothing. `:selftest` asserts
invariants from fixtures it builds under the temporary directory. `:update` moves a baseline.

Every emitter obeys the same rules from its first commit: no timestamp, no randomness, one canonical
serialiser, every sort by code point so two runtimes agree, and the `:check` twin lands in the same
change. An emitter that walks a graph compares its walk with a hand-ratified fixture and refuses to
write on disagreement, because a wrong walk returns a smaller answer and says nothing.

## The gate ladder

The same checks run at four latencies, and a slower tier never trusts a faster one:

| Tier | Latency | Shape |
|---|---|---|
| In-session hooks (`scripts/hooks/`) | milliseconds | may be unsound; never block a stop |
| Pre-commit (`lefthook`) | seconds | sequential, over staged files only |
| Pre-push (`lefthook`) | tens of seconds | parallel, each job scoped by a glob of what it reads |
| `.github/workflows/verify.yml` | minutes | every gate, binding on every pull request and every push to `main` |

Where a check runs is decided by what it reads. A check that reads only committed files is a
pre-push job **and** a `.github/workflows/verify.yml` step. A check that reads something outside the repository (another
checkout, a token, a network, a language model) runs in neither, and a digest gate stands in for it.
A legitimately absent input skips clean and prints why; a tool that is found and then fails is a
failure, never a skip.

**`npm run gates`, never the bare hook runner.** The bare runner skips every job when the push
file list is empty and exits 0 in a tenth of a second, which reads exactly like a clean run.
`npm run gates` is the forced full suite. Before opening or updating a pull request: regenerate
every derived artifact, run `npm run gates`, fetch and rebase onto `origin/main`, and run it
again.

## Standing rules for prompts and gates

Each of these holds from the first file it applies to, and for every one after it.

- **The first line of every substantial skill and agent** is: "Read CLAUDE.md first. Everything
  below is subordinate to it and points at it rather than restating it."
- **Every gate has a `--selftest` mode.** It copies the gate's inputs under the temporary directory,
  breaks exactly one thing per case, asserts the run fails **for that reason**, and keeps one
  undoctored control case that must pass, without which every other case could be failing on the
  copy. It is exposed as `<name>:selftest` and runs as its own pre-push job.
- **Every gate has a root override**: an environment variable naming a doctored copy, so a by-hand
  run can point the gate at a fixture without editing it.
- **A guard's selftest asserts the reason a refusal reports**, not the refusal alone: a check that
  only sees "refused" passes with the guard deleted whenever something else refuses first.
- **Every script under `scripts/`, every emitter under `tools/` and every hook under
  `scripts/hooks/` opens with a header of four parts, in this order**: what it emits or checks; **the
  failure it exists to prevent**, as the incident that happened, dated, with the wrong fix tried
  first where there was one; the invocation with its flags; and what it needs (another checkout, a
  token, a network). On day one, with no incident yet, that paragraph says what the script would
  let through if it were wrong, and the first incident replaces it. It is the paragraph readers
  actually need, and the one to keep when cutting: a gate whose header says only what it checks is
  the one the next person weakens to make a push go through. A measured cost lives there too, so
  "why is this not a pre-push job" is answerable from the file. An emitter's header adds four
  labelled lines: `KIND` (its lifecycle), `INVARIANTS` (what it never does), `RE-ENTRY` (whether a
  second run is idempotent, and what `--check` does) and `STALE WHEN` (the inputs whose change
  makes its output stale). A ten-line helper can carry one sentence.

## Citations

A file copied in from another repository is stripped before this gate's first run: its header
citations to sections, reviews, tracker ids and commits that do not exist here are replaced with
your own or dropped, and a copied prompt's `Reviewed:` trailer goes with them.

Cite a document by section, `<file>.md § <Heading>`, not by line: a line pointer rots on every edit
above it, and it rots in the worst direction, still looking authoritative. Every pointer of either
form in every tracked text file must resolve; the citations gate holds them. A proposed widening of
that gate is measured before it is adopted and, if refused, recorded in `docs/decisions.md`.

## Git workflow

The trunk is `main`. Agent work happens on `agent/<name>` branches cut from
`origin/main` by the one worktree script, and reaches the trunk by pull request; name the base
explicitly on every pull request, because a tool that infers one infers the default branch. The
protected branches are main, release: never push to, switch to or rewrite one from a
worktree. Rebase onto `origin/main` rather than merging the trunk into a branch, and use
`--rebase` on every pull. Commit or push only when asked.

## Prompt reviews

After a prompt is executed from a file, an analysis of the run goes to the
`continuous-prompt-improvement` agent, and a retained review lands at
`docs/prompt-reviews/<prompt-basename>.<run-date>.md`, never beside the prompt. A second review of
the same prompt is appended to its file under a dated heading, so the prompt keeps one live
`Reviewed:` citation: every substantial prompt ends in a `Reviewed:` line citing its review file
once its first review exists, and carries none until then. A review is not obsolete once applied: it is the evidence for why the prompt
says what it says, and is deleted only with the prompt it reviews.

## A program proposes; only a person promotes

The learning loop files every proposal it derives from run records as an issue in `bd`;
nothing it derives filters or instructs until a person has read the evidence and promoted it by
editing the hand-maintained source and re-running the emitter. A proposal that does not hold is
closed with its reason, and its key stays, so it is never re-filed under new wording.

## Worktree-local context

The briefing below exists only in a linked worktree, where the worktree script renders it from
`.claude/worktree-CONTEXT.md.tmpl`. It takes precedence where it conflicts with the guidance above.
A missing import is harmless, so this line does nothing in the primary checkout.

@.worktree/CONTEXT.md
