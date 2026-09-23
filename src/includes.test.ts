import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync as readSource } from 'node:fs'
import {
  carveInitializationOptions,
  includeEnabledFrom,
  includeSettingsPayload,
} from './includes.js'

const here = dirname(fileURLToPath(import.meta.url))
// Compiled test runs from dist/; the project root is one level up.
const projectRoot = dirname(here)

const options = (
  includes: Record<string, unknown> = {},
  workspaceTrusted = true,
): ReturnType<typeof carveInitializationOptions> =>
  carveInitializationOptions({ formatter: 'conservative', includes, workspaceTrusted })

test('workspaceTrusted rides at the top level, not inside carve', () => {
  const sent = options()
  assert.equal(sent.workspaceTrusted, true)
  assert.equal(
    'workspaceTrusted' in sent.carve,
    false,
    'readWorkspaceTrusted reads initializationOptions.workspaceTrusted; nesting it under carve\n' +
      '    turns includes off with no error anywhere - untrusted plus "auto" is a quiet state.',
  )
})

test('the include settings ride under carve.includes, where the server reads them', () => {
  assert.deepEqual(options().carve.includes, { enabled: 'auto' })
})

test('the server export source actions are off, the extension has its own export commands', () => {
  assert.equal(options().carve.exportActions, false)
})

test('the formatter option the server already relied on survives', () => {
  assert.equal(options().carve.formatter, 'conservative')
})

test('an unset gate is auto, which is on for a trusted workspace', () => {
  assert.equal(includeEnabledFrom(undefined), 'auto')
})

test('on and off pass through', () => {
  assert.equal(includeEnabledFrom('on'), 'on')
  assert.equal(includeEnabledFrom('off'), 'off')
})

test('an unrecognized gate value falls back to auto rather than reaching the server', () => {
  assert.equal(includeEnabledFrom('yes'), 'auto')
  assert.equal(includeEnabledFrom(true), 'auto')
})

test('an empty includeRoot is omitted, because an empty root means the process cwd', () => {
  // Measured, not assumed: realpathSync('') resolves to the process working
  // directory, and VS Code hands back "" for an unset string setting. Sending
  // it would root containment where PART 9 section 19 says it must never be.
  assert.equal('includeRoot' in includeSettingsPayload({ includeRoot: '' }), false)
  assert.equal('includeRoot' in includeSettingsPayload({ includeRoot: '   ' }), false)
  assert.equal('includeRoot' in includeSettingsPayload({}), false)
})

test('a configured includeRoot is sent, trimmed', () => {
  assert.equal(includeSettingsPayload({ includeRoot: ' /books ' }).includeRoot, '/books')
})

test('allowAbsolute is sent only when it was actually turned on', () => {
  assert.equal('allowAbsolute' in includeSettingsPayload({}), false)
  assert.equal('allowAbsolute' in includeSettingsPayload({ allowAbsolute: false }), false)
  assert.equal(includeSettingsPayload({ allowAbsolute: true }).allowAbsolute, true)
})

/*
 * The contract half. Everything above asserts the SHAPE of a payload; only
 * these drive the payload through the gate inside the language server this
 * extension actually installs, which is the one thing a shape assertion cannot
 * do. The module is addressed by path rather than by package specifier because
 * carve-lsp exports only its analyzer - the same path assumption src/paths.ts
 * already makes to find the server entry point.
 */
const lspDist = join(projectRoot, 'node_modules', '@markup-carve', 'carve-lsp', 'dist')
const importLsp = async (file: string): Promise<Record<string, Function>> =>
  (await import(pathToFileURL(join(lspDist, file)).href)) as Record<string, Function>

const workspace = (): { root: string; book: string; broken: string } => {
  const root = mkdtempSync(join(tmpdir(), 'carve-includes-'))
  mkdirSync(join(root, 'chapters'))
  writeFileSync(join(root, 'chapters', 'intro.crv'), '# Intro\n')
  writeFileSync(join(root, 'book.crv'), 'Hi\n\n{{ chapters/intro.crv }}\n')
  writeFileSync(join(root, 'broken.crv'), 'Hi\n\n{{ chapters/missing.crv }}\n')
  return { root, book: join(root, 'book.crv'), broken: join(root, 'broken.crv') }
}

const gateFor = async (
  file: string,
  roots: string[],
  includes: Record<string, unknown> = {},
  trusted = true,
): Promise<{ includeRoot?: string } | undefined> => {
  const settings = await importLsp('include-settings.js')
  const sent = options(includes, trusted)
  return settings.includeOptionsFor!({
    uri: pathToFileURL(file).href,
    settings: settings.readIncludeSettings!(sent),
    workspaceTrusted: settings.readWorkspaceTrusted!(sent),
    workspaceRoots: roots,
  }) as { includeRoot?: string } | undefined
}

test('the installed language server exposes the gate where this extension looks for it', async () => {
  const settings = await importLsp('include-settings.js')
  for (const name of ['readIncludeSettings', 'readWorkspaceTrusted', 'includeOptionsFor']) {
    assert.equal(typeof settings[name], 'function', `carve-lsp no longer exports ${name}`)
  }
})

test('the payload this extension sends turns the server gate on', async () => {
  const { root, book } = workspace()
  try {
    const gate = await gateFor(book, [root])
    assert.notEqual(gate, undefined, 'the gate stayed closed on the payload we send')
    assert.equal(gate?.includeRoot, root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a document in no workspace folder roots at its own folder, never the process cwd', async () => {
  const { root, book } = workspace()
  try {
    const gate = await gateFor(book, [])
    assert.equal(gate?.includeRoot, root)
    assert.notEqual(gate?.includeRoot, process.cwd())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('off closes the gate, and auto closes it in an untrusted workspace', async () => {
  const { root, book } = workspace()
  try {
    assert.equal(await gateFor(book, [root], { enabled: 'off' }), undefined)
    assert.equal(await gateFor(book, [root], { enabled: 'auto' }, false), undefined)
    assert.notEqual(await gateFor(book, [root], { enabled: 'on' }, false), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('with the gate open the server reports an unresolved include instead of prose', async () => {
  const { root, book, broken } = workspace()
  try {
    const { analyzeCarve } = (await import(
      pathToFileURL(join(lspDist, 'analyze.js')).href
    )) as { analyzeCarve: Function }
    const run = async (file: string, source: string) =>
      analyzeCarve(source, {
        uri: pathToFileURL(file).href,
        includes: await gateFor(file, [root]),
      }) as { diagnostics: { code?: string }[]; dependencies: { id: string; resolved: boolean; watch?: string }[] }

    const clean = await run(book, 'Hi\n\n{{ chapters/intro.crv }}\n')
    assert.deepEqual(clean.diagnostics.map((d) => d.code), [])
    assert.deepEqual(
      clean.dependencies.map((d) => d.resolved),
      [true],
      'a resolvable target is reported as a dependency to watch',
    )

    const missing = await run(broken, 'Hi\n\n{{ chapters/missing.crv }}\n')
    assert.deepEqual(missing.diagnostics.map((d) => d.code), ['include-unresolved'])
    // The MERELY ATTEMPTED target is watched too, keyed on the resolved
    // candidate rather than the path as written, so creating the file
    // invalidates the document that wanted it.
    assert.deepEqual(missing.dependencies.map((d) => d.resolved), [false])
    assert.equal(missing.dependencies[0]?.watch, join(root, 'chapters', 'missing.crv'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('with the gate closed the same document reports nothing at all', async () => {
  const { root, broken } = workspace()
  try {
    const { analyzeCarve } = (await import(
      pathToFileURL(join(lspDist, 'analyze.js')).href
    )) as { analyzeCarve: Function }
    const closed = await gateFor(broken, [root], { enabled: 'off' })
    const result = analyzeCarve('Hi\n\n{{ chapters/missing.crv }}\n', {
      uri: pathToFileURL(broken).href,
      ...(closed ? { includes: closed } : {}),
    }) as { diagnostics: { code?: string }[] }
    assert.deepEqual(
      result.diagnostics.map((d) => d.code),
      [],
      'this is the state every user of this extension was in before the wiring',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/*
 * A module nobody calls is the failure this catches, and the only one: the
 * extension imports `vscode` at the top level, so its activation cannot be
 * driven from `node --test`. Asserting on the source is weaker than calling it
 * - it cannot prove the payload reaches the client - but it does prove the two
 * halves are joined, which is exactly what was missing before.
 */
test('the language client is actually handed the include payload', () => {
  const source = readSource(join(projectRoot, 'src', 'extension.ts'), 'utf8')
  assert.match(
    source,
    /initializationOptions:\s*includePayload\(\)/,
    'the client no longer hands the include payload to the server, so includes stay off',
  )
  // The payload is built in one place because two callers need it - the server
  // start and the bundle command - and two spellings of it would mean two
  // containment roots. So the tripwire has to follow the indirection instead of
  // matching the call at the property.
  assert.match(
    source,
    /function includePayload\(\)[^}]*carveInitializationOptions\(/,
    'includePayload stopped going through carveInitializationOptions, so the payload shape is unchecked',
  )
  assert.equal(
    source.match(/carveInitializationOptions\(/g)?.length,
    1,
    'a second place builds the payload; the two can disagree about the containment root',
  )
  assert.match(
    source,
    /workspaceTrusted:\s*vscode\.workspace\.isTrusted/,
    'trust is not read from the workspace, so "auto" can never open the gate',
  )
  assert.match(
    source,
    /affectsConfiguration\('carve\.includes'\)/,
    'changing the include settings would not restart the server that read them once',
  )
})

/*
 * Every include setting is a lever on a FILE-READING capability, so a
 * workspace-supplied value for one must not be honored before the user trusts
 * the workspace. `restricted` is what tells VS Code to ignore the workspace
 * value until then. Defense in depth today - the extension declares no
 * `capabilities.untrustedWorkspaces`, so VS Code does not run it in a
 * restricted workspace at all - and the load-bearing declaration the moment
 * that changes.
 */
test('every include setting is declared restricted', () => {
  const manifest = JSON.parse(readSource(join(projectRoot, 'package.json'), 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { restricted?: boolean }> } }
  }
  const properties = manifest.contributes.configuration.properties
  const includeKeys = Object.keys(properties).filter((key) => key.startsWith('carve.includes.'))
  assert.deepEqual(includeKeys.sort(), [
    'carve.includes.allowAbsolute',
    'carve.includes.enabled',
    'carve.includes.includeRoot',
  ])
  for (const key of includeKeys) {
    assert.equal(properties[key]?.restricted, true, `${key} is not declared restricted`)
  }
})
