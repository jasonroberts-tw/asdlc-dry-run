/**
 * agent-skills.test.mjs — an agent's frontmatter declares exactly the skills its body uses.
 *
 * CHECKS, per agent: every skill in `skills:` exists; every skill the body uses is declared; every
 * declared skill is used. A body USES a skill when it names it in backticks (`some-skill`) or
 * names a path inside its directory (`skills/some-skill/…`); adaptation comments are not the body.
 *
 * THE FAILURE IT EXISTS TO PREVENT. A declared skill is preloaded into the agent on every
 * dispatch: declared and unused, it costs tokens every time and competes with the task for
 * attention; used and undeclared, the agent meets a name it has not been given and reads the
 * skill late, or guesses. Neither shows up as an error anywhere.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/agent-skills.test.mjs`.
 * NEEDS. Nothing installed. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { prompts, skillNames, suite } from './lib/prompts.mjs'

const t = suite('agent-skills')
const known = skillNames()
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const p of prompts().filter((x) => x.kind === 'agent')) {
  const declared = Array.isArray(p.frontmatter.skills) ? p.frontmatter.skills : []
  const body = p.body.replace(/<!--[\s\S]*?-->/g, '')
  const used = known.filter((name) => new RegExp('`' + escape(name) + '`|skills/' + escape(name) + '/').test(body))
  for (const name of declared) t.ok(`${p.path}: the declared skill \`${name}\` exists`, known.includes(name), `known skills: ${known.join(', ')}`)
  for (const name of used) t.ok(`${p.path}: uses \`${name}\` and declares it`, declared.includes(name), `the body uses \`${name}\` but the frontmatter does not declare it; declared: ${declared.join(', ') || '(none)'}`)
  for (const name of declared) t.ok(`${p.path}: declares \`${name}\` and uses it`, used.includes(name), `the frontmatter declares \`${name}\` but the body never uses it; it is preloaded on every dispatch for nothing`)
}
t.done()
