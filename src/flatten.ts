/**
 * Flatten a document: one self-contained `.crv` with every include merged in.
 *
 * Deliberately a separate command from the Carve export rather than a mode of
 * it. Spec I15 requires writing a document back as Carve to return the AUTHOR's
 * document, so a plain Carve export must preserve a directive verbatim;
 * flattening asks for the other document, the one that can be handed to
 * something with no filesystem behind it.
 *
 * Expansion goes through the shared include path, then the engine's `flatten`,
 * the call `carve flatten` makes, splices each include's children in place and
 * runs the Carve WRITER. Nothing here reimplements the merge semantics, which is
 * what keeps this from diverging from the CLI silently (#198).
 *
 * NOT REBASED, on purpose. A child's relative destinations are rewritten for a
 * RENDER (#192) because the result is resolved from the parent's folder. `carve
 * flatten` does not rewrite them, and matching it byte for byte is worth more
 * here than being independently right: a flattened file that differs from the
 * CLI's is a bug nobody can see. The gap is real and is filed rather than left
 * unsaid.
 *
 * Kept free of `vscode` imports, like the rest of this tier.
 */
import { expandForRender, type Engine, type ExpandInput, type ExpansionResult } from './include-expansion.js'

/** The engine call this module needs, so a test can see exactly what is called. */
export interface Writer {
  flatten: (doc: unknown) => { source: string; same: boolean }
}

export interface FlattenResult {
  text: string
  expansion: ExpansionResult
  /**
   * True when the flattened copy renders differently from the expanded
   * document. Keys that two files each define once are scoped per file
   * (C2-N-054, C2-N-055) and meet in one scope in the copy; `carve flatten`
   * refuses such a file, this command writes it and says so.
   */
  changed: boolean
}

export function flattenDocument(
  engine: Engine & Writer,
  input: Omit<ExpandInput, 'rebase'>,
): FlattenResult {
  const expansion = expandForRender(engine, { ...input, rebase: false })
  const { source, same } = engine.flatten(expansion.doc)
  return { text: source, expansion, changed: !same }
}

export const MAX_FLATTEN_CANDIDATES = 100

export function flattenPath(documentPath: string, exists: (candidate: string) => boolean): string | null {
  const stem = documentPath.replace(/\.crv$/i, '')
  for (let n = 1; n <= MAX_FLATTEN_CANDIDATES; n++) {
    const candidate = n === 1 ? `${stem}.flat.crv` : `${stem}.flat-${n}.crv`
    if (!exists(candidate)) return candidate
  }
  return null
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * One line stating what the reader got and the two things that changed without
 * being visible in it.
 */
export function flattenSummary(result: FlattenResult, destination: string): string {
  const merged = result.expansion.dependencies.filter((dependency) => dependency.resolved).length
  const parts = [
    `Flattened ${count(merged, 'included file')} into ${destination}.`,
    'The output is canonical Carve, so formatting is normalized rather than preserved.',
  ]
  if (result.changed) {
    parts.push('A footnote, reference or abbreviation key is defined in more than one file, so the flattened copy renders differently.')
  }
  const refused = result.expansion.refusals.length
  if (refused > 0) {
    parts.push(`${count(refused, 'include')} could not be read, so ${refused === 1 ? 'its' : 'their'} directive is still in the output.`)
  }
  return parts.join(' ')
}
