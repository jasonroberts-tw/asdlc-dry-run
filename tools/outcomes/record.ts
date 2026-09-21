/**
 * The run-outcome record: the ONE reader of `dry-run/run-outcome.schema.json`, the cross-field rules a schema cannot
 * state, and the canonical serialiser. The writer (`write-record.ts`), the report emitter
 * (`index.ts`) and the filing step (`propose.ts`) all validate through `validateRecord` here, so
 * there is one answer to "is this a record".
 *
 * NOT A JSON-SCHEMA LIBRARY. This is a small validator built for this one schema's shapes. It
 * understands exactly the keywords in `UNDERSTOOD` below and REFUSES a schema that uses any other,
 * because a keyword a validator silently ignores validates everything. Widen it here, with a
 * selftest case, before you use another keyword in the schema.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: a reader that drifts from the writer. A record
 * written under a schema the reader has never seen would be read as if its fields meant what they
 * meant before, and every report over it would be wrong without failing. So the version is checked
 * FIRST, before any other rule, and an unknown one is refused by name; and a schema whose own
 * version is not the one this reader was written for is refused before any record is read. A schema
 * change is a `schemaVersion` bump in the schema AND in `READER_SCHEMA_VERSION` here, in one change.
 *
 * EVERY REFUSAL CARRIES ONE NAMED REASON: the first rule broken, as `{ code, at, message }`. One
 * reason and not a list, because the writer's caller is a run on a terminal path, and a run that is
 * handed six findings fixes the wrong one first.
 *
 * INVOCATION. Imported, never run. `npm run outcomes:selftest` holds it to the committed fixtures
 * and to one doctored copy per rule.
 * NEEDS. Only committed files.
 */
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { SCHEMA_PATH } from './paths.ts'

/** The schema version this reader was written for. Bump it in the same change as the schema's. */
export const READER_SCHEMA_VERSION = 1

export interface Refusal {
  /** The rule broken, spelled the same way in the selftest that asserts it. */
  code: string
  /** Where: a JSON path into the record, or a file. */
  at: string
  message: string
}

export interface Fact {
  id: string
  subject: string
  fact: string
  evidence: string[]
}

export interface Correction {
  id: string
  subject: string
  fact: string | null
  stage: string
  asset: string
  supersedes: string | null
  retracts: string | null
  evidence: string[]
}

export interface RunOutcome {
  schemaVersion: number
  workflow: string
  item: string
  status: 'complete' | 'failed' | 'blocked'
  finishedAt: string
  commit: string | null
  branch: string | null
  failure: { stage: string; reason: string } | null
  intervention: { reasonCode: string; detail: string } | null
  facts: Fact[]
  corrections: Correction[]
  decisions: { kind: string; choice: string; reason: string }[]
  undecided: { question: string; why: string }[]
}

export type Verdict = { ok: true; record: RunOutcome } | { ok: false; refusal: Refusal }

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Schema = { [keyword: string]: unknown }

const refuse = (code: string, at: string, message: string): Verdict => ({
  ok: false,
  refusal: { code, at, message },
})

/* ------------------------------------------------------------------ the schema, and its reader -- */

const UNDERSTOOD = new Set([
  '$schema',
  'title',
  'description',
  '$defs',
  '$ref',
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'pattern',
  'minLength',
  'anyOf',
])

/** Throws on the first keyword this reader does not understand, naming it and where it is. */
function assertUnderstood(node: unknown, at: string): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`${SCHEMA_PATH} ${at}: a schema must be an object`)
  }
  const schema = node as Schema
  for (const keyword of Object.keys(schema)) {
    if (!UNDERSTOOD.has(keyword)) {
      throw new Error(
        `${SCHEMA_PATH} ${at}: the keyword \`${keyword}\` is not one record.ts understands, and a` +
          ' keyword it ignored would validate everything. Widen record.ts first, with a selftest case.',
      )
    }
  }
  if ('additionalProperties' in schema && schema.additionalProperties !== false) {
    throw new Error(`${SCHEMA_PATH} ${at}: \`additionalProperties\` is understood only as \`false\``)
  }
  if (typeof schema.$ref === 'string' && !schema.$ref.startsWith('#/$defs/')) {
    throw new Error(`${SCHEMA_PATH} ${at}: \`$ref\` is understood only into \`#/$defs/\``)
  }
  for (const group of ['properties', '$defs']) {
    const members = schema[group]
    if (members === undefined) continue
    for (const [name, member] of Object.entries(members as object)) {
      assertUnderstood(member, `${at}/${group}/${name}`)
    }
  }
  if (schema.items !== undefined) assertUnderstood(schema.items, `${at}/items`)
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((member, i) => assertUnderstood(member, `${at}/anyOf/${String(i)}`))
  }
}

/**
 * The schema at `root`, checked once: every keyword understood, and its own version the one this
 * reader was written for. Throws otherwise; nothing reads a record through a schema it half knows.
 */
export function loadSchema(root: string): Schema {
  const path = join(root, SCHEMA_PATH)
  let schema: Schema
  try {
    schema = JSON.parse(readFileSync(path, 'utf8')) as Schema
  } catch (error) {
    throw new Error(`${SCHEMA_PATH} cannot be read as JSON: ${(error as Error).message}`)
  }
  assertUnderstood(schema, '#')
  const properties = (schema.properties ?? {}) as { [name: string]: Schema }
  const version = properties.schemaVersion?.const
  if (version !== READER_SCHEMA_VERSION) {
    throw new Error(
      `${SCHEMA_PATH} declares schemaVersion ${JSON.stringify(version)} and record.ts reads version` +
        ` ${String(READER_SCHEMA_VERSION)}. A schema change is a version bump on BOTH sides in one` +
        ' change: update READER_SCHEMA_VERSION with whatever the new version needs read differently.',
    )
  }
  return schema
}

function typeOf(value: Json): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The first violation of `schema` by `value`, as `[at, message]`, or null. */
function violation(value: Json, schema: Schema, root: Schema, at: string): [string, string] | null {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.slice('#/$defs/'.length)
    const target = ((root.$defs ?? {}) as { [name: string]: Schema })[name]
    if (target === undefined) throw new Error(`${SCHEMA_PATH}: \`$ref\` to a missing $defs/${name}`)
    return violation(value, target, root, at)
  }
  if (Array.isArray(schema.anyOf)) {
    const members = schema.anyOf as Schema[]
    const results = members.map((member) => violation(value, member, root, at))
    if (results.every((r) => r !== null)) {
      // The deepest complaint is the useful one: "is not null" says nothing about a malformed object.
      const deepest = results.reduce((a, b) => (b![0].length > a![0].length ? b : a))!
      return deepest[0] === at ? [at, 'matches none of the shapes the schema allows here'] : deepest
    }
  }
  if ('const' in schema && !same(value, schema.const)) {
    return [at, `must be ${JSON.stringify(schema.const)}, and is ${JSON.stringify(value)}`]
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((member) => same(value, member))) {
    return [at, `must be one of ${schema.enum.map((m) => JSON.stringify(m)).join(', ')}, and is ${JSON.stringify(value)}`]
  }
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string]
    const actual = typeOf(value)
    const fits = allowed.some(
      (t) => t === actual || (t === 'integer' && actual === 'number' && Number.isInteger(value)),
    )
    if (!fits) return [at, `must be of type ${allowed.join(' or ')}, and is ${actual}`]
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      return [at, `must be at least ${String(schema.minLength)} character(s) long`]
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      return [at, `must match ${schema.pattern}, and is ${JSON.stringify(value)}`]
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    for (let i = 0; i < value.length; i++) {
      const found = violation(value[i], schema.items as Schema, root, `${at}/${String(i)}`)
      if (found) return found
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = (schema.properties ?? {}) as { [name: string]: Schema }
    for (const name of (schema.required ?? []) as string[]) {
      if (!(name in value)) return [`${at}/${name}`, 'is required and is missing']
    }
    for (const [name, member] of Object.entries(value)) {
      if (name in properties) {
        const found = violation(member, properties[name], root, `${at}/${name}`)
        if (found) return found
      } else if (schema.additionalProperties === false) {
        return [`${at}/${name}`, 'is not a field of the record; the schema lists every field']
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------------ the cross-field rules -- */

/**
 * What a schema cannot state: which fields are set for which terminal status, which pairs are null
 * together, and what a correction may point at. First rule broken, or null.
 */
function crossFieldRefusal(record: RunOutcome): Refusal | null {
  const no = (code: string, at: string, message: string): Refusal => ({ code, at, message })

  if ((record.commit === null) !== (record.branch === null)) {
    return no(
      'COMMIT_AND_BRANCH_NOT_NULL_TOGETHER',
      '#/commit',
      '`commit` and `branch` are null together (the run pushed nothing) or set together.',
    )
  }
  if (record.status === 'complete' && record.commit === null) {
    return no(
      'COMPLETE_WITHOUT_COMMIT',
      '#/commit',
      'a complete run names the last commit it pushed; the record is written after that push.',
    )
  }
  if ((record.status === 'failed') !== (record.failure !== null)) {
    return no(
      'FAILURE_DOES_NOT_MATCH_STATUS',
      '#/failure',
      `\`failure\` is set when, and only when, status is \`failed\`; status is \`${record.status}\`.`,
    )
  }
  if ((record.status === 'blocked') !== (record.intervention !== null)) {
    return no(
      'INTERVENTION_DOES_NOT_MATCH_STATUS',
      '#/intervention',
      `\`intervention\` is set when, and only when, status is \`blocked\`; status is \`${record.status}\`.`,
    )
  }

  // Ids are one namespace over facts and corrections, because a correction points at either.
  const live = new Set<string>()
  const seen = new Set<string>()
  for (const [i, fact] of record.facts.entries()) {
    if (seen.has(fact.id)) return no('DUPLICATE_ENTRY_ID', `#/facts/${String(i)}/id`, `\`${fact.id}\` is used twice.`)
    seen.add(fact.id)
    live.add(fact.id)
  }
  for (const [i, correction] of record.corrections.entries()) {
    const at = `#/corrections/${String(i)}`
    if (seen.has(correction.id)) return no('DUPLICATE_ENTRY_ID', `${at}/id`, `\`${correction.id}\` is used twice.`)
    if (correction.supersedes !== null && correction.retracts !== null) {
      return no(
        'CORRECTION_SUPERSEDES_AND_RETRACTS',
        at,
        'a correction supersedes an entry with a new fact, or retracts one and states none; never both.',
      )
    }
    if ((correction.retracts !== null) !== (correction.fact === null)) {
      return no(
        'RETRACTION_AND_FACT_NOT_NULL_TOGETHER',
        `${at}/fact`,
        '`fact` is null exactly when the entry retracts: a retraction states no fact, and anything else must.',
      )
    }
    const target = correction.supersedes ?? correction.retracts
    if (target !== null) {
      if (!seen.has(target)) {
        return no(
          'CORRECTION_TARGET_NOT_EARLIER',
          at,
          `\`${target}\` is not the id of an EARLIER fact or correction in this record.`,
        )
      }
      if (!live.has(target)) {
        return no(
          'CORRECTION_TARGET_NOT_LIVE',
          at,
          `\`${target}\` was already superseded or retracted; point at the entry that replaced it.`,
        )
      }
      live.delete(target)
    }
    seen.add(correction.id)
    if (correction.fact !== null) live.add(correction.id)
  }
  return null
}

/* --------------------------------------------------------------------------------- the verdict -- */

/** Is `value` a record? The version first, then the schema, then the cross-field rules. */
export function validateRecord(value: unknown, schema: Schema): Verdict {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refuse('NOT_AN_OBJECT', '#', 'a record is one JSON object.')
  }
  const version = (value as { schemaVersion?: unknown }).schemaVersion
  if (version !== READER_SCHEMA_VERSION) {
    return refuse(
      'UNKNOWN_SCHEMA_VERSION',
      '#/schemaVersion',
      `this reader knows schemaVersion ${String(READER_SCHEMA_VERSION)} and the record says` +
        ` ${JSON.stringify(version)}. It is refused rather than read as if its fields meant what they` +
        ' mean in the version the reader knows.',
    )
  }
  const found = violation(value as Json, schema, schema, '#')
  if (found) return refuse('SCHEMA_VIOLATION', found[0], `${found[0]} ${found[1]}.`)
  const record = value as RunOutcome
  const crossField = crossFieldRefusal(record)
  if (crossField) return { ok: false, refusal: crossField }
  return { ok: true, record }
}

/** A record file: parsed, validated, and held to its own name (`<item>.json`). */
export function readRecordFile(path: string, schema: Schema): Verdict {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return refuse('NOT_JSON', path, (error as Error).message)
  }
  const verdict = validateRecord(value, schema)
  if (!verdict.ok) return verdict
  if (basename(path) !== `${verdict.record.item}.json`) {
    return refuse(
      'FILE_NAME_IS_NOT_THE_ITEM',
      path,
      `the record is for item \`${verdict.record.item}\`, so its file is \`${verdict.record.item}.json\`.`,
    )
  }
  return verdict
}

/* ---------------------------------------------------------------------- the canonical serialiser -- */

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  const out: { [key: string]: Json } = {}
  // Code-point order, not locale order, so two runtimes agree.
  for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    out[key] = sortKeys(value[key])
  }
  return out
}

/**
 * The one serialiser for records and for every JSON report: keys in code-point order, arrays in the
 * order given (a record's corrections are in the order they were made), two-space indent, one
 * trailing newline.
 */
export const canonicalJson = (value: unknown): string => `${JSON.stringify(sortKeys(value as Json), null, 2)}\n`

/* ------------------------------------------------------------------ what a record says, finally -- */

export interface LiveEntry {
  id: string
  subject: string
  fact: string
  evidence: string[]
  /** Null for an entry the run established and never corrected. */
  stage: string | null
  asset: string | null
}

/**
 * The entries a record still stands behind: every fact and correction that no later correction
 * superseded or retracted. The record keeps the rest for the audit; the reports read these.
 */
export function liveEntries(record: RunOutcome): LiveEntry[] {
  const replaced = new Set<string>()
  for (const c of record.corrections) {
    const target = c.supersedes ?? c.retracts
    if (target !== null) replaced.add(target)
  }
  const entries: LiveEntry[] = []
  for (const f of record.facts) {
    if (!replaced.has(f.id)) entries.push({ ...f, stage: null, asset: null })
  }
  for (const c of record.corrections) {
    if (c.fact === null || replaced.has(c.id)) continue
    entries.push({ id: c.id, subject: c.subject, fact: c.fact, evidence: c.evidence, stage: c.stage, asset: c.asset })
  }
  return entries
}
