import assert from 'node:assert/strict'
import test from 'node:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { columnColorGroups, delimitedColumnRanges } from './delimited-columns.js'
import { createTableMarkerScanner } from './table-colors.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const fields = (lines: string[], separator: ',' | '\t') => delimitedColumnRanges(lines, separator)
  .map((range) => [range.line, range.column, lines[range.line].slice(range.start, range.end)])

test('a quoted comma stays inside its column', () => {
  assert.deepEqual(fields(['a,"b, c",d'], ','), [[0, 0, 'a'], [0, 1, '"b, c"'], [0, 2, 'd']])
})

test('columns after a quoted line break keep their index', () => {
  assert.deepEqual(fields(['a,"b', 'c",d', 'e,f'], ','), [
    [0, 0, 'a'], [0, 1, '"b'], [1, 1, 'c"'], [1, 2, 'd'], [2, 0, 'e'], [2, 1, 'f'],
  ])
})

test('an escaped quote does not close the field', () => {
  assert.deepEqual(fields(['"say ""hi"", ok",x'], ','), [[0, 0, '"say ""hi"", ok"'], [0, 1, 'x']])
})

test('a tsv body splits on tabs only', () => {
  assert.deepEqual(fields(['a,b\tc', 'd\t"e\tf"'], '\t'), [[0, 0, 'a,b'], [0, 1, 'c'], [1, 0, 'd'], [1, 1, '"e\tf"']])
})

test('a CRLF line ending is not part of the last field', () => {
  assert.deepEqual(fields(['a,b\r', 'c,d\r'], ','), [[0, 0, 'a'], [0, 1, 'b'], [1, 0, 'c'], [1, 1, 'd']])
})

test('invalid quoting colors nothing, as the engine keeps it a code block', () => {
  assert.deepEqual(fields(['a"b,c'], ','), [])
  assert.deepEqual(fields(['"open,c'], ','), [])
})

test('the setting off yields no column decorations, and colors cycle past the palette', () => {
  const markers = [0, 1, 2, 3].map((column) => ({ kind: 'delimitedColumn', column }))
  assert.deepEqual(columnColorGroups(markers, false, 3), [[], [], []])
  assert.deepEqual(columnColorGroups(markers, true, 3).map((group) => group.map((m) => m.column)), [[0, 3], [1], [2]])
  assert.deepEqual(columnColorGroups([{ kind: 'boundary' }], true, 3), [[], [], []])
})

test('the scanner marks columns in csv code, {table} tsv and quoted fences', async () => {
  const scan = await createTableMarkerScanner(root)
  const source = [
    '```csv',
    'a,"b',
    'c",d',
    '```',
    '',
    '{table}',
    '```tsv',
    'x\ty',
    '```',
    '',
    '> ```csv',
    '> p,q',
    '> ```',
    '',
    '```json',
    '{"a,b": 1}',
    '```',
  ].join('\n')
  const lines = source.split('\n')
  const columns = scan(source)
    .filter((marker) => marker.kind === 'delimitedColumn')
    .map((marker) => [marker.line, marker.column, lines[marker.line].slice(marker.start, marker.end)])
  assert.deepEqual(columns, [
    [1, 0, 'a'], [1, 1, '"b'], [2, 1, 'c"'], [2, 2, 'd'],
    [7, 0, 'x'], [7, 1, 'y'],
    [11, 0, 'p'], [11, 1, 'q'],
  ])
})
