/**
 * frontmatter.test.mjs — the shape of every skill's and agent's frontmatter.
 *
 * CHECKS. Every skill and agent of the workflow opens with a frontmatter block that reads cleanly,
 * carries the keys the harness needs (`name`, `description`), names itself as its path does, and
 * carries no key outside the list below. A reference file carries no frontmatter at all.
 *
 * THE FAILURE IT EXISTS TO PREVENT. The harness does not report a frontmatter it cannot use: a
 * skill whose `name` differs from its directory, or whose block has a typo in a key, is simply not
 * the skill anyone thinks it is, and the first sign is a run that behaves as if the file were absent.
 *
 * INVOCATION. `npm run dry-run:test`, or `node dry-run/tests/frontmatter.test.mjs`.
 * NEEDS. Nothing installed. `WORKFLOW_ROOT` points it at a doctored copy.
 */

import { basename, dirname } from 'node:path'
import { prompts, suite } from './lib/prompts.mjs'

// ADAPT: add a key here the day a prompt of yours needs it, so that a misspelt key stays a failure.
const ALLOWED = {
  skill: ['name', 'description', 'argument-hint', 'disable-model-invocation', 'allowed-tools', 'model'],
  agent: ['name', 'description', 'skills', 'tools', 'model'],
}

const t = suite('frontmatter')
for (const p of prompts()) {
  if (p.kind === 'reference') {
    t.ok(`${p.path}: a reference carries no frontmatter`, !p.text.startsWith('---'), 'a reference is opened by heading, never loaded by the harness; frontmatter on it is a second, unread description')
    continue
  }
  t.ok(`${p.path}: the frontmatter reads cleanly`, p.frontmatterErrors.length === 0, p.frontmatterErrors.join('\n'))
  const fm = p.frontmatter
  const expected = p.kind === 'skill' ? basename(dirname(p.path)) : basename(p.path, '.md')
  t.ok(`${p.path}: \`name\` is ${expected}, as its path says`, fm.name === expected, `name: ${JSON.stringify(fm.name)}`)
  t.ok(`${p.path}: \`description\` is one non-empty line`, typeof fm.description === 'string' && fm.description.trim().length > 0, `description: ${JSON.stringify(fm.description)}`)
  const unknown = Object.keys(fm).filter((k) => !ALLOWED[p.kind].includes(k))
  t.ok(`${p.path}: no key outside ${ALLOWED[p.kind].join(', ')}`, unknown.length === 0, `unknown: ${unknown.join(', ')}`)
  if (p.kind === 'agent') t.ok(`${p.path}: \`skills\` is a list`, Array.isArray(fm.skills), `skills: ${JSON.stringify(fm.skills)}`)
}
t.done()
