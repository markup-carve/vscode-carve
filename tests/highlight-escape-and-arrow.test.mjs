/**
 * The bare highlight rule, on the two shapes it read wrong (vscode-carve#175).
 *
 * AN ESCAPED `=` IS NOT A DELIMITER (carve-grammars#385). The escape makes the
 * character literal, so `x =\= y` renders `x == y` with no mark at all, and
 * this rule closed on it and coloured a run the engine does not. The body now
 * consumes an escape as a PAIR and refuses a bare backslash, which settles both
 * directions at once: the escaped `=` is eaten before the closer can see it,
 * and a body that could not hold it would stop there and never reach the real
 * closer past it, so `a =b c\= d= e` - which the engine DOES mark - would have
 * gone from wrongly-coloured to uncoloured.
 *
 * That is deliberately not the upstream spelling, which counts the backslash
 * run in a lookbehind bounded by the repetition it writes out. The bound is
 * reachable: `a =b c\\\= d= e` is three backslashes and already outside the
 * odd-run branch. Consuming the pair has no bound and needs no lookbehind.
 *
 * A `=` THAT BEGINS A SMART-TYPOGRAPHY PATTERN IS NOT AN OPENER
 * (carve-grammars#325). `grammar.ebnf` consumes the pattern first: `=>` is the
 * arrow, never a highlight opener. The guard belongs on the OPENER alone - once
 * a highlight is open the closer beats the pattern, which is why `x =y z<= w`
 * marks `y z<`.
 *
 * WHY THIS IS AN ASSERTION AND NOT A SNAPSHOT, for the reason
 * tests/marker-line-quote.test.mjs already gives: a snapshot is self-consistency
 * with a golden this repo generated from this grammar, so green means the
 * grammar did not CHANGE, never that it is right.
 *
 * The oracle is the engine. Every row below was rendered through
 * `@markup-carve/carve`'s `carveToHtml` and read off the `<mark>` it did or did
 * not produce; the expectations are the SOURCE span the grammar should colour,
 * which differs from the engine's rendered text wherever an escape is consumed
 * (`a =b c\= d= e` renders the mark `b c= d`, and the grammar colours `b c\= d`).
 *
 * BOTH DIRECTIONS. A no-mark-only check passes a rule that colours nothing, and
 * a mark-only check passes a rule that colours everything.
 *
 * THREE ROWS ARE KNOWN RESIDUALS and are deliberately not asserted, the same
 * three carve-grammars pins upstream: `x =<== y`, `x =!== y` and `x =a== y`,
 * all "a closer followed by another `=`", which the engine marks and the
 * `(?![\w=])` closer guard refuses. Widening that guard means letting the body
 * hold its own delimiter, which costs more shapes than it buys.
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

/** @returns {string} the source text this grammar colours as a highlight BODY. */
function markedRun(src) {
  let state = vsctm.INITIAL
  let out = ''
  for (const line of src.split('\n')) {
    const r = grammar.tokenizeLine(line, state)
    state = r.ruleStack
    for (const t of r.tokens) {
      const inBody =
        t.scopes.some((s) => s.includes('markup.highlight.carve')) &&
        !t.scopes.some((s) => s.includes('punctuation.definition.highlight'))
      if (inBody) out += line.substring(t.startIndex, t.endIndex)
    }
  }
  return out
}

/** [source, the span the engine marks, '' for no mark at all] */
const ROWS = [
  // An escaped `=` is not a closer. Engine: no mark on any of these.
  ['x =\\= y', ''],
  ['x =<\\= y', ''],
  ['x =!\\= y', ''],
  ['x =a\\= y', ''],
  ['x =\\=< y', ''],
  ['x =\\=> y', ''],
  ['x =\\=! y', ''],
  ['x =\\=  y', ''],
  ['x =\\=\\ y', ''],
  ['x  =\\= y', ''],

  // ... and the body has to step over it to reach the real closer past it.
  ['a =b c\\= d= e', 'b c\\= d'],
  // An escaped `=` is literal, so the engine opens at the first `=` and closes
  // on the third, rendering the mark `=`. Without the widened body the run
  // cannot hold the escaped one and the whole shape goes uncoloured.
  ['x =\\== y', '\\='],
  // An EVEN run escapes the backslash, not the `=`: the closer stands, and a
  // LONGER run is decided the same way with no bound on how long it may be.
  ['x =\\\\= y', '\\\\'],
  ['x =\\\\\\\\= y', '\\\\\\\\'],
  ['x =\\\\\\= y', ''],
  ['a =b c\\\\\\= d= e', 'b c\\\\\\= d'],

  // An escape is a PAIR whatever it escapes: a backslash before an ordinary
  // character is ordinary content, and one before a SPACE leaves the `=` after
  // it preceded by whitespace, so it opens nothing.
  ['x =a\\bc= y', 'a\\bc'],
  ['x =\\ = y', ''],
  ['x =\\=\\= y', ''],

  // An escaped `=` OPENS nothing either, and needs no guard of its own: the
  // escape rule takes it before `#emphasis` is reached, and the engine renders
  // `x =a= y` with no mark. An EVEN run in front of the opener leaves an
  // ordinary one, which the engine does mark - so the opener must not simply
  // refuse a backslash behind it.
  ['x \\=a= y', ''],
  ['a \\=b c= d', ''],
  ['x \\\\=a= y', 'a'],

  // A `=` that begins an arrow opens nothing. Engine: no mark on any of these.
  ['x =>= y', ''],
  ['x =>=< y', ''],
  ['x =>=> y', ''],
  ['x =>=! y', ''],
  ['x =>=  y', ''],
  ['x =>=\\ y', ''],
  ['x =><= y', ''],
  ['x =>>= y', ''],
  ['x =>!= y', ''],
  ['x =>a= y', ''],
  ['x =>\\= y', ''],

  // The controls. An ordinary highlight still colours, a closer still beats
  // smart typography once the highlight is open, and a comparison in front of
  // an opener is still resolved by position rather than by a lookbehind.
  ['x =b= y', 'b'],
  ['x =y z<= w', 'y z<'],
  ['x =y z=> w', 'y z'],
  ['a \\!=b c= d', 'b c'],
  ['a <=b c= d', ''],
  ['a !=b c= d', ''],
]

for (const [src, expected] of ROWS) {
  const label = expected === '' ? 'colours nothing' : `colours ${JSON.stringify(expected)}`
  test(`${JSON.stringify(src)} ${label}`, () => {
    assert.equal(markedRun(src), expected)
  })
}
