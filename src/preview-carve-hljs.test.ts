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

test('a list after a leading blank line is scoped without stalling the preview', () => {
  const context = createContext({})
  runInContext(readFileSync(hljsFile, 'utf8'), context)
  runInContext(readFileSync(join(grammarsDir, 'highlightjs', 'carve.js'), 'utf8'), context)
  const source = JSON.stringify('\n' + Array.from({ length: 12 }, (_, i) => `- item ${i} with *b* and \`c\``).join('\n') + '\n')
  // carve-grammars 0.1.18 left this unscoped after about a minute of CPU.
  const html = runInContext(`hljs.highlight(${source}, { language: 'carve' }).value`, context, { timeout: 10_000 }) as string
  assert.equal(html.match(/<span class="hljs-bullet">-<\/span>/g)?.length, 12)
})

test('a description marker is scoped at a footnote body column and not under lazy text', () => {
  const context = createContext({})
  runInContext(readFileSync(hljsFile, 'utf8'), context)
  runInContext(readFileSync(join(grammarsDir, 'highlightjs', 'carve.js'), 'utf8'), context)
  const highlight = (source: string) =>
    runInContext(`hljs.highlight(${JSON.stringify(source)}, { language: 'carve' }).value`, context) as string
  assert.match(highlight('r[^1]\n\n[^1]: x\n    :: t\n  : e\n'), /<span class="hljs-punctuation"> {2}:<\/span> e/)
  assert.doesNotMatch(highlight(': x\n- z\n  :: t\n  : e\n'), /hljs-punctuation/)
})

test('the delimited script registers csv and tsv with the global hljs', () => {
  const context = createContext({})
  runInContext(readFileSync(hljsFile, 'utf8'), context)
  runInContext(readFileSync(join(grammarsDir, 'highlightjs', 'delimited.js'), 'utf8'), context)
  for (const language of ['csv', 'tsv']) {
    const html = runInContext(`hljs.highlight('a,"b"\\n1,2\\n', { language: '${language}' }).value`, context) as string
    assert.match(html, /<span class="hljs-/)
  }
})

test('the preview loads the carve grammar right after highlight.js', () => {
  const srcs = scriptSrcs(previewDocument('x', { nonce: 'n', cspSource: 'csp', assets }))
  assert.equal(srcs.indexOf('asset:hljsCarveJs'), srcs.indexOf('asset:hljsJs') + 1)
})

test('the preview loads the csv and tsv grammar right after the carve grammar', () => {
  const srcs = scriptSrcs(previewDocument('x', { nonce: 'n', cspSource: 'csp', assets }))
  assert.equal(srcs.indexOf('asset:hljsDelimitedJs'), srcs.indexOf('asset:hljsCarveJs') + 1)
})

test('the export loads the grammars, csv and tsv included, and table palette from the CDN', () => {
  const srcs = scriptSrcs(exportHtmlDocument('x'))
  const hljs = srcs.findIndex((s) => s.includes('/highlight.min.js'))
  assert.equal(srcs[hljs + 1], 'https://cdn.jsdelivr.net/gh/markup-carve/carve-grammars@v0.1.19/highlightjs/carve.js')
  assert.equal(srcs[hljs + 2], 'https://cdn.jsdelivr.net/gh/markup-carve/carve-grammars@v0.1.19/highlightjs/delimited.js')
  assert.match(exportHtmlDocument('x'), /carve-grammars@v0.1.19\/shiki\/table-tokens\.css/)
  assert.match(exportHtmlDocument('x'), /@media \(prefers-color-scheme: dark\)[\s\S]*--carve-table-boundary/)
})

test('the export CDN tag matches the carve-grammars the preview bundles', () => {
  const { version } = JSON.parse(readFileSync(join(grammarsDir, 'package.json'), 'utf8')) as { version: string }
  for (const src of scriptSrcs(exportHtmlDocument('x')).filter((s) => s.includes('/carve-grammars@'))) {
    assert.ok(src.includes(`/carve-grammars@v${version}/`), `${src} is not carve-grammars ${version}`)
  }
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
  assert.match(html, /hljs-table-header[^>]*>\|=/)
  assert.match(html, /hljs-table-boundary[^>]*>\|</)
  assert.match(html, /hljs-table-operator[^>]*>\?\^</)
})
