# `tools/`

**Emitters, and any check that is a multi-file module: one directory per tool.** An emitter writes
generated output under `artifacts/` and nothing else, is deterministic, and lands with its
`:check` twin (`CLAUDE.md` § The script suffix contract). A single-file gate lives under
`scripts/`.

Each tool's header is the authority on it: what it emits or checks, the failure it exists to
prevent, its invocation and what it needs (`CLAUDE.md` § Standing rules for prompts and gates).
Where a row here and a header disagree, the header wins and the row is corrected.

<!-- kit 4.1-1 · WRITE: one row per tool, added in the same change as the tool. For a gate, say
     what it refuses; for an emitter, what it writes and from what. The kit lists only what it laid
     down. -->

| Path | Kind | What it is, or what it refuses |
|---|---|---|
| `citations/` | gate, `citations:check` | Refuses a `<file>.md:NN` or `<file>.md` § `<Heading>` pointer, in any tracked text file, that names a file that is not tracked, a line past the end or blank, or a section that does not exist; and a pointer into a store this repository does not use. `check.ts` is the gate, `scan.ts` the scanner and its exemption lists (each entry with its reason), `memory.ts` the unused-store rule, `selftest.ts` the fixtures that hold the scanner to known answers. |
| `lib/paths.ts` | helper | Where the repository root is, in a module with no side effects, so a tool can ask without running anything. |
| `lib/bd-launcher.ts` | helper | Finds the tracker's CLI on this machine and starts it without a shell. Only "not found" is a skip; found and not runnable is a failure, reported with the launcher and the error. |
| `outcomes/` | emitter, `outcomes`, and gate, `outcomes:check` | Reads every run-outcome record under `artifacts/outcomes/records/`, validates and re-serialises each to canonical bytes, and derives the reports under `artifacts/outcomes/` from the records and nothing else; an empty records directory is a legal state and every report says so. `record.ts` is the schema's validator, `write-record.ts` the writer that refuses an invalid record with one named reason, `propose.ts` the filing step (`outcomes:propose`, `--dry-run` first), `already-named.ts` the check against the committed reference that decides what is printed rather than filed. |
| `pipeline/` | gates, `pipeline:check` and `pipeline:stale:check` | `graph.ts` is the record itself: one entry per node, and the only place an edge is declared. `check.ts` refuses a record that no longer describes the repository: a node naming a file that is gone, an input glob matching nothing, a node missing from the prose page. `stale.ts` re-folds each node's declared inputs into a digest and refuses an output whose stamp no longer matches, without running a generator. `assess.ts` is the fail-or-report decision, `digest.ts` the content digest, `glob.ts` the one matcher both runtimes agree on, `provenance.ts` the stamp a node writes into what it built, `formulas.ts` the cross-check over the tracker's formulas, `selftest.ts` the negative tests over a synthetic record, `example/` the worked node to delete once one of yours exists. |
| `lib/estate-root.ts` | helper | Resolves the sibling checkout a node may read, from the primary checkout rather than the worktree, with an environment variable to override it. |
