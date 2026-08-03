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
