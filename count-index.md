# Count index

**The one place a count describing the current measured state of this repository is written.**
Every other hand-maintained file cites the key, so a figure has one home and cannot drift between
two. This table is a cache of its sources: where the table and a source disagree, the source wins,
`npm run counts:check` says so, and the table is updated from what the check reports.

<!-- kit 4.3-1 · WRITE: one row per figure that describes the current measured state of the thing
     you measure, added in the same change as its row in the second table. The kit seeds the
     tables with what it laid down and can re-derive on the first day; replace or extend it with
     the counts your own documents restate. Delete this comment when your first key has landed. -->

## The counts

| Key | Value | What it counts |
|---|---|---|
| `CNT-HOOKS` | 6 | Hook registrations in `.claude/settings.json`: every entry of every `hooks` array, across every event and matcher group. |

## Where each value comes from

One row per key, in one of four spellings that `scripts/check-count-index.mjs` reads and
re-derives from: `files: <glob>` (how many tracked files match), `json: <file> <pointer>` (what a
pointer reaches in a committed JSON file, `*` standing for every key or index), `deriver` (a
function in the check, one per key), or `by-hand: <command>` (measured over something outside this
repository, so not checked there; the command is how a person re-derives it). The check's header
defines each spelling exactly.

| Key | Re-derives from |
|---|---|
| `CNT-HOOKS` | `json: .claude/settings.json /hooks/*/*/hooks` |

## How to use it

- **Prose writes the backticked key where the numeral would go, never both.** A sentence reads
  "the settings file registers `CNT-HOOKS` hooks", and the reader who wants the
  number opens this file. A numeral beside the key is a second copy, and it is the copy that
  drifts.
- **A key is admitted only for a count that moves when the source is re-measured and is restated
  in more than one hand-maintained file.** A number used once stays inline, with its source cited
  beside it.
- **A quotation keeps its numeral.** What a document, a commit or a person said at the time is
  evidence, and rewriting it to a key falsifies it.
- **A frozen or historical figure gets no key.** A measurement taken on a date stays true about
  that date; it is written as a numeral with the date and the source.
- **A string an emitter writes interpolates what it measured at emit time, or carries no figure.**
  Generated output never cites a key and never repeats a numeral from this table.
- **Name the denominator when two exist.** "Incomplete" over every item and "incomplete" over the
  items in scope are two counts, and each gets its own key and its own "what it counts".
- **Update the table from what the check reports; never edit the check to agree with the table.**
  A key and its source row land in the same change, or the check reports the key as unbacked.
- **A `by-hand:` key is re-derived by a person whenever its source moves**, with the command its
  row gives, because neither the pre-push suite nor `.github/workflows/verify.yml` can reach what it measures.

The rule behind all of it is `CLAUDE.md` § Verification before claiming: a count is re-derived at
the time of writing and its source cited, or it is reported as not verified.

## Rates and metrics

**A rate is printed only over a declared minimum sample.** Any report that computes a rate names
the sample size below which it prints the count and no rate, so a rate over three records never
reads as a finding. The minimum is a constant the report reads: it lives in the policy file of the
tool that computes the rate, under a key, with its reason beside it, and is stated nowhere else.

**Every metric is defined once, here.** A metric that a report, a review or a sponsor will be
shown has one row below, and every other file points at the row rather than redefining it. If the
definitions move to a generated file, this section names the hand-maintained source it is
generated from and keeps nothing else.

<!-- kit 4.3-5 · WRITE: one row per metric you report. The kit cannot know what you measure, so
     the table is empty; a metric with no row here is not reported. Delete this comment when the
     first row has landed. -->

| Metric | What is counted | Who counts it | Where it is recorded | The value that would mean the project is not viable |
|---|---|---|---|---|
