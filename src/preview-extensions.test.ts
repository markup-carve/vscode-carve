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

/** A citation is the cheapest construct whose PARSE the extension set decides. */
const CITATION = 'See [@smith2020, p. 4].'

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

async function expanded(place: { root: string; path: string }, extensions: unknown[]) {
  const engine = (await import('@markup-carve/carve')) as unknown as Engine
  return expandForRender(engine, {
    source: readFileSync(place.path, 'utf8'),
    sourcePath: place.path,
    resolve: await resolverFor(place.root),
    extensions,
  })
}

test('the extension set decides the parse, not only the render', async () => {
  // The premise everything below rests on, measured rather than assumed. If this
  // ever stops holding, the rest of this file is testing nothing.
  const { parse } = await import('@markup-carve/carve')
  const bare = JSON.stringify(parse(CITATION, {}))
  const withSet = JSON.stringify(parse(CITATION, { extensions: previewExtensions() }))
  assert.notEqual(bare, withSet)
})

test("expanding includes does not change the PARENT's own rendering", async () => {
  const place = scene(`${CITATION}\n\n{{ child.crv }}\n`, 'Child body.\n')
  try {
    const source = readFileSync(place.path, 'utf8')
    const off = renderPreviewBody(source)
    const extensions = previewExtensions()
    const on = renderPreviewBody(source, { document: (await expanded(place, extensions)).doc, extensions })
    assert.equal(on.split('\n')[0], off.split('\n')[0])
    // Named rather than left implicit: the citation stays a citation, so the
    // assertion above is comparing the thing the extension set governs.
    assert.match(off.split('\n')[0]!, /See \[@smith2020, p\. 4\]\./)
  } finally {
    place.cleanup()
  }
})

test('a supplied set is the one used, not a fresh one built beside it', () => {
  // The whole point of threading the set through: the render must run against
  // the instances the parse ran against. Supplying an EMPTY set is the
  // discriminating case - a render that quietly built its own would still turn
  // the citation into a citation.
  const withDefault = renderPreviewBody(CITATION)
  const withNone = renderPreviewBody(CITATION, { extensions: [] })
  assert.match(withDefault, /See \[@smith2020, p\. 4\]\./)
  assert.match(withNone, /class="mention"/)
})

test('a CHILD is still parsed without the set, which is carve-js 1693', async () => {
  // PINNED FAILURE, not an accepted behavior. `expandIncludes` calls
  // `parse(source, { positions: true })` internally and `IncludeOptions` has no
  // extensions key, so no host can fix this from outside. When
  // markup-carve/carve-js#1693 lands, this assertion flips and says so, instead
  // of the gap living only in a PR body.
  const place = scene(`Parent.\n\n{{ child.crv }}\n`, `${CITATION}\n`)
  try {
    const extensions = previewExtensions()
    const html = renderPreviewBody(readFileSync(place.path, 'utf8'), {
      document: (await expanded(place, extensions)).doc,
      extensions,
    })
    assert.match(
      html,
      /class="mention"/,
      'carve-js 1693 appears to be fixed: a child now parses with the caller extensions. Update this assertion and drop the note in README.',
    )
  } finally {
    place.cleanup()
  }
})
