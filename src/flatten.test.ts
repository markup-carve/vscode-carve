/**
 * Flattening: one self-contained `.crv`, and the same text on the clipboard.
 *
 * Driven against the INSTALLED engine, because the thing worth asserting is the
 * one a double cannot fake. `carve flatten` guarantees the flattened document
 * renders identically to the expanded original; a stub writer would satisfy
 * every other assertion here and not that one.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { flattenDocument, flattenPath, flattenSummary, type Writer } from './flatten.js'
import { type Engine, type ServerResolver } from './include-expansion.js'

const require = createRequire(import.meta.url)
const lspDist = join(dirname(require.resolve('@markup-carve/carve-lsp/package.json')), 'dist')

async function resolverFor(root: string): Promise<ServerResolver> {
  const module = (await import(pathToFileURL(join(lspDist, 'include-path.js')).href)) as {
    fileSystemResolver: (root: string) => ServerResolver
  }
  return module.fileSystemResolver(root)
}

function book(parent: string, children: Record<string, string> = {}): { root: string; path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'carve-flatten-'))
  const root = join(dir, 'root')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(dir, 'outside.crv'), 'Outside.\n')
  writeFileSync(join(root, 'book.crv'), parent)
  for (const [name, source] of Object.entries(children)) {
    const target = join(root, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source)
  }
  return { root, path: join(root, 'book.crv'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

async function flatten(scene: { root: string; path: string }) {
  const engine = (await import('@markup-carve/carve')) as unknown as Engine & Writer
  return flattenDocument(engine, {
    source: readFileSync(scene.path, 'utf8'),
    sourcePath: scene.path,
    resolve: await resolverFor(scene.root),
  })
}

test('the children are merged into one document, and the directives are gone', async () => {
  const scene = book('Parent.\n\n{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'Child body.\n' })
  try {
    const result = await flatten(scene)
    assert.match(result.text, /Child body\./)
    assert.doesNotMatch(result.text, /\{\{/)
  } finally {
    scene.cleanup()
  }
})

test('the flattened document renders identically to the expanded original', async () => {
  // The invariant `carve flatten` promises, pinned rather than assumed. Nothing
  // else here would catch a writer that produced plausible but different Carve.
  const scene = book('Parent.\n\n{{ chapters/one.crv }}\n\n{{ chapters/two.crv }}\n', {
    'chapters/one.crv': '# Intro\n\nA note.[^n]\n\n[^n]: First note.\n',
    'chapters/two.crv': '# Intro\n\nAnother note.[^n]\n\n[^n]: Second note.\n',
  })
  try {
    const result = await flatten(scene)
    const { carveToHtml, renderDocument } = await import('@markup-carve/carve')
    assert.equal(
      carveToHtml(result.text),
      renderDocument(result.expansion.doc as Parameters<typeof renderDocument>[0], {}),
    )
  } finally {
    scene.cleanup()
  }
})

test('a colliding explicit heading id is renamed and counted', async () => {
  // The attribute block goes BEFORE the heading. Written after it, Carve drops
  // it, so the heading carries no id, so there is no collision to rename and the
  // assertion would pass on the footnote rename alone. Measured: with the block
  // trailing, the only warning raised is `include-footnote-rename`.
  const scene = book('{{ chapters/one.crv }}\n\n{{ chapters/two.crv }}\n', {
    'chapters/one.crv': '{#intro}\n# Intro A\n',
    'chapters/two.crv': '{#intro}\n# Intro B\n',
  })
  try {
    const result = await flatten(scene)
    assert.deepEqual(result.expansion.warnings.map((w) => w.rule), ['include-heading-id-rename'])
    assert.equal(result.renames, 1)
    assert.match(result.text, /\{#intro-2\}/)
    assert.match(flattenSummary(result, 'book.flat.crv'), /1 colliding id or footnote label was renamed \(spec I5\)/)
  } finally {
    scene.cleanup()
  }
})

test('a colliding footnote label is renamed and counted', async () => {
  const scene = book('{{ chapters/one.crv }}\n\n{{ chapters/two.crv }}\n', {
    'chapters/one.crv': 'One.[^a]\n\n[^a]: First.\n',
    'chapters/two.crv': 'Two.[^a]\n\n[^a]: Second.\n',
  })
  try {
    const result = await flatten(scene)
    assert.deepEqual(result.expansion.warnings.map((w) => w.rule), ['include-footnote-rename'])
    assert.equal(result.renames, 1)
  } finally {
    scene.cleanup()
  }
})

test('a refused include keeps its directive, and the summary says so', async () => {
  const scene = book('{{ ../outside.crv }}\n')
  try {
    const result = await flatten(scene)
    assert.match(result.text, /\{\{ \.\.\/outside\.crv \}\}/)
    assert.deepEqual(result.expansion.refusals.map((r) => r.denial), ['outside-root'])
    assert.match(flattenSummary(result, 'book.flat.crv'), /1 include could not be read/)
  } finally {
    scene.cleanup()
  }
})

test("a child's relative destinations are NOT rebased, matching carve flatten", async () => {
  // The CLI does not rewrite them, and matching it byte for byte is worth more
  // than being independently right: a flattened file that differs from the
  // CLI's is a bug nobody can see.
  const scene = book('{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'See [it](figures/one.png).\n' })
  try {
    const result = await flatten(scene)
    assert.match(result.text, /\(figures\/one\.png\)/)
    assert.equal(result.expansion.rebased, 0)
  } finally {
    scene.cleanup()
  }
})

test('the summary always names the normalization, because the output is canonical Carve', async () => {
  const scene = book('{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'Body.\n' })
  try {
    const summary = flattenSummary(await flatten(scene), 'the clipboard')
    assert.match(summary, /Flattened 1 included file into the clipboard\./)
    assert.match(summary, /formatting is normalized/)
  } finally {
    scene.cleanup()
  }
})

test('the destination is derived from the document and steps past a taken name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-flatten-path-'))
  try {
    const document = join(dir, 'book.crv')
    assert.equal(flattenPath(document, (candidate) => existsSync(candidate)), join(dir, 'book.flat.crv'))
    writeFileSync(join(dir, 'book.flat.crv'), '')
    assert.equal(flattenPath(document, (candidate) => existsSync(candidate)), join(dir, 'book.flat-2.crv'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no free name leaves null rather than overwriting something', () => {
  assert.equal(flattenPath('/r/book.crv', () => true), null)
})
