import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const { INITIAL, Registry, parseRawGrammar } = vsctm
const { OnigScanner, OnigString, loadWASM } = oniguruma
const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))

// VS Code's unknown-language fence rule. The injection competes with it just
// as it does in the complete built-in Markdown grammar.
const markdownGrammar = {
  scopeName: 'text.html.markdown',
  patterns: [{ include: '#fence' }],
  repository: {
    fence: {
      begin: '(^|\\G)(\\s*)(`{3,}|~{3,})\\s*(?=([^`]*)?$)',
      beginCaptures: {
        3: { name: 'punctuation.definition.markdown' },
        4: { name: 'fenced_code.block.language' },
      },
      end: '(^|\\G)(\\2|\\s{0,3})(\\3)\\s*$',
      endCaptures: { 3: { name: 'punctuation.definition.markdown' } },
      name: 'markup.fenced_code.block.markdown',
    },
  },
}

async function grammar() {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer
  const files = new Map([
    ['text.html.markdown', JSON.stringify(markdownGrammar)],
    ['text.carve', readFileSync(join(root, 'syntaxes/carve.tmLanguage.json'), 'utf8')],
    ['markdown.carve.codeblock', readFileSync(join(root, 'syntaxes/carve-markdown-injection.tmLanguage.json'), 'utf8')],
  ])
  const registry = new Registry({
    onigLib: loadWASM(wasm).then(() => ({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (value) => new OnigString(value),
    })),
    loadGrammar: async (scopeName) => {
      const source = files.get(scopeName)
      return source ? parseRawGrammar(source, `${scopeName}.json`) : null
    },
    getInjections: (scopeName) =>
      scopeName === 'text.html.markdown' ? ['markdown.carve.codeblock'] : undefined,
  })
  return registry.loadGrammar('text.html.markdown')
}

async function tokenize(lines) {
  const markdown = await grammar()
  assert.ok(markdown)
  let stack = INITIAL
  return lines.map((line) => {
    const result = markdown.tokenizeLine(line, stack)
    stack = result.ruleStack
    return result.tokens.flatMap((token) => token.scopes)
  })
}

const has = (scopes, scope) => scopes.includes(scope)

for (const [opener, closer] of [
  ['```carve', '```'],
  ['```crv', '```'],
  ['``` carve', '```'],
  ['```carve{.example}', '```'],
  ['```carve title="a~b"', '```'],
  ['~~~CARVE', '~~~'],
]) {
  test(`Markdown fence ${opener} embeds the Carve grammar`, async () => {
    const scopes = await tokenize([opener, '*bold* and /italic/', closer, '*after*'])
    assert.ok(has(scopes[1], 'meta.embedded.block.carve'))
    assert.ok(has(scopes[1], 'markup.bold.carve'))
    assert.ok(has(scopes[1], 'markup.italic.carve'))
    assert.equal(has(scopes[3], 'meta.embedded.block.carve'), false)
  })
}

test('an inner shorter fence does not end the outer Carve fence', async () => {
  const scopes = await tokenize(['````carve', '*before*', '```js', 'code', '```', '*after*', '````'])
  assert.ok(has(scopes[1], 'markup.bold.carve'))
  assert.ok(has(scopes[5], 'markup.bold.carve'))
})

test('a different fence character does not end the Carve fence', async () => {
  const scopes = await tokenize(['```carve', '*before*', '~~~', '*after*', '```'])
  assert.ok(has(scopes[1], 'markup.bold.carve'))
  assert.ok(has(scopes[3], 'meta.embedded.block.carve'))
})

test('a complete Carve fence inside another language does not activate the injection', async () => {
  const scopes = await tokenize(['```text', '~~~carve', '*not Carve*', '```', '*after*'])
  assert.equal(has(scopes[2], 'meta.embedded.block.carve'), false)
  assert.equal(has(scopes[4], 'meta.embedded.block.carve'), false)
})

test('an unclosed Carve construct cannot consume text after the Markdown closer', async () => {
  const scopes = await tokenize(['```carve', '%%%', 'note', '```', '# after'])
  assert.ok(has(scopes[2], 'meta.embedded.block.carve'))
  assert.equal(has(scopes[4], 'meta.embedded.block.carve'), false)
})

test('the manifest contributes the alias and Markdown injection', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const carve = manifest.contributes.languages.find((language) => language.id === 'carve')
  assert.ok(carve.aliases.includes('carve'))
  assert.ok(carve.aliases.includes('crv'))
  const injection = manifest.contributes.grammars.find(
    (item) => item.scopeName === 'markdown.carve.codeblock',
  )
  assert.deepEqual(injection.injectTo, ['text.html.markdown'])
  assert.equal(injection.embeddedLanguages['meta.embedded.block.carve'], 'carve')
})
