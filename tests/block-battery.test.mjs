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
  ['a hash run after an inline match', '- /a/ # h\n', '# h', 'the anchor moves with every match on the line'],
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
