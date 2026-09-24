import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createTableMarkerScanner } from './table-colors.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

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
