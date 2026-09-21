/**
 * formulas.ts — the tracker's workflow formulas, held to the graph record and to `package.json`.
 *
 * CHECKS. For each formula file named in `FORMULAS` that exists:
 *   1. every `node:<ID>` label on a step names a node in `graph.ts`;
 *   2. every `npm run <script>` that stands on a COMMAND LINE of a step's description (a line that
 *      begins with it) is a `package.json` script;
 *   3. exactly one step is a root (depends on nothing), and every other step is reachable from it
 *      through `depends_on` / `needs`, which may only name steps of the same formula;
 *   4. the root step carries no gate;
 *   5. every gate is `type = "human"`.
 * A `npm run <script>` quoted inside a sentence, naming a script that does not exist, is a NOTE:
 * prose may name a retired script on purpose, and a command line may not.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A formula is one more copy of the graph, written as a checklist
 * somebody pours when a regeneration is due, and nothing reads it until that day. On day one, with
 * no incident of your own yet, this is what it would let through if it were wrong: a step that
 * tells the reader to run a script renamed months ago; a step labelled for a node that was retired;
 * a second root, which the tracker reports as ready beside the first so that two halves of one
 * cycle start at once; a step no dependency reaches, which is ready from the first minute whatever
 * the lane says; a gate on the entry step, which leaves a poured instance with nothing ready and no
 * sign of why; and a gate of a type that needs a watcher nobody runs here (a CI run, a pull
 * request, a timer, mail), which blocks its step until somebody works out that no one is coming. A
 * person can close a `human` gate, so that is the one type with a resolver in every repository.
 * Widen assertion 5 in the same commit that starts running a watcher, and not before.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. That the steps are in the RIGHT order, or that a step says
 * what its node needs: that takes a reader. This is a floor, like the prose check beside it.
 *
 * AN ABSENT FORMULA IS NOT A FAILURE. The kit's formula is kept only by a repository that has a
 * multi-step cycle worth templating, and its own header says to delete it otherwise. An absent
 * file is reported as a note, so the gap is visible; remove its path from `FORMULAS` when the
 * deletion is for good, and the note goes with it.
 *
 * INVOCATION. Imported by `check.ts` (`npm run pipeline:check`) and by `selftest.ts`, which runs it
 * against doctored formulas: `checkFormulas(root, scripts, nodeIds?)`.
 * NEEDS. Nothing beyond the files it reads. The tracker itself is never run, so this holds in CI.
 * The reader below understands the subset of TOML a formula uses (`[[steps]]` tables, a
 * `[steps.gate]` table or an inline `gate = { ... }`, one-line string arrays, `"""` strings) and
 * is not a TOML parser; a formula written outside that subset fails assertion 3 out loud rather
 * than passing quietly, because its steps are not found.
 *
 * kit 3.6-4 · ADAPT: list your own formulas in `FORMULAS`. Add an assertion here when a formula of
 * yours is found wrong in a way none of these five would have caught, with the instance in this
 * header.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NODES } from './graph.ts'

/** Every formula held to the record, repository-relative. */
export const FORMULAS: string[] = ['.beads/formulas/corpus-regen.formula.toml']

export interface FormulaStep {
  id: string
  dependsOn: string[]
  labels: string[]
  /** The gate's `type`, `''` where a gate table declares none, or null where the step has no gate. */
  gate: string | null
  description: string
}

const stringsIn = (list: string): string[] => [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1] as string)

/** The `[[steps]]` tables of one formula, in file order. */
export function readSteps(text: string): FormulaStep[] {
  const steps: FormulaStep[] = []
  let current: FormulaStep | null = null
  let inGate = false
  let multiline: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    if (multiline) {
      const end = line.indexOf('"""')
      if (end === -1) {
        multiline.push(line)
        continue
      }
      multiline.push(line.slice(0, end))
      if (current && !inGate) current.description = multiline.join('\n')
      multiline = null
      continue
    }
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const table = /^\[+\s*([A-Za-z0-9_.-]+)\s*\]+$/.exec(trimmed)
    if (table) {
      if (trimmed.startsWith('[[') && table[1] === 'steps') {
        current = { id: '', dependsOn: [], labels: [], gate: null, description: '' }
        steps.push(current)
        inGate = false
      } else if (table[1] === 'steps.gate' && current) {
        inGate = true
        current.gate = current.gate ?? ''
      } else {
        current = null
        inGate = false
      }
      continue
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(trimmed)
    if (!pair || !current) continue
    const key = pair[1] as string
    const value = pair[2] as string
    if (value.startsWith('"""')) {
      const rest = value.slice(3)
      const end = rest.indexOf('"""')
      if (end === -1) multiline = [rest]
      else if (key === 'description' && !inGate) current.description = rest.slice(0, end)
      continue
    }
    if (inGate) {
      if (key === 'type') current.gate = stringsIn(value)[0] ?? ''
      continue
    }
    if (key === 'id') current.id = stringsIn(value)[0] ?? ''
    else if (key === 'depends_on' || key === 'needs') current.dependsOn.push(...stringsIn(value))
    else if (key === 'labels') current.labels.push(...stringsIn(value))
    else if (key === 'description') current.description = stringsIn(value)[0] ?? ''
    else if (key === 'gate') current.gate = /\btype\s*=\s*"([^"]*)"/.exec(value)?.[1] ?? ''
  }
  return steps
}

const COMMAND_LINE_RE = /^\s*npm run ([A-Za-z0-9][A-Za-z0-9:._-]*)/
const QUOTED_RUN_RE = /npm run ([A-Za-z0-9][A-Za-z0-9:._-]*)/g

export function checkFormulas(
  root: string,
  scripts: Record<string, string>,
  nodeIds: ReadonlySet<string> = new Set(NODES.map((n) => n.id)),
): { problems: string[]; notes: string[] } {
  const problems: string[] = []
  const notes: string[] = []

  for (const file of FORMULAS) {
    const abs = join(root, file)
    if (!existsSync(abs)) {
      notes.push(
        `${file} is absent, so no formula is held to the record. If it was deleted for good, remove` +
          ' its path from FORMULAS in formulas.ts and this note goes with it.',
      )
      continue
    }
    const steps = readSteps(readFileSync(abs, 'utf8'))
    const fail = (msg: string): void => void problems.push(`${file}: ${msg}`)
    if (!steps.length) {
      fail('no `[[steps]]` table was found, so nothing in it can be held to anything')
      continue
    }

    const ids = new Set(steps.map((s) => s.id))
    for (const s of steps) {
      const name = s.id || '(a step with no id)'

      // 1. node labels
      for (const label of s.labels) {
        if (!label.startsWith('node:')) continue
        const id = label.slice('node:'.length)
        if (!nodeIds.has(id)) fail(`step "${name}" is labelled ${label}, which is not a node in graph.ts`)
      }

      // 2. scripts: a command line fails, a quotation is noted
      for (const line of s.description.split('\n')) {
        const command = COMMAND_LINE_RE.exec(line)?.[1]
        if (command !== undefined) {
          if (!(command in scripts)) {
            fail(`step "${name}" tells the reader to run \`npm run ${command}\`, which is not in package.json`)
          }
          continue
        }
        for (const [, quoted] of line.matchAll(QUOTED_RUN_RE)) {
          if (!((quoted as string) in scripts)) {
            notes.push(`${file}: step "${name}" mentions \`npm run ${quoted}\`, which is not in package.json`)
          }
        }
      }

      // 3a. edges name steps of this formula
      for (const d of s.dependsOn) {
        if (!ids.has(d)) fail(`step "${name}" depends on "${d}", which is not a step of this formula`)
      }

      // 5. every gate has a resolver
      if (s.gate !== null && s.gate !== 'human') {
        fail(
          `step "${name}" carries a gate of type "${s.gate}". Only "human" has a resolver here: no` +
            ' watcher runs for any other type, so the step would block until somebody noticed.',
        )
      }
    }

    // 3b. one root, and the lane is connected
    const roots = steps.filter((s) => !s.dependsOn.length)
    if (roots.length !== 1) {
      fail(
        `${roots.length} root steps (${roots.map((s) => s.id).join(', ') || 'none'}); a lane has` +
          ' exactly one entry, and every other step depends on something',
      )
    } else {
      const root0 = roots[0] as FormulaStep
      // 4. the entry is never gated
      if (root0.gate !== null) {
        fail(`the root step "${root0.id}" carries a gate, so a poured instance has nothing ready`)
      }
      const reached = new Set<string>([root0.id])
      let grew = true
      while (grew) {
        grew = false
        for (const s of steps) {
          if (reached.has(s.id)) continue
          if (s.dependsOn.some((d) => reached.has(d))) {
            reached.add(s.id)
            grew = true
          }
        }
      }
      for (const s of steps) {
        if (!reached.has(s.id)) fail(`step "${s.id}" is not reachable from the root "${root0.id}"`)
      }
    }
  }

  return { problems, notes }
}
