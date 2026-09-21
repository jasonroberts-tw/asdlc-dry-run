/**
 * named-tools.test.mjs — every tool, file and script a prompt names exists.
 *
 * CHECKS, over every backticked span of every prompt (adaptation comments included):
 *   - a path under `dry-run/`, `.claude/`, `scripts/` or `tools/` exists;
 *   - a bare tool file name (`Some-Tool.ps1`, `check.mjs`) is a file somewhere under `dry-run/`;
 *   - `npm run <script>` names a script `package.json` defines.
 * A span carrying an `<angle-bracket>` variable or a `*` is a pattern, not a name, and is not
 * checked. And over the contract page's References table: every row is three non-empty cells
 * (the reference, who opens it, when), every reference that is a committed file exists, and every
 * file under the contract's `references/` has a row.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A prompt that names a tool that was renamed does not fail: the
 * agent reading it looks, does not find it, and improvises the step. That is the most expensive
 * way to learn of a rename. A reference file with no row in the table is one no step points to,
 * which is procedure nobody opens.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/named-tools.test.mjs`.
 * NEEDS. Nothing installed. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { basename } from 'node:path'
import { WORKFLOW, WORKFLOW_DIR, contractPage, exists, prompts, read, suite, tableUnder, walk } from './lib/prompts.mjs'

const PATH_ROOTS = [WORKFLOW_DIR, '.claude/', 'scripts/', 'tools/']
const TOOL_FILE = /^[A-Za-z0-9._-]+\.(ps1|mjs|cjs|js|ts|sh|py)$/
const RUN_DIR = '.dry-run/run/<item>/'

const t = suite('named-tools')
const scripts = exists('package.json') ? (JSON.parse(read('package.json')).scripts ?? {}) : {}
const toolNames = new Set(walk(WORKFLOW_DIR).map((f) => basename(f)))

for (const p of prompts()) {
  const spans = [...p.text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim())
  for (const span of new Set(spans)) {
    const run = /^npm run ([^\s]+)/.exec(span)
    if (run) {
      if (!/[<*]/.test(run[1])) t.ok(`${p.path}: \`npm run ${run[1]}\` is a script of package.json`, run[1] in scripts)
      continue
    }
    if (/[<*\s]/.test(span)) continue
    if (PATH_ROOTS.some((r) => span.startsWith(r))) t.ok(`${p.path}: \`${span}\` exists`, exists(span.replace(/\/$/, '')))
    else if (TOOL_FILE.test(span)) t.ok(`${p.path}: the tool \`${span}\` is a file under ${WORKFLOW_DIR}`, toolNames.has(span))
  }
}

const contract = contractPage()
const rows = tableUnder(contract.text, 'References')
t.ok(`${contract.path}: "References" holds a table`, Array.isArray(rows) && rows.length > 0)
const listed = new Set()
for (const row of rows ?? []) {
  t.ok(`${contract.path}: the row for ${row[0]} names the reference, who opens it and when`, row.length === 3 && row.every((c) => c.length > 0), row.join(' | '))
  const path = /^`([^`]+)`$/.exec(row[0] ?? '')?.[1]
  t.ok(`${contract.path}: the reference ${row[0]} is one backticked path`, Boolean(path))
  if (!path) continue
  listed.add(path)
  // The facts file is written per run, under a directory git ignores: it is a row, never a committed file.
  if (!path.startsWith(RUN_DIR)) t.ok(`${contract.path}: the reference \`${path}\` exists`, exists(path))
}
for (const p of prompts().filter((x) => x.kind === 'reference' && x.skill === `${WORKFLOW}-contract`)) {
  t.ok(`${p.path} has a row in the contract's References table`, listed.has(p.path), 'a reference no row names is procedure no step points to')
}
t.done()
