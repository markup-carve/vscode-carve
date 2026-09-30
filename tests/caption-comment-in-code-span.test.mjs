// A `%%` between backticks on a caption line is code content, and a real
// trailing `%%` on a caption is still a comment. carve-js at pin 9f81a0a7 and
// carve-php 685e94fa3 agree byte for byte on both (markup-carve/carve#2682).
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

const flush = '![a](i.png)\n^ cap `x %% b` c'
const prefixed = '> ![a](i.png)\n> ^ cap `x %% b` c'

test('a percent run inside a code span on a caption line is code content', () => {
  assert.equal(covered(flush, 'markup.raw.inline.content'), '\nx %% b')
  assert.equal(covered(flush, 'comment.line.percent'), '\n')
  assert.equal(covered(prefixed, 'markup.raw.inline.content'), '\nx %% b')
  assert.equal(covered(prefixed, 'comment.line.percent'), '\n')
  assert.equal(covered('![a](i.png)\n^ cap `x` b %% hidden', 'markup.raw.inline.content'), '\nx')
})

test('a real trailing comment on a caption is still a comment', () => {
  assert.equal(covered('![a](i.png)\n^ cap %% hidden', 'comment.line.percent'), '\n%% hidden')
  assert.equal(covered('> ![a](i.png)\n> ^ cap %% hidden', 'comment.line.percent'), '\n%% hidden')
  assert.equal(covered('![a](i.png)\n^ cap `x` b %% hidden', 'comment.line.percent'), '\n%% hidden')
})

test('a percent run inside a code span off a caption line is code content', () => {
  assert.equal(covered('p a `x %% b` c', 'markup.raw.inline.content'), 'x %% b')
  assert.equal(covered('p a `x %% b` c', 'comment.line.percent'), '')
})

// A caption is a paragraph unless it pairs with a figure, and the engines say so:
// a bare `^ cap ...` renders `<p>^ cap <code>x %% b</code> c</p>`. This grammar is
// line-local and cannot see the pairing, so it scopes the bare line as a caption
// too - an over-scope that predates this change and is deliberately left alone.
// The control is that the fix introduces NO figure-pairing distinction: the bare
// line reads exactly as the paired one. Widening the caption rule to prose, or
// narrowing it to paired figures, both trip this.
test('a bare caption marker with no figure reads exactly as a paired one', () => {
  const bare = '^ cap `x %% b` c'
  for (const scope of ['markup.table.caption', 'string.unquoted.caption', 'markup.raw.inline.content', 'comment.line.percent']) {
    assert.equal(covered(bare, scope), covered(flush, scope).replace(/^\n/, ''), scope)
  }
})
