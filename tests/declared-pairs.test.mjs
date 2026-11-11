import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countDeclaredPairs, declaredInputs } from '../tools/declared-pairs.mjs'

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

test('keys each pair by its input bytes, as the spec writes one document per input', () => {
  const page = [
    '::: compare',
    '```carve', 'a', '```',
    '```html', '<p>a</p>', '```',
    ':::',
    '::: compare no-render',
    '```carve', 'a', '```',
    '```html', '<p>a</p>', '```',
    ':::',
    '::: compare crlf',
    '```carve', 'a', '```',
    '```html', '<p>a</p>', '```',
    ':::',
  ]
  assert.equal(countDeclaredPairs(page), 3)
  assert.equal(new Set(declaredInputs(page)).size, 2)
})

test('two modifier sets that write the same bytes are one input', () => {
  const block = (modifiers) => [`::: compare ${modifiers}`, '```carve', 'a', '```', '```html', '<p>a</p>', '```', ':::']
  const page = [...block('no-final-newline'), ...block('no-final-newline crlf')]
  assert.equal(new Set(declaredInputs(page)).size, 1)
})
