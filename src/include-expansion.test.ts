/**
 * The include tier, driven against the INSTALLED server and the INSTALLED
 * engine rather than doubles.
 *
 * Both halves of this feature are things a stub would happily fake. A resolver
 * double cannot tell canonicalize-then-contain from a lexical `..` ban, and an
 * engine double cannot tell a real merge from a concatenation. So the
 * containment cases run through carve-lsp's own `fileSystemResolver` and the
 * merge through the engine's own `expandIncludes` - the two the extension
 * actually ships.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  expandForRender,
  IncludeCache,
  refusalSummary,
  watchTargets,
  type Engine,
  type ServerResolver,
} from './include-expansion.js'
import { isRelativeDestination, rebaseChildDestinations, rebaseDestination } from './include-rebase.js'

const require = createRequire(import.meta.url)
const lspEntry = require.resolve('@markup-carve/carve-lsp/package.json')
const lspDist = join(dirname(lspEntry), 'dist')

async function serverResolverFactory(): Promise<(root: string) => ServerResolver> {
  const module = (await import(pathToFileURL(join(lspDist, 'include-path.js')).href)) as {
    fileSystemResolver: (root: string, opts?: unknown) => ServerResolver
  }
  return (root: string) => module.fileSystemResolver(root)
}

async function engine(): Promise<Engine> {
  return (await import('@markup-carve/carve')) as unknown as Engine
}

/** A book with a chapter beside it and a file deliberately outside the root. */
function book(parent: string, children: Record<string, string> = {}): { root: string; path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'carve-includes-'))
  const root = join(dir, 'root')
  mkdirSync(join(root, 'chapters'), { recursive: true })
  writeFileSync(join(dir, 'outside.crv'), 'Outside the root.\n')
  writeFileSync(join(root, 'book.crv'), parent)
  for (const [name, source] of Object.entries(children)) {
    const target = join(root, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source)
  }
  return { root, path: join(root, 'book.crv'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

async function expand(scene: { root: string; path: string }, extra?: { cache?: IncludeCache }) {
  const make = await serverResolverFactory()
  return expandForRender(await engine(), {
    source: readFileSync(scene.path, 'utf8'),
    sourcePath: scene.path,
    resolve: make(scene.root),
    ...(extra?.cache ? { cache: extra.cache } : {}),
  })
}

async function html(doc: unknown): Promise<string> {
  const { renderDocument } = await import('@markup-carve/carve')
  return renderDocument(doc as Parameters<typeof renderDocument>[0], {})
}

test('a child is merged into the document the preview renders', async () => {
  const scene = book('Parent.\n\n{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'Child body.\n' })
  try {
    const result = await expand(scene)
    assert.match(await html(result.doc), /Child body\./)
    assert.equal(result.warnings.length, 0)
    assert.deepEqual(result.dependencies.map((d) => d.resolved), [true])
  } finally {
    scene.cleanup()
  }
})

test('a target outside the containment root is refused, and says which class', async () => {
  const scene = book('{{ ../outside.crv }}\n')
  try {
    const result = await expand(scene)
    assert.deepEqual(result.refusals.map((r) => r.denial), ['outside-root'])
    assert.deepEqual(result.warnings.map((w) => w.rule), ['include-unresolved'])
    // I7: the class must not reach the rendered message, which would publish
    // host layout into a preview.
    assert.doesNotMatch(result.warnings[0]!.message, /outside-root/)
    assert.ok(!result.warnings[0]!.message.includes(scene.root))
  } finally {
    scene.cleanup()
  }
})

test('a target that does not exist is refused as not-found, not as an escape', async () => {
  const scene = book('{{ chapters/missing.crv }}\n')
  try {
    const result = await expand(scene)
    assert.deepEqual(result.refusals.map((r) => r.denial), ['not-found'])
  } finally {
    scene.cleanup()
  }
})

test('a dotdot path whose canonical target is inside the root resolves', async () => {
  // Canonicalize-then-contain, not a lexical ban: `../shared.crv` from a
  // chapter is an ordinary book layout.
  const scene = book('{{ chapters/one.crv }}\n', {
    'chapters/one.crv': '{{ ../shared.crv }}\n',
    'shared.crv': 'Shared glossary.\n',
  })
  try {
    const result = await expand(scene)
    assert.match(await html(result.doc), /Shared glossary\./)
    assert.deepEqual(result.refusals, [])
  } finally {
    scene.cleanup()
  }
})

test('a cycle is reported rather than expanded forever', async () => {
  const scene = book('{{ chapters/one.crv }}\n', { 'chapters/one.crv': '{{ ../book.crv }}\n' })
  try {
    const result = await expand(scene)
    assert.ok(result.warnings.some((w) => w.rule === 'include-cycle'), JSON.stringify(result.warnings))
  } finally {
    scene.cleanup()
  }
})

test('every target the render touched is watchable, refused ones included', async () => {
  // A watcher following only successful reads would never notice a missing
  // chapter being created - the case includes exist for.
  const scene = book('{{ chapters/one.crv }}\n\n{{ chapters/missing.crv }}\n', { 'chapters/one.crv': 'Body.\n' })
  try {
    const targets = watchTargets(await expand(scene))
    assert.ok(targets.includes(join(scene.root, 'chapters/one.crv')), targets.join(', '))
    assert.ok(targets.some((t) => t.endsWith('missing.crv')), targets.join(', '))
  } finally {
    scene.cleanup()
  }
})

test('the bytes READ are charged, and a target is never refused before reading', async () => {
  // PART 9 section 19 bounds the expanded OUTPUT and explicitly not the work: a
  // target is resolved before its size is known, so refusing before reading
  // contradicts the clause.
  const scene = book('{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'abcdef\n' })
  try {
    assert.equal((await expand(scene)).chargedBytes, 7)
  } finally {
    scene.cleanup()
  }
})

test('a refusal summary names the class and the path', async () => {
  const scene = book('{{ ../outside.crv }}\n\n{{ chapters/missing.crv }}\n')
  try {
    const summary = refusalSummary(await expand(scene))
    assert.match(summary!, /2 includes refused/)
    assert.match(summary!, /outside-root: \.\.\/outside\.crv/)
    assert.match(summary!, /not-found: chapters\/missing\.crv/)
  } finally {
    scene.cleanup()
  }
})

test('no refusal produces no summary, so nothing is reported that did not happen', async () => {
  const scene = book('{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'Body.\n' })
  try {
    assert.equal(refusalSummary(await expand(scene)), null)
  } finally {
    scene.cleanup()
  }
})

test("a child's relative destinations are rebased against the child", async () => {
  const scene = book('{{ chapters/one.crv }}\n', {
    'chapters/one.crv': 'See [it](figures/one.png) and ![i](figures/one.png).\n',
  })
  try {
    const result = await expand(scene)
    const out = await html(result.doc)
    assert.match(out, /href="chapters\/figures\/one\.png"/)
    assert.match(out, /src="chapters\/figures\/one\.png"/)
    assert.equal(result.rebased, 2)
  } finally {
    scene.cleanup()
  }
})

test("the parent's own destinations are left alone", async () => {
  const scene = book('[top](figures/top.png)\n\n{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'Body.\n' })
  try {
    const result = await expand(scene)
    assert.match(await html(result.doc), /href="figures\/top\.png"/)
    assert.equal(result.rebased, 0)
  } finally {
    scene.cleanup()
  }
})

test('only genuinely relative destinations are rebased', () => {
  for (const kept of ['https://example.com/a.png', 'mailto:someone@example.invalid', '/root.png', '//cdn/x.png', '#anchor']) {
    assert.equal(isRelativeDestination(kept), false, kept)
    assert.equal(rebaseDestination(kept, '/r/chapters/one.crv', '/r/book.crv'), kept)
  }
  assert.equal(isRelativeDestination('figures/one.png'), true)
})

test('a query and a fragment survive the rebase', () => {
  assert.equal(
    rebaseDestination('figures/one.png?v=1#fig-1', '/r/chapters/one.crv', '/r/book.crv'),
    'chapters/figures/one.png?v=1#fig-1',
  )
})

test('a dotdot in the child is resolved, not carried over verbatim', () => {
  // The child means /r/assets/x.png, which the parent writes without a dotdot.
  assert.equal(rebaseDestination('../assets/x.png', '/r/chapters/one.crv', '/r/book.crv'), 'assets/x.png')
})

test('a destination that really does escape the parent folder keeps a dotdot', () => {
  assert.equal(rebaseDestination('../../assets/x.png', '/r/chapters/one.crv', '/r/book.crv'), '../assets/x.png')
})

test('a node inherits its ancestor file, so a nested destination still moves', () => {
  const link = { type: 'link', href: 'figures/one.png', children: [] as unknown[] }
  const doc = {
    type: 'document',
    children: [{ type: 'paragraph', pos: { file: '/r/chapters/one.crv' }, children: [link] }],
  }
  assert.equal(rebaseChildDestinations(doc, '/r/book.crv'), 1)
  assert.equal(link.href, 'chapters/figures/one.png')
})

test('the cache serves a child again and drops it when the file changes', async () => {
  const scene = book('{{ chapters/one.crv }}\n', { 'chapters/one.crv': 'First.\n' })
  try {
    const cache = new IncludeCache()
    await expand(scene, { cache })
    assert.equal(cache.size, 1)
    const child = join(scene.root, 'chapters/one.crv')
    assert.equal(cache.get(child), 'First.\n')
    // Keyed on mtime, so an edit made outside the editor cannot be served stale.
    const later = new Date(Date.now() + 5000)
    utimesSync(child, later, later)
    assert.equal(cache.get(child), undefined)
  } finally {
    scene.cleanup()
  }
})

test('a cache entry for a file that cannot be stat-ed is not kept', () => {
  const cache = new IncludeCache()
  cache.set(join(tmpdir(), 'carve-includes-nonexistent-file.crv'), 'x')
  assert.equal(cache.size, 0)
})
