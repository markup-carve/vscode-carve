/**
 * A CODE FENCE THAT IS A DESCRIPTION BODY IS A FENCED BLOCK, NOT A CODE SPAN
 * (markup-carve/vscode-carve#320).
 *
 * The definition-list rule is a `match` rule that consumes only
 * `indent + : + separator`, so a fence opener written as a description body
 * sits MID-LINE. Every block fence rule in the grammar is anchored on `^` or
 * on a `\G` that rule never establishes, so none could reach it and the inline
 * raw-span rule took the run instead: the opener, the lines under it and the
 * trailing run were all painted `markup.raw.inline.carve`, and the fence lost
 * its language scope with them.
 *
 * WHY THIS IS AN ASSERTION AND NOT ONLY A SNAPSHOT. The corpus snapshot for
 * this shape was committed pinning the WRONG reading, and CI stayed green on
 * it, because a snapshot only states that the grammar did not change. Only a
 * check that says what the scopes MEAN can fail on a wrong one.
 *
 * THE ORACLE IS THE CORPUS, not this grammar. Corpus 548 renders
 *
 *     :: t
 *     : ```
 *     code
 *     ```
 *
 * as an EMPTY `<pre><code></code></pre>` inside the `<dd>`, followed by a
 * document-level `<p>code <code></code></p>`. The body lines are below the
 * definition's content column, so the fence holds NONE of them. That is why
 * the region ends at the content column and not at the next backtick run.
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
const BLOCK = 'markup.raw.block.fenced.code.carve'
const INLINE = 'markup.raw.inline'
const run = (tokens, text) => tokens.filter((t) => t.text === text)

/*
 * Corpus 548 at column 0, and the same shape indented inside a list item. The
 * indented case is not decoration: a rule that works at column 0 can still
 * fail at an indent, and the corpus case is indented by construction once the
 * description list sits in any container.
 */
const OPENERS = [
  ['at column 0', ':: t\n: ```\ncode\n```\n'],
  ['indented in a list item', '- outer\n  :: t\n  : ```\n  code\n  ```\n'],
]

for (const [label, src] of OPENERS) {
  test(`a fence opening a description body ${label} is a fenced block`, () => {
    const opener = run(tokenize(src), '```').at(0)
    assert.ok(opener, 'the fence opener was not tokenized at all')
    assert.ok(
      has(opener, BLOCK),
      `the opener must be a fenced block, got ${opener.scopes.join(' ')}`,
    )
    assert.ok(
      !has(opener, INLINE),
      `the opener must not be a code span, got ${opener.scopes.join(' ')}`,
    )
  })

  test(`a description body fence ${label} keeps the definition marker scoped`, () => {
    // The fix cannot buy the fence scope by eating the marker: a rule-level
    // name would span the region, so the marker and separator are nested
    // captures inside the begin match instead.
    const marker = run(tokenize(src), ':').at(0)
    assert.ok(marker, 'the definition marker was not tokenized at all')
    assert.ok(
      has(marker, 'markup.list.definition.carve'),
      `the marker lost its definition scope: ${marker.scopes.join(' ')}`,
    )
  })
}

test('a description body fence holds no line below its content column', () => {
  // The corpus reading: `code` at column 0 is below the content column, so it
  // is a document-level paragraph and NOT fence content. Before the fix it was
  // `markup.raw.inline.content.carve`.
  const body = run(tokenize(':: t\n: ```\ncode\n```\n'), 'code')
  assert.ok(body.length > 0, 'the body line was not tokenized at all')
  for (const t of body) {
    assert.ok(
      !has(t, INLINE) && !has(t, BLOCK),
      `a line below the content column is ordinary text, got ${t.scopes.join(' ')}`,
    )
  }
})

test('a description body fence takes content and a closer at its content column', () => {
  // The well-formed shape, which is what the region is for. The language scope
  // has to survive, because losing it was half of the reported defect.
  const tokens = tokenize(':: t\n: ```js\n  code\n  ```\n')
  const lang = run(tokens, 'js').at(0)
  assert.ok(lang, 'the language word was not tokenized at all')
  assert.ok(
    has(lang, 'entity.name.type.language.carve'),
    `the fence language scope was lost: ${lang.scopes.join(' ')}`,
  )

  const content = tokens.filter((t) => t.line === '  code')
  assert.ok(content.length > 0, 'the fence content was not tokenized at all')
  for (const t of content) {
    assert.ok(has(t, BLOCK), `the fence content is not inside the block: ${t.scopes.join(' ')}`)
  }

  const closer = tokens.filter((t) => t.line === '  ```' && t.text === '```').at(0)
  assert.ok(closer, 'the closer was not tokenized at all')
  assert.ok(
    has(closer, 'punctuation.definition.raw.end.carve'),
    `the closer must be the fence end, got ${closer.scopes.join(' ')}`,
  )
})

test('a line below the content column ends the region rather than being consumed', () => {
  // The bound. `  after` is at column 2 where the content column is 4, so the
  // region closes and the text is left to the enclosing context.
  const tokens = tokenize('- outer\n  :: t\n  : ```js\n    code\n    ```\n  after\n')
  for (const t of tokens.filter((x) => x.line === '  after')) {
    assert.ok(!has(t, BLOCK), `the region outran its bound: ${t.scopes.join(' ')}`)
  }
})

/*
 * THE NEGATIVES. The fix must not turn a code SPAN in a description body into
 * a block, and must not lower the fence threshold.
 */
test('an inline code span in a description body is still a code span', () => {
  const tokens = tokenize(':: t\n: `x` and ``y``\n')
  for (const text of ['x', 'y']) {
    const t = run(tokens, text).at(0)
    assert.ok(t, `${text} was not tokenized at all`)
    assert.ok(has(t, INLINE), `${text} must stay a code span, got ${t.scopes.join(' ')}`)
    assert.ok(!has(t, BLOCK), `${text} must not become a block, got ${t.scopes.join(' ')}`)
  }
})

test('a two-backtick run in a description body does not open a fence', () => {
  // Corpus two-backticks-are-not-a-code-fence-opening-or-closing, carried into
  // the description-body position.
  const opener = run(tokenize(':: t\n: ``\ncode\n``\n'), '``').at(0)
  assert.ok(opener, 'the run was not tokenized at all')
  assert.ok(
    !has(opener, BLOCK),
    `two backticks are not a fence, got ${opener.scopes.join(' ')}`,
  )
  assert.ok(has(opener, INLINE), `two backticks stay inline, got ${opener.scopes.join(' ')}`)
})

test('a `::` term line is untouched by the description-body fence rule', () => {
  // The new begin needs whitespace after a single colon, which `::` has not.
  const t = run(tokenize(':: ```\n'), '::').at(0)
  assert.ok(t, 'the term marker was not tokenized at all')
  assert.ok(
    has(t, 'markup.list.definition.term.carve'),
    `the term marker lost its scope: ${t.scopes.join(' ')}`,
  )
})

/*
 * THE TWO BOUNDARIES A FIRST CUT OF THIS RULE GOT WRONG, both measured against
 * the installed engine rather than argued from the grammar.
 */
test('an over-indented run is not the closer of a description body fence', () => {
  // Engine: `:: t` over `: ```` ` over `  first` over `    ```` ` over
  // `  *after*` keeps BOTH the over-indented run and `*after*` inside the
  // `<pre><code>`. Allowing padding before the closer ended the block early and
  // lit up emphasis inside a code block.
  const src = ':: t\n: ```\n  first\n    ```\n  *after*\n'
  const tokens = tokenize(src)
  for (const line of ['    ```', '  *after*']) {
    const got = tokens.filter((t) => t.line === line)
    assert.ok(got.length > 0, `${line} was not tokenized at all`)
    for (const t of got) {
      assert.ok(
        has(t, BLOCK),
        `${JSON.stringify(line)} stays inside the fence, got ${t.scopes.join(' ')}`,
      )
    }
    assert.ok(
      !got.some((t) => has(t, 'markup.bold') || has(t, 'strong')),
      'emphasis must not be live inside a code block',
    )
  }
})

test('an indented description marker at the document level opens no fence', () => {
  // Engine: `  : ```` ` over `    foo` over `    ```` ` at the document level is
  // a PARAGRAPH holding an inline code span, not a description and not a block.
  // The column-0 branch is strict for exactly this reason; the indented shape is
  // a description only inside a container.
  const tokens = tokenize('  : ```\n    foo\n    ```\n')
  for (const t of tokens.filter((x) => x.line === '    foo')) {
    assert.ok(
      !has(t, BLOCK),
      `no fenced block opens at the document level, got ${t.scopes.join(' ')}`,
    )
  }
})

test('an indented description fence inside a container is still a fenced block', () => {
  // The other side of that split, and why the indented variant exists at all:
  // the engine renders this as a `<dl>` inside the `<li>` whose `<dd>` holds a
  // `<pre><code>`.
  const tokens = tokenize('- outer\n  :: t\n  : ```\n    code\n    ```\n')
  const content = tokens.filter((t) => t.line === '    code')
  assert.ok(content.length > 0, 'the fence content was not tokenized at all')
  for (const t of content) {
    assert.ok(has(t, BLOCK), `the fence content is not in the block: ${t.scopes.join(' ')}`)
  }
})

test('a tab-indented body line stays inside a description body fence', () => {
  // A tab is ONE whitespace character but advances to a tab stop, so a content
  // column rebuilt from literal characters released this line and lit up bold
  // inside a code block. The engine keeps `\t*code*` inside the fence under
  // `: ```` ` exactly as it does under `- ```` `, which is the control below.
  for (const src of [':: t\n: ```\n\t*code*\n  ```\n', '- ```\n\t*code*\n  ```\n']) {
    const got = tokenize(src).filter((t) => t.line === '\t*code*')
    assert.ok(got.length > 0, 'the body line was not tokenized at all')
    for (const t of got) {
      assert.ok(has(t, BLOCK), `a tab-indented body line is fence content: ${t.scopes.join(' ')}`)
      assert.ok(!has(t, 'markup.bold'), 'emphasis must not be live inside a code block')
    }
  }
})

test('an orphan description marker opens a fence, which is a known limitation', () => {
  // PINS A WRONG READING ON PURPOSE, labeled so a later fix shows up as a diff
  // here rather than silently. The engine renders `: ```` ` with no `::` term
  // above it as `<p>: <code>...</code></p>`, a paragraph with an inline span.
  // This grammar has no description-list state - on an unpatched grammar
  // `: text` already scopes as a definition - so the marker is taken at face
  // value and the fence opens. markup-carve/vscode-carve#326 tracks giving the
  // `::` term a container so both rules can require one.
  const opener = run(tokenize(': ```\ncode\n```\n'), '```').at(0)
  assert.ok(opener, 'the run was not tokenized at all')
  assert.ok(
    has(opener, BLOCK),
    `pinning today's reading; update this test when #326 lands: ${opener.scopes.join(' ')}`,
  )
})
