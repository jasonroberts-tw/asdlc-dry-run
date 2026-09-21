/**
 * entry-skill.test.mjs — the entry skill stays a host's page, and the lifecycle keeps one copy.
 *
 * CHECKS. The entry skill carries `disable-model-invocation: true`; is no longer than the policy's
 * cap (`dry-run/workflow-policy.json`, block `entrySkill`, key `maxLines`); carries the Host Facts table with its
 * seven rows; names the lifecycle reference it executes by heading; and carries NO phase heading
 * and no heading the lifecycle also has. No prompt other than the lifecycle carries a phase
 * heading either.
 *
 * THE FAILURE IT EXISTS TO PREVENT. Two copies of a lifecycle are kept in step by nobody. The
 * second copy starts as a few helpful lines in the file a person opens first; the cap and the
 * heading rule are what stop it starting. And a run that mutates repositories must not be
 * startable by a model deciding it would help: one frontmatter flag, which a tidy-up can delete.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/entry-skill.test.mjs`.
 * NEEDS. Nothing installed. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { entrySkill, headings, lifecycle, policy, prompts, suite, tableUnder } from './lib/prompts.mjs'

// ADAPT: the rows are what the contract leaves to its host. Their VALUES are yours; the rows stay.
const HOST_FACTS = ['Trigger', 'Input', 'Secrets', 'Approval', 'Intervention channel', 'Tool paths', 'Final output']
const PHASE_HEADING = /^Phase\b/i

const t = suite('entry-skill')
const entry = entrySkill()
const life = lifecycle()

t.ok(`${entry.path}: \`disable-model-invocation: true\`, so only a person can start a run`, entry.frontmatter['disable-model-invocation'] === true, `disable-model-invocation: ${JSON.stringify(entry.frontmatter['disable-model-invocation'])}`)

const cap = policy().entrySkill?.maxLines
const lines = entry.text.replace(/\n$/, '').split('\n').length
t.ok(`${entry.path}: is within the policy's line cap`, Number.isInteger(cap) && lines <= cap, `${lines} lines against a cap of ${cap}; move procedure into the lifecycle reference rather than raising the cap`)

const rows = tableUnder(entry.text, 'Host Facts') ?? []
const facts = rows.map((r) => r[0])
t.ok(`${entry.path}: the Host Facts table carries ${HOST_FACTS.join(', ')}`, HOST_FACTS.every((f) => facts.includes(f)), `found: ${facts.join(', ')}`)
t.ok(`${entry.path}: every Host Facts row has a value`, rows.length > 0 && rows.every((r) => r.length === 2 && r[1].length > 0))

t.ok(`${entry.path}: names the lifecycle reference it executes by heading`, Boolean(life) && entry.text.includes(life.path) && /by heading/i.test(entry.text))

const lifeHeadings = new Set(life ? headings(life.text).filter((h) => h.level > 1).map((h) => h.text) : [])
for (const h of headings(entry.text)) {
  t.ok(`${entry.path}:${h.line}: "${h.text}" is not a phase heading`, !PHASE_HEADING.test(h.text), 'the entry skill executes the lifecycle by heading and restates none of it')
  t.ok(`${entry.path}:${h.line}: "${h.text}" is not a heading of the lifecycle`, !lifeHeadings.has(h.text), 'a heading the lifecycle also has is the start of a second copy')
}
for (const p of prompts().filter((x) => x.path !== entry.path && x.path !== life?.path)) {
  const phase = headings(p.text).filter((h) => PHASE_HEADING.test(h.text))
  t.ok(`${p.path}: carries no phase heading`, phase.length === 0, phase.map((h) => `line ${h.line}: ${h.text}`).join('\n'))
}
t.done()
