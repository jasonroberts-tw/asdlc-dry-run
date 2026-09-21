/**
 * already-named — does the committed reference already name a proposal's subject, and does it
 * DESCRIBE the proposed fact there or only mention the subject in passing?
 *
 *   strong   a passage names the subject and shares enough of the fact's own words: the reference
 *            already says this. The filing step PRINTS it, with where, and does not file.
 *   weak     a passage names the subject and shares too few of them: a mention in passing. Filed,
 *            with that disposition and the place in the body.
 *   absent   no passage names the subject, or no reference is configured. Filed, saying which.
 *
 * THE FAILURE IT EXISTS TO PREVENT. On day one: proposals that state what the reference already
 * carries, so a promoter opens each to find the entry written, learns that proposals are noise, and
 * stops opening them. The opposite error is as cheap to make: a matcher that counts "the" and "of"
 * as shared words finds every fact described everywhere and files nothing.
 *
 * ONE MATCHER, ONE LIST. The words that count as a mention rather than a description are
 * `genericWords` in `policy.json` and nowhere else, and this module is the only thing that matches
 * with them. The filing step (the writer of a disposition) goes through it, and so must anything
 * that READS the reference for the same question, such as a gate over a run's plan; the selftest
 * proves the list matched with is the policy file's by moving one word into it and watching a strong
 * match turn weak.
 *
 * It never decides what is promoted: a strong match is shown to a person with its location.
 *
 * INVOCATION. Imported by `propose.ts`; never run.
 * NEEDS. Only committed files: the paths `referencePaths` names.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Policy } from './policy.ts'

export interface Passage {
  path: string
  /** The 1-based line the passage starts on. */
  line: number
  text: string
}

export interface Reference {
  /** False while `referencePaths` is empty: there is nothing to check against, and callers say so. */
  configured: boolean
  passages: Passage[]
  /** Configured paths that do not exist. A caller reports these; a reference that moved is not "absent". */
  missing: string[]
}

export type Disposition = 'strong' | 'weak' | 'absent'

export interface Naming {
  disposition: Disposition
  /** `path:line` of the passage that decided it; null when absent. */
  where: string | null
  /** One sentence for the issue body and the console. */
  note: string
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function filesUnder(root: string, relative: string): string[] {
  const full = join(root, relative)
  if (!statSync(full).isDirectory()) return [relative]
  const out: string[] = []
  for (const name of readdirSync(full).sort(byCodePoint)) {
    out.push(...filesUnder(root, `${relative.replace(/\/$/, '')}/${name}`))
  }
  return out
}

/** A passage is a run of non-blank lines: a paragraph, a list, a table, one JSON object's lines. */
function passagesOf(path: string, text: string): Passage[] {
  const passages: Passage[] = []
  let start = -1
  const lines = text.split('\n')
  for (let i = 0; i <= lines.length; i++) {
    const blank = i === lines.length || lines[i].trim() === ''
    if (!blank && start === -1) start = i
    if (blank && start !== -1) {
      passages.push({ path, line: start + 1, text: lines.slice(start, i).join(' ') })
      start = -1
    }
  }
  return passages
}

export function loadReference(root: string, policy: Policy): Reference {
  const passages: Passage[] = []
  const missing: string[] = []
  for (const relative of [...policy.referencePaths].sort(byCodePoint)) {
    if (!existsSync(join(root, relative))) {
      missing.push(relative)
      continue
    }
    for (const file of filesUnder(root, relative)) {
      passages.push(...passagesOf(file, readFileSync(join(root, file), 'utf8')))
    }
  }
  return { configured: policy.referencePaths.length > 0, passages, missing }
}

/** Lower-cased words: letters and digits of any script, split on everything else. */
export const wordsOf = (text: string): string[] =>
  text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '')

export function alreadyNamed(subject: string, fact: string, reference: Reference, policy: Policy): Naming {
  if (!reference.configured) {
    return {
      disposition: 'absent',
      where: null,
      note: 'No reference is configured (`referencePaths` in policy.json is empty), so nothing was checked.',
    }
  }
  const generic = new Set(policy.genericWords.map((w) => w.toLowerCase()))
  const subjectWords = wordsOf(subject).join(' ')
  const factWords = [...new Set(wordsOf(fact))].filter((w) => !generic.has(w))
  // A fact with fewer distinct words than the threshold can still be described: all of them, then.
  const needed = Math.max(1, Math.min(policy.strongMatchSharedWords, factWords.length))

  let mention: Passage | null = null
  for (const passage of reference.passages) {
    const words = wordsOf(passage.text)
    if (subjectWords === '' || !` ${words.join(' ')} `.includes(` ${subjectWords} `)) continue
    mention ??= passage
    const present = new Set(words)
    const shared = factWords.filter((w) => present.has(w))
    if (shared.length >= needed) {
      return {
        disposition: 'strong',
        where: `${passage.path}:${String(passage.line)}`,
        note:
          `The reference names the subject at ${passage.path}:${String(passage.line)} and shares` +
          ` ${String(shared.length)} of the fact's words there (${shared.sort(byCodePoint).join(', ')}): it already describes this.`,
      }
    }
  }
  if (mention !== null) {
    return {
      disposition: 'weak',
      where: `${mention.path}:${String(mention.line)}`,
      note:
        `The reference names the subject at ${mention.path}:${String(mention.line)} without describing` +
        ' this fact: a mention in passing. Read the two together before promoting.',
    }
  }
  return { disposition: 'absent', where: null, note: 'The reference does not name the subject.' }
}
