import assert from 'node:assert/strict'
import test from 'node:test'
import { serverModulePath } from './paths.js'
import { previewDocument, renderPreviewBody } from './preview.js'

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

test('wraps preview HTML in a CSP-safe document', () => {
  const html = previewDocument('*bold*', {
    nonce: 'abc123',
    cspSource: 'vscode-resource://test',
    assets: {
      mermaid: 'mermaid.js',
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
