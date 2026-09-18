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

// `i` italic, `b` bold, `u` underline, `s` strikethrough or deletion,
// `h` highlight, `n` insertion, `c` code; `d` is a delimiter, where either
// reading is allowed. A kind a row does not list must not appear.
const kinds = (scopes) => {
  const has = (name) => scopes.includes(name)
  const out = new Set()
  if (has('markup.italic.carve') || has('markup.bold.italic.carve')) out.add('i')
  if (has('markup.bold.carve') || has('markup.bold.italic.carve')) out.add('b')
  if (has('markup.underline.text.carve')) out.add('u')
  if (has('markup.strikethrough.carve') || has('markup.deleted.carve')) out.add('s')
  if (has('markup.inserted.carve')) out.add('n')
  if (has('markup.highlight.carve')) out.add('h')
  if (scopes.some((scope) => /^markup\.(raw\.inline|other\.math)/.test(scope))) out.add('c')
  return out
}

function perCharacter(source) {
  const result = grammar.tokenizeLine(source, vsctm.INITIAL)
  const out = []
  for (const token of result.tokens) {
    for (let i = token.startIndex; i < token.endIndex; i++) out.push(kinds(token.scopes))
  }
  return out
}

function check(source, masks) {
  const got = perCharacter(source)
  const first = Object.values(masks)[0]
  const want = [...first].map((cell, i) => (cell === 'd' ? 'd' : [...new Set(
    Object.entries(masks).filter(([, mask]) => mask[i] !== '.' && mask[i] !== 'd').map(([kind]) => kind),
  )].sort().join('') || '.'))
  const seen = want.map((cell, i) => (cell === 'd' ? 'd' : [...(got[i] ?? [])].sort().join('') || '.'))
  assert.deepEqual(seen, want, JSON.stringify(source))
}

test('a braced span of another kind is an atom the outer closer cannot reach into', () => {
  check('{*a {/b*} c/} d*}', { b: 'ddbbddbbbbbddbbdd', i: 'dd..ddiiiiidd..dd' })
  check('{/a {_b/} c_} d/}', { i: 'ddiiddiiiiiddiidd', u: 'dd..dduuuuudd..dd' })
  check('{_a {=b_} c=} d_}', { h: 'dd..ddhhhhhdd..dd', u: 'dduudduuuuudduudd' })
  check('{~a {*b~} c*} d~}', { b: 'dd..ddbbbbbdd..dd', s: 'ddssddsssssddssdd' })
  check('{=a {~b=} c~} d=}', { h: 'ddhhddhhhhhddhhdd', s: 'dd..ddsssssdd..dd' })
  check('{^a {/b^} c/} d^}', { i: 'dd..ddiiiiidd..dd' })
  check('{,a {-b,} c-} d,}', { s: 'dd..ddsssssdd..dd' })
})

test('a braced atom nests, and the span keeps its own delimiter as content', () => {
  check('{*a {/b {*c*} d/} e*}', { b: 'ddbbddbbddbddbbddbbdd', i: 'dd..ddiiddiddiidd..dd' })
  check('{*a *b* c*}', { b: 'ddbbbbbbbdd' })
})

test('an insertion or deletion has no atoms and closes at its first closer', () => {
  check('{+a {-b+} c-} d+}', { n: 'ddnnnnndd........' })
  check('{-a {*b-} c*} d-}', { s: 'ddsssssdd........' })
})
