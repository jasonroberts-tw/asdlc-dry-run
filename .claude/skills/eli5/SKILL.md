---
name: eli5
description: Explain it like I'm 5 - re-explain the last turn's output in much plainer, more explanatory terms, or explain one term or topic when given. Use when asked to "eli5", "explain that", "dumb it down", or when the user says the last reply was too dense or assumed too much.
argument-hint: "[term or topic]"
---

Read CLAUDE.md first. Everything below is subordinate to it and points at it rather than restating it.

# Explain it like I'm 5

The reader is bright and willing, and is missing the background the last reply took for granted.
The job is to supply that background, not to say the same thing again in shorter words.

## What to explain

- **No argument:** the subject is your last substantive reply in this conversation: the one
  before the request for this skill, not the request itself. If that reply was mostly tool output
  or a diff, explain what was done and why, not the raw output.
- **An argument:** the subject is that term or topic, explained **as it was used in this
  conversation** first, and in general second. If the term never appeared in the conversation,
  say so in one line and explain it in general. If it could mean two things here, name both and
  explain the likelier one.
- **Nothing to explain** (no earlier reply, and no argument): ask what to explain. Do not pick a
  topic.

## How to explain it

1. **Open with the point in one or two plain sentences.** What happened, or what the thing is,
   and why the reader should care. No preamble and no "great question".
2. **Define every term the first time it appears**, in words that do not need defining
   themselves. A project name (`bd`, a gate, an emitter, a `CNT-*` key) counts as a term: say
   what it is here before using it.
3. **Give the why behind each step.** The dense version said what; this one says what it is for
   and what would go wrong without it.
4. **Use one concrete analogy or worked example** where it carries the idea, and say where the
   analogy stops being true. Skip it when the plain statement is already clear; never stack
   several.
5. **Walk in order.** Short paragraphs, one idea each, each building on the one before. Keep
   code, commands and paths only where the reader needs them, and say what each one does.
6. **Close with what it means for the reader**: what changes, or what they do next, if anything.

Longer than the original is expected. Padding is not: every added sentence supplies something
the reader was missing.

## What never changes

- **Simplify the wording, never the facts.** A caveat, a failure, a skipped step or an
  uncertainty in the original survives in plain words. If a simplification is only roughly true,
  say "roughly".
- **Add no new claims.** A figure or status repeated from the last reply is repeated exactly;
  anything new is re-derived under `CLAUDE.md` § Verification before claiming, or left out.
- **Explain; do not act.** This skill edits no file, runs no gate and writes nothing to the
  tracker. If explaining turns up a mistake in the last reply, say so plainly and stop there.
- **Do not talk down.** Plain is not childish: no baby talk, no "simply", no "just".
