# `docs/`

**The documents a person reads to understand this repository, one row each.** A rule an agent must
follow is not here: it lives in `CLAUDE.md`, a skill, an agent or the header of the gate that
enforces it, and a document points at that home rather than restating it.

<!-- kit 4.1-2 · WRITE: one row per document, added in the same change as the document. The kit
     lists only what it laid down. Delete this comment when your first row has landed. -->

## The documents in this folder

| Document | What it is |
|---|---|
| `docs/decisions.md` | The register: the numbered decisions (`D-NN`) and risks (`R-NN`) that nobody re-litigates. An entry is never rewritten; a later decision adds a dated amendment under each entry it changes. |
| `docs/retired/README.md` | What has been retired, each file under a banner naming the decision that retired it. Kept as the evidence a decision was recorded from, never as guidance. |
| `docs/pipeline.md` | The pipeline graph in prose: which generated artifact is built from which, and what to regenerate, in what order, when something moves. A copy; the record under `tools/pipeline/graph.ts` wins a disagreement. |
| `docs/prompt-reviews/README.md` | The retained reviews of executed prompts, one file per prompt, each the evidence for why its prompt says what it says. |

## The documents that live elsewhere

| Document | What it is |
|---|---|
| `CLAUDE.md` | Read first. The only home for a rule an agent must follow here. |
| `AGENTS.md` | The pointer for a harness that reads that name: it sends the reader to `CLAUDE.md` and holds no rule of its own. |
| `README.md` | Setup, numbered per platform, and the table of what runs automatically. |
| `count-index.md` | Every count describing the current measured state, under a key, with the source each value re-derives from. |
| `.claude/README.md` | What the harness loads when a session starts here: the settings, the hooks, the skills and the agents. |

## Conventions

- **A dated document stays true about its date.** It is superseded, never refreshed: a new
  document says what changed, and the old one stays in the tree, literal, as the evidence a decision
  was recorded from.
- **Every dated document says when it was written, at its head.** A `**Written:**` line gives the
  date, and, once something amends the document, a `**Status:**` line names what did: the decision,
  the document or the change that superseded or corrected it. A reader learns from the first screen
  whether to keep reading.
- **Every document that can disagree with another says, in one sentence, which wins.** A route
  through the work says the file or command that decides each step wins; a guide for a reader who
  runs nothing says the technical document wins; a cache says its source wins.
- When a document and the register (`docs/decisions.md`) disagree, the register wins: correct the document, and never re-argue the decision.
- **Numbers cite their source.** A figure is re-derived at the time of writing, with the path or
  command it came from beside it, or it is reported as not verified (`CLAUDE.md` § Verification
  before claiming).
- **A count that more than one document restates is cited by its key** in `count-index.md`, where
  the numeral would go, never both.
- **The status of work lives in `bd` and never in a document.** Run `bd ready`; do not
  add a status table to a document in this folder. Prose that tracks status becomes a second
  tracker that nobody updates.
- **Cite by section, never by line**: the file in backticks, then `§` and the heading. The
  citations gate resolves every pointer of that form in every tracked file.
