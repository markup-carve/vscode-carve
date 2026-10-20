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
const operator = 'keyword.operator.continuation.carve'
const isMarker = (scopes) => scopes.includes(continuation) || scopes.includes(operator)

// A lone `+` on its own line is a marker only when the next line starts a block at
// the right column, which a line grammar cannot see, so every such line stays text.
for (const [label, src, line, expected] of [
  ['column zero after an item', '- a\n+\nb', 1, false],
  ['indented at the document level', '  +', 0, false],
  ['indented after an item', '- a\n  +', 1, false],
  ['tab indented after an item', '- a\n\t+', 1, false],
  ['at a nested item\'s marker column', '- a\n  - b\n  +\n  c', 2, false],
  ['at an outer item\'s marker column below a nested item', '- a\n  - b\n+\npara', 2, false],
  ['after a quote prefix', '> q\n> +\n> r', 1, false],
  ['inside a fence', '```\n+\n```', 1, false],
  ['glued to a quote marker', '>+\nq', 0, false],
]) {
  test(`${label}: plus continuation scope is ${expected}`, () => {
    assert.equal(isMarker(plusScopes(src, line)), expected)
  })
}

function lineScopes(src) {
  let state = vsctm.INITIAL
  return src.split('\n').map((line) => {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    const perChar = []
    for (const t of result.tokens) {
      for (let i = t.startIndex; i < Math.min(t.endIndex, line.length); i++) perChar[i] = t.scopes.join(' ')
    }
    return perChar
  })
}

const afterOpener = [
  ['bullet', '- +\n- b\n> q\nplain', true],
  ['numbered', '1. +\n2. b\n> q\nplain', true],
  ['quote', '> +\n> b\nplain', false],
  ['quote with a lazy line', '> +\n flush', false],
  ['nested quote', '> > +\n> > b\n> c\nplain', false],
  ['description body', ':: t\n: +\n: b\nplain', true],
  ['footnote definition', '[^a]: +\n  b\nplain', false],
  ['stacked bullets', '- - +\n  - b\nplain', true],
  ['open task item', '- [ ] +\n- b\n> q\nplain', true],
  ['checked task item', '- [x] +\n- b\nplain', true],
  ['bullet after a numbered opener', '1. - +\npara', true],
  ['bullet in a quote', '> - +\n> q', true],
  ['numbered item in a quote', '> 1. +\n> q', true],
]

for (const [label, src, expected] of afterOpener) {
  test(`${label}: a plus after the opener is ${expected ? '' : 'not '}the continuation marker`, () => {
    const index = src.split('\n').findIndex((l) => l.includes('+'))
    assert.equal(isMarker(plusScopes(src, index)), expected)
  })

  test(`${label}: lines after the marker line keep their scoping`, () => {
    const marked = lineScopes(src)
    const control = lineScopes(src.replace('+', 'x'))
    const index = src.split('\n').findIndex((l) => l.includes('+'))
    assert.deepEqual(marked.slice(index + 1), control.slice(index + 1))
  })
}

for (const [label, src, line] of [
  ['bullet with text', '- + text', 0],
  ['quote with text', '> + text', 0],
  ['task item with text', '- [ ] + text', 0],
  ['indented plus after a bullet marker line', '- a\n  +', 1],
  ['bullet inside a fence', '```\n- +\n```', 1],
  ['quote inside a fence', '```\n> +\n```', 1],
  ['numbered task box in a quote', '> 1. [ ] +', 0],
  ['footnote with a wide separator', '[^a]:     +\n  b', 0],
]) {
  test(`${label}: plus is not the continuation marker`, () => {
    assert.equal(isMarker(plusScopes(src, line)), false)
  })
}
