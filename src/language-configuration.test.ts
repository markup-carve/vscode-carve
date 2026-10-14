import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const config = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'language-configuration', 'carve.json'),
  'utf8',
)) as {
  comments: { lineComment?: string; blockComment?: [string, string] }
  autoClosingPairs: { open: string; close: string }[]
  surroundingPairs: [string, string][]
  folding: { markers: { start: string; end: string } }
}

const start = new RegExp(config.folding.markers.start)
const end = new RegExp(config.folding.markers.end)

test('a colon fence opener starts a fold and its bare closer does not', () => {
  // VS Code tests the start pattern first, so a closer it matches opens a new
  // fold instead of closing the one above it.
  for (const opener of ['::: note', '::: |', '::: >', '::: \\', ':::: figure', '  ::: tip Title', '::: {.x}']) {
    assert.ok(start.test(opener), opener)
    assert.ok(!end.test(opener), opener)
  }
  for (const closer of [':::', '::::', '  :::', '::: ']) {
    assert.ok(end.test(closer), closer)
    assert.ok(!start.test(closer), closer)
  }
})

test('the comment toggle writes a %% line comment', () => {
  assert.equal(config.comments.lineComment, '%%')
})

test('a dollar sign is not auto-closed: inline math is $`x`', () => {
  assert.ok(!config.autoClosingPairs.some((pair) => pair.open === '$'))
  assert.ok(!config.surroundingPairs.some(([open]) => open === '$'))
})
