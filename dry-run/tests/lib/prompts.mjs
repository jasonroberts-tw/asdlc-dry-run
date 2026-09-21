/**
 * prompts.mjs — what every validator under `dry-run/tests/` shares: where the workflow's prompts
 * are, how a prompt's frontmatter and headings are read, and how a validator reports.
 *
 * WHAT IT READS. The `dry-run` workflow's prompts, in either layout the workflow can have:
 *   plain    the skill `dry-run` and every skill named `dry-run-…` under `.claude/skills/`,
 *            and every agent named `dry-run-….md` under `.claude/agents/`
 *   plugin   every skill under `dry-run/skills/` and every agent under `dry-run/agents/`
 * and, for every skill, the `references/*.md` beside its `SKILL.md`. Both layouts are read so that
 * moving the workflow into a plugin directory (`dry-run/README.md` § Becoming a plugin) moves no test.
 *
 * THE FAILURE IT EXISTS TO PREVENT. Each validator finding its own prompts is each validator free
 * to find none: a glob that stops matching after a rename leaves a validator asserting over an
 * empty list, green. `prompts()` throws when it finds no entry skill, no contract page or no agent,
 * so a validator cannot pass by looking in the wrong place.
 *
 * THE REPORTING CONTRACT, which `run-tests.mjs` reads:
 *   exit 0                      pass
 *   exit 0 and a `SKIP:` line   skip; allowed ONLY through `optionalDependency()` below
 *   any other exit, or a timeout  fail
 *   `SUMMARY:` lines            echoed by the runner under the test's name
 *
 * ROOT OVERRIDE. `WORKFLOW_ROOT` names a doctored copy of the repository; `refusals.test.mjs` uses
 * it to prove each validator fails for its own reason.
 *
 * NEEDS. Node 22.18 or newer. Nothing installed.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKFLOW = 'dry-run'
export const WORKFLOW_DIR = 'dry-run/'
export const POLICY_FILE = 'dry-run/workflow-policy.json'
/** The first line of every substantial skill and agent (`CLAUDE.md` § Standing rules for prompts and gates). */
export const FIRST_LINE = 'Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it.'

const here = dirname(fileURLToPath(import.meta.url))
// This file sits at `dry-run/tests/lib/`: two levels for tests/lib, one per segment of the workflow directory.
const up = Array(WORKFLOW_DIR.split('/').filter(Boolean).length + 2).fill('..')
export const ROOT = resolve(process.env.WORKFLOW_ROOT || join(here, ...up))

export const abs = (rel) => join(ROOT, rel)
export const exists = (rel) => existsSync(abs(rel))
export const read = (rel) => readFileSync(abs(rel), 'utf8')

const isDir = (rel) => exists(rel) && statSync(abs(rel)).isDirectory()
const list = (rel) => (isDir(rel) ? readdirSync(abs(rel)).sort() : [])

/**
 * Frontmatter, read strictly. The harness accepts more YAML than this; a prompt here uses only
 * `key: scalar`, `key: [a, b]` and `key:` followed by `  - item` lines, and anything else is
 * reported as a shape error rather than half-read.
 */
export function parseFrontmatter(text) {
  const lines = text.split('\n')
  const errors = []
  if (lines[0] !== '---') return { data: {}, body: text, bodyStartsAt: 1, errors: ['the file does not open with a `---` frontmatter fence'] }
  const close = lines.indexOf('---', 1)
  if (close < 0) return { data: {}, body: '', bodyStartsAt: 1, errors: ['the frontmatter fence is never closed'] }
  const data = {}
  let listKey = null
  for (let i = 1; i < close; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const item = /^\s+-\s+(.+?)\s*$/.exec(line)
    if (item && listKey) {
      data[listKey].push(item[1])
      continue
    }
    const kv = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*?)\s*$/.exec(line)
    if (!kv) {
      errors.push(`frontmatter line ${i + 1} is neither \`key: value\` nor a list item: ${line.trim()}`)
      continue
    }
    const [, key, raw] = kv
    if (key in data) errors.push(`frontmatter key \`${key}\` is written twice`)
    listKey = null
    if (raw === '') {
      data[key] = []
      listKey = key
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    } else if (raw === 'true' || raw === 'false') data[key] = raw === 'true'
    else data[key] = raw.replace(/^(['"])(.*)\1$/, '$2')
  }
  return { data, body: lines.slice(close + 1).join('\n'), bodyStartsAt: close + 2, errors }
}

/** Every heading outside a code fence: { level, text, line } with 1-based lines of `text`. */
export function headings(text) {
  const out = []
  let fenced = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) return
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 })
  })
  return out
}

/** The rows of the first markdown table under the heading `title`: arrays of trimmed cells, header and rule dropped. */
export function tableUnder(text, title) {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#{1,6}\s+/, '').trim() === title)
  if (at < 0) return null
  const rows = []
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break
    if (!lines[i].trim().startsWith('|')) {
      if (rows.length) break
      continue
    }
    rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  }
  return rows.filter((r, i) => i > 0 && !r.every((c) => /^:?-+:?$/.test(c)))
}

function prompt(path, kind, skill = null) {
  const text = read(path)
  const fm = kind === 'reference' ? { data: {}, body: text, bodyStartsAt: 1, errors: [] } : parseFrontmatter(text)
  return { path, kind, skill, text, frontmatter: fm.data, frontmatterErrors: fm.errors, body: fm.body }
}

/** Every prompt of the workflow: kind `skill`, `agent` or `reference` (a reference has no frontmatter). */
export function prompts() {
  const out = []
  const skillDirs = [
    ...list('.claude/skills').filter((n) => n === WORKFLOW || n.startsWith(`${WORKFLOW}-`)).map((n) => `.claude/skills/${n}`),
    ...list(`${WORKFLOW_DIR}skills`).map((n) => `${WORKFLOW_DIR}skills/${n}`),
  ]
  for (const dir of skillDirs) {
    if (!exists(`${dir}/SKILL.md`)) continue
    const name = dir.split('/').pop()
    out.push(prompt(`${dir}/SKILL.md`, 'skill', name))
    for (const ref of list(`${dir}/references`)) if (ref.endsWith('.md')) out.push(prompt(`${dir}/references/${ref}`, 'reference', name))
  }
  const agentFiles = [
    ...list('.claude/agents').filter((n) => n.startsWith(`${WORKFLOW}-`) && n.endsWith('.md')).map((n) => `.claude/agents/${n}`),
    ...list(`${WORKFLOW_DIR}agents`).filter((n) => n.endsWith('.md')).map((n) => `${WORKFLOW_DIR}agents/${n}`),
  ]
  for (const file of agentFiles) out.push(prompt(file, 'agent'))

  const need = [
    ['the entry skill', out.some((p) => p.kind === 'skill' && p.skill === WORKFLOW)],
    ['the contract page', out.some((p) => p.kind === 'skill' && p.skill === `${WORKFLOW}-contract`)],
    ['an agent', out.some((p) => p.kind === 'agent')],
  ]
  const lost = need.filter(([, found]) => !found).map(([what]) => what)
  if (lost.length) throw new Error(`prompts(): found no ${lost.join(', no ')} under ${ROOT}; a validator that reads nothing passes nothing`)
  return out
}

export const entrySkill = () => prompts().find((p) => p.kind === 'skill' && p.skill === WORKFLOW)
export const contractPage = () => prompts().find((p) => p.kind === 'skill' && p.skill === `${WORKFLOW}-contract`)
export const lifecycle = () => prompts().find((p) => p.kind === 'reference' && p.path.endsWith('/references/lifecycle.md'))

/** Every skill the harness could load here, by name: the repository's and the workflow's own. */
export const skillNames = () => [...new Set([...list('.claude/skills'), ...list(`${WORKFLOW_DIR}skills`)])].filter((n) => exists(`.claude/skills/${n}/SKILL.md`) || exists(`${WORKFLOW_DIR}skills/${n}/SKILL.md`))

export const policy = () => JSON.parse(read(POLICY_FILE))

/** Every file under `rel`, repository-relative, sorted; `node_modules` and dot-directories are not walked. */
export function walk(rel) {
  const out = []
  for (const name of list(rel)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = `${rel.replace(/\/$/, '')}/${name}`
    if (isDir(p)) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/**
 * THE SKIP RULE, in one place. A validator may skip only for an OPTIONAL dependency that is ABSENT:
 * this probes `command` and returns its path, or prints `SKIP:` by name and exits 0. It never looks
 * at what the dependency does once found, so a found dependency that fails reaches the validator's
 * own assertions and is a failure. There is no other way to skip: the runner counts a `SKIP:` line
 * from a test that then fails as a failure.
 */
export function optionalDependency(command, why) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 20000 })
  if (probe.error && probe.error.code === 'ENOENT') {
    console.log(`SKIP: ${command} is not installed; ${why}`)
    process.exit(0)
  }
  return command
}

/**
 * A validator's checks: `ok(label, condition, detail)` per assertion, `done()` last. `failed()` is
 * the count so far: a validator with an optional half calls `done()` first when it is not zero,
 * because a skip exits 0 and would take the failures already found with it.
 */
export function suite(name) {
  let passed = 0
  const failures = []
  return {
    failed: () => failures.length,
    ok(label, condition, detail = '') {
      if (condition) passed++
      else failures.push(detail ? `${label}\n      ${String(detail).split('\n').join('\n      ')}` : label)
    },
    done() {
      for (const f of failures) console.log(`  FAILED: ${f}`)
      console.log(`SUMMARY: ${name}: ${passed} passed, ${failures.length} failed`)
      process.exit(failures.length ? 1 : 0)
    },
  }
}
