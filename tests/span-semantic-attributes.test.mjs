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
const scope = 'support.constant.attribute.carve'

function scopedWords(lines) {
  let stack = vsctm.INITIAL
  const words = []
  for (const line of lines) {
    const result = grammar.tokenizeLine(line, stack)
    stack = result.ruleStack
    for (const token of result.tokens) {
      if (token.scopes.includes(scope)) words.push(line.slice(token.startIndex, token.endIndex))
    }
  }
  return words
}

test('semantic names are scoped in span attributes', () => {
  assert.deepEqual(scopedWords([
    '[Ctrl]{kbd}',
    '[HTML]{abbr="HyperText Markup Language"}',
    '[noon]{time=12:00}',
    '[x]{.c kbd}',
    '> [Ctrl]{kbd}',
    '- [noon]{time=12:00}',
  ]), ['kbd', 'abbr', 'time', 'kbd', 'kbd', 'time'])
})

test('semantic names outside span attributes stay unscoped', () => {
  assert.deepEqual(scopedWords([
    '{kbd}',
    'paragraph',
    '[x]{data-kbd=y}',
    '[x]{title="kbd"}',
    "[x]{title='kbd'}",
    '[x]{title="press kbd"}',
    '[x]{title="a time=b"}',
    '[x]{kbdx}',
    '{abbr=x}',
    '# Heading {time=12:00}',
    '::: {kbd}',
    'content',
    ':::',
  ]), [])
})
