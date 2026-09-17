// An unclosed `{%` inside a `*` run is text, so the run still closes at its
// `*`; a closed comment stays opaque and wins over a `*` inside it. Both
// readings were rendered through the executable grammar at carve 5d4fe3c.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await oniguruma.loadWASM(readFileSync(resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm')).buffer)

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

function covered(source, scope) {
  const lines = source.split('\n')
  let state = vsctm.INITIAL
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    return result.tokens
      .filter((token) => token.scopes.some((s) => s.startsWith(scope)))
      .map((token) => line.slice(token.startIndex, token.endIndex))
      .join('')
  }).join('\n')
}

test('an unclosed comment opener in a bold run leaves the closer alone', () => {
  assert.equal(covered('*a {% b* c', 'markup.bold'), 'a {% b')
  assert.equal(covered('*a {% b* c', 'comment.block.inline'), '')
  assert.equal(covered('a {% b', 'comment.block.inline'), '{% b')
})

test('a closed comment in a bold run keeps both scopes', () => {
  assert.equal(covered('*a {% b* c %} d*', 'comment.block.inline'), '{% b* c %}')
  assert.equal(covered('*a {% b* c %} d*', 'markup.bold'), 'a {% b* c %} d')
  assert.equal(covered('*a {% b\nc %} d*', 'comment.block.inline'), '{% b\nc %}')
})
