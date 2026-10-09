import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countDeclaredPairs } from '../tools/declared-pairs.mjs'

test('counts every pair in a block but not a fence inside an example', () => {
  const page = [
    '::: compare',
    '```carve', 'a', '```',
    '```html', '<p>a</p>', '```',
    '```carve', 'b', '```',
    '```html', '<p>b</p>', '```',
    '````carve', '```carve', 'not a pair', '```', '````',
    '```html', '<pre></pre>', '```',
    ':::',
    '```carve', 'outside any block', '```',
  ]
  assert.equal(countDeclaredPairs(page), 3)
})
