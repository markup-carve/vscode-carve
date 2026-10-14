/**
 * Readings from the grammar audit, each checked against the bundled engine
 * first and the grammar second, so a test cannot pin a reading the engine
 * does not share.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'
import { carveToHtml } from '@markup-carve/carve'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wasm = readFileSync(resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm'))
await oniguruma.loadWASM(wasm.buffer)

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (source) => new oniguruma.OnigString(source),
  }),
  loadGrammar: async (scope) => scope === 'text.carve'
    ? vsctm.parseRawGrammar(readFileSync(resolve(root, 'syntaxes/carve.tmLanguage.json'), 'utf8'), 'carve.tmLanguage.json')
    : null,
})
const grammar = await registry.loadGrammar('text.carve')

function tokenize(source) {
  let stack = vsctm.INITIAL
  const out = []
  source.split('\n').forEach((line, row) => {
    const result = grammar.tokenizeLine(line, stack)
    stack = result.ruleStack
    for (const t of result.tokens) out.push({ row, line, text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes })
  })
  return out
}

const report = (tokens) => tokens.map((t) => `${t.row}: ${JSON.stringify(t.text)} ${t.scopes.slice(1).join(' ')}`).join('\n')
const has = (t, scope) => t.scopes.some((s) => s === scope || s.startsWith(scope + '.'))
/** The tokens on line `row` whose text is exactly `text`. */
const at = (tokens, row, text) => tokens.filter((t) => t.row === row && t.text === text)
const scoped = (tokens, row, text, scope) => {
  const hits = at(tokens, row, text)
  return hits.length > 0 && hits.every((t) => has(t, scope))
}

test('a quoted paragraph scopes its inline markup', () => {
  const source = '> *bold* and [l](u) and `c`\n'
  assert.match(carveToHtml(source), /<blockquote><p><strong>bold<\/strong> and <a href="u">l<\/a>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 0, 'bold', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 0, 'l', 'string.other.link.title'), report(tokens))
})

test('a lazy line and a nested quote scope their inline markup', () => {
  const source = '> a\nlazy *b*\n\n> > nested *x*\n\n- > on a marker *y*\n'
  const html = carveToHtml(source)
  assert.match(html, /a\nlazy <strong>b<\/strong>/)
  assert.match(html, /<blockquote>\s*<blockquote><p>nested <strong>x<\/strong>/)
  assert.match(html, /<li>\s*<blockquote><p>on a marker <strong>y<\/strong>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 1, 'b', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 3, 'x', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 5, 'y', 'markup.bold'), report(tokens))
})

test('a list opened on a quote line scopes its marker and its text', () => {
  const source = '> 1. ordered *b*\n\n> - [x] task\n'
  const html = carveToHtml(source)
  assert.match(html, /<blockquote>\s*<ol>\s*<li>ordered <strong>b<\/strong>/)
  assert.match(html, /<blockquote>\s*<ul class="task-list">/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 0, '1.', 'punctuation.definition.list.begin'), report(tokens))
  assert.ok(scoped(tokens, 0, 'b', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 2, '-', 'punctuation.definition.list.begin'), report(tokens))
  assert.ok(scoped(tokens, 2, '[x] ', 'constant.language.task-list'), report(tokens))
})

test('a marker line under a quoted paragraph stays paragraph text', () => {
  const source = '> a\n> 1. b\n'
  assert.match(carveToHtml(source), /<blockquote><p>a\n1\. b<\/p><\/blockquote>/)
  const tokens = tokenize(source)
  assert.ok(!at(tokens, 1, '1.').some((t) => has(t, 'punctuation.definition.list.begin')), report(tokens))
})

test('a description list opened on a quote line is scoped', () => {
  const source = '> :: term *t*\n> : def\n'
  assert.match(carveToHtml(source), /<blockquote>\s*<dl>\s*<dt>term <strong>t<\/strong><\/dt>\s*<dd>def<\/dd>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 0, '::', 'markup.list.definition.term'), report(tokens))
  assert.ok(scoped(tokens, 0, 't', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 1, ':', 'markup.list.definition'), report(tokens))
})

test('a quoted star with no closer on its line stays text', () => {
  const source = '> *[HTML]: Hyper Text\n'
  assert.match(carveToHtml(source), /<p>\*\[HTML\]: Hyper Text<\/p>/)
  const tokens = tokenize(source)
  assert.ok(!tokens.some((t) => has(t, 'markup.bold') || has(t, 'punctuation.definition.bold')), report(tokens))
})

test('an unclosed front matter block ends at the first line no YAML mapping starts', () => {
  // The engine reads the whole unclosed block as prose. The grammar cannot see
  // the missing closer, so mapping-shaped lines before the break stay front
  // matter; everything from the first line that cannot be YAML is Carve again.
  const source = '---\ntitle: x\nSome prose with *bold*.\n\n## Heading\n'
  const html = carveToHtml(source)
  assert.match(html, /<hr>\s*<p>title: x\nSome prose with <strong>bold<\/strong>\.<\/p>/)
  const tokens = tokenize(source)
  for (const t of tokens.filter((x) => x.row >= 2)) {
    assert.ok(!has(t, 'meta.frontmatter'), report(tokens))
  }
  assert.ok(scoped(tokens, 2, 'bold', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 4, '##', 'punctuation.definition.heading'), report(tokens))
})

test('a closed front matter block holding a bare scalar stays front matter', () => {
  const tokens = tokenize('---\ntrue\n---\npara\n')
  assert.ok(tokens.filter((t) => t.row === 1).every((t) => has(t, 'meta.frontmatter')), report(tokens))
  assert.ok(tokens.filter((t) => t.row === 3).every((t) => !has(t, 'meta.frontmatter')), report(tokens))
})

test('a list marker under a footnote or description paragraph is paragraph text', () => {
  const source = 'x[^n]\n\n[^n]: Note text\n  - not a list\n\n:: term\n: body text\n  1. not a list\n'
  const html = carveToHtml(source)
  assert.match(html, /<dd>body text\n1\. not a list<\/dd>/)
  assert.match(html, /<p>Note text\n- not a list<a /)
  const tokens = tokenize(source)
  for (const row of [3, 7]) {
    assert.ok(!tokens.some((t) => t.row === row && has(t, 'punctuation.definition.list.begin')), report(tokens))
  }
})

test('a list marker under a list item paragraph still opens a sublist', () => {
  const source = '- item text\n  - nested\n'
  assert.match(carveToHtml(source), /<li>item text\s*<ul>\s*<li>nested<\/li>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 1, '-', 'punctuation.definition.list.begin'), report(tokens))
})

test('a list after a blank line in a footnote body is a list', () => {
  const source = 'x[^n]\n\n[^n]: Note text\n\n  - a list\n'
  assert.match(carveToHtml(source), /<ul>\s*<li>a list/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 4, '-', 'punctuation.definition.list.begin'), report(tokens))
})

test('a heading, a caption, link text and span text scope their inline markup', () => {
  const source = '# Head *b* [l](u)\n\n![img](a.png)\n^ Cap /i/\n\n[link *c*](u) and [span =m=]{.k}\n'
  const html = carveToHtml(source)
  assert.match(html, /<h1>Head <strong>b<\/strong> <a href="u">l<\/a><\/h1>/)
  assert.match(html, /<figcaption>Cap <em>i<\/em><\/figcaption>/)
  assert.match(html, /<a href="u">link <strong>c<\/strong><\/a> and <span class="k">span <mark>m<\/mark><\/span>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 0, 'b', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 0, 'l', 'string.other.link.title'), report(tokens))
  assert.ok(scoped(tokens, 3, 'i', 'markup.italic'), report(tokens))
  assert.ok(scoped(tokens, 5, 'c', 'markup.bold'), report(tokens))
  assert.ok(scoped(tokens, 5, 'm', 'markup.highlight'), report(tokens))
})

test('a trailing comment on a heading line stays a comment', () => {
  const tokens = tokenize('# Head *b* %% note\n')
  assert.ok(scoped(tokens, 0, 'b', 'markup.bold'), report(tokens))
  assert.ok(tokens.some((t) => t.text.includes('note') && has(t, 'comment')), report(tokens))
})

test('an unclosed fence inside a colon container closes at the container closer', () => {
  const source = '::: note\n```js\nlet x\n:::\n\nafter *b*\n'
  assert.match(carveToHtml(source), /<\/aside>\s*<p>after <strong>b<\/strong><\/p>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 3, ':::', 'punctuation.definition.div'), report(tokens))
  assert.ok(!tokens.some((t) => t.row >= 3 && has(t, 'markup.raw.block')), report(tokens))
  assert.ok(scoped(tokens, 5, 'b', 'markup.bold'), report(tokens))
})

test('a fence inside a longer container keeps a shorter colon line as code', () => {
  const source = '::::: compare\n```carve\n::: tip\nx\n:::\n```\n:::::\n'
  assert.match(carveToHtml(source), /<code class="language-carve">::: tip\nx\n:::\n<\/code>/)
  const tokens = tokenize(source)
  assert.ok(tokens.filter((t) => t.row >= 2 && t.row <= 4).every((t) => has(t, 'markup.raw.block')), report(tokens))
  assert.ok(scoped(tokens, 6, ':::::', 'punctuation.definition.div'), report(tokens))
})

test('a caption after a closed fence inside a container is still a caption', () => {
  const source = '::: note\n```js\nx\n```\n^ Listing *one*\n:::\n'
  assert.match(carveToHtml(source), /<figcaption>Listing <strong>one<\/strong><\/figcaption>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 4, '^', 'punctuation.definition.caption'), report(tokens))
  assert.ok(scoped(tokens, 5, ':::', 'punctuation.definition.div'), report(tokens))
})

test('an escaped pipe in a table row is cell text', () => {
  const source = '| a \\| b | c |\n'
  assert.match(carveToHtml(source), /<td>a \| b<\/td><td>c<\/td>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 0, '\\|', 'constant.character.escape'), report(tokens))
  assert.equal(tokens.filter((t) => has(t, 'punctuation.separator.table')).length, 3, report(tokens))
})

test('an escape wins over the math, symbol and attribute it would open', () => {
  const source = '\\$`x` and \\:smile: and \\{{ x }}\n'
  assert.match(carveToHtml(source), /<p>\$<code>x<\/code> and :smile: and \{\{ x \}\}<\/p>/)
  const tokens = tokenize(source)
  assert.ok(scoped(tokens, 0, '\\$', 'constant.character.escape'), report(tokens))
  assert.ok(scoped(tokens, 0, '\\:', 'constant.character.escape'), report(tokens))
  for (const scope of ['markup.other.math', 'constant.language.symbol', 'meta.attributes']) {
    assert.ok(!tokens.some((t) => has(t, scope)), `${scope}:\n${report(tokens)}`)
  }
})
