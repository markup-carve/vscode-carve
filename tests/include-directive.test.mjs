/**
 * THE RESERVED INCLUDE DIRECTIVE IS NOT A BAG OF TAGS AND MENTIONS.
 *
 * Spec PART 9 section 19 (markup-carve/carve#291) reserves `{{ path #section
 * @key:value }}` at the language level: the core leaves the directive literal
 * and a processor expands it only when a host supplies a resolver. A grammar
 * that does not know the shape does not leave it alone, because the selector is
 * spelled with constructs the grammar already claims:
 *
 *     See {{ chapters/intro.crv #intro }} here.
 *
 * scoped `#intro` as a hashtag (`constant.other.symbol.tag.carve`) and an
 * `@key` option as a mention, so the editor said the line held a tag where it
 * holds a reference into another file. The rule ported from
 * markup-carve/carve-grammars#403 scopes the directive BY PART, and the
 * enclosing match is what keeps the tag and mention rules off the payload.
 *
 * WHY ASSERTIONS AND NOT ONLY A SNAPSHOT, as the sibling grammar tests argue: a
 * snapshot is self-consistency with a golden this repository generated from
 * this grammar, so green means the grammar did not CHANGE, never that it is
 * right. `tests/fixtures/include-directive.crv` pins the whole shape as a
 * snapshot; this file pins the two facts the ticket is about - the directive
 * carries `meta.directive.include.carve`, and its selector carries no tag or
 * mention scope.
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
 * Every token of `src`, flattened across lines, with its text and scopes.
 *
 * @param {string} src - the Carve document.
 * @returns {Array<{ text: string, scopes: string[] }>} the tokens in order.
 */
function tokensOf(src) {
  const out = []
  let state = vsctm.INITIAL
  for (const line of src.split('\n')) {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    for (const token of result.tokens) {
      out.push({ text: line.substring(token.startIndex, token.endIndex), scopes: token.scopes })
    }
  }
  return out
}

/**
 * The union of the scopes carried by every token whose text is exactly `text`.
 *
 * Exact text, not a substring: asking about a substring answers about whichever
 * larger run happens to contain it, which is how a selector swallowed into an
 * unscoped run would read as "not a tag" while nothing scoped it at all.
 *
 * @param {string} src - the Carve document.
 * @param {string} text - the token text to look up.
 * @returns {Set<string>} the scopes on those tokens.
 */
function scopesOn(src, text) {
  const found = new Set()
  for (const token of tokensOf(src)) {
    if (token.text !== text) continue
    for (const scope of token.scopes) found.add(scope)
  }
  return found
}

/** Whether ANY token of `src` carries a scope containing `needle`. */
function anyScope(src, needle) {
  return tokensOf(src).some((token) => token.scopes.some((scope) => scope.includes(needle)))
}

const LINE = 'See {{ chapters/intro.crv #intro }} here.'

test('the directive is a directive', () => {
  assert.ok(
    scopesOn(LINE, '{{').has('meta.directive.include.carve'),
    'the opener does not carry meta.directive.include.carve',
  )
  assert.ok(
    scopesOn(LINE, '}}').has('meta.directive.include.carve'),
    'the closer does not carry meta.directive.include.carve',
  )
  assert.ok(
    scopesOn(LINE, 'chapters/intro.crv').has('string.other.link.include.carve'),
    'the path is not scoped as the include path',
  )
})

test('the section selector is a section, not a hashtag', () => {
  const scopes = scopesOn(LINE, '#intro')
  assert.ok(
    scopes.has('entity.name.section.include.carve'),
    `#intro is not scoped as a section: ${[...scopes].join(' ')}`,
  )
  for (const wrong of [
    'constant.other.symbol.tag.carve',
    'variable.other.tag.carve',
    'punctuation.definition.tag.carve',
  ]) {
    assert.ok(!scopes.has(wrong), `#intro still carries ${wrong}`)
  }
  // The old reading split the selector into `#` and `intro`, so the whole-token
  // lookup above cannot see it. Nothing on the line may carry a tag scope.
  assert.ok(!anyScope(LINE, '.tag.carve'), 'a tag scope survives somewhere on the line')
})

test('an option slot is an option, not a mention', () => {
  const src = 'See {{ chapters/intro.crv @lang:de }} here.'
  assert.ok(
    scopesOn(src, '@lang').has('variable.parameter.include.carve'),
    'the option key is not scoped as an include parameter',
  )
  assert.ok(
    scopesOn(src, 'de').has('constant.other.include.carve'),
    'the option value is not scoped as an include constant',
  )
  assert.ok(!anyScope(src, '.mention.carve'), 'a mention scope survives on an option slot')
})

test('a quoted path is the path, not a pair of smart quotes', () => {
  const src = '{{ "chapters/an intro.crv" #intro }}'
  assert.ok(
    scopesOn(src, '"chapters/an intro.crv"').has('string.other.link.include.carve'),
    'the quoted path is not one include-path token',
  )
  assert.ok(!anyScope(src, 'smartquote'), 'the quotes around the path still read as smart quotes')
})

test('a directive inside a code span stays code', () => {
  const src = 'a `{{ x.crv #y }}` b'
  assert.ok(!anyScope(src, 'meta.directive.include.carve'), 'the code span was read as a directive')
  assert.ok(anyScope(src, 'markup.raw.inline'), 'the code span stopped being a code span')
})

test('a directive in a table cell scopes too', () => {
  const src = '| {{ chapters/intro.crv #intro }} | b |\n'
  assert.ok(
    scopesOn(src, '#intro').has('entity.name.section.include.carve'),
    'the selector in a table cell is not a section',
  )
  assert.ok(!anyScope(src, '.tag.carve'), 'a tag scope survives in a table cell')
})

test('a directive in a container body scopes too', () => {
  const src = '::: note\nSee {{ chapters/intro.crv #intro }} here.\n:::\n'
  assert.ok(
    scopesOn(src, '#intro').has('entity.name.section.include.carve'),
    'the selector inside a container is not a section',
  )
  assert.ok(!anyScope(src, '.tag.carve'), 'a tag scope survives inside a container')
})

test('a directive in a footnote body scopes too', () => {
  const src = '[^a]: see {{ chapters/intro.crv #intro }}\n'
  assert.ok(
    scopesOn(src, '#intro').has('entity.name.section.include.carve'),
    'the selector inside a footnote body is not a section',
  )
  assert.ok(!anyScope(src, '.tag.carve'), 'a tag scope survives inside a footnote body')
})

// The EBNF requires a `space` on each side of the payload, so the glued form is
// not the production. The processor leaves a malformed directive as text and so
// does the grammar - the point of the assertion is that the rule did not widen
// into every brace pair, not that `#intro` colours as anything in particular.
test('the padding is required', () => {
  const src = 'See {{chapters/intro.crv #intro}} here.'
  assert.ok(
    !anyScope(src, 'meta.directive.include.carve'),
    'an unpadded brace pair was read as a directive',
  )
})

test('this file is in the grammar test command', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  assert.ok(
    pkg.scripts['test:grammar'].includes('tests/include-directive.test.mjs'),
    'package.json "test:grammar" does not run this file, so it proves nothing in CI',
  )
})
