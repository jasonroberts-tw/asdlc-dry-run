/**
 * Count-index gate: every value in `count-index.md` is re-derived from the source the index itself
 * names for it, and the run fails when the table disagrees.
 *
 *   npm run counts:check       the gate; prints every key with its derived value on every run
 *   npm run counts:selftest    its fixtures: every refusal exercised on a doctored copy
 *
 * kit 4.3-3 · ADAPT: a key's source is written in the index's second table, in one of the four
 * spellings below, in the same change as the key. Most keys need no code here. A count no spelling
 * reaches gets the spelling `deriver` and one function in `DERIVERS`, one per key. Delete this
 * paragraph when the first key of your own has landed.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A count restated in several hand-maintained files drifts: the
 * same figure reads one value in one document and another in the next, and a reader cannot tell
 * which was measured. The index is the one place a figure is written, prose cites its key where the
 * numeral would go, and this check is what keeps the index honest: without it the index is one more
 * copy. No incident has happened here yet; if this check were wrong it would let through a table
 * value nobody re-measured, a key with no source (a number nobody can re-derive), and a deriver
 * whose key was deleted (a measurement nobody reads). The first incident replaces this sentence.
 *
 * THE SOURCE VOCABULARY, the cell of "Where each value comes from", backticked or bare:
 *   files: <glob>              how many tracked files match. `*` stays inside one path segment,
 *                              `**` crosses them, everything else is literal.
 *   json: <file> <pointer>     the nodes `/a/b/0` reaches in a committed JSON file, where a `*`
 *                              segment stands for every key or index. A number counts as itself,
 *                              an array as its length, an object as its number of keys; the value
 *                              is the sum over the nodes reached.
 *   deriver                    a function in `DERIVERS` below, keyed by the key. It returns a whole
 *                              number, or a string that must equal the table's cell exactly.
 *   by-hand: <command>         measured over something outside this repository (another checkout, a
 *                              database, a service), so NOT CHECKED HERE. Every run prints how many
 *                              keys are in that state, and the command is how a person re-derives
 *                              one after the source moves.
 *
 * WHAT FAILS THE RUN, each reported by key:
 *   1. a value in the index that differs from what its source gives: the message names the key, the
 *      table's value and the derived value;
 *   2. a key whose source cell is none of the four spellings, or says `deriver` with no function
 *      here (UNBACKED); a function here whose key has no row, or whose row names another source
 *      (STALE);
 *   3. a key in the values table with no row in the sources table, or the reverse;
 *   4. a key listed twice, a key without the `CNT-` prefix, or a checked value that is
 *      not a whole number;
 *   5. a source that cannot be read (the JSON file is missing, the pointer reaches nothing, the
 *      function throws), reported with the reason;
 *   6. the index itself missing, or without its two tables.
 *
 * UPDATE THE TABLE FROM WHAT THIS CHECK REPORTS; NEVER EDIT THE CHECK TO AGREE WITH THE TABLE. A
 * source changes only when what is being counted changes, and then the index's "what it counts"
 * cell changes in the same commit.
 *
 * INVOCATION.  node scripts/check-count-index.mjs [--selftest]
 *              COUNT_INDEX_ROOT=<dir> points a by-hand run at a doctored copy of the repository.
 * NEEDS.       Only committed files of this repository, and `git` for the tracked-file list (a
 *              directory that is not the top of a git checkout is walked instead). No network,
 *              milliseconds. Pre-push and CI both.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = process.env.COUNT_INDEX_ROOT ?? REPO_ROOT
const INDEX = 'count-index.md'
const PREFIX = 'CNT-'
const VALUES_HEADING = 'The counts'
const SOURCES_HEADING = 'Where each value comes from'

/**
 * One function per key whose source cell says `deriver`: `(root) => number | string`. Empty until a
 * count arrives that `files:` and `json:` cannot reach.
 */
const DERIVERS = {}

// ---- the sources -----------------------------------------------------------------------------------

const WALK_SKIP = new Set(['.git', 'node_modules'])

/** Every file under `root`, repository-relative with `/`: the tracked list, or a walk outside git. */
function listFiles(root) {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (realpathSync(git('rev-parse', '--show-toplevel').trim()) === realpathSync(root)) return git('ls-files', '-z').split('\0').filter(Boolean).sort()
  } catch {
    // not the top of a git checkout (a selftest fixture, an export): walk it
  }
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (WALK_SKIP.has(name)) continue
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else files.push(relative(root, abs).split(sep).join('/'))
    }
  }
  walk(root)
  return files.sort()
}

/** `*` stays inside one path segment, `**` crosses them; everything else is literal. */
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
      if (glob[i + 1] === '/') i++
    } else if (c === '*') re += '[^/]*'
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function countFiles(root, glob) {
  const re = globToRegExp(glob)
  return listFiles(root).filter((f) => re.test(f)).length
}

function countJson(root, file, pointer) {
  if (!existsSync(join(root, file))) throw new Error(`${file} is missing`)
  let nodes = [JSON.parse(readFileSync(join(root, file), 'utf8'))]
  for (const step of pointer.split('/').filter(Boolean)) {
    nodes = nodes.flatMap((node) => {
      if (node == null || typeof node !== 'object') return []
      if (step === '*') return Object.values(node)
      return step in node ? [node[step]] : []
    })
  }
  if (!nodes.length) throw new Error(`${file} has nothing at ${pointer}`)
  return nodes.reduce((sum, node) => {
    if (typeof node === 'number') return sum + node
    if (Array.isArray(node)) return sum + node.length
    if (node && typeof node === 'object') return sum + Object.keys(node).length
    throw new Error(`${file} ${pointer} reaches a value that is neither a number, an array nor an object`)
  }, 0)
}

/** A source cell as `{ kind, derive }`, or null when it is none of the four spellings. */
function parseSource(cell, key, derivers) {
  const files = /^files:\s*(\S+)$/.exec(cell)
  if (files) return { kind: 'files', derive: (root) => countFiles(root, files[1]) }
  const json = /^json:\s*(\S+)\s+(\/\S*)$/.exec(cell)
  if (json) return { kind: 'json', derive: (root) => countJson(root, json[1], json[2]) }
  if (cell === 'deriver') return { kind: 'deriver', derive: derivers[key] ?? null }
  if (/^by-hand:\s*\S/.test(cell)) return { kind: 'by-hand', derive: null }
  return null
}

// ---- the index -------------------------------------------------------------------------------------

/** Rows of the first table under `## <heading>` whose header row starts with `| Key |`. */
function tableUnder(lines, heading) {
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (start < 0) return null
  const rows = []
  let seenHeader = false
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break
    if (!line.trim().startsWith('|')) {
      if (seenHeader) break
      continue
    }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (!seenHeader) {
      if (cells[0] !== 'Key') return null
      seenHeader = true
      continue
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    rows.push(cells)
  }
  return seenHeader ? rows : null
}

const bare = (cell) => (cell ?? '').replace(/`/g, '').trim()

/** Every problem in the index under `root`, and the report lines of a green run. */
export function check(root, derivers) {
  const problems = []
  const report = []
  let byHand = 0
  const path = join(root, INDEX)
  if (!existsSync(path)) return { problems: [`${INDEX} is missing: there is no index to check.`], report, byHand }
  const lines = readFileSync(path, 'utf8').split('\n')
  const values = tableUnder(lines, VALUES_HEADING)
  const sources = tableUnder(lines, SOURCES_HEADING)
  if (!values) problems.push(`${INDEX} has no "## ${VALUES_HEADING}" table whose header row starts with "| Key |".`)
  if (!sources) problems.push(`${INDEX} has no "## ${SOURCES_HEADING}" table whose header row starts with "| Key |".`)
  if (!values || !sources) return { problems, report, byHand }

  const sourceCell = new Map()
  for (const row of sources) {
    const key = bare(row[0])
    if (sourceCell.has(key)) problems.push(`${key} is listed twice in "${SOURCES_HEADING}".`)
    else sourceCell.set(key, bare(row[1]))
  }

  const seen = new Set()
  const usesDeriver = new Set()
  for (const row of values) {
    const key = bare(row[0])
    if (seen.has(key)) {
      problems.push(`${key} is listed twice in "${VALUES_HEADING}".`)
      continue
    }
    seen.add(key)
    if (!key.startsWith(PREFIX)) problems.push(`${key} does not carry the key prefix ${PREFIX}.`)
    if (!sourceCell.has(key)) {
      problems.push(`${key} has no row in "${SOURCES_HEADING}".`)
      continue
    }
    const source = parseSource(sourceCell.get(key), key, derivers)
    if (!source) {
      problems.push(`${key} is UNBACKED: its source "${sourceCell.get(key)}" is none of \`files: <glob>\`, \`json: <file> <pointer>\`, \`deriver\` and \`by-hand: <command>\`, so nothing re-derives it.`)
      continue
    }
    if (source.kind === 'by-hand') {
      byHand++
      continue
    }
    if (source.kind === 'deriver') usesDeriver.add(key)
    if (!source.derive) {
      problems.push(`${key} is UNBACKED: its source says \`deriver\` and ${'scripts/'}check-count-index.mjs has no function for it. Write the function in the same change as the key.`)
      continue
    }
    let derived
    try {
      derived = source.derive(root)
    } catch (err) {
      problems.push(`${key}: its source could not be read (${err.message}).`)
      continue
    }
    const written = bare(row[1])
    if (typeof derived === 'string') {
      if (written !== derived) problems.push(`${key}: the table says "${written}", the source says "${derived}". Update the table from what this check reports; never edit the check to agree with the table.`)
      else report.push(`  ${key} = ${derived}   (${sourceCell.get(key)})`)
      continue
    }
    if (!/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(written)) {
      problems.push(`${key}: the table's value "${written}" is not a whole number (the source says ${derived}).`)
      continue
    }
    const tabled = Number(written.replace(/,/g, ''))
    if (tabled !== derived) problems.push(`${key}: the table says ${tabled}, the source says ${derived}. Update the table from what this check reports; never edit the check to agree with the table.`)
    else report.push(`  ${key} = ${derived}   (${sourceCell.get(key)})`)
  }
  for (const key of sourceCell.keys()) if (!seen.has(key)) problems.push(`${key} has a row in "${SOURCES_HEADING}" and none in "${VALUES_HEADING}".`)
  for (const key of Object.keys(derivers)) if (!usesDeriver.has(key)) problems.push(`${key} is STALE: a function here derives it and no row of the index says \`deriver\` for it. Delete the function with the key, or restore the row.`)
  return { problems, report, byHand }
}

// ---- selftest --------------------------------------------------------------------------------------

function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'count-index-selftest-'))
  const F = `${PREFIX}FIXTURE-FILES`
  const J = `${PREFIX}FIXTURE-HOOKS`
  const D = `${PREFIX}FIXTURE-DERIVED`
  const H = `${PREFIX}FIXTURE-ELSEWHERE`
  const index = (rows, sourceRows) =>
    [
      '# Count index',
      '',
      `## ${VALUES_HEADING}`,
      '',
      'A sentence between the heading and its table is not a row.',
      '',
      '| Key | Value | What it counts |',
      '|---|---|---|',
      ...rows,
      '',
      `## ${SOURCES_HEADING}`,
      '',
      '| Key | Re-derives from |',
      '|---|---|',
      ...sourceRows,
      '',
      '## How to use it',
      '',
      '| Key | a later table the check never reads |',
      '|---|---|',
      '| `UNPREFIXED` | 9 |',
      '',
    ].join('\n')
  const rows = { [F]: `| \`${F}\` | 2 | fixture files |`, [J]: `| \`${J}\` | 1,003 | fixture registrations |`, [D]: `| \`${D}\` | 7 | a derived count |`, [H]: `| \`${H}\` | 12 of 40 | counted over another checkout |` }
  const sourceRows = { [F]: `| \`${F}\` | \`files: things/*.txt\` |`, [J]: `| \`${J}\` | \`json: data.json /events/*/*/hooks\` |`, [D]: `| \`${D}\` | \`deriver\` |`, [H]: `| \`${H}\` | \`by-hand: count-elsewhere --all\` |` }
  const derivers = { [D]: () => 7 }
  const lay = (name, { r = {}, s = {}, extraRows = [], extraSources = [], withIndex = true, withData = true } = {}) => {
    const root = join(dir, name)
    mkdirSync(join(root, 'things', 'deeper'), { recursive: true })
    mkdirSync(dirname(join(root, INDEX)), { recursive: true })
    writeFileSync(join(root, 'things/a.txt'), 'a\n')
    writeFileSync(join(root, 'things/b.txt'), 'b\n')
    writeFileSync(join(root, 'things/deeper/c.txt'), 'not matched by a single star\n')
    // 1,003 = 1000 (a number) + 2 (an array) + 1 (an object), reached through two `*` segments.
    if (withData) writeFileSync(join(root, 'data.json'), JSON.stringify({ events: { Stop: [{ hooks: 1000 }], PreToolUse: [{ hooks: ['x', 'y'] }, { hooks: { z: true } }, { matcher: 'no hooks here' }] } }))
    const pick = (base, over) => Object.keys(base).filter((k) => over[k] !== null).map((k) => over[k] ?? base[k])
    if (withIndex) writeFileSync(join(root, INDEX), index([...pick(rows, r), ...extraRows], [...pick(sourceRows, s), ...extraSources]))
    return root
  }
  const update = 'Update the table from what this check reports'
  const cases = [
    ['control: the undoctored fixture passes, with one key not checked here', lay('control'), derivers, null],
    ['a files value nobody re-measured', lay('drift-files', { r: { [F]: `| \`${F}\` | 3 | fixture files |` } }), derivers, new RegExp(`${F}: the table says 3, the source says 2\\. ${update}`)],
    ['a json value nobody re-measured', lay('drift-json', { r: { [J]: `| \`${J}\` | 1,002 | fixture registrations |` } }), derivers, new RegExp(`${J}: the table says 1002, the source says 1003\\. ${update}`)],
    ['a source in no known spelling', lay('spelling', { s: { [F]: `| \`${F}\` | count the text files |` } }), derivers, new RegExp(`${F} is UNBACKED: its source "count the text files"`)],
    ['a deriver key with no function', lay('unbacked'), {}, new RegExp(`${D} is UNBACKED: its source says \`deriver\``)],
    ['a function whose key was deleted', lay('stale', { r: { [D]: null }, s: { [D]: null } }), derivers, new RegExp(`${D} is STALE`)],
    ['a key missing from the sources table', lay('no-source', { s: { [J]: null } }), derivers, new RegExp(`${J} has no row in "${SOURCES_HEADING}"`)],
    ['a source row whose key has no value', lay('no-value', { r: { [J]: null } }), derivers, new RegExp(`${J} has a row in "${SOURCES_HEADING}" and none in "${VALUES_HEADING}"`)],
    ['a key listed twice', lay('twice', { extraRows: [rows[F]] }), derivers, new RegExp(`${F} is listed twice in "${VALUES_HEADING}"`)],
    ['a key without the prefix', lay('prefix', { extraRows: ['| `ROWS` | 2 | unprefixed |'], extraSources: ['| `ROWS` | `files: things/*.txt` |'] }), derivers, /ROWS does not carry the key prefix/],
    ['a checked value that is not a whole number', lay('nan', { r: { [F]: `| \`${F}\` | about 2 | fixture files |` } }), derivers, new RegExp(`${F}: the table's value "about 2" is not a whole number`)],
    ['a json source whose file is missing', lay('no-data', { withData: false }), derivers, new RegExp(`${J}: its source could not be read \\(data\\.json is missing\\)`)],
    ['a json pointer that reaches nothing', lay('no-node', { s: { [J]: `| \`${J}\` | \`json: data.json /events/*/*/hook\` |` } }), derivers, new RegExp(`${J}: its source could not be read \\(data\\.json has nothing at /events/\\*/\\*/hook\\)`)],
    ['the index is missing', lay('no-index', { withIndex: false }), derivers, /is missing: there is no index to check/],
  ]
  let failed = 0
  for (const [name, root, d, reason] of cases) {
    const { problems, byHand } = check(root, d)
    const ok = reason === null ? problems.length === 0 && byHand === 1 : problems.length === 1 && reason.test(problems[0])
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} -- ${reason === null ? 'passes' : 'fails for that reason, and for no other'}${ok ? '' : `\n       got: ${JSON.stringify(problems)}`}`)
    if (!ok) failed++
  }
  if (failed) {
    console.log(`counts selftest: ${failed} of ${cases.length} case(s) FAILED; fixtures kept at ${dir}`)
    process.exit(1)
  }
  rmSync(dir, { recursive: true, force: true })
  console.log(`counts selftest: ${cases.length}/${cases.length} cases hold (one control, ${cases.length - 1} doctored copies).`)
}

// ---- main ------------------------------------------------------------------------------------------

if (process.argv.includes('--selftest')) selftest()
else {
  const { problems, report, byHand } = check(ROOT, DERIVERS)
  if (problems.length) {
    console.error(`counts:check FAILED: ${problems.length} problem(s) in ${INDEX}`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`counts:check -- ${report.length} key(s) in ${INDEX} re-derived from their sources; ${byHand} marked by-hand and not checked here.`)
  for (const line of report) console.log(line)
  if (!report.length && !byHand) console.log('  (the index holds no key yet: nothing is restated, so nothing can drift)')
}
