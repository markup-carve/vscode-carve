#!/usr/bin/env node
// Drive every spec corpus document through the two surfaces this extension
// actually ships, and compare them against the corpus AND against each other.
//
// Before this runner, nothing in this repository read engine output. `npm test`
// is TextMate-grammar plus a handful of unit tests, so it was green whether the
// bundled engine was correct or twelve days stale: the runtime pin bump in #133
// moved render-against-corpus from 978 of 1259 to 1259 of 1259 - 281 documents
// had been rendering wrongly - and no committed check in this repository could
// have said so (#134).
//
// TWO SURFACES, AND THE COMPARISON BETWEEN THEM
//
//   1. PREVIEW / EXPORT. `renderPreviewBody` from the built `dist/preview.js` is
//      the function behind `carve.openPreview` and `carve.exportHtml`. Its
//      output is compared byte-for-byte against the corpus `.html`. This is the
//      conformance number, measured through the extension's own code path
//      rather than by calling the engine directly - the preview enables eight
//      renderer extensions, and calling `carveToHtml` bare would not be a
//      statement about what the preview does.
//
//   2. LANGUAGE SERVER. Every document is opened in the real server process,
//      spawned from the path `serverModulePath()` hands the client, and its
//      diagnostics, outline and folding ranges are collected over stdio. Not an
//      in-process import: the module the extension launches, launched.
//
//   3. THE TWO ENGINES. The preview imports `@markup-carve/carve` from the
//      extension's own module graph; every language-server feature imports it
//      from `node_modules/@markup-carve/carve-lsp/`'s. Those are two resolutions
//      and npm is free to satisfy them with two different copies - it did. Until
//      #133, an old carve-lsp revision declaring its engine as a registry range
//      made npm nest a second copy under
//      `node_modules/@markup-carve/carve-lsp/node_modules/@markup-carve/carve`,
//      so diagnostics, folds, hover and rename came from a parser the preview
//      was not using. Nobody noticed until someone hashed the installed tree.
//
//      So this runner resolves the engine from BOTH graphs, and if the two land
//      on different files it parses every corpus document with each and names
//      the documents the two parsers read differently. When they land on the
//      same file the AST comparison is an identity - it is the resolution above
//      that discriminates, and the run says which case it is rather than
//      implying a comparison it did not make.
//
//   4. NO ERROR DIAGNOSTIC ON A DOCUMENT THAT RENDERS. Measured over the whole
//      corpus: 374 warnings, zero errors. A corpus document is by construction
//      well-formed Carve, so the server calling one broken is either a language
//      server bug or the two surfaces disagreeing about the language - which is
//      the two-parsers symptom a user would actually see.
//
// Usage: node tools/corpus-through-extension.mjs [--corpus <dir>] [--manifest <file>]
//
// `--manifest` writes one TAB-separated row per document, so two runs (say
// either side of an engine bump) compare as SETS of rows rather than as sums.
// Totals cannot do that job: a document that loses a diagnostic and another that
// gains one leave every total identical (the "compare counts, not sets" defect,
// markup-carve/carve#927).

import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { argv, execPath, exit, stderr, stdout } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flag = (name) => {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    stdout.write(`${name} needs a value\n`)
    exit(2)
  }
  return value
}

const corpusDir = resolve(flag('--corpus') ?? join(repoRoot, 'spec', 'tests', 'corpus'))
const manifestPath = flag('--manifest')

const fail = (message) => {
  stdout.write(`corpus-through-extension: ${message}\n`)
  exit(1)
}

/*
 * THE POPULATION GUARD - A RUNNER MUST NOT REPORT SUCCESS OVER NOTHING.
 *
 * There is no corpus floor anywhere in this repository in any spelling, and a
 * runner that compares zero documents would print `documents=0 mismatches=0`
 * and exit 0 - the dead check this org keeps finding (markup-carve/carve#755).
 *
 * The expectation is deliberately NOT derived from the directory being read:
 * counting the `.crv` files and then checking that count against itself moves
 * both sides together when the corpus is emptied, and that exact mistake was
 * made and caught in markup-carve/pandoc-carve. tests/corpus is GENERATED from
 * the `::: compare` blocks in spec/resources/examples/{core,extensions,edge-cases}.md,
 * so counting those blocks is an independent statement of how many documents
 * there should be - and it leaves no literal here to go stale, because adding an
 * example moves the expectation on the next corpus rebuild.
 *
 * Equality rather than a floor, deliberately: a floor cannot tell a whole corpus
 * from a truncated checkout, and truncation is the failure being guarded against.
 */
const EXAMPLE_PAGES = ['core.md', 'extensions.md', 'edge-cases.md']
const COMPARE_OPEN = /^:{3,}\s+compare(\s+\S.*)?$/

// Mirrors the generator's state machine rather than grepping: a `::: compare`
// line inside an already-open block is content, not a second pair, and a block
// closes on a bare marker line of its own length.
const declaredCorpusSize = () => {
  const examplesDir = join(corpusDir, '..', '..', 'resources', 'examples')
  let declared = 0
  for (const page of EXAMPLE_PAGES) {
    const path = join(examplesDir, page)
    let source
    try {
      source = readFileSync(path, 'utf8')
    } catch (error) {
      fail(
        `no corpus source page at ${path} (${error instanceof Error ? error.message : String(error)}).\n` +
          '  The corpus is generated from those pages, and they are how this run knows how many\n' +
          '  documents it should have seen. Without them there is nothing to compare the corpus\n' +
          '  against, and a run over an unknown population is not a result. Initialize the spec\n' +
          '  submodule (git submodule update --init --recursive) or point --corpus at\n' +
          '  tests/corpus inside a markup-carve/carve checkout.',
      )
    }
    let marker = null
    for (const rawLine of source.split('\n')) {
      const line = rawLine.trim()
      if (marker !== null) {
        if (line === marker) marker = null
        continue
      }
      if (COMPARE_OPEN.test(line)) {
        declared++
        marker = line.match(/^:{3,}/)[0]
      }
    }
  }
  return declared
}

let documents
try {
  documents = readdirSync(corpusDir)
    .filter((name) => name.endsWith('.crv'))
    .sort()
} catch (error) {
  fail(
    `cannot read ${corpusDir} (${error instanceof Error ? error.message : String(error)}).\n` +
      '  The spec submodule is probably not initialized: git submodule update --init --recursive',
  )
}

const declared = declaredCorpusSize()
if (declared === 0) {
  fail(
    'the corpus source pages declare no ::: compare blocks at all.\n' +
      '  This is a wiring problem, not a corpus of size zero.',
  )
}
if (documents.length !== declared) {
  fail(
    `${corpusDir} holds ${documents.length} documents, but the spec's example pages declare ${declared}.\n` +
      '  Every ::: compare block in resources/examples/{core,extensions,edge-cases}.md becomes one\n' +
      '  corpus pair, so a difference means this is not the corpus those pages describe: a\n' +
      '  truncated or stale checkout, a wrong --corpus, or a corpus that needs regenerating\n' +
      '  (npm run corpus:build in the spec repository). Every number below would describe a\n' +
      '  population nobody chose.',
  )
}

// The built extension, not the sources: `dist/` is what the .vsix carries, and a
// `case` arm naming a node type a newer engine no longer emits is dead at
// runtime rather than a compile error.
const distFile = (name) => {
  const path = join(repoRoot, 'dist', name)
  try {
    readFileSync(path)
  } catch {
    fail(`no ${path}. Run npm run build first - this measures the BUILT extension, not the sources.`)
  }
  return path
}

const { renderPreviewBody } = await import(pathToFileURL(distFile('preview.js')).href)
const { serverModulePath } = await import(pathToFileURL(distFile('paths.js')).href)

// Exactly the path the language client hands to the server launcher, so a
// resolver that points at nothing is a failure here rather than a silently
// dead language server in the wild.
const serverPath = serverModulePath({ asAbsolutePath: (relative) => join(repoRoot, relative) })
try {
  readFileSync(serverPath)
} catch {
  fail(`serverModulePath() points at ${serverPath}, which does not exist. Run npm ci.`)
}

/*
 * Node's own package resolution, walked by hand.
 *
 * `createRequire(...).resolve` cannot be used: the engine's package exports
 * declare an `import` condition and no `require` one, so CJS resolution refuses
 * it. And `import.meta.resolve` resolves from THIS file, which is the one graph
 * whose answer is not interesting. Walking `node_modules` upward from a starting
 * directory is what Node does and is what makes a nested copy visible.
 */
const packageDirFrom = (startDir, packageName) => {
  let dir = startDir
  for (;;) {
    const candidate = join(dir, 'node_modules', ...packageName.split('/'))
    try {
      readFileSync(join(candidate, 'package.json'))
      return realpathSync(candidate)
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const packageEntry = (packageDir) => {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const exported = manifest.exports?.['.']
  const entry =
    (typeof exported === 'string' ? exported : (exported?.import ?? exported?.default)) ??
    manifest.module ??
    manifest.main ??
    'index.js'
  return join(packageDir, entry)
}

const ENGINE = '@markup-carve/carve'
const previewEngineDir = packageDirFrom(join(repoRoot, 'dist'), ENGINE)
const serverEngineDir = packageDirFrom(dirname(serverPath), ENGINE)
if (previewEngineDir === null) fail(`the preview's module graph resolves no ${ENGINE}. Run npm ci.`)
if (serverEngineDir === null) fail(`the language server's module graph resolves no ${ENGINE}. Run npm ci.`)

/*
 * The resolution above is a statement about THIS install. The pins are a
 * statement about every install.
 *
 * npm nested the second copy because the carve-lsp revision in use declared its
 * engine as a registry RANGE while this package pins a git revision: two specs
 * npm cannot satisfy with one directory. A run that only compared resolved paths
 * would go green on a tree that happened to hoist and stay green until the next
 * `npm ci` on a different npm version. So compare what the two packages ASK FOR,
 * not only what they got, and require both to name the SAME SINGLE VERSION -
 * anything softer is a range, and a range is how the incident happened (#133).
 *
 * A single version has two spellings, and the property is the same in both: a
 * 40-hex git revision, and an exact semver with no range operator. `0.1.5`
 * admits one version just as `#61f824d5...` admits one commit, so both are
 * accepted and compared by value. What stays rejected is everything that admits
 * MORE than one - `^0.1.5`, `~0.1.5`, `>=0.1.5`, `*`, `latest`, a branch or tag
 * URL - because that is the shape npm can satisfy two different ways.
 *
 * The engines moved off git URLs onto published versions once both were on npm,
 * and this check named the older spelling as if it were the requirement rather
 * than one way of meeting it. That is the check-cannot-pass-a-correct-tree case,
 * not a pin defect.
 */
const REVISION = /#([0-9a-f]{40})\b/
const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/
const declaredEngineSpec = (manifestPath, label) => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const spec = manifest.dependencies?.[ENGINE]
  if (spec === undefined) fail(`${label} declares no ${ENGINE} dependency at all (${manifestPath}).`)
  const revision = REVISION.exec(spec)
  if (revision !== null) return revision[1]
  if (EXACT_VERSION.test(spec)) return spec
  fail(
    `${label} declares ${ENGINE} as "${spec}", which is neither an exact version nor a\n` +
      '  40-hex git revision. A range lets npm satisfy the two dependents with two\n' +
      '  different copies, and the language server then runs a parser the preview is\n' +
      '  not using (#133).',
  )
}

const previewPin = declaredEngineSpec(join(repoRoot, 'package.json'), 'this extension')
const serverPin = declaredEngineSpec(
  join(packageDirFrom(dirname(serverPath), '@markup-carve/carve-lsp') ?? '', 'package.json'),
  'the installed carve-lsp',
)
const pinsAgree = previewPin === serverPin

const sharedEngine = previewEngineDir === serverEngineDir
const previewEngine = await import(pathToFileURL(packageEntry(previewEngineDir)).href)
const serverEngine = sharedEngine
  ? previewEngine
  : await import(pathToFileURL(packageEntry(serverEngineDir)).href)

const parseWith = (engine, source) => {
  try {
    return JSON.stringify(engine.parse(source))
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`
  }
}

// ---------------------------------------------------------------------------
// The language server, over stdio, framed the way the client frames it.
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000

const startServer = () => {
  const child = spawn(execPath, [serverPath, '--stdio'], { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  const handlers = new Map()
  let buffer = Buffer.alloc(0)
  let nextId = 1
  let crashed = null

  child.stderr.on('data', (chunk) => stderr.write(`[server] ${chunk}`))
  child.on('exit', (code, signal) => {
    crashed = `the language server exited (code=${code} signal=${signal})`
    for (const { reject } of pending.values()) reject(new Error(crashed))
    pending.clear()
  })

  const write = (message) => {
    const payload = Buffer.from(JSON.stringify(message), 'utf8')
    child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`)
    child.stdin.write(payload)
  }

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const separator = buffer.indexOf('\r\n\r\n')
      if (separator === -1) return
      const header = buffer.subarray(0, separator).toString('ascii')
      const length = /content-length:\s*(\d+)/i.exec(header)
      if (!length) throw new Error(`no Content-Length in server header: ${header}`)
      const start = separator + 4
      const end = start + Number(length[1])
      if (buffer.length < end) return
      const message = JSON.parse(buffer.subarray(start, end).toString('utf8'))
      buffer = buffer.subarray(end)
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve: settle, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else settle(message.result)
        continue
      }
      if (message.method) {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params)
        // A server->client request left unanswered stalls the server.
        if (message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, result: null })
      }
    }
  })

  return {
    request(method, params) {
      if (crashed) return Promise.reject(new Error(crashed))
      const id = nextId++
      return new Promise((settle, reject) => {
        // A server that never answers would otherwise hang the job until the
        // runner's own timeout, which reads as an infrastructure flake rather
        // than as the language server having stopped on a document.
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`no answer to ${method} within ${REQUEST_TIMEOUT_MS}ms`))
        }, REQUEST_TIMEOUT_MS)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            settle(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        write({ jsonrpc: '2.0', id, method, params })
      })
    },
    notify(method, params) {
      if (crashed) throw new Error(crashed)
      write({ jsonrpc: '2.0', method, params })
    },
    on(method, handler) {
      if (!handlers.has(method)) handlers.set(method, [])
      handlers.get(method).push(handler)
    },
    stop() {
      child.kill()
    },
  }
}

const server = startServer()
const published = new Map()
server.on('textDocument/publishDiagnostics', (params) => published.set(params.uri, params.diagnostics))

let initialize
try {
  initialize = await server.request('initialize', {
    // NOT this process's pid. A numeric processId makes vscode-languageserver
    // install a watchdog that polls `process.kill(pid, 0)` and exits when the
    // parent stops being visible - which in a PID namespace where the child
    // cannot see the runner is immediately, before it answers `initialize`.
    // The runner owns the child and stops it itself, so the watchdog buys
    // nothing and costs the whole run in a container.
    processId: null,
    rootUri: pathToFileURL(repoRoot).href,
    capabilities: {},
    workspaceFolders: null,
  })
} catch (error) {
  server.stop()
  fail(
    `the language server at ${serverPath} did not initialize: ` +
      `${error instanceof Error ? error.message : String(error)}\n` +
      '  Nothing below could have been measured, so this is a failure rather than a run with\n' +
      '  one surface missing.',
  )
}
if (!initialize?.capabilities?.documentSymbolProvider || !initialize?.capabilities?.foldingRangeProvider) {
  fail(
    'the language server advertises neither an outline nor folding ranges, so this run would ' +
      'compare nothing.\n  Advertised: ' +
      JSON.stringify(Object.keys(initialize?.capabilities ?? {})),
  )
}
server.notify('initialized', {})

// ---------------------------------------------------------------------------
// Every document, through both surfaces.
// ---------------------------------------------------------------------------

const ERROR_SEVERITY = 1

let renderMismatches = 0
let renderThrew = 0
let astMismatches = 0
let serverErrors = 0
let totalDiagnostics = 0
let totalSymbols = 0
let totalFolds = 0

const renderFailures = []
const astFailures = []
const diagnosticFailures = []
const rows = []

// DOCUMENTS THE BUNDLED ENGINE CANNOT YET RENDER, and the pin that fixes them.
//
// The spec submodule moves ahead of the published engine routinely: a ruling
// lands, the corpus gains a document for it, and `@markup-carve/carve` only
// carries it after its next release. Without this list the bump PR is red for a
// reason nobody here can fix, and the usual outcome is that the corpus stops
// being bumped at all.
//
// EVERY ENTRY IS TEMPORARY AND MUST BE EMPTIED AT THE NEXT ENGINE BUMP. The
// list is keyed by ENGINE_PIN below: raise the engine and the key stops
// matching, so the entries expire loudly rather than quietly becoming
// permanent. Do not add a document here because it is inconvenient - only
// because the engine provably predates the rule the document pins.
//
// The key is whatever `package.json` declares - a published version once both
// packages were on npm, a 40-hex revision before that. Either way it is the one
// string that changes when the engine moves, which is all this key has to be.
const ENGINE_PIN = '0.1.5'
const ENGINE_LAG = {}
const lagWaived = []
const lagStale = []

for (const name of documents) {
  const source = readFileSync(join(corpusDir, name), 'utf8')
  const expected = readFileSync(join(corpusDir, name.replace(/\.crv$/, '.html')), 'utf8').trim()

  let rendered
  let renderState
  try {
    rendered = renderPreviewBody(source).trim()
    renderState = rendered === expected ? 'render-ok' : 'render-differs'
  } catch (error) {
    renderState = 'render-threw'
    renderFailures.push(`${name}: threw ${error instanceof Error ? error.message : String(error)}`)
    renderThrew++
  }
  if (renderState === 'render-differs') {
    if (ENGINE_LAG[name] && previewPin === ENGINE_PIN) {
      lagWaived.push(`${name}: ${ENGINE_LAG[name]}`)
    } else {
      renderMismatches++
      renderFailures.push(`${name}: ${expected.length} expected bytes, ${rendered.length} rendered`)
    }
  } else if (ENGINE_LAG[name]) {
    // It renders now. The waiver outlived the lag and has to go, or it will sit
    // here hiding a future regression on the same document.
    lagStale.push(name)
  }

  const uri = pathToFileURL(join(corpusDir, name)).href
  server.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'carve', version: 1, text: source },
  })
  let symbols
  let folds
  try {
    symbols = await server.request('textDocument/documentSymbol', { textDocument: { uri } })
    folds = await server.request('textDocument/foldingRange', { textDocument: { uri } })
  } catch (error) {
    // A server that stops answering makes every later document meaningless, so
    // this stops rather than accumulating 1200 identical failures - and it
    // stops with a name, because "the server died" is a different bug report
    // from "the server died on THIS document".
    server.stop()
    fail(
      `the language server stopped answering on ${name}: ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        `  ${documents.indexOf(name)} document(s) had been driven through it before that.`,
    )
  }
  // Diagnostics are published on open, and `documents.onDidOpen` flushes them
  // synchronously, so by the time a later request has answered they have
  // arrived. A document that never publishes is a defect, not an empty list.
  if (!published.has(uri)) {
    diagnosticFailures.push(`${name}: the server published no diagnostics at all for this document`)
    serverErrors++
  }
  const diagnostics = published.get(uri) ?? []
  const errors = diagnostics.filter((entry) => (entry.severity ?? ERROR_SEVERITY) === ERROR_SEVERITY)
  if (errors.length > 0) {
    serverErrors++
    diagnosticFailures.push(`${name}: ${errors.map((entry) => entry.message).join(' | ')}`)
  }
  totalDiagnostics += diagnostics.length
  totalSymbols += symbols.length
  totalFolds += folds.length
  server.notify('textDocument/didClose', { textDocument: { uri } })

  const previewAst = parseWith(previewEngine, source)
  const serverAst = sharedEngine ? previewAst : parseWith(serverEngine, source)
  const astState = previewAst === serverAst ? 'ast-agree' : 'ast-differ'
  if (astState === 'ast-differ') {
    astMismatches++
    astFailures.push(name)
  }

  rows.push(
    [name, renderState, astState, diagnostics.length, errors.length, symbols.length, folds.length].join('\t'),
  )
}

server.stop()

if (manifestPath) writeFileSync(manifestPath, rows.map((row) => `${row}\n`).join(''))

const report = (label, entries, cap = 25) => {
  for (const entry of entries.slice(0, cap)) stdout.write(`${label}: ${entry}\n`)
  if (entries.length > cap) stdout.write(`${label}: ... and ${entries.length - cap} more\n`)
}

report('renders differently', renderFailures)
report('read by two different parsers', astFailures)
report('error diagnostic', diagnosticFailures)

stdout.write(`corpus=${corpusDir}\n`)
stdout.write(`documents=${documents.length}\n`)
stdout.write(`rendered=${documents.length - renderMismatches - renderThrew}/${documents.length}\n`)
stdout.write(`renderThrew=${renderThrew}\n`)
stdout.write(`previewEngine=${previewEngineDir}\n`)
stdout.write(`serverEngine=${serverEngineDir}\n`)
stdout.write(`engineLagWaived=${lagWaived.length}\n`)
for (const line of lagWaived) stdout.write(`  waived (engine behind spec): ${line}\n`)
stdout.write(`engineCopies=${sharedEngine ? 1 : 2}\n`)
stdout.write(`enginePinPreview=${previewPin}\n`)
stdout.write(`enginePinServer=${serverPin}\n`)
stdout.write(`astMismatches=${astMismatches}\n`)
stdout.write(`diagnostics=${totalDiagnostics}\n`)
stdout.write(`errorDiagnostics=${serverErrors}\n`)
stdout.write(`symbols=${totalSymbols}\n`)
stdout.write(`folds=${totalFolds}\n`)

if (!pinsAgree) {
  stdout.write(
    'FAIL: this extension pins engine ' +
      `${previewPin} and the installed carve-lsp pins ${serverPin}.\n` +
      '  npm can satisfy those with one hoisted copy today and two copies on the next install.\n' +
      '  Bump the carve-lsp pin to a revision whose engine pin matches this one.\n',
  )
}
/*
 * THE SECOND SURFACE MUST HAVE PRODUCED SOMETHING.
 *
 * Measured: a `documentSymbol` handler stubbed to return `[]` left this runner
 * printing `documents=1259 rendered=1259/1259 symbols=0` and exiting 0 - 1259
 * documents driven through a language server that answered nothing, reported as
 * a pass. That is the population guard's failure wearing different clothes.
 *
 * The assertion is that the feature is alive, not what it returns: a corpus of
 * this size cannot contain no heading and no foldable range, so zero means the
 * provider is dead. Diagnostics deliberately get no such floor - a language
 * server that has nothing to warn about is a legitimate state, and the manifest
 * is where a run-to-run change in them shows up.
 */
const deadProviders = []
if (totalSymbols === 0) deadProviders.push('documentSymbol returned no symbol on any document')
if (totalFolds === 0) deadProviders.push('foldingRange returned no range on any document')
if (deadProviders.length > 0) {
  stdout.write(
    `FAIL: the language server answered, but produced nothing to compare:\n  ${deadProviders.join('\n  ')}\n` +
      '  A corpus this size has headings and containers in it, so an empty answer everywhere is\n' +
      '  a dead provider rather than a quiet document.\n',
  )
}
if (!sharedEngine) {
  stdout.write(
    'FAIL: the preview and the language server resolve DIFFERENT copies of the engine.\n' +
      '  Every language-server feature - diagnostics, folds, outline, hover, rename - would run\n' +
      '  on a parser the preview is not using. Check that carve-lsp declares its engine as the\n' +
      '  same git revision this package pins, so npm hoists one copy (#133).\n',
  )
}
if (renderMismatches > 0 || renderThrew > 0) {
  stdout.write(
    'FAIL: the preview does not render the corpus. The bundled engine is behind the spec\n' +
      '  submodule, or a renderer extension the preview enables changes Tier-1 output.\n',
  )
}
if (astMismatches > 0) {
  stdout.write('FAIL: the two engine copies parse the documents above differently.\n')
}
if (lagStale.length > 0) {
  stdout.write(
    'FAIL: an engine-lag waiver is no longer needed. These documents render correctly\n' +
      '  now, so their entries in ENGINE_LAG are hiding nothing except a future regression\n' +
      '  on the same document. Delete them:\n' +
      lagStale.map((n) => `    ${n}\n`).join(''),
  )
}
if (Object.keys(ENGINE_LAG).length > 0 && previewPin !== ENGINE_PIN) {
  stdout.write(
    'FAIL: the engine pin moved and ENGINE_LAG was not emptied. Every waiver in it was\n' +
      `  written against ${ENGINE_PIN.slice(0, 12)} and says nothing about ${String(previewPin).slice(0, 12)}.\n` +
      '  Re-run without the list, keep only the documents that still mismatch, and point\n' +
      '  ENGINE_PIN at the new engine.\n',
  )
}
if (serverErrors > 0) {
  stdout.write(
    'FAIL: the language server reports errors on documents the corpus says are well-formed.\n',
  )
}

const failures =
  renderMismatches +
  renderThrew +
  astMismatches +
  serverErrors +
  deadProviders.length +
  (sharedEngine ? 0 : 1) +
  (pinsAgree ? 0 : 1) +
  // A waiver that outlived its lag, or a pin that moved without the list being
  // emptied, has to fail the run. Printing FAIL without reaching the exit code
  // is the shape this tool exists to catch everywhere else.
  lagStale.length +
  (Object.keys(ENGINE_LAG).length > 0 && previewPin !== ENGINE_PIN ? 1 : 0)
exit(failures === 0 ? 0 : 1)
