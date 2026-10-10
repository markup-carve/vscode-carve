import assert from 'node:assert/strict'
import test from 'node:test'
import { isBareListMarker, isInsideCodeFence, shouldHoldRender } from './preview-hold.js'

const bare = [
  '-', '- ', '*', '* ', '-\t',
  '1.', '2. ', '10)', 'a.', 'B)', 'i.', 'iv) ', 'XII.', '.', '. ',
  '- [ ]', '- [ ] ', '* [x]', '- [X]',
  '  - ', '    1. ', '> - ', '> > 1.',
]
const notBare = [
  '', ' ', '+', '+ ', '- a', '1. one', '- [ ] todo', '-a', '--', '---', '* * *', '- - -',
  'ab.', '1', 'a', '-[ ]', 'text -', '> ', '- [y]',
]

for (const line of bare) {
  test(`bare marker: ${JSON.stringify(line)}`, () => {
    assert.equal(isBareListMarker(line), true)
  })
}

for (const line of notBare) {
  test(`not a bare marker: ${JSON.stringify(line)}`, () => {
    assert.equal(isBareListMarker(line), false)
  })
}

test('a fence opener puts the following lines inside the fence until its closer', () => {
  const lines = ['- a', '```', '- ', '```', '- ']
  assert.equal(isInsideCodeFence(lines, 0), false)
  assert.equal(isInsideCodeFence(lines, 2), true)
  assert.equal(isInsideCodeFence(lines, 4), false)
})

test('a fence closes only on the same character, at least as long, with nothing after it', () => {
  const lines = ['````', '~~~~', '``` js', '```', '-']
  assert.equal(isInsideCodeFence(lines, 4), true)
  assert.equal(isInsideCodeFence(['````', '`````', '-'], 2), false)
})

test('a fence opened on a list-item line still counts', () => {
  assert.equal(shouldHoldRender('- ```\n  - \n  ```\n', 1), false)
  assert.equal(shouldHoldRender('1. [ ] ~~~\n  1.\n', 1), false)
  assert.equal(isInsideCodeFence(['- ```', '  x', '  ```', '- '], 3), false)
})

test('a marker line is not a fence closer', () => {
  assert.equal(isInsideCodeFence(['```', '- ```', '-'], 2), true)
})

test('an unclosed fence runs to the end', () => {
  assert.equal(isInsideCodeFence(['~~~', 'x', 'y', '-'], 3), true)
})

test('the render holds on a bare marker typed under a list', () => {
  const text = '- first\n- second\n- '
  assert.equal(shouldHoldRender(text, 2), true)
  assert.equal(shouldHoldRender(text, 1), false)
  assert.equal(shouldHoldRender('- first\n- second\n- t', 2), false)
})

test('the render does not hold on a marker inside a code fence', () => {
  assert.equal(shouldHoldRender('```\n- \n```\n', 1), false)
})

test('the render does not hold for an out-of-range line', () => {
  assert.equal(shouldHoldRender('- ', 3), false)
  assert.equal(shouldHoldRender('- ', -1), false)
})

test('CRLF line endings split like LF', () => {
  assert.equal(shouldHoldRender('- a\r\n- \r\n', 1), true)
})
