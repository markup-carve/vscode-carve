import { parse, render, renderWithDocumentTransforms, tabsExtensions, tabsRenderer, type DocumentTransform } from '@markup-carve/carve'
import {
  chart,
  citations,
  codeGroup,
  details,
  glossary,
  imgFence,
  index,
  listTable,
  mathBlock,
  mermaid,
  spoiler,
  wikilinks,
  withExtensions,
} from '@markup-carve/carve/extensions'
import { toMarkdown } from '@markup-carve/carve/export'

type RenderOptions = NonNullable<Parameters<typeof render>[1]>
type ExtensionDefinitions = NonNullable<RenderOptions['extensions']>
type ExtensionRenderers = NonNullable<RenderOptions['renderers']>

/** Extension definitions, the renderers that draw them and the document transforms that resolve them (C2-X-053). */
export interface PreviewExtensionSet {
  extensions: ExtensionDefinitions
  renderers: ExtensionRenderers
  transforms?: readonly DocumentTransform[]
}

/**
 * The extensions the preview enables.
 *
 * Without these, `:::details`/`:::spoiler`/`:::tabs` degrade to inert `<div>`s,
 * math stays literal, and mermaid/chart fences never hydrate. Constructed fresh
 * per render so no cross-document state leaks.
 *
 * The reference set is the docs playground, reconciled by hand.
 * `PREVIEW_EXTENSIONS`/`EXCLUDED_EXTENSIONS` below turn the parts that CAN be
 * checked locally into a test: every extension factory the pinned engine
 * exports from `@markup-carve/carve/extensions` is classified one way or the
 * other.
 *
 * `autolink` and `externalLinks` are no longer engine extensions in 0.2; the
 * preview rebuilds them as a document transform (`decorateLinks`).
 */
export const PREVIEW_EXTENSIONS = [
  'details',
  'spoiler',
  'mermaid',
  'mathBlock',
  'tabs',
  'codeGroup',
  'listTable',
  'chart',
  'wikilinks',
  'citations',
  'glossary',
  'index',
  'imgFence',
] as const

/**
 * Every extension factory the pinned engine exports that the preview
 * deliberately does NOT enable, each with the reason it stays off.
 *
 * The guard in `extension.test.ts` fails until a new factory is named in one
 * list or the other, so the decision has to be made rather than defaulted.
 */
export const EXCLUDED_EXTENSIONS: Record<string, string> = {
  // A DECISION, not a gap. The docs playground enabled headingPermalinks; this
  // preview will not. 0.2 ships no such extension, and if one returns it stays
  // off: an editor preview is not a page anyone deep-links into.
  headingPermalinks: 'DECISION: the paragraph anchors are noise in an editor preview, which nobody deep-links into',

  // Need configuration, or have no visible effect zero-config. A preview gets
  // no per-document configuration, so these would be inert.
  defaultAttributes: 'needs per-document default-attribute config',
  tabNormalize: 'invisible whitespace transform, nothing to show',
  inlineFootnotesToParentheses: 'rewrites footnotes the reader wants to see as footnotes',
  smartQuotes: 'needs a locale, and the core smartTypography option is off in the preview',
  colorSwatch: 'needs :color[] markers, nothing to show zero-config',
  codeCallouts: 'needs <n> markers plus a bound list, nothing to show zero-config',
  semanticSpan: 'consumes samp/var/cite/dfn, contradicting the corpus-pinned HTML for the core semantic-name examples',

  // Fenced-diagram presets whose client library the preview does not bundle.
  // Only mermaid and chart are wired up in media/.
  d2: 'needs the D2 client library, not bundled',
  graphviz: 'needs a Graphviz/Viz.js client library, not bundled',
  plantuml: 'needs the PlantUML client library, not bundled',
  wavedrom: 'needs the WaveDrom client library, not bundled',
  abc: 'needs the abcjs client library, not bundled',
  vegaLite: 'needs the Vega-Lite client library, not bundled',
  presets: 'every diagram preset at once, most of whose client libraries are not bundled',
}

/** Factory per enabled name, so the guard can check the list drives the render. */
const EXTENSION_FACTORIES: Record<string, () => PreviewExtensionSet> = {
  details,
  spoiler,
  mermaid,
  mathBlock,
  tabs: () => ({ extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } }),
  codeGroup,
  listTable,
  chart,
  wikilinks,
  citations,
  glossary,
  index,
  imgFence,
}

/**
 * The preview features that deliberately change the HTML of a TIER-1
 * construct. `externalLinks` adds `target`/`rel` to an off-site link and
 * `autolink` turns a bare URL into one; both are host transforms in 0.2 (see
 * `decorateLinks`). The conformance render leaves them out, so the corpus
 * measures the engine and not the preview's decoration.
 */
export const TIER1_DECORATING_EXTENSIONS = ['autolink', 'externalLinks'] as const

/**
 * The enabled extensions that claim a shape the core reads as its own node:
 * `spoiler` turns the core `::: spoiler` div into a details element, which the
 * corpus pins as a div (syntax-blocks examples 137 and 138). The conformance
 * render leaves it out. `wikilinks` claims `:wiki[...]` (C2-X-057), not `[[x]]`.
 */
export const TIER1_CLAIMING_EXTENSIONS = ['spoiler'] as const

function extensionSet(names: readonly string[]): PreviewExtensionSet {
  const merged = withExtensions(...names.map((name) => EXTENSION_FACTORIES[name]!()))
  return { extensions: merged.extensions ?? [], renderers: merged.renderers ?? {}, transforms: merged.transforms ?? [] }
}

/**
 * One fresh instance of each enabled extension.
 *
 * Exported because a render that expands includes has to PARSE with the same
 * set it renders with: several of these change the parse rather than the render,
 * so a parse made without them reads the document differently (#209).
 */
export function previewExtensions(): PreviewExtensionSet {
  return extensionSet(PREVIEW_EXTENSIONS)
}

interface TreeNode {
  type: string
  href?: string
  value?: string
  children?: TreeNode[]
  attrs?: { keyValues?: Array<[string, string]>; [key: string]: unknown }
  [key: string]: unknown
}

const BARE_URL = /https?:\/\/[^\s<>]+/g
const TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/
const OFF_SITE = /^https?:\/\//i
// Text in these nodes is not prose a bare URL could be linked from.
const NO_AUTOLINK = new Set(['link', 'image', 'code', 'code_block', 'raw_block', 'raw_inline', 'math', 'autolink', 'url'])

function autolinkedText(node: TreeNode): TreeNode[] {
  const value = node.value ?? ''
  const pieces: TreeNode[] = []
  let at = 0
  for (const match of value.matchAll(BARE_URL)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    if (!url.match(/^https?:\/\/./)) continue
    if (match.index > at) pieces.push({ type: 'text', value: value.slice(at, match.index) })
    pieces.push({ type: 'link', href: url, children: [{ type: 'text', value: url }] })
    at = match.index + url.length
  }
  if (pieces.length === 0) return [node]
  if (at < value.length) pieces.push({ type: 'text', value: value.slice(at) })
  return pieces
}

/**
 * The 0.1 `autolink` and `externalLinks` extensions, rebuilt as a transform of
 * the parsed tree: a bare `http(s)` URL in prose becomes a link, and every
 * off-site link opens in a new browsing context with `rel="noopener noreferrer"`.
 */
export function decorateLinks(document: unknown): unknown {
  const walk = (node: TreeNode, linkable: boolean): void => {
    if (node.type === 'link' && node.href && OFF_SITE.test(node.href)) {
      const pairs = node.attrs?.keyValues ?? []
      const has = (key: string) => pairs.some(([name]) => name === key)
      const added: Array<[string, string]> = []
      if (!has('target')) added.push(['target', '_blank'])
      if (!has('rel')) added.push(['rel', 'noopener noreferrer'])
      if (added.length) node.attrs = { ...node.attrs, keyValues: [...pairs, ...added] }
    }
    const childLinkable = linkable && !NO_AUTOLINK.has(node.type)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pos' || key === 'attrs' || !Array.isArray(value)) continue
      const children = value as TreeNode[]
      if (!children.some((child) => child && typeof child === 'object' && typeof child.type === 'string')) continue
      if (childLinkable && children.some((child) => child.type === 'text')) {
        node[key] = children.flatMap((child) => child.type === 'text' ? autolinkedText(child) : [child])
      }
      for (const child of node[key] as TreeNode[]) walk(child, childLinkable)
    }
  }
  walk(document as TreeNode, true)
  return document
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/**
 * The `carve.preview.emoji` setting as the engine's `symbols` option. The
 * engine writes a symbol's value raw, so each glyph is escaped: the setting
 * can come from a workspace's own settings file.
 */
export function symbolsFromEmojiSetting(
  emoji: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const entries = Object.entries(emoji ?? {}).filter(([, glyph]) => typeof glyph === 'string')
  if (!entries.length) return undefined
  return Object.fromEntries(entries.map(([name, glyph]) =>
    [name, glyph.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]!)]))
}

export interface PreviewRenderOptions {
  /** URL template for `@mention` links; `{name}` is replaced. */
  mentionUrl?: string
  /** URL template for `#tag` links; `{name}` is replaced. */
  tagUrl?: string
  /** The engine's symbol map for `:name:`; see `symbolsFromEmojiSetting`. */
  symbols?: Record<string, string>
  /** Stamp blocks with `data-source-line` for scroll sync. */
  sourceLine?: boolean
  /**
   * A document whose includes are already expanded. When set, `source` is only
   * carried for the callers that still want it; the render starts here.
   */
  document?: unknown
  /**
   * The extension set to render with. A caller that expanded includes passes
   * the SAME set it parsed with; anyone else omits it and gets a fresh one.
   */
  extensions?: PreviewExtensionSet
}

function engineOptions(render: Omit<PreviewRenderOptions, 'document' | 'extensions'>, set: PreviewExtensionSet): RenderOptions {
  const social = render.mentionUrl || render.tagUrl
    ? { ...(render.mentionUrl ? { mentionUrl: render.mentionUrl } : {}), ...(render.tagUrl ? { tagUrl: render.tagUrl } : {}) }
    : undefined
  return {
    // U-076, U-077: 0.2 escapes raw HTML unless the host opts in. The preview
    // showed it under 0.1 and its webview CSP still blocks unnonced script.
    rawHtml: true,
    extensions: set.extensions,
    renderers: set.renderers,
    ...(social ? { social } : {}),
    ...(render.symbols ? { symbols: render.symbols } : {}),
    ...(render.sourceLine ? { sourceLines: true } : {}),
  }
}

/**
 * The preview body.
 *
 * With `document` set the render starts from a document the caller already
 * expanded, minus the parse it would redo. Either way the tree goes through
 * `decorateLinks` before the render.
 */
export function renderPreviewBody(source: string, options: PreviewRenderOptions = {}): string {
  const { document, extensions: supplied, ...rest } = options
  const set = supplied ?? previewExtensions()
  const tree = document ?? parse(source, { extensions: set.extensions })
  return renderWithDocumentTransforms(decorateLinks(tree) as Parameters<typeof render>[0], set.transforms ?? [], engineOptions(rest, set)).html
}

/**
 * Render to Markdown.
 *
 * No extension set: the extensions decorate an HTML render, and the Markdown
 * export is the engine's own (`toMarkdown`). What lands on disk is what it
 * writes, with no wrapper.
 */
export function renderMarkdown(source: string, document?: unknown): string {
  const tree = document ?? parse(source)
  return toMarkdown(tree as Parameters<typeof toMarkdown>[0]).output
}

/**
 * The preview render with the Tier-1 decorating and claiming features left out - what the
 * spec corpus is measured against.
 */
export function renderConformanceBody(source: string, options: PreviewRenderOptions = {}): string {
  const claiming = new Set<string>(TIER1_CLAIMING_EXTENSIONS as readonly string[])
  const set = extensionSet(PREVIEW_EXTENSIONS.filter((name) => !claiming.has(name)))
  const { document: _document, extensions: _extensions, ...rest } = options
  return renderWithDocumentTransforms(source, set.transforms ?? [], { ...engineOptions(rest, set), rawHtml: false }).html
}

export interface PreviewAssets {
  /** Webview URI for the mermaid UMD bundle. */
  mermaid: string
  /** Webview URI for the Chart.js UMD bundle. */
  chartJs: string
  /** Webview URI for the KaTeX script. */
  katexJs: string
  /** Webview URI for the KaTeX stylesheet. */
  katexCss: string
  /** Webview URI for the KaTeX auto-render contrib script. */
  katexAutoRender: string
  /** Webview URI for the highlight.js script. */
  hljsJs: string
  /** Webview URI for the Carve highlight.js grammar, so `carve` fences highlight. */
  hljsCarveJs: string
  /** Webview URI for the CSV/TSV highlight.js grammar, so `csv` and `tsv` fences highlight. */
  hljsDelimitedJs: string
  /** Webview URI for the highlight.js light theme stylesheet. */
  hljsLightCss: string
  /** Webview URI for the highlight.js dark theme stylesheet. */
  hljsDarkCss: string
  /** Boundary and operator colors for Carve table code. */
  hljsTableCss: string
  /** Carve token colors layered over the highlight.js theme. */
  hljsCarveCss: string
  /** Webview URI for the carve-css token layer. */
  carveTokensCss: string
  /** Webview URI for the carve-css core stylesheet. */
  carveCoreCss: string
  /** Webview URI for the carve-css extensions stylesheet. */
  carveExtensionsCss: string
  /** Webview URI for the carve-css recipes stylesheet. */
  carveRecipesCss: string
}

export interface PreviewOptions {
  nonce: string
  /** The webview's CSP source, used to allow locally bundled assets. */
  cspSource: string
  assets: PreviewAssets
  /** Carve render options (mention/tag URLs, symbol map). */
  render?: PreviewRenderOptions
  /** Maps a relative image source to a webview URI, or undefined to keep it. */
  resolveImageSource?: (relative: string) => string | undefined
}

const IMG_SRC = /(<img\b[^>]*?\ssrc=")([^"]*)(")/g
// A scheme (`https:`, `data:`), a protocol-relative or root path, or a fragment.
const NOT_RELATIVE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|#)/

const decodeAttribute = (value: string): string => value
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const encodeAttribute = (value: string): string => value.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]!)

/**
 * Point every relative `<img src>` at what `resolve` returns. A webview has no
 * document base URL, so a relative source would load from nowhere.
 */
export function rewriteRelativeImageSources(
  html: string,
  resolve: (relative: string) => string | undefined,
): string {
  return html.replace(IMG_SRC, (whole, open: string, value: string, close: string) => {
    const relative = decodeAttribute(value)
    if (!relative || NOT_RELATIVE.test(relative)) return whole
    const resolved = resolve(relative)
    return resolved === undefined ? whole : open + encodeAttribute(resolved) + close
  })
}

export function previewDocument(source: string, options: PreviewOptions): string {
  const rendered = renderPreviewBody(source, { ...options.render, sourceLine: true })
  const body = options.resolveImageSource
    ? rewriteRelativeImageSources(rendered, options.resolveImageSource)
    : rendered
  const { nonce, cspSource, assets } = options
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} https: data:`,
    // Mermaid relies on `new Function` for some layouts, so the rendering
    // sandbox needs 'unsafe-eval'. Content is locally generated, never remote.
    `script-src 'nonce-${nonce}' ${cspSource} 'unsafe-eval'`,
    // Mermaid and KaTeX inject inline <style> blocks and style attributes while
    // rendering. A nonce here would disable 'unsafe-inline' (CSP rule), so rely
    // on 'unsafe-inline' for styles and keep the nonce on scripts only.
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
  ].join('; ')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${assets.katexCss}">
  <link id="hljs-light" rel="stylesheet" href="${assets.hljsLightCss}" disabled>
  <link id="hljs-dark" rel="stylesheet" href="${assets.hljsDarkCss}" disabled>
  <link rel="stylesheet" href="${assets.hljsTableCss}">
  <link rel="stylesheet" href="${assets.hljsCarveCss}">
  <link rel="stylesheet" href="${assets.carveTokensCss}">
  <link rel="stylesheet" href="${assets.carveCoreCss}">
  <link rel="stylesheet" href="${assets.carveExtensionsCss}">
  <link rel="stylesheet" href="${assets.carveRecipesCss}">
  <style nonce="${nonce}">
    /*
     * The preview styles nothing that @markup-carve/carve-css already styles.
     * The four stylesheets above own every construct the engine and its bundled
     * extensions emit - admonitions, tab sets, code groups, figures, footnotes,
     * tables, the lot - and they resolve every color through a --carve-* token.
     *
     * So this block does three things and nothing else:
     *   1. Bind those tokens to the editor's own theme.
     *   2. Lay the page out.
     *   3. Add the handful of constructs carve-css has no opinion about,
     *      because they belong to the preview rather than to the document:
     *      the code tool strip, the task-list states, the scroll-sync anchors.
     *
     * There are no color literals here on purpose, and a test enforces it.
     * A hex in this block is a value that cannot follow the editor theme, which
     * is the whole defect this scaffold used to have.
     */

    /*
     * The token bridge. Every --carve-* color is redefined in terms of the
     * --vscode-* variable that means the same thing, so the document is themed
     * by whatever theme the editor is wearing rather than by carve-css's own
     * neutral palette.
     *
     * This also gets the LIVE switch for free: VS Code rewrites the --vscode-*
     * variables on the root element when the theme changes, so every value
     * below re-resolves without the preview re-rendering. Only the two things
     * that are not CSS - the highlight.js stylesheet and the mermaid theme -
     * need the observer further down.
     *
     * The doubled ':root:root' is deliberate. tokens.css ships its dark palette
     * under ':root:not([data-theme="light"])', which outranks a plain ':root';
     * a light VS Code theme on a dark OS would otherwise get carve-css's dark
     * colors. Doubling the selector matches that specificity, and this block
     * comes after the link tags, so it wins on document order.
     */
    :root:root {
      --carve-surface: var(--vscode-editor-background);
      --carve-sunk: var(--vscode-textCodeBlock-background);
      --carve-raised: var(--vscode-editorWidget-background);

      --carve-ink: var(--vscode-editor-foreground);
      --carve-ink-soft: var(--vscode-descriptionForeground);
      --carve-ink-inverse: var(--vscode-editor-background);

      --carve-rule: var(--vscode-panel-border);
      --carve-border: var(--vscode-panel-border);
      --carve-quote-border: var(--vscode-contrastBorder,
        color-mix(in srgb, var(--vscode-editor-foreground) 50%, var(--vscode-editor-background)));

      --carve-accent: var(--vscode-textLink-foreground);
      --carve-accent-ink: var(--vscode-textLink-activeForeground);
      --carve-accent-soft: color-mix(in srgb, var(--carve-accent) 14%, transparent);

      /*
       * The chart colors are contributed by the theme and a theme may leave
       * them out, so each falls back to a variable VS Code always defines
       * rather than to a literal.
       */
      --carve-info: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
      --carve-success: var(--vscode-charts-green, var(--vscode-testing-iconPassed, var(--vscode-textLink-foreground)));
      --carve-warn: var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground)));
      --carve-danger: var(--vscode-charts-red, var(--vscode-editorError-foreground, var(--vscode-descriptionForeground)));
      --carve-neutral: var(--vscode-charts-lines, var(--vscode-descriptionForeground));

      /*
       * Washes are mixed toward 'transparent' rather than toward a background
       * color, so the same declaration reads correctly on a light ground and a
       * dark one. This is what lets one mapping serve all three theme kinds.
       */
      --carve-info-wash: color-mix(in srgb, var(--carve-info) 12%, transparent);
      --carve-success-wash: color-mix(in srgb, var(--carve-success) 12%, transparent);
      --carve-warn-wash: color-mix(in srgb, var(--carve-warn) 12%, transparent);
      --carve-danger-wash: color-mix(in srgb, var(--carve-danger) 12%, transparent);
      --carve-neutral-wash: color-mix(in srgb, var(--carve-neutral) 12%, transparent);

      --carve-font-body: var(--vscode-font-family);
      --carve-font-heading: var(--vscode-font-family);
      --carve-font-mono: var(--vscode-editor-font-family);
    }

    /*
     * High contrast.
     *
     * The instinct is to strip the tints, and that instinct is wrong here.
     * Measured: collapsing the washes to transparent made tr.ok and tr.warn
     * compute the SAME background, and the same for a toned badge against a
     * plain one - in both constructs the wash is the only signal there is, so
     * removing it does not raise contrast, it deletes the information. And it
     * buys nothing: a 12% mix toward transparent over a black ground is a very
     * dark tint, and the high-contrast foreground sitting on it keeps a ratio
     * far above the threshold.
     *
     * What a high-contrast theme actually asks for is EDGES. So the washes stay
     * exactly as they are and the borders become the theme's own contrast
     * border, which is the color VS Code publishes for precisely this - it is
     * defined only in the high-contrast themes, which is why the fallback is
     * there for the two other kinds.
     */
    body.vscode-high-contrast,
    body.vscode-high-contrast-light {
      --carve-border: var(--vscode-contrastBorder, var(--vscode-panel-border));
      --carve-rule: var(--vscode-contrastBorder, var(--vscode-panel-border));
      --carve-quote-border: var(--vscode-contrastBorder, var(--vscode-editor-foreground));
      --carve-table-boundary: var(--vscode-contrastBorder, var(--vscode-panel-border));
      --carve-table-header: var(--vscode-editor-foreground);
      --carve-table-operator: var(--vscode-editorError-foreground);
      --carve-table-span: var(--vscode-editorInfo-foreground, var(--vscode-editor-foreground));
      --carve-table-continuation: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-editor-foreground));
      --carve-border-width: 1px;
      --carve-accent-width: 4px;
      --carve-quote-border-width: var(--carve-accent-width);
    }

    /* --- Layout ------------------------------------------------------ */

    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    body { margin: 0; padding: 24px; }
    main.carve { max-width: 760px; margin: 0 auto; }
    main.carve > :first-child { margin-top: 0; }
    img { max-width: 100%; height: auto; }

    /*
     * kbd is the one construct in this scaffold that carve-css has no rule for,
     * so it keeps its own - written against the tokens like everything else.
     */
    .carve kbd {
      font-family: var(--carve-font-mono);
      font-size: var(--carve-font-size-small);
      padding: 0 var(--carve-space-1);
      border: var(--carve-border-width) solid var(--carve-border);
      border-bottom-width: 2px;
      border-radius: var(--carve-radius);
      background: var(--carve-sunk);
    }

    /* --- Code fences: the tool strip --------------------------------- */

    /*
     * The strip is a sibling of the <pre>, inside a wrapper, and not a child of
     * it. A <pre> is the horizontal scroll container for its own code, so an
     * absolutely-positioned child of it scrolls away with the text the moment a
     * line is wider than the block - the copy button would slide out of view
     * exactly on the long lines a reader most wants to copy.
     *
     * The strip carries the code surface as its own background for the same
     * family of reason: it floats over the first line, and a long first line
     * would otherwise run underneath the icon.
     */
    .carve .carve-code {
      position: relative;
      margin: var(--carve-space-4) 0;
    }
    .carve .carve-code > pre { margin: 0; }
    .carve .carve-code > .code-tools {
      position: absolute;
      top: var(--carve-space-1);
      right: var(--carve-space-1);
      z-index: 1;
      display: flex;
      align-items: center;
      gap: var(--carve-space-2);
      padding: 0 var(--carve-space-1) 0 var(--carve-space-2);
      border-radius: var(--carve-radius);
      background: var(--carve-sunk);
      /*
       * Findable without hovering. The language was previously readable only
       * while the pointer was over the block, which is why a reader could not
       * tell what a fence held; 0.45 is present enough to find and quiet enough
       * not to compete with the code, and the strip goes solid on hover or on
       * keyboard focus.
       */
      opacity: 0.45;
      transition: opacity 0.12s ease;
    }
    .carve .carve-code:hover > .code-tools,
    .carve .carve-code:focus-within > .code-tools { opacity: 1; }
    .carve .code-lang {
      font-family: var(--carve-font-mono);
      font-size: 0.7em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--carve-ink-soft);
      user-select: none;
      pointer-events: none;
    }
    .carve .code-copy {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px;
      border: 0;
      border-radius: var(--carve-radius);
      background: transparent;
      color: var(--carve-ink-soft);
      font: inherit;
      cursor: pointer;
      transition: color 0.12s ease, background-color 0.12s ease;
    }
    .carve .code-copy > svg {
      display: block;
      width: 14px;
      height: 14px;
    }
    .carve .code-copy:hover {
      color: var(--carve-ink);
      background: var(--carve-surface);
    }
    .carve .code-copy:focus-visible {
      outline: 2px solid var(--carve-accent);
      outline-offset: 1px;
    }
    /*
     * Feedback. The button reports the outcome in place and distinguishes the
     * two outcomes, so a clipboard write that fails is visible rather than
     * silent - which is the one thing worse than having no copy button.
     */
    .carve .code-copy[data-state="ok"] { color: var(--carve-success); }
    .carve .code-copy[data-state="fail"] { color: var(--carve-danger); }

    /* --- Tab sets and code groups ------------------------------------- */

    /*
     * These need no script. The tabs() and codeGroup() extensions emit the
     * CSS-only shape - a hidden radio per tab, a label bound to it, and a panel
     * per tab - so the switching is done by :checked, and it stays keyboard
     * reachable because carve-css clips the radios rather than hiding them.
     *
     * What is needed is a corrected SELECTOR. carve-css 0.1.0 matches a panel
     * with '.tabs-radio:checked + .tabs-label + .tabs-panel', which assumes the
     * document order
     *
     *     radio label panel   radio label panel
     *
     * The engine pinned here (@markup-carve/carve 0.1.5) emits all the controls
     * first and then all the panels:
     *
     *     radio label   radio label   panel panel
     *
     * so that adjacent-sibling chain matches nothing and EVERY panel keeps the
     * 'display: none' the same file sets. Measured in the headless probe: with
     * carve-css alone, both tab panels and both code-group panels computed
     * 'display: none' in all three themes - the tab set rendered as two labels
     * above nothing at all.
     *
     * Pairing the Nth radio with the Nth panel by type does match the shape the
     * engine actually emits. The radios are the only <input> children and the
     * panels the only <div> children, so :nth-of-type counts exactly them.
     *
     * This is an upstream mismatch between carve-css 0.1.0 and engine 0.1.5,
     * not a preview concern; when carve-css takes a fix these rules become
     * redundant and can go. Nine tabs is well past any real tab set, and the
     * tenth degrades to the pre-existing behavior rather than breaking.
     */
    /*
     * First, neutralize the upstream rule. It is not merely inert against this
     * document order - it is actively wrong: with
     *
     *     radio1 label1 radio2 label2 panel1 panel2
     *
     * the chain 'checked radio + its label + the next panel' matches
     * radio2 + label2 + PANEL1, so checking the second tab reveals the FIRST
     * tab's panel. Measured: clicking tab 2 left both panels displayed, because
     * the correct rule below lit panel 2 while this one still lit panel 1.
     *
     * Specificity, not order, decides this: the upstream selector counts six
     * class-level components, so it is spelled out here with its elements named
     * to outrank it, and the pairing rules below outrank this in turn.
     */
    .carve .tabs > input.tabs-radio:checked + label.tabs-label + div.tabs-panel,
    .carve .code-group > input.code-group-radio:checked + label.code-group-label + div.code-group-panel {
      display: none;
    }

    .carve .tabs > input.tabs-radio:nth-of-type(1):checked ~ div.tabs-panel:nth-of-type(1),
    .carve .tabs > input.tabs-radio:nth-of-type(2):checked ~ div.tabs-panel:nth-of-type(2),
    .carve .tabs > input.tabs-radio:nth-of-type(3):checked ~ div.tabs-panel:nth-of-type(3),
    .carve .tabs > input.tabs-radio:nth-of-type(4):checked ~ div.tabs-panel:nth-of-type(4),
    .carve .tabs > input.tabs-radio:nth-of-type(5):checked ~ div.tabs-panel:nth-of-type(5),
    .carve .tabs > input.tabs-radio:nth-of-type(6):checked ~ div.tabs-panel:nth-of-type(6),
    .carve .tabs > input.tabs-radio:nth-of-type(7):checked ~ div.tabs-panel:nth-of-type(7),
    .carve .tabs > input.tabs-radio:nth-of-type(8):checked ~ div.tabs-panel:nth-of-type(8),
    .carve .tabs > input.tabs-radio:nth-of-type(9):checked ~ div.tabs-panel:nth-of-type(9),
    .carve .code-group > input.code-group-radio:nth-of-type(1):checked ~ div.code-group-panel:nth-of-type(1),
    .carve .code-group > input.code-group-radio:nth-of-type(2):checked ~ div.code-group-panel:nth-of-type(2),
    .carve .code-group > input.code-group-radio:nth-of-type(3):checked ~ div.code-group-panel:nth-of-type(3),
    .carve .code-group > input.code-group-radio:nth-of-type(4):checked ~ div.code-group-panel:nth-of-type(4),
    .carve .code-group > input.code-group-radio:nth-of-type(5):checked ~ div.code-group-panel:nth-of-type(5),
    .carve .code-group > input.code-group-radio:nth-of-type(6):checked ~ div.code-group-panel:nth-of-type(6),
    .carve .code-group > input.code-group-radio:nth-of-type(7):checked ~ div.code-group-panel:nth-of-type(7),
    .carve .code-group > input.code-group-radio:nth-of-type(8):checked ~ div.code-group-panel:nth-of-type(8),
    .carve .code-group > input.code-group-radio:nth-of-type(9):checked ~ div.code-group-panel:nth-of-type(9) {
      display: block;
    }

    /* Keep the tick legible when the VS Code theme differs from the OS theme. */
    body.vscode-light,
    body.vscode-high-contrast-light {
      --carve-task-check-icon: url("data:image/svg+xml,%3Csvg xmlns='http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' d='M3 7l3 3 7-7'/%3E%3C/svg%3E");
    }
    body.vscode-dark,
    body.vscode-high-contrast {
      --carve-task-check-icon: url("data:image/svg+xml,%3Csvg xmlns='http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%2314171b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' d='M3 7l3 3 7-7'/%3E%3C/svg%3E");
    }
    /* The box carries task state; labels and nested open tasks stay readable. */
    .carve li[data-task-state="x"],
    .carve li[data-task-state="-"] {
      color: var(--carve-ink);
      text-decoration: none;
    }

    /* --- Scroll sync -------------------------------------------------- */

    [data-source-line] { scroll-margin-top: 8px; }
    .carve-active { position: relative; }
    .carve-active::before {
      content: "";
      position: absolute;
      left: -16px;
      top: 0;
      bottom: 0;
      width: var(--carve-accent-width);
      border-radius: 2px;
      background: var(--vscode-editorCursor-foreground, var(--carve-accent));
    }
    /* The {.diff} presentation on a language fence. Core emits
     * pre.diff > code.language-x; highlightCode() keeps the language
     * highlighting and marks the leading +/-/space, matching the classes
     * carve-grammars' Shiki transformer produces. */
    .carve pre.diff.has-diff {
      --carve-diff-add-bg: var(--vscode-diffEditor-insertedLineBackground, var(--vscode-diffEditor-insertedTextBackground));
      --carve-diff-add-marker: var(--vscode-gitDecoration-addedResourceForeground);
      --carve-diff-remove-bg: var(--vscode-diffEditor-removedLineBackground, var(--vscode-diffEditor-removedTextBackground));
      --carve-diff-remove-marker: var(--vscode-gitDecoration-deletedResourceForeground);
    }
    .carve pre.diff.has-diff code { display: block; }
    .carve pre.diff.has-diff .line { display: inline-block; width: 100%; }
    .carve pre.diff.has-diff .line.diff.add { background: var(--carve-diff-add-bg); }
    .carve pre.diff.has-diff .line.diff.remove { background: var(--carve-diff-remove-bg); }
    .carve pre.diff.has-diff .diff-marker { display: inline-block; width: 1ch; user-select: none; }
    .carve pre.diff.has-diff .line.diff.add .diff-marker { color: var(--carve-diff-add-marker); }
    .carve pre.diff.has-diff .line.diff.remove .diff-marker { color: var(--carve-diff-remove-marker); }
    .carve pre.diff.has-diff .line:not(.diff) .diff-marker { color: var(--carve-ink-soft); }
  </style>
  <title>Carve Preview</title>
</head>
<body>
  <main class="carve">${body}</main>
  <script nonce="${nonce}" src="${assets.hljsJs}"></script>
  <script nonce="${nonce}" src="${assets.hljsCarveJs}"></script>
  <script nonce="${nonce}" src="${assets.hljsDelimitedJs}"></script>
  <script nonce="${nonce}" src="${assets.katexJs}"></script>
  <script nonce="${nonce}" src="${assets.katexAutoRender}"></script>
  <script nonce="${nonce}" src="${assets.mermaid}"></script>
  <script nonce="${nonce}" src="${assets.chartJs}"></script>
  <script nonce="${nonce}">
    (function () {
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined
      const isDark = () => document.body.classList.contains('vscode-dark')
        || document.body.classList.contains('vscode-high-contrast')

      function applyHljsTheme() {
        document.documentElement.setAttribute('data-theme', isDark() ? 'dark' : 'light')
        const light = document.getElementById('hljs-light')
        const dark = document.getElementById('hljs-dark')
        if (light) light.disabled = isDark()
        if (dark) dark.disabled = !isDark()
      }

      function renderMermaid() {
        if (typeof mermaid === 'undefined') return
        // The mermaid() extension emits <pre class="mermaid">…</pre>; the plain
        // code fence fallback is <pre><code class="language-mermaid">…</code></pre>.
        // Normalize both into a <div class="mermaid"> that mermaid.run() drives.
        document.querySelectorAll('pre.mermaid, pre > code.language-mermaid').forEach((node) => {
          const pre = node.tagName === 'PRE' ? node : node.parentElement
          const div = document.createElement('div')
          div.className = 'mermaid'
          // Carry the source-line anchor over so scroll sync and caret
          // highlight still map to the diagram block.
          const sourceLine = pre.getAttribute('data-source-line')
          if (sourceLine) div.setAttribute('data-source-line', sourceLine)
          div.textContent = node.textContent || ''
          // Kept so a theme switch can redraw the diagram: mermaid consumes
          // this element's content when it renders.
          div.setAttribute('data-mermaid-src', div.textContent)
          pre.replaceWith(div)
        })
        try {
          mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: isDark() ? 'dark' : 'default' })
          const nodes = document.querySelectorAll('div.mermaid:not([data-processed])')
          if (nodes.length) mermaid.run({ nodes })
        } catch (err) {
          console.error('mermaid render failed', err)
        }
      }

      // Feather-shaped inline SVG. 'stroke="currentColor"' is what lets the
      // three button states color themselves from the tokens.
      const ICONS = {
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
        ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      }

      // --- Clipboard ---------------------------------------------------
      // Three routes, host first.
      //
      // 'navigator.clipboard.writeText' is NOT reliable here: a webview runs in
      // an iframe, and the async clipboard API is gated behind the
      // 'clipboard-write' permission policy, which the frame is not granted. It
      // rejects rather than throwing synchronously, so a button wired only to
      // it fails silently - which is the failure mode this whole strip exists
      // to avoid.
      //
      // The extension host has no such restriction: 'vscode.env.clipboard' is a
      // first-class API. So the preview asks the host, and only falls back to
      // the browser routes when there is no host - which is what happens in the
      // exported HTML, where the same code runs in a plain browser tab.
      let copySeq = 0
      const copyWaiting = new Map()

      function copyViaHost(text) {
        if (!vscode) return Promise.resolve(false)
        return new Promise((resolve) => {
          const id = ++copySeq
          // Keyed by request id, not a single global slot: two quick clicks
          // must not answer each other's callback.
          copyWaiting.set(id, resolve)
          vscode.postMessage({ type: 'copy', id, text })
          // A round trip through the host. If it never answers, settle false so
          // the button reports something rather than staying blank forever.
          setTimeout(() => {
            if (copyWaiting.has(id)) {
              copyWaiting.delete(id)
              resolve(false)
            }
          }, 1500)
        })
      }

      function copyViaExecCommand(text) {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        document.body.appendChild(area)
        let ok = false
        try {
          area.select()
          ok = document.execCommand('copy')
        } catch (err) {
          ok = false
        }
        document.body.removeChild(area)
        return ok
      }

      function copyText(text) {
        return copyViaHost(text).then((ok) => {
          if (ok) return true
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text)
              .then(() => true)
              .catch(() => copyViaExecCommand(text))
          }
          return copyViaExecCommand(text)
        })
      }

      const flashTimers = new WeakMap()

      function flash(button, state, label) {
        button.dataset.state = state
        button.innerHTML = ICONS[state]
        button.title = label
        button.setAttribute('aria-label', label)
        clearTimeout(flashTimers.get(button))
        flashTimers.set(button, setTimeout(() => {
          delete button.dataset.state
          button.innerHTML = ICONS.copy
          button.title = 'Copy code'
          button.setAttribute('aria-label', 'Copy code to the clipboard')
        }, 1400))
      }

      function copyButton(code) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'code-copy'
        button.innerHTML = ICONS.copy
        button.title = 'Copy code'
        button.setAttribute('aria-label', 'Copy code to the clipboard')
        button.addEventListener('click', () => {
          // The <code> element's text, never the wrapper's: the wrapper also
          // holds the badge and this button, and both would be copied.
          copyText(code.textContent || '').then((ok) => {
            flash(button, ok ? 'ok' : 'fail', ok ? 'Copied' : 'Copy failed')
          })
        })
        return button
      }

      // Wrap each code block and give it a tool strip carrying the language
      // badge and the copy button. Both are visible at rest; the language used
      // to appear only on hover, so a reader could not tell what a fence held.
      function decorateCodeBlocks() {
        document.querySelectorAll('pre > code').forEach((code) => {
          const pre = code.parentElement
          if (!pre || !pre.parentNode) return
          if (pre.parentElement && pre.parentElement.classList.contains('carve-code')) return
          const cls = [...code.classList].find((c) => c.indexOf('language-') === 0)
          const lang = cls ? cls.slice('language-'.length) : ''
          // A mermaid fence is replaced by its diagram; there is nothing to
          // label and nothing a reader would want on the clipboard.
          if (lang === 'mermaid') return

          const wrap = document.createElement('div')
          wrap.className = 'carve-code'
          if (lang) wrap.dataset.lang = lang
          pre.parentNode.insertBefore(wrap, pre)

          const tools = document.createElement('div')
          tools.className = 'code-tools'
          if (lang) {
            const badge = document.createElement('span')
            badge.className = 'code-lang'
            badge.textContent = lang
            tools.appendChild(badge)
          }
          tools.appendChild(copyButton(code))
          wrap.appendChild(tools)
          wrap.appendChild(pre)
        })
      }

      // Chart.js: the chart() extension emits <div class="chart"> wrapping a
      // <script type="application/json"> config. Swap in a <canvas> per block.
      function renderCharts() {
        if (typeof Chart === 'undefined') return
        document.querySelectorAll('div.chart').forEach((el) => {
          if (el.dataset.chartDone) return
          const json = el.querySelector('script[type="application/json"]')
          if (!json) return
          let config
          try {
            config = JSON.parse(json.textContent || '')
          } catch (err) {
            console.error('chart config parse failed', err)
            return
          }
          const canvas = document.createElement('canvas')
          el.textContent = ''
          el.appendChild(canvas)
          el.dataset.chartDone = '1'
          try {
            new Chart(canvas, config)
          } catch (err) {
            console.error('chart render failed', err)
          }
        })
      }

      function escapeHtml(s) {
        return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
      }
      // The {.diff} presentation on a language fence: core emits a pre.diff
      // with a code.language-x whose lines keep their leading +/-/space as
      // plain text. Keep the language highlighting but present those markers,
      // the way carve-grammars' Shiki transformer does (same classes). hljs has
      // no line model, so tokenize each line after stripping its marker.
      function renderLanguageDiff(code, pre) {
        const cls = [...code.classList].find((c) => c.indexOf('language-') === 0)
        const lang = cls ? cls.slice('language-'.length) : ''
        const canHl = lang && typeof hljs.getLanguage === 'function' && hljs.getLanguage(lang)
        const text = code.textContent.replace(/\\n$/, '')
        code.innerHTML = text.split('\\n').map((line) => {
          const marker = /^[-+ ]/.test(line) ? line[0] : ''
          const body = marker ? line.slice(1) : line
          let inner
          try { inner = canHl ? hljs.highlight(body, { language: lang }).value : escapeHtml(body) }
          catch (err) { inner = escapeHtml(body) }
          const lineCls = marker === '+' ? 'line diff add' : marker === '-' ? 'line diff remove' : 'line'
          const markerSpan = marker ? '<span class="diff-marker">' + escapeHtml(marker) + '</span>' : ''
          return '<span class="' + lineCls + '">' + markerSpan + inner + '</span>'
        }).join('\\n')
        pre.classList.add('has-diff')
      }
      function highlightCode() {
        if (typeof hljs === 'undefined') return
        document.querySelectorAll('pre code:not(.language-mermaid)').forEach((el) => {
          const pre = el.parentElement
          if (pre && (pre.classList.contains('diff') || (pre.parentElement?.tagName === 'FIGURE' && pre.parentElement.classList.contains('diff')))) {
            pre.classList.add('diff')
            try { renderLanguageDiff(el, pre) } catch (err) { console.error('diff render failed', err) }
            return
          }
          try { hljs.highlightElement(el) } catch (err) { console.error('hljs failed', err) }
        })
      }

      function renderMath() {
        if (typeof renderMathInElement !== 'function') return
        renderMathInElement(document.body, {
          delimiters: [
            { left: '\\\\(', right: '\\\\)', display: false },
            { left: '\\\\[', right: '\\\\]', display: true },
          ],
          throwOnError: false,
        })
      }

      function render() {
        applyHljsTheme()
        renderMath()
        highlightCode()
        decorateCodeBlocks()
        renderMermaid()
        renderCharts()
      }

      // --- Live theme switch -------------------------------------------
      //
      // Every COLOR follows the editor on its own: the scaffold binds each
      // --carve-* token to a --vscode-* variable, and VS Code rewrites those
      // variables in place on the root element when the theme changes, so the
      // whole document re-resolves with no work here.
      //
      // Two things are not CSS and do not get that for free:
      //   - the highlight.js theme, which is a pair of stylesheets where one is
      //     disabled;
      //   - mermaid, which bakes its palette into the SVG it emits, so a
      //     switched theme needs the diagram drawn again.
      //
      // VS Code signals the change by swapping the class on <body>, so observe
      // that. Without this the preview kept the old code colors and the old
      // diagram colors until it happened to re-render for another reason.
      let themeWasDark = isDark()

      function onThemeChanged() {
        if (isDark() === themeWasDark) return
        themeWasDark = isDark()
        applyHljsTheme()
        // Mermaid consumed the source <pre> when it rendered, so re-running it
        // over the existing <div class="mermaid"> nodes needs their source back.
        document.querySelectorAll('div.mermaid[data-mermaid-src]').forEach((el) => {
          el.removeAttribute('data-processed')
          el.innerHTML = ''
          el.textContent = el.getAttribute('data-mermaid-src') || ''
        })
        renderMermaid()
      }

      new MutationObserver(onThemeChanged)
        .observe(document.body, { attributes: true, attributeFilter: ['class'] })

      // --- Scroll sync (line-anchored) ---
      // Each top-level block carries data-source-line (1-based). We map
      // between editor lines and document offsets by interpolating between
      // the nearest anchored blocks.
      let suppressScroll = false
      let suppressTimer

      function anchors() {
        return [...document.querySelectorAll('[data-source-line]')]
          .map((el) => ({
            el,
            line: Number(el.getAttribute('data-source-line')),
            top: el.getBoundingClientRect().top + window.scrollY,
          }))
          .filter((a) => Number.isFinite(a.line))
          .sort((a, b) => a.line - b.line)
      }

      function segmentFor(list, predicate) {
        let i = 0
        while (i + 1 < list.length && predicate(list[i + 1])) i++
        return i
      }

      function scrollToLine(line) {
        const a = anchors()
        if (!a.length) return
        const i = segmentFor(a, (next) => next.line <= line)
        const cur = a[i]
        const next = a[i + 1]
        let top = cur.top
        if (next && next.line > cur.line) {
          const frac = Math.min(1, Math.max(0, (line - cur.line) / (next.line - cur.line)))
          top = cur.top + (next.top - cur.top) * frac
        }
        // A programmatic scroll fires its scroll event after this frame, so
        // clearing on rAF let the echo through and closed the sync loop.
        suppressScroll = true
        clearTimeout(suppressTimer)
        window.scrollTo({ top })
        suppressTimer = setTimeout(() => { suppressScroll = false }, 150)
      }

      function highlightLine(line) {
        const a = anchors()
        document.querySelectorAll('.carve-active').forEach((e) => e.classList.remove('carve-active'))
        if (!a.length) return
        const i = segmentFor(a, (next) => next.line <= line)
        a[i].el.classList.add('carve-active')
      }

      window.addEventListener('scroll', () => {
        if (suppressScroll || !vscode) return
        const a = anchors()
        if (!a.length) return
        const y = window.scrollY
        const i = segmentFor(a, (next) => next.top <= y)
        let line = a[i].line
        const next = a[i + 1]
        if (next && next.top > a[i].top) {
          const frac = Math.min(1, Math.max(0, (y - a[i].top) / (next.top - a[i].top)))
          line = Math.round(a[i].line + (next.line - a[i].line) * frac)
        }
        vscode.postMessage({ type: 'reveal', line })
      }, { passive: true })

      window.addEventListener('message', (event) => {
        const message = event.data
        if (!message) return
        if (message.type === 'scrollToLine') scrollToLine(message.line)
        else if (message.type === 'highlightLine') highlightLine(message.line)
        else if (message.type === 'print') window.print()
        else if (message.type === 'copied') {
          const resolve = copyWaiting.get(message.id)
          if (resolve) {
            copyWaiting.delete(message.id)
            resolve(message.ok === true)
          }
        }
      })

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render)
      } else {
        render()
      }
    })()
  </script>
</body>
</html>`
}

/** Pinned CDN versions for the self-contained HTML export. */
const CDN = {
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js',
  chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  katexJs: 'https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.js',
  katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css',
  katexAutoRender: 'https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/contrib/auto-render.min.js',
  hljsJs: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js',
  hljsCarveJs: 'https://cdn.jsdelivr.net/gh/markup-carve/carve-grammars@6621ad19/highlightjs/carve.js',
  hljsDelimitedJs: 'https://cdn.jsdelivr.net/gh/markup-carve/carve-grammars@6621ad19/highlightjs/delimited.js',
  hljsLightCss: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/github.min.css',
  hljsDarkCss: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/github-dark.min.css',
  hljsTableCss: 'https://cdn.jsdelivr.net/gh/markup-carve/carve-grammars@6621ad19/shiki/table-tokens.css',
  hljsCarveCss: 'https://cdn.jsdelivr.net/gh/markup-carve/carve-grammars@6621ad19/themes/carve-code.css',
} as const

export interface ExportOptions {
  /** Document title (defaults to "Carve document"). */
  title?: string
  render?: PreviewRenderOptions
}

/**
 * Render a Carve document to a self-contained HTML file that works in any
 * browser. Mermaid, KaTeX, and highlight.js load from a CDN (so the file needs
 * network access to render diagrams/math/highlighting), and theming follows the
 * reader's `prefers-color-scheme`.
 */
export function exportHtmlDocument(source: string, options: ExportOptions = {}): string {
  const body = renderPreviewBody(source, { ...options.render })
  const title = escapeHtmlText(options.title ?? 'Carve document')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${CDN.katexCss}">
  <link rel="stylesheet" href="${CDN.hljsLightCss}" media="(prefers-color-scheme: light)">
  <link rel="stylesheet" href="${CDN.hljsDarkCss}" media="(prefers-color-scheme: dark)">
  <link rel="stylesheet" href="${CDN.hljsTableCss}">
  <link rel="stylesheet" href="${CDN.hljsCarveCss}">
  <style>
    :root { color-scheme: light dark; --quote-padding: 1rem; --quote-border-width: 3px; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --carve-syntax-definition: #d2a8ff;
        --carve-syntax-list: #f2cc60;
        --carve-syntax-task: #3fb950;
        --carve-syntax-language: #79c0ff;
        --carve-syntax-muted: #8b949e;
        --carve-table-boundary: #6a737d;
        --carve-table-header: #79b8ff;
        --carve-table-operator: #ffab70;
        --carve-table-span: #b392f0;
        --carve-table-continuation: #85e89d;
      }
    }
    html { font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    body { margin: 0; padding: 24px; line-height: 1.55; }
    main { max-width: 760px; margin: 0 auto; }
    pre { overflow-x: auto; padding: 12px; border-radius: 6px; background: rgba(127,127,127,0.12); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .mermaid { background: transparent; text-align: center; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid rgba(127,127,127,0.4); padding: 5px 10px; }
    thead th { background: rgba(127,127,127,0.12); }
    tbody tr:nth-child(even) { background: rgba(127,127,127,0.06); }
    blockquote {
      margin: 1rem 0;
      padding-block: .25rem;
      padding-inline-start: var(--quote-padding);
      border-inline-start: var(--quote-border-width) solid color-mix(in srgb, currentColor 50%, transparent);
      color: inherit;
    }
    blockquote > p { margin-block: 0 .75rem; }
    blockquote > :first-child { margin-block-start: 0; }
    blockquote > :last-child { margin-block-end: 0; }
    figure:has(> blockquote) { margin-inline: 0; text-align: start; }
    figure > blockquote { margin-block-end: 0; }
    figure:has(> blockquote) > figcaption {
      margin-block-start: .5rem;
      padding-inline-start: calc(var(--quote-padding) + var(--quote-border-width));
      font-size: .875em;
      color: color-mix(in srgb, currentColor 75%, transparent);
    }
    @media (forced-colors: active) { blockquote { border-color: CanvasText; } }
    h1, h2 { border-bottom: 1px solid rgba(127,127,127,0.3); padding-bottom: 0.2em; }
    img { max-width: 100%; height: auto; }
    :not(pre) > code { padding: 0.1em 0.35em; border-radius: 4px; background: rgba(127,127,127,0.12); }
    .math.display { display: block; overflow-x: auto; text-align: center; margin: 1em 0; }
    table { display: block; max-width: 100%; overflow-x: auto; }
    li:has(> input[type="checkbox"]) { list-style: none; }
    li > input[type="checkbox"] { margin: 0 0.5em 0 -1.4em; vertical-align: middle; }
    pre[data-lang] { position: relative; }
    pre[data-lang] > .code-lang { position: absolute; top: 6px; right: 8px; font-family: ui-monospace, monospace; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0; transition: opacity 0.15s; color: rgba(127,127,127,0.9); pointer-events: none; }
    pre[data-lang]:hover > .code-lang { opacity: 0.85; }
    details { margin: 1em 0; padding: 8px 14px; border: 1px solid rgba(127,127,127,0.4); border-radius: 6px; background: rgba(127,127,127,0.04); }
    details > summary { cursor: pointer; font-weight: 600; }
    details[open] > summary { margin-bottom: 0.5em; }
    details.spoiler { border-style: dashed; }
    .spoiler:not(details) { background: rgba(127,127,127,0.2); border-radius: 3px; filter: blur(4px); transition: filter 0.12s; cursor: help; }
    .spoiler:not(details):hover, .spoiler:not(details):focus-within { filter: none; }
    .chart { margin: 1em 0; max-width: 100%; }
    .chart > canvas { max-width: 100%; }
    mark { background: rgba(234,179,8,0.4); color: inherit; }
    ins { text-decoration: none; background: color-mix(in srgb, #3fb950 22%, transparent); }
    del { background: color-mix(in srgb, #f85149 22%, transparent); }
    dl dt { font-weight: 600; margin-top: 0.6em; }
    dl dd { margin: 0 0 0 1.5em; }
    .mention, .tag { text-decoration: none; padding: 0 0.35em; border-radius: 999px; font-weight: 500; }
    .mention, .mention strong { color: #3b82f6; }
    .mention { background: color-mix(in srgb, #3b82f6 14%, transparent); }
    .tag, .tag strong { color: #a371f7; }
    .tag { background: color-mix(in srgb, #a371f7 14%, transparent); }
    .admonition {
      --admonition-accent: #4a9eff;
      margin: 1em 0; padding: 12px 16px;
      border-left: 4px solid var(--admonition-accent); border-radius: 4px;
      background: color-mix(in srgb, var(--admonition-accent) 9%, transparent);
    }
    .admonition > .admonition-title { margin: 0 0 0.5em; font-weight: 600; text-transform: capitalize; color: var(--admonition-accent); }
    .admonition > :last-child { margin-bottom: 0; }
    .admonition.note, .admonition.info { --admonition-accent: #4a9eff; }
    .admonition.tip, .admonition.success { --admonition-accent: #3fb950; }
    .admonition.warning { --admonition-accent: #d29922; }
    .admonition.danger { --admonition-accent: #f85149; }
    .admonition.example { --admonition-accent: #a371f7; }
    .admonition.quote { --admonition-accent: #8b949e; }
    @media print { body { padding: 0; } a { color: inherit; } }
  </style>
  <title>${title}</title>
</head>
<body>
  <main>${body}</main>
  <script src="${CDN.hljsJs}"></script>
  <script src="${CDN.hljsCarveJs}"></script>
  <script src="${CDN.hljsDelimitedJs}"></script>
  <script src="${CDN.katexJs}"></script>
  <script src="${CDN.katexAutoRender}"></script>
  <script src="${CDN.mermaid}"></script>
  <script src="${CDN.chartJs}"></script>
  <script>
    (function () {
      const colorScheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
      const dark = !!colorScheme?.matches
      const setTheme = () => document.documentElement.setAttribute('data-theme', colorScheme?.matches ? 'dark' : 'light')
      setTheme()
      colorScheme?.addEventListener('change', setTheme)
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(document.body, {
          delimiters: [
            { left: '\\\\(', right: '\\\\)', display: false },
            { left: '\\\\[', right: '\\\\]', display: true },
          ],
          throwOnError: false,
        })
      }
      if (typeof mermaid !== 'undefined') {
        document.querySelectorAll('pre.mermaid, pre > code.language-mermaid').forEach((node) => {
          const pre = node.tagName === 'PRE' ? node : node.parentElement
          const div = document.createElement('div')
          div.className = 'mermaid'
          // Carry the source-line anchor over so scroll sync and caret
          // highlight still map to the diagram block.
          const sourceLine = pre.getAttribute('data-source-line')
          if (sourceLine) div.setAttribute('data-source-line', sourceLine)
          div.textContent = node.textContent || ''
          pre.replaceWith(div)
        })
        try {
          mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: dark ? 'dark' : 'default' })
          const nodes = document.querySelectorAll('div.mermaid')
          if (nodes.length) mermaid.run({ nodes })
        } catch (err) { console.error(err) }
      }
      if (typeof hljs !== 'undefined') {
        document.querySelectorAll('pre code:not(.language-mermaid)').forEach((el) => {
          try { hljs.highlightElement(el) } catch (err) { console.error(err) }
        })
      }
      document.querySelectorAll('pre > code[class*="language-"]').forEach((code) => {
        const pre = code.parentElement
        if (!pre || pre.querySelector('.code-lang')) return
        const cls = [...code.classList].find((c) => c.indexOf('language-') === 0)
        const lang = cls ? cls.slice('language-'.length) : ''
        if (!lang || lang === 'mermaid') return
        pre.setAttribute('data-lang', lang)
        const label = document.createElement('span')
        label.className = 'code-lang'
        label.textContent = lang
        pre.appendChild(label)
      })
      if (typeof Chart !== 'undefined') {
        document.querySelectorAll('div.chart').forEach((el) => {
          const json = el.querySelector('script[type="application/json"]')
          if (!json) return
          let config
          try { config = JSON.parse(json.textContent || '') } catch (err) { console.error(err); return }
          const canvas = document.createElement('canvas')
          el.textContent = ''
          el.appendChild(canvas)
          try { new Chart(canvas, config) } catch (err) { console.error(err) }
        })
      }
    })()
  </script>
</body>
</html>`
}

function escapeHtmlText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}
