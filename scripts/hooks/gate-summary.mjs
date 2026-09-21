/**
 * Stop hook. Runs the fast gates and prints one line saying whether they passed.
 *
 * THE DEFECT THIS PREVENTS: reporting completion without running the gates. The screen-generation run
 * reported "lint" as unavailable rather than papering over it, which was right -- but the only reason
 * that was possible is that someone remembered to check. This makes the check unconditional.
 *
 * IT NEVER BLOCKS. A Stop hook that denies the stop can trap a session in a loop when the failure is
 * pre-existing or not fixable from here, and a hook people disable is a lie in version control. The
 * accountability mechanism is that the verdict is in the transcript where both the user and the agent
 * can see it, not that the agent is held hostage to it.
 *
 * Budget: the gates run CONCURRENTLY, so the wall clock is the slowest one and not their sum. MEASURED
 * on a 4-core box, warm: 4-6s wall, against a serial sum of about 8s. The first run after `npm ci` is
 * a cold one at roughly 24s, because both caches below are empty. `build-storybook` is deliberately
 * absent -- tens of seconds, and CI is the right place for it.
 *
 * `generate:check` was the second of these gates until the screen generator was retired and deleted,
 * and `spec:validate` -- a node's behaviour-manifest validator -- was the second until a later decision
 * deleted that node with the SLICE kind. `pipeline:check` took the vacated third
 * place in the gate prune that followed: it reads only committed files, runs no
 * emitter, costs 0.55s (`time npm run pipeline:check`, real 0.549s, measured 2026-09-06), and it is
 * the gate a session most plausibly turns red without noticing -- a `tools/pipeline/graph.ts` edit,
 * an input glob emptied by a deletion, a job removed from `lefthook.yml` or `verify.yml` while a
 * node's `detection` still claims it -- so a verdict at end of turn is worth more here than at push.
 * The wall-clock note above predates all three changes and stays pessimistic: `pipeline:check`
 * costs less than the validator it replaced, and it runs concurrently with the other two.
 *
 * That 4-6s used to be 19s, and the two changes that bought it are worth knowing about because ONE OF
 * THEM IS A DELIBERATE TRADE, not a free win.
 *
 * `typecheck` is `incremental` (see tsconfig.json). Sound: TypeScript's buildinfo tracks the real
 * dependency graph, so this is the same verdict, faster. 11.4s -> 3.4-4.2s.
 *
 * `lint:strict:cached` is NOT SOUND, and this hook is the only place in the repository allowed to use
 * it. The strict tier is 31 files, but linting them costs 8.5s because four TYPE-AWARE rules
 * (`no-unnecessary-condition`, `no-floating-promises`, `no-unnecessary-type-assertion`,
 * `react-hooks/exhaustive-deps`) make typescript-eslint build a whole second TypeScript program --
 * 5.1s of the 8.5s, duplicating what `typecheck` is doing in the next process along. `--cache` takes
 * that to 1.5s by skipping files whose own bytes have not changed.
 *
 * THE HOLE: ESLint keys its cache on each file's own content and the config, NOT on the types that
 * file depends on. Measured: editing one component file -- outside the lint scope but
 * inside the type program -- left the cache fully warm and re-linted NOTHING. A design-system change
 * that invalidates something `no-unnecessary-condition` concluded about a strict-tier file is silently
 * missed here until that file is next touched.
 *
 * Which is acceptable HERE and nowhere else, because this hook is an early-warning device that never
 * blocks, and it runs many times per session where a stale verdict is corrected minutes later. The
 * gates that actually decide anything run the uncached `lint:strict`: `.github/workflows/verify.yml`
 * on every push, and `lefthook.yml`'s pre-push hook before the code leaves the machine. Do not
 * "optimise" either of those to match this one.
 */
import { npmRun, readHookInput } from './_shared.mjs'

/**
 * The fast gates, in the order they are worth reading. All three read only committed files and none
 * runs an emitter. `pipeline:check` is here for the reason the header gives; `counts:check` and
 * `catalogue:check` were weighed and left to pre-push, where their `lefthook.yml` job comments state
 * the cost of each.
 */
const GATES = [
  'check:jobs',
  'citations:check',
]

await readHookInput()

const results = await Promise.all(
  GATES.map(async (gate) => ({ gate, ...(await npmRun(gate, { timeoutMs: 180_000 })) })),
)
const failed = results.filter((r) => r.code !== 0)

const verdict =
  failed.length === 0
    ? `gates: PASS (${GATES.join(', ')})`
    : `gates: FAIL -- ${failed.map((f) => f.gate).join(', ')}. Do not report this as complete.`

const detail =
  failed.length === 0
    ? verdict
    : [
        verdict,
        '',
        ...failed.flatMap((f) => [`--- npm run ${f.gate} (exit ${f.code}) ---`, f.out, '']),
      ].join('\n')

process.stdout.write(`${JSON.stringify({ systemMessage: verdict, additionalContext: detail })}\n`)
process.exit(0)
