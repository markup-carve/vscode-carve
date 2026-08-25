/**
 * A COLON FENCE'S MARKER SEPARATOR IS A RUN OF SPACES.
 *
 * The div rule used `\s*` at every slot - before the type token, before a
 * quoted title, before a `[label]` - so it opened a container for input the
 * engines read as an ordinary paragraph. Measured against carve-js `8432165e`,
 * with carve-php and carve-rs agreeing byte for byte:
 *
 *     :::note
 *     x
 *     :::
 *
 * renders `<p>:::note\nx\n:::</p>`, and so do the tab-separated and glued forms
 * of every other token. Corpus 254 and 255 exist to pin exactly this rule. A
 * tab belongs at the START of a line and nowhere else on one.
 *
 * The one slot that takes NO separator is the bare `[label]`: `:::[l]` does
 * open a div, so that branch alone is zero-or-more.
 *
 * `::: >` is in the table because it is why the file exists - the fenced block
 * quote (markup-carve/carve#1718) reaches the div rule like `::: |` does, and
 * its separator is the same run.
 *
 * WHY THESE ARE ASSERTIONS AND NOT SNAPSHOTS, as the two marker-line files
 * beside this one already argue: a snapshot is self-consistency with a golden
 * this repository generated from this grammar, so green means the grammar did
 * not CHANGE, never that it is right. The `:::<TAB>figure` line in
 * `tests/fixtures/composite-figures.crv` had a snapshot, and it was committed
 * pinning the opener reading.
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

/**
 * Whether the OPENER line of `src` is scoped as a container opener.
 *
 * The first fence token, not any: a bare closing `:::` is a legitimate opener
 * shape too, so asking about any fence token answers yes for a document whose
 * opener matched nothing at all.
 *
 * @param {string} src - the Carve document.
 * @returns {boolean} whether the first `:::` run carries the div punctuation scope.
 */
function opensAContainer(src) {
  let state = vsctm.INITIAL
  for (const line of src.split('\n')) {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    for (const token of result.tokens) {
      const text = line.substring(token.startIndex, token.endIndex)
      if (!text.includes(':::')) continue

      // Either container punctuation: a bare `::: figure` is claimed by the
      // composite-figure rule ahead of the div rule and carries its own scope.
      return token.scopes.some(
        (scope) =>
          scope.includes('punctuation.definition.div') ||
          scope.includes('punctuation.definition.figure'),
      )
    }
  }

  return false
}

/** `[opener line, whether the engines open a container for it]`. */
const OPENERS = [
  ['::: >', true],
  [':::  >', true],
  [':::>', false],
  [':::\t>', false],
  [':::\t >', false],
  ['::: \t>', false],
  ['::: |', true],
  [':::|', false],
  [':::\t|', false],
  ['::: note', true],
  [':::note', false],
  [':::\tnote', false],
  ['::: figure', true],
  [':::\tfigure', false],
  ['::: [l]', true],
  [':::[l]', true],
  [':::\t[l]', false],
  ['::: note "T"', true],
  ['::: note\t"T"', false],
  ['::: note "T" [l]', true],
  ['::: note "T"\t[l]', false],
]

for (const [opener, opens] of OPENERS) {
  test(`${JSON.stringify(opener)} ${opens ? 'opens a container' : 'stays paragraph text'}`, () => {
    assert.equal(opensAContainer(`${opener}\nx\n:::\n`), opens)
  })
}

test('this file is in the grammar test command', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  assert.ok(
    pkg.scripts['test:grammar'].includes('tests/colon-fence-separator.test.mjs'),
    'package.json "test:grammar" does not run this file, so it proves nothing in CI',
  )
})
