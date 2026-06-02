import { carveToHtml } from '@markup-carve/carve'

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
  return carveToHtml(source, render)
}

export interface PreviewAssets {
  /** Webview URI for the mermaid UMD bundle. */
  mermaid: string
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
    pre {
      overflow-x: auto;
      padding: 12px;
      background: var(--vscode-textCodeBlock-background);
    }
    .mermaid {
      background: transparent;
      text-align: center;
    }
    table {
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 4px 8px;
    }
    blockquote {
      margin-left: 0;
      padding-left: 16px;
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      color: var(--vscode-textBlockQuote-foreground);
    }
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
        document.querySelectorAll('pre > code.language-mermaid').forEach((code) => {
          const pre = code.parentElement
          const div = document.createElement('div')
          div.className = 'mermaid'
          // Carry the source-line anchor over so scroll sync and caret
          // highlight still map to the diagram block.
          const sourceLine = pre.getAttribute('data-source-line')
          if (sourceLine) div.setAttribute('data-source-line', sourceLine)
          div.textContent = code.textContent || ''
          pre.replaceWith(div)
        })
        try {
          mermaid.initialize({ startOnLoad: false, theme: isDark() ? 'dark' : 'default' })
          const nodes = document.querySelectorAll('.mermaid')
          if (nodes.length) mermaid.run({ nodes })
        } catch (err) {
          console.error('mermaid render failed', err)
        }
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
        renderMermaid()
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
    th, td { border: 1px solid rgba(127,127,127,0.4); padding: 4px 8px; }
    blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid rgba(127,127,127,0.5); }
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
        document.querySelectorAll('pre > code.language-mermaid').forEach((code) => {
          const pre = code.parentElement
          const div = document.createElement('div')
          div.className = 'mermaid'
          // Carry the source-line anchor over so scroll sync and caret
          // highlight still map to the diagram block.
          const sourceLine = pre.getAttribute('data-source-line')
          if (sourceLine) div.setAttribute('data-source-line', sourceLine)
          div.textContent = code.textContent || ''
          pre.replaceWith(div)
        })
        try {
          mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })
          const nodes = document.querySelectorAll('.mermaid')
          if (nodes.length) mermaid.run({ nodes })
        } catch (err) { console.error(err) }
      }
      if (typeof hljs !== 'undefined') {
        document.querySelectorAll('pre code:not(.language-mermaid)').forEach((el) => {
          try { hljs.highlightElement(el) } catch (err) { console.error(err) }
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
