/**
 * A bare delimiter never pairs across a link destination or an autolink (PART 9
 * section 9 E2a), so `/see [x](http://a.b/c) now/` is one italic run. Expected
 * readings come from the spec's layout oracle. Parentheses nested three deep are
 * not recognized, by design.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wasm = readFileSync(resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm'))
await oniguruma.loadWASM(wasm.buffer)

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (source) => new oniguruma.OnigString(source),
  }),
  loadGrammar: async () => vsctm.parseRawGrammar(
    readFileSync(resolve(root, 'syntaxes/carve.tmLanguage.json'), 'utf8'),
    'carve.tmLanguage.json',
  ),
})
const grammar = await registry.loadGrammar('text.carve')

function covered(line, scope) {
  return grammar.tokenizeLine(line, vsctm.INITIAL).tokens
    .filter((token) => token.scopes.includes(scope) && !token.scopes.some((name) => name.startsWith('punctuation.')))
    .map((token) => line.slice(token.startIndex, token.endIndex))
    .join('')
}

const runs = [
  ['/', 'markup.italic.carve'],
  ['_', 'markup.underline.text.carve'],
  ['~', 'markup.strikethrough.carve'],
  ['=', 'markup.highlight.carve'],
  ['*', 'markup.bold.carve'],
]

const destinations = (d) => [
  `[x](http://a${d}.b/c)`,
  `[x](http://a.b/c${d})`,
  `<http://a${d}b/c>`,
  `<http://a.b/c${d}>`,
  `![x](a.png "t${d}u")`,
  `![x](a.png 't${d}u')`,
  `![x](a.png "t${d}")`,
  `![x](a.png 't${d}')`,
  `[x](foo(bar)${d}baz)`,
  `[x](foo(bar${d}))`,
  String.raw`[x](foo\)x${d}y)`,
  String.raw`[x](foo(bar(\x))${d}y)`,
  `<${'a'.repeat(40)}:x${d}y>`,
  `<${'a'.repeat(40)}:x${d}>`,
]

for (const [d, scope] of runs) {
  for (const destination of destinations(d)) {
    const source = `${d}see ${destination} now${d}`
    test(`${source} is one run`, () => {
      assert.equal(covered(source, scope), `see ${destination} now`)
    })
  }
}

test('an email autolink is opaque too', () => {
  assert.equal(covered('_see <me_@x.y> now_', 'markup.underline.text.carve'), 'see <me_@x.y> now')
})

// The other direction: the only closer sits inside the destination, so there is no run.
// Bold is left out because its begin/end rule opens without seeing a closer.
for (const [d, scope] of runs.slice(0, 4)) {
  const source = `${d}see [x](a${d}) now`
  test(`${source} is no run`, () => {
    assert.equal(covered(source, scope), '')
  })
}

test('bold italic keeps a delimiter inside the destination', () => {
  assert.equal(covered('/*see [x](a*/b) now*/', 'markup.bold.italic.carve'), 'see [x](a*/b) now')
})

test('bold italic does not close inside the destination', () => {
  assert.equal(covered('/*see [x](a*/b) now', 'markup.bold.italic.carve'), '')
})
