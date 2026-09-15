import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MAX_BUNDLE_CANDIDATES, buildBundle, bundleDirectory, bundlePath, bundleSummary } from './bundle.js'
import { carveInitializationOptions } from './includes.js'

const here = dirname(fileURLToPath(import.meta.url))
// Compiled test runs from dist/; the project root is one level up.
const projectRoot = dirname(here)

test('a target inside the root becomes a path inside the bundle', () => {
  assert.equal(bundlePath('/book', '/book/chapters/one.crv'), 'chapters/one.crv')
  assert.equal(bundlePath('/book', '/book/root.crv'), 'root.crv')
})

test('a target outside the root is refused rather than escaping the bundle', () => {
  assert.equal(bundlePath('/book', '/outside/secret.crv'), null)
  assert.equal(bundlePath('/book', '/book'), null, 'the root itself is not a file to copy')
  assert.equal(bundlePath('/book', '/booktown/root.crv'), null, 'a prefix match is not containment')
})

test('the bundle carries the document and every file it read', () => {
  const bundle = buildBundle({
    documentPath: '/book/root.crv',
    source: 'Root\n\n{{ chapters/one.crv }}\n',
    includeRoot: '/book',
    walk: {
      documents: [
        { id: '/book/chapters/one.crv', source: '# One\n' },
        { id: '/book/shared/glossary.crv', source: 'Terms\n' },
      ],
      dependencies: [
        { id: '/book/chapters/one.crv', resolved: true },
        { id: '/book/shared/glossary.crv', resolved: true },
      ],
    },
  })
  assert.deepEqual(bundle.files.map((file) => file.path), ['root.crv', 'chapters/one.crv', 'shared/glossary.crv'])
  assert.equal(bundle.files[0]?.source, 'Root\n\n{{ chapters/one.crv }}\n')
  assert.match(bundle.files[0]?.source ?? '', /\{\{/, 'a bundle keeps the directives; merging them is what flattening does')
  assert.deepEqual(bundle.missing, [])
})

test('a target that could not be read is named, not silently dropped', () => {
  const bundle = buildBundle({
    documentPath: '/book/root.crv',
    source: 'Root\n',
    includeRoot: '/book',
    walk: { documents: [], dependencies: [{ id: 'chapters/gone.crv', resolved: false }, { id: '../outside.crv', resolved: false }] },
  })
  assert.deepEqual(bundle.files.map((file) => file.path), ['root.crv'])
  assert.deepEqual(bundle.missing, ['chapters/gone.crv', '../outside.crv'])
})

test('a file the walk reached twice is written once', () => {
  const bundle = buildBundle({
    documentPath: '/book/root.crv',
    source: 'Root\n',
    includeRoot: '/book',
    walk: {
      documents: [{ id: '/book/shared.crv', source: 'S\n' }, { id: '/book/shared.crv', source: 'S\n' }],
      dependencies: [],
    },
  })
  assert.deepEqual(bundle.files.map((file) => file.path), ['root.crv', 'shared.crv'])
})

test('a document outside the containment root contributes no file', () => {
  const bundle = buildBundle({
    documentPath: '/book/root.crv',
    source: 'Root\n',
    includeRoot: '/book',
    walk: { documents: [{ id: '/elsewhere/leak.crv', source: 'secret\n' }], dependencies: [] },
  })
  assert.deepEqual(bundle.files.map((file) => file.path), ['root.crv'])
})

test('the bundle folder lands beside the document, stepping over names in use', () => {
  assert.equal(bundleDirectory('/book/root.crv', () => false), join('/book', 'root.bundle'))
  assert.equal(bundleDirectory('/book/root.crv', (c) => c === join('/book', 'root.bundle')), join('/book', 'root.bundle-2'))
})

test('an exhausted name space refuses rather than looping', () => {
  let asked = 0
  assert.equal(bundleDirectory('/book/root.crv', () => { asked++; return true }), null)
  assert.equal(asked, MAX_BUNDLE_CANDIDATES)
})

test('the summary says what is in the bundle and what is missing from it', () => {
  const empty = { files: [{ path: 'root.crv', source: '' }], missing: [] }
  assert.equal(bundleSummary(empty, 'root.bundle'), 'Bundled 1 file into root.bundle. Directives are kept, so the bundle is still a set of documents.')
  const lossy = { files: [{ path: 'root.crv', source: '' }, { path: 'a.crv', source: '' }], missing: ['a.crv', 'b.crv', 'c.crv', 'd.crv'] }
  assert.equal(
    bundleSummary(lossy, 'root.bundle'),
    'Bundled 2 files into root.bundle. Directives are kept, so the bundle is still a set of documents. 4 includes could not be read and are not in it: a.crv, b.crv, c.crv, and 1 more.',
  )
})

/*
 * The contract half. Everything above asserts the shape of a value; only these
 * drive the walk inside the language server this extension actually installs,
 * which is the one check that cannot lie about whether the surface the bundle
 * command reaches for is still there. Addressed by path because carve-lsp
 * exports only its analyzer, the same assumption src/paths.ts makes.
 */
const lspDist = join(projectRoot, 'node_modules', '@markup-carve', 'carve-lsp', 'dist')
const importLsp = async (file: string): Promise<Record<string, Function>> =>
  (await import(pathToFileURL(join(lspDist, file)).href)) as Record<string, Function>

test('the installed language server still exposes the walk the bundle reaches for', async () => {
  const includes = await importLsp('includes.js')
  assert.equal(typeof includes.resolveIncludes, 'function', 'carve-lsp no longer exports resolveIncludes')
})

test('the installed server walk has no expanded document to flatten', async () => {
  // Why this repo bundles rather than flattens. The walk reports the child
  // SOURCES; merging them is the engine's expansion pass, and the engine pinned
  // here has none (issue 198). Producing a flattened document from these values would
  // mean reimplementing section 19's merge - heading clamps, id renames, budgets.
  const includes = await importLsp('includes.js')
  const resolution = includes.resolveIncludes!('Hi\n') as Record<string, unknown>
  assert.deepEqual(Object.keys(resolution).sort(), ['bytes', 'dependencies', 'documents', 'warnings'])
  for (const key of ['doc', 'ast', 'document']) {
    assert.equal(key in resolution, false, `resolveIncludes gained a "${key}" - flattening may now be reachable here`)
  }
})

test('the walk the bundle runs reaches a nested child and refuses one outside the root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carve-bundle-'))
  const outside = mkdtempSync(join(tmpdir(), 'carve-outside-'))
  try {
    mkdirSync(join(root, 'chapters'))
    // Distinctive on purpose: the word "secret" also appears in the DIRECTIVE
    // the root document writes, and that directive is legitimately in the
    // bundle, so matching on it would pass while a leak went unnoticed.
    writeFileSync(join(outside, 'secret.crv'), 'CLASSIFIED-PAYLOAD\n')
    writeFileSync(join(root, 'chapters', 'deep.crv'), 'Deep body.\n')
    writeFileSync(join(root, 'chapters', 'one.crv'), '# One\n\n{{ deep.crv }}\n')
    const source = `Root\n\n{{ chapters/one.crv }}\n\n{{ ${join(outside, 'secret.crv')} }}\n`
    const documentPath = join(root, 'book.crv')
    writeFileSync(documentPath, source)

    const settings = await importLsp('include-settings.js')
    const includes = await importLsp('includes.js')
    const sent = carveInitializationOptions({ formatter: 'conservative', includes: {}, workspaceTrusted: true })
    const options = settings.includeOptionsFor!({
      uri: pathToFileURL(documentPath).href,
      settings: settings.readIncludeSettings!(sent),
      workspaceTrusted: settings.readWorkspaceTrusted!(sent),
      workspaceRoots: [root],
    }) as { includeRoot?: string } | undefined
    assert.notEqual(options, undefined, 'the gate stayed closed on the payload the bundle command sends')

    const walk = includes.resolveIncludes!(source, options) as Parameters<typeof buildBundle>[0]['walk']
    const bundle = buildBundle({ documentPath, source, includeRoot: options?.includeRoot ?? '', walk })
    assert.deepEqual(bundle.files.map((file) => file.path).sort(), ['book.crv', 'chapters/deep.crv', 'chapters/one.crv'])
    assert.equal(bundle.missing.length, 1, 'the target outside the root is reported')
    assert.doesNotMatch(JSON.stringify(bundle.files), /CLASSIFIED-PAYLOAD/, 'nothing from outside the root reaches the bundle')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
