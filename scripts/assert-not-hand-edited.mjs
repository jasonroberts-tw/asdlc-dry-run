/**
 * The fast local version of the emitted-output checks, for a git pre-commit hook.
 *
 *   node scripts/assert-not-hand-edited.mjs <staged files...>
 *
 * It fails when a staged file is owned by a generator AND no longer matches what that generator
 * produces. The message names the manifest, the extraction document and the emitter, so the next move
 * is a redirect rather than a guess.
 *
 * WHY BOTH THIS AND CI. The `*:check` scripts are the authority and run in CI. They answer "do the
 * committed build products match their generators", which is the right question at merge time and
 * the wrong one at the moment of the mistake: by then the edit is one of several in the diff and the
 * failure names a file, not a reason. This runs on the staged paths only, at commit time, and answers
 * "you changed a build product, here is where the change belongs".
 *
 * ONE VERIFIER PER GENERATOR, CHOSEN BY PATH. An earlier version ran the screen generator's
 * `generate:check` no matter what was staged and exited 0 when it passed. That gate only ever compared
 * `src/screens/**`, so a hand edit to any OTHER build product -- the generated API client, the parsed
 * design tokens, the correction log -- was detected as suspect and then silently cleared by a check
 * that had never looked at it. Verifiers are now selected by the path that made the file suspect, and
 * a suspect nothing can verify is REPORTED as unverified rather than waved through.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  ROOT,
  bannerCheckApplies,
  generatedFileRedirect,
  hasGeneratedBanner,
  header,
  toRepoRel,
} from './hooks/_shared.mjs'

const staged = process.argv.slice(2).filter((a) => a !== '')
if (staged.length === 0) process.exit(0)

/** Staged paths that some generator owns. */
const suspect = []
for (const arg of staged) {
  const rel = toRepoRel(arg)
  if (rel === null) continue
  const owned =
    generatedFileRedirect(rel) !== null ||
    (bannerCheckApplies(rel) && hasGeneratedBanner(header(resolve(ROOT, rel))))
  if (owned) suspect.push(rel)
}

if (suspect.length === 0) process.exit(0)

/**
 * Which npm script actually re-derives which build product.
 *
 * `names` pulls the offending paths out of a failing check's output when it prints them, so the
 * message can point at the file rather than at the whole corpus. It is optional: a verifier that
 * names nothing falls back to the staged suspects it claimed.
 */
const VERIFIERS = [
  // A `graphql:merge:check` row over `artifacts/api/contract/schema.graphql` STOOD HERE -- node
  // N-03's, and before D-23 node N-02's as `generate:api-client:check` over
  // `artifacts/api/client/operations.d.ts`. D-33 retired N-03 with the SLICE kind and deleted
  // the contract file with its emitter; a verifier over a file nothing writes is a row that can never
  // fire.
  //
  // The correction log's row STOOD HERE (`corrections:log` over `tools/ledger/correction-log.md`),
  // narrowed by D-30 from a `throughput` row over two reports and deleted by D-36 (2026-09-08) with
  // the emitter: the rendered log is frozen under `docs/retired/` and is nobody's build
  // product now, so there is nothing to re-derive and no row.
  // The catalogue. `catalogue:check` rebuilds the whole output root and
  // byte-compares it, and prints each differing path on its own indented line, which `names` pulls
  // out so the message points at the file rather than at the tree. Everything the emitter owns is
  // under `artifacts/catalogue/`, but what makes a path there SUSPECT in the first place is the
  // redirect table or the banner -- so a newly emitted file is claimed here only once `_shared.mjs`
  // knows it (SKILL.md and source-manifest.json joined that table later), and until
  // then is reported as unverified rather than waved through.
  {
    script: 'catalogue:check',
    owns: (rel) => rel.startsWith('artifacts/catalogue/'),
    names: (out) => [...out.matchAll(/^\s+(artifacts\/catalogue\/\S+)/gm)].map((m) => m[1]),
  },
  // Node N-14 (D-38). The records under
  // `artifacts/outcomes/records/` are written by the migration workflow's terminal step
  // (`migration/skills/migration-contract/tools/Write-CeRunOutcome.ps1`) and normalised to
  // canonical bytes by `npm run outcomes`; everything else under the root is derived from them.
  // `outcomes:check` is still the verifier: it re-validates every record against the one schema under
  // `migration/`, re-serialises it, rebuilds every report and byte-compares the whole tree, printing
  // each differing path on its own indented line -- so a hand-edited record, or one the terminal
  // step wrote and nobody normalised, fails here by name. Every input is a committed file, so the
  // check runs whole here, in `pre-push` and in CI alike; there is no sibling clone and no half that
  // skips.
  {
    script: 'outcomes:check',
    owns: (rel) => rel.startsWith('artifacts/outcomes/'),
    names: (out) => [...out.matchAll(/^\s+(artifacts\/outcomes\/\S+)/gm)].map((m) => m[1]),
  },
]

/**
 * Only NOW pay for a generator, and only for the ones whose output is actually staged. About two
 * seconds each, which is fine once a commit touches a build product and would not be fine on every
 * commit.
 */
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(script) {
  // Windows needs a shell: since the CVE-2024-27980 fix Node refuses to spawn a .cmd without one.
  // `script` is always a literal from VERIFIERS above, never anything a staged path supplied.
  return process.platform === 'win32'
    ? spawnSync(`${npm} run --silent ${script}`, {
        cwd: ROOT,
        encoding: 'utf8',
        shell: true,
        windowsHide: true,
      })
    : spawnSync(npm, ['run', '--silent', script], { cwd: ROOT, encoding: 'utf8' })
}

const failures = []
const claimed = new Set()

for (const verifier of VERIFIERS) {
  const mine = suspect.filter((rel) => verifier.owns(rel))
  if (mine.length === 0) continue
  for (const rel of mine) claimed.add(rel)

  const check = run(verifier.script)
  if (check.status === 0) continue
  const out = `${check.stdout ?? ''}${check.stderr ?? ''}`
  const named = verifier.names?.(out) ?? []
  failures.push({ script: verifier.script, out, paths: named.length > 0 ? named : mine })
}

/**
 * A build product this table cannot re-derive on its own. Saying nothing would repeat the bug
 * described in the header; failing would break a legitimate regenerate-and-commit of an artifact no
 * verifier here owns. So it is a note, and CI remains the authority.
 */
const unverified = suspect.filter((rel) => !claimed.has(rel))

if (failures.length === 0) {
  if (unverified.length > 0) {
    console.error('note: staged build products this hook cannot re-derive locally:\n')
    for (const rel of unverified) console.error(`  ${rel}`)
    console.error(
      '\nIf you edited one by hand, the change belongs in its generator. CI will catch it.',
    )
  }
  // Everything a verifier could check matches what its generator produces -- which is exactly what a
  // legitimate regenerate-and-commit looks like. Nothing to fail on.
  process.exit(0)
}

console.error('A staged file is a build product and no longer matches its generator.\n')
for (const { paths } of failures) {
  for (const rel of paths) {
    const why = generatedFileRedirect(rel)
    console.error(why ?? `${rel} is generator output and has been changed by hand.`)
    console.error('')
  }
}
for (const { script, out, paths } of failures) {
  if (paths.some((rel) => generatedFileRedirect(rel) !== null)) continue
  console.error(`\`npm run ${script}\` failed. Its full output:\n`)
  console.error(out)
}
console.error('To commit anyway (you almost never want to): LEFTHOOK=0 git commit')
process.exit(1)
