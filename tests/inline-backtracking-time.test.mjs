/**
 * Long lines of unclosed inline openers stay cheap to tokenize.
 *
 * `{*a {/b ` repeated 250 times took 38 seconds on one line before the braced
 * and bare openers checked for a closer ahead of their body scan, and
 * Oniguruma cannot be interrupted, so VS Code froze for that long. The work
 * runs in a child with a deadline: a regression fails here instead of hanging
 * the suite. The budgets are generous, a fix measured at tens of milliseconds
 * against seconds before. Bold is left out of the styling check: a bare `*`
 * opens the one multi-line inline region, which runs to the blank line.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const script = `
import { readFileSync } from 'node:fs'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'
await oniguruma.loadWASM(readFileSync('node_modules/vscode-oniguruma/release/onig.wasm').buffer)
const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (str) => new oniguruma.OnigString(str),
  }),
  loadGrammar: async () => vsctm.parseRawGrammar(readFileSync('syntaxes/carve.tmLanguage.json', 'utf8'), 'carve.tmLanguage.json'),
})
const grammar = await registry.loadGrammar('text.carve')
grammar.tokenizeLine('warm *a* {/b/} =c= {^d^}', vsctm.INITIAL)
const cases = JSON.parse(process.argv[1])
const out = {}
for (const [name, line] of cases) {
  const start = performance.now()
  const { tokens } = grammar.tokenizeLine(line, vsctm.INITIAL)
  out[name] = { ms: performance.now() - start, styled: tokens.some((t) => t.scopes.some((s) => /italic|underline|strikethrough|highlight|superscript|subscript|inserted|deleted/.test(s))) }
}
process.stdout.write(JSON.stringify(out))
`

const nested = ['{*a {/b ', '{/a {*b ', '{_a {*b ', '{=a {*b ', '{*a {~b ', '{+a {*b ', '{^a {/b ']
  .map((unit) => [`nested ${unit.trim()}`, unit.repeat(250)])
const long = ['=a ', '/a ', '~a ', '_a ', '{^a ', '{,a ', '/*a ']
  .map((unit) => [`long ${unit.trim()}`, unit.repeat(Math.ceil(9000 / unit.length))])
// The only closers on the line sit behind an escape or inside a code span, so
// the pre-check has to step over both or every opener rescans the line.
const hidden = [' `x/}`', ' x\\/}', ' x\\*}', ' x\\*} x\\/}', ' `x*}` `y/}`']
  .map((tail) => [`hidden closer${tail}`, '{*a {/b '.repeat(250).trim() + tail])

function run(cases, budgetMs) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(cases)], {
    cwd: root,
    timeout: 120000,
    encoding: 'utf8',
  })
  assert.equal(result.error, undefined, 'tokenizing ran past the two-minute deadline')
  assert.equal(result.status, 0, result.stderr)
  const measured = JSON.parse(result.stdout)
  for (const [name] of cases) {
    assert.ok(measured[name].ms < budgetMs, `${name}: ${Math.round(measured[name].ms)} ms, budget ${budgetMs} ms`)
    assert.equal(measured[name].styled, false, `${name}: an unclosed opener was styled`)
  }
}

test('alternating unclosed braced openers tokenize in linear-ish time', () => {
  run(nested, 3000)
})

test('long lines of unclosed bare and braced openers tokenize quickly', () => {
  run(long, 3000)
})

test('a closer behind an escape or inside code does not make the run slow', () => {
  run(hidden, 3000)
})

test('a closed span after the unclosed run is still styled', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script,
    JSON.stringify([['closed', '{/a {_b '.repeat(50) + '{/x/} _y_']])], { cwd: root, timeout: 120000, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).closed.styled, true)
})
