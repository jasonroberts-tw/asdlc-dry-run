/**
 * Job-to-script cross-check gate: the hooks and CI invoke only scripts that exist, and every script
 * they do not invoke is of a kind this file declares.
 *
 *   npm run check:jobs             the gate; prints the re-derived breakdown on every run
 *   npm run check:jobs:selftest    its fixtures -- every assertion exercised on a doctored copy
 *
 * THE JOB THIS EXISTS FOR. A `package.json` script is a public name and nothing gates its citations
 * (the add-npm-script skill opens with that sentence). Two failures follow, and both
 * have happened here. A job names a script that was renamed or deleted: the hook or the CI step then
 * fails on the next push for a reason unrelated to the change being pushed, which is how a gate gets
 * passed with `--no-verify`. And a gate-shaped script is defined and invoked by NOTHING: a
 * selftest sat in `package.json` with no job in either file, a regression suite that reported the
 * past, and a `:check` went red for six weeks before anything wired it. The same cross-check, run
 * by hand and quoted in a note, was found false at the next verification. A cross-check quoted in
 * a note measures one commit. This is the gate.
 *
 * WHAT FAILS THE JOB:
 *   1. an `npm run <name>` or `node --run <name>` token in a `run:` of `lefthook.yml` or
 *      `.github/workflows/verify.yml` whose <name> is not a `package.json` script (the hook launches
 *      through `node --run`, CI through `npm run`; both name the same script).
 *      Comment lines are not read -- both files quote scripts they deliberately do NOT run -- and a
 *      multi-line `run: |` block is.
 *   2. a `package.json` script with no `run:` token in either file that `UNJOBBED_BY_KIND` below
 *      does not declare. A gate-shaped one (`check:*`, `*:check`, `*:selftest`, `*:selfcheck`) is
 *      reported as "wire it, or name the exception with its reason"; anything else as "declare its
 *      kind". Either way a new un-jobbed script fails on arrival rather than joining the list.
 *   3. an `UNJOBBED_BY_KIND` entry that names no script, names one twice, names one that HAS a job
 *      (a stale exception is a hole in the gate -- `check-register-status.mjs`'s allowlist rule), or
 *      names one whose spelling contradicts the kind's shape.
 *   4. a script whose command names a `tools/`, `scripts/` or `migration/` path that does not exist
 *      on disk.
 *
 * WHAT IS NOT CHECKED, deliberately: WHERE a jobbed script runs (pre-push, CI or both) -- that is
 * `pipeline:check`'s question for the graph's regeneration nodes and the README's Gate column for
 * the rest; whether a job's OTHER commands (`git diff`, `npx prettier`, `bd hooks run`) resolve; and
 * the `pre-commit` jobs' `{staged_files}` templates.
 *
 * NEGATIVE TESTING. `--selftest` copies the three files under `os.tmpdir()` and doctors ONE thing
 * per case, asserting the run fails FOR THAT REASON -- plus a control that the undoctored copy
 * passes, without which every other case could be failing on the copy. Path existence is resolved
 * against the real tree in every case, since a copy of three files has no `tools/`. By hand, point
 * `CHECK_JOBS_ROOT` at a copy, as `check-register-status.mjs` does with `CHECK_REGISTER_ROOT`.
 *
 * Reads only committed files; no `../estate` checkout, no network, milliseconds. `pre-push` and
 * CI both, by the add-npm-script skill's step on where a gate runs.
 */
import {
  copyFileSync,
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
import { load as yamlLoad } from 'js-yaml'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = process.env.CHECK_JOBS_ROOT ?? REPO_ROOT

const PACKAGE = 'package.json'
const LEFTHOOK = 'lefthook.yml'
const VERIFY = '.github/workflows/verify.yml'
const JOB_FILES = [LEFTHOOK, VERIFY]

/**
 * An invocation token inside a `run:` string: group 1 the launcher, group 2 the script. `npm run` is
 * CI's spelling and `--silent` is how `scripts/hooks/_shared.mjs` spells it; `node --run` is the
 * pre-push hook's (node_modules/.bin on PATH, no npm start-up -- measured at
 * 2.1-3.1s for `npm run` against 0.9-1.2s for `node --run` on the owner's Windows host).
 */
const NPM_RUN_RE = /\b(npm run|node --run) (?:--silent )?([A-Za-z0-9][A-Za-z0-9:._-]*)/g
/** The spellings this repository gives a gate: `check:<noun>`, and the `:check` / `:selftest` / `:selfcheck` twins. */
const GATE_SHAPED_RE = /^check:|:(?:check|selftest|selfcheck)$/
/**
 * A repo-relative `tools/`, `scripts/` or `migration/` path on a script's command line. `migration/`
 * joined with D-38: `migration:test` names the plugin's test runner there, and a moved or misspelled
 * runner would otherwise pass this gate and fail at the next push.
 */
const REPO_PATH_RE = /(?:^|\s)((?:tools|scripts|migration)\/[^\s"'&|;]+)/g

/**
 * Every script that has no job, BY KIND, each kind with the reason its members are ungated. A name
 * here is a claim about `package.json` and the two job files together, and assertion 3 holds every
 * claim: the script exists, no job runs it, and its spelling fits the kind. So the list cannot go
 * stale silently in either direction -- wire a listed script and its entry must go; retire one and
 * its entry must go; add an un-jobbed script and an entry must come.
 *
 * `shape` is a regex the kind's names must match, where the kind HAS a mechanical shape. Bare
 * emitters do not (`captures:recover`, `outcomes`), so that kind is a list and nothing more.
 */
const UNJOBBED_BY_KIND = [
  {
    kind: 'bare emitter or operator command',
    why:
      'writes an artifact or drives an operator procedure. Where it has a `:check` twin, the twin is' +
      ' the gate and the job runs that.',
    names: [
      'worktree:gc',
      'outcomes',
      'outcomes:propose',
      'pipeline:example',
      'pipeline:stale',
    ],
  },
  {
    kind: ':update baseline',
    shape: /:update$/,
    why: 'rewrites a ratchet or golden; a job that ran it would move the baseline it is meant to hold.',
    names: [],
  },
  {
    kind: 'lint and format',
    shape: /^(?:lint|format)(?::|$)/,
    why: 'the whole-repository and `--fix` forms; the jobbed forms are the ones a hook or CI runs.',
    names: [],
  },
  {
    kind: 'check that reads a sibling checkout',
    shape: /:check$/,
    why:
      'CI does not clone the sibling checkout, and a `--check` there would compare a real artifact' +
      ' against one with every source-derived signal zeroed.',
    names: [],
  },
  {
    kind: 'named exception',
    why: 'gate-shaped, or shaped like nothing above, and ungated for its own reason, each stated.',
    names: [
      {
        name: 'gates',
        why: 'the suite itself (`lefthook run pre-push --force`); a job invoking it would recurse.',
      },
    ],
  },
]

const entryName = (entry) => (typeof entry === 'string' ? entry : entry.name)

/** Lines of a `run:` string that are not YAML-block comments. */
function withoutComments(run) {
  return run
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

/**
 * Every `run:` string in a job file, with a label for the failure message. lefthook.yml is
 * `<hook>: { jobs: [{ name, run }] }`; verify.yml is `jobs: { <job>: { steps: [{ name, run }] } }`.
 */
function runBlocks(file, doc) {
  const blocks = []
  if (file === LEFTHOOK) {
    for (const [hook, spec] of Object.entries(doc ?? {})) {
      if (!Array.isArray(spec?.jobs)) continue
      for (const job of spec.jobs) {
        if (typeof job?.run !== 'string') continue
        blocks.push({ where: `${file} ${hook}/${job.name ?? '(unnamed)'}`, run: job.run })
      }
    }
    return blocks
  }
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    const steps = Array.isArray(job?.steps) ? job.steps : []
    steps.forEach((step, index) => {
      if (typeof step?.run !== 'string') return
      blocks.push({
        where: `${file} ${jobName}/${step.name ?? `step ${index + 1}`}`,
        run: step.run,
      })
    })
  }
  return blocks
}

/**
 * Run every assertion against the tree at `root`. Returns the failures and the breakdown rather
 * than exiting, so the selftest can run it against doctored copies. `pathsRoot` is where assertion
 * 4 looks for the named files -- the real tree, when `root` is a three-file copy.
 */
export function runCheck(root, { pathsRoot = root } = {}) {
  const failures = []
  const fail = (message) => failures.push(message)

  const pkgPath = join(root, PACKAGE)
  if (!existsSync(pkgPath)) {
    fail(`${PACKAGE} is missing at ${pkgPath}.`)
    return { failures, report: null }
  }
  const scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}
  const names = new Set(Object.keys(scripts))

  /* ------------------------------------------------- 1. every token resolves ------------------- */

  const tokens = []
  const perFile = new Map()
  for (const file of JOB_FILES) {
    const full = join(root, file)
    if (!existsSync(full)) {
      fail(`${file} is missing at ${full}. The cross-check reads both job files; restore it.`)
      continue
    }
    let doc
    try {
      doc = yamlLoad(readFileSync(full, 'utf8'))
    } catch (error) {
      fail(`${file} does not parse as YAML: ${error.message}`)
      continue
    }
    const blocks = runBlocks(file, doc)
    let carrying = 0
    for (const block of blocks) {
      const found = [...withoutComments(block.run).matchAll(NPM_RUN_RE)].map((m) => ({
        launcher: m[1],
        name: m[2],
      }))
      if (found.length > 0) carrying++
      for (const { launcher, name } of found) tokens.push({ launcher, name, where: block.where })
    }
    perFile.set(file, { blocks: blocks.length, carrying })
  }
  let unresolved = 0
  for (const { launcher, name, where } of tokens) {
    if (names.has(name)) continue
    unresolved++
    fail(
      `${where} invokes \`${launcher} ${name}\`, which is not a ${PACKAGE} script. A job over a` +
        ` script that does not exist fails on the next push for a reason unrelated to the push;` +
        ` rename the token or restore the script.`,
    )
  }
  const jobbed = new Set(tokens.map((t) => t.name).filter((n) => names.has(n)))

  /* ------------------------------------------------- 3. the declared kinds describe the tree ---- */

  const declared = new Map()
  for (const kind of UNJOBBED_BY_KIND) {
    for (const entry of kind.names) {
      const name = entryName(entry)
      if (declared.has(name)) {
        fail(
          `UNJOBBED_BY_KIND lists \`${name}\` twice (${declared.get(name)}; ${kind.kind}). One kind` +
            ` per script.`,
        )
        continue
      }
      declared.set(name, kind.kind)
      if (!names.has(name)) {
        fail(
          `UNJOBBED_BY_KIND lists \`${name}\` (${kind.kind}) but ${PACKAGE} has no such script. If` +
            ` it was retired, remove the entry; the list must describe the tree.`,
        )
      } else if (jobbed.has(name)) {
        fail(
          `UNJOBBED_BY_KIND lists \`${name}\` (${kind.kind}) as un-jobbed, but a job runs it` +
            ` (${tokens
              .filter((t) => t.name === name)
              .map((t) => t.where)
              .join('; ')}). A stale exception is a hole in the gate; remove the entry.`,
        )
      }
      if (kind.shape && !kind.shape.test(name)) {
        fail(
          `UNJOBBED_BY_KIND lists \`${name}\` under "${kind.kind}", whose names match ${kind.shape}.` +
            ` Move it to the kind it is, or add the reason as a named exception.`,
        )
      }
    }
  }

  /* ------------------------------------------------- 2. every un-jobbed script is declared ------ */

  const unjobbed = [...names].filter((name) => !jobbed.has(name))
  for (const name of unjobbed) {
    if (declared.has(name)) continue
    if (GATE_SHAPED_RE.test(name)) {
      fail(
        `\`${name}\` is gate-shaped and no job runs it -- no \`npm run ${name}\` in ${LEFTHOOK} or` +
          ` ${VERIFY}. A gate nothing runs reports the past.` +
          ` Wire it -- a \`pre-push\` job and, if it reads only` +
          ` committed files, a verify.yml step -- or add it to the named-exceptions list in` +
          ` scripts/check-jobs.mjs with the reason it stays ungated.`,
      )
    } else {
      fail(
        `\`${name}\` has no job and is of no declared kind. Add it to the matching UNJOBBED_BY_KIND` +
          ` list in scripts/check-jobs.mjs (bare emitter, :update, lint/format, reads a sibling checkout),` +
          ` or give it a job.`,
      )
    }
  }

  /* ------------------------------------------------- 4. every named path exists ---------------- */

  let pathNaming = 0
  for (const [name, command] of Object.entries(scripts)) {
    const paths = [...command.matchAll(REPO_PATH_RE)].map((m) => m[1])
    if (paths.length > 0) pathNaming++
    for (const path of paths) {
      if (!existsSync(join(pathsRoot, path))) {
        fail(
          `\`${name}\` names ${path}, which does not exist. A script over a file that was moved or` +
            ` deleted is a dead public name; repoint it or retire the script with its README row.`,
        )
      }
    }
  }

  const byKind = UNJOBBED_BY_KIND.map((kind) => ({
    kind: kind.kind,
    count: kind.names.map(entryName).filter((name) => unjobbed.includes(name)).length,
  }))
  const report = {
    scripts: names.size,
    tokens: tokens.length,
    distinct: new Set(tokens.map((t) => t.name)).size,
    unresolved,
    perFile,
    jobbed: jobbed.size,
    unjobbed: unjobbed.length,
    byKind,
    pathNaming,
  }
  return { failures, report }
}

/** The breakdown, re-derived on every run. */
function describe(report) {
  const files = [...report.perFile]
    .map(([file, { carrying, blocks }]) => `${file} ${carrying} of ${blocks} run blocks`)
    .join(', ')
  const kinds = report.byKind.map(({ kind, count }) => `${count} ${kind}`).join('; ')
  return [
    `jobs: ${files} carry an \`npm run\` token; ${report.tokens} tokens name ${report.distinct}` +
      ` distinct scripts, ${report.unresolved} unresolved.`,
    `scripts: ${report.scripts} in ${PACKAGE} -- ${report.jobbed} jobbed, ${report.unjobbed}` +
      ` un-jobbed and declared by kind (${kinds}). ${report.pathNaming} name a tools/, scripts/ or` +
      ` migration/ path.`,
  ]
}

/* --------------------------------------------------------------------------------- the gate ----- */

function main() {
  const { failures, report } = runCheck(ROOT)
  if (report) for (const line of describe(report)) console.log(line)
  if (failures.length === 0) {
    console.log(
      'jobs: every token resolves, every un-jobbed script is declared, every path exists.',
    )
    process.exit(0)
  }
  console.error(`\njobs: ${failures.length} failure(s). scripts/check-jobs.mjs.\n`)
  for (const failure of failures) console.error(`  - ${failure}\n`)
  process.exit(1)
}

/* --------------------------------------------------------------------------------- selftest ----- */

/**
 * One doctoring per case, in a fresh copy; the run must fail FOR THAT REASON. `expect` is a regex
 * over the failure messages, or 'pass'. Each doctoring must change the file it edits, or the fixture
 * is broken and the case throws rather than testing nothing.
 */
function selftest() {
  const files = [PACKAGE, ...JOB_FILES]
  const base = mkdtempSync(join(tmpdir(), 'check-jobs-'))
  const results = []
  try {
    const pristine = copyTree(base, 'pristine', files)
    const control = runCheck(pristine, { pathsRoot: REPO_ROOT })
    if (control.failures.length > 0 || control.report === null) {
      console.error(
        'selftest: the undoctored copy does not pass, so no case below can be trusted:\n',
      )
      for (const failure of control.failures) console.error(`  - ${failure}\n`)
      process.exit(1)
    }

    for (const { name, doctor, expect } of cases()) {
      const dir = copyTree(base, name.replace(/[^a-z0-9]+/gi, '-'), files)
      doctor(dir)
      const { failures } = runCheck(dir, { pathsRoot: REPO_ROOT })
      let ok
      let detail
      if (expect === 'pass') {
        ok = failures.length === 0
        detail = ok ? 'passes' : `unexpected failure(s): ${failures.join(' | ')}`
      } else {
        ok = failures.some((failure) => expect.test(failure))
        detail = ok
          ? `fails for that reason (${failures.length} failure(s))`
          : failures.length === 0
            ? 'PASSED, but should have failed'
            : `failed, but not for that reason: ${failures.join(' | ')}`
      }
      results.push({ name, ok, detail })
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }

  const failed = results.filter((result) => !result.ok)
  for (const { name, ok, detail } of results) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} -- ${detail}`)
  }
  console.log(
    `jobs selftest: ${results.length - failed.length}/${results.length} cases hold` +
      ` (control plus ${results.length - 1} doctored copies).`,
  )
  process.exit(failed.length === 0 ? 0 : 1)
}

function copyTree(base, name, files) {
  const dir = join(base, name)
  for (const relative of files) {
    const dest = join(dir, relative)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(REPO_ROOT, relative), dest)
  }
  return dir
}

/** Rewrite one file in a doctored copy; a rewrite that changes nothing is a broken fixture. */
function edit(dir, relative, transform) {
  const path = join(dir, relative)
  const before = readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === before) {
    throw new Error(
      `selftest fixture for ${relative} changed nothing -- the doctoring missed its target`,
    )
  }
  writeFileSync(path, after)
}

/** Rewrite the copy's package.json through its parsed form. */
function editScripts(dir, transform) {
  edit(dir, PACKAGE, (text) => {
    const pkg = JSON.parse(text)
    transform(pkg.scripts)
    return `${JSON.stringify(pkg, null, 2)}\n`
  })
}

/** A job appended to the copy's lefthook.yml, under the last hook's `jobs:` list. */
const appendJob = (name, run) => (text) => `${text}    - name: ${name}\n      run: ${run}\n`

function cases() {
  return [
    {
      name: 'control: the undoctored copy passes',
      doctor: () => {},
      expect: 'pass',
    },
    {
      name: 'a lefthook job invokes a script that does not exist',
      doctor: (dir) => edit(dir, LEFTHOOK, appendJob('doctored', 'npm run no:such:script')),
      expect: /^lefthook\.yml pre-push\/doctored invokes `npm run no:such:script`, which is not/,
    },
    {
      // Appended rather than substituted since D-36: the one `run: |` step verify.yml carried (the
      // correction log's `reports are current`) went with its emitter, so the copy gains a step.
      name: 'a token inside a multi-line `run: |` block in verify.yml is read, and does not resolve',
      doctor: (dir) =>
        edit(
          dir,
          VERIFY,
          (t) =>
            `${t}      - name: doctored\n        run: |\n          set -euo pipefail\n          npm run corrections:nope\n`,
        ),
      expect:
        /^\.github\/workflows\/verify\.yml verify\/doctored invokes `npm run corrections:nope`/,
    },
    {
      // The hook's own launcher; the message names the spelling the job used.
      name: 'a lefthook job invokes a script that does not exist through `node --run`',
      doctor: (dir) => edit(dir, LEFTHOOK, appendJob('doctored', 'node --run no:such:script')),
      expect: /^lefthook\.yml pre-push\/doctored invokes `node --run no:such:script`, which is not/,
    },
    {
      name: 'a `npm run` mention on a comment line is not a job',
      doctor: (dir) => edit(dir, LEFTHOOK, (t) => `${t}    # run: npm run no:such:script\n`),
      expect: 'pass',
    },
    {
      name: 'a new gate-shaped script with no job',
      doctor: (dir) =>
        editScripts(dir, (scripts) => {
          scripts['doctored:check'] = 'node scripts/check-provenance.mjs --doctored'
        }),
      expect: /^`doctored:check` is gate-shaped and no job runs it/,
    },
    {
      name: 'a new script of no declared kind, with no job',
      doctor: (dir) =>
        editScripts(dir, (scripts) => {
          scripts.doctored = 'node scripts/check-provenance.mjs --doctored'
        }),
      expect: /^`doctored` has no job and is of no declared kind/,
    },
    {
      name: 'a named exception gains a job and its entry goes stale',
      doctor: (dir) => edit(dir, LEFTHOOK, appendJob('doctored', 'npm run gates')),
      expect: /^UNJOBBED_BY_KIND lists `gates` \(named exception\) as un-jobbed, but a job runs it/,
    },
    {
      name: 'a declared script is retired from package.json and its entry goes stale',
      doctor: (dir) =>
        editScripts(dir, (scripts) => {
          delete scripts.gates
        }),
      expect:
        /^UNJOBBED_BY_KIND lists `gates` \(named exception\) but package\.json has no such script/,
    },
    {
      name: 'a script names a file that was moved',
      doctor: (dir) =>
        editScripts(dir, (scripts) => {
          scripts['check:provenance'] = 'node scripts/check-provenance-renamed.mjs'
        }),
      expect:
        /^`check:provenance` names scripts\/check-provenance-renamed\.mjs, which does not exist/,
    },
    {
      // D-38: the plugin's test runner lives under migration/, the third root the path check reads.
      name: 'a script names a migration/ file that was moved',
      doctor: (dir) =>
        editScripts(dir, (scripts) => {
          scripts['migration:test'] =
            'pwsh -NoProfile -File migration/tests/Invoke-MigrationTests-renamed.ps1'
        }),
      expect:
        /^`migration:test` names migration\/tests\/Invoke-MigrationTests-renamed\.ps1, which does not exist/,
    },
    {
      name: 'a job file is missing',
      doctor: (dir) => rmSync(join(dir, VERIFY)),
      expect: /^\.github\/workflows\/verify\.yml is missing at/,
    },
    {
      name: 'a job file does not parse',
      doctor: (dir) => edit(dir, LEFTHOOK, (t) => `${t}  - [unclosed\n`),
      expect: /^lefthook\.yml does not parse as YAML/,
    },
  ]
}

if (process.argv.includes('--selftest')) selftest()
else main()
