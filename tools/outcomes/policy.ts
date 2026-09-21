/**
 * The reader of `tools/outcomes/policy.json`: the loop's constants, shape-checked once, so
 * no tool states a threshold inline and none reads a key that is not there.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: a key misspelled in the policy file reads as
 * `undefined`, `records.length >= undefined` is false for every count, and every report withholds
 * every rate for ever without a word. A missing or mistyped key throws here, by name.
 *
 * INVOCATION. Imported, never run. NEEDS. Only the committed policy file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POLICY_PATH } from './paths.ts'

export interface Policy {
  minimumSampleSize: number
  proposalLabelPrefix: string
  proposalLabels: string[]
  referencePaths: string[]
  genericWords: string[]
  strongMatchSharedWords: number
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1

export function loadPolicy(root: string): Policy {
  let raw: { [key: string]: unknown }
  try {
    raw = JSON.parse(readFileSync(join(root, POLICY_PATH), 'utf8')) as { [key: string]: unknown }
  } catch (error) {
    throw new Error(`${POLICY_PATH} cannot be read as JSON: ${(error as Error).message}`)
  }
  const bad = (key: string, want: string): never => {
    throw new Error(`${POLICY_PATH}: \`${key}\` must be ${want}, and is ${JSON.stringify(raw[key])}.`)
  }
  if (!isCount(raw.minimumSampleSize)) bad('minimumSampleSize', 'a whole number of at least 1')
  if (!isCount(raw.strongMatchSharedWords)) bad('strongMatchSharedWords', 'a whole number of at least 1')
  if (typeof raw.proposalLabelPrefix !== 'string' || !/^[a-z][a-z0-9-]*:$/.test(raw.proposalLabelPrefix)) {
    bad('proposalLabelPrefix', 'a lower-case word ending in `:`')
  }
  for (const key of ['proposalLabels', 'referencePaths', 'genericWords']) {
    if (!isStrings(raw[key])) bad(key, 'a list of strings')
  }
  for (const key of Object.keys(raw)) {
    if (key.endsWith('Means') && !(key.slice(0, -'Means'.length) in raw)) bad(key, 'the sibling of a key that exists')
  }
  return raw as unknown as Policy
}
