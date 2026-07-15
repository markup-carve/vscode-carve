import {
  carveToHtml,
  chart,
  codeGroup,
  details,
  listTable,
  mathBlock,
  mermaid,
  spoiler,
  tabs,
} from '@markup-carve/carve'

// The interactive renderer extensions the preview enables, matching the docs
// playground. Without these, `:::details`/`:::spoiler`/`:::tabs` degrade to
// inert `<div>`s, math stays literal, and mermaid/chart fences never hydrate.
// Constructed fresh per render so no cross-document state leaks.
function previewExtensions() {
  return [
    details(),
    spoiler(),
    mermaid(),
    mathBlock(),
    tabs(),
    codeGroup(),
    listTable(),
    chart(),
  ]
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
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    body {
      margin: 0;
      padding: 24px;
      line-height: 1.55;
    }
    main {
      max-width: 760px;
      margin: 0 auto;
    }
    pre, code {
      font-family: var(--vscode-editor-font-family);
    }
    main > :first-child { margin-top: 0; }
    a { color: var(--vscode-textLink-foreground); }
    a:hover { color: var(--vscode-textLink-activeForeground); }
    img { max-width: 100%; height: auto; }
    h1, h2 {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 0.2em;
    }
    pre {
      overflow-x: auto;
      padding: 12px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
    }
    :not(pre) > code {
      padding: 0.1em 0.35em;
      border-radius: 4px;
      font-size: 0.92em;
      background: var(--vscode-textCodeBlock-background);
    }
    kbd {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
      padding: 0.1em 0.4em;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
      border-bottom-width: 2px;
      background: var(--vscode-keybindingLabel-background, var(--vscode-textCodeBlock-background));
    }
    .mermaid {
      background: transparent;
      text-align: center;
    }
    .math.display {
      display: block;
      overflow-x: auto;
      text-align: center;
      margin: 1em 0;
    }
    table {
      border-collapse: collapse;
      width: auto;
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 5px 10px;
    }
    thead th { background: var(--vscode-editorWidget-background); }
    tbody tr:nth-child(even) {
      background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    }
    blockquote {
      margin-left: 0;
      padding-left: 16px;
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      color: var(--vscode-textBlockQuote-foreground);
    }
    mark {
      background: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 179, 8, 0.4));
      color: inherit;
      border-radius: 2px;
    }
    ins { text-decoration: none; background: color-mix(in srgb, var(--vscode-charts-green, #3fb950) 22%, transparent); }
    del { background: color-mix(in srgb, var(--vscode-charts-red, #f85149) 22%, transparent); }
    .critic-comment { color: var(--vscode-descriptionForeground); font-style: italic; }
    dl dt { font-weight: 600; margin-top: 0.6em; }
    dl dd { margin: 0 0 0 1.5em; }
    /* Mentions and tags: subtle pills whether linked or plain. */
    .mention, .tag {
      text-decoration: none;
      padding: 0 0.35em;
      border-radius: 999px;
      font-size: 0.95em;
    }
    .mention, .mention strong {
      color: var(--vscode-charts-blue, #4a9eff);
      font-weight: 500;
    }
    .mention { background: color-mix(in srgb, var(--vscode-charts-blue, #4a9eff) 14%, transparent); }
    .tag, .tag strong {
      color: var(--vscode-charts-purple, #a371f7);
      font-weight: 500;
    }
    .tag { background: color-mix(in srgb, var(--vscode-charts-purple, #a371f7) 14%, transparent); }
    /* Admonitions: callout boxes with a per-type accent. */
    .admonition {
      --admonition-accent: var(--vscode-focusBorder);
      margin: 1em 0;
      padding: 12px 16px;
      border-left: 4px solid var(--admonition-accent);
      border-radius: 4px;
      background: color-mix(in srgb, var(--admonition-accent) 9%, transparent);
    }
    .admonition > .admonition-title {
      margin: 0 0 0.5em;
      font-weight: 600;
      text-transform: capitalize;
      color: var(--admonition-accent);
    }
    .admonition > :last-child { margin-bottom: 0; }
    .admonition.note, .admonition.info { --admonition-accent: var(--vscode-charts-blue, #4a9eff); }
    .admonition.tip, .admonition.success { --admonition-accent: var(--vscode-charts-green, #3fb950); }
    .admonition.warning { --admonition-accent: var(--vscode-charts-yellow, #d29922); }
    .admonition.danger { --admonition-accent: var(--vscode-charts-red, #f85149); }
    .admonition.example { --admonition-accent: var(--vscode-charts-purple, #a371f7); }
    .admonition.quote { --admonition-accent: var(--vscode-charts-lines, #8b949e); }
    /* Task lists: carveToHtml emits a plain <ul> with an inline checkbox as the
       first child of each <li> (no wrapper class), so drop the bullet on those
       items and pull the box into the marker gutter. */
    li:has(> input[type="checkbox"]) { list-style: none; }
    li > input[type="checkbox"] {
      margin: 0 0.5em 0 -1.4em;
      vertical-align: middle;
    }
    /* Wide tables scroll instead of overflowing the viewport. Alignment comes
       through as an inline style on each cell, so no extra rule is needed. */
    table {
      display: block;
      max-width: 100%;
      overflow-x: auto;
    }
    /* Code block language pill (injected by the script below). Visible on hover. */
    pre[data-lang] { position: relative; }
    pre[data-lang] > .code-lang {
      position: absolute;
      top: 6px;
      right: 8px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.72em;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      opacity: 0;
      transition: opacity 0.15s;
      color: var(--vscode-descriptionForeground);
      pointer-events: none;
    }
    pre[data-lang]:hover > .code-lang { opacity: 0.85; }
    /* Details / spoiler disclosure blocks (details() + spoiler() extensions). */
    details {
      margin: 1em 0;
      padding: 8px 14px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-foreground) 3%, transparent);
    }
    details > summary {
      cursor: pointer;
      font-weight: 600;
      list-style: revert;
    }
    details[open] > summary { margin-bottom: 0.5em; }
    details.spoiler {
      border-style: dashed;
      border-color: var(--vscode-focusBorder);
    }
    /* Inline spoiler: blurred until hovered/focused (span.spoiler). */
    .spoiler:not(details) {
      background: color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
      border-radius: 3px;
      filter: blur(4px);
      transition: filter 0.12s;
      cursor: help;
    }
    .spoiler:not(details):hover,
    .spoiler:not(details):focus-within { filter: none; }
    /* Tabs / code-group: the extensions emit a labeled group; give it a frame. */
    .tabs, .code-group {
      margin: 1em 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
    }
    .tabs > .tab-title, .code-group > .code-group-title,
    .tabs label, .code-group label {
      display: inline-block;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 0.92em;
      border-bottom: 2px solid transparent;
    }
    .tabs > .tab-content, .code-group > .code-group-content { padding: 0 12px; }
    /* Chart.js target: the chart() extension emits <div class="chart"> holding a
       JSON config; the script below swaps in a <canvas>. */
    .chart {
      margin: 1em 0;
      max-width: 100%;
    }
    .chart > canvas { max-width: 100%; }
    [data-source-line] {
      scroll-margin-top: 8px;
    }
    .carve-active {
      position: relative;
    }
    .carve-active::before {
      content: "";
      position: absolute;
      left: -16px;
      top: 0;
      bottom: 0;
      width: 3px;
      border-radius: 2px;
      background: var(--vscode-editorCursor-foreground, var(--vscode-focusBorder));
    }
  </style>
  <title>Carve Preview</title>
</head>
<body>
  <main>${body}</main>
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
          pre.replaceWith(div)
        })
        try {
          mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: isDark() ? 'dark' : 'default' })
          const nodes = document.querySelectorAll('div.mermaid')
          if (nodes.length) mermaid.run({ nodes })
        } catch (err) {
          console.error('mermaid render failed', err)
        }
      }

      // Label each highlighted code block with its language (a hover pill). The
      // language comes from the core renderer's language- class on the code el.
      function decorateCodeLangs() {
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
        decorateCodeLangs()
        renderMermaid()
        renderCharts()
      }

      // --- Scroll sync (line-anchored) ---
      // Each top-level block carries data-source-line (1-based). We map
      // between editor lines and document offsets by interpolating between
      // the nearest anchored blocks.
      let suppressScroll = false

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
        suppressScroll = true
        window.scrollTo({ top })
        requestAnimationFrame(() => { suppressScroll = false })
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
