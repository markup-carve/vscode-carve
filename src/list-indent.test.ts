import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isListItemLine,
  listIndentEdits,
  mergeListIndentEdits,
  selectedListLines,
  serverHasListIndent,
  useDefaultKey,
  type LspRange,
  type LspTextEdit,
} from './list-indent.js'

const items = [
  '-', '- ', '- a', '* a', '1. a', '10) a', 'a. a', 'B) a', 'iv. a', 'XII) a', '. a', '.',
  '- [ ] todo', '- [x] done', '- [>] moved', '- [?] q', '- [-] gone', '- [X]', '- [_] x',
  '  - nested', '> - quoted', '> > 1. deep', '- - a',
]
const notItems = [
  '', 'text', '+ a', '+', '-a', '1.5 apples', '(1) a', '---', '- - -', '* * *', '_ _ _',
  'ab. a', 'Iv. a', '> ', '> text', '-\ta', '1', 'text - a',
]

for (const line of items) {
  test(`list item line: ${JSON.stringify(line)}`, () => {
    assert.equal(isListItemLine(line), true)
  })
}

for (const line of notItems) {
  test(`not a list item line: ${JSON.stringify(line)}`, () => {
    assert.equal(isListItemLine(line), false)
  })
}

const at = (line: number, character = 0): LspRange => ({
  start: { line, character },
  end: { line, character },
})
const span = (fromLine: number, fromChar: number, toLine: number, toChar: number): LspRange => ({
  start: { line: fromLine, character: fromChar },
  end: { line: toLine, character: toChar },
})

test('a cursor on a list line selects that line only', () => {
  const text = '- a\n- b\ntext\n'
  assert.deepEqual(selectedListLines(text, [at(1, 3)]), [1])
  assert.deepEqual(selectedListLines(text, [at(2, 1)]), [])
})

test('a multi-line selection keeps the list lines it covers', () => {
  const text = '- a\n  more\n- b\n- c\n'
  assert.deepEqual(selectedListLines(text, [span(0, 1, 2, 2)]), [0, 2])
})

test('a selection or cursor that does not start on a list line selects nothing', () => {
  const text = 'para\n- a\n- b\n'
  assert.deepEqual(selectedListLines(text, [span(0, 0, 2, 1)]), [])
  assert.deepEqual(selectedListLines(text, [at(1), at(0)]), [])
  assert.deepEqual(selectedListLines(text, []), [])
})

test('a selection ending at column 0 leaves that line out', () => {
  assert.deepEqual(selectedListLines('- a\n- b\n- c\n', [span(0, 0, 2, 0)]), [0, 1])
  assert.deepEqual(selectedListLines('- a\n- b\n', [span(1, 0, 0, 0)]), [0])
})

test('multiple cursors collect each line once, ascending', () => {
  assert.deepEqual(selectedListLines('- a\n- b\n- c\n', [at(2), at(0), at(2, 2)]), [0, 2])
})

test('list lines inside a code fence are left alone', () => {
  const text = '- a\n```\n- b\n```\n- c\n'
  assert.deepEqual(selectedListLines(text, [span(0, 0, 4, 1)]), [0, 4])
  assert.deepEqual(selectedListLines(text, [at(2)]), [])
})

test('out-of-range selections select nothing', () => {
  assert.deepEqual(selectedListLines('- a', [at(5)]), [])
})

const edit = (line: number, from: number, to: number, newText: string): LspTextEdit => ({
  range: span(line, from, line, to),
  newText,
})
const uri = 'file:///doc.crv'

test('a TextEdit[] answer is taken as is', () => {
  const edits = [edit(1, 0, 0, '  ')]
  assert.deepEqual(listIndentEdits(edits, uri), edits)
})

test('null, an empty list and acknowledgements read as no edit', () => {
  for (const answer of [null, undefined, [], true, false, 0, {}, 'ok', { applied: true }]) {
    assert.deepEqual(listIndentEdits(answer, uri), [], JSON.stringify(answer))
  }
})

test('a WorkspaceEdit answer yields the edits for this document', () => {
  const edits = [edit(1, 0, 0, '  ')]
  assert.deepEqual(listIndentEdits({ changes: { [uri]: edits, 'file:///other.crv': [] } }, uri), edits)
  assert.deepEqual(listIndentEdits({ changes: { 'file:///doc%2Ecrv': edits } }, uri), edits)
  assert.deepEqual(
    listIndentEdits({ documentChanges: [{ textDocument: { uri, version: 3 }, edits }] }, uri),
    edits,
  )
  assert.deepEqual(listIndentEdits({ changes: {} }, uri), [])
  assert.deepEqual(
    listIndentEdits({ changes: { 'file:///C%3A/doc.crv': edits } }, 'file:///c:/doc.crv'),
    edits,
  )
})

test('edits for another document are never taken', () => {
  const edits = [edit(1, 0, 0, '  ')]
  assert.deepEqual(listIndentEdits({ changes: { 'file:///other.crv': edits } }, uri), [])
  assert.deepEqual(
    listIndentEdits({ documentChanges: [{ textDocument: { uri: 'file:///other.crv' }, edits }] }, uri),
    [],
  )
})

test('malformed edits in an answer are dropped', () => {
  const good = edit(0, 0, 0, '  ')
  assert.deepEqual(listIndentEdits([good, { newText: 'x' }, null, { range: good.range }], uri), [good])
})

test('per-line answers merge into one edit', () => {
  const a = [edit(1, 0, 0, '  ')]
  const b = [edit(3, 0, 0, '  ')]
  assert.deepEqual(mergeListIndentEdits([a, [], b]), [...a, ...b])
})

test('an answer overlapping an earlier one is dropped whole', () => {
  const parent = [edit(1, 0, 0, '  '), edit(2, 0, 0, '  ')]
  const child = [edit(2, 0, 0, '  ')]
  assert.deepEqual(mergeListIndentEdits([parent, child]), parent)
  const replace = [edit(4, 0, 2, '')]
  const inside = [edit(4, 1, 1, ' ')]
  assert.deepEqual(mergeListIndentEdits([replace, inside]), replace)
})

test('only a server that lists carve.listIndent is asked', () => {
  assert.equal(serverHasListIndent(['carve.previewHtml', 'carve.listIndent']), true)
  assert.equal(serverHasListIndent(['carve.previewHtml', 'carve.showAst']), false)
  assert.equal(serverHasListIndent(undefined), false)
})

test('the key falls back when the server cannot or did not edit', () => {
  assert.equal(useDefaultKey({ serverReady: false, edits: 0, documentChanged: false }), true)
  assert.equal(useDefaultKey({ serverReady: true, edits: 0, documentChanged: false }), true)
  assert.equal(useDefaultKey({ serverReady: true, edits: 2, documentChanged: false }), false)
  assert.equal(useDefaultKey({ serverReady: true, edits: 0, documentChanged: true }), false)
})
