import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

await oniguruma.loadWASM(readFileSync(resolve('node_modules/vscode-oniguruma/release/onig.wasm')).buffer)
const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (source) => new oniguruma.OnigString(source),
  }),
  loadGrammar: async () => vsctm.parseRawGrammar(readFileSync(resolve('syntaxes/carve.tmLanguage.json'), 'utf8'), 'carve.tmLanguage.json'),
})
const grammar = await registry.loadGrammar('source.carve')

function tokens(source) {
  let state = vsctm.INITIAL
  return source.split('\n').flatMap((line) => {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    return result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }))
  })
}
const covered = (source, scope) => tokens(source).filter((token) => token.scopes.includes(scope)).map((token) => token.text).join('')

test('snippet definitions and uses have their own scopes', () => {
  const source = '{$ver}: 0.2.3\n\nUse {{ $ver }}.\n'
  assert.equal(covered(source, 'meta.snippet.definition.carve'), '{$ver}: 0.2.3')
  assert.equal(covered(source, 'meta.snippet.use.carve'), '{{ $ver }}')
  assert.equal(covered(source, 'variable.other.snippet.carve'), 'ver$ver')
  assert.equal(covered(source, 'string.other.link.include.carve'), '')
})

test('other names and includes remain distinct', () => {
  assert.equal(covered('{$a_b}: value\n', 'variable.other.snippet.carve'), 'a_b')
  assert.equal(covered('Use {{ $a_b }}.\n', 'meta.snippet.use.carve'), '{{ $a_b }}')
  assert.equal(covered('Use {{ chapter.crv }}.\n', 'meta.snippet.use.carve'), '')
})
