import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { lintCarve } from '@markup-carve/carve'

import { renderPreviewBody } from './preview.js'

// The walkthrough and the guide point users at this file as the tour of every construct.
const demo = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'demo.crv'),
  'utf8',
)

test('the demo document lints without findings', () => {
  assert.deepEqual(lintCarve(demo).map((w) => `${w.line}: ${w.rule}`), [])
})

test('the demo document builds the constructs it advertises', () => {
  const html = renderPreviewBody(demo)
  for (const id of ['top', 'headings', 'inline', 'comments', 'links', 'lists', 'quotes', 'tables', 'code', 'math', 'admonitions', 'tokens', 'footnotes', 'typography', 'mermaid']) {
    assert.match(html, new RegExp(`id="${id}"`), `no element with id ${id}`)
  }
  assert.match(html, /<details><summary>Native HTML<\/summary>/)
  assert.match(html, /<div id="callout" class="highlight">/)
  assert.doesNotMatch(html, /\{<span class="tag">/)
})
