import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createTableMarkerScanner } from './table-colors.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const corpusDir = join(root, 'spec/tests/corpus')
const corpusFiles = readdirSync(corpusDir)
const corpus = (slug: string, variant = ''): string => {
  const file = corpusFiles.find((name) => name.endsWith(`${slug}${variant}.crv`))
  assert.ok(file, `Missing corpus case ${slug}${variant}`)
  return readFileSync(join(corpusDir, file), 'utf8')
}

test('table markers get colors in Carve fences and ordinary rows', async () => {
  const scan = await createTableMarkerScanner(root)
  const source = [
    '```carve',
    '|= Stage |= Owner |',
    '| Draft | < |',
    '```',
    '| Plain | Row |',
    '`| not a border |`',
    '```json',
    '| not a Carve table |',
    '```',
  ].join('\n')
  const markers = scan(source)
  const marked = (line: number, kind: 'boundary' | 'operator') => markers
    .filter((marker) => marker.line === line && marker.kind === kind)
    .map((marker) => source.split('\n')[line].slice(marker.start, marker.end))
  assert.deepEqual(marked(1, 'operator'), ['|=', '|='])
  assert.deepEqual(marked(1, 'boundary'), ['|'])
  assert.deepEqual(marked(2, 'operator'), ['<'])
  assert.deepEqual(marked(2, 'boundary'), ['|', '|', '|'])
  assert.deepEqual(marked(4, 'boundary'), ['|', '|', '|'])
  assert.deepEqual(marked(5, 'boundary'), [])
  assert.deepEqual(marked(7, 'boundary'), [])
  assert.deepEqual(scan(source, 'sample'), markers)
  assert.deepEqual(scan(source.replace('Draft', 'Final'), 'sample').filter((marker) => marker.line === 2).length, 4)
})

test('alignment markers are colored beside the header or boundary pipe', async () => {
  const scan = await createTableMarkerScanner(root)
  const lines = [
    '|=> Category |= Item |',
    '|> Right | Plain |',
    '```carve',
    '|=> Stage |= Owner |',
    '```',
    '|=?^ Heading |= Other |',
    '|?v Value | Other |',
    '| x |< |',
    '| a |< span |',
    '|^ x | y |',
    '|>x | y |',
    '|>{.x}y | z |',
  ]
  const markers = scan(lines.join('\n'))
  const marked = (line: number, kind: 'boundary' | 'operator') => markers
    .filter((marker) => marker.line === line && marker.kind === kind)
    .map((marker) => lines[line].slice(marker.start, marker.end))
  assert.deepEqual(marked(0, 'operator'), ['|=', '>', '|='])
  assert.deepEqual(marked(0, 'boundary'), ['|'])
  assert.deepEqual(marked(1, 'operator'), ['>'])
  assert.deepEqual(marked(1, 'boundary'), ['|', '|', '|'])
  assert.deepEqual(marked(3, 'operator'), ['|=', '>', '|='])
  assert.deepEqual(marked(5, 'operator'), ['|=', '?^', '|='])
  assert.deepEqual(marked(6, 'operator'), ['?v'])
  assert.deepEqual(marked(7, 'operator'), ['<'])
  assert.deepEqual(marked(8, 'operator'), ['<'])
  assert.deepEqual(marked(9, 'operator'), [])
  assert.deepEqual(marked(10, 'operator'), [])
  assert.deepEqual(marked(11, 'operator'), [])
})

test('an unclosed fence under an open container paragraph does not keep code colors', async () => {
  const scan = await createTableMarkerScanner(root)
  const lines = ['::: note', 'para', '```', 'code', '::::', ':::', 'after *b*']
  const markers = scan(lines.join('\n'))
  const marked = (line: number, kind: string) => markers
    .filter((marker) => marker.line === line && marker.kind === kind)
    .map((marker) => lines[line].slice(marker.start, marker.end))
  assert.deepEqual(marked(2, 'plain'), ['```'])
  assert.deepEqual(marked(3, 'plain'), ['code'])
  assert.deepEqual(marked(4, 'plain'), ['::::'])
  assert.deepEqual(marked(4, 'containerMarker'), ['::::'])
  assert.deepEqual(scan('- item\n  ```\n  code\n  ```').filter((marker) => marker.kind === 'plain'), [])
  assert.deepEqual(scan('```=html\n<b>x</b>\n```').filter((marker) => marker.kind === 'plain'), [])
  assert.deepEqual(scan('- item\n  ```=html\n  <b>x</b>\n  ```').filter((marker) => marker.kind === 'plain'), [])
  assert.deepEqual(scan('```js\na\n```\n^ caption').filter((marker) => marker.kind === 'plain'), [])
  assert.deepEqual(scan('```=html\n<b>x</b>\n```\n^ caption').filter((marker) => marker.kind === 'plain'), [])
  const open = '::: note\npara\n```\ncode'
  assert.ok(scan(open, 'editing').some((marker) => marker.kind === 'plain'))
  assert.deepEqual(scan(`${open}\n\`\`\``, 'editing').filter((marker) => marker.kind === 'plain'), [])
  assert.ok(scan(open, 'editing').some((marker) => marker.kind === 'plain'))
})

test('nested definition and list markers follow the parsed source layout', async () => {
  const scan = await createTableMarkerScanner(root)
  const lines = [':: t', ': - para', ' - li', '', '- a[^f]', '  - para', '    [^f]: n']
  const markers = scan(lines.join('\n'))
  const marked = (line: number, kind: string) => markers
    .filter((marker) => marker.line === line && marker.kind === kind)
    .map((marker) => lines[line].slice(marker.start, marker.end))
  assert.deepEqual(marked(1, 'listMarker'), ['- '])
  assert.deepEqual(marked(1, 'definitionMarker'), [])
  assert.deepEqual(marked(6, 'definitionMarker'), [])
  assert.deepEqual(scan('- [x] task').filter((marker) => marker.kind === 'listMarker'), [])
  assert.deepEqual(scan(':: t\n: d\n\n: orphan').filter((marker) => marker.line === 3 && marker.kind === 'definitionMarker'), [])
  const unicode = scan('😀\n\n- :: t\n  : para')
  assert.deepEqual(unicode.filter((marker) => marker.kind === 'definitionMarker')
    .map((marker) => [marker.line, marker.start]), [[2, 2], [3, 2]])
})

test('only parsed CSV and TSV tables receive table body highlighting', async () => {
  const scan = await createTableMarkerScanner(root)
  const lines = ['{table}', '```csv', 'a,b', '```', '', '```csv', 'x,y', '```', '', '{table}', '```tsv', 'a\tb', '```']
  const markers = scan(lines.join('\n'))
  const rows = markers.filter((marker) => marker.kind === 'tableBody')
    .map((marker) => [marker.line, lines[marker.line].slice(marker.start, marker.end)])
  assert.deepEqual(rows, [[2, 'a,b'], [11, 'a\tb']])
  const separators = markers.filter((marker) => marker.kind === 'boundary')
    .map((marker) => [marker.line, lines[marker.line].slice(marker.start, marker.end)])
  assert.deepEqual(separators, [[2, ','], [11, '\t']])
  assert.deepEqual(markers.filter((marker) => marker.kind === 'plain'), [])
  const quoted = scan('{table}\n```csv\n"Pear, green",3\n```')
  assert.deepEqual(quoted.filter((marker) => marker.kind === 'boundary')
    .map((marker) => marker.start), [13])
  for (const container of ['> {table}\n> ```csv\n> a,b\n> ```', '- {table}\n  ```csv\n  a,b\n  ```']) {
    const body = scan(container).filter((marker) => marker.kind === 'tableBody')
    assert.deepEqual(body.map((marker) => [marker.start, container.split('\n')[marker.line].slice(marker.start, marker.end)]), [[2, 'a,b']])
  }
})

test('the pinned corpus keeps the editor corrections and their negative boundaries', async () => {
  const scan = await createTableMarkerScanner(root)
  const unclosed = corpus('an-unclosed-fence-under-an-open-paragraph-in-a-container-opens-nothing')
  assert.ok(scan(unclosed).some((marker) => marker.kind === 'plain'))
  const nested = corpus('a-line-is-read-in-the-container-whose-column-it-reaches', '-4')
  assert.ok(scan(nested).some((marker) => marker.kind === 'listMarker'))
  const table = corpus('csv-and-tsv-table-bodies', '-2')
  assert.ok(scan(table).some((marker) => marker.kind === 'tableBody'))
  const plainCsv = corpus('csv-and-tsv-table-bodies', '-3')
  assert.deepEqual(scan(plainCsv).filter((marker) => marker.kind === 'tableBody'), [])
})
