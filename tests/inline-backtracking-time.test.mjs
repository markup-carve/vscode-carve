/**
 * Long lines of unclosed inline openers stay cheap to tokenize.
 *
 * `{*a {/b ` repeated 250 times took 38 seconds on one line before the braced
 * and bare openers checked for a closer ahead of their body scan, and
 * Oniguruma cannot be interrupted, so VS Code froze for that long. The work
 * runs in a child with a deadline: a regression fails here instead of hanging
 * the suite. Each case is timed against a prose line of the same length in the
 * same child, so machine load scales both: the freeze was about 29,000x prose,
 * today's slowest case is about 350x, and the limit is 1000x. Bold is left out
 * of the styling check: a bare `*` opens the one multi-line inline region,
 * which runs to the blank line.
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
const grammar = await registry.loadGrammar('source.carve')
grammar.tokenizeLine('warm *a* {/b/} =c= {^d^}', vsctm.INITIAL)
const cases = JSON.parse(process.argv[1])
// The fastest of three runs: load only ever adds time.
const time = (line) => {
  let best = Infinity
  let tokens
  for (let run = 0; run < 3; run++) {
    const start = performance.now()
    tokens = grammar.tokenizeLine(line, vsctm.INITIAL).tokens
    best = Math.min(best, performance.now() - start)
  }
  return { ms: best, tokens }
}
const out = {}
for (const [name, line] of cases) {
  const { ms, tokens } = time(line)
  const prose = 'a b, c. d e f '.repeat(Math.ceil(line.length / 14)).slice(0, line.length)
  out[name] = { ms, proseMs: time(prose).ms, styled: tokens.some((t) => t.scopes.some((s) => /italic|underline|strikethrough|highlight|superscript|subscript|inserted|deleted/.test(s))) }
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

// Times prose of the same length, as measured in the same child.
const PROSE_LIMIT = 1000
// Below this a prose run is timer noise, so it counts as this long.
const PROSE_FLOOR_MS = 0.5

function run(cases) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(cases)], {
    cwd: root,
    timeout: 120000,
    encoding: 'utf8',
  })
  assert.equal(result.error, undefined, 'tokenizing ran past the two-minute deadline')
  assert.equal(result.status, 0, result.stderr)
  const measured = JSON.parse(result.stdout)
  for (const [name] of cases) {
    const { ms, proseMs } = measured[name]
    const ratio = ms / Math.max(proseMs, PROSE_FLOOR_MS)
    assert.ok(ratio < PROSE_LIMIT, `${name}: ${Math.round(ms)} ms, ${Math.round(ratio)}x prose of the same length (${proseMs.toFixed(2)} ms), limit ${PROSE_LIMIT}x`)
    assert.equal(measured[name].styled, false, `${name}: an unclosed opener was styled`)
  }
}

test('alternating unclosed braced openers tokenize in linear-ish time', () => {
  run(nested)
})

test('long lines of unclosed bare and braced openers tokenize quickly', () => {
  run(long)
})

test('a closer behind an escape or inside code does not make the run slow', () => {
  run(hidden)
})

test('a closed span after the unclosed run is still styled', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script,
    JSON.stringify([['closed', '{/a {_b '.repeat(50) + '{/x/} _y_']])], { cwd: root, timeout: 120000, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).closed.styled, true)
})
