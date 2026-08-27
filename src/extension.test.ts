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
import { isLineOnScreen, isScrollNotTyping } from './scroll.js'
import {
  EXCLUDED_EXTENSIONS,
  PREVIEW_EXTENSIONS,
  TIER1_DECORATING_EXTENSIONS,
  previewDocument,
  renderConformanceBody,
  renderPreviewBody,
  renderMarkdown,
} from './preview.js'

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

const PREVIEW_ASSETS = {
  mermaid: 'mermaid.js',
  chartJs: 'chart.js',
  katexJs: 'katex.js',
  katexCss: 'katex.css',
  katexAutoRender: 'auto-render.js',
  hljsJs: 'highlight.js',
  hljsLightCss: 'github.css',
  hljsDarkCss: 'github-dark.css',
  carveTokensCss: 'carve-css/tokens.css',
  carveCoreCss: 'carve-css/core.css',
  carveExtensionsCss: 'carve-css/extensions.css',
  carveRecipesCss: 'carve-css/recipes.css',
}

/** The preview scaffold for a given source, with stub asset URIs. */
function previewHtml(source = '*bold*'): string {
  return previewDocument(source, {
    nonce: 'abc123',
    cspSource: 'vscode-resource://test',
    assets: PREVIEW_ASSETS,
  })
}

/**
 * The scaffold's own <style> block - the part this extension writes, as opposed
 * to the carve-css files it links. Tests about hardcoded color must look here
 * and only here, or they would be reading carve-css's palette, which is exactly
 * where literal color is supposed to live.
 */
function scaffoldStyle(html = previewHtml()): string {
  const open = html.indexOf('<style nonce=')
  const start = html.indexOf('>', open) + 1
  const end = html.indexOf('</style>', start)
  assert.ok(open > -1 && end > start, 'the preview scaffold has no <style> block')
  return html.slice(start, end)
}

test('wraps preview HTML in a CSP-safe document', () => {
  const html = previewHtml()

  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /nonce-abc123/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /mermaid\.js/)
  assert.match(html, /katex\.css/)
})

// --- Preview: which extensions are on ---

// The reference set is the docs playground
// (docs/.vitepress/carve-extensions.js in markup-carve/carve). It lives in
// another repo and the pinned engine exports no list of it, so this cannot be
// compared across repos honestly. What CAN be checked locally is the thing that
// actually causes the drift: a new extension landing in the engine that nobody
// decided about. That is what this guard is.

test('every extension the engine ships is either enabled or excluded with a reason', async () => {
  const lib = (await import('@markup-carve/carve')) as Record<string, unknown>

  // An extension factory is a function returning an object with a non-empty
  // `name` and at least one lifecycle hook. Anything else an export might be -
  // a parser helper, a renderer, a profile class - fails this shape.
  const HOOKS = [
    'matchInline', 'matchBlock', 'afterParse',
    'beforeRender', 'renderers', 'blockRenderers', 'inlineRenderers',
  ]
  const isFactory = (value: unknown): boolean => {
    if (typeof value !== 'function') return false
    let made: unknown
    try {
      made = (value as () => unknown)()
    } catch {
      return false
    }
    if (!made || typeof made !== 'object') return false
    const ext = made as Record<string, unknown>
    if (typeof ext.name !== 'string' || ext.name.length === 0) return false
    return HOOKS.some((hook) => hook in ext)
  }

  const classified = new Set<string>([...PREVIEW_EXTENSIONS, ...Object.keys(EXCLUDED_EXTENSIONS)])
  const unclassified = Object.entries(lib)
    .filter(([name, value]) => !classified.has(name) && isFactory(value))
    .map(([name]) => name)
    .sort()

  assert.deepEqual(
    unclassified,
    [],
    `the engine ships extension factories the preview has never decided about: ` +
      `${unclassified.join(', ')}. Add each to PREVIEW_EXTENSIONS or to ` +
      `EXCLUDED_EXTENSIONS with the reason it stays off. This is how the preview ` +
      `silently fell eight behind the docs playground.`,
  )

  // The guard is only worth anything if it is looking at real factories.
  const enabledAreFactories = PREVIEW_EXTENSIONS.filter((name) => isFactory(lib[name]))
  assert.equal(
    enabledAreFactories.length,
    PREVIEW_EXTENSIONS.length,
    'an enabled name is not an extension factory in the pinned engine',
  )

  // No name may be on both lists, which would make the reason a lie.
  const both = PREVIEW_EXTENSIONS.filter((name) => name in EXCLUDED_EXTENSIONS)
  assert.deepEqual(both, [], `enabled AND excluded: ${both.join(', ')}`)
})

test('headingPermalinks stays off, on purpose and on the record', () => {
  assert.ok(
    !(PREVIEW_EXTENSIONS as readonly string[]).includes('headingPermalinks'),
    'headingPermalinks is enabled again. The docs playground enables it and this preview ' +
      'deliberately does not - the anchors are noise in an editor preview, which nobody ' +
      'deep-links into. If that call has changed, change the comment too.',
  )
  assert.match(
    EXCLUDED_EXTENSIONS.headingPermalinks ?? '',
    /DECISION/,
    'the headingPermalinks exclusion lost the note saying it is a decision rather than a gap, ' +
      'which is what stops the next person closing the divergence by adding it back',
  )
})

test('the four extensions the preview had been missing actually render', () => {
  // citations changes the PARSE, not just the render: without the extension
  // there is no citation node at all.
  const cited = renderPreviewBody('See [@knuth1984].\n\n[@knuth1984]: Knuth, D. /The TeXbook/. 1984.')
  assert.match(
    cited,
    /data-cite-key="knuth1984"/,
    'a [@key] citation no longer renders. citations() changes the PARSE, not just the render: ' +
      'without it there is no citation node at all, so the whole construct is unreachable.',
  )
  assert.match(
    cited,
    /<ol class="references">/,
    'the citation definition no longer produces a reference list',
  )
  assert.match(
    renderPreviewBody('A [[Wiki Page]] link.'),
    /class="wikilink"/,
    'a wikilink no longer renders',
  )
  assert.match(
    renderPreviewBody('Bare URL https://example.com here.'),
    /<a[^>]+href="https:\/\/example\.com"/,
    'a bare URL no longer autolinks',
  )
  assert.match(
    renderPreviewBody('An [offsite link](https://example.com).'),
    /rel="[^"]*noopener|target="_blank"/,
    'an external link no longer picks up its rel/target treatment',
  )
})

test('exactly the declared extensions decorate Tier-1 output', async () => {
  const lib = await import('@markup-carve/carve')
  const factories = lib as unknown as Record<string, () => never>

  // A link and a bare URL - between them, the Tier-1 constructs the corpus pins
  // that an extension is most likely to decorate.
  const PROBE = 'See [the site](https://example.com) and https://example.com/bare here.'
  const bare = lib.carveToHtml(PROBE, { extensions: [] })

  const changed = PREVIEW_EXTENSIONS
    .filter((name) => lib.carveToHtml(PROBE, { extensions: [factories[name]()] }) !== bare)
    .slice()
    .sort()

  assert.deepEqual(
    changed,
    [...TIER1_DECORATING_EXTENSIONS].sort(),
    'the set of extensions that change Tier-1 link output has moved. Declared: ' +
      `${[...TIER1_DECORATING_EXTENSIONS].join(', ')}; measured: ${changed.join(', ')}. ` +
      'An undeclared one makes the corpus measurement quietly stop being about the engine; ' +
      'a stale declaration hides a real regression behind an intended one.',
  )

  // And the separation must actually do something: the conformance render drops
  // the decoration the preview render keeps.
  const preview = renderPreviewBody(PROBE)
  const conformance = renderConformanceBody(PROBE)
  assert.notEqual(
    preview,
    conformance,
    'the conformance render equals the preview render, so the decorating extensions are no ' +
      'longer held back from the corpus measurement',
  )
  assert.match(preview, /rel="[^"]*noopener/, 'the preview no longer decorates an external link')
  assert.doesNotMatch(
    conformance,
    /rel="[^"]*noopener/,
    'the conformance render carries the external-link decoration, so the corpus has stopped ' +
      'measuring what the spec pins',
  )
})

// --- Preview: carve-css adoption, the tool strip, and task-list states ---
//
// These guard the three things the preview was rebuilt for. Each was
// mutation-tested: the mutation named in each comment was applied to
// preview.ts, the test was confirmed to FAIL, and the mutation was reverted.
// A guard that cannot fail is worse than no guard, because it reads as cover.

test('the preview links the carve-css layers and scopes the body for them', () => {
  const html = previewHtml()

  // Every rule in carve-css is scoped under `.carve`. Without the class on the
  // container, all four stylesheets load and none of them apply - the preview
  // would look exactly as unstyled as it did before, with no error anywhere.
  assert.match(
    html,
    /<main class="carve">/,
    'the preview body no longer carries the .carve scope class, so every carve-css rule is inert',
  )

  for (const layer of ['tokens', 'core', 'extensions', 'recipes']) {
    assert.ok(
      html.includes(`carve-css/${layer}.css`),
      `the preview no longer links carve-css ${layer}.css`,
    )
  }

  // tokens.css must be linked before the scaffold's own block, or the bridge
  // below would be overwritten by carve-css's neutral palette.
  assert.ok(
    html.indexOf('carve-css/tokens.css') < html.indexOf('<style nonce='),
    'carve-css tokens are linked after the scaffold style, so the VS Code bridge loses the cascade',
  )
})

test('the preview scaffold carries no color literal of its own', () => {
  // Comments stripped first. The scan is a claim about DECLARATIONS - a comment
  // that says "it computed rgba(0, 0, 0, 0) before this fix" documents a
  // measurement rather than hardcoding a color, and matching it would push the
  // next author toward describing findings vaguely to appease a regex.
  const style = scaffoldStyle().replace(/\/\*[\s\S]*?\*\//g, '')

  // The point of adopting carve-css is that literal color lives in ONE place -
  // its token layer - and everything else resolves through a variable. A color
  // written here is a value that cannot follow the editor theme, which is the
  // defect the maintainer saw as "not as nice as in phpstorm".
  //
  // A general scan, not a denylist of the specific values that were removed:
  // the regression to catch is a NEW hardcoded color, which a denylist of old
  // ones cannot see.
  const literals = [
    /#[0-9a-fA-F]{3,8}\b/g,
    /\brgba?\(/g,
    /\bhsla?\(/g,
  ]
  for (const pattern of literals) {
    const found = style.match(pattern)
    assert.equal(
      found,
      null,
      `the preview scaffold hardcodes a color (${found?.join(', ')}). Every color must ` +
        `resolve through a --carve-* token or a --vscode-* variable so it follows the editor theme.`,
    )
  }

  // The other half of the same claim: the tokens are actually bound to the
  // editor. An empty style block would pass the scan above on its own.
  for (const [token, source] of [
    ['--carve-surface', '--vscode-editor-background'],
    ['--carve-ink', '--vscode-editor-foreground'],
    ['--carve-ink-soft', '--vscode-descriptionForeground'],
    ['--carve-sunk', '--vscode-textCodeBlock-background'],
    ['--carve-border', '--vscode-panel-border'],
    ['--carve-accent', '--vscode-textLink-foreground'],
  ]) {
    assert.match(
      style,
      new RegExp(`${token}:\\s*var\\(${source}`),
      `${token} is no longer bound to ${source}, so the preview stops following the editor theme`,
    )
  }

  // High contrast is the theme people forget. Its washes must collapse, because
  // a 12% tint under a high-contrast foreground eats the contrast ratio the
  // theme exists to guarantee.
  const hc = style.match(/body\.vscode-high-contrast[^{]*\{[^}]*\}/)
  assert.ok(hc, 'the scaffold no longer treats high contrast at all')
  assert.match(
    hc[0],
    /--carve-border:\s*var\(--vscode-contrastBorder/,
    'the high-contrast block no longer binds the borders to the theme contrast border. That ' +
      'binding IS the high-contrast treatment - a high-contrast theme carries its meaning in ' +
      'edges, and it is the only place --vscode-contrastBorder is defined.',
  )
  assert.doesNotMatch(
    hc[0],
    /-wash:\s*transparent/,
    'the high-contrast block collapses a wash to transparent again. Measured: that made ' +
      'tr.ok and tr.warn compute the same background, and a toned badge the same as a plain ' +
      'one - the wash is the only signal those constructs have.',
  )
})

test('every code fence gets a language badge and a copy button, visible at rest', () => {
  const style = scaffoldStyle()
  const html = previewHtml()

  assert.match(html, /'code-lang'/, 'the language badge is no longer built')
  assert.match(html, /'code-copy'/, 'the copy button is no longer built')
  // Built is not the same as reachable: a builder that nothing calls leaves
  // every one of its strings in the scaffold and every naive assertion green.
  // The anchor matters as much as the call - the webview script is embedded in
  // this document verbatim, comments and all, so an unanchored match would go on
  // finding a statement that had been commented out. Measured: it did.
  assert.match(
    html,
    /^\s*tools\.appendChild\(copyButton\(code\)\)\s*$/m,
    'the copy button is built but never added to the tool strip, so no fence has one',
  )
  assert.match(
    html,
    /^\s*tools\.appendChild\(badge\)\s*$/m,
    'the language badge is built but never added to the tool strip, so no fence shows its type',
  )
  assert.match(style, /\.code-lang\s*\{/, 'the language badge is no longer styled')
  assert.match(style, /\.code-copy\s*\{/, 'the copy button is no longer styled')

  // The badge used to exist but was `opacity: 0` until hover, which is why the
  // maintainer reported "no type shown". The strip must be visible at rest.
  const strip = style.match(/\.carve-code\s*>\s*\.code-tools\s*\{[^}]*\}/)
  assert.ok(strip, 'the code tool strip is no longer styled')
  const opacity = strip[0].match(/opacity:\s*([\d.]+)/)
  assert.ok(opacity, 'the tool strip sets no resting opacity')
  assert.ok(
    Number(opacity[1]) > 0,
    'the code tool strip is invisible at rest (opacity 0), so the language and the copy ' +
      'button can only be found by hovering - the exact complaint this strip replaced',
  )

  // The strip must be a sibling of the <pre>, not a child: a <pre> scrolls its
  // own content horizontally, so a child pinned to its corner slides out of
  // view on precisely the long lines a reader wants to copy.
  assert.match(
    html,
    /wrap\.appendChild\(tools\)/,
    'the tool strip is no longer appended to the code wrapper',
  )
  assert.doesNotMatch(
    style,
    /pre\s*>\s*\.code-tools/,
    'the tool strip is positioned inside the <pre>, so it scrolls away with long lines',
  )
})

test('the copy button asks the extension host and reports the outcome', () => {
  const html = previewHtml()

  // The host bridge is the path that actually works. A webview runs in an
  // iframe without the clipboard-write permission policy, so
  // navigator.clipboard.writeText REJECTS there; it stays only as the fallback
  // for the exported HTML, which runs in a normal tab.
  assert.match(
    html,
    /postMessage\(\{ type: 'copy', id, text \}\)/,
    'the copy button no longer asks the extension host, and the browser clipboard API is ' +
      'blocked in a webview iframe - the button would fail silently',
  )
  assert.match(html, /navigator\.clipboard/, 'the browser clipboard fallback is gone')
  assert.match(html, /document\.execCommand\('copy'\)/, 'the execCommand fallback is gone')

  // Both outcomes must be reported. A copy button that silently does nothing is
  // worse than no copy button.
  assert.match(html, /'Copy failed'/, 'a failed copy is no longer reported to the reader')
  assert.match(html, /'Copied'/, 'a successful copy is no longer confirmed to the reader')

  // Keyed by request id, so two quick clicks cannot answer each other.
  assert.match(
    html,
    /copyWaiting\.get\(message\.id\)/,
    'the copy result is no longer matched to its request, so two clicks can cross answers',
  )
})

test('a done task item is tellable from an open one at a glance', () => {
  const style = scaffoldStyle()

  // The maintainer could not tell the two states apart, then chose how they
  // should differ: the BOX carries the state and the label is left readable.
  // A done item is a positive state you can still read, which is what a task
  // list is for - not a struck-out line you have to squint past.
  //
  // Asserted as a pair, because the signal is the CONTRAST between them. A
  // rule that tones every box the same way would satisfy either half alone.
  // accent-color is NOT the mechanism and must not be asserted as one: the
  // engine emits the box disabled, and a disabled checkbox is painted by the
  // UA in its own grey with accent-color ignored. The box is drawn instead.
  assert.match(
    style,
    /input\[type="checkbox"\]\s*\{[^}]*appearance:\s*none/,
    'the task box is back to the UA rendering, which greys a disabled box and flattens both states',
  )
  assert.match(
    style,
    /input\[type="checkbox"\]:checked\s*\{[^}]*background:\s*var\(--carve-success\)/,
    'a done task box no longer fills with the success tone, so the two states read alike',
  )
  assert.match(
    style,
    /input\[type="checkbox"\]:checked::after\s*\{/,
    'a done task box has no tick drawn in it, so a filled square is the only signal',
  )
  // The OPEN state is carve-css's, not the scaffold's - core.css gives every
  // task box `accent-color: var(--carve-accent)`. Asserted against the bundled
  // stylesheet rather than the scaffold, because that is the file that has to
  // keep holding it; asserting it here would pass while the real rule vanished.
  const coreCss = readFileSync(
    join(here, '..', 'media', 'carve-css', 'core.css'),
    'utf8',
  )
  assert.match(
    coreCss,
    /input\[type="checkbox"\]\s*\{[^}]*accent-color:\s*var\(--carve-accent\)/,
    'the bundled carve-css no longer tones an open task box, so there is nothing to contrast with',
  )

  // The label must stay alone. Dimming or striking it was the previous
  // treatment and it needed a :not(:has(:is(ul, ol))) guard, because a
  // decoration on a block box reaches every descendant and CSS gives the
  // descendant no way to refuse it - a finished parent struck its open
  // children. Nothing here sets either, so the carve-out is not needed.
  assert.doesNotMatch(
    style,
    /:checked\)[^{]*\{[^}]*text-decoration:\s*line-through/,
    'a done item strikes its label again, which reaches into nested open items',
  )
  assert.doesNotMatch(
    style,
    /:checked\)\s*\{\s*color:\s*var\(--carve-ink-soft\)/,
    'a done item dims its label again, which reaches into nested open items',
  )
})

test('the preview follows a theme switch while it is open', () => {
  const html = previewHtml()

  // Color follows on its own - the tokens are bound to --vscode-* variables
  // that VS Code rewrites in place. These two are not CSS and do not:
  // highlight.js is a pair of stylesheets, and mermaid bakes its palette into
  // the SVG it already emitted.
  assert.match(
    html,
    /new MutationObserver\(onThemeChanged\)/,
    'nothing watches for a theme switch, so code colors and diagrams keep the old theme',
  )
  assert.match(
    html,
    /attributeFilter: \['class'\]/,
    'the theme observer no longer watches the body class VS Code swaps on a theme change',
  )
  assert.match(
    html,
    /setAttribute\('data-mermaid-src'/,
    'mermaid diagrams no longer record their source, so a theme switch cannot redraw them - ' +
      'mermaid consumes the source element when it renders',
  )
})

test('a code block is one flat surface, in every theme', () => {
  const html = previewHtml()

  // The highlight.js themes paint the inner element themselves:
  //   .hljs { color:#24292e; background:#fff }
  //   .hljs { display:block; overflow-x:auto; padding:1em }
  // so a hljs stylesheet loaded AFTER carve-css puts a hardcoded #fff rectangle
  // with its own 1em padding inside the pre's themed padding - an inset frame in
  // light themes, and a white slab in dark ones. carve-css core.css resets it
  // with `.carve pre code { background: none; padding: 0 }`, and that reset only
  // wins because it is loaded later. The order is the fix; assert the order.
  const hljs = Math.max(html.indexOf('hljs-light'), html.indexOf('hljs-dark'))
  const carve = html.indexOf('carve-css/core.css')
  assert.ok(hljs > -1 && carve > -1, 'the stylesheets are no longer both linked')
  assert.ok(
    hljs < carve,
    'a highlight.js theme is linked AFTER carve-css, so its own `.hljs { background: #fff; ' +
      'padding: 1em }` wins again: the code block gets an inset rectangle, and on a dark ' +
      'theme that rectangle is a white slab.',
  )

  // Both themes must be present and switchable, or only one ever applies.
  assert.match(html, /id="hljs-light"[^>]*disabled/, 'the light hljs theme is no longer togglable')
  assert.match(html, /id="hljs-dark"[^>]*disabled/, 'the dark hljs theme is no longer togglable')
  assert.match(
    html,
    /light\.disabled = isDark\(\)/,
    'nothing swaps the hljs stylesheet, so one theme is used under both',
  )
})

test('a tab set and a code group show exactly one panel', () => {
  const style = scaffoldStyle()

  // The extensions emit the CSS-only shape - a hidden radio per tab, a bound
  // label, and a panel - so no script is needed. What IS needed is a selector
  // matching the order the engine emits, which is all the controls and then all
  // the panels. carve-css 0.1.0 assumes radio/label/panel repeating, so its
  // chain lights the panel after the LAST label: measured, checking tab 2 left
  // both panels displayed.
  for (const kind of ['tabs', 'code-group']) {
    assert.match(
      style,
      new RegExp(`\\.${kind} > input\\.${kind}-radio:nth-of-type\\(1\\):checked ~ div\\.${kind}-panel:nth-of-type\\(1\\)`),
      `${kind} panels are no longer paired with their own radio by position, so either every ` +
        `panel stays hidden or the wrong one shows`,
    )
    assert.match(
      style,
      new RegExp(`\\.${kind} > input\\.${kind}-radio:checked \\+ label\\.${kind}-label \\+ div\\.${kind}-panel`),
      `the upstream ${kind} rule is no longer neutralized, so selecting the second tab also ` +
        `reveals the first tab's panel`,
    )
  }
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

test('both exports are reachable from the editor, not only the palette', () => {
  const manifest = JSON.parse(
    readFileSync(join(here, '..', 'package.json'), 'utf8'),
  ) as {
    contributes: {
      commands: { command: string }[]
      menus: Record<string, { command: string; when?: string }[]>
    }
  }

  // A command that exists only in the Command Palette is a command most people
  // never find. PhpStorm puts both exports in the editor context menu and the
  // maintainer went looking for them here.
  const declared = new Set(manifest.contributes.commands.map((c) => c.command))
  for (const command of ['carve.exportHtml', 'carve.exportMarkdown']) {
    assert.ok(declared.has(command), `${command} is not a declared command`)
    assert.ok(
      (manifest.contributes.menus['editor/context'] ?? []).some(
        (entry) => entry.command === command,
      ),
      `${command} is missing from the editor context menu, so it is palette-only`,
    )
  }
})

test('the Markdown export writes the engine Markdown, with no HTML wrapper', () => {
  // The bundle exports ten converters and the extension reached one of them.
  // What lands on disk has to be what carveToMarkdown writes: the HTML export
  // builds a standalone page around its output, and wrapping Markdown in one
  // would corrupt it.
  const md = renderMarkdown('# Title\n\n- one\n- two\n')
  assert.match(md, /^# Title/, 'the Markdown export does not render a heading')
  assert.doesNotMatch(md, /<!DOCTYPE|<html|<body/i, 'the Markdown export wraps its output in HTML')
})

// THE PREVIEW SCROLL LOOP, PINNED.
//
// Editor and preview each sync to the other, so these guards are the only
// thing stopping a keystroke from becoming: viewport moves -> preview scrolls
// -> preview reports its top line -> editor is revealed to it -> viewport
// moves. That loop is what made the editor jitter while typing.

test('a line already on screen needs no reveal', () => {
  const visible = [{ start: { line: 10 }, end: { line: 40 } }]
  assert.equal(isLineOnScreen(10, visible), true)
  assert.equal(isLineOnScreen(40, visible), true)
  assert.equal(isLineOnScreen(25, visible), true)
})

test('a line off screen is still revealed', () => {
  const visible = [{ start: { line: 10 }, end: { line: 40 } }]
  assert.equal(isLineOnScreen(9, visible), false)
  assert.equal(isLineOnScreen(41, visible), false)
  assert.equal(isLineOnScreen(0, []), false)
})

test('a viewport change right after an edit is typing, not scrolling', () => {
  assert.equal(isScrollNotTyping(1_000, 1_000), false)
  assert.equal(isScrollNotTyping(1_100, 1_000), false)
})

test('a viewport change well after the last edit is a real scroll', () => {
  assert.equal(isScrollNotTyping(1_400, 1_000), true)
  assert.equal(isScrollNotTyping(99_999, 0), true)
})
