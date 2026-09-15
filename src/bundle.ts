/**
 * Export a document together with every file it includes.
 *
 * Deliberately NOT flattening. Flattening merges the children into the parent,
 * which needs the engine's expansion pass; the engine bundled here carries no
 * include code at all and its pin cannot move while issue 183 is open (see 198).
 * A bundle
 * needs none of that: the include WALK the language server already performs
 * reports every target it touched, resolved and attempted alike, so the file
 * list is a value handed over rather than something to compute, and the files
 * are COPIED rather than merged. No spec section 19 merge semantics are
 * reimplemented here, which is the whole reason this half is reachable.
 *
 * It is also the right shape for "send it to a colleague who will keep editing
 * it": the directives survive, so the recipient gets a document that is still a
 * document rather than one long file.
 *
 * Kept free of `vscode` imports, like `./includes.js`, so it can be driven
 * against the installed language server's own walk in a test.
 */
import path from 'node:path'

/** Names listed before a miss report stops enumerating. */
export const MISSING_SHOWN = 3

/** A child the walk read, as `resolveIncludes` reports it. */
export interface WalkedDocument {
  /** Canonical absolute path the resolver returned. */
  id: string
  source: string
}

/** A target the walk touched, resolved or not. */
export interface WalkedDependency {
  id: string
  resolved: boolean
}

export interface IncludeWalk {
  documents: readonly WalkedDocument[]
  dependencies: readonly WalkedDependency[]
}

export interface BundleInput {
  /** Absolute path of the document being bundled. */
  documentPath: string
  source: string
  /**
   * Containment root the walk ran under, as the SERVER'S gate decided it - not
   * a root derived again here. Two answers to that question is one answer too
   * many when the question is what a document may read.
   */
  includeRoot: string
  walk: IncludeWalk
}

export interface BundleFile {
  /** Path inside the bundle, relative to its root, always `/`-separated. */
  path: string
  source: string
}

export interface Bundle {
  files: BundleFile[]
  /** Targets the walk could not read; they have no bytes to copy. */
  missing: string[]
}

/**
 * `target` relative to `root`, or null when it is not inside it.
 *
 * The walk cannot hand back a target outside the root - containment is the
 * resolver's job and it does it by canonical path. This is here so that if one
 * ever did, the file is dropped instead of being written outside the bundle
 * directory by a `..` in its relative path.
 */
export function bundlePath(root: string, target: string): string | null {
  const relative = path.relative(root, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative.split(path.sep).join('/')
}

/** The document and every file it reached, ready to be written out. */
export function buildBundle(input: BundleInput): Bundle {
  const files: BundleFile[] = []
  const seen = new Set<string>()
  const add = (id: string, source: string): void => {
    const where = bundlePath(input.includeRoot, id)
    if (where === null || seen.has(where)) return
    seen.add(where)
    files.push({ path: where, source })
  }
  add(input.documentPath, input.source)
  for (const document of input.walk.documents) add(document.id, document.source)
  return {
    files,
    missing: input.walk.dependencies.filter((dependency) => !dependency.resolved).map((dependency) => dependency.id),
  }
}

/**
 * A free directory for the bundle of `documentPath`, or null when the names are
 * all taken.
 *
 * Derived from the document's own path rather than typed, so the destination
 * cannot be steered somewhere else and there is no empty string to resolve
 * against the process working directory.
 */
export const MAX_BUNDLE_CANDIDATES = 100

export function bundleDirectory(documentPath: string, exists: (candidate: string) => boolean): string | null {
  const directory = path.dirname(documentPath)
  const stem = path.basename(documentPath).replace(/\.[^.]+$/, '')
  for (let n = 1; n <= MAX_BUNDLE_CANDIDATES; n++) {
    const candidate = path.join(directory, n === 1 ? `${stem}.bundle` : `${stem}.bundle-${n}`)
    if (!exists(candidate)) return candidate
  }
  return null
}

function count(n: number, noun: string): string { return `${n} ${noun}${n === 1 ? '' : 's'}` }

/**
 * One line telling the reader what they got and what they did not.
 *
 * A target that failed to resolve has no bytes to copy, so it is named rather
 * than silently dropped: a bundle quietly missing a chapter looks exactly like
 * a bundle that never needed it.
 */
export function bundleSummary(bundle: Bundle, destination: string): string {
  const parts = [`Bundled ${count(bundle.files.length, 'file')} into ${destination}.`, 'Directives are kept, so the bundle is still a set of documents.']
  if (bundle.missing.length > 0) {
    const shown = bundle.missing.slice(0, MISSING_SHOWN).join(', ')
    const rest = bundle.missing.length - MISSING_SHOWN
    parts.push(`${count(bundle.missing.length, 'include')} could not be read and ${bundle.missing.length === 1 ? 'is' : 'are'} not in it: ${shown}${rest > 0 ? `, and ${rest} more` : ''}.`)
  }
  return parts.join(' ')
}
