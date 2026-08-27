/**
 * The two decisions that keep editor and preview from chasing each other.
 *
 * Both sides sync to the other, so without these a keystroke becomes: viewport
 * moves, preview scrolls, preview reports its top line, editor is revealed to
 * it, viewport moves. That loop is what made the editor jitter while typing.
 *
 * Kept free of the `vscode` module so they can be unit tested.
 */

/** How long after an edit a viewport change is still attributed to typing. */
export const EDIT_SETTLE_MS = 250

/** Whether a line is already on screen, and so needs no reveal. */
export function isLineOnScreen(
  target: number,
  ranges: readonly { start: { line: number }; end: { line: number } }[],
): boolean {
  return ranges.some((visible) => target >= visible.start.line && target <= visible.end.line)
}

/** Whether a viewport change is a real scroll rather than the result of typing. */
export function isScrollNotTyping(now: number, editedAt: number): boolean {
  return now - editedAt >= EDIT_SETTLE_MS
}
