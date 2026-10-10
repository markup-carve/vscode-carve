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
// marker, not a bullet. One marker only: `* * *` is a thematic break. The
// alpha and roman branches stay disjoint so the fence prefix cannot backtrack
// exponentially.
export const MARKER = String.raw`(?:[-*]|[0-9]+[.)]|[A-Za-z][.)]|[ivxlcdm]{2,}[.)]|[IVXLCDM]{2,}[.)]|\.)`
const TASK = String.raw`\[[ xX_>?-]\]`
const BARE_MARKER = new RegExp(
  String.raw`^[ \t]*(?:>[ \t]*)*${MARKER}(?:[ \t]+${TASK})?[ \t]*$`,
)
// An opener may sit on a list or description marker line (`- - ```, `: ```),
// a closer may not.
const FENCE = new RegExp(
  String.raw`^[ \t]*((?:>[ \t]*|:[ \t]+|${MARKER}[ \t]+(?:${TASK}[ \t]+)?)*)(\x60{3,}|~{3,})(.*)$`,
)

/** Whether a line holds only a list marker (and optionally a task box). */
export function isBareListMarker(line: string): boolean {
  return BARE_MARKER.test(line)
}

/**
 * Whether `line` (0-based) sits inside a backtick or tilde code fence.
 *
 * A line scan, not a parse: it ignores container rules (an indented fence at
 * the document level counts as a fence), so an unusual shape can be misread.
 * A misread costs one flicker or one deferred render, never the output.
 */
export function isInsideCodeFence(lines: readonly string[], line: number): boolean {
  let open: string | undefined
  for (let i = 0; i < line && i < lines.length; i++) open = stepCodeFence(open, lines[i])
  return open !== undefined
}

/** For each line, whether it sits inside a code fence; one pass over the document. */
export function codeFenceMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = []
  let open: string | undefined
  for (const line of lines) {
    mask.push(open !== undefined)
    open = stepCodeFence(open, line)
  }
  return mask
}

/** The open fence run after `line`, given the one open before it. */
function stepCodeFence(open: string | undefined, line: string): string | undefined {
  const match = FENCE.exec(line)
  if (!match) return open
  const [, prefix, run, rest] = match
  if (open === undefined) {
    // A fence character after the run makes it inline code: ```code```.
    return rest.includes(run[0]) ? undefined : run
  }
  if (/^[ \t>]*$/.test(prefix) && run[0] === open[0] && run.length >= open.length && rest.trim() === '') {
    return undefined
  }
  return open
}

/** Whether a render should wait while the cursor is on `line` of `text`. */
export function shouldHoldRender(text: string, line: number): boolean {
  const lines = text.split(/\r\n|\r|\n/)
  if (line < 0 || line >= lines.length) return false
  return isBareListMarker(lines[line]) && !isInsideCodeFence(lines, line)
}
