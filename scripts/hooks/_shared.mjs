/**
 * Shared helpers for the Claude Code hooks in this directory.
 *
 * These hooks run on EVERY matching tool call, so the budget is a few hundred milliseconds. Nothing
 * here starts a TypeScript process, reads an extraction document or shells out. `node` plus `fs` only.
 *
 * Why this tier exists: most of the work in this
 * repository is done by an agent, and a gate that fires after the agent has spent twenty minutes
 * going the wrong way is worth far less than one that stops it at the first keystroke.
 */
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

/** The repository root. This file lives at `scripts/hooks/_shared.mjs`. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Read the hook payload from stdin.
 *
 * Returns `null` rather than hanging when there is no stdin, so every hook in this directory can be
 * run by hand and exits cleanly with nothing to do.
 */
export async function readHookInput() {
  if (process.stdin.isTTY) return null
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * The file path a Write/Edit call is aimed at, from either spelling of the payload.
 *
 * `tool_input.file_path` is the documented field; the text is `content` on Write and `new_string` on
 * Edit. Both are read because a Write to a path that does not exist yet has no file on disk to
 * inspect, and the incoming TEXT is then the only evidence available.
 */
export function editTarget(input) {
  const ti = input?.tool_input ?? {}
  return {
    filePath: typeof ti.file_path === 'string' ? ti.file_path : null,
    text: [ti.content, ti.file_text, ti.new_string].find((t) => typeof t === 'string') ?? '',
  }
}

/** A repo-relative POSIX path, or `null` when the target is outside this repository. */
export function toRepoRel(filePath) {
  if (typeof filePath !== 'string' || filePath === '') return null
  const rel = relative(ROOT, resolve(ROOT, filePath))
  if (rel === '' || rel.startsWith('..')) return null
  return rel.split(sep).join('/')
}

/**
 * The first 2,000 bytes of a file -- its header and nothing else.
 *
 * The window matters. An emitter contains the literal string "GENERATED ... DO NOT EDIT BY HAND"
 * because it EMITS it -- the catalogue emitter does, and a deleted parser and the retired screen
 * generator did before it. A whole-file search would classify every emitter as generated output and refuse
 * every edit to the only files that can actually fix anything.
 */
export function header(absPath) {
  try {
    const fd = openSync(absPath, 'r')
    try {
      const buf = Buffer.alloc(2000)
      const n = readSync(fd, buf, 0, 2000, 0)
      return buf.subarray(0, n).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

/**
 * Does this text carry a generator's own hands-off banner in its header?
 *
 * BOTH SIGNALS ON THE SAME LINE, which is not fussiness. Every real banner in this repository is one
 * shouted line naming the tool and forbidding the edit in the same breath. Testing the two halves
 * against the whole header instead flags any FILE THAT DISCUSSES build products: it flagged
 * scripts/assert-not-hand-edited.mjs, whose entire subject is this check.
 *
 * The two generated Markdown reports split their banner over two lines and so slip past this. They do
 * not need it -- `generatedFileRedirect` covers them by path and gives a better message anyway. This
 * function is only the catch-all for a generator nobody has told that table about.
 */
export function hasGeneratedBanner(text) {
  // Two separate patterns, applied line by line, so no line of THIS file carries both halves and
  // trips the check on itself.
  const namesATool = /\bgenerated\b/i
  const forbidsTheEdit = /do not (?:edit by hand|hand-edit)/i
  return text
    .slice(0, 2000)
    .split('\n')
    .some((line) => namesATool.test(line) && forbidsTheEdit.test(line))
}

/**
 * Is the content heuristic even worth running on this path?
 *
 * NOT ON PROSE. This repository's primary artifacts are Markdown briefs whose SUBJECT is generated
 * code, so a document that quotes the banner in order to explain it is normal and expected --
 * `generate-screen.md:15` does exactly that, and the heuristic refused to let it be edited. The two
 * generated Markdown reports are covered by `generatedFileRedirect` above, by path, with a better
 * message than the catch-all could give. So the catch-all covers code and data only.
 */
export function bannerCheckApplies(rel) {
  return !/\.(?:md|mdx|txt|rst|adoc)$/i.test(rel)
}

/* ============================================================================================= *
 * Which files a generator owns, and where a change to them actually belongs.
 * ============================================================================================= */

/**
 * `src/screens/<Namespace>/<Screen>.tsx | .grid-specs.ts | .stories.tsx` -- but not `.behaviour.ts`.
 *
 * KEPT AFTER THE GENERATOR WAS DELETED, and the message says so rather than naming a command that no
 * longer exists. Both the emitter and the `src/screens/` tree are gone, so nothing can legitimately
 * recreate one of these paths today; an agent writing one is reconstructing retired output by hand,
 * which is the one thing the evidence rules forbid. Refusing with an explanation beats
 * letting it land and beats a redirect to `npm run generate:screens`, which would now just fail.
 */
const GENERATED_SCREEN =
  /^src\/screens\/([^/]+)\/([^/]+?)(?:\.grid-specs\.ts|\.stories\.tsx|\.tsx)$/

function redirectForScreen(rel, ns, screen) {
  return [
    `${rel} is retired generated output. The screen generator that wrote it has been deleted, and`,
    'so has the `src/screens/` tree -- there is no command that regenerates this file.',
    '',
    'Do not hand-write it back. Nothing in this repository builds a screen: a screen',
    'reconstructed by hand is evidence of nothing. Recover it from history if you need to read it:',
    `  git log --all --diff-filter=D -- ${rel}`,
    '',
    'If you are changing what a screen IS rather than how it rendered, the inputs that still exist:',
    `  layout / controls / captions                     artifacts/forms/${ns}.${screen}.json`,
    '  a control type described wrong                   catalogue/controls/<Type>.md (the kernel; control-map.json is frozen under docs/retired/)',
    '  behaviour                                        derived by the migration research worker (migration/agents/) from the source; the',
    '                                                   behaviour manifests went with the node that validated them',
  ].join('\n')
}

function redirect(rel, what, where, command) {
  return [
    `${rel} is GENERATED ${what}. A hand edit here is overwritten by the next run.`,
    '',
    `Edit instead: ${where}`,
    `Then:         ${command}`,
  ].join('\n')
}

/** `references/controls/<declaredType>.md` under the published skill; group 1 is the declared type. */
const CATALOGUE_CONTROL =
  /^artifacts\/catalogue\/estate-catalogue\/references\/controls\/([^/]+)\.md$/

/**
 * `references/base/<Class>.md` under the published skill; group 1 is the SIMPLE class name, which is
 * also the source file's name under catalogue/base/ (tools/catalogue/emit-base.mjs).
 */
const CATALOGUE_BASE = /^artifacts\/catalogue\/estate-catalogue\/references\/base\/([^/]+)\.md$/

/**
 * `references/journeys/<EntryPoint>.md` under the published skill; group 1 is the entry point. Unlike
 * the two rows above there is NO hand-maintained source to redirect to: a journey page transcribes
 * the navigation model's routes and the journey candidates,
 * so the redirect names the node whose artifact carries the fact.
 */
const CATALOGUE_JOURNEY =
  /^artifacts\/catalogue\/estate-catalogue\/references\/journeys\/([^/]+)\.md$/

/**
 * The catalogue's other emitted files, PATH-EXACT, each with where its content actually comes from.
 * The Markdown files bypass the banner heuristic exactly as the
 * control references do -- `SKILL.md` among them, which is why it needs a row here rather than a
 * banner: without one a hand edit to the published page lands silently until `catalogue:check` runs
 * at push. The JSON files carry a banner and the catch-all would refuse them, but with a message that
 * names no input.
 */
const CATALOGUE_EMITTED = new Map([
  [
    'artifacts/catalogue/estate-catalogue/SKILL.md',
    'catalogue/SKILL.md -- the hand-authored source this page is rendered from; tools/catalogue/emit-skill.mjs adds the banner and the measured file table, and refuses over 200 lines',
  ],
  [
    'artifacts/catalogue/estate-catalogue/source-manifest.json',
    'the file whose digest you want to change -- the manifest is recomputed from every emitted file by tools/catalogue/emit-skill.mjs and cannot be corrected on its own',
  ],
  [
    'artifacts/catalogue/estate-catalogue/index.json',
    'tools/catalogue/emit-index.mjs -- or the artifact a row transcribes (artifacts/forms/, portfolio/coverage.json, api/procedures.json, api/contention.json; for the journey block, navigation/routes.json and journeys/candidates.json via tools/catalogue/emit-journeys.mjs)',
  ],
  [
    'artifacts/catalogue/estate-catalogue/references/verdicts.md',
    'tools/catalogue/emit-references.mjs -- or tools/catalogue/verdicts.json for a verdict, which check:verdicts gates',
  ],
  [
    'artifacts/catalogue/estate-catalogue/references/contention.md',
    'tools/catalogue/emit-references.mjs -- or artifacts/api/contention.json (npm run contention) for a figure',
  ],
  [
    'artifacts/catalogue/estate-catalogue/references/capabilities.md',
    'tools/catalogue/emit-references.mjs -- or tools/catalogue/capability-seed.json for a class',
  ],
  [
    'artifacts/catalogue/coverage.json',
    'tools/catalogue/coverage.mjs -- or, for a coverage gap, the reference body in catalogue/controls/<Simple>.md, which is what moves the number',
  ],
])

/**
 * `null` when nothing generates this path, otherwise the message to hand back.
 *
 * Path-based rather than content-based so the message can be SPECIFIC about where the change belongs.
 * `hasGeneratedBanner` is the catch-all underneath it, for a generated file this table has not been
 * taught about yet.
 */
export function generatedFileRedirect(rel) {
  const screen = GENERATED_SCREEN.exec(rel)
  if (screen) return redirectForScreen(rel, screen[1], screen[2])

  // REDIRECTS STOOD HERE and went with the emitters they named. A redirect naming a command that
  // no longer exists is worse than none, because the reader runs it: when an emitter is retired,
  // its row goes in the same change. Every entry in this table is path-exact for that reason --
  // a row never claims an artifact that a different emitter owns.
  //
  // The catalogue's per-type control references (tools/catalogue/emit-controls.mjs).
  // Emitted from the HAND-MAINTAINED kernel file `catalogue/controls/<Simple>.md`, whose name is the
  // declared type's last dot-segment; the emitted name is the fully-qualified type, so the source
  // file is derived from the path here. This row is needed rather than merely tidy: emitted `.md`
  // files bypass the banner heuristic (`bannerCheckApplies` below), so without it a hand edit here
  // lands silently until `node tools/catalogue/index.mjs --check` runs. A PATTERN, unlike the rows
  // above, because the file set is decided by which kernel bodies exist; SKILL.md and
  // source-manifest.json under the same skill root sit beside it as path-exact rows in
  // CATALOGUE_EMITTED.
  const control = CATALOGUE_CONTROL.exec(rel)
  if (control) {
    const simple = control[1].split('.').pop()
    return redirect(
      rel,
      'by `npm run catalogue` (tools/catalogue/emit-controls.mjs)',
      `catalogue/controls/${simple}.md -- the body below the front matter; the front matter is held to control-map.json by check:control-kernel`,
      'npm run catalogue',
    )
  }
  // The base-class references: same shape as the control row, but the emitted name
  // IS the source file's name, and the front matter is gated by the emitter's closed key set rather
  // than by check:control-kernel (catalogue/base/README.md).
  const base = CATALOGUE_BASE.exec(rel)
  if (base) {
    return redirect(
      rel,
      'by `npm run catalogue` (tools/catalogue/emit-base.mjs)',
      `catalogue/base/${base[1]}.md -- the body below the front matter; the front matter is the class declaration and its base chain, and the emitter accepts nothing else (catalogue/base/README.md)`,
      'npm run catalogue',
    )
  }
  // The journey pages have no hand-maintained source: they transcribe two nodes'
  // artifacts, so the redirect names the node that measured the fact being changed.
  const journey = CATALOGUE_JOURNEY.exec(rel)
  if (journey) {
    return redirect(
      rel,
      'by `npm run catalogue` (tools/catalogue/emit-journeys.mjs)',
      `the node that measured it -- the navigation model for the route and menu binding of ${journey[1]}, and the journey candidates for its closure and marks. Nothing about a journey is authored in the catalogue`,
      'npm run catalogue',
    )
  }
  const emitted = CATALOGUE_EMITTED.get(rel)
  if (emitted !== undefined) {
    return redirect(
      rel,
      'by `npm run catalogue` (tools/catalogue/index.mjs)',
      emitted,
      'npm run catalogue',
    )
  }
  // The node that reads run records. The whole tree is emitter-owned: the
  // records are written by the migration workflow's terminal step
  // (migration/skills/migration-contract/tools/Write-RunOutcome.ps1) and normalised to
  // canonical bytes by `npm run outcomes`, the comment and judgement files are what two harvest
  // scripts read back from the work tracker and from the judge, and everything else is derived from
  // those by `npm run outcomes`. A PATTERN over the root rather than path-exact rows, because the
  // record, comment and judgement file sets are decided by what runs wrote and not by this file; the
  // Markdown reports bypass the banner heuristic and need the row, and the JSON files carry a banner
  // but get a better message here.
  if (rel.startsWith('artifacts/outcomes/')) {
    return redirect(
      rel,
      'by `npm run outcomes` (tools/outcomes/), or harvested by `outcomes:comments` / `outcomes:judge`',
      'the source it was written or derived from -- for a record, the migration workflow’s terminal step (migration/skills/migration-contract/tools/Write-RunOutcome.ps1 writes it, `npm run outcomes` normalises it; never edit the file by hand), tools/outcomes/*.ts or tools/outcomes/policy.json for a report, the the work tracker thread for a comment, tools/outcomes/judge-prompt.md for a judgement',
      'npm run outcomes',
    )
  }
  return null
}

/* ============================================================================================= *
 * Running an npm script without a shell.
 * ============================================================================================= */

const WINDOWS = process.platform === 'win32'
const NPM = WINDOWS ? 'npm.cmd' : 'npm'

/**
 * Run `npm run <script>` and resolve with its exit code and combined output. Never rejects.
 *
 * Windows needs a shell: since the CVE-2024-27980 fix Node refuses to `spawn` a `.cmd` file without
 * one and throws EINVAL. The whole command therefore goes through as ONE string with no argv array,
 * which is also what keeps Node's DEP0190 warning off the hook's stderr. `script` is always a literal
 * from the caller in this repository, never anything a payload supplied.
 */
export function npmRun(script, { timeoutMs = 120_000 } = {}) {
  return new Promise((done) => {
    const child = WINDOWS
      ? spawn(`${NPM} run --silent ${script}`, { cwd: ROOT, windowsHide: true, shell: true })
      : spawn(NPM, ['run', '--silent', script], { cwd: ROOT })
    let out = ''
    const take = (b) => {
      out += b.toString('utf8')
      if (out.length > 20_000) out = out.slice(-20_000)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ code: 127, out: `could not run \`npm run ${script}\`: ${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: code ?? 1, out: out.trim() })
    })
  })
}

/** Read a file, or a fallback. */
export function readOr(absPath, fallback = '') {
  try {
    return readFileSync(absPath, 'utf8')
  } catch {
    return fallback
  }
}
