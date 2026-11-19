/**
 * Expand a document's includes for the preview and the export targets.
 *
 * Two pieces do the work and neither is reimplemented here. The CONTAINMENT
 * decision comes out of the installed language server - `fileSystemResolver`,
 * canonicalize-then-contain, with the denial classes §19 names - so the rule a
 * preview obeys is the one the server is already enforcing for diagnostics and
 * go-to-definition. The MERGE comes out of the engine: `parse` with the
 * `includes` option carries the heading clamp, the per-file key scopes
 * (C2-N-054, C2-N-055), the selection options and the depth bound. Merging
 * children by hand would mean reimplementing all of that with a failure mode of
 * output that looks right and diverges from `carve flatten` silently (#198).
 *
 * WHAT THE BUDGETS BOUND. §19's byte budget bounds the expanded OUTPUT and
 * explicitly not the work done to produce it: a target is resolved before its
 * size is known, so the bytes READ are charged and a target is never refused
 * before reading. What bounds the I/O a render performs is the separate
 * resolver-call bound. Nothing here adds a pre-read size check, which would
 * contradict the clause.
 *
 * DENIALS ARE NOT SWALLOWED. The engine reports only the 0.2 error class
 * (`not_found`, `outside_root`); the server's resolver knows the finer reason. The class it reports
 * is captured per target and handed back, so a preview can say "outside the
 * containment root" instead of leaving a refused include looking like ordinary
 * prose. §19 I7 keeps the class off the rendered message - a resolver's own
 * error text carries host paths - so it travels beside the warning, not inside
 * it.
 *
 * Kept free of `vscode` imports, like `./includes.js` and `./bundle.js`, so it
 * can be driven against the installed server and the installed engine in a test
 * rather than through the editor.
 */
import { statSync } from 'node:fs'
import { rebaseChildDestinations } from './include-rebase.js'

/** Why the server's resolver refused a target. §19's denial classes. */
export type IncludeDenial =
  | 'remote-not-allowed'
  | 'absolute-denied'
  | 'outside-root'
  | 'not-found'
  | 'not-a-file'

/** The shape `carve-lsp`'s `fileSystemResolver` returns. */
export type ServerResolved =
  | { ok: true; id: string; source: string; bytes: number; watch?: string; version?: string }
  | { ok: false; id: string; denial: IncludeDenial; watch?: string }

export type ServerResolver = (
  includePath: string,
  ctx: { sourcePath?: string; stack: string[]; depth: number },
) => ServerResolved

export interface IncludeWarning {
  line: number
  column: number
  rule: string
  message: string
  detail?: string
  start: number
  end: number
  file?: string
}

export interface IncludeDependency {
  id: string
  resolved: boolean
}

/** One refused target, with the class the resolver refused it under. */
export interface IncludeRefusal {
  /** The path as the directive wrote it. */
  path: string
  denial: IncludeDenial
  /**
   * The absolute candidate the resolver would have read, when it got far enough
   * to name one. A host watches this so that creating a missing target
   * invalidates the render - the case includes exist for, and the one a watcher
   * following only successful reads would never see.
   */
  watch?: string
}

export interface ExpansionResult {
  /** The expanded document, ready for `render`. */
  doc: unknown
  warnings: IncludeWarning[]
  suppressedWarnings: number
  dependencies: IncludeDependency[]
  chargedBytes: number
  refusals: IncludeRefusal[]
  /**
   * Relative destinations a child contributed that were rewritten against the
   * parent's folder (#192). Reported rather than assumed: a rebase that moved
   * nothing looks exactly like a document with no child links in it.
   */
  rebased: number
}

/** A diagnostic of the 0.2 engine, as far as this module reads it. */
export interface EngineDiagnostic {
  code: string
  message: string
  path?: string
  range?: { startOffset: number; endOffset: number }
  file?: string
}

/** The engine surface this module uses, so a test can drive it with a double. */
export interface Engine {
  parseWithDiagnostics: (
    source: string,
    options: Record<string, unknown>,
  ) => { document: unknown; diagnostics: EngineDiagnostic[]; suppressedDiagnostics: number }
  includeDependencies: (doc: unknown) => Array<{ path: string; read: boolean; file?: string }>
}

export interface ExpandInput {
  source: string
  /** Absolute path of the document, its identity for relative resolution. */
  sourcePath: string
  resolve: ServerResolver
  extensions?: unknown[]
  /** Child sources already read, keyed by canonical path. */
  cache?: IncludeCache
  /**
   * Rewrite a child's relative destinations against the parent (#192). On for a
   * RENDER, where the result is resolved from the parent's folder. Off for a
   * FLATTEN, where the output must match `carve flatten` byte for byte and the
   * CLI does not rebase - diverging quietly from it is the failure mode #198
   * exists to avoid.
   */
  rebase?: boolean
}

/** Every absolute path a render touched, resolved or merely attempted. */
export function watchTargets(result: ExpansionResult): string[] {
  const paths = new Set<string>()
  for (const dependency of result.dependencies) if (dependency.resolved) paths.add(dependency.id)
  for (const refusal of result.refusals) if (refusal.watch) paths.add(refusal.watch)
  return [...paths]
}

/**
 * A child parse cache keyed on identity plus modification time.
 *
 * Without it a preview re-reads every target on every keystroke. Keyed on mtime
 * rather than on content so a stale entry cannot outlive an edit made outside
 * the editor, and stat'ed rather than trusted: a file whose mtime cannot be read
 * is treated as changed, which costs a read and never serves the wrong bytes.
 */
export class IncludeCache {
  private entries = new Map<string, { mtimeMs: number; source: string }>()

  get(id: string): string | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    const mtimeMs = modifiedAt(id)
    if (mtimeMs === undefined || mtimeMs !== entry.mtimeMs) {
      this.entries.delete(id)
      return undefined
    }
    return entry.source
  }

  set(id: string, source: string): void {
    const mtimeMs = modifiedAt(id)
    if (mtimeMs === undefined) return
    this.entries.set(id, { mtimeMs, source })
  }

  /** Drop one target, or everything when no target is named. */
  invalidate(id?: string): void {
    if (id === undefined) this.entries.clear()
    else this.entries.delete(id)
  }

  get size(): number {
    return this.entries.size
  }
}

function modifiedAt(id: string): number | undefined {
  try {
    return statSync(id).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * A codepoint offset as a UTF-16 offset.
 *
 * `IncludeWarning.start` and `.end` count CODEPOINTS. Every offset on the VS
 * Code side - `Position`, `Range`, `TextDocument.positionAt`, `String.slice` -
 * counts UTF-16 units. The two coincide for every character below U+10000,
 * which is why feeding one straight into the other shipped: an ASCII fixture
 * cannot see the difference, and a document with one emoji drifts every later
 * diagnostic by one unit (#212).
 *
 * Translated at the boundary rather than anywhere deeper, so the engine's unit
 * stays the engine's and the editor's stays the editor's.
 */
export function utf16Offset(source: string, codepointOffset: number): number {
  if (codepointOffset < 0) return 0
  let codepoints = 0
  let units = 0
  for (const character of source) {
    if (codepoints === codepointOffset) return units
    codepoints++
    units += character.length
  }
  return units
}

type V2Resolved = { text: string; id: string } | { error: 'not_found' | 'outside_root' | 'unreadable' }

const OUTSIDE_ROOT: ReadonlySet<IncludeDenial> = new Set(['outside-root', 'absolute-denied', 'remote-not-allowed'])

interface PosNode {
  pos?: { startOffset: number; endOffset: number; file?: string }
  [key: string]: unknown
}

/**
 * The range of a diagnostic in the ROOT source, as codepoint offsets. A
 * diagnostic raised inside a child is anchored at the outermost node of its
 * path that sits in the root, which is the directive that pulled the child in.
 */
function rootRange(doc: unknown, diagnostic: EngineDiagnostic, rootFile: string): { start: number; end: number } | undefined {
  if (diagnostic.range && (diagnostic.file === undefined || diagnostic.file === rootFile)) {
    return { start: diagnostic.range.startOffset, end: diagnostic.range.endOffset }
  }
  let node = doc as PosNode | undefined
  let anchor: { start: number; end: number } | undefined
  for (const segment of (diagnostic.path ?? '').split('/').slice(1)) {
    const next = (node as Record<string, unknown> | undefined)?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')]
    node = next as PosNode | undefined
    if (!node || typeof node !== 'object') break
    if (node.pos && node.pos.file === undefined) anchor = { start: node.pos.startOffset, end: node.pos.endOffset }
  }
  return anchor
}

/** Byte offset to codepoint offset, and the 1-based line and column there. */
function locate(source: string, byte: number): { offset: number; line: number; column: number } {
  let bytes = 0
  let offset = 0
  let line = 1
  let column = 1
  for (const character of source) {
    if (bytes >= byte) break
    bytes += Buffer.byteLength(character)
    offset++
    if (character === '\n') { line++; column = 1 } else column++
  }
  return { offset, line, column }
}

export function expandForRender(engine: Engine, input: ExpandInput): ExpansionResult {
  const refusals: IncludeRefusal[] = []
  const cache = input.cache
  let chargedBytes = 0
  const resolver = (request: { path: string; from?: string }): V2Resolved => {
    const result = input.resolve(request.path, {
      sourcePath: input.sourcePath,
      stack: request.from === undefined ? [] : [request.from],
      depth: 0,
    })
    if (!result.ok) {
      refusals.push({ path: request.path, denial: result.denial, ...(result.watch ? { watch: result.watch } : {}) })
      return { error: OUTSIDE_ROOT.has(result.denial) ? 'outside_root' : 'not_found' }
    }
    const openBuffer = result.version?.startsWith('open:') === true
    const cached = openBuffer ? undefined : cache?.get(result.id)
    const source = cached ?? result.source
    if (cached === undefined && !openBuffer) cache?.set(result.id, result.source)
    chargedBytes += Buffer.byteLength(source)
    // 0.2 reads LF and CRLF line ends; a lone CR is read as LF here as the server does.
    return { text: source.replace(/\r(?!\n)/g, '\n'), id: result.id }
  }
  // Positions on: the warnings carry offsets into the parent source, and a
  // diagnostic that cannot say WHERE is barely better than none.
  const parsed = engine.parseWithDiagnostics(input.source, {
    positions: true,
    includes: { resolver, file: input.sourcePath },
    ...(input.extensions ? { extensions: input.extensions } : {}),
  })
  const warnings: IncludeWarning[] = []
  for (const diagnostic of parsed.diagnostics) {
    if (!diagnostic.code.startsWith('include')) continue
    const range = rootRange(parsed.document, diagnostic, input.sourcePath) ?? { start: 0, end: 0 }
    const start = locate(input.source, range.start)
    const end = locate(input.source, range.end)
    warnings.push({
      line: start.line,
      column: start.column,
      rule: diagnostic.code,
      message: diagnostic.message,
      start: start.offset,
      end: end.offset,
      ...(diagnostic.file !== undefined ? { file: diagnostic.file } : {}),
    })
  }
  const seen = new Set<string>()
  const dependencies: IncludeDependency[] = []
  for (const dependency of engine.includeDependencies(parsed.document)) {
    const id = dependency.file ?? dependency.path
    if (seen.has(id)) continue
    seen.add(id)
    dependencies.push({ id, resolved: dependency.read })
  }
  // After the merge and before the render: the destinations are the child's
  // until something rewrites them, and the renderer has no way to tell.
  const rebased = input.rebase === false ? 0 : rebaseChildDestinations(parsed.document, input.sourcePath)
  return {
    doc: parsed.document,
    warnings,
    suppressedWarnings: parsed.suppressedDiagnostics,
    dependencies,
    chargedBytes,
    refusals,
    rebased,
  }
}

/**
 * One line naming what a render refused, or null when it refused nothing.
 *
 * A preview that swallows a denial is worse than one that refuses loudly: a
 * missing chapter and a chapter that was never included look identical on the
 * page.
 */
export function refusalSummary(result: ExpansionResult): string | null {
  if (result.refusals.length === 0) return null
  const byClass = new Map<IncludeDenial, string[]>()
  for (const refusal of result.refusals) {
    const paths = byClass.get(refusal.denial) ?? []
    paths.push(refusal.path)
    byClass.set(refusal.denial, paths)
  }
  const parts = [...byClass].map(([denial, paths]) => `${denial}: ${[...new Set(paths)].join(', ')}`)
  const count = result.refusals.length
  return `Carve: ${count} include${count === 1 ? '' : 's'} refused. ${parts.join('; ')}`
}
