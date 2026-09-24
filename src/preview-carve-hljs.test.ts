/**
 * `carve` fences are highlighted by carve-grammars' highlight.js grammar, which
 * self-registers against the global hljs. It has to load after highlight.js, and
 * the HTML export's CDN copy has to be the version the preview bundles.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { exportHtmlDocument, previewDocument, type PreviewAssets } from './preview.js'

const require = createRequire(import.meta.url)
const grammarsDir = dirname(require.resolve('@markup-carve/carve-grammars/package.json'))
const hljsFile = require.resolve('@highlightjs/cdn-assets/highlight.min.js')

const assets = new Proxy({}, { get: (_, key) => `asset:${String(key)}` }) as PreviewAssets

function scriptSrcs(html: string): string[] {
  return [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1])
}

test('the classic script registers carve with the global hljs', () => {
  const context = createContext({})
  runInContext(readFileSync(hljsFile, 'utf8'), context)
  runInContext(readFileSync(join(grammarsDir, 'highlightjs', 'carve.js'), 'utf8'), context)
  const html = runInContext("hljs.highlight('*strong* and /emphasis/', { language: 'carve' }).value", context) as string
  assert.match(html, /<span class="hljs-/)
})

test('the preview loads the carve grammar right after highlight.js', () => {
  const srcs = scriptSrcs(previewDocument('x', { nonce: 'n', cspSource: 'csp', assets }))
  assert.equal(srcs.indexOf('asset:hljsCarveJs'), srcs.indexOf('asset:hljsJs') + 1)
})

test('the export loads the pinned grammar and table palette from the CDN', () => {
  const srcs = scriptSrcs(exportHtmlDocument('x'))
  const hljs = srcs.findIndex((s) => s.includes('/highlight.min.js'))
  assert.equal(srcs[hljs + 1], 'https://cdn.jsdelivr.net/gh/markup-carve/carve-grammars@49ab9a00/highlightjs/carve.js')
  assert.match(exportHtmlDocument('x'), /carve-grammars@49ab9a00\/shiki\/table-tokens\.css/)
  assert.match(exportHtmlDocument('x'), /@media \(prefers-color-scheme: dark\)[\s\S]*--carve-table-boundary/)
})

test('the preview loads the table palette beside its highlight.js theme', () => {
  const html = previewDocument('x', { nonce: 'n', cspSource: 'csp', assets })
  assert.match(html, /href="asset:hljsTableCss"/)
})

test('a Carve table fence separates borders from header, span, and alignment operators', () => {
  const context = createContext({})
  runInContext(readFileSync(hljsFile, 'utf8'), context)
  runInContext(readFileSync(join(grammarsDir, 'highlightjs', 'carve.js'), 'utf8'), context)
  const html = runInContext("hljs.highlight('|= Stage |= Owner |\\n| Row | < |\\n|?^ Top | Bottom |', { language: 'carve' }).value", context) as string
  assert.match(html, /hljs-table-operator[^>]*>\|=/)
  assert.match(html, /hljs-table-boundary[^>]*>\|</)
  assert.match(html, /hljs-table-operator[^>]*>\?\^</)
})
