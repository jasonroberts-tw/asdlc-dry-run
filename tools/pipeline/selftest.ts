/**
 * selftest.ts — `npm run pipeline:selftest`: the two pipeline gates, the formula check and the
 * sibling-checkout resolver, each watched failing for the reason it exists.
 *
 * CHECKS. It copies the engine (`check.ts`, `stale.ts`, `assess.ts`, `digest.ts`, `glob.ts`,
 * `provenance.ts`, `formulas.ts`, `../lib/estate-root.ts`) under the temp directory beside a
 * SYNTHETIC record of two nodes, breaks ONE thing per case, runs the copy, and asserts the run
 * fails FOR THAT REASON. One undoctored control per group: without it every case could be failing
 * on the copy. The record is synthetic on purpose: the selftest must keep working when your own
 * record changes, and must not need your artifacts to exist.
 *
 * THE FAILURE IT EXISTS TO PREVENT. An assertion nothing has ever watched fail is an assertion on
 * trust. On day one, this is what a wrong gate would let through with every run green: an input
 * glob matching nothing (a constant digest, CURRENT for ever); a `regeneration` node claiming a
 * tier that does not run its check; a file edge nobody declared; a stale node that does not fail
 * `--check`; a sticky timestamp that is not sticky, which turns every `--check` twin of a stamped
 * emitter permanently red; and a `git -C <sibling>` that answers for THIS repository from inside a
 * hook because `GIT_DIR` was still set.
 *
 * INVOCATION. `npm run pipeline:selftest`. Exit 1 when any case does not hold. Seconds: each case
 * of the first two groups starts one Node process.
 *
 * NEEDS. Nothing outside the repository but the temp directory; no tracker, no sibling checkout, no
 * network. The engine derives its root from where it stands, so copying it IS the root override.
 *
 * kit 3.6-4 · ADAPT: group 4 exercises the worked example and skips, saying so, once
 * `example/emit.ts` is gone; delete the group with the example. Add a case here with every
 * assertion you add to `check.ts` or `formulas.ts`.
 */
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitEnv, resolveEstateRoot } from '../lib/estate-root.ts'
import { checkFormulas, FORMULAS } from './formulas.ts'
import { relPosix } from './glob.ts'
import { ROOT } from './provenance.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Where the engine stands, repository-relative (`tools/pipeline`), mirrored in every copy. */
const PIPE = relPosix(ROOT, HERE)
const LIB = `${dirname(PIPE)}/lib`
const FIX = `${dirname(PIPE)}/fixture`
/** The prose page `check.ts` reads. */
const PAGE = 'docs/pipeline.md'
const FORMULA = FORMULAS[0] as string
const ENGINE = ['check.ts', 'stale.ts', 'assess.ts', 'digest.ts', 'glob.ts', 'provenance.ts', 'formulas.ts']

const results: { name: string; ok: boolean; detail: string }[] = []
const record = (name: string, ok: boolean, detail: string): void => void results.push({ name, ok, detail })

/* ------------------------------------------------------------------------------ the fixture ---- */

const FIXTURE_NODES = [
  {
    id: 'F-ROOT',
    kind: 'DERIVED',
    title: 'fixture root',
    prompt: null,
    staleness: 'inputs',
    detection: { via: 'digest', stamp: { path: `${FIX}/root.json`, key: 'provenance' } },
    dependsOn: [],
    inputs: [{ name: 'fixture input', kind: 'files', globs: [`${FIX}/in.json`] }],
    outputs: [`${FIX}/root.json`],
    generator: [`${FIX}/stamp.ts`],
    regenerate: 'npm run fixture:root',
    regenerateScript: 'fixture:root',
    check: null,
    needsEstateCheckout: false,
  },
  {
    id: 'F-LEAF',
    kind: 'DERIVED',
    title: 'fixture leaf',
    prompt: null,
    staleness: 'inputs',
    detection: { via: 'regeneration', script: 'fixture:leaf:check', where: 'CI + pre-push' },
    dependsOn: ['F-ROOT'],
    inputs: [{ name: 'fixture root', kind: 'files', globs: [`${FIX}/root.json`] }],
    outputs: [`${FIX}/leaf.json`],
    generator: [`${FIX}/stamp.ts`],
    regenerate: 'npm run fixture:leaf',
    regenerateScript: 'fixture:leaf',
    check: 'fixture:leaf:check',
    needsEstateCheckout: false,
  },
]

const graphSource = (nodes: unknown): string =>
  [
    'export const STAMP_SOURCES = []',
    `export const NODES = ${JSON.stringify(nodes, null, 2)}`,
    'export const byId = (id) => NODES.find((n) => n.id === id)',
    "export const digestNodes = () => NODES.filter((n) => n.detection.via === 'digest' || n.detection.via === 'legacy-commit')",
    'export const edges = () => NODES.flatMap((n) => [',
    '  ...n.dependsOn.map((d) => ({ from: d, to: n.id, advisory: false })),',
    '  ...(n.advisoryOn ?? []).map((d) => ({ from: d, to: n.id, advisory: true })),',
    '])',
    '',
  ].join('\n')

const FIXTURE_FORMULA = [
  'formula = "corpus-regen"',
  '',
  '[[steps]]',
  'id = "intake"',
  'title = "Intake"',
  'description = """',
  'Name the scope. The old `npm run fixture:root` still exists, so this sentence is no note.',
  '"""',
  '',
  '[[steps]]',
  'id = "regenerate"',
  'title = "Re-run the root"',
  'labels = ["corpus-regen", "node:F-ROOT"]',
  'depends_on = ["intake"]',
  'description = """',
  '  npm run fixture:root',
  '"""',
  '',
  '[[steps]]',
  'id = "review"',
  'title = "A person looks"',
  'needs = ["regenerate"]',
  '[steps.gate]',
  'type = "human"',
  '',
].join('\n')

function write(root: string, rel: string, text: string): void {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, text)
}

/** Rewrite one file of a copy; a doctoring that changes nothing is a broken fixture. */
function edit(root: string, rel: string, transform: (text: string) => string): void {
  const before = readFileSync(join(root, rel), 'utf8')
  const after = transform(before)
  if (after === before) throw new Error(`selftest fixture for ${rel} changed nothing`)
  writeFileSync(join(root, rel), after)
}

const setNodes = (root: string, change: (nodes: typeof FIXTURE_NODES) => void): void => {
  const nodes = structuredClone(FIXTURE_NODES)
  change(nodes)
  write(root, `${PIPE}/graph.ts`, graphSource(nodes))
}

function copyEngine(root: string): void {
  for (const f of ENGINE) write(root, `${PIPE}/${f}`, readFileSync(join(HERE, f), 'utf8'))
  write(root, `${LIB}/estate-root.ts`, readFileSync(join(HERE, '../lib/estate-root.ts'), 'utf8'))
}

function buildPristine(root: string): void {
  copyEngine(root)
  write(root, `${PIPE}/graph.ts`, graphSource(FIXTURE_NODES))
  write(
    root,
    'package.json',
    `${JSON.stringify({ type: 'module', scripts: { 'fixture:root': 'x', 'fixture:leaf': 'x', 'fixture:leaf:check': 'x' } }, null, 2)}\n`,
  )
  write(root, 'lefthook.yml', 'pre-push:\n  jobs:\n    - name: leaf\n      run: node --run fixture:leaf:check\n')
  write(root, '.github/workflows/verify.yml', 'jobs:\n  verify:\n    steps:\n      - run: npm run fixture:leaf:check\n')
  write(root, PAGE, '# Fixture\n\n```mermaid\nflowchart LR\n  A["F-ROOT<br/>root"] --> B["F-LEAF"]\n```\n\nF-ROOT and F-LEAF.\n')
  write(root, FORMULA, FIXTURE_FORMULA)
  write(root, `${FIX}/in.json`, '{ "n": 1 }\n')
  write(root, `${FIX}/root.json`, '{}\n')
  write(root, `${FIX}/leaf.json`, '{}\n')
  write(
    root,
    `${FIX}/stamp.ts`,
    [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      `import { ROOT, stampFor } from '../${PIPE.split('/').pop()}/provenance.ts'`,
      `writeFileSync(join(ROOT, '${FIX}/root.json'), JSON.stringify({ provenance: stampFor('F-ROOT') }, null, 2) + '\\n')`,
      '',
    ].join('\n'),
  )
}

const run = (root: string, rel: string, ...args: string[]): { status: number; out: string } => {
  const r = spawnSync(process.execPath, [join(root, rel), ...args], { encoding: 'utf8', env: gitEnv() })
  return { status: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` }
}

const base = mkdtempSync(join(tmpdir(), 'pipeline-selftest-'))
let copies = 0
const pristine = join(base, 'pristine')
const freshCopy = (): string => {
  const dir = join(base, `copy-${++copies}`)
  cpSync(pristine, dir, { recursive: true })
  return dir
}

try {
  buildPristine(pristine)

  /* ---------------------------------------------------------------------- 1. check.ts ---------- */

  const checkCases: { name: string; doctor: (root: string) => void; expect: RegExp | 'pass' }[] = [
    { name: 'check control: the undoctored record passes', doctor: () => {}, expect: 'pass' },
    {
      name: 'check: a node id missing from the prose page',
      doctor: (r) => edit(r, PAGE, (t) => t.replace('F-ROOT and F-LEAF.', 'F-ROOT alone.').replace('["F-LEAF"]', '["leaf"]')),
      expect: /F-LEAF: is not mentioned anywhere in/,
    },
    {
      name: 'check: the diagram draws a node the record does not have',
      doctor: (r) => edit(r, PAGE, (t) => t.replace('["F-LEAF"]', '["F-LEAF"] --> C["F-GONE<br/>retired"]')),
      expect: /mermaid: draws "F-GONE"/,
    },
    {
      name: 'check: an input group that matches no file',
      doctor: (r) => rmSync(join(r, `${FIX}/in.json`)),
      expect: /F-ROOT: input group "fixture input" matches no file/,
    },
    {
      name: 'check: a generator glob that matches no file',
      doctor: (r) => setNodes(r, (n) => void ((n[1] as (typeof n)[number]).generator = [`${FIX}/moved.ts`])),
      expect: /F-LEAF: generator glob matches no file/,
    },
    {
      name: 'check: a script the record names is not in package.json',
      doctor: (r) => edit(r, 'package.json', (t) => t.replace('"fixture:root": "x",', '')),
      expect: /F-ROOT: regenerateScript "fixture:root" is not in package\.json/,
    },
    {
      name: 'check: a regeneration node claims a tier that does not run its check',
      doctor: (r) => edit(r, 'lefthook.yml', (t) => t.replace('run: node --run fixture:leaf:check', 'run: node --run fixture:other')),
      expect: /F-LEAF: declares `fixture:leaf:check` runs in "CI \+ pre-push"; it actually runs in "CI"/,
    },
    {
      name: 'check: a script named only in a comment runs nowhere',
      doctor: (r) => {
        edit(r, 'lefthook.yml', (t) => t.replace('      run: node --run fixture:leaf:check', '      # node --run fixture:leaf:check\n      run: node --run fixture:other'))
        edit(r, '.github/workflows/verify.yml', (t) => t.replace('- run: npm run fixture:leaf:check', '- run: npm run fixture:other'))
      },
      expect: /F-LEAF: claims its staleness is covered by `npm run fixture:leaf:check`, but that script runs in neither/,
    },
    {
      name: 'check: an edge to a node that does not exist',
      doctor: (r) => setNodes(r, (n) => void (n[1] as (typeof n)[number]).dependsOn.push('F-NOPE')),
      expect: /F-LEAF: depends on "F-NOPE", which is not a node/,
    },
    {
      name: 'check: a cycle over blocking edges',
      doctor: (r) => setNodes(r, (n) => void (n[0] as (typeof n)[number]).dependsOn.push('F-LEAF')),
      expect: /cycle: F-ROOT -> F-LEAF -> F-ROOT/,
    },
    {
      name: 'check: a file edge nobody declared',
      doctor: (r) => setNodes(r, (n) => void ((n[1] as (typeof n)[number]).dependsOn = [])),
      expect: /F-LEAF: digests 1 file\(s\) emitted by F-ROOT/,
    },
    {
      name: 'check: a stamp outside the node\'s own outputs',
      doctor: (r) =>
        setNodes(r, (n) => {
          ;(n[0] as (typeof n)[number]).detection = { via: 'digest', stamp: { path: `${FIX}/leaf.json`, key: 'provenance' } }
        }),
      expect: /F-ROOT: stamps \S+leaf\.json, which none of its declared outputs matches/,
    },
    {
      name: 'check: a prompt that names no file',
      doctor: (r) => setNodes(r, (n) => void ((n[0] as { prompt: string | null }).prompt = 'gone-prompt.md')),
      expect: /F-ROOT: names prompt "gone-prompt\.md", which does not exist/,
    },
    {
      name: 'check: a formula step labelled for a node that is gone',
      doctor: (r) => edit(r, FORMULA, (t) => t.replace('node:F-ROOT', 'node:F-GONE')),
      expect: /step "regenerate" is labelled node:F-GONE, which is not a node/,
    },
    {
      name: 'check: an absent formula is a note, not a failure',
      doctor: (r) => rmSync(join(r, FORMULA)),
      expect: 'pass',
    },
  ]

  for (const c of checkCases) {
    const root = freshCopy()
    c.doctor(root)
    const { status, out } = run(root, `${PIPE}/check.ts`)
    if (c.expect === 'pass') record(c.name, status === 0, status === 0 ? 'passes' : `exit ${status}: ${out.trim()}`)
    else {
      const ok = status === 1 && c.expect.test(out)
      record(c.name, ok, ok ? 'fails for that reason' : status === 0 ? 'PASSED, but should have failed' : `failed, but not for that reason: ${out.trim()}`)
    }
  }

  /* ---------------------------------------------------------------------- 2. stale.ts ---------- */

  {
    const root = freshCopy()
    const stale = (...args: string[]): { status: number; out: string } => run(root, `${PIPE}/stale.ts`, ...args)
    const step = (name: string, r: { status: number; out: string }, status: number, expect: RegExp): void => {
      const ok = r.status === status && expect.test(r.out)
      record(name, ok, ok ? 'holds' : `exit ${r.status}, wanted ${status} and ${expect}: ${r.out.trim()}`)
    }

    step('stale: an output with no stamp is reported and does not fail', stale('--check'), 0, /UNSTAMPED\s+F-ROOT/)
    step('stale: a regeneration node is named with its check under --verbose', stale('--verbose'), 0, /F-LEAF\s+covered by `npm run fixture:leaf:check`/)

    run(root, `${FIX}/stamp.ts`)
    const first = readFileSync(join(root, `${FIX}/root.json`), 'utf8')
    step('stale control: a freshly stamped node is current', stale('--check'), 0, /OK\s+F-ROOT/)

    // The sticky timestamp: a second run one second later must not move a byte.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100)
    run(root, `${FIX}/stamp.ts`)
    const second = readFileSync(join(root, `${FIX}/root.json`), 'utf8')
    record('stale: two runs over unchanged inputs write identical bytes', first === second && /generatedAtUtc/.test(first), first === second ? 'holds' : 'the second run moved the stamp')

    write(root, `${FIX}/in.json`, '{ "n": 2 }\n')
    step('stale: a moved input fails --check and is named by its group', stale('--check'), 1, /F-ROOT -- fixture input/)
    step('stale: the same report without --check exits 0', stale(), 0, /STALE\s+F-ROOT/)

    run(root, `${FIX}/stamp.ts`)
    appendFileSync(join(root, `${FIX}/stamp.ts`), '// a code change is an input too\n')
    step('stale: a moved generator fails --check and says so', stale('--check'), 1, /F-ROOT -- generator source/)

    rmSync(join(root, `${FIX}/root.json`))
    step('stale: an absent output is reported and does not fail', stale('--check'), 0, /ABSENT\s+F-ROOT/)
  }

  /* ---------------------------------------------------------------------- 3. formulas.ts ------- */

  {
    const scripts = { 'fixture:root': 'x' }
    const ids = new Set(['F-ROOT', 'F-LEAF'])
    const formulaCases: { name: string; doctor: (t: string) => string; problem: RegExp | null; note?: RegExp }[] = [
      { name: 'formula control: the undoctored formula passes', doctor: (t) => t, problem: null },
      {
        name: 'formula: a command line names a script that is gone',
        doctor: (t) => t.replace('  npm run fixture:root', '  npm run fixture:renamed'),
        problem: /step "regenerate" tells the reader to run `npm run fixture:renamed`/,
      },
      {
        name: 'formula: a sentence naming a script that is gone is a note',
        doctor: (t) => t.replace('The old `npm run fixture:root`', 'The old `npm run fixture:retired`'),
        problem: null,
        note: /step "intake" mentions `npm run fixture:retired`/,
      },
      {
        name: 'formula: a second root',
        doctor: (t) => t.replace('depends_on = ["intake"]\n', ''),
        problem: /2 root steps \(intake, regenerate\)/,
      },
      {
        name: 'formula: a step depends on a step that is not there',
        doctor: (t) => t.replace('needs = ["regenerate"]', 'needs = ["cascade"]'),
        problem: /step "review" depends on "cascade", which is not a step of this formula/,
      },
      {
        name: 'formula: steps that only reach each other',
        doctor: (t) => t.replace('depends_on = ["intake"]', 'depends_on = ["review"]'),
        problem: /step "regenerate" is not reachable from the root "intake"/,
      },
      {
        name: 'formula: a gate on the root step',
        doctor: (t) => t.replace('title = "Intake"', 'title = "Intake"\ngate = { type = "human" }'),
        problem: /the root step "intake" carries a gate/,
      },
      {
        name: 'formula: a gate nobody here can resolve',
        doctor: (t) => t.replace('type = "human"', 'type = "timer"'),
        problem: /step "review" carries a gate of type "timer"/,
      },
      {
        name: 'formula: a file with no steps',
        doctor: () => 'formula = "corpus-regen"\n',
        problem: /no `\[\[steps\]\]` table was found/,
      },
    ]
    for (const c of formulaCases) {
      const root = join(base, `formula-${++copies}`)
      const text = c.doctor(FIXTURE_FORMULA)
      if (c.problem !== null && text === FIXTURE_FORMULA) throw new Error(`selftest fixture for "${c.name}" changed nothing`)
      write(root, FORMULA, text)
      const { problems, notes } = checkFormulas(root, scripts, ids)
      const ok =
        (c.problem === null ? problems.length === 0 : problems.some((p) => (c.problem as RegExp).test(p))) &&
        (c.note ? notes.some((n) => (c.note as RegExp).test(n)) : true)
      record(c.name, ok, ok ? 'holds' : `problems: ${problems.join(' | ') || 'none'}; notes: ${notes.join(' | ') || 'none'}`)
    }
    const absent = checkFormulas(join(base, 'no-formula'), scripts, ids)
    record(
      'formula: an absent file is a note and no problem',
      absent.problems.length === 0 && absent.notes.some((n) => /is absent/.test(n)),
      `problems: ${absent.problems.length}, notes: ${absent.notes.length}`,
    )
  }

  /* ---------------------------------------------------------------------- 4. the worked example */

  if (!existsSync(join(HERE, 'example/emit.ts'))) {
    console.log('  --   the worked example is gone (example/emit.ts): group 4 skipped; delete it from selftest.ts')
  } else {
    const root = join(base, 'example')
    copyEngine(root)
    write(root, `${PIPE}/graph.ts`, readFileSync(join(HERE, 'graph.ts'), 'utf8'))
    cpSync(join(HERE, 'example'), join(root, PIPE, 'example'), { recursive: true })
    const emit = (...args: string[]): { status: number; out: string } => run(root, `${PIPE}/example/emit.ts`, ...args)
    const stale = (): { status: number; out: string } => run(root, `${PIPE}/stale.ts`, '--check')

    emit()
    const a = emit('--check')
    const b = stale()
    record('example control: after a run, its --check and the staleness gate agree it is current', a.status === 0 && b.status === 0 && /OK\s+X-EXAMPLE/.test(b.out), `--check exit ${a.status}; stale exit ${b.status}`)

    edit(root, `${PIPE}/example/entries.json`, (t) => t.replace('"legacy"', '"migrated"'))
    const c = emit('--check')
    const d = stale()
    record('example: an edited input fails its --check', c.status === 1 && /differs from what emit\.ts would write/.test(c.out), `exit ${c.status}`)
    record('example: and the staleness gate names the group that moved', d.status === 1 && /X-EXAMPLE -- example entries/.test(d.out), `exit ${d.status}`)
    const before = readFileSync(join(root, PIPE, 'example/summary.json'), 'utf8')
    emit('--check')
    record('example: --check writes nothing', before === readFileSync(join(root, PIPE, 'example/summary.json'), 'utf8'), 'summary.json compared before and after')
  }

  /* ---------------------------------------------------------------------- 5. estate-root.ts ---- */

  {
    const saved = { dir: process.env['GIT_DIR'], root: process.env['ESTATE_ROOT'] }
    process.env['GIT_DIR'] = join(base, 'not-a-git-dir')
    const leaked = Object.keys(gitEnv()).filter((k) => k.startsWith('GIT_'))
    record('estate-root: gitEnv() carries no GIT_* key out of a hook', leaked.length === 0, leaked.join(', ') || 'none leaked')
    if (saved.dir === undefined) delete process.env['GIT_DIR']
    else process.env['GIT_DIR'] = saved.dir

    process.env['ESTATE_ROOT'] = join(base, 'elsewhere')
    record('estate-root: ESTATE_ROOT overrides the sibling path', resolveEstateRoot(base) === resolve(base, 'elsewhere'), resolveEstateRoot(base))
    delete process.env['ESTATE_ROOT']
    record('estate-root: outside a repository, the sibling is resolved beside the directory asked about', resolveEstateRoot(base) === resolve(base, '..', 'estate'), resolveEstateRoot(base))
    if (saved.root !== undefined) process.env['ESTATE_ROOT'] = saved.root
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name} -- ${r.detail}`)
console.log(`pipeline selftest: ${results.length - failed.length}/${results.length} cases hold.`)
process.exit(failed.length === 0 ? 0 : 1)
