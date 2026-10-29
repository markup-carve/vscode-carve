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
    .filter((marker) => marker.line === line && (marker.kind === kind || (kind === 'operator' && marker.kind.startsWith('table'))))
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

test('editor marker roles match the shared Carve palette', async () => {
  const scan = await createTableMarkerScanner(root)
  const source = '- [ ] +\n> Attached quote\n\n- [x] done\n\n. ordered\n\n|=> 2-col header|<|=> header|\n| value | | value |'
  const lines = source.split('\n')
  const tokens = scan(source).map(({ line, start, end, kind }) => [kind, lines[line].slice(start, end)])
  for (const pair of [
    ['listPunctuation', '-'], ['listPunctuation', '.'], ['taskOpen', ' '],
    ['taskDone', 'x'], ['continuationMarker', '+'], ['quoteMarker', '>'],
    ['tableHeader', '|='], ['tableAlignment', '>'], ['tableSpan', '<'],
  ]) assert.ok(tokens.some((token) => token[0] === pair[0] && token[1] === pair[1]), pair.join(': '))
  assert.deepEqual(scan('```js\n- [ ] +\n|=> header|<|\n```').filter((marker) =>
    ['listPunctuation', 'taskOpen', 'continuationMarker', 'tableHeader', 'tableSpan'].includes(marker.kind)), [])
})

test('a standalone plus gets a continuation color only when the parser accepts it', async () => {
  const scan = await createTableMarkerScanner(root)
  const markers = (source: string) => scan(source).filter((marker) => marker.kind === 'continuationMarker')
  assert.deepEqual(markers('- item\n+\n> attached').map((marker) => marker.line), [1])
  assert.deepEqual(markers('> - item\n> +\n> > attached').map((marker) => marker.line), [1])
  assert.deepEqual(markers('- item\n+').map((marker) => marker.line), [])
  assert.deepEqual(markers('+\nplain').map((marker) => marker.line), [])
  assert.deepEqual(markers('> +\n> plain').map((marker) => marker.line), [])
  assert.deepEqual(markers('```\n+\n```').map((marker) => marker.line), [])
})

test('description markers keep their own color role', async () => {
  const scan = await createTableMarkerScanner(root)
  const source = ':: Term\n: body text\n\n- item'
  const markers = scan(source)
  assert.deepEqual(markers.filter((marker) => marker.kind === 'listPunctuation').map((marker) => marker.line), [3])
})

test('only x task states use the checked color', async () => {
  const scan = await createTableMarkerScanner(root)
  const roles = { ' ': 'taskOpen', '-': 'taskDropped', '_': 'taskOpen', '>': 'taskDeferred', '?': 'taskUncertain', '/': 'taskProgress', '!': 'taskBlocked', x: 'taskDone', X: 'taskDone' } as const
  for (const [state, role] of Object.entries(roles)) {
    assert.ok(scan(`- [${state}] task`).some((item) => item.kind === role), state)
  }
  assert.ok(scan('| a | b |\n+ | | continued |').some((item) => item.kind === 'tableContinuation'))
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
    .filter((marker) => marker.line === line && (marker.kind === kind || (kind === 'operator' && marker.kind.startsWith('table'))))
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

test('task marker characters receive their own editor colors', async () => {
  const scan = await createTableMarkerScanner(root)
  for (const [state, kind] of [
    [' ', 'taskOpen'], ['_', 'taskOpen'], ['/', 'taskProgress'],
    ['!', 'taskBlocked'], ['x', 'taskDone'], ['-', 'taskDropped'],
    ['>', 'taskDeferred'], ['?', 'taskUncertain'],
  ] as const) {
    const source = `- [${state}] task`
    assert.deepEqual(scan(source).filter((marker) => marker.kind === kind)
      .map((marker) => source.slice(marker.start, marker.end)), [state])
  }
  assert.deepEqual(scan('- [|] literal').filter((marker) => marker.kind.startsWith('task')), [])
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

test('source positions agree for LF and CRLF documents', async () => {
  const scan = await createTableMarkerScanner(root)
  for (const source of ['- :: t\n  : para\n', '{table}\n```csv\na,b\n```']) {
    const lf = scan(source)
    assert.ok(lf.some((marker) => marker.kind === 'definitionMarker' || marker.kind === 'tableBody'))
    assert.deepEqual(lf, scan(source.replaceAll('\n', '\r\n')))
  }
})

test('a parser failure leaves existing TextMate table colors available', async (t) => {
  const log = t.mock.method(console, 'error', () => {})
  const scan = await createTableMarkerScanner(root, () => { throw new Error('parse failed') })
  const markers = scan('| A | B |', 'failed-parser')
  assert.deepEqual(markers.filter((marker) => marker.kind === 'boundary').map((marker) => marker.start), [0, 4, 8])
  assert.deepEqual(markers.filter((marker) => marker.kind === 'plain'), [])
  assert.deepEqual(scan('| A | B |', 'failed-parser'), markers)
  assert.ok(scan('| C | D |', 'failed-parser').some((marker) => marker.kind === 'boundary'))
  assert.equal(log.mock.callCount(), 1)
})

test('diff decorations mark only added and removed source prefixes', async () => {
  const scan = await createTableMarkerScanner(root)
  const source = '{.diff}\n```js\n  let fileIcon = 1;\n- fileIcon.old();\n+ fileIcon.new();\n  + unchanged;\n```'
  const markers = scan(source).filter((marker) => marker.kind === 'diffAdd' || marker.kind === 'diffRemove')
  assert.deepEqual(markers.map((marker) => [marker.line, marker.start, marker.kind]), [
    [3, 0, 'diffRemove'],
    [4, 0, 'diffAdd'],
  ])
  assert.deepEqual(scan('```js\n+ ordinaryOperator\n```').filter((marker) => marker.kind === 'diffAdd'), [])

  const captioned = '{#lst .diff}\n```js\n- old();\n+ new();\n```\n^ Listing #: cap'
  assert.deepEqual(scan(captioned).filter((marker) => marker.kind === 'diffAdd' || marker.kind === 'diffRemove')
    .map((marker) => [marker.line, marker.start, marker.kind]), [[2, 0, 'diffRemove'], [3, 0, 'diffAdd']])
  const sideDiff = captioned.replace('.diff', '.side-diff')
  assert.deepEqual(scan(sideDiff).filter((marker) => marker.kind === 'diffAdd' || marker.kind === 'diffRemove'), [])

  const nested = '- Item\n\n  {.diff}\n  ```js\n  - old();\n  + new();\n  ```'
  assert.deepEqual(scan(nested).filter((marker) => marker.kind === 'diffAdd' || marker.kind === 'diffRemove')
    .map((marker) => [marker.line, marker.start, marker.kind]), [[4, 2, 'diffRemove'], [5, 2, 'diffAdd']])

  const quoted = '> {.diff}\n> ```js\n> - old();\n> + new();\n> ```'
  assert.deepEqual(scan(quoted).filter((marker) => marker.kind === 'diffAdd' || marker.kind === 'diffRemove')
    .map((marker) => [marker.line, marker.start, marker.kind]), [[2, 2, 'diffRemove'], [3, 2, 'diffAdd']])
})
