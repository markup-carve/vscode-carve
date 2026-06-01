import assert from 'node:assert/strict'
import test from 'node:test'
import { serverModulePath } from './paths.js'

test('resolves bundled language server entrypoint', () => {
  const resolved = serverModulePath({
    asAbsolutePath(relativePath: string): string {
      return `/extension/${relativePath}`
    },
  })

  assert.equal(resolved, '/extension/node_modules/@markup-carve/carve-lsp/dist/server.js')
})
