/**
 * Block openers at an indent, and definitions in every container
 * (markup-carve/vscode-carve#436).
 *
 * The spec model reads leading indentation at document level as the same
 * block (rule A, markup-carve/carve#3887; corpus
 * indented-reference-and-footnote-definitions-register and
 * a-block-opener-indented-under-a-definition-term-ends-the-term-at-every-depth).
 * Each source below is rendered that way by the model and by carve-js main.
 */
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

function tokenize(src) {
  let state = vsctm.INITIAL
  const out = []
  for (const line of src.split('\n')) {
    const r = grammar.tokenizeLine(line, state)
    state = r.ruleStack
    for (const t of r.tokens) {
      out.push({ line, text: line.substring(t.startIndex, t.endIndex), scopes: t.scopes })
    }
  }
  return out
}

const on = (src, line, text) => tokenize(src).find((t) => t.line === line && t.text === text)
const has = (t, s) => t !== undefined && t.scopes.some((x) => x.includes(s))

// [label, source, line, token, scope]
const SHAPES = [
  ['an indented reference definition', ' Read [intro][x].\n\n [x]: /intro "T"\n', ' [x]: /intro "T"', '[x]:', 'constant.other.reference.link'],
  ['its destination', ' Read [intro][x].\n\n [x]: /intro "T"\n', ' [x]: /intro "T"', '/intro', 'markup.underline.link'],
  ['an indented footnote definition', ' Note[^fn].\n\n [^fn]: body.\n', ' [^fn]: body.', '[^fn]:', 'meta.footnote.definition'],
  ['a tab-indented abbreviation definition', 'AB\n\n\t*[AB]: x\n', '\t*[AB]: x', 'AB', 'meta.abbreviation.definition'],
  ['a definition right under a paragraph line', 'Read [i][x].\n [x]: /u\n', ' [x]: /u', '[x]:', 'meta.link.reference.definition'],
  ['a footnote definition in an item', '- item\n\n  [^f]: body\n', '  [^f]: body', '[^f]:', 'meta.footnote.definition'],
  ['a quoted footnote definition', '> [^f]: body\n', '> [^f]: body', '[^f]:', 'meta.footnote.definition'],
  ['a heading under a term', ':: c\n  # H\n', '  # H', 'H', 'entity.name.section'],
  ['a heading under a quoted term', '> :: c\n>   # H\n', '>   # H', 'H', 'entity.name.section'],
  ['a nested term in a description body', ':: a\n: b\n  :: c\n    - x\n', '  :: c', '::', 'markup.list.definition.term'],
  ['a list under a nested term', ':: a\n: b\n  :: c\n    - x\n', '    - x', '-', 'markup.list.unnumbered'],
  ['a term under a paragraph', 'para\n:: c\n', ':: c', '::', 'markup.list.definition.term'],
  ['a span marker in a header cell', '|= a |= < |\n', '|= a |= < |', '<', 'keyword.operator.table.colspan'],
  ['a rowspan marker in a header cell', '|= a |\n|= ^ |\n', '|= ^ |', '^', 'keyword.operator.table.rowspan'],
  ['a fence behind a quote prefix and spaces', '>   ```\n>   x\n>   ```\n', '>   ```', '```', 'punctuation.definition.raw.begin'],
]

for (const [label, src, line, text, scope] of SHAPES) {
  test(`${label} carries ${scope}`, () => {
    const t = on(src, line, text)
    assert.ok(t, `${JSON.stringify(text)} was not one token on ${JSON.stringify(line)}`)
    assert.ok(has(t, scope), `${JSON.stringify(text)} -> ${t.scopes.join(' ')}`)
  })
}

test('a footnote body in a container is not a link destination', () => {
  const t = on('- item\n\n  [^f]: body\n', '  [^f]: body', ' body')
  assert.ok(t && !has(t, 'markup.underline.link'), t && t.scopes.join(' '))
})

test('a line under a term that is not a marker line ends the term', () => {
  // The model renders `:: c` over `  more` as a `<dt>` and then a paragraph.
  const t = on(':: c\n  more\n', '  more', 'more')
  assert.ok(t && !has(t, 'markup.list.definition'), t && t.scopes.join(' '))
})
