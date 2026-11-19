/**
 * The extension set a render parses with must be the one it renders with.
 *
 * Several of the preview's extensions change the PARSE, not only the render, so
 * a parse made without them reads the document differently. #207 expanded
 * includes by reparsing with no set at all, which made turning includes on
 * change how the PARENT's own text was read - a line the feature has nothing to
 * do with (#209).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { expandForRender, type Engine, type ServerResolver } from './include-expansion.js'
import { previewExtensions, renderPreviewBody } from './preview.js'

const require = createRequire(import.meta.url)
const lspDist = join(dirname(require.resolve('@markup-carve/carve-lsp/package.json')), 'dist')

/**
 * A details block is the cheapest construct whose PARSE the extension set
 * decides: without the set it is a core `div`.
 */
const DETAILS = '::: details "More"\nHidden.\n:::'

async function resolverFor(root: string): Promise<ServerResolver> {
  const module = (await import(pathToFileURL(join(lspDist, 'include-path.js')).href)) as {
    fileSystemResolver: (root: string) => ServerResolver
  }
  return module.fileSystemResolver(root)
}

function scene(parent: string, child: string): { root: string; path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'carve-preview-ext-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'book.crv'), parent)
  writeFileSync(join(root, 'child.crv'), child)
  return { root, path: join(root, 'book.crv'), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

async function expanded(place: { root: string; path: string }, extensions: readonly unknown[]) {
  const engine = (await import('@markup-carve/carve')) as unknown as Engine
  return expandForRender(engine, {
    source: readFileSync(place.path, 'utf8'),
    sourcePath: place.path,
    resolve: await resolverFor(place.root),
    extensions: [...extensions],
  })
}

test('the extension set decides the parse, not only the render', async () => {
  // The premise everything below rests on, measured rather than assumed. If this
  // ever stops holding, the rest of this file is testing nothing.
  const { parse } = await import('@markup-carve/carve')
  const bare = JSON.stringify(parse(DETAILS, {}))
  const withSet = JSON.stringify(parse(DETAILS, { extensions: previewExtensions().extensions }))
  assert.notEqual(bare, withSet)
})

test("expanding includes does not change the PARENT's own rendering", async () => {
  const place = scene(`${DETAILS}\n\n{{ child.crv }}\n`, 'Child body.\n')
  try {
    const source = readFileSync(place.path, 'utf8')
    const off = renderPreviewBody(source)
    const extensions = previewExtensions()
    const on = renderPreviewBody(source, { document: (await expanded(place, extensions.extensions)).doc, extensions })
    assert.equal(on.split('\n')[0], off.split('\n')[0])
    // Named rather than left implicit: the details block stays a details
    // block, so the assertion above compares what the extension set governs.
    assert.match(off.split('\n')[0]!, /<details/)
  } finally {
    place.cleanup()
  }
})

test('a supplied set is the one used, not a fresh one built beside it', () => {
  // The whole point of threading the set through: the render must run against
  // the instances the parse ran against. Supplying an EMPTY set is the
  // discriminating case - a render that quietly built its own would still turn
  // the details block into a details element.
  const withDefault = renderPreviewBody(DETAILS)
  const withNone = renderPreviewBody(DETAILS, { extensions: { extensions: [], renderers: {} } })
  assert.match(withDefault, /<details/)
  assert.match(withNone, /<div class="details">/)
})

test('a CHILD is parsed with the set too', async () => {
  // Was a pinned failure under 0.1 (carve-js 1693): `expandIncludes` parsed a
  // child without the caller's extensions. The 0.2 `includes` option parses
  // every child with the parse options of the top-level document (C2-N-015), so the child's details
  // block is one too.
  const place = scene(`Parent.\n\n{{ child.crv }}\n`, `${DETAILS}\n`)
  try {
    const extensions = previewExtensions()
    const html = renderPreviewBody(readFileSync(place.path, 'utf8'), {
      document: (await expanded(place, extensions.extensions)).doc,
      extensions,
    })
    assert.match(html, /<details/)
  } finally {
    place.cleanup()
  }
})
