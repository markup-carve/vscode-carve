#!/usr/bin/env node
// Derive a release's notes from its CHANGELOG section.
//
// The notes and the CHANGELOG say the same thing to two different readers, and
// hand-writing the notes beside the section is how they drift: the release
// workflow refuses to publish without a draft, so the draft gets written first
// and the section gets reconciled later, or not at all. Deriving means a
// re-run reproduces the body byte for byte, and a byte delta is then evidence
// that one of the two moved.
//
// The CHANGELOG keeps Keep-a-Changelog section names for contributors; the
// notes use the three a reader deciding whether to upgrade wants, in the order
// Breaking, Fixes, Improvements. Every bullet is carried over with its wording
// intact, unwrapped to one line, with its bold lead-in flattened to plain text:
// the CHANGELOG bolds one per entry for scanning, and seven of them stacked on
// a release page is the bold-lead-in density the writing gate refuses.
//
// Usage: node scripts/release-notes.mjs <version>

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const version = process.argv[2]
if (!version) {
  console.error('usage: release-notes.mjs <version>')
  process.exit(2)
}

const die = (message) => {
  console.error(`release-notes: ${message}`)
  process.exit(1)
}

const REPO = 'https://github.com/markup-carve/vscode-carve'
// Added and Changed both read as "this got better" to someone upgrading, so
// they share a heading. Breaking comes first because it is the one a reader
// cannot afford to skim past.
const TARGET = [
  ['Breaking', ['Breaking', 'Removed']],
  ['Fixes', ['Fixed']],
  ['Improvements', ['Added', 'Changed']],
]

const lines = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').split('\n')
const heading = (line) => /^## \[([^\]]+)\]/.exec(line)?.[1]

const at = lines.findIndex((l) => heading(l) === version)
if (at === -1) die(`CHANGELOG.md has no "## [${version}]" section`)

const next = lines.findIndex((l, i) => i > at && heading(l) !== undefined)
const previous = next === -1 ? undefined : heading(lines[next])
if (previous === undefined) die(`no section follows ${version}, so there is no range to compare against`)

// Bullets wrap in the source and must not wrap in the notes, so a bullet runs
// until the next bullet, the next heading, or a blank line.
const sections = new Map()
let current
for (const line of lines.slice(at + 1, next === -1 ? lines.length : next)) {
  const sub = /^### (.+)$/.exec(line)
  if (sub) {
    current = sub[1].trim()
    sections.set(current, [])
    continue
  }
  if (current === undefined) continue
  const bucket = sections.get(current)
  if (line.startsWith('- ')) bucket.push(line.slice(2).trim())
  else if (line.trim() !== '' && bucket.length > 0) bucket[bucket.length - 1] += ` ${line.trim()}`
}

const unknown = [...sections.keys()].filter((name) => !TARGET.some(([, from]) => from.includes(name)))
if (unknown.length > 0) {
  // Silently dropping a section would lose entries from the notes while the
  // CHANGELOG still carried them, which is the drift this script exists to stop.
  die(`CHANGELOG section(s) ${unknown.join(', ')} map to no release-notes heading`)
}

const out = []
for (const [title, from] of TARGET) {
  const entries = from.flatMap((name) => sections.get(name) ?? [])
  if (entries.length === 0) continue
  out.push(`### ${title}`, '')
  for (const entry of entries) out.push(`- ${entry.replace(/\*\*(.+?)\*\*/g, '$1')}`)
  out.push('')
}
if (out.length === 0) die(`the ${version} section has no entries, so these notes would say nothing`)

out.push(`**Full Changelog**: ${REPO}/compare/v${previous}...v${version}`)
process.stdout.write(out.join('\n') + '\n')
