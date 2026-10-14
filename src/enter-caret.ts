/**
 * Where the caret belongs after Enter's on-type answer. Kept free of the
 * `vscode` module so it can be unit tested.
 *
 * carve-lsp closes a `:::` container or a code fence on Enter. When a line
 * follows the cursor it puts the closer at that line's start, which leaves the
 * caret alone. On the last line there is nowhere after the caret to insert, so
 * the answer is one insert AT the caret, and VS Code moves the caret past all
 * of it, after the closer. Only the text before the insert's first newline
 * (a `> ` lead) belongs in front of the caret.
 */

export interface CaretPosition {
  line: number
  character: number
}

export interface CaretEdit {
  range: { start: CaretPosition; end: CaretPosition }
  newText: string
}

const samePosition = (a: CaretPosition, b: CaretPosition): boolean =>
  a.line === b.line && a.character === b.character

/**
 * The caret after [edits] when they carry an insert at [caret] that holds a
 * newline, or undefined when the client's own placement is right. Any other
 * edit before or around the caret gives undefined too: the server never sends
 * one with a closer, and guessing would be worse than VS Code's default.
 */
export function enterCaretTarget(caret: CaretPosition, edits: readonly CaretEdit[]): CaretPosition | undefined {
  const atCaret = edits.filter(({ range }) => samePosition(range.start, caret) && samePosition(range.end, caret))
  if (atCaret.length !== 1 || !atCaret[0].newText.includes('\n')) return undefined
  const before = (p: CaretPosition): boolean => p.line < caret.line || (p.line === caret.line && p.character < caret.character)
  if (edits.some((edit) => edit !== atCaret[0] && before(edit.range.start))) return undefined
  const lead = atCaret[0].newText.slice(0, atCaret[0].newText.search(/\r\n|\r|\n/))
  return { line: caret.line, character: caret.character + lead.length }
}

/** Where VS Code leaves the caret after applying [newText] as an insert at [start]: after all of it. */
export function parkedCaret(start: CaretPosition, newText: string): CaretPosition {
  const lines = newText.split(/\r\n|\r|\n/)
  const last = lines[lines.length - 1]
  return lines.length === 1
    ? { line: start.line, character: start.character + last.length }
    : { line: start.line + lines.length - 1, character: last.length }
}
