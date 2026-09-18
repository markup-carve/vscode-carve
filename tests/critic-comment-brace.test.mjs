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

// The text scoped as a comment, delimiters included, or null.
function comment(source) {
  let state = vsctm.INITIAL
  const parts = []
  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    for (const token of result.tokens) {
      if (token.scopes.some((scope) => /comment/.test(scope))) {
        parts.push(line.slice(token.startIndex, token.endIndex))
      }
    }
  }
  return parts.join('') || null
}

test('a closing brace in the payload does not end an editorial comment', () => {
  assert.equal(comment('a {# b} c #} d'), '{# b} c #}')
  assert.equal(comment('x{#id} y #} z'), '{#id} y #}')
  assert.equal(comment('a {#} b #} c'), '{#} b #}')
  assert.equal(comment('*a {# b} c #} d*'), '{# b} c #}')
  assert.equal(comment('a {# b #} c'), '{# b #}')
})

test('an attribute block is still an attribute block, and an empty pair is text', () => {
  assert.equal(comment('x{#id .c} y'), null)
  assert.equal(comment('*x*{#id} y #} z'), null)
  assert.equal(comment('[t]{#id} and #} z'), null)
  assert.equal(comment('a {##} b'), null)
})
