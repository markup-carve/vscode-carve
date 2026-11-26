/**
 * Carve 0.2 source changes, asserted on the TextMate grammar.
 *
 * Each case is a spec example or upgrade entry from markup-carve/carve `next2`
 * (`spec/0.2/UPGRADING.md`, `syntax-blocks.md`, `syntax-inline.md`), and the set
 * mirrors the 0.2 TextMate assertions in markup-carve/carve-grammars `next2`.
 * The expected readings were checked against the 0.2 reference engine.
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

const grammar = await registry.loadGrammar('source.carve')

function tokenize(src) {
  let state = vsctm.INITIAL
  const out = []
  for (const line of src.split(/\r\n|\r|\n/)) {
    const r = grammar.tokenizeLine(line, state)
    state = r.ruleStack
    for (const t of r.tokens) out.push({ line, text: line.substring(t.startIndex, t.endIndex), scopes: t.scopes })
  }
  return out
}

/** The source text of every token that carries `scope`. */
const covered = (src, scope) =>
  tokenize(src).filter((t) => t.scopes.some((s) => s.includes(scope))).map((t) => t.text).join('')
const hasScope = (src, scope) => covered(src, scope) !== ''

const HEADING = 'markup.heading.carve'
const BREAK = 'meta.separator.thematic-break.carve'
const FENCE = 'markup.raw.block.fenced.code.carve'
const COMMENT = 'comment.block.carve'

for (const [source, scope] of [
  ['= Heading\n', HEADING],
  ['== Heading\n', HEADING],
  [' # H\n', HEADING],
  [' = H\n', HEADING],
  ['***\n', BREAK],
  ['﻿***\n', BREAK],
  ['```js\nx\n```\n', FENCE],
  ['%% #region name\n', 'comment.line.percent.carve'],
  ['a {_underlined_} b', 'markup.underline.text.carve'],
  ['{~struck~}', 'markup.strikethrough.carve'],
  ['{=marked=}', 'markup.highlight.carve'],
  ['{^sup^}', 'markup.superscript.carve'],
  ['{,sub,}', 'markup.subscript.carve'],
  ['|={>} a |', 'keyword.operator.table.alignment.carve'],
  ['|= a|', 'keyword.operator.table.header.carve'],
  ['a. one\nb. two\n', 'punctuation.definition.list.begin.carve'],
  ['iv. one\n', 'punctuation.definition.list.begin.carve'],
  ['{.a}\np', 'meta.attributes.carve'],
  ['text\n\n# Heading', HEADING],
  ['- item\n\n= Heading\n', HEADING],
  ['> quote\n\n= Heading\n', HEADING],
  ['text\n%%%\nhidden\n%%%\n', COMMENT],
  ['text\n%% note\n', 'comment.line.percent.carve'],
]) {
  test(`0.2 scopes ${JSON.stringify(source)} as ${scope}`, () => {
    assert.ok(hasScope(source, scope), tokenize(source).map((t) => `${JSON.stringify(t.text)} ${t.scopes.join(' ')}`).join('\n'))
  })
}

for (const [source, scope, clause] of [
  ['a\n\n---\n', BREAK, 'U-044'],
  ['a\n\n___\n', BREAK, 'U-044'],
  ['~~~js\nx\n~~~\n', FENCE, 'U-116'],
  ['_underlined_', 'markup.underline.text.carve', 'U-065'],
  ['~struck~', 'markup.strikethrough.carve', 'U-066'],
  ['=marked=', 'markup.highlight.carve', 'U-067'],
  ['|=> a | b |', 'keyword.operator.table.alignment.carve', 'U-056'],
  ['|=< a |\n', 'keyword.operator.table.alignment.carve', 'CC-893'],
  ['|=a|', 'keyword.operator.table.header.carve', 'U-056'],
  ['| a | b |\n|---|--:|\n| 1 | 2 |\n', 'keyword.operator.table.alignment.carve', 'U-055'],
  ['- first\n+\n> second\n', 'continuation', 'U-014'],
  ['- +\n- b\n', 'continuation', 'U-017'],
  ['{.a\n .b}\np', 'meta.attributes.carve', 'U-032'],
  ['{~old~>new~}\n', 'markup.changed.critic.carve', 'U-069'],
  ['text\n# Heading', HEADING, 'U-001'],
  ['Some text\n> quote\n', 'markup.quote.carve', 'U-002'],
  ['Some text\n[ref]: https://example.com\n', 'meta.link.reference.definition.carve', 'U-005'],
  ['Some text\n:: term\n: description\n', 'markup.list.definition.term.carve', 'U-004'],
  [' [a]: /u\n', 'meta.link.reference.definition.carve', 'U-039'],
  ['> [ref]: /u\n', 'meta.link.reference.definition.carve', 'C2-B-081'],
  ['- item text\n# Heading\n', HEADING, 'U-006'],
  ['> quote\n# Heading\n', HEADING, 'C2-B-154'],
  [':: term\nmore term text\n: first description\n', HEADING, 'U-106'],
  ['![a\nb](/i)\n^ cap\n', 'markup.table.caption.carve', 'C2-B-017'],
]) {
  test(`0.2 leaves ${JSON.stringify(source)} without ${scope} (${clause})`, () => {
    assert.ok(!hasScope(source, scope), tokenize(source).map((t) => `${JSON.stringify(t.text)} ${t.scopes.join(' ')}`).join('\n'))
  })
}

for (const source of ['- item\n= Heading\n', '- item\n## Heading\n', '1. item\n= Heading\n', 'a. item\n= Heading\n', '> quote\n= Heading\n', '> - item\n# Heading\n']) {
  test(`a heading line under item or quote text is a lazy line: ${JSON.stringify(source)}`, () => {
    assert.ok(!hasScope(source, HEADING))
  })
}

for (const eol of ['\r', '\r\n']) {
  test(`a heading under text is paragraph text with ${JSON.stringify(eol)} line ends`, () => {
    assert.ok(!hasScope(`text${eol}= Heading${eol}`, HEADING))
    assert.ok(hasScope(`text${eol}${eol}= Heading${eol}`, HEADING))
  })
}

test('a comment fence closes only on the percent run and whitespace (U-050)', () => {
  assert.ok(covered('%%%\nhidden\n%%% visible?\nafter\n%%%\n', COMMENT).includes('after'))
  assert.ok(covered('> %%%\n> hidden\n> %%% visible?\n> after\n> %%%\n', COMMENT).includes('after'))
  assert.ok(!covered('%%%\nhidden\n%%%  \nafter\n', COMMENT).includes('after'))
})

test('a heading continues on lines indented past its marker (C2-B-001)', () => {
  assert.ok(covered('= H\n  cont\n', HEADING).includes('cont'))
  assert.ok(!covered('= H\nplain\n', HEADING).includes('plain'))
  assert.ok(covered('= H\n%% note\n  cont\n', HEADING).includes('cont'))
  assert.ok(!covered('= H\n%% #region x\n  cont\n', HEADING).includes('cont'))
  assert.ok(hasScope('= H\n  ***\nafter\n', BREAK))
  assert.ok(covered('# First\n= Second\n', HEADING).includes('Second'))
})

test('a fenced block ends at its closer and only a backtick fence opens', () => {
  assert.ok(!covered('```\nx\n```\nafter\n', FENCE).includes('after'))
  assert.ok(!covered('a. one\n   ```\n   code\n   ```\nafter\n', FENCE).includes('after'))
  assert.ok(!hasScope('- item\n  ~~~js\n  code\n  ~~~\n', FENCE))
  assert.ok(!hasScope('> ~~~js\n> code\n> ~~~\n', FENCE))
  assert.ok(hasScope('- item\n\n  ```js\n  code\n  ```\n', FENCE))
  assert.ok(hasScope('> ```js\n> code\n> ```\n', FENCE))
})

test('a substitution is braced strike text (U-069)', () => {
  assert.equal(covered('{~old~>new~}\n', 'markup.strikethrough.carve'), '{~old~>new~}')
})

test('a table row interrupts a paragraph and a region marker ends it (U-013, C2-B-137)', () => {
  assert.ok(hasScope('text\n| a |\n', 'markup.table.row.carve'))
  assert.ok(hasScope('text\n***\n', BREAK))
  assert.ok(hasScope('text\n```\nx\n```\n', FENCE))
  assert.ok(hasScope('text\n%% #region x\n\n# H\n', HEADING))
})
