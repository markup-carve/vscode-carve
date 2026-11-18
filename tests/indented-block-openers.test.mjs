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
  ['a list under description text', ':: a\n: b\n  :: c\n    - x\n', '    - x', '-', 'markup.list.unnumbered'],
  ['a span marker in a header cell', '|= a |= < |\n', '|= a |= < |', '<', 'keyword.operator.table.colspan'],
  ['a span marker in a first body cell', '| < | b |\n', '| < | b |', '<', 'keyword.operator.table.colspan'],
  ['a rowspan marker in a header cell', '|= a |\n|= ^ |\n', '|= ^ |', '^', 'keyword.operator.table.rowspan'],
  ['a quoted div opener', '> ::: note\n> body\n> :::\n', '> ::: note', 'note', 'entity.name.type.div'],
  ['a quoted div closer', '> ::: note\n> body\n> :::\n', '> :::', ':::', 'punctuation.definition.div'],
  ['a fence behind a quote prefix and spaces', '>   ```\n>   x\n>   ```\n', '>   ```', '```', 'punctuation.definition.raw.begin'],
]

for (const [label, src, line, text, scope] of SHAPES) {
  test(`${label} carries ${scope}`, () => {
    const t = on(src, line, text)
    assert.ok(t, `${JSON.stringify(text)} was not one token on ${JSON.stringify(line)}`)
    assert.ok(has(t, scope), `${JSON.stringify(text)} -> ${t.scopes.join(' ')}`)
  })
}

// Directly under paragraph text these lines continue the paragraph in Carve 0.2
// (U-004, U-005, U-039), and a definition stands at column 0 outside every container
// (C2-B-081); the 0.2 reference engine renders each as text.
const PARAGRAPH_TEXT = [
  ['a heading under a term', ':: c\n  # H\n', '  # H', 'H', 'entity.name.section'],
  ['an indented reference definition', ' Read [intro][x].\n\n [x]: /intro "T"\n', ' [x]: /intro "T"', '[x]:', 'constant.other.reference.link'],
  ['its destination', ' Read [intro][x].\n\n [x]: /intro "T"\n', ' [x]: /intro "T"', '/intro', 'markup.underline.link'],
  ['an indented footnote definition', ' Note[^fn].\n\n [^fn]: body.\n', ' [^fn]: body.', '[^fn]:', 'meta.footnote.definition'],
  ['a tab-indented abbreviation definition', 'AB\n\n\t*[AB]: x\n', '\t*[AB]: x', 'AB', 'meta.abbreviation.definition'],
  ['a footnote definition in an item', '- item\n\n  [^f]: body\n', '  [^f]: body', '[^f]:', 'meta.footnote.definition'],
  ['a quoted footnote definition', '> [^f]: body\n', '> [^f]: body', '[^f]:', 'meta.footnote.definition'],
  ['a definition right under a paragraph line', 'Read [i][x].\n [x]: /u\n', ' [x]: /u', '[x]:', 'meta.link.reference.definition'],
  ['a nested term right under description text', ':: a\n: b\n  :: c\n    - x\n', '  :: c', '::', 'markup.list.definition.term'],
  ['a term under a paragraph', 'para\n:: c\n', ':: c', '::', 'markup.list.definition.term'],
]

for (const [label, src, line, text, scope] of PARAGRAPH_TEXT) {
  test(`${label} carries no ${scope}`, () => {
    const t = on(src, line, text)
    assert.ok(!t || !has(t, scope), `${JSON.stringify(text)} -> ${t?.scopes.join(' ')}`)
  })
}

test('a footnote body in a container is not a link destination', () => {
  const t = on('- item\n\n  [^f]: body\n', '  [^f]: body', ' body')
  assert.ok(!has(t, 'markup.underline.link'), t && t.scopes.join(' '))
})

test('a line under a term continues the term', () => {
  // U-106: the 0.2 reference engine renders `:: c` over `  more` as one `<dt>c more</dt>`.
  const tokens = tokenize(':: c\n  more\n').filter((t) => t.line === '  more')
  assert.ok(tokens.length > 0 && tokens.every((t) => !has(t, 'markup.heading') && !has(t, 'markup.raw')))
})
// carve-js renders each source as one code block whose body holds the deeper fence line.
const DEEPER_CLOSERS = [
  ['a quoted fence', '>   ```js\n>   x\n>     ```\n>   y\n>   ```\n', '>   y'],
  ['an indented fence under a deeper spaces closer', '  ```js\n  x\n    ```\n  y\n  ```\n', '  y'],
  ['an indented fence under a tab closer', '  ```js\n  x\n\t```\n  y\n  ```\n', '  y'],
]

for (const [label, src, line] of DEEPER_CLOSERS) {
  test(`${label} stays open past a closer deeper than its opener`, () => {
    const t = tokenize(src).find((x) => x.line === line && x.text.trim() !== '')
    assert.ok(t && has(t, 'markup.raw.block.fenced.code'), t && t.scopes.join(' '))
  })
}

test('a quoted fence closes at a shallower closer', () => {
  const t = on('>   ```js\n>   x\n> ```\n> y\n', '> y', 'y')
  assert.ok(t && !has(t, 'markup.raw.block.fenced.code'), t && t.scopes.join(' '))
})
