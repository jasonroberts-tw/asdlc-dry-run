# Prompt reviews

**One file per reviewed prompt, holding every reading of a run back against the prompt that drove
it.** After a prompt is executed from a file, an analysis of the run goes to the
`continuous-prompt-improvement` agent, and the review that is kept lands here as
`<prompt-basename>.<run-date>.md`, never beside the prompt (`CLAUDE.md` § Prompt reviews): a review
left beside a prompt reads as a second prompt or a stale draft.

## The shape of a review

In this order. The section names are a default; the two closing sections are the value.

1. **The prompt and the run reviewed**, with identifiers a reader can verify, such as the prompt's
   path and the commit it was run at, the pull request the run produced, and the date.
2. **What the earlier reviews' changes did in this run.** Each change a previous review made, and
   whether this run shows it working, not working, or not exercised.
3. **What the run cost that the prompt did not prevent**, as numbered findings, each with its fix: the
   sentence to add, change or remove, and where.
4. **Corrections to the run's own analysis.** Where the session's account of itself is wrong, say so
   here, with the evidence; the analysis is an input, not a verdict.
5. ***Deliberately not changed.*** What was considered and left alone, with the reason. This is the
   section that stops the same suggestion arriving three times.
6. ***What this review could not verify.*** Every claim above that rests on something the reviewer
   could not check, named.

## A second review is appended, never a second file

A second review of the same prompt is appended to that prompt's file under a dated heading, so the
prompt keeps one live citation. The prompt itself ends in a `Reviewed:` trailer naming this file and
the runs behind it, and that citation is kept live: if the review file moves, the trailer moves with
it in the same change.

## A review is not obsolete once applied

An applied review is the evidence for why the prompt says what it says. Without it the next reviewer
re-raises settled points, which is the register problem at prompt scale. Delete a review only with
the prompt it reviews.
