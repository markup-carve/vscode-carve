import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

await oniguruma.loadWASM(
  readFileSync(resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm')).buffer,
)

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (str) => new oniguruma.OnigString(str),
  }),
  loadGrammar: async () =>
    vsctm.parseRawGrammar(
      readFileSync(resolve(root, 'syntaxes/carve.tmLanguage.json'), 'utf8'),
      'carve.tmLanguage.json',
    ),
})

const grammar = await registry.loadGrammar('text.carve')

function plusScopes(src, lineIndex) {
  let state = vsctm.INITIAL
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const result = grammar.tokenizeLine(lines[i], state)
    state = result.ruleStack
    if (i === lineIndex) {
      const column = lines[i].lastIndexOf('+')
      assert.ok(column >= 0)
      const token = result.tokens.find((t) => t.startIndex <= column && column < t.endIndex)
      assert.ok(token)
      return token.scopes
    }
  }
  assert.fail('line was not tokenized')
}

const continuation = 'markup.list.continuation.carve'

for (const [label, src, line, expected] of [
  ['column zero after an item', '- a\n+\nb', 1, true],
  ['indented at the document level', '  +', 0, false],
  ['indented after an item', '- a\n  +', 1, false],
  ['tab indented after an item', '- a\n\t+', 1, false],
  ['indented after a nested item', '- a\n  - b\n  +\n  c', 2, false],
  ['inside a fence', '```\n+\n```', 1, false],
]) {
  test(`${label}: plus continuation scope is ${expected}`, () => {
    assert.equal(plusScopes(src, line).includes(continuation), expected)
  })
}
