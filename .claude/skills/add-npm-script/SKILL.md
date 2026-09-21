---
name: add-npm-script
description: use this skill when adding, renaming or removing an npm script in package.json — including a new emitter, gate, check or selftest that will be run as `npm run <name>`.
---

A script in `package.json` is a public name. Prompts, tool headers, `lefthook.yml`, the CI workflow
and `README.md` all cite it as prose, and **nothing in this repository gates those citations** — a
renamed script leaves dead `npm run` references behind that stay green forever. Treat the name and
the documentation as part of the change, not as follow-up.

## 1. Name it

`<group>:<verb>`. Reuse an existing prefix wherever one fits; a new prefix means a new README
sub-section, which is a decision, not a side effect. Four conventions are load-bearing — an
emitter's `:check` twin in particular is how a reviewer trusts a committed artifact:

| Suffix | Contract |
|---|---|
| *(bare)* | writes the artifact |
| `:check` | re-derives it, diffs against what is committed, exits 1 on any difference, **writes nothing** |
| `:selftest` / `:selfcheck` | asserts invariants; builds its own fixtures, ideally under `os.tmpdir()` |
| `:update` | rewrites a baseline or golden |

A third segment only when it names a sub-artifact rather than a variation
(`pipeline:stale:check`, `lint:ratchet:update`).

## 2. Put the code where its neighbours are

`tools/<name>/*.ts` run by plain `node` for a node emitter that has its own module tree (Node 22.18+
strips the types itself; write every relative import with its `.ts` extension and use no enums,
namespaces or parameter properties, which the stripper cannot erase); a single-file `scripts/*.mjs`
run with `node` for a gate. Match the neighbours and introduce no new runtime — `tsx` was the
launcher until it was measured at ~6 s per start on Windows and removed.

Open the file with the header the neighbours use: what it emits, **the failure it exists to
prevent** (in this repository that is the paragraph readers actually need), the `npm run <name>`
invocation with its flags, and whether it needs the sibling `../estate` checkout. Node emitters
carry the `KIND / INVARIANTS / RE-ENTRY / STALE WHEN` block.

## 3. If it writes an artifact, make it deterministic

No timestamps, no randomness, stable key ordering; an unchanged input produces byte-identical
output. That is what makes the artifact diffable in review, and it is the precondition for a
`:check` twin. Write the twin at the same time.

## 4. Decide gating from what it reads, not from how much you trust it

- **Reads only committed files** → it can be a `pre-push` job *and* a CI step.
- **Reads `../estate`** → it can be neither. CI does not clone that checkout, so a `--check`
  there would compare a real artifact against one with every source-derived signal zeroed. Say so
  in the header, and rely on
  `npm run pipeline:stale` to keep the node behind an automated gate.
- **Legitimately-absent input** → skip clean with a message, never fail. A gate that is red on every
  fresh clone gets bypassed with `--no-verify`, which costs you every other gate too.

Then wire it: a job in `lefthook.yml` under `pre-push` — `run: node --run <name>`, plus a `glob`
listing every file whose change can alter its verdict, re-derived from what the script reads and
imports (the pre-push header there states the rule; when in doubt, wider — a too-narrow glob is a
gate that silently stops running on a real push, and `npm run gates` runs every job regardless) —
a step in `.github/workflows/verify.yml`, or both. If it is a pipeline node's emitter or check, register it
in `tools/pipeline/graph.ts` — `npm run pipeline:check` will tell you if the manifest no longer
describes the repository.

## 5. Update `README.md` § The npm scripts — this is not optional

The section documents **every** script in `package.json`, and its structure is mechanical:

- One `###` sub-section per prefix, sub-sections alphabetical. A new prefix gets a new sub-section
  in its alphabetical position; a prefix that loses its last script loses its sub-section.
- Rows alphabetical within the sub-section. Each row is `` | `script` | what it does | Gate | ``.
- The **Gate** cell is `pre-push`, `CI`, `pre-push + CI`, or empty — read off `lefthook.yml` and
  `.github/workflows/verify.yml` as they now stand, not off what you intended.
- The description says what the script does and what breaks without it. It does not restate the
  command line; `package.json` holds that, and two copies means one goes stale.
- Any figure in it must be re-derived at the time of writing, with no exceptions for numbers copied
  out of a source comment. Those drift silently: one emitter's header described the table it generated as 140 rows
  while the table it wrote carried 201, and every gate was green, because a numeral in a comment is
  not an input to anything.

Also update the **What runs automatically once you're set up** table if you touched a hook.

## 6. Renaming or removing one

Do all five, in any order, and none of them is discoverable later:

1. Delete or rewrite the `package.json` entry.
2. Delete or rewrite the README row — and the sub-section if it is now empty.
3. Remove the `lefthook.yml` job and the `verify.yml` step.
4. `grep -rn 'npm run <old-name>' --include='*.ts' --include='*.mjs' --include='*.md' .` and fix
   every hit. Tool headers, prompt files and `claude-code-prompts.md` cite script names in prose.
5. If it was a pipeline node's check, update `tools/pipeline/graph.ts`.

A retired script's references are worth leaving *only* as an explicit comment saying it is retired
and why; the CI workflow is where such a comment belongs.

## 7. Verify before you claim it works

```bash
npm run <new-script>
npm run gates
```

`npm run gates`, never the bare `lefthook run pre-push` — the bare form reports every job as
skipped whenever HEAD matches the tracking remote and exits 0. Then confirm your
job actually fired rather than silently matching nothing: check that its name appears in the run's
output. A job that never fires is worse than no job, because you will now defend the green result.

Run each command as a separate Bash call — the guard hook rejects `&&`, `;` and `|` chains.
