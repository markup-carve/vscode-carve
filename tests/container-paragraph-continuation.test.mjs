/**
 * A LINE THE ENGINE DOES NOT READ AS A BLOCK AT A CONTAINER'S CONTENT COLUMN
 * (markup-carve/vscode-carve#329).
 *
 * Two of the three shapes #329 names are closed here. THE ORACLE IS THE
 * INSTALLED ENGINE: every expectation below was measured with `carveToHtml`
 * before it was written, and the HTML is quoted at the assertion that rests on
 * it.
 *
 * AN ABBREVIATION DEFINITION is a definition in every container
 * (markup-carve/carve#4874), so at a container's content column it carries the
 * definition scopes and its leading star opens no bold run.
 *
 * A CONTINUATION ROW folds into the row above it, so with no table open it is
 * text - at the document level as much as at a content column. A `match` rule
 * cannot ask what stood above it, so the row rules now sit inside a region
 * only a pipe row opens.
 *
 * THE THIRD SHAPE IS LEFT, with its evidence, at the end of this file.
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
const ABBR = 'meta.abbreviation.definition.carve'
const CONT = 'markup.table.continuation.carve'
const ROW = 'markup.table.row.carve'
const report = (tokens) =>
  tokens.map((t) => `${JSON.stringify(t.text)} -> ${t.scopes.join(' ')}`).join('\n')
const on = (tokens, line) => tokens.filter((t) => t.line === line)

/*
 * SHAPE ONE: AN ABBREVIATION DEFINITION AT A CONTAINER'S CONTENT COLUMN.
 *
 * markup-carve/carve#4874: the line defines the abbreviation in every host
 * below. Spec model on carve main, for the description body:
 *
 *   :: t          <dl><dt>t</dt><dd>d tail</dd></dl>
 *   :  d
 *      *[A]: a
 *   tail
 */
const HOSTS = [
  ['a description body', ':: t\n:  d\n   *[A]: a\ntail\n', '   *[A]: a'],
  ['a list item', '- a\n  *[A]: a\ntail\n', '  *[A]: a'],
  ['a list item inside a description body', ':: t\n:  - a\n    *[A]: a\n', '    *[A]: a'],
  ['a footnote body', '[^a]: intro\n  *[A]: a\n  more\n', '  *[A]: a'],
  ['an item body after a blank line', '- a\n\n  *[A]: a\n', '  *[A]: a'],
  ['a tab-indented item body', '- a\n\t*[A]: a\n', '\t*[A]: a'],
]

for (const [label, src, line] of HOSTS) {
  test(`an abbreviation definition in ${label} is a definition`, () => {
    const got = on(tokenize(src), line)
    assert.ok(got.some((t) => has(t, ABBR)), `the line carries no definition scope:\n${report(tokenize(src))}`)
    assert.ok(!got.some((t) => has(t, 'bold')), `the star opened bold:\n${report(tokenize(src))}`)
  })
}

test('a definition line keeps the block below it', () => {
  // Spec model: `<li><p>a</p><ul><li>b</li></ul></li>`.
  for (const [src, line, below] of [
    ['- a\n\n  *[A]: a\n  - b\n', '  *[A]: a', '  - b'],
    ['- a\n\n  *[A]: escaped \\*\n  - b\n', '  *[A]: escaped \\*', '  - b'],
    ['- a\n\n  *[A]: x \\* and *b*\n  - c\n', '  *[A]: x \\* and *b*', '  - c'],
    ['- a\n  *[A]: x and *b*\n', '  *[A]: x and *b*', null],
  ]) {
    const tokens = tokenize(src)
    assert.ok(on(tokens, line).some((t) => has(t, ABBR)), report(tokens))
    assert.ok(!on(tokens, line).some((t) => has(t, 'bold')), report(tokens))
    if (below) {
      const bullet = on(tokens, below).find((t) => t.text === '-')
      assert.ok(bullet && has(bullet, 'punctuation.definition.list.begin.carve'), report(tokens))
    }
  }
})

test('an abbreviation definition at the document level is still a definition', () => {
  // The negative that keeps the fix from being a deletion. Engine:
  // `<p><abbr title="x">A</abbr></p>`.
  const tokens = tokenize('*[A]: x\n\nA\n')
  const got = on(tokens, '*[A]: x')
  assert.ok(
    got.some((t) => has(t, ABBR)),
    `a document-level definition keeps its scope:\n${report(tokens)}`,
  )
})

test('a reference definition at a content column is still collected', () => {
  // Only the abbreviation rule left `#definitions-in-container`. A link
  // reference definition IS collected by its container (markup-carve/carve#660)
  // and must keep its scope. Engine: `:: t` over `:  d` over `   [r]: /u`
  // renders `<dd>d</dd>` with the definition consumed.
  const tokens = tokenize(':: t\n:  d\n   [r]: /u\n')
  const got = on(tokens, '   [r]: /u')
  assert.ok(
    got.some((t) => has(t, 'meta.link.reference.definition.carve')),
    `the reference definition lost its scope:\n${report(tokens)}`,
  )
})

/*
 * SHAPE TWO: A CONTINUATION ROW WITH NO ROW ABOVE IT.
 *
 * Engine:
 *
 *   - + a |      <ul><li>+ a |
 *   tail         tail</li></ul>
 *
 *   :: t         <dl><dt>t</dt><dd>a
 *   :  a         + b |
 *      + b |     tail</dd></dl>
 *   tail
 */
const ORPHAN_ROWS = [
  // 326-a-column-0-line-after-a-container-s-last-block-...-24
  ["on a list item's marker line", '- + a |\ntail\n', '- + a |'],
  // 326-...-25
  ['on a nested marker line', '- - + a |\ntail\n', '- - + a |'],
  // 326-...-28
  ["at a description body's content column", ':: t\n:  a\n   + b |\ntail\n', '   + b |'],
  // Engine: `<p>+ b |\ntail</p>`. The document level is the same rule, which is
  // why the fix is not specific to containers.
  ['at the document level', '+ b |\ntail\n', '+ b |'],
  // After a GFM delimiter row there is no body row, so the engine renders
  // `<p>+ cont |</p>` beside the table. Left as it was: see the note at the
  // end of this file.
]

for (const [label, src, line] of ORPHAN_ROWS) {
  test(`a continuation row ${label} is not a continuation row`, () => {
    const tokens = tokenize(src)
    const got = on(tokens, line)
    assert.ok(got.length > 0, `the line was not tokenized at all:\n${report(tokens)}`)
    for (const t of got) {
      assert.ok(
        !has(t, CONT) && !has(t, 'table'),
        `a continuation row needs a row above it, got ${JSON.stringify(t.text)} -> ${t.scopes.join(' ')}`,
      )
    }
  })
}

/*
 * THE POSITIVES. A real continuation row must keep its scope, and a region
 * that only a pipe row opens is easy to get wrong at an indent, on a marker
 * line and across several rows at once.
 */
const REAL_ROWS = [
  // 237-a-continuation-row-carries-no-trailing-text
  ['at the document level', '| a | b |\n+ c | d |\n', '+ c | d |'],
  // 349-a-container-whose-table-ends-on-a-continuation-row
  ["on a list item's marker line", '- | a |\n  + b |\ntail\n', '  + b |'],
  // 349-...-6: the row opens on the description body's OWN marker line.
  ['at a description body content column', ':: t\n:  | a |\n   + b |\ntail\n', '   + b |'],
  // A tab and the spaces that reach the same column are one column to the
  // engine, and TextMate cannot do tab-stop arithmetic, so the region takes
  // any indent.
  ['tab-indented under a marker line', '- | a |\n\t+ b |\ntail\n', '\t+ b |'],
  // 355-a-container-whose-table-ends-on-a-joined-header-row: a joined header
  // row is a row too.
  ['under a header row', '|= a |= b |\n+ cont |\n', '+ cont |'],
  // 349-...-3: behind a quote marker, where the rule is reached without the
  // region - see the note at the end of this file.
  ['behind a quote marker', '> | a |\n> + b |\n', '> + b |'],
]

for (const [label, src, line] of REAL_ROWS) {
  test(`a continuation row ${label} keeps its scope`, () => {
    const tokens = tokenize(src)
    const got = on(tokens, line)
    assert.ok(got.length > 0, `the line was not tokenized at all:\n${report(tokens)}`)
    assert.ok(
      got.some((t) => has(t, CONT)),
      `the continuation row lost its scope:\n${report(tokens)}`,
    )
  })
}

test('several continuation rows in a row all keep their scope', () => {
  // corpus 63-table-multi-line-cell-continuation. The region has to survive
  // more than one continuation line, and then let a plain row through.
  const src =
    '|= F |= D |\n| a | b |\n+   | c |\n+   | d |\n| e | f |\n'
  const tokens = tokenize(src)
  for (const line of ['+   | c |', '+   | d |']) {
    assert.ok(
      on(tokens, line).some((t) => has(t, CONT)),
      `${JSON.stringify(line)} lost its continuation scope:\n${report(tokens)}`,
    )
  }
  assert.ok(
    on(tokens, '| e | f |').some((t) => has(t, ROW)),
    `the row after the continuations lost its scope:\n${report(tokens)}`,
  )
})

/*
 * THE BOUND. A region that can run to the end of the document is worse than
 * the bug, so it has to let go on the first line that is not a continuation
 * row - and the document below it has to still be live.
 */
test('the table region lets go on the first line that is not a continuation row', () => {
  const tokens = tokenize('| a | b |\n+ c | d |\n# H\n\nmore\n')
  const heading = on(tokens, '# H').find((t) => t.text === '#')
  assert.ok(
    heading && has(heading, 'punctuation.definition.heading.carve'),
    `the document after the table is not live:\n${report(tokens)}`,
  )
  for (const t of on(tokens, 'more')) {
    assert.ok(!has(t, 'table'), `the region outran its bound: ${t.scopes.join(' ')}`)
  }
})

test('a blank line ends the table region', () => {
  const tokens = tokenize('| a |\n\n+ b |\n')
  for (const t of on(tokens, '+ b |')) {
    assert.ok(
      !has(t, CONT),
      `a blank line ends the table, so this row has none above it: ${t.scopes.join(' ')}`,
    )
  }
})

test('the container table region does not hold its host open', () => {
  // The hazard the region has to avoid: vscode-textmate does not test an
  // enclosing region's `end` while a child is open, so a region opened inside
  // a container can hold that container alive for a line. Engine ends the list
  // at `tail`, which is a document-level paragraph.
  const tokens = tokenize('- | a |\n  + b |\ntail\n')
  for (const t of on(tokens, 'tail')) {
    assert.ok(
      t.scopes.length === 1 && t.scopes[0] === 'text.carve',
      `the host outran its bound on tail: ${t.scopes.join(' ')}`,
    )
  }
})

/*
 * SHAPE THREE, AND TWO NARROWER CASES, LEFT WITH THEIR EVIDENCE.
 *
 * AN UNTERMINATED FENCE. The engine decides whether a backtick run opens a
 * block by whether a closer arrives later at the right column: `a` over
 * ``` ``` ``` over `tail` is ONE paragraph holding an unclosed inline span, at
 * the document level (corpus 81-paragraph-interruption-19) exactly as at a
 * description body's content column (367-an-unterminated-fence-at-a-content-
 * column-opens-no-block-so-the-paragraph-stays-open-2). A TextMate grammar
 * commits a scope on the line it is scanning and has no lookahead past it, so
 * this is not a column question and not a rule that can be written. Seven
 * corpus documents in the description population read it as a block, and so do
 * 71 outside it. Recorded, not closed.
 *
 * A CONTINUATION ROW BEHIND A QUOTE MARKER. A quote body is per-line - its own
 * region ends at `$` - so a region opened inside it dies with the line that
 * opened it. Measured: pointing `#block-quote-body` at the region dropped the
 * continuation scope from `> | a |` over `> + b |`, where the engine does
 * render a table, and held the quote open for one line past its end. So that
 * include keeps the bare rules and 326-...-29 still scopes `   > + b |` with
 * no row above it.
 *
 * A CONTINUATION ROW AFTER A GFM DELIMITER ROW. corpus
 * 115-a-continuation-row-needs-a-body-row renders `+ cont |` under
 * `| a | b |` over `| - | - |` as `<p>+ cont |</p>`: a delimiter row is not a
 * body row, so there is nothing to fold into. The region cannot tell, because
 * closing it from inside the delimiter-row rule is not something a TextMate
 * region can do. A narrower over-match than the one this file closes, and
 * outside #329's population.
 */
test('an unterminated fence at a content column is still read as a block', () => {
  // Pinned so the day it changes is visible. If this assertion starts failing
  // because the run is NO LONGER a block, that is the fix, and the expectation
  // is what moves.
  const tokens = tokenize(':: t\n:  a\n   ```\ntail\n')
  const opener = tokens.find((t) => t.text === '```')
  assert.ok(opener, `the run was not tokenized at all:\n${report(tokens)}`)
  assert.ok(
    has(opener, 'markup.raw.block.fenced.code.carve'),
    `this shape is expected to stay a block; it now has ${opener.scopes.join(' ')}`,
  )
})

test('an unterminated fence at the document level reads the same way', () => {
  // The control that says the shape is not about a container's column.
  const tokens = tokenize('a\n```\ntail\n')
  const opener = tokens.find((t) => t.text === '```')
  assert.ok(opener, `the run was not tokenized at all:\n${report(tokens)}`)
  assert.ok(
    has(opener, 'markup.raw.block.fenced.code.carve'),
    `the document level reads the same way; it now has ${opener.scopes.join(' ')}`,
  )
})
