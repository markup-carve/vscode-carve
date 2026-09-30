// A `%%` between backticks on a heading line is code content, and a real
// trailing `%%` on a heading is still a comment. carve-js 0.1.4 and carve-php
// 685e94fa3 agree byte for byte on both (markup-carve/carve#2682).
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

test('a percent run inside a code span on a heading line is code content', () => {
  assert.equal(covered('# a `x %% b` c', 'markup.raw.inline.content'), 'x %% b')
  assert.equal(covered('# a `x %% b` c', 'comment.line.percent'), '')
  assert.equal(covered('- # a `x %% b` c', 'markup.raw.inline.content'), 'x %% b')
  assert.equal(covered('- # a `x %% b` c', 'comment.line.percent'), '')
})

test('a real trailing comment on a heading is still a comment', () => {
  assert.equal(covered('# a %% hidden', 'comment.line.percent'), '%% hidden')
  assert.equal(covered('# a %% hidden', 'entity.name.section'), 'a %% hidden')
  assert.equal(covered('- # a %% hidden', 'comment.line.percent'), '%% hidden')
  assert.equal(covered('# a `x` b %% hidden', 'comment.line.percent'), '%% hidden')
})

test('a percent run inside a code span off a heading line is code content', () => {
  assert.equal(covered('p a `x %% b` c', 'markup.raw.inline.content'), 'x %% b')
  assert.equal(covered('p a `x %% b` c', 'comment.line.percent'), '')
})
