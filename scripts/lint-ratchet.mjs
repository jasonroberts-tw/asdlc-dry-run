/**
 * The ratchet. Warning counts in the pre-existing code may FALL, never RISE.
 *
 *   npm run lint:ratchet           compare against eslint.baseline.json, exit 1 on any increase
 *   npm run lint:ratchet:update    rewrite the baseline to the current counts
 *
 * WHY THIS EXISTS instead of `--max-warnings 0`. `src/design-system/` is 29,712 lines written before
 * any linter existed. Demanding zero warnings on day one forces a single enormous cleanup commit
 * that nobody reviews properly; demanding nothing lets the count drift up forever. A ratchet gives
 * the design system a monotonic path to clean without either.
 *
 * ERRORS are never tolerated, in any area, at any count. Only warnings ratchet.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBin } from './lib/bin-path.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(ROOT, 'eslint.baseline.json')
const UPDATE = process.argv.includes('--update')

/* ------------------------------------------------------------------------------- run eslint ---- */

/**
 * ESLint's JSON formatter on stdout. Exit code 1 means "findings", which is the normal case here, so
 * only a code above 1 (a crash, a bad config) is an error.
 */
function runEslint() {
  return new Promise((done, fail) => {
    // Walked up, not assumed: a linked worktree's own node_modules is nearly empty.
    const bin = findBin('eslint', ROOT)
    if (!bin) {
      fail(
        new Error(
          'eslint not found in any ancestor node_modules/.bin. It is a devDependency of this ' +
            'package; run `npm install` in the primary checkout.',
        ),
      )
      return
    }
    const child =
      process.platform === 'win32'
        ? spawn(`"${bin}" . -f json`, { cwd: ROOT, shell: true, windowsHide: true })
        : spawn(bin, ['.', '-f', 'json'], { cwd: ROOT })
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (err += b))
    child.on('error', fail)
    child.on('close', (code) => {
      if (code !== null && code > 1) return fail(new Error(`eslint exited ${code}\n${err}\n${out}`))
      try {
        done(JSON.parse(out))
      } catch {
        fail(new Error(`could not parse eslint JSON output\n${err}\n${out.slice(0, 2000)}`))
      }
    })
  })
}

/* ------------------------------------------------------------------------------ group results -- */

/**
 * The AREA a finding is charged to: the first two path segments.
 *
 * Deliberately coarse. A per-file baseline would have to be rewritten every time a file is renamed
 * or split, and would let a regression hide by moving code between files. Per-area, the only way the
 * number goes down is that someone fixed something.
 */
function areaOf(rel) {
  const parts = rel.split('/')
  return parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
}

/**
 * An absolute eslint `filePath` made relative to ROOT, with forward slashes.
 *
 * This used to be `filePath.split('<checkout-name>/').pop()`, which is wrong anywhere the checkout is
 * not literally named that -- and specifically in a LINKED WORKTREE, whose path is
 * `<repo>/.claude/worktrees/<name>/`. There, splitting on the repo name leaves the worktree prefix
 * on every path, so `areaOf` charged the whole repository to one bogus area and the gate failed with
 * `.claude/worktrees +54` -- 54 pre-existing warnings that had simply been re-bucketed. A gate that
 * cannot run in a worktree is a gate every parallel agent learns to skip.
 */
function relativise(filePath) {
  const normalise = (p) => p.split(/[\\/]/).join('/').replace(/\/+$/, '')
  const abs = normalise(filePath)
  const root = normalise(ROOT) + '/'
  return abs.startsWith(root) ? abs.slice(root.length) : abs
}

function summarise(results) {
  const warnings = new Map()
  const errors = []
  for (const file of results) {
    const rel = relativise(file.filePath)
    const area = areaOf(rel)
    if (file.warningCount > 0) warnings.set(area, (warnings.get(area) ?? 0) + file.warningCount)
    for (const m of file.messages) {
      if (m.severity === 2)
        errors.push(`${rel}:${m.line}:${m.column}  ${m.message}  ${m.ruleId ?? ''}`)
    }
  }
  return { warnings: Object.fromEntries([...warnings].sort()), errors }
}

/** Warning counts per rule, printed alongside the verdict so the backlog is legible, not just big. */
function byRule(results) {
  const counts = new Map()
  for (const file of results) {
    for (const m of file.messages) {
      if (m.severity !== 1) continue
      const id = m.ruleId ?? '(no rule)'
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])
}

/* --------------------------------------------------------------------------------------- main -- */

const results = await runEslint()
const { warnings, errors } = summarise(results)
const total = Object.values(warnings).reduce((s, n) => s + n, 0)

if (UPDATE) {
  const next = {
    _: [
      'GENERATED by `npm run lint:ratchet:update`. Warning counts per area, as a ceiling.',
      'These numbers may only go DOWN. `npm run lint:ratchet` fails if any of them goes up.',
      'Errors are not in this file because errors are never baselined.',
    ],
    warnings,
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  console.log(
    `wrote eslint.baseline.json -- ${total} warning(s) across ${Object.keys(warnings).length} area(s)`,
  )
  for (const [area, n] of Object.entries(warnings))
    console.log(`  ${String(n).padStart(5)}  ${area}`)
  console.log('\nby rule:')
  for (const [rule, n] of byRule(results)) console.log(`  ${String(n).padStart(5)}  ${rule}`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(
    'No eslint.baseline.json. Create it once with `npm run lint:ratchet:update`, commit it, and the\n' +
      'ratchet is live from that point on.',
  )
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).warnings ?? {}
const areas = [...new Set([...Object.keys(baseline), ...Object.keys(warnings)])].sort()

const rows = areas.map((area) => {
  const was = baseline[area] ?? 0
  const now = warnings[area] ?? 0
  return { area, was, now, delta: now - was }
})

const worse = rows.filter((r) => r.delta > 0)
const better = rows.filter((r) => r.delta < 0)

const w = Math.max(4, ...rows.map((r) => r.area.length))
console.log(`${'area'.padEnd(w)}  baseline  current  delta`)
for (const r of rows) {
  const mark = r.delta > 0 ? '  <-- WORSE' : r.delta < 0 ? '  <-- better' : ''
  console.log(
    `${r.area.padEnd(w)}  ${String(r.was).padStart(8)}  ${String(r.now).padStart(7)}  ` +
      `${(r.delta > 0 ? `+${r.delta}` : String(r.delta)).padStart(5)}${mark}`,
  )
}

if (errors.length > 0) {
  console.error(`\n${errors.length} ERROR(S). Errors are never baselined:`)
  for (const e of errors.slice(0, 50)) console.error(`  ${e}`)
  if (errors.length > 50) console.error(`  ... and ${errors.length - 50} more`)
}

if (worse.length > 0) {
  console.error(
    `\nRATCHET FAILED. ${worse.map((r) => `${r.area} +${r.delta}`).join(', ')}.\n` +
      'Fix the new warnings. If the increase is legitimate -- a whole new directory, or a rule you\n' +
      'deliberately turned on -- run `npm run lint:ratchet:update` and say so in the commit message.',
  )
}

if (better.length > 0 && worse.length === 0 && errors.length === 0) {
  console.log(
    `\nRatchet holds, and ${better.reduce((s, r) => s - r.delta, 0)} warning(s) went away. Tighten it:\n` +
      '  npm run lint:ratchet:update',
  )
}

process.exit(worse.length > 0 || errors.length > 0 ? 1 : 0)
