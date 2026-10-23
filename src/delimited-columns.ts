export interface ColumnRange {
  /** Index into the lines passed in. */
  line: number
  start: number
  end: number
  /** Zero-based field index within its record. */
  column: number
}

/**
 * Field ranges of a csv or tsv fence body, one entry per field per line.
 *
 * Follows the Carve dialect (spec `scripts/spec/delimited-table.mjs`): a quoted
 * field may hold the separator, a doubled quote and a line break, so the column
 * index is carried across lines rather than reset per line. Separators are not
 * part of any range. Invalid quoting returns `[]`, the same input the engine
 * leaves as a code block.
 */
export function delimitedColumnRanges(lines: readonly string[], separator: ',' | '\t'): ColumnRange[] {
  const ranges: ColumnRange[] = []
  let column = 0
  let quoted = false
  let closed = false
  let atStart = true
  let fieldStart = 0
  const close = (line: number, end: number): void => {
    if (end > fieldStart) ranges.push({ line, start: fieldStart, end, column })
  }
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line].endsWith('\r') ? lines[line].slice(0, -1) : lines[line]
    fieldStart = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            i++
          } else {
            quoted = false
            closed = true
          }
        }
        continue
      }
      if (ch === separator) {
        close(line, i)
        column++
        fieldStart = i + 1
        closed = false
        atStart = true
      } else if (ch === '"') {
        if (!atStart || closed) return []
        quoted = true
        atStart = false
      } else {
        if (closed) return []
        atStart = false
      }
    }
    close(line, text.length)
    if (!quoted) {
      column = 0
      closed = false
      atStart = true
    }
  }
  return quoted ? [] : ranges
}

/**
 * Column markers split into one list per palette color; every list is empty
 * while the setting is off, so turning it off clears the decorations.
 */
export function columnColorGroups<T extends { kind: string; column?: number }>(
  markers: readonly T[],
  enabled: boolean,
  colors: number,
): T[][] {
  const groups: T[][] = Array.from({ length: colors }, () => [])
  if (!enabled) return groups
  for (const marker of markers) {
    if (marker.kind === 'delimitedColumn') groups[(marker.column ?? 0) % colors].push(marker)
  }
  return groups
}
