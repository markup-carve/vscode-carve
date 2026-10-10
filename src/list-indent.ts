/**
 * The pure half of Tab / Shift+Tab on list items: which lines are list items,
 * what the server's `carve.listIndent` answer means, and when to hand the key
 * back to VS Code. Kept free of the `vscode` module so it can be unit tested.
 */
import { codeFenceMask, MARKER } from './preview-hold.js'

export const LIST_INDENT_COMMAND = 'carve.listIndent'

export type ListIndentDirection = 'indent' | 'outdent'

export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface LspTextEdit {
  range: LspRange
  newText: string
}

// A marker followed by a space or the end of the line, so `-a` and `1.5` stay
// text. `+` is the continuation marker, not a bullet.
const LIST_ITEM = new RegExp(String.raw`^[ \t]*(?:>[ \t]*)*${MARKER}(?: |$)`)
const THEMATIC_BREAK = /^[ \t]*(?:>[ \t]*)*([-*_])(?:[ \t]*\1){2,}[ \t]*$/

/** Whether a line starts a list item (bare marker or marker with content). */
export function isListItemLine(line: string): boolean {
  return LIST_ITEM.test(line) && !THEMATIC_BREAK.test(line)
}

/**
 * The list item lines the selections touch, outside code fences, ascending.
 * A selection ending at column 0 of a later line leaves that line out, as
 * VS Code's own indent does. Empty when any selection does not start on a list
 * item line: a mixed selection keeps VS Code's own indent for every line
 * rather than moving only some of them. Lines below a selection's first line
 * that are not items are item content, which the server moves with its item.
 */
export function selectedListLines(text: string, selections: readonly LspRange[]): number[] {
  if (selections.length === 0) return []
  const lines = text.split(/\r\n|\r|\n/)
  let fenced: boolean[] | undefined
  const isItem = (line: number): boolean => {
    if (line < 0 || line >= lines.length || !isListItemLine(lines[line])) return false
    fenced ??= codeFenceMask(lines)
    return !fenced[line]
  }
  const wanted = new Set<number>()
  for (const { start, end } of selections) {
    const from = Math.min(start.line, end.line)
    let to = Math.max(start.line, end.line)
    const last = start.line > end.line ? start : end
    if (to > from && last.character === 0) to--
    if (!isItem(from)) return []
    for (let line = from; line <= to; line++) if (isItem(line)) wanted.add(line)
  }
  return [...wanted].sort((a, b) => a - b)
}

/**
 * The edits for `uri` in a `carve.listIndent` answer, or an empty list for
 * "no edit". Accepts a TextEdit[] or a WorkspaceEdit; anything else (null, an
 * acknowledgement after the server applied the edit itself) reads as none.
 */
export function listIndentEdits(result: unknown, uri: string): LspTextEdit[] {
  if (Array.isArray(result)) return result.filter(isTextEdit)
  if (!result || typeof result !== 'object') return []
  const edit = result as {
    changes?: Record<string, unknown>
    documentChanges?: unknown
  }
  if (edit.changes && typeof edit.changes === 'object') {
    return Object.entries(edit.changes)
      .filter(([key, edits]) => sameUri(key, uri) && Array.isArray(edits))
      .flatMap(([, edits]) => (edits as unknown[]).filter(isTextEdit))
  }
  if (Array.isArray(edit.documentChanges)) {
    const documents = edit.documentChanges.filter(
      (change): change is { textDocument: { uri: string }; edits: unknown[] } =>
        !!change && typeof change === 'object' && Array.isArray((change as { edits?: unknown }).edits),
    )
    return documents
      .filter((change) => typeof change.textDocument?.uri === 'string' && sameUri(change.textDocument.uri, uri))
      .flatMap((change) => change.edits.filter(isTextEdit))
  }
  return []
}

/** URI equality across percent-encoding and Windows drive-letter case. */
function sameUri(a: string, b: string): boolean {
  return a === b || normalizeUri(a) === normalizeUri(b)
}

function normalizeUri(uri: string): string {
  let decoded = uri
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    // A malformed escape compares as written.
  }
  return decoded.replace(/^file:\/\/\/([A-Za-z]):/, (_, drive: string) => `file:///${drive.toLowerCase()}:`)
}

function isTextEdit(value: unknown): value is LspTextEdit {
  if (!value || typeof value !== 'object') return false
  const edit = value as Partial<LspTextEdit>
  return typeof edit.newText === 'string' && isPosition(edit.range?.start) && isPosition(edit.range?.end)
}

function isPosition(value: unknown): value is LspPosition {
  return !!value && typeof (value as LspPosition).line === 'number'
    && typeof (value as LspPosition).character === 'number'
}

/**
 * One edit from the per-line answers. Each answer was computed against the
 * same text, so an answer that overlaps an earlier one (a child line the
 * parent's move already carries) is dropped whole rather than applied twice.
 */
export function mergeListIndentEdits(answers: readonly LspTextEdit[][]): LspTextEdit[] {
  const taken: LspTextEdit[] = []
  for (const answer of answers) {
    if (answer.some((edit) => taken.some((other) => overlaps(edit.range, other.range)))) continue
    taken.push(...answer)
  }
  return taken
}

function compare(a: LspPosition, b: LspPosition): number {
  return a.line - b.line || a.character - b.character
}

function overlaps(a: LspRange, b: LspRange): boolean {
  // Two insertions at one point conflict too: their order would be a guess.
  if (compare(a.start, b.start) === 0) return true
  return compare(a.start, b.end) < 0 && compare(b.start, a.end) < 0
}

/** Whether the server advertises `carve.listIndent` (carve-lsp 0.1.9 does not). */
export function serverHasListIndent(commands: readonly string[] | undefined): boolean {
  return commands?.includes(LIST_INDENT_COMMAND) ?? false
}

/**
 * Whether the key goes back to VS Code's own `tab` / `outdent`: the server
 * cannot answer, or it answered with no edit and did not change the document
 * itself through workspace/applyEdit.
 */
export function useDefaultKey(state: {
  serverReady: boolean
  edits: number
  documentChanged: boolean
}): boolean {
  return !state.serverReady || (state.edits === 0 && !state.documentChanged)
}
