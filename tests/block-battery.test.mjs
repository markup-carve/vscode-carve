/**
 * The bundled grammar classifies the shared block battery the way every other
 * Carve grammar does.
 *
 * This grammar is a port of carve-grammars' TextMate one, and the two have
 * drifted before. The last time, the same rule was fixed in six copies and one
 * silently missed it - the PR merged, the changelog said so, and the grammar
 * kept colouring `-` and `1.` as markers. It was found by someone comparing the
 * copies by hand.
 *
 * tests/lib/block-battery.json is that comparison, made routine: the identical
 * table carve-grammars runs, vendored here, with a drift check keeping the copy
 * honest.
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

const { shapes } = JSON.parse(
  readFileSync(resolve(__dirname, 'lib/block-battery.json'), 'utf8'),
)

// Same reduction carve-grammars uses. The alternatives are not cosmetic: Prism
// spells it `definition-term` and TextMate `list.definition.term`, and matching
// only one form made a negative pass while the grammar still highlighted.
function classify(scopeNames) {
  const joined = scopeNames.join(' ')
  if (/heading|section/.test(joined)) return 'heading'
  if (/caption/.test(joined)) return 'caption'
  if (/quote/.test(joined)) return 'quote'
  if (/definition[.-]term|list\.definition/.test(joined)) return 'deflist'
  if (/list|bullet/.test(joined)) return 'list'
  return 'none'
}

const wasm = readFileSync(
  resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm'),
)
await oniguruma.loadWASM(wasm.buffer)

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

// A trailing line keeps the shape off the last line of the document, where a
// `$`-anchored rule behaves differently.
function classifyLine(src) {
  const lines = `${src}\nafter\n`.split('\n')
  let state = vsctm.INITIAL
  const result = grammar.tokenizeLine(lines[0], state)
  return classify(result.tokens.flatMap((t) => t.scopes))
}

test('the bundled grammar agrees with the shared block battery', () => {
  const failures = []
  for (const { src, want, why } of shapes) {
    const got = classifyLine(src)
    if (got !== want) {
      failures.push(
        `  ${JSON.stringify(src).padEnd(14)} want=${want.padEnd(8)} got=${got}` +
          (why ? `   (${why})` : ''),
      )
    }
  }
  assert.equal(
    failures.length,
    0,
    `\n${failures.join('\n')}\n\n` +
      'The battery records what carve-rs renders. Change the grammar, not the battery.',
  )
})

/*
 * THE SAME SHAPES ONE CONTAINER PREFIX IN.
 *
 * Every shape in the vendored battery above is a COLUMN-0 line, and that is
 * exactly the column at which this grammar's block rules were all anchored. The
 * shapes below are the same blocks behind a container prefix - a list marker, a
 * checkbox, a quote marker, or an item's own body column - which is where five
 * separate rules turned out to be unreachable at once (markup-carve/vscode-carve#127,
 * markup-carve/vscode-carve#128, markup-carve/vscode-carve#129,
 * markup-carve/vscode-carve#130, markup-carve/vscode-carve#131).
 *
 * They live here rather than in a battery entry because the battery is a
 * VENDORED copy of carve-grammars' table (tools/check-battery-drift.sh proves
 * it still is), so it cannot grow a column this repo invents.
 *
 * WHY ASSERTIONS AND NOT SNAPSHOTS, the reason
 * tests/marker-line-comment-fence.test.mjs already gives: a snapshot is
 * self-consistency with a golden this repo generated from this grammar, so
 * green means the grammar did not CHANGE, never that it is right. Worse for
 * this family specifically, the `no scope lives only in a skipped category`
 * invariant in tests/coverage.test.mjs is structurally unable to see any of it:
 * an ABSENT rule emits no scope, and a scope that is never emitted can never be
 * an orphan. Four of these gaps were measured into categories.json skip reasons
 * and stayed there.
 *
 * BOTH DIRECTIONS on every shape. The right scope has to appear AND the wrong
 * one has to be gone: #130 in particular was never a silence, it was
 * `constant.character.typography.carve` on a thematic break, and a
 * presence-only check passes that unchanged.
 *
 * The oracle is carve-js at the pinned engine (package.json), quoted per shape.
 */

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

const has = (t, needle) => t.scopes.some((s) => s.includes(needle))

/*
 * A HEADING BEHIND A CONTAINER PREFIX (markup-carve/vscode-carve#131).
 *
 * carve-js renders every one of these as a heading inside its container:
 * `- [x] # h` is corpus 363-a-task-item-s-checkbox-is-not-decided-by-its-first-block,
 * `> # h` is `<blockquote><h1 id="h">h</h1></blockquote>`, and `- x` over
 * `  # h` is an `<h1>` at the item's content column.
 */
const HEADING_SHAPES = [
  ['a dash marker line', '- # h\n', '# h'],
  ['a star marker line', '* # h\n', '# h'],
  ['an ordered marker line', '1. # h\n', '# h'],
  ['a task marker line', '- [x] # h\n', '# h'],
  ['a quote marker line', '> # h\n', '# h'],
  ['a quote on an item marker line', '- > # h\n', '# h'],
  ["an item's own body column", '- x\n  # h\n', '  # h'],
]

for (const [label, src, line] of HEADING_SHAPES) {
  test(`a heading on ${label} carries the heading scope`, () => {
    const tokens = tokenize(src).filter((t) => t.line.endsWith(line))
    assert.ok(tokens.length > 0, 'the heading line was not tokenized at all')
    assert.ok(
      tokens.some((t) => has(t, 'punctuation.definition.heading')),
      `the hash run is not heading punctuation: ${tokens.map((t) => t.scopes.join(' ')).join(' | ')}`,
    )
    assert.ok(
      tokens.some((t) => has(t, 'entity.name.section')),
      `the heading text is not a section name: ${tokens.map((t) => t.scopes.join(' ')).join(' | ')}`,
    )
  })
}

/*
 * The intended survivors. Without them a rule that took any hash run after a
 * marker would pass every shape above while colouring three paragraphs.
 */
const NOT_A_HEADING = [
  ['a hash run glued to its text', '- #h\n', '#h', 'carve-js renders a tag, not a heading'],
  ['a hash run mid-item', '- see # h\n', '# h', 'carve-js renders `see # h` as item text'],
  ['a hash run after an inline match', '- /a/ # h\n', '# h', 'the \\G anchor sits at the content column, not here'],
  ['seven hashes', '- ####### h\n', '####### h', 'carve-js renders `####### h` as item text'],
  ['a hash run with no content', '- #\n', '#', 'a marker with no content is not a heading'],
  ['an indented hash run at the document level', 'para\n\n  # h\n', '  # h', 'carve-js renders `  # h` as `<p># h</p>`'],
  ['a hash run behind an alternating prefix', '>     # h\n', '    # h', 'carve-js renders `<blockquote><p># h</p></blockquote>`'],
]

for (const [label, src, line, why] of NOT_A_HEADING) {
  test(`${label} is not a heading (${why})`, () => {
    const tokens = tokenize(src).filter((t) => t.line.endsWith(line))
    assert.ok(tokens.length > 0, 'the line was not tokenized at all')
    for (const t of tokens) {
      assert.ok(
        !has(t, 'markup.heading') && !has(t, 'entity.name.section'),
        `${JSON.stringify(t.text)} carries ${t.scopes.join(' ')}`,
      )
    }
  })
}

/*
 * A CODE FENCE BEHIND A CONTAINER PREFIX (markup-carve/vscode-carve#128).
 *
 * carve-js renders corpus
 * 361-a-paragraph-opened-after-a-block-in-an-item-is-still-open-for-a-lazy-line-3
 * as a `<pre><code>` inside the item, and the marker-line spelling the same
 * way. THE BODY DIRECTION IS THE ONE THAT MATTERS: with no region open, the
 * fence body was tokenized as live markup, so emphasis, links and reference
 * definitions inside a code block all lit up. A scope-on-the-fence check alone
 * would pass a rule that colours the backticks and still runs the body through
 * the inline patterns.
 */
const FENCE_SHAPES = [
  ["an item's marker line", '- ```\n  *c* [l](/u)\n  [r]: /url\n  ```\n\nafter\n'],
  ["an item's own body column", '- x\n  ```\n  *c* [l](/u)\n  [r]: /url\n  ```\n\nafter\n'],
  ['a tilde fence on a marker line', '- ~~~\n  *c* [l](/u)\n  [r]: /url\n  ~~~\n\nafter\n'],
  ['an ordered marker line', '1. ```\n   *c* [l](/u)\n   [r]: /url\n   ```\n\nafter\n'],
  ['a task marker line', '- [x] ```\n      *c* [l](/u)\n      [r]: /url\n      ```\n\nafter\n'],
]

const isRaw = (t) => has(t, 'markup.raw.block.fenced.code')

for (const [label, src] of FENCE_SHAPES) {
  test(`a fence on ${label} opens a raw block`, () => {
    const fences = tokenize(src).filter((t) => /^(```|~~~)$/.test(t.text))
    assert.equal(fences.length, 2, `expected an opener and a closer, got ${fences.length}`)
    assert.ok(
      fences[0].scopes.some((s) => s.includes('punctuation.definition.raw.begin')),
      `the opener is not raw-block punctuation: ${fences[0].scopes.join(' ')}`,
    )
    assert.ok(
      fences[1].scopes.some((s) => s.includes('punctuation.definition.raw.end')),
      `the closer is not raw-block punctuation: ${fences[1].scopes.join(' ')}`,
    )
  })

  test(`a fence on ${label} keeps its body opaque`, () => {
    const body = tokenize(src).filter((t) => t.line.includes('*c*') || t.line.includes('[r]:'))
    assert.ok(body.length > 0, 'the fence body was not tokenized at all')
    for (const t of body) {
      assert.ok(isRaw(t), `the body must be raw, got ${JSON.stringify(t.text)} as ${t.scopes.join(' ')}`)
      for (const live of ['markup.bold', 'markup.italic', 'meta.link', 'markup.underline.link']) {
        assert.ok(
          !has(t, live),
          `${JSON.stringify(t.text)} is live ${live} inside a code block: ${t.scopes.join(' ')}`,
        )
      }
    }
  })

  test(`a fence on ${label} ends at its closer`, () => {
    for (const t of tokenize(src).filter((x) => x.line === 'after')) {
      assert.ok(!isRaw(t), `the raw block must end at its closer, got ${t.scopes.join(' ')}`)
    }
  })
}

test('an unclosed fence on a marker line stops at the column-0 line that ends the item', () => {
  // The counterpart to the closer branch, and the reason the end carries a
  // container boundary: vscode-textmate does not test an enclosing container's
  // `end` while a child region is open, so without it an unclosed fence inside
  // an item would run to end of document.
  for (const t of tokenize('- ```\n  c\n\nafter\n\nmore\n').filter((x) => x.line === 'after' || x.line === 'more')) {
    assert.ok(!isRaw(t), `a column-0 line is past the item: ${t.scopes.join(' ')}`)
  }
})

test('an indented fence at the document level is not a fence', () => {
  // carve-js renders `  ```` over `  code` over `  ```` as a paragraph holding
  // an inline code span, which is why the indent allowance is reachable only
  // from `#container-body`.
  for (const t of tokenize('para\n\n  ```\n  code\n  ```\n\nafter\n').filter((x) => x.line.includes('code') || x.line.includes('```'))) {
    assert.ok(!isRaw(t), `${JSON.stringify(t.text)} carries ${t.scopes.join(' ')}`)
  }
})

/*
 * A TABLE ROW BEHIND A CONTAINER PREFIX (markup-carve/vscode-carve#129).
 *
 * carve-js renders `- | a |` as a table inside the item (corpus
 * 361-a-paragraph-opened-after-a-block-in-an-item-is-still-open-for-a-lazy-line-2),
 * and folds `  + b |` into the row above it. `#tables` begins on a lookahead
 * that tolerates indentation but not a marker, so the row on the marker line
 * carried nothing, and its continuation row was column-0 only.
 */
const TABLE_SHAPES = [
  ['a dash marker line', '- | a |\n\nafter\n'],
  ['a star marker line', '* | a |\n\nafter\n'],
  ['an ordered marker line', '1. | a |\n\nafter\n'],
  ['a task marker line', '- [ ] | a |\n\nafter\n'],
]

for (const [label, src] of TABLE_SHAPES) {
  test(`a row on ${label} carries the table scope`, () => {
    const pipes = tokenize(src).filter((t) => t.text === '|')
    assert.equal(pipes.length, 2, `expected two pipes, got ${pipes.length}`)
    for (const t of pipes) {
      assert.ok(
        has(t, 'punctuation.separator.table'),
        `the pipe is not a table separator: ${t.scopes.join(' ')}`,
      )
      assert.ok(has(t, 'markup.table.row'), `the row scope is missing: ${t.scopes.join(' ')}`)
    }
  })

  test(`a row on ${label} ends with its line`, () => {
    for (const t of tokenize(src).filter((x) => x.line === 'after')) {
      assert.ok(!has(t, 'markup.table'), `the row must end at its line: ${t.scopes.join(' ')}`)
    }
  })

  test(`a row on ${label} leaves the marker to the list rules`, () => {
    const marked = tokenize(src).some((t) => has(t, 'markup.list'))
    assert.ok(marked, 'the list marker lost its list scope')
  })
}

test("a continuation row at an item's content column is a continuation row", () => {
  const plus = tokenize('- x\n  | a |\n  + b |\n').filter((t) => t.text === '+')
  assert.equal(plus.length, 1, 'the continuation marker was not tokenized')
  assert.ok(
    has(plus[0], 'keyword.operator.table.continuation'),
    `the indented continuation marker carries ${plus[0].scopes.join(' ')}`,
  )
})

test('a pipe that is not at the content column is not a row', () => {
  // What the \G anchor buys, stated so it can fail: the row has to start at
  // the container's content column, not wherever a pipe happens to sit.
  // carve-js renders `- a | b` as item text. Drop the anchor and this line
  // becomes a table row.
  //
  // The `(?<=[ \t])` guard beside the anchor is NOT pinned by any assertion
  // here, deliberately. Measured against vscode-textmate: the \G anchor
  // position is set only where a begin/end rule is PUSHED, and inline match
  // rules never move it, so no input reaches this rule at a position preceded
  // by a non-space in the first place. The guard is kept for consistency with
  // the sibling marker-line rules, not because a test can distinguish it -
  // see markup-carve/vscode-carve#127 for the same claim made about
  // `#comment-fence-on-marker-line`.
  for (const t of tokenize('- a | b\n').filter((x) => x.text.includes('|'))) {
    assert.ok(!has(t, 'markup.table'), `${JSON.stringify(t.text)} carries ${t.scopes.join(' ')}`)
  }
})

/*
 * A THEMATIC BREAK BEHIND A CONTAINER PREFIX (markup-carve/vscode-carve#130).
 *
 * The odd one out of this family. `#thematic-break` was unreachable on a
 * marker line for the same reason the others were, but the dashes did not fall
 * silent: they fell through to `#smart-typography`, which claimed them as
 * `constant.character.typography.carve`. A scope IS produced and it is the
 * wrong one, so the ABSENCE assertion below is the one that fails on the
 * defect - checking that `meta.separator.thematic-break.carve` appears does not.
 *
 * carve-js renders `- [ ] ---` as an `<hr>` inside the item (corpus
 * 363-a-task-item-s-checkbox-is-not-decided-by-its-first-block) and `> ---` as
 * an `<hr>` inside the quote.
 */
const BREAK_SHAPES = [
  ['a dash marker line', '- ---\n', '---'],
  ['a task marker line', '- [ ] ---\n', '---'],
  ['an ordered marker line', '1. ---\n', '---'],
  ['a star run on a marker line', '- ***\n', '***'],
  ['an underscore run on a marker line', '- ___\n', '___'],
  ['a quote marker line', '> ---\n', '---'],
  ["an item's own body column", '- x\n\n  ---\n', '---'],
]

for (const [label, src, text] of BREAK_SHAPES) {
  test(`a break on ${label} is a thematic break`, () => {
    const tokens = tokenize(src).filter((t) => t.text.trim() === text)
    assert.ok(tokens.length > 0, 'the break line was not tokenized at all')
    for (const t of tokens) {
      assert.ok(
        has(t, 'meta.separator.thematic-break'),
        `the break carries ${t.scopes.join(' ')}`,
      )
    }
  })

  test(`a break on ${label} is not smart typography`, () => {
    const tokens = tokenize(src).filter((t) => t.text.trim() === text)
    assert.ok(tokens.length > 0, 'the break line was not tokenized at all')
    for (const t of tokens) {
      assert.ok(
        !has(t, 'constant.character.typography'),
        `the break is scoped as an em dash: ${t.scopes.join(' ')}`,
      )
    }
  })
}

test('a dash run that is not the whole line stays item text', () => {
  // The trailing `[ \t]*$` is what keeps the rule to a whole line. Without it
  // `- --- x` would become a break where carve-js renders item text.
  for (const t of tokenize('- --- x\n').filter((x) => x.text.includes('---'))) {
    assert.ok(!has(t, 'meta.separator.thematic-break'), `${JSON.stringify(t.text)} carries ${t.scopes.join(' ')}`)
  }
})

test('a dash run at the end of item text is not a break', () => {
  // What the \G anchor buys here: the break has to start at the container's
  // content column. carve-js renders `- a ---` as item text.
  for (const t of tokenize('- a ---\n').filter((x) => x.text.includes('---'))) {
    assert.ok(!has(t, 'meta.separator.thematic-break'), `${JSON.stringify(t.text)} carries ${t.scopes.join(' ')}`)
  }
})

test('two dashes on a marker line are not a break', () => {
  for (const t of tokenize('- --\n').filter((x) => x.text.includes('--'))) {
    assert.ok(!has(t, 'meta.separator.thematic-break'), `${JSON.stringify(t.text)} carries ${t.scopes.join(' ')}`)
  }
})
