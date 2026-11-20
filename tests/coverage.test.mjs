// The checked-in TextMate snapshots cover every option-free render example of
// the spec commit pinned by the submodule. The vendor file is checked against
// that source here, so a stale copy cannot hide a conformance change.
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const sourcePath = join(root, 'spec', 'spec', '0.2', 'conformance', 'examples.json')
const vendorPath = join(root, 'tools', 'conformance-0.2.json')
const snapshotDir = join(here, 'snapshots-0.2')
const applicable = (examples) => examples.filter((example) =>
  example.kind === 'render' && Object.keys(example.options ?? {}).length === 0 &&
  typeof example.expected?.html === 'string')

test('0.2 spec submodule and render examples are present', () => {
  assert.ok(existsSync(sourcePath), `Missing ${sourcePath}; run git submodule update --init spec`)
  assert.ok(applicable(JSON.parse(readFileSync(sourcePath, 'utf8')).examples).length > 0)
})

test('vendored render cases equal the pinned 0.2 conformance source', () => {
  const source = applicable(JSON.parse(readFileSync(sourcePath, 'utf8')).examples)
  const vendor = JSON.parse(readFileSync(vendorPath, 'utf8')).examples
  assert.deepEqual(vendor, source.map((example) => ({
    id: example.id, input: example.input, html: example.expected.html,
    ...(example.expected.diagnostics?.length ? { diagnostics: example.expected.diagnostics } : {}),
  })))
})

test('every applicable 0.2 example has one committed input and token snapshot', () => {
  const examples = JSON.parse(readFileSync(vendorPath, 'utf8')).examples
  const ids = examples.map((example) => example.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate example IDs')
  for (const suffix of ['.crv', '.crv.snap']) {
    const actual = readdirSync(snapshotDir).filter((name) => name.endsWith(suffix))
      .map((name) => name.slice(0, -suffix.length)).sort()
    assert.deepEqual(actual, [...ids].sort(), `snapshot ${suffix} population differs from the spec`)
  }
})
