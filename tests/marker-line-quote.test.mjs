/**
 * A block quote opened on a list item's MARKER line takes the rest of that line.
 *
 * `- > quoted` opens a quote inside the item. Measured against carve-js at
 * tree-sitter-carve's pin:
 *
 *     - > quoted
 *
 * renders `<ul><li><blockquote><p>quoted</p></blockquote></li></ul>`. Every
 * marker spelling reaches it - `1. > x`, `* > x`, `- [ ] > x`, `- - > x` - and a
 * marker run after it nests, `- > > x` being a quote inside a quote.
 *
 * WHY THIS IS AN ASSERTION AND NOT A SNAPSHOT, for the reason
 * tests/marker-line-comment-fence.test.mjs already gives: a snapshot is
 * self-consistency with a golden this repo generated from this grammar, so
 * green means the grammar did not CHANGE, never that it is right. This shape
 * had exactly one snapshot behind it - `. >` over `X` - and it was committed
 * pinning the broken answer, with the `>` carrying no scope at all.
 *
 * The oracle is tree-sitter-carve (markup-carve/tree-sitter-carve#218), which
 * puts the `block_quote` inside `list_item_content` beside the `list_marker_*`
 * rather than over it - the same split this grammar makes, with the marker left
 * to the list rules and the quote taking what follows.
 *
 * BOTH DIRECTIONS on every shape. The quoted run has to carry a quote scope AND
 * the block past the item has to carry none: a quote-scope-only check passes a
 * rule that runs away to end of file, which is how the marker-line comment
 * fence failed in a sibling grammar on this same shape.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

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

/** @returns {{line: string, text: string, scopes: string[]}[]} one entry per token. */
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

const isQuoted = (t) => t.scopes.some((s) => s.includes('markup.quote'))

const SHAPES = [
  ['a dash marker', '- > quoted\n\nafter\n'],
  ['a star marker', '* > quoted\n\nafter\n'],
  ['an ordered marker', '1. > quoted\n\nafter\n'],
  ['a marker run', '- - > quoted\n\nafter\n'],
  ['a task marker', '- [ ] > quoted\n\nafter\n'],
  ['a quote run on a marker line', '- > > quoted\n\nafter\n'],
]

for (const [label, src] of SHAPES) {
  test(`a quote opened on ${label} takes the rest of the line`, () => {
    const quoted = tokenize(src).filter((t) => t.text.includes('quoted'))
    assert.ok(quoted.length > 0, 'the quoted run was not tokenized at all')
    for (const t of quoted) {
      assert.ok(
        isQuoted(t),
        `the quoted run must be inside the quote, got ${JSON.stringify(t.text)}` +
          ` as ${t.scopes.join(' ')}`,
      )
    }
  })

  test(`a quote opened on ${label} ends at the item`, () => {
    const after = tokenize(src).filter((t) => t.line === 'after')
    assert.ok(after.length > 0, 'the paragraph after the item was not tokenized at all')
    for (const t of after) {
      assert.ok(
        !isQuoted(t),
        `the quote must end at the item, but ${JSON.stringify(t.text)} carries` +
          ` ${t.scopes.join(' ')}`,
      )
    }
  })

  test(`a quote opened on ${label} leaves the marker to the list rules`, () => {
    const marked = tokenize(src).some((t) => t.scopes.some((s) => s.includes('markup.list')))
    assert.ok(marked, 'the list marker lost its list scope')
  })
}

/*
 * The intended survivors. A marker separator is a literal SPACE, so neither of
 * these opens a quote - the engine renders `- >notquoted` as the item text
 * `&gt;notquoted` and `- >` plus a TAB as `&gt;<TAB>notquoted`. Without them a
 * rule that accepted any `>` after a marker would pass every shape above.
 */
const NOT_A_QUOTE = [
  ['a glued marker', '- >notquoted\n\nafter\n'],
  ['a tab separator', '- >\tnotquoted\n\nafter\n'],
]

for (const [label, src] of NOT_A_QUOTE) {
  test(`${label} on a marker line is not a quote`, () => {
    for (const t of tokenize(src).filter((x) => x.text.includes('notquoted'))) {
      assert.ok(!isQuoted(t), `${JSON.stringify(t.text)} carries ${t.scopes.join(' ')}`)
    }
  })
}

test('an indented quote below the marker line still opens at the line start', () => {
  // The control for the \G anchor: `#block-quotes` owns this line, not
  // `#block-quote-on-marker-line`, and it has to keep owning it.
  const quoted = tokenize('- a\n  > quoted\n').filter((t) => t.text.includes('quoted'))
  assert.ok(quoted.length > 0 && quoted.every(isQuoted), 'an indented quote line lost its scope')
})

test('a document-level quote is untouched by the marker-line rule', () => {
  const quoted = tokenize('> quoted\n').filter((t) => t.text.includes('quoted'))
  assert.ok(quoted.length > 0 && quoted.every(isQuoted), 'a document-level quote lost its scope')
})
