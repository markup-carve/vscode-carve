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

// An abbreviation definition at a container's content column used to carry the
// definition scopes here, so this test asked for them. The engine collects no
// abbreviation outside document level (markup-carve/carve#611): both sources
// below render the line as literal text, with no `<abbr>` anywhere. What the
// line still must NOT do is open an unclosed bold run that crosses the block
// under it, which is why it is consumed rather than left to the inline layer -
// see tests/container-paragraph-continuation.test.mjs
// (markup-carve/vscode-carve#329).
test('an abbreviation definition in a container is neither a definition nor bold', () => {
  for (const source of [
    // `<li><p>a</p><p>*[A]: a</p><ul><li>b</li></ul></li>`
    '- a\n\n  *[A]: a\n  - b',
    // `<li>a\n*[HTML]: Hyper Text</li>` then `<p>The HTML spec.</p>`
    '- a\n  *[HTML]: Hyper Text\n\nThe HTML spec.',
  ]) {
    assert.equal(covered(source, 'meta.abbreviation.definition.carve').replace(/\n/g, ''), '')
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
