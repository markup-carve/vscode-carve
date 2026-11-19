/**
 * Flatten a document: one self-contained `.crv` with every include merged in.
 *
 * Deliberately a separate command from the Carve export rather than a mode of
 * it. Spec I15 requires writing a document back as Carve to return the AUTHOR's
 * document, so a plain Carve export must preserve a directive verbatim;
 * flattening asks for the other document, the one that can be handed to
 * something with no filesystem behind it.
 *
 * The steps are the ones `carve flatten` makes, in the same order, against the
 * same engine: expand, splice each include's children in place, then run the
 * Carve WRITER. Nothing here reimplements the merge semantics, which is what
 * keeps this from diverging from the CLI silently (#198).
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
  write: (doc: unknown) => string
  render: (source: unknown) => string
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

interface Node {
  type: string
  children?: Node[]
  [key: string]: unknown
}

// The splice of carve-js `cli/flatten.ts`, which the engine does not export yet.
function spliced(nodes: readonly Node[]): Node[] {
  const result: Node[] = []
  for (const node of nodes) {
    // An include that did not expand has no children and keeps its directive.
    if (node.type === 'include' && node.children !== undefined) {
      result.push(...spliced((node.children ?? []).filter((child) => child.type !== 'frontmatter')))
    } else result.push(withSplicedSlots(node))
  }
  return result
}

function withSplicedSlots(node: Node): Node {
  let copy: Node | undefined
  for (const [key, value] of Object.entries(node)) {
    if (!Array.isArray(value) || !value.some((item) => typeof item === 'object' && item !== null && 'type' in item)) continue
    copy ??= { ...node }
    copy[key] = spliced(value as Node[])
  }
  return copy ?? node
}

export function flattenDocument(
  engine: Engine & Writer,
  input: Omit<ExpandInput, 'rebase'>,
): FlattenResult {
  const expansion = expandForRender(engine, { ...input, rebase: false })
  const document = expansion.doc as Node
  const tree: Node = { ...document, children: spliced(document.children ?? []) }
  delete tree.stages
  const text = engine.write(tree)
  return { text, expansion, changed: engine.render(text) !== engine.render(document) }
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
