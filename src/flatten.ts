/**
 * Flatten a document: one self-contained `.crv` with every include merged in.
 *
 * Deliberately a separate command from the Carve export rather than a mode of
 * it. Spec I15 requires writing a document back as Carve to return the AUTHOR's
 * document, so a plain Carve export must preserve a directive verbatim;
 * flattening asks for the other document, the one that can be handed to
 * something with no filesystem behind it.
 *
 * The two calls are the ones `carve flatten` makes, in the same order, against
 * the same engine: expand, then run the Carve WRITER. Nothing here reimplements
 * section 19's merge semantics, which is what keeps this from diverging from the
 * CLI silently (#198).
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

/** The writer this module needs, so a test can see exactly what is called. */
export interface Writer {
  renderCarve: (doc: unknown) => string
}

export interface FlattenResult {
  text: string
  expansion: ExpansionResult
  /**
   * Explicit ids and footnote labels the merge had to rename because two
   * children used the same one (I5). Counted from the warnings rather than
   * guessed: a flattened document can carry `intro-2`, and someone finding that
   * in a published page instead of in this report is the failure being avoided.
   */
  renames: number
}

const RENAME_RULES = new Set(['include-heading-id-rename', 'include-footnote-rename'])

export function flattenDocument(
  engine: Engine & Writer,
  input: Omit<ExpandInput, 'rebase'>,
): FlattenResult {
  const expansion = expandForRender(engine, { ...input, rebase: false })
  return {
    text: engine.renderCarve(expansion.doc),
    expansion,
    renames: expansion.warnings.filter((warning) => RENAME_RULES.has(warning.rule)).length,
  }
}

/**
 * A free path for the flattened document, or null when the names are taken.
 *
 * Derived from the document's own path rather than typed, so the destination
 * cannot be steered somewhere else and there is no empty string to resolve
 * against the process working directory.
 */
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
  if (result.renames > 0) {
    parts.push(`${count(result.renames, 'colliding id or footnote label')} ${result.renames === 1 ? 'was' : 'were'} renamed (spec I5).`)
  }
  const refused = result.expansion.refusals.length
  if (refused > 0) {
    parts.push(`${count(refused, 'include')} could not be read, so ${refused === 1 ? 'its' : 'their'} directive is still in the output.`)
  }
  return parts.join(' ')
}
