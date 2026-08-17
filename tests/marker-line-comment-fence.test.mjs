/**
 * A comment fence opened on a list item's MARKER line hides its body, closes at
 * its own closer, and leaves the rest of the document alone.
 *
 * Spec PART 9 section 24 S2 with section 28 make a comment's body verbatim and
 * invisible WHEREVER the fence sits, so `- %%%` is a fence exactly as a `%%%`
 * on a line of its own is. Corpus 337 pins the shape:
 *
 *     - %%%
 *       [r]: /url
 *       %%%
 *
 *     [r][]
 *
 * renders `<ul><li></li></ul><p>[r][]</p>` - the definition inside the fence
 * registers nothing, so the trailing `[r][]` stays literal text.
 *
 * WHY THIS IS AN ASSERTION AND NOT A SNAPSHOT (markup-carve/vscode-carve#113).
 * The corpus snapshots in tests/snapshots/ are self-consistency with a golden
 * this repo generated from this grammar: green means the grammar did not
 * CHANGE, never that it is right. The 337 golden was committed pinning
 * INVERTED highlighting - the hidden `[r]: /url` scoped live as a
 * `meta.link.reference.definition.carve`, the `%%%` after the marker scoped as
 * a LINE comment so no block opened, and the real closer was taken for an
 * opener and swallowed the `[r][]` paragraph below - and CI stayed green
 * through all of it. Only a check that states what the scopes MEAN can fail.
 *
 * The oracle is tree-sitter-carve, which is the one Carve grammar that gets
 * this shape right: it puts a `fenced_comment_block` inside `list_item_content`
 * - beside the `list_marker_*`, not over it - with the body as a single opaque
 * `content` node. Both carve-grammars highlighters were wrong here too, each in
 * a different direction (markup-carve/carve-grammars#243), so neither of those
 * could serve as the oracle.
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

const isComment = (t) => t.scopes.some((s) => s.startsWith('comment.'))

/*
 * Every shape is `<marker> <fence>` over a hidden reference definition, closed
 * at the item's content column, with a paragraph after the fence.
 *
 * `hidden` must end up inside a comment scope AND carry no live construct
 * scope; `visible` must carry no comment scope at all. Both directions are
 * asserted because the failure modes ran in opposite directions: the TextMate
 * grammar managed BOTH at once (a live hidden line and a hidden live line),
 * where carve-grammars' Prism only did the first and its highlight.js only the
 * second.
 */
const SHAPES = [
  ['a dash marker', '- %%%\n  [r]: /url\n  %%%\n\n[r][]\n'],
  ['a star marker', '* %%%\n  [r]: /url\n  %%%\n\n[r][]\n'],
  ['an ordered marker', '1. %%%\n   [r]: /url\n   %%%\n\n[r][]\n'],
  ['a marker run', '- - %%%\n    [r]: /url\n    %%%\n\n[r][]\n'],
  ['a task marker', '- [ ] %%%\n      [r]: /url\n      %%%\n\n[r][]\n'],
  ['a wider fence', '- %%%%\n  [r]: /url\n  %%%%\n\n[r][]\n'],
  ['a fence one item deeper', '- a\n  - %%%\n    [r]: /url\n    %%%\n\n[r][]\n'],
  ['an insignificant tail', '- %%% TODO\n  [r]: /url\n  %%% end\n\n[r][]\n'],
]

for (const [label, src] of SHAPES) {
  test(`a fence opened on ${label} hides its body`, () => {
    const hidden = tokenize(src).filter((t) => t.line.includes('[r]: /url'))
    assert.ok(hidden.length > 0, 'the fence body was not tokenized at all')
    for (const t of hidden) {
      assert.ok(
        isComment(t),
        `the hidden definition must be inside a comment, got ${JSON.stringify(t.text)}` +
          ` as ${t.scopes.join(' ')}`,
      )
    }
  })

  test(`a fence opened on ${label} closes at its closer`, () => {
    const after = tokenize(src).filter((t) => t.line === '[r][]')
    assert.ok(after.length > 0, 'the paragraph after the fence was not tokenized at all')
    for (const t of after) {
      assert.ok(
        !isComment(t),
        `the comment must end at its closer, but ${JSON.stringify(t.text)} carries` +
          ` ${t.scopes.join(' ')}`,
      )
    }
  })

  test(`a fence opened on ${label} leaves the marker to the list rules`, () => {
    // tree-sitter-carve keeps the marker OUTSIDE the comment. Consuming it here
    // would trade one wrong scope for another, so the fence is anchored on \G
    // after the container's own begin match rather than over it.
    const marked = tokenize(src).some((t) => t.scopes.some((s) => s.includes('markup.list')))
    assert.ok(marked, 'the list marker lost its list scope')
  })
}

test('a column-0 line ends the item, so it is not the fence closer', () => {
  // Corpus 326-6. The counterpart to the shapes above, and the reason the
  // closer is `[ \t]+` and not `[ \t]*`: a column-0 line ends the container and
  // with it the open fence, so `c` and `tail` stay VISIBLE and the unclosed
  // opener degrades to a comment on its own line. Closing on any indent would
  // have hidden two visible paragraphs to reveal one hidden line.
  const tokens = tokenize('- %%%\nc\n%%%\ntail\n')
  for (const t of tokens.filter((x) => x.line === 'c')) {
    assert.ok(!isComment(t), `a column-0 line is not inside the fence: ${t.scopes.join(' ')}`)
  }
})

test('a percent run glued to inline content is not a marker-line fence', () => {
  // The \G anchor moves with every match on the line, so the fence also asks to
  // be preceded by whitespace. Without that, `- /a/%%%` opened a fence at the
  // end of an emphasis run and hid the rest of the item.
  const tokens = tokenize('- /a/%%% x\n  b\n\nafter\n')
  for (const t of tokens.filter((x) => x.line === '  b' || x.line === 'after')) {
    assert.ok(!isComment(t), `nothing here is a comment, got ${t.scopes.join(' ')}`)
  }
})

/*
 * THE SAME RULE AT A BLOCK-QUOTE MARKER (markup-carve/vscode-carve#115).
 *
 * `> %%%` opens a fence for the same reason `- %%%` does - section 24 S2 with
 * section 28 hide a comment's body WHEREVER the fence sits - and this grammar
 * inverted it the same way, scoping the `%%%` as a trailing LINE comment so no
 * block opened and letting the hidden `[r]: /url` come back live. Corpus 70
 * pins the spelling:
 *
 *     > q
 *     > %%%
 *     > x
 *     > %%%
 *     > body
 *
 * renders `<blockquote><p>q</p><p>body</p></blockquote>`.
 *
 * MILDER than the list case in one respect - nothing swallowed the rest of the
 * document - and the shapes below still assert BOTH directions, because the
 * hidden-body half and the closes-at-its-closer half fail independently.
 *
 * Each shape is measured against the pinned engine, not inferred: an unclosed
 * `> %%%` degrades to a line comment and leaves its body visible, a closer
 * repeats the opener's fence width exactly, and a marker run deeper than the
 * opener's does not close it.
 */
const QUOTE_SHAPES = [
  ['a quote marker', '> %%%\n> [r]: /url\n> %%%\n\n[r][]\n'],
  ['a nested quote marker', '> > %%%\n> > [r]: /url\n> > %%%\n\n[r][]\n'],
  ['a wider quote fence', '> %%%%\n> [r]: /url\n> %%%%\n\n[r][]\n'],
  ['an insignificant tail on a quote fence', '> %%% TODO\n> [r]: /url\n> %%% end\n\n[r][]\n'],
  ['a marked blank line in the body', '> %%%\n> [r]: /url\n>\n> x\n> %%%\n\n[r][]\n'],
  ['a quote inside a list item', '- a\n  > %%%\n  > [r]: /url\n  > %%%\n\n[r][]\n'],
  // The closer matches the opener's width EXACTLY here too: the `> %%%%` in the
  // middle does not close this fence, so the definition BELOW it is still
  // hidden and only the real `> %%%` ends the run. Drop the width backreference
  // and the fence closes early, which shows up as the hidden definition scoping
  // live - a direction a swallow check cannot see.
  ['a wider run inside the fence', '> %%%\n> a\n> %%%%\n> [r]: /url\n> %%%\n\n[r][]\n'],
]

for (const [label, src] of QUOTE_SHAPES) {
  test(`a fence opened on ${label} hides its body`, () => {
    const hidden = tokenize(src).filter((t) => t.line.includes('[r]: /url'))
    assert.ok(hidden.length > 0, 'the fence body was not tokenized at all')
    for (const t of hidden) {
      assert.ok(
        isComment(t),
        `the hidden definition must be inside a comment, got ${JSON.stringify(t.text)}` +
          ` as ${t.scopes.join(' ')}`,
      )
    }
  })

  test(`a fence opened on ${label} closes at its closer`, () => {
    const after = tokenize(src).filter((t) => t.line === '[r][]')
    assert.ok(after.length > 0, 'the paragraph after the fence was not tokenized at all')
    for (const t of after) {
      assert.ok(
        !isComment(t),
        `the comment must end at its closer, but ${JSON.stringify(t.text)} carries` +
          ` ${t.scopes.join(' ')}`,
      )
    }
  })

  test(`a fence opened on ${label} leaves the marker to the quote rule`, () => {
    // tree-sitter-carve keeps the marker OUTSIDE the comment - the
    // fenced_comment_block sits inside the quote's content, beside the
    // block_quote_marker. The fence is anchored on \G after the quote's own
    // begin match rather than over it, so the marker keeps its quote scope.
    const marked = tokenize(src).some((t) => t.scopes.some((s) => s.includes('markup.quote')))
    assert.ok(marked, 'the quote marker lost its quote scope')
  })
}

test('the quote continues after the fence closes', () => {
  // Corpus 70's own shape: the fence opens BELOW quote content and the quote
  // goes on after the closer, so this is a check on the closer where the shapes
  // above check the opener.
  const tokens = tokenize('> q\n> %%%\n> [r]: /url\n> %%%\n> after\n')
  for (const t of tokens.filter((x) => x.line === '> after')) {
    assert.ok(!isComment(t), `the comment must end at its closer, got ${t.scopes.join(' ')}`)
  }
})

test('an unmarked line ends the quote, so an unclosed fence stops there', () => {
  // `> %%%` with no closer degrades to a line comment and leaves its body
  // visible; a TextMate begin sees one line, so this grammar cannot demand the
  // closer up front and still hides the rest of the QUOTE. What it must never
  // do is carry past the quote boundary into the document below.
  const tokens = tokenize('> %%%\n> [r]: /url\n\nvisibleline\n')
  for (const t of tokens.filter((x) => x.line === 'visibleline')) {
    assert.ok(!isComment(t), `an unmarked line is past the quote: ${t.scopes.join(' ')}`)
  }
})

test('a percent run glued to inline content is not a quote-marker fence', () => {
  // The \G anchor moves with every match on the line - here the emphasis run
  // `/a/` moves it right up to the `%%%` - so the fence also asks to be
  // preceded by whitespace. `> /a/%%% x` renders the percent run literally.
  const tokens = tokenize('> /a/%%% x\n> b\n\nafter\n')
  for (const t of tokens.filter((x) => x.line === '> b' || x.line === 'after')) {
    assert.ok(!isComment(t), `nothing here is a comment, got ${t.scopes.join(' ')}`)
  }
})
