import {
  autolink,
  carveToHtml,
  carveToMarkdown,
  type CarveExtension,
  chart,
  citations,
  codeGroup,
  details,
  externalLinks,
  listTable,
  mathBlock,
  mermaid,
  spoiler,
  tabs,
  wikilinks,
} from '@markup-carve/carve'

/**
 * The extensions the preview enables.
 *
 * Without these, `:::details`/`:::spoiler`/`:::tabs` degrade to inert `<div>`s,
 * math stays literal, and mermaid/chart fences never hydrate. Constructed fresh
 * per render so no cross-document state leaks.
 *
 * The reference set is the docs playground, whose list lives in
 * `docs/.vitepress/carve-extensions.js` in markup-carve/carve. That file is in
 * another repository and the pinned engine package does not export the list, so
 * there is no honest way to read it from here - `presets` is the fenced-diagram
 * renderers, not this. The set is therefore pinned locally and reconciled by
 * hand, and `PREVIEW_EXTENSIONS`/`EXCLUDED_EXTENSIONS` below turn the parts that
 * CAN be checked locally into a test: that every extension factory the pinned
 * engine exports is classified one way or the other.
 *
 * `citations` is the one that mattered most. It changes the PARSE rather than
 * the render: without it `[@key]` produces no citation node at all, so
 * `citation`, `citation_group` and `citation_definition` were unreachable in
 * this preview while they worked in the docs playground. The other three
 * degraded quietly - the nodes existed and only the rendering differed.
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
  'citations',
  'wikilinks',
  'autolink',
  'externalLinks',
] as const

/**
 * Every extension factory the pinned engine exports that the preview
 * deliberately does NOT enable, each with the reason it stays off.
 *
 * This is what stops the drift. The list the preview should match is in another
 * repo, but the thing that actually causes drift is local and checkable: a new
 * extension lands in the engine and nobody decides about it. The guard in
 * `extension.test.ts` fails until a new factory is named in one list or the
 * other, so the decision has to be made rather than defaulted.
 */
export const EXCLUDED_EXTENSIONS: Record<string, string> = {
  // A DECISION, not a gap. The docs playground enables headingPermalinks; this
  // preview will not. The maintainer found the paragraph anchors noisy in the
  // IntelliJ preview, where they are now hover-only, and an editor preview is
  // not a page anyone deep-links into - the reader is looking at their own
  // document, with the source beside it. Do not "fix" this divergence by
  // adding it back.
  headingPermalinks: 'DECISION: the paragraph anchors are noise in an editor preview, which nobody deep-links into',

  // Auto-injects a list that pushes the author's own first block down the page.
  tableOfContents: 'auto-injects a TOC that displaces the document being edited',

  // Need configuration, or have no visible effect zero-config. A preview gets
  // no per-document configuration, so these would be inert.
  defaultAttributes: 'needs per-document default-attribute config',
  headingLevelShift: 'needs a shift-amount option',
  headingReference: 'needs config / overlaps core cross-references',
  headingNumbers: 'needs section-numbering config / overlaps core heading numbering',
  tabNormalize: 'invisible whitespace transform, nothing to show',
  glossary: 'needs a ::: glossary block plus :term[] uses, nothing to show zero-config',
  index: 'needs :index[] markers plus a ::: index block, nothing to show zero-config',
  tocPlacement: 'needs a ::: toc block, nothing to show zero-config',
  colorSwatch: 'needs :color[] markers, nothing to show zero-config',
  codeCallouts: 'needs <n> markers plus a bound list, nothing to show zero-config',
  imgFence: 'needs an img fence with an SVG body to show anything zero-config',
  semanticSpan: 'consumes samp/var/cite/dfn, contradicting the corpus-pinned HTML for the core semantic-name examples',

  // Fenced-diagram presets whose client library the preview does not bundle.
  // Only mermaid and chart are wired up in media/.
  d2: 'needs the D2 client library, not bundled',
  graphviz: 'needs a Graphviz/Viz.js client library, not bundled',
  plantuml: 'needs the PlantUML client library, not bundled',
  wavedrom: 'needs the WaveDrom client library, not bundled',
  abc: 'needs the abcjs client library, not bundled',
  vegaLite: 'needs the Vega-Lite client library, not bundled',
}

/** Factory per enabled name, so the guard can check the list drives the render. */
const EXTENSION_FACTORIES: Record<string, () => CarveExtension> = {
  details,
  spoiler,
  mermaid,
  mathBlock,
  tabs,
  codeGroup,
  listTable,
  chart,
  citations,
  wikilinks,
  autolink,
  externalLinks,
}

/**
 * The enabled extensions that deliberately change the HTML of a TIER-1
 * construct, rather than adding one of their own.
 *
 * Both decorate ordinary links, which the spec corpus pins byte-for-byte:
 * `externalLinks` adds `target`/`rel` to an off-site link, and `autolink` turns
 * a bare URL into one. Measured against the 1538-document corpus: with the rest
 * of the preview set enabled, externalLinks changes 20 documents and autolink
 * changes 10, and the other ten extensions change none.
 *
 * That divergence is wanted in a preview and unwanted in a conformance
 * measurement, so the two renders are separated rather than the corpus being
 * given a waiver list. `renderConformanceBody` is what the corpus tool measures;
 * `renderPreviewBody` is what a reader sees.
 *
 * The separation is also the guard. Any future extension that changes Tier-1
 * output makes the corpus fail until it is named here - which means saying, in
 * writing, that the change is intended. A waiver list per document could not
 * tell "we meant this" from "the engine regressed".
 */
export const TIER1_DECORATING_EXTENSIONS = ['autolink', 'externalLinks'] as const

function previewExtensions() {
  return PREVIEW_EXTENSIONS.map((name) => EXTENSION_FACTORIES[name]())
}

export interface PreviewRenderOptions {
  /** URL template for `@mention` links; `{name}` is replaced. */
  mentionUrl?: string
  /** URL template for `#tag` links; `{name}` is replaced. */
  tagUrl?: string
  /** Emoji shortcode -> glyph map for `:name:`. */
  emoji?: Record<string, string>
  /** Stamp blocks with `data-source-line` for scroll sync. */
  sourceLine?: boolean
}

export function renderPreviewBody(source: string, render: PreviewRenderOptions = {}): string {
  return carveToHtml(source, { ...render, extensions: previewExtensions() })
}

/**
 * Render to Markdown.
 *
 * No extension set: the extensions decorate an HTML render, and the Markdown
 * target is the engine's own. What lands on disk is what carveToMarkdown
 * writes, with no wrapper - the HTML export builds a whole standalone page
 * around its output, and Markdown has nothing to wrap.
 */
export function renderMarkdown(source: string): string {
  return carveToMarkdown(source)
}

/**
 * The preview render with the Tier-1 decorating extensions left out - what the
 * spec corpus is measured against. See TIER1_DECORATING_EXTENSIONS for why this
 * is a second function rather than a list of waived documents.
 */
export function renderConformanceBody(source: string, render: PreviewRenderOptions = {}): string {
  const decorating = new Set<string>(TIER1_DECORATING_EXTENSIONS)
  const extensions = PREVIEW_EXTENSIONS
    .filter((name) => !decorating.has(name))
    .map((name) => EXTENSION_FACTORIES[name]())
  return carveToHtml(source, { ...render, extensions })
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
  /** Webview URI for the highlight.js light theme stylesheet. */
  hljsLightCss: string
  /** Webview URI for the highlight.js dark theme stylesheet. */
  hljsDarkCss: string
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
  /** Carve render options (mention/tag URLs, emoji map). */
  render?: PreviewRenderOptions
}

export function previewDocument(source: string, options: PreviewOptions): string {
  const body = renderPreviewBody(source, { ...options.render, sourceLine: true })
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
      --carve-border-width: 1px;
      --carve-accent-width: 4px;
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

    /* --- Task lists --------------------------------------------------- */

    /*
     * carve-css styles the checkbox itself but takes no view on what a DONE
     * item looks like, and a 13px accent box is not a state a reader can scan.
     *
     * So the BOX carries the state and the text is left alone: a checked item
     * takes the success tone, an unchecked one keeps the accent. Done reads as
     * a positive state you can still read, which is what a task list is for.
     *
     * Nothing sets a text-decoration or an inherited colour, so a nested item
     * needs no carve-out - a finished parent cannot reach its children, rather
     * than reaching them and being pushed back. The earlier treatment dimmed
     * and struck the text, which needed a :not(:has(:is(ul, ol))) guard because
     * a decoration on a block box propagates into every descendant and CSS
     * gives the descendant no way to take it back.
     */
    .carve li:has(> input[type="checkbox"]) { list-style: none; }
    .carve li > input[type="checkbox"] {
      margin-inline-start: -1.4em;
      margin-inline-end: var(--carve-space-2);
      vertical-align: middle;
    }
    /*
     * accent-color does NOT work here. The engine emits the box as disabled
     * (it is a rendered state, not a control), and a disabled checkbox is
     * painted by the UA in its own grey with accent-color ignored - so both
     * states came out the same washed square whatever tone was asked for.
     *
     * So the box is drawn here instead of asked for: appearance:none removes
     * the UA rendering entirely, and the two states are a bordered empty
     * square and a filled success square with a drawn tick. That is the
     * contrast, and it survives being disabled because nothing about it is
     * the UA's to grey.
     */
    .carve li > input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 1em;
      height: 1em;
      border: 1.5px solid var(--carve-border);
      border-radius: 3px;
      background: var(--carve-surface);
      position: relative;
      top: 0.05em;
    }
    .carve li > input[type="checkbox"]:checked {
      border-color: var(--carve-success);
      background: var(--carve-success);
    }
    /* The tick, drawn rather than glyphed so it scales with the box. */
    .carve li > input[type="checkbox"]:checked::after {
      content: "";
      position: absolute;
      left: 0.3em;
      top: 0.12em;
      width: 0.22em;
      height: 0.48em;
      border: solid var(--carve-ink-inverse);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
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
  </style>
  <title>Carve Preview</title>
</head>
<body>
  <main class="carve">${body}</main>
  <script nonce="${nonce}" src="${assets.hljsJs}"></script>
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

      function highlightCode() {
        if (typeof hljs === 'undefined') return
        document.querySelectorAll('pre code:not(.language-mermaid)').forEach((el) => {
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
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js',
  chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  katexJs: 'https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.js',
  katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css',
  katexAutoRender: 'https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/contrib/auto-render.min.js',
  hljsJs: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js',
  hljsLightCss: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/github.min.css',
  hljsDarkCss: 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/github-dark.min.css',
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
  <style>
    :root { color-scheme: light dark; }
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
    blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid rgba(127,127,127,0.5); }
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
  <script src="${CDN.katexJs}"></script>
  <script src="${CDN.katexAutoRender}"></script>
  <script src="${CDN.mermaid}"></script>
  <script src="${CDN.chartJs}"></script>
  <script>
    (function () {
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
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
