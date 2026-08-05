/**
 * The term alphabet, which this grammar inherited wrong from its source.
 *
 * `abbreviation_term = (letter | digit)+`, and the grammar enumerates `letter`
 * as `a`..`z` plus `A`..`Z`. This copy - like the carve-grammars TextMate
 * grammar it was ported from - required the whole term to be uppercase, so
 * `*[dl]: definition list` and `*[9]: nine` were shown as ordinary paragraph
 * text while every engine treats them as definitions.
 *
 * The engines each had their own version of the same misreading: carve-js
 * required uppercase (markup-carve/carve-js#720), carve-php crashed on a
 * digit-only term (markup-carve/carve-php#880), and carve-rs accepted any
 * Unicode alphanumeric (markup-carve/carve-rs#660). carve-grammars#131 fixes
 * the source grammar; this is the port.
 *
 * The fixtures could not catch it. Every abbreviation sample in the corpus uses
 * an uppercase multi-letter term - HTML, CSS, A - which is the one shape all
 * the readings agree on. The rows below are chosen for the opposite reason.
 *
 * A wrongly-claimed definition is worse than a wrongly-colored one here: an
 * abbreviation has no marker at the use site, so the reader is being told the
 * line will vanish from the rendered document, and it will not.
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

// Each row separates at least two of the readings that shipped.
const TERMS = [
  { term: 'HTML', defines: true, why: 'the shape every reading already agreed on' },
  { term: 'dl', defines: true, why: 'lowercase' },
  { term: 'Wm', defines: true, why: 'mixed case' },
  { term: '3D', defines: true, why: 'digit-leading' },
  { term: '9', defines: true, why: 'a digit alone is a term' },
  { term: 'e.g.', defines: false, why: 'a dot is neither a letter nor a digit' },
  { term: 'HTTP API', defines: false, why: 'a space is neither a letter nor a digit' },
  { term: 'ss', defines: true, why: 'the ASCII spelling of the row below' },
  { term: 'ß', defines: false, why: 'letter is enumerated ASCII' },
]

function defines(term) {
  const result = grammar.tokenizeLine(`*[${term}]: expansion here`, vsctm.INITIAL)
  return result.tokens
    .flatMap((t) => t.scopes)
    .some((s) => s.includes('entity.name.abbreviation'))
}

test('the term alphabet is (letter | digit)+, and letter is ASCII', () => {
  const failures = []
  for (const { term, defines: want, why } of TERMS) {
    const got = defines(term)
    if (got !== want) {
      failures.push(
        `  *[${term}]: is ${got ? 'a definition' : 'plain text'}, ` +
          `expected ${want ? 'a definition' : 'plain text'}   (${why})`,
      )
    }
  }
  assert.equal(failures.length, 0, `\n${failures.join('\n')}\n`)
})

test('the probe answers both ways', () => {
  // A probe that can only ever say "no" passes every rejecting row above and
  // reports a green grammar it never read.
  assert.ok(defines('HTML'), 'the probe never finds a definition at all')
  assert.ok(!defines('!!'), 'the probe calls anything a definition')
})
