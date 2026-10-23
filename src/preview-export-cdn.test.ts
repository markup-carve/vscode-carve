/**
 * The HTML export loads from jsDelivr the libraries the preview bundles from
 * node_modules. Each npm CDN URL must name the installed version (#399).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { exportHtmlDocument } from './preview.js'

// Not require.resolve: chart.js does not export its package.json.
const nodeModules = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules')

const installedVersion = (name: string): string =>
  (JSON.parse(readFileSync(join(nodeModules, name, 'package.json'), 'utf8')) as { version: string }).version

test('every npm CDN URL in the export names the version the preview bundles', () => {
  const urls = [...exportHtmlDocument('x').matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\//g)]
  const names = new Set(urls.map(([, name]) => name))
  for (const name of ['mermaid', 'chart.js', 'katex', '@highlightjs/cdn-assets']) {
    assert.ok(names.has(name), `the export loads no ${name} from the CDN`)
  }
  for (const [url, name, version] of urls) {
    assert.equal(version, installedVersion(name), `${url} is not the bundled ${name}`)
  }
})
