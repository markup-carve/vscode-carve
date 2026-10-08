/**
 * A DESCRIPTION BODY NEEDS A `::` TERM ABOVE IT
 * (markup-carve/vscode-carve#326).
 *
 * The `::` term used to be a `match` rule, so the grammar carried no
 * description-list state and a `:` line was scoped as a body wherever it
 * stood. The engine disagrees on both halves: it renders an orphan `: text` as
 * `<p>: text</p>`, and an orphan `: ``` ` as a paragraph holding an inline code
 * span rather than a description holding a fenced block.
 *
 * THE ORACLE IS THE INSTALLED ENGINE, not the grammar. Every expectation below
 * was measured against `carveToHtml` before it was written; the HTML is quoted
 * at the assertion that depends on it.
 *
 * The fix gives the term a begin/end container and moves both body rules
 * inside it, so neither can fire without a term. The container is bounded at
 * the term's own column: it ends on the first non-blank line that is neither a
 * `:` or `::` marker at that column nor indented past it, which is what keeps
 * it from running to the end of the document.
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

const has = (t, s) => t.scopes.some((x) => x.includes(s))
const DEF = 'markup.list.definition.carve'
const TERM = 'markup.list.definition.term.carve'
const BLOCK = 'markup.raw.block.fenced.code.carve'
const INLINE = 'markup.raw.inline'
const report = (tokens) =>
  tokens.map((t) => `${JSON.stringify(t.text)} -> ${t.scopes.join(' ')}`).join('\n')

/*
 * THE ORPHANS. No `::` term stands above any of these, and the engine renders
 * every one of them as prose.
 */
const ORPHANS = [
  // `<p>: text</p>`
  ['at column 0', ': text\n', ': text'],
  // `<p>: text</p>` - the leading whitespace is not a container
  ['tab-indented at the document level', '\t: text\n', ': text'],
  // `<ul><li>outer\n: text</li></ul>` - the item's content, not a description
  ['indented inside a list item', '- outer\n  : text\n', ': text'],
  // `<blockquote><p>: text</p></blockquote>`
  ['behind a block-quote marker', '> : text\n', ': text'],
  // `<p>para\n: orphan</p>` - the list above ended at the blank line
  ['below a description list that has ended', ':: t\n: a\n\npara\n: orphan\n', ': orphan'],
  // `<p>::\td\n:  d</p>` - a tab is not a marker separator, so the term line
  // above is disqualified and nothing below it is a body.
  ['below a term disqualified by its tab separator', '::\td\n:  d\n', ':  d'],
]

for (const [label, src, marker] of ORPHANS) {
  test(`an orphan description marker ${label} is not a description`, () => {
    const tokens = tokenize(src)
    const line = tokens.filter((t) => t.line.endsWith(marker))
    assert.ok(line.length > 0, `the line was not tokenized at all:\n${report(tokens)}`)
    for (const t of line) {
      assert.ok(
        !has(t, DEF) && !has(t, TERM),
        `an orphan marker is prose, got ${JSON.stringify(t.text)} -> ${t.scopes.join(' ')}`,
      )
    }
  })
}

test('an orphan description marker opens no fenced block', () => {
  // Engine: `: ``` ` over `code` over `: ``` ` renders
  // `<p>: <code>\ncode\n</code></p>`, a paragraph holding an inline code span.
  const tokens = tokenize(': ```\ncode\n```\n')
  const opener = tokens.filter((t) => t.text === '```').at(0)
  assert.ok(opener, `the run was not tokenized at all:\n${report(tokens)}`)
  assert.ok(
    !has(opener, BLOCK),
    `an orphan marker opens no block, got ${opener.scopes.join(' ')}`,
  )
  assert.ok(has(opener, INLINE), `the run stays a code span, got ${opener.scopes.join(' ')}`)
})

test('an orphan description marker opens no fenced block at a body column either', () => {
  // The indented branch of the same rule, reached only from a container.
  // Engine: `<ul><li>outer\n: <code>\ncode\n</code></li></ul>`.
  const tokens = tokenize('- outer\n  : ```\n  code\n  ```\n')
  const opener = tokens.filter((t) => t.text === '```').at(0)
  assert.ok(opener, `the run was not tokenized at all:\n${report(tokens)}`)
  assert.ok(!has(opener, BLOCK), `an orphan marker opens no block, got ${opener.scopes.join(' ')}`)
})

/*
 * THE POSITIVES. A term above the body is what the container requires, and
 * every one of these renders as a `<dl>`.
 */
test('a term above the body still scopes the body', () => {
  // `<dl><dt>term</dt><dd>body</dd></dl>`
  const tokens = tokenize(':: term\n: body\n')
  const term = tokens.filter((t) => t.text === '::').at(0)
  assert.ok(term && has(term, TERM), `the term marker lost its scope:\n${report(tokens)}`)
  const marker = tokens.filter((t) => t.line === ': body' && t.text === ':').at(0)
  assert.ok(marker && has(marker, DEF), `the body marker lost its scope:\n${report(tokens)}`)
})

test('the term scope covers the marker line and not the region below it', () => {
  // A rule-level `name` on a begin/end rule spans the whole region, which
  // would paint every body line as a term. The scope is a capture instead.
  const tokens = tokenize(':: term\n: body\n')
  for (const t of tokens.filter((x) => x.line === ': body')) {
    assert.ok(!has(t, TERM), `a body line is not the term, got ${t.scopes.join(' ')}`)
  }
})

test('two description items in a row are both scoped', () => {
  // `<dl><dt>t</dt><dd>a</dd><dt>u</dt><dd>b</dd></dl>`
  const tokens = tokenize(':: t\n: a\n:: u\n: b\n')
  for (const line of [': a', ': b']) {
    const marker = tokens.filter((t) => t.line === line && t.text === ':').at(0)
    assert.ok(marker && has(marker, DEF), `${line} lost its body scope:\n${report(tokens)}`)
  }
  for (const line of [':: t', ':: u']) {
    const marker = tokens.filter((t) => t.line === line && t.text === '::').at(0)
    assert.ok(marker && has(marker, TERM), `${line} lost its term scope:\n${report(tokens)}`)
  }
})

test('a term with no body is still a term', () => {
  // `<dl><dt>t</dt></dl>`
  const tokens = tokenize(':: t\n')
  const term = tokens.filter((t) => t.text === '::').at(0)
  assert.ok(term && has(term, TERM), `the term marker lost its scope:\n${report(tokens)}`)
})

test('a description list indented inside a list item is scoped', () => {
  // `<ul><li>outer<dl><dt>t</dt><dd>d</dd></dl></li></ul>`
  const tokens = tokenize('- outer\n  :: t\n  : d\n')
  const term = tokens.filter((t) => t.text === '::').at(0)
  assert.ok(term && has(term, TERM), `the indented term lost its scope:\n${report(tokens)}`)
  const marker = tokens.filter((t) => t.line === '  : d' && t.text === ':').at(0)
  assert.ok(marker && has(marker, DEF), `the indented body lost its scope:\n${report(tokens)}`)
})

test('a tab-indented description list is scoped', () => {
  // A tab is one character but advances to a tab stop, so a content column
  // rebuilt from literal characters gets this wrong. Engine: a `<dl>` inside
  // the item.
  const tokens = tokenize('- outer\n\t:: t\n\t: d\n')
  const term = tokens.filter((t) => t.text === '::').at(0)
  assert.ok(term && has(term, TERM), `the tab-indented term lost its scope:\n${report(tokens)}`)
  const marker = tokens.filter((t) => t.line === '\t: d' && t.text === ':').at(0)
  assert.ok(marker && has(marker, DEF), `the tab-indented body lost its scope:\n${report(tokens)}`)
})

/*
 * THE BOUND. A container that can run to the end of the document is worse than
 * the bug it fixes, so the region has to let go.
 */
test('the term container ends at a line below its own column', () => {
  const tokens = tokenize(':: t\n: a\n\npara\n\n# H\n')
  for (const line of ['para', '# H']) {
    const got = tokens.filter((t) => t.line === line)
    assert.ok(got.length > 0, `${line} was not tokenized at all`)
    for (const t of got) {
      assert.ok(
        !has(t, TERM) && !has(t, DEF),
        `the region outran its bound on ${JSON.stringify(line)}: ${t.scopes.join(' ')}`,
      )
    }
  }
  // The heading below it is still a heading, which it cannot be from inside a
  // region that never closed.
  const heading = tokens.filter((t) => t.line === '# H' && t.text === '#').at(0)
  assert.ok(
    heading && has(heading, 'punctuation.definition.heading.carve'),
    `the document after the list is still live:\n${report(tokens)}`,
  )
})

test('an indented description term is let go at a column below its own', () => {
  const tokens = tokenize('- outer\n  :: t\n  : d\nflush\n')
  for (const t of tokens.filter((x) => x.line === 'flush')) {
    assert.ok(
      !has(t, TERM) && !has(t, DEF),
      `the indented region outran its bound: ${t.scopes.join(' ')}`,
    )
  }
})

/*
 * A REMAINING LIMITATION, unchanged by this fix and recorded so it is not
 * mistaken for a regression. The engine renders `> :: t` over `> : d` as a
 * `<dl>` inside the blockquote, but both description rules are anchored on `^`
 * and `#block-quotes` ends at `$`, so neither can fire behind a `>` prefix.
 * Nothing on those lines carries a description scope, before or after #326.
 */
test('a description behind a block-quote marker is still unscoped', () => {
  const tokens = tokenize('> :: t\n> : d\n')
  for (const t of tokens) {
    assert.ok(
      !has(t, TERM) && !has(t, DEF),
      `this shape is expected to stay unscoped; it now has ${t.scopes.join(' ')}`,
    )
  }
})

/*
 * THE THREE EDGES THE CONTAINER GOT WRONG ON ITS FIRST CUT, each measured
 * against the installed engine rather than argued from the grammar.
 */
test('an indented marker under a column-0 term opens no fenced block', () => {
  // A body marker stands at the term's column, so an indented one is term
  // text. Engine: `<dl><dt>t\n: <code>\n    foo\n    </code></dt></dl>`, a
  // `<dt>` holding an inline code span. The body-column fence rule is
  // reachable only from the indented term branch for exactly this reason.
  const tokens = tokenize(':: t\n  : ```\n    foo\n    ```\n')
  const opener = tokens.filter((t) => t.text === '```').at(0)
  assert.ok(opener, `the run was not tokenized at all:\n${report(tokens)}`)
  assert.ok(
    !has(opener, BLOCK),
    `an indented marker under a column-0 term opens no block, got ${opener.scopes.join(' ')}`,
  )
})

test("the term's own content is read as inline, not as a container marker line", () => {
  // Engine: `<dl><dt>+ a |</dt><dd>d</dd></dl>`. The term line's remainder is
  // inline content; without its own region the `\G` marker-line rules in
  // `#container-body` fire behind the marker and paint a table continuation.
  const tokens = tokenize(':: + a |\n: d\n')
  for (const t of tokens.filter((x) => x.line === ':: + a |' && x.text !== '::')) {
    assert.ok(
      !has(t, 'markup.table'),
      `term text is not a table row, got ${JSON.stringify(t.text)} -> ${t.scopes.join(' ')}`,
    )
  }
})

test('a body indented differently from its term keeps its scope', () => {
  // A tab and the spaces that reach the same column are one column to the
  // engine, and TextMate cannot do tab-stop arithmetic, so the region's end
  // takes a marker at ANY indent. Engine for both: a `<dl>` with a `<dd>`.
  //   corpus 154-under-indented-definition-attaches-over-indented-definition-folds
  for (const src of ['- outer\n\t:: t\n    : d\n', '- one\n  :: term\n :  def\n']) {
    const tokens = tokenize(src)
    const marker = tokens.filter((t) => t.text === ':').at(0)
    assert.ok(marker, `the body marker was not tokenized at all:\n${report(tokens)}`)
    assert.ok(
      has(marker, DEF),
      `the body lost its scope on ${JSON.stringify(src)}: ${marker.scopes.join(' ')}`,
    )
  }
})

test('a block opener on a term continuation line is term text', () => {
  // corpus 503-a-block-opener-indented-under-a-definition-term-is-term-text-at-every-depth
  // and 504-a-comment-or-a-definition-under-a-definition-term-folds-at-every-depth.
  // A `<dt>` holds inline content, so everything from the term marker to the
  // first body marker is read inline. The engine renders each of these as one
  // `<dt>`: `:: t` over `  # heading` is `<dt>t\n  # heading</dt>`.
  const CONTINUATIONS = [
    ['a heading', ':: t\n  # heading\n: d\n', '  # heading'],
    ['a container opener', ':: c\n  ::: note\n  body\n  :::\n', '  ::: note'],
    ['a reference definition', ':: t\n  [r]: /u\n: d\n', '  [r]: /u'],
  ]
  for (const [label, src, line] of CONTINUATIONS) {
    const got = tokenize(src).filter((t) => t.line === line)
    assert.ok(got.length > 0, `${label}: the line was not tokenized at all`)
    for (const t of got) {
      assert.ok(
        t.scopes.length === 1 && t.scopes[0] === 'text.carve',
        `${label} is term text, got ${JSON.stringify(t.text)} -> ${t.scopes.join(' ')}`,
      )
    }
  }
})

test('a block in a description BODY is still a block', () => {
  // The other side of that split, and the reason it is a split: once a `:`
  // marker has been seen the body is a container, so the engine does render
  // `:: t` over `:  d` over `   # H` with an `<h1>` inside the `<dd>`.
  const tokens = tokenize(':: t\n:  d\n   # H\n')
  const marker = tokens.filter((t) => t.line === '   # H' && t.text === '#').at(0)
  assert.ok(
    marker && has(marker, 'punctuation.definition.heading.carve'),
    `a heading in a description body lost its scope:\n${report(tokens)}`,
  )
})

test('an outdented continuation ends the list rather than being held as term text', () => {
  // The term's inline phase reads from the parent region, not from a child
  // region of its own, because vscode-textmate does not test an enclosing
  // region's `end` while a child is open. A child that could not see the
  // term's column held this past the point where the engine ends the list.
  // Engine: `<ul><li>outer<dl><dt>t</dt></dl><h1>H</h1>\n<p>: orphan</p></li></ul>`.
  const tokens = tokenize('- outer\n    :: t\n  # H\n  : orphan\n')
  const heading = tokens.filter((t) => t.line === '  # H' && t.text === '#').at(0)
  assert.ok(
    heading && has(heading, 'punctuation.definition.heading.carve'),
    `the outdented heading lost its scope:\n${report(tokens)}`,
  )
  for (const t of tokens.filter((x) => x.line === '  : orphan')) {
    assert.ok(!has(t, DEF), `the orphan below it is prose, got ${t.scopes.join(' ')}`)
  }
})

test("a description body's marker line is read as inline, not as a container marker line", () => {
  // Engine: `<dl><dt>t</dt><dd>+ a |\ntail</dd></dl>`. The body opens a region
  // and so has a marker line of its own; without an inline child for it the
  // `\G` table-continuation rule paints the body text.
  const tokens = tokenize(':: t\n:  + a |\ntail\n')
  for (const t of tokens.filter((x) => x.line === ':  + a |' && x.text !== ':')) {
    assert.ok(
      !has(t, 'markup.table'),
      `body text is not a table row, got ${JSON.stringify(t.text)} -> ${t.scopes.join(' ')}`,
    )
  }
})

test("a sibling block at the term's column is released by the region", () => {
  // The region ends on a line indented PAST the term, not at it. Engine for
  // corpus 503-...-8: `  # H` under `  :: c` is an `<h1>` beside the list, so
  // holding every line at the term's column as term text lost its scope.
  for (const src of [
    '- outer\n  :: t\n  : d\n\n  # H\n  : orphan\n',
    ':: a\n: b\n  :: c\n  # H\n',
  ]) {
    const tokens = tokenize(src)
    const heading = tokens.filter((t) => t.line === '  # H' && t.text === '#').at(0)
    assert.ok(
      heading && has(heading, 'punctuation.definition.heading.carve'),
      `the sibling heading lost its scope on ${JSON.stringify(src)}:\n${report(tokens)}`,
    )
  }
})
