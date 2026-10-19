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

test('CSV and TSV grammars are contributed without claiming file languages', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const name of ['csv', 'tsv']) {
    const contribution = manifest.contributes.grammars.find(({ scopeName }) => scopeName === `text.${name}.carve`)
    assert.deepEqual(contribution, {
      scopeName: `text.${name}.carve`,
      path: `./syntaxes/${name}.tmLanguage.json`,
    })
    assert.equal(manifest.contributes.grammars[0].embeddedLanguages[`meta.embedded.block.${name}`], name)
  }
})

test('real CSV and TSV grammars tokenize delimited table fences', async () => {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer
  const files = { 'text.carve': 'carve', 'text.csv.carve': 'csv', 'text.tsv.carve': 'tsv' }
  const registry = new Registry({
    onigLib: loadWASM(wasm).then(() => ({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (value) => new OnigString(value),
    })),
    loadGrammar: async (scopeName) => {
      const name = files[scopeName]
      if (!name) return null
      return parseRawGrammar(readFileSync(new URL(`../syntaxes/${name}.tmLanguage.json`, import.meta.url), 'utf8'), `${name}.tmLanguage.json`)
    },
  })
  const carve = await registry.loadGrammar('text.carve')
  const lines = [
    '{table}', '```csv', 'Plan,Seats,Price per month', 'Starter,1,"$0"',
    'Team,10,"$49, billed yearly"', 'Note,"line one', 'line two"',
    'Quote,"say ""hi"""', '```', '```tsv', 'Plan\tSeats', 'Team\t"a\tb"', '```',
  ]
  let stack = INITIAL
  const actual = []
  for (const [index, line] of lines.entries()) {
    const result = carve.tokenizeLine(line, stack)
    stack = result.ruleStack
    for (const token of result.tokens) {
      const scopes = token.scopes.filter((scope) => /\.(csv|tsv)$/.test(scope)).join(' ')
      actual.push(`${index + 1} ${JSON.stringify(line.slice(token.startIndex, token.endIndex))} ${scopes}`.trimEnd())
    }
  }
  assert.deepEqual(actual, GOLDEN)
})

// One token per entry: line, text, and its csv/tsv scopes.
const GOLDEN = [
  '1 "{table}"',
  '2 "```"',
  '2 "csv"',
  '3 "Plan" meta.embedded.block.csv string.unquoted.csv markup.heading.csv',
  '3 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '3 "Seats" meta.embedded.block.csv string.unquoted.csv markup.heading.csv',
  '3 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '3 "Price per month" meta.embedded.block.csv string.unquoted.csv markup.heading.csv',
  '4 "Starter" meta.embedded.block.csv string.unquoted.csv',
  '4 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '4 "1" meta.embedded.block.csv string.unquoted.csv',
  '4 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '4 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.begin.csv',
  '4 "$0" meta.embedded.block.csv string.quoted.double.csv',
  '4 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.end.csv',
  '5 "Team" meta.embedded.block.csv string.unquoted.csv',
  '5 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '5 "10" meta.embedded.block.csv string.unquoted.csv',
  '5 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '5 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.begin.csv',
  '5 "$49, billed yearly" meta.embedded.block.csv string.quoted.double.csv',
  '5 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.end.csv',
  '6 "Note" meta.embedded.block.csv string.unquoted.csv',
  '6 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '6 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.begin.csv',
  '6 "line one" meta.embedded.block.csv string.quoted.double.csv',
  '7 "line two" meta.embedded.block.csv string.quoted.double.csv',
  '7 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.end.csv',
  '8 "Quote" meta.embedded.block.csv string.unquoted.csv',
  '8 "," meta.embedded.block.csv punctuation.separator.delimiter.csv',
  '8 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.begin.csv',
  '8 "say " meta.embedded.block.csv string.quoted.double.csv',
  '8 "\\"\\"" meta.embedded.block.csv string.quoted.double.csv constant.character.escape.csv',
  '8 "hi" meta.embedded.block.csv string.quoted.double.csv',
  '8 "\\"\\"" meta.embedded.block.csv string.quoted.double.csv constant.character.escape.csv',
  '8 "\\"" meta.embedded.block.csv string.quoted.double.csv punctuation.definition.string.end.csv',
  '9 "```"',
  '10 "```"',
  '10 "tsv"',
  '11 "Plan" meta.embedded.block.tsv string.unquoted.tsv markup.heading.tsv',
  '11 "\\t" meta.embedded.block.tsv punctuation.separator.delimiter.tsv',
  '11 "Seats" meta.embedded.block.tsv string.unquoted.tsv markup.heading.tsv',
  '12 "Team" meta.embedded.block.tsv string.unquoted.tsv',
  '12 "\\t" meta.embedded.block.tsv punctuation.separator.delimiter.tsv',
  '12 "\\"" meta.embedded.block.tsv string.quoted.double.tsv punctuation.definition.string.begin.tsv',
  '12 "a\\tb" meta.embedded.block.tsv string.quoted.double.tsv',
  '12 "\\"" meta.embedded.block.tsv string.quoted.double.tsv punctuation.definition.string.end.tsv',
  '13 "```"',
]
