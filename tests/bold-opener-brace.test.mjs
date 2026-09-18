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

function covered(source, scope) {
  let state = vsctm.INITIAL
  const parts = []
  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    for (const token of result.tokens) {
      // A forced span carries its rule name over its delimiters too, so the
      // run's CONTENT is what carries the scope and no punctuation name.
      const isContent = token.scopes.includes(scope)
        && !token.scopes.some((name) => name.startsWith('punctuation.definition.'))
      if (isContent) parts.push(line.slice(token.startIndex, token.endIndex))
    }
  }
  return parts.join('')
}

const bold = (source) => covered(source, 'markup.bold.carve')

test('a closing brace after the opener is content while a closer follows', () => {
  assert.equal(bold('a *}b* c'), '}b')
  assert.equal(bold('a *}b c* d'), '}b c')
  assert.equal(bold('a *}* b'), '}')
  assert.equal(bold('*}a*'), '}a')
  assert.equal(bold('x *}y* z'), '}y')
})

test('with no closer the brace still refuses the opener (#251)', () => {
  assert.equal(bold('a *}b'), '')
  assert.equal(bold('a *} b'), '')
  assert.equal(bold('a{*{*x*}*}b'), '{*x')
})
