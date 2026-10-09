import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'
import { LANGUAGES } from '../tools/generate-fence-languages.mjs'

const { INITIAL, Registry, parseRawGrammar } = vsctm
const { OnigScanner, OnigString, loadWASM } = oniguruma
const require = createRequire(import.meta.url)

const grammarText = readFileSync(new URL('../syntaxes/carve.tmLanguage.json', import.meta.url), 'utf8')
const grammar = JSON.parse(grammarText)
const generator = new URL('../tools/generate-fence-languages.mjs', import.meta.url).pathname

test('generated fence language rules and embeddedLanguages are in sync', () => {
  const run = spawnSync(process.execPath, [generator, '--check'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})

test('every fence rule variant tries the language rules before the generic one', () => {
  const heads = [
    ['code-blocks', 0, 'fenced-code-languages'],
    ['code-block-behind-a-container-prefix', 0, 'fenced-code-languages-on-a-marker-line'],
    ['code-block-behind-a-container-prefix', 2, 'fenced-code-languages-at-a-body-column'],
  ]
  for (const [entry, index, generated] of heads) {
    assert.equal(grammar.repository[entry].patterns[index].include, `#${generated}`)
    assert.equal(grammar.repository[generated].patterns.length, LANGUAGES.length)
  }
})

// Stub grammars stand in for the embedded languages; the body scope is what matters.
const stubs = ['source.cpp', 'source.fsharp', 'source.clojure', 'text.tex.latex']

async function bodyScopes(opener) {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer
  const registry = new Registry({
    onigLib: loadWASM(wasm).then(() => ({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (value) => new OnigString(value),
    })),
    loadGrammar: async (scopeName) => {
      if (scopeName === 'text.carve') return parseRawGrammar(grammarText, 'carve.tmLanguage.json')
      if (stubs.includes(scopeName)) return parseRawGrammar(JSON.stringify({ scopeName, patterns: [] }), `${scopeName}.json`)
      return null
    },
  })
  const carve = await registry.loadGrammar('text.carve')
  let stack = INITIAL
  const lines = [opener, 'body', '```']
  const scopes = lines.map((line) => {
    const { tokens, ruleStack } = carve.tokenizeLine(line, stack)
    stack = ruleStack
    return tokens.flatMap((token) => token.scopes)
  })
  return scopes[1]
}

test('a fence word with a regex special character opens its language', async (t) => {
  for (const [opener, language] of [
    ['```c++', 'cpp'],
    ['```C++ "main.cpp"', 'cpp'],
    ['```f#', 'fsharp'],
    ['```clojure', 'clojure'],
    ['```latex', 'latex'],
  ]) {
    await t.test(opener, async () => {
      assert.ok((await bodyScopes(opener)).includes(`meta.embedded.block.${language}`))
    })
  }
})

test('a fence word is matched literally, not as a pattern', async () => {
  // Unescaped, `c++` would be a possessive `c+` and match `ccc`.
  assert.ok(!(await bodyScopes('```ccc')).some((scope) => scope.startsWith('meta.embedded.block.')))
})
