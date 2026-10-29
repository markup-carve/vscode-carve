/**
 * The preview's inline script is written inside a TypeScript template literal,
 * which drops unknown escapes: `\-` in source reaches the webview as `-`. One
 * such regex turned into a SyntaxError and killed highlighting, diagrams and
 * math in the whole preview, so every inline script must still parse.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { exportHtmlDocument, previewDocument, type PreviewAssets } from './preview.js'

const SOURCE = '# Title\n\n{.diff}\n```js\n const a = 1\n-let b = 2\n+const b = 2\n```\n'

const assets = new Proxy({}, { get: (_, key) => `asset:${String(key)}` }) as PreviewAssets

function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((body) => body.trim() !== '')
}

for (const [name, html] of [
  ['preview', previewDocument(SOURCE, { nonce: 'n', cspSource: 'csp', assets })],
  ['export', exportHtmlDocument(SOURCE)],
] as const) {
  test(`${name} inline scripts parse`, () => {
    const scripts = inlineScripts(html)
    assert.ok(scripts.length > 0, 'no inline script found')
    for (const body of scripts) {
      assert.doesNotThrow(() => new Function(body))
    }
  })
}

test('captioned diff fences use whole class tokens in the preview', () => {
  const script = inlineScripts(previewDocument(SOURCE, { nonce: 'n', cspSource: 'csp', assets }))
    .find((body) => body.includes('function renderLanguageDiff'))
  assert.ok(script)
  const functions = script.slice(script.indexOf('function escapeHtml'), script.indexOf('function renderMath'))
  const run = new Function('document', 'hljs', `${functions}\nhighlightCode()`)
  for (const [figureClass, expectedDiff] of [['diff', true], ['side-diff', false]] as const) {
    const preClasses = new Set<string>()
    const code = {
      classList: ['language-js'],
      textContent: '-old()\n+new()',
      innerHTML: '',
      parentElement: {
        classList: { contains: (name: string) => preClasses.has(name), add: (name: string) => preClasses.add(name) },
        parentElement: { tagName: 'FIGURE', classList: { contains: (name: string) => name === figureClass } },
      },
    }
    let highlighted = false
    run({ querySelectorAll: () => [code] }, {
      getLanguage: () => false,
      highlightElement: () => { highlighted = true },
    })
    assert.equal(preClasses.has('has-diff'), expectedDiff)
    assert.equal(preClasses.has('diff'), expectedDiff)
    assert.equal(code.innerHTML.includes('diff-marker'), expectedDiff)
    assert.equal(highlighted, !expectedDiff)
  }
})
