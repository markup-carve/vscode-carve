/**
 * Whether the preview should keep its last render while the author types a
 * new list item.
 *
 * A marker with nothing after it is paragraph text, so `- ` typed under a list
 * folds into the item above for one keystroke and the preview flickers through
 * a reading the author never meant. Kept free of the `vscode` module so it can
 * be unit tested.
 */

// Same marker set as the grammar's container rules; `+` is the continuation
// marker, not a bullet. One marker only: `* * *` is a thematic break.
const MARKER = String.raw`(?:[-*]|[0-9]+[.)]|[A-Za-z][.)]|[ivxlcdm]+[.)]|[IVXLCDM]+[.)]|\.)`
const TASK = String.raw`\[[ xX_>?-]\]`
const BARE_MARKER = new RegExp(
  String.raw`^[ \t]*(?:>[ \t]*)*${MARKER}(?:[ \t]+${TASK})?[ \t]*$`,
)
const FENCE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})(.*)$/

/** Whether a line holds only a list marker (and optionally a task box). */
export function isBareListMarker(line: string): boolean {
  return BARE_MARKER.test(line)
}

/**
 * Whether `line` (0-based) sits inside a backtick or tilde code fence.
 *
 * A line scan, not a parse: it ignores container rules, so an indented fence
 * at the document level counts as a fence. Erring that way only skips a hold.
 */
export function isInsideCodeFence(lines: readonly string[], line: number): boolean {
  let open: string | undefined
  for (let i = 0; i < line && i < lines.length; i++) {
    const match = FENCE.exec(lines[i])
    if (!match) continue
    const run = match[1]
    if (open === undefined) {
      open = run
    } else if (run[0] === open[0] && run.length >= open.length && match[2].trim() === '') {
      open = undefined
    }
  }
  return open !== undefined
}

/** Whether a render should wait while the cursor is on `line` of `text`. */
export function shouldHoldRender(text: string, line: number): boolean {
  const lines = text.split(/\r\n|\r|\n/)
  if (line < 0 || line >= lines.length) return false
  return isBareListMarker(lines[line]) && !isInsideCodeFence(lines, line)
}
