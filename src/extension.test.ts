import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createRequire } from 'node:module'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const { INITIAL, Registry, parseRawGrammar } = vsctm
const { OnigScanner, OnigString, loadWASM } = oniguruma
type IGrammar = vsctm.IGrammar
import { serverModulePath } from './paths.js'
import { previewDocument, renderPreviewBody } from './preview.js'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
// Compiled test runs from dist/; the project root is one level up.
const projectRoot = dirname(here)
const grammarPath = join(projectRoot, 'syntaxes', 'carve.tmLanguage.json')

let grammarPromise: Promise<IGrammar> | undefined

async function carveGrammar(): Promise<IGrammar> {
  if (!grammarPromise) {
    const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm')
    const wasmBin = readFileSync(wasmPath).buffer
    const onigLib = loadWASM(wasmBin).then(() => ({
      createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
      createOnigString: (s: string) => new OnigString(s),
    }))

    const registry = new Registry({
      onigLib,
      loadGrammar: async (scopeName) => {
        if (scopeName !== 'text.carve') {
          return null
        }
        const content = readFileSync(grammarPath, 'utf8')
        return parseRawGrammar(content, grammarPath)
      },
    })

    grammarPromise = registry.loadGrammar('text.carve').then((g) => {
      if (!g) {
        throw new Error('Failed to load text.carve grammar')
      }
      return g
    })
  }
  return grammarPromise
}

// Tokenize a single line against the Carve grammar and return, for each token,
// the substring and its full scope stack. State carries across lines so multi-
// line constructs (e.g. fenced code) tokenize correctly.
interface ScopedToken {
  text: string
  scopes: string[]
}

async function tokenizeLines(lines: string[]): Promise<ScopedToken[][]> {
  const grammar = await carveGrammar()
  let ruleStack = INITIAL
  const out: ScopedToken[][] = []
  for (const line of lines) {
    const result = grammar.tokenizeLine(line, ruleStack)
    ruleStack = result.ruleStack
    out.push(
      result.tokens.map((t) => ({
        text: line.slice(t.startIndex, t.endIndex),
        scopes: t.scopes,
      })),
    )
  }
  return out
}

// Find the token whose text contains `needle` and that carries a scope matching
// `scope` (substring match on any scope in its stack).
function findScoped(
  tokens: ScopedToken[],
  needle: string,
  scope: string,
): ScopedToken | undefined {
  return tokens.find(
    (t) => t.text.includes(needle) && t.scopes.some((s) => s.includes(scope)),
  )
}

test('resolves bundled language server entrypoint', () => {
  const resolved = serverModulePath({
    asAbsolutePath(relativePath: string): string {
      return `/extension/${relativePath}`
    },
  })

  assert.equal(resolved, '/extension/node_modules/@markup-carve/carve-lsp/dist/server.js')
})

test('renders Carve preview HTML', () => {
  assert.match(renderPreviewBody('# Hello'), /<h1>Hello<\/h1>/)
})

// THE PREVIEW'S EXTENSION SET, PINNED.
//
// `renderPreviewBody` passes `extensions: previewExtensions()` into
// `carveToHtml`, and every Tier-2/Tier-3 construct in the preview depends on
// it. Drop that one property and nothing throws: the engine renders the same
// documents as ordinary containers and fenced code, so a `::: details` becomes
// a plain div and a ```chart fence becomes a code block. The preview just
// quietly stops being a Carve preview.
//
// Measured, not assumed: deleting `extensions: previewExtensions()` from
// preview.ts left the whole suite green - 18 unit tests and 60 grammar
// snapshots - because the only assertion that reached this function rendered
// `# Hello`, which needs no extension at all.
//
// So each extension is pinned by an output marker it alone produces. The
// marker is the point rather than the exact HTML: these assert what the
// extension DOES (a details element, a mermaid pre, a real table) and not how
// carve-js spells the rest of the document, so a rendering change upstream
// does not drag this test with it.
//
// `tabs` needs its full shape to discriminate: a bare `::: tabs` holding code
// fences renders identically either way, because the extension defers to core
// rendering when it finds no `::: tab` panels inside. Only the nested form
// tells the two apart, so that is the one pinned - a case that looks like a
// tab set but is not one would have left this extension unpinned while
// appearing to cover it.
const previewExtensionMarkers: Array<[string, string, RegExp]> = [
  ['details', '::: details "More"\nbody\n:::\n', /<details>/],
  ['spoiler', '::: spoiler "Peek"\nhidden\n:::\n', /<details class="spoiler">/],
  // Not anchored on the closing `>`: carve 0.1.5 added `role="img"` and an
  // aria-label to this element, and the marker is meant to say the extension
  // ran, not how the engine spells the rest of the tag.
  ['mermaid', '```mermaid\ngraph TD;\n```\n', /<pre class="mermaid"[ >]/],
  ['mathBlock', '```math\nx^2\n```\n', /<div class="math display">/],
  ['chart', '```chart\n{"type":"bar"}\n```\n', /<script type="application\/json">/],
  ['codeGroup', '::: code-group\n```js [One]\nx\n```\n:::\n', /class="code-group-label"/],
  ['listTable', '::: list-table\n- - a\n  - b\n:::\n', /<table>/],
  [
    'tabs',
    ':::: tabs\n::: tab [Install]\nrun it\n:::\n::: tab [Use]\ncall it\n:::\n::::\n',
    /class="tabs-label"/,
  ],
]

for (const [name, source, marker] of previewExtensionMarkers) {
  test(`preview passes the ${name} extension through to carveToHtml`, () => {
    assert.match(
      renderPreviewBody(source),
      marker,
      `The preview rendered ${name} without its extension. renderPreviewBody must pass ` +
        `extensions: previewExtensions() to carveToHtml.`,
    )
  })
}

test('wraps preview HTML in a CSP-safe document', () => {
  const html = previewDocument('*bold*', {
    nonce: 'abc123',
    cspSource: 'vscode-resource://test',
    assets: {
      mermaid: 'mermaid.js',
      chartJs: 'chart.js',
      katexJs: 'katex.js',
      katexCss: 'katex.css',
      katexAutoRender: 'auto-render.js',
      hljsJs: 'highlight.js',
      hljsLightCss: 'github.css',
      hljsDarkCss: 'github-dark.css',
    },
  })

  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /nonce-abc123/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /mermaid\.js/)
  assert.match(html, /katex\.css/)
})

// --- TextMate grammar: PR #201 block headers + grouping labels, GFM rows ---

test('grammar: plain fenced code still tokenizes (regression)', async () => {
  const [opener] = await tokenizeLines(['```js', 'code', '```'])
  assert.ok(
    findScoped(opener, '```', 'punctuation.definition.raw.begin.carve'),
    'fence punctuation should be scoped',
  )
  assert.ok(
    findScoped(opener, 'js', 'entity.name.type.language.carve'),
    'language token should be scoped',
  )
})

test('grammar: fence with language + quoted header', async () => {
  const [opener] = await tokenizeLines(['```php "src/Auth.php"', 'x', '```'])
  assert.ok(findScoped(opener, 'php', 'entity.name.type.language.carve'))
  assert.ok(
    findScoped(opener, 'src/Auth.php', 'string.quoted.double.carve'),
    'quoted header should be a string',
  )
})

test('grammar: fence with language + label', async () => {
  const [opener] = await tokenizeLines(['```php [NPM]', 'x', '```'])
  assert.ok(findScoped(opener, 'php', 'entity.name.type.language.carve'))
  assert.ok(
    findScoped(opener, '[NPM]', 'entity.name.label.carve'),
    'label should be scoped',
  )
})

test('grammar: fence header + label, header-first order', async () => {
  const [opener] = await tokenizeLines(['```php "src/Auth.php" [Composer]', 'x', '```'])
  assert.ok(findScoped(opener, 'php', 'entity.name.type.language.carve'))
  assert.ok(findScoped(opener, 'src/Auth.php', 'string.quoted.double.carve'))
  assert.ok(findScoped(opener, '[Composer]', 'entity.name.label.carve'))
})

test('grammar: fence header + label, label-first order', async () => {
  const [opener] = await tokenizeLines(['```php [Composer] "x"', 'y', '```'])
  assert.ok(findScoped(opener, 'php', 'entity.name.type.language.carve'))
  assert.ok(findScoped(opener, '[Composer]', 'entity.name.label.carve'))
  assert.ok(findScoped(opener, '"x"', 'string.quoted.double.carve'))
})

test('grammar: bare label abutting the fence (no language)', async () => {
  const [opener] = await tokenizeLines(['```[NPM]', 'x', '```'])
  assert.ok(
    findScoped(opener, '[NPM]', 'entity.name.label.carve'),
    'abutting label should be scoped',
  )
  // The abutting bracket must not be mis-scoped as a language token.
  assert.equal(
    findScoped(opener, '[NPM]', 'entity.name.type.language.carve'),
    undefined,
  )
})

test('grammar: fence quoted header with no language', async () => {
  const [opener] = await tokenizeLines(['``` "notes.txt"', 'x', '```'])
  assert.ok(
    findScoped(opener, 'notes.txt', 'string.quoted.double.carve'),
    'header should be scoped even without a language',
  )
})

test('grammar: div type + quoted title', async () => {
  const [opener] = await tokenizeLines(['::: tip "Pro Tip"'])
  assert.ok(findScoped(opener, 'tip', 'entity.name.type.div.carve'))
  assert.ok(
    findScoped(opener, 'Pro Tip', 'string.quoted.double.carve'),
    'div title should be a string',
  )
})

test('grammar: div type + title + label', async () => {
  const [opener] = await tokenizeLines(['::: tip "Pro Tip" [Build]'])
  assert.ok(findScoped(opener, 'tip', 'entity.name.type.div.carve'))
  assert.ok(findScoped(opener, 'Pro Tip', 'string.quoted.double.carve'))
  assert.ok(findScoped(opener, '[Build]', 'entity.name.label.carve'))
})

test('grammar: div label-only (no title)', async () => {
  const [opener] = await tokenizeLines([':::: [First]'])
  assert.ok(
    findScoped(opener, '[First]', 'entity.name.label.carve'),
    'div label should be scoped',
  )
})

test('grammar: GFM delimiter row without alignment colons', async () => {
  const [row] = await tokenizeLines(['|---|---|'])
  const seps = row.filter((t) =>
    t.scopes.some((s) => s.includes('punctuation.definition.table.separator.carve')),
  )
  assert.equal(seps.length, 2, 'both delimiter cells should be scoped')
})

test('grammar: GFM delimiter row with alignment colons', async () => {
  const [row] = await tokenizeLines(['|:-----|----:|'])
  // The dash run is the separator punctuation; the alignment colons get a
  // dedicated alignment scope (matching the canonical carve-grammars grammar).
  assert.ok(
    findScoped(row, '-----', 'punctuation.definition.table.separator.carve'),
    'dash run should be the separator',
  )
  assert.ok(
    findScoped(row, ':', 'keyword.operator.table.alignment.carve'),
    'leading alignment colon should be scoped',
  )
  assert.ok(
    findScoped(row, '----', 'punctuation.definition.table.separator.carve'),
    'right-cell dash run should be the separator',
  )
  const colons = row.filter((t) =>
    t.scopes.some((s) => s.includes('keyword.operator.table.alignment.carve')),
  )
  assert.equal(colons.length, 2, 'both alignment colons should be scoped')
})

test('grammar: dash-only data cell is NOT scoped as a delimiter', async () => {
  // A row that is not a pure delimiter/alignment row must keep its dash cell
  // as ordinary content, not a separator (codex P2: gate on the whole row).
  const [row] = await tokenizeLines(['| - | not a delimiter |'])
  assert.equal(
    findScoped(row, '-', 'punctuation.definition.table.separator.carve'),
    undefined,
    'a lone dash in a data row should not be a separator',
  )
})

test('grammar: delimiter row between data rows still scopes only the delimiter', async () => {
  const [head, sep, body] = await tokenizeLines(['| H1 | H2 |', '|---|---|', '| a | b |'])
  // Header and body rows carry no separator-cell scope.
  assert.equal(
    findScoped(head, 'H1', 'punctuation.definition.table.separator.carve'),
    undefined,
  )
  assert.equal(
    findScoped(body, 'a', 'punctuation.definition.table.separator.carve'),
    undefined,
  )
  // The middle row's dash cells are separators.
  const seps = sep.filter((t) =>
    t.scopes.some((s) => s.includes('punctuation.definition.table.separator.carve')),
  )
  assert.equal(seps.length, 2, 'delimiter row should scope both cells')
})

test('grammar: |= header row marker still tokenizes (regression)', async () => {
  const [row] = await tokenizeLines(['|= Header |= Other |'])
  assert.ok(
    findScoped(row, '|=', 'keyword.operator.table.header.carve'),
    'header marker should keep its scope',
  )
})
