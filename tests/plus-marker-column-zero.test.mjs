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
  ['bullet', '- +\n- b\n> q\nplain'],
  ['numbered', '1. +\n2. b\n> q\nplain'],
  ['quote', '> +\n> b\nplain'],
  ['quote with a lazy line', '> +\n flush'],
  ['nested quote', '> > +\n> > b\n> c\nplain'],
  ['description body', ':: t\n: +\n: b\nplain'],
  ['footnote definition', '[^a]: +\n  b\nplain'],
  ['stacked bullets', '- - +\n  - b\nplain'],
  ['open task item', '- [ ] +\n- b\n> q\nplain'],
  ['checked task item', '- [x] +\n- b\nplain'],
]

for (const [label, src] of afterOpener) {
  test(`${label}: a plus after the opener is the continuation marker`, () => {
    const index = src.split('\n').findIndex((l) => l.includes('+'))
    assert.ok(plusScopes(src, index).includes(continuation))
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
]) {
  test(`${label}: plus is not the continuation marker`, () => {
    assert.equal(plusScopes(src, line).includes(continuation), false)
  })
}
