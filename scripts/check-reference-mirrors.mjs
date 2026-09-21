/**
 * `reference/` gate: every imported file still hashes to what its `MANIFEST.sha256` says.
 *
 *   npm run reference:check
 *
 * THE JOB THIS EXISTS FOR. `reference/README.md` opens by saying nothing in that tree is produced
 * here and nothing in it is edited here, and it names the two files every import carries as "the
 * contract": a `README.md` recording the pin, and a `MANIFEST.sha256` recording the bytes. Both
 * import READMEs then told a reader to re-hash and compare. Nothing did.
 *
 * (The read-only skill mirror the two paragraphs below describe was DELETED by a later decision on 2026-09-07,
 * as a retired import nothing read; `reference/data/` is the one import the
 * gate walks today. The story stays because it is why the gate exists, and the deletion needed no
 * code change here: the import layout is discovered, not listed -- see below.)
 *
 * That gap was not theoretical for a single day. The mirror landed with its
 * `references/ui-enforcement-policy.json` ALREADY drifted -- 30,705 bytes
 * against the manifest's 27,079 -- because `.prettierignore` did not cover
 * `reference/` and `prettier --write .` (package.json `format`) expanded the file's compact
 * one-object-per-line JSON on the way in. Its README went on stating "6 of 6" digests reproduced and
 * "0 files edited" while five did and one file had been. Every gate was green.
 *
 * A read-only mirror that silently drifts is the exact failure that mirror's own README warned about
 * in its own words -- "a hand-patched mirror is not detectable at all" -- so the mirror needs the
 * check more than a generated artifact does. A generated artifact has an emitter to re-run and diff
 * against; an import has only this.
 *
 * WHAT FAILS THE JOB:
 *   1. a mirrored file whose sha256 disagrees with its manifest row (drift, a hand edit, a formatter)
 *   2. a mirrored file whose byte count disagrees with its manifest row
 *   3. a manifest row with no file under the import directory -- a copy that never arrived
 *   4. a `reference/<import>/` with no `MANIFEST.sha256` or no `README.md` -- an import that ships
 *      unverifiable, which is how this whole class of defect gets in
 *   5. a manifest whose own `Files:` / `Total bytes:` header disagrees with its rows
 *
 * EVERY CHECK READS ONLY COMMITTED FILES OF THIS REPOSITORY, so nothing here skips: no sibling
 * checkout, no network, no Windows desktop. This is the rule the `add-npm-script` skill states for a
 * check over committed files -- the SOURCE may only be reachable on one machine, but the check that
 * reads what was committed must run on all of them -- and check 1 is the whole point of the gate.
 * It runs at `pre-push` and in `.github/workflows/verify.yml`, and CI is the run that matters: CI is
 * where the drift went unnoticed, and a hook alone is skipped by `--no-verify`.
 *
 * A SIXTH CHECK STOOD HERE UNTIL a later decision (2026-09-09) AND WAS REMOVED AS A CHECK THAT COULD NEVER RUN.
 * Where the import's source REPOSITORY was on disk at the recorded pin, it re-read each manifest
 * row's blob with `git -C <sibling> cat-file blob <pin>:<path>` and compared, to catch a manifest cut
 * wrong at import time rather than a mirror drifted since; where the checkout was absent -- CI, and
 * every clone but the importer's -- it SKIPPED by name, exit 0. Its only possible subject was the
 * mirror a later decision deleted: `reference/data/`'s manifest header names a DATABASE under `Source :`, which
 * has no pin and no blobs, so the check read nothing anywhere and printed "no repository source" on
 * every run. A gate that cannot fail is one people stop reading (`lefthook.yml`'s recurring
 * argument), and a skip message naming a checkout of a repository this one no longer references is
 * worse than none. WHAT TO REBUILD IF A REPOSITORY-SOURCED IMPORT LANDS AGAIN: read the pin from the
 * manifest header (`Source repo :` and `Pin :` lines, which `readManifest` no longer parses); scrub
 * every `GIT_*` variable from the environment before spawning git, because git exports `GIT_DIR` into
 * every hook and it outranks `-C` (the sibling-checkout resolver under `tools/lib/` learned this and exports the
 * helper); resolve the sibling from the PRIMARY checkout via `git rev-parse --git-common-dir` (an
 * ancestor walk finds nothing from a linked worktree); and verify at the PIN, never at
 * the sibling's HEAD, so an ordinary pull cannot make the gate red. The working version is at
 * `git show <a later decision commit>^:scripts/check-reference-mirrors.mjs`.
 *
 * THE IMPORT LAYOUT IS DISCOVERED, NOT LISTED. There is no table of imports here to forget to
 * extend. Every directory under `reference/` is an import; its manifest's third column is a source
 * path, and the destination is found by stripping the leading segments that describe where the file
 * lived at the source. `data` strips none; the deleted mirror stripped four (its rows named the
 * bundle path down to `staging/skills/`), which is why the depth is computed rather than assumed.
 * The strip depth is chosen ONCE per manifest -- the shallowest that resolves every row -- rather
 * than per row, so a missing file is reported as missing instead of quietly matching some shorter
 * suffix that happens to exist.
 *
 * NEGATIVE TESTING. Point `CHECK_REFERENCE_ROOT` at a copy of the tree and doctor that instead:
 *
 *   cp -r reference /tmp/doctored/ && CHECK_REFERENCE_ROOT=/tmp/doctored node scripts/check-reference-mirrors.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.CHECK_REFERENCE_ROOT
  ? resolve(process.env.CHECK_REFERENCE_ROOT)
  : resolve(HERE, '..')
const REFERENCE_DIR = join(ROOT, 'reference')

/** The two contract files, plus git's own. Present in an import, never rows in its manifest. */
const NOT_IMPORTED_CONTENT = new Set(['README.md', 'MANIFEST.sha256', '.gitattributes'])

/* ============================================================================================= *
 * Reading a manifest
 * ============================================================================================= */

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * `<sha256>  <bytes>  <source path>` rows, plus the header facts the rows are checked against.
 *
 * A repository-sourced import may also record `Source repo :` and `Pin :` in its header; nothing
 * here reads them since a later decision (the header above says what would). `data/`'s header records a
 * database and an export date instead, which is the unpinnable case `reference/README.md` describes.
 */
function readManifest(path) {
  const text = readFileSync(path, 'utf8')
  const rows = []
  const header = { declaredFiles: null, declaredBytes: null }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#')) {
      const files = line.match(/\bFiles:\s*(\d+)/)
      if (files) header.declaredFiles = Number(files[1])
      const bytes = line.match(/\bTotal bytes:\s*(\d+)/)
      if (bytes) header.declaredBytes = Number(bytes[1])
      continue
    }
    const row = line.match(/^([0-9a-f]{64})\s+(\d+)\s+(\S.*)$/)
    if (row) rows.push({ sha: row[1], bytes: Number(row[2]), sourcePath: row[3].trim() })
    else rows.push({ malformed: line })
  }
  return { header, rows }
}

/**
 * How many leading segments of the source paths describe the SOURCE tree rather than this one.
 *
 * Chosen once per manifest, shallowest-first, and only a depth that resolves EVERY row wins. Picking
 * per row would let a manifest row whose file is missing fall through to some shorter suffix that
 * happens to exist -- `a/b/README.md` quietly matching the import's own `README.md` -- which turns
 * defect 3 into a pass. Where no depth resolves everything, the best-scoring one is used so the
 * unresolved rows are reported as missing against a sensible mapping.
 */
function chooseStripDepth(importDir, rows) {
  const paths = rows.filter((r) => r.sourcePath).map((r) => r.sourcePath)
  if (paths.length === 0) return 0
  const maxDepth = Math.max(...paths.map((p) => p.split('/').length - 1))
  let best = { depth: 0, hits: -1 }
  for (let depth = 0; depth <= maxDepth; depth++) {
    let hits = 0
    for (const p of paths) {
      const rel = p.split('/').slice(depth).join('/')
      const abs = join(importDir, rel)
      if (rel !== '' && existsSync(abs) && statSync(abs).isFile()) hits++
    }
    if (hits === paths.length) return depth
    if (hits > best.hits) best = { depth, hits }
  }
  return best.depth
}

/** Every file under `dir`, relative to it. */
function filesUnder(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const abs = join(d, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) out.push(relative(dir, abs))
    }
  }
  walk(dir)
  return out
}

/* ============================================================================================= *
 * The check
 * ============================================================================================= */

function checkImport(id, failures, notes) {
  const importDir = join(REFERENCE_DIR, id)
  const manifestPath = join(importDir, 'MANIFEST.sha256')

  if (!existsSync(manifestPath)) {
    failures.push(
      `${id}: no MANIFEST.sha256. reference/README.md makes it half the import contract -- ` +
        'without it nothing can tell a copy from an edit.',
    )
    return null
  }
  if (!existsSync(join(importDir, 'README.md'))) {
    failures.push(`${id}: no README.md. The pin is the other half of the import contract.`)
  }

  const { header, rows } = readManifest(manifestPath)
  for (const row of rows) {
    if (row.malformed) {
      failures.push(
        `${id}: MANIFEST.sha256 line is not <sha256>  <bytes>  <path> -- "${row.malformed}"`,
      )
    }
  }
  const good = rows.filter((r) => r.sourcePath)

  if (header.declaredFiles !== null && header.declaredFiles !== good.length) {
    failures.push(
      `${id}: MANIFEST.sha256 header says Files: ${header.declaredFiles} but carries ${good.length} row(s)`,
    )
  }
  const rowBytes = good.reduce((n, r) => n + r.bytes, 0)
  if (header.declaredBytes !== null && header.declaredBytes !== rowBytes) {
    failures.push(
      `${id}: MANIFEST.sha256 header says Total bytes: ${header.declaredBytes} but its rows sum to ${rowBytes}`,
    )
  }

  const depth = chooseStripDepth(importDir, good)
  const claimed = new Set()
  let verified = 0

  for (const row of good) {
    const rel = row.sourcePath.split('/').slice(depth).join('/')
    const abs = join(importDir, rel)
    if (rel === '' || !existsSync(abs) || !statSync(abs).isFile()) {
      failures.push(`${id}: manifest names ${row.sourcePath} -- no file at reference/${id}/${rel}`)
      continue
    }
    claimed.add(rel)
    const buf = readFileSync(abs)
    const actual = sha256(buf)
    if (actual !== row.sha) {
      failures.push(
        `${id}/${rel}: sha256 ${actual} (${buf.length} bytes) but the manifest says ` +
          `${row.sha} (${row.bytes} bytes). The mirror is not a copy any more -- re-import from the ` +
          'pin, do not repair in place.',
      )
      continue
    }
    if (buf.length !== row.bytes) {
      failures.push(`${id}/${rel}: ${buf.length} bytes but the manifest says ${row.bytes}`)
      continue
    }
    verified++
  }

  /* Reported, not enforced: `data/columns.json` is a companion its own manifest deliberately omits,
   * so a hard failure here would be red on arrival for a legitimate layout. It is AUTHORED in this
   * repository -- a recovered column list, not a copy of anything upstream -- so it has no source
   * path to put in a manifest row's third column, and a row would assert an import that never
   * happened and go red the next time this repository legitimately edits its own file. That is
   * settled, and the reason is written down where a reader will meet it: the
   * `Not manifested:` block in `reference/data/MANIFEST.sha256`'s header, the "`columns.json` is not
   * manifested" section of `reference/data/README.md`, and the exception named in
   * `reference/README.md`. Its integrity claim is held by a different gate -- `npm run
   * check:menu-baseline` verifies every header-bearing export against the names recorded there.
   *
   * Saying it out loud is still worth doing, because this note cannot tell that case from the one it
   * shares a shape with: a genuinely imported file that arrived with no row, which is unverifiable.
   * Any name here other than `columns.json` is that, and is fixed by cutting a manifest row. */
  const extras = filesUnder(importDir).filter(
    (f) => !claimed.has(f) && !NOT_IMPORTED_CONTENT.has(f),
  )
  if (extras.length > 0) {
    notes.push(`${id}: ${extras.length} file(s) carry no manifest row -- ${extras.join(', ')}`)
  }

  return { verified, total: good.length }
}

function main() {
  if (!existsSync(REFERENCE_DIR)) {
    console.log('reference: no reference/ directory -- nothing to check.')
    process.exit(0)
  }

  const imports = readdirSync(REFERENCE_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  if (imports.length === 0) {
    console.log('reference: no imports -- nothing to check.')
    process.exit(0)
  }

  const failures = []
  const notes = []
  const summaries = []

  for (const id of imports) {
    const summary = checkImport(id, failures, notes)
    if (summary) summaries.push({ id, ...summary })
  }

  if (failures.length === 0) {
    for (const s of summaries) {
      console.log(
        `reference/${s.id}: ${s.verified} of ${s.total} file(s) reproduce their manifest digest.`,
      )
    }
    for (const note of notes) console.log(`  note: ${note}`)
    process.exit(0)
  }

  console.error(
    `reference: ${failures.length} failure(s). reference/README.md -- an import is a copy, ` +
      'and MANIFEST.sha256 is what makes that checkable.\n',
  )
  for (const failure of failures) console.error(`  - ${failure}\n`)
  for (const note of notes) console.error(`  note: ${note}\n`)
  process.exit(1)
}

main()
