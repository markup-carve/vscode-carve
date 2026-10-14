/**
 * Two readings checked against the bundled engine: which `[` opens a link's
 * text, and which pipe lines are table rows. A row needs a closing pipe, at
 * most followed by an attribute block, so a lone `|` or `| a | b` is prose.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'
import { carveToHtml } from '@markup-carve/carve'

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

function tokens(source) {
  let stack = vsctm.INITIAL
  const out = []
  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, stack)
    for (const token of result.tokens) out.push({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes })
    stack = result.ruleStack
  }
  return out
}

const linkTitle = (source) => tokens(source)
  .filter((token) => token.scopes.includes('string.other.link.title.carve'))
  .map((token) => token.text)
  .join('')

// [source, link text the engine reads (as source), href]
const links = [
  ['a [b [x](u) c]', 'x', 'u'],
  ['a [b [x][r] c]\n\n[r]: /r', 'x', '/r'],
  ['a [b [x](u) c](v)', 'b [x](u) c', 'v'],
  ['[a [b] c](u)', 'a [b] c', 'u'],
  ['a [b] [x](u)', 'x', 'u'],
  [String.raw`a [b \[x](u)`, String.raw`b \[x`, 'u'],
]

for (const [source, text, href] of links) {
  test(`${JSON.stringify(source)} scopes ${JSON.stringify(text)} as the link text`, () => {
    const html = carveToHtml(source)
    assert.equal(html.match(/<a /g)?.length, 1, html)
    assert.ok(html.includes(`<a href="${href}">`), html)
    assert.equal(linkTitle(source), text)
  })
}

// Whether the source holds a table row, in the grammar and in the engine.
const rows = [
  '|',
  '| a | b',
  '|a|b',
  '| a |',
  '||',
  '| a | b |  ',
  '| a |{.c}',
  '| a | b |{.c} ',
  '| a | %% c',
  '| a | b\n+ c |',
  '| a |\n+ c |',
  '- | a | b',
  '- | a |',
  '- | a | b\n  + c |',
  ':: t\n:  | a | b',
  ':: t\n:  | a |',
]

for (const source of rows) {
  const isRow = carveToHtml(source).includes('<table')
  test(`${JSON.stringify(source)} is ${isRow ? '' : 'not '}a table row`, () => {
    const scoped = tokens(source).filter((token) => token.scopes.some((scope) => scope.startsWith('markup.table.')))
    assert.equal(scoped.length > 0, isRow, JSON.stringify(scoped.map((token) => [token.text, token.scopes.at(-1)])))
  })
}
