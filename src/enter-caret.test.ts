import assert from 'node:assert/strict'
import test from 'node:test'
import { enterCaretTarget, parkedCaret, type CaretEdit, type CaretPosition } from './enter-caret.js'

const at = (line: number, character: number): CaretPosition => ({ line, character })
const insert = (p: CaretPosition, newText: string): CaretEdit => ({ range: { start: p, end: p }, newText })

test('a closer inserted at the caret on the last line leaves the caret on the body line', () => {
  assert.deepEqual(enterCaretTarget(at(1, 0), [insert(at(1, 0), '\n:::')]), at(1, 0))
})

test('a code fence closer leaves the caret on the body line', () => {
  assert.deepEqual(enterCaretTarget(at(1, 0), [insert(at(1, 0), '\n```')]), at(1, 0))
})

test('a quoted closer keeps its lead in front of the caret', () => {
  assert.deepEqual(enterCaretTarget(at(1, 0), [insert(at(1, 0), '> \n> :::')]), at(1, 2))
})

test('a list item lead in front of a closer counts from the caret column', () => {
  assert.deepEqual(enterCaretTarget(at(3, 2), [insert(at(3, 2), '  \n  :::')]), at(3, 4))
})

test('CRLF answers split at the first line break', () => {
  assert.deepEqual(enterCaretTarget(at(1, 0), [insert(at(1, 0), '> \r\n> :::')]), at(1, 2))
})

test('the split answer for a document with a next line keeps the default', () => {
  // carve-lsp sends the lead at the caret and the closer at the next line start.
  const edits = [insert(at(1, 0), '> '), insert(at(2, 0), '> :::\n')]
  assert.equal(enterCaretTarget(at(1, 0), edits), undefined)
})

test('a list continuation without a newline keeps the default', () => {
  assert.equal(enterCaretTarget(at(1, 0), [insert(at(1, 0), '- ')]), undefined)
})

test('no edits keep the default', () => {
  assert.equal(enterCaretTarget(at(1, 0), []), undefined)
})

test('an insert somewhere else keeps the default', () => {
  assert.equal(enterCaretTarget(at(1, 0), [insert(at(1, 3), '\n:::')]), undefined)
})

test('a replacement around the caret keeps the default', () => {
  const edit: CaretEdit = { range: { start: at(1, 0), end: at(1, 4) }, newText: '\n:::' }
  assert.equal(enterCaretTarget(at(1, 2), [edit]), undefined)
})

test('another edit before the caret keeps the default', () => {
  assert.equal(enterCaretTarget(at(1, 0), [insert(at(0, 0), 'x'), insert(at(1, 0), '\n:::')]), undefined)
})

test('two inserts at the caret keep the default', () => {
  assert.equal(enterCaretTarget(at(1, 0), [insert(at(1, 0), '> '), insert(at(1, 0), '\n> :::')]), undefined)
})

test('the language client routes on-type answers through enterCaretTarget', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8')
  assert.match(source, /provideOnTypeFormattingEdits:/)
  assert.match(source, /enterCaretTarget\(position, edits\)/)
})

test('VS Code parks the caret after the whole insert', () => {
  assert.deepEqual(parkedCaret(at(1, 0), '\n:::'), at(2, 3))
  assert.deepEqual(parkedCaret(at(1, 0), '> \r\n> :::'), at(2, 5))
  assert.deepEqual(parkedCaret(at(1, 4), '- '), at(1, 6))
})
