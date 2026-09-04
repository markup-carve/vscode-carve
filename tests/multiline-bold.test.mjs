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

function tokenize(source) {
  const lines = source.split('\n')
  let state = vsctm.INITIAL
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    return { line, tokens: result.tokens }
  })
}

function covered(source, scope) {
  return tokenize(source).map(({ line, tokens }) => tokens
    .filter((token) => token.scopes.includes(scope))
    .map((token) => line.slice(token.startIndex, token.endIndex))
    .join('')).join('\n')
}

test('an abbreviation definition in a container owns its complete line', () => {
  for (const source of [
    '- a\n\n  *[A]: a\n  - b',
    '- a\n  *[HTML]: Hyper Text\n\nThe HTML spec.',
  ]) {
    const line = source.split('\n').find((candidate) => candidate.includes('*['))
    assert.equal(covered(source, 'meta.abbreviation.definition.carve').split('\n').find((part) => part), line)
    assert.ok(!covered(source, 'markup.bold.carve').includes('[A]'))
    assert.ok(!covered(source, 'markup.bold.carve').includes('[HTML]'))
  }
})

test('a bold run crosses soft line breaks and closes normally', () => {
  assert.equal(covered('a *b\nc* d', 'markup.bold.carve'), 'b\nc')
  assert.equal(covered('a *b\nc\nd* e', 'markup.bold.carve'), 'b\nc\nd')
})

test('an unclosed bold opener cannot cross a paragraph boundary', () => {
  const source = 'a *b c\n \t\nnext *good* paragraph'
  const bold = covered(source, 'markup.bold.carve')
  assert.ok(bold.includes('b c'))
  assert.ok(bold.includes('good'))
  assert.ok(!bold.includes('next'))
  assert.ok(!bold.includes('paragraph'))
})
