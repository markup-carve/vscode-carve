import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWithLayout } from '@markup-carve/carve'
import oniguruma from 'vscode-oniguruma'
import vsctm from 'vscode-textmate'
import { delimitedColumnRanges } from './delimited-columns.js'

export interface TableMarker {
  line: number
  start: number
  end: number
  kind: 'boundary' | 'operator' | 'tableHeader' | 'tableAlignment' | 'tableSpan' | 'tableContinuation' | 'plain' | 'tableBody' | 'listMarker' | 'listPunctuation' | 'continuationMarker' | 'quoteMarker' | 'definitionMarker' | 'containerMarker' | 'strong' | 'emphasis' | 'diffAdd' | 'diffRemove' | 'delimitedColumn' | 'taskOpen' | 'taskProgress' | 'taskBlocked' | 'taskDone' | 'taskDropped' | 'taskDeferred' | 'taskUncertain'
  /** Field index, for `delimitedColumn` only. */
  column?: number
}

interface TreeNode {
  type: string
  pos?: { startOffset: number; endOffset: number }
  syntax?: string
  value?: string
  attrs?: { classes?: string[] }
  [key: string]: unknown
}

type ParseWithLayout = typeof parseWithLayout

const TASK_KIND: Record<string, TableMarker['kind']> = {
  ' ': 'taskOpen', _: 'taskOpen', '/': 'taskProgress', '!': 'taskBlocked',
  x: 'taskDone', X: 'taskDone', '-': 'taskDropped', '>': 'taskDeferred', '?': 'taskUncertain',
}

const isNode = (value: unknown): value is TreeNode =>
  typeof value === 'object' && value !== null && typeof (value as TreeNode).type === 'string'

/** Each child node with its RFC 6901 path, in source order. */
function childNodes(node: TreeNode, path: string): Array<[TreeNode, string]> {
  const children: Array<[TreeNode, string]> = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'pos' || key === 'attrs') continue
    if (Array.isArray(value)) {
      value.forEach((child, index) => { if (isNode(child)) children.push([child, `${path}/${key}/${index}`]) })
    } else if (isNode(value)) {
      children.push([value, `${path}/${key}`])
    }
  }
  return children
}

function sourceMarkers(text: string, lines: string[], parse: ParseWithLayout): { markers: TableMarker[]; codeLines: Set<number>; tableLines: Set<number> } {
  const { document, layout } = parse(text)
  const formats = new Map(layout.nodes.map((entry) => [entry.path, entry.sourceFormat]))
  const boundaries = new Set<number>([0])
  const collect = (node: TreeNode, path: string): void => {
    if (node.pos) {
      boundaries.add(node.pos.startOffset)
      boundaries.add(node.pos.endOffset)
    }
    for (const [child, childPath] of childNodes(node, path)) collect(child, childPath)
  }
  collect(document as unknown as TreeNode, '')
  // Tree offsets are UTF-8 bytes; editor columns are UTF-16 code units.
  const locations = new Map<number, { line: number; column: number }>([[0, { line: 0, column: 0 }]])
  let byte = 0
  let line = 0
  let column = 0
  for (const character of text) {
    byte += Buffer.byteLength(character)
    if (character === '\n') { line++; column = 0 } else { column += character.length }
    if (boundaries.has(byte)) locations.set(byte, { line, column })
  }
  const markers: TableMarker[] = []
  const codeLines = new Set<number>()
  const tableLines = new Set<number>()
  const add = (lineNumber: number, start: number, end: number, kind: TableMarker['kind']) => {
    if (end > start) markers.push({ line: lineNumber, start, end, kind })
  }
  const fenceAt = (from: number, to: number, indent: number): { row: number; closer: RegExp } | undefined => {
    for (let row = from; row <= to; row++) {
      const fence = lines[row]?.slice(indent).match(/^(`{3,}|~{3,})/)
      if (fence) {
        return { row, closer: new RegExp(`^${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}[ \\t]*\r?$`) }
      }
    }
    return undefined
  }
  const walk = (node: TreeNode, path: string): void => {
    const start = node.pos && locations.get(node.pos.startOffset)
    const end = node.pos && locations.get(node.pos.endOffset)
    if (start && end) {
      if (node.type === 'code_block' || node.type === 'raw_block') {
        for (let row = start.line; row <= end.line; row++) codeLines.add(row)
      }
      if (node.type === 'code_block' && node.attrs?.classes?.includes('diff') && node.value) {
        const fence = fenceAt(start.line, end.line, start.column)
        if (fence) {
          node.value.split('\n').forEach((contentLine, index) => {
            const marker = contentLine[0]
            if (marker !== '+' && marker !== '-') return
            const row = fence.row + index + 1
            const sourceLine = lines[row]
            if (!sourceLine?.endsWith(contentLine)) return
            const column = sourceLine.length - contentLine.length
            add(row, column, column + 1, marker === '+' ? 'diffAdd' : 'diffRemove')
          })
        }
      }
      const tableFormat = node.type === 'table' ? formats.get(path) : undefined
      const delimited = tableFormat ?? (node.type === 'code_block' ? node.syntax : undefined)
      if (delimited === 'csv' || delimited === 'tsv') {
        const separator = delimited === 'csv' ? ',' : '\t'
        const fence = fenceAt(start.line, end.line, start.column)
        if (fence) {
          const body: string[] = []
          for (let row = fence.row + 1; row < lines.length && row <= end.line; row++) {
            const text = lines[row].slice(start.column)
            if (fence.closer.test(text)) break
            body.push(text)
          }
          const ranges = delimitedColumnRanges(body, separator)
          ranges.forEach((range, index) => {
            const row = fence.row + 1 + range.line
            markers.push({
              line: row,
              start: start.column + range.start,
              end: start.column + range.end,
              kind: 'delimitedColumn',
              column: range.column,
            })
            // Cells of a CSV or TSV table carry no positions (C2-A-158), so the
            // separators come from the field ranges.
            const next = ranges[index + 1]
            if (tableFormat && next && next.line === range.line && next.column === range.column + 1
              && body[range.line]?.slice(range.end, next.start) === separator) {
              add(row, start.column + range.end, start.column + next.start, 'boundary')
            }
          })
        }
      }
      if (tableFormat === 'csv' || tableFormat === 'tsv') {
        for (let row = start.line; row <= end.line; row++) tableLines.add(row)
        const fence = fenceAt(start.line, end.line, start.column)
        for (let row = (fence?.row ?? start.line) + 1; row < end.line; row++) {
          add(row, Math.min(start.column, lines[row]?.length ?? 0), lines[row]?.length ?? 0, 'tableBody')
        }
      }
      if (node.type === 'list_item') {
        const match = lines[start.line]?.slice(start.column).match(/^(?:[-*]|\d+[.)]|[A-Za-z][.)]|\.) +(?:\[[ xX_\/>!?-]\] +)?/)
        if (match) add(start.line, start.column, start.column + match[0].length, 'listMarker')
        const task = lines[start.line]?.slice(start.column).match(/^[-*](?:\{[^{}\n]*\})? +\[([ xX_\/>!?-])\] +/)
        if (task) {
          const stateColumn = start.column + task[0].indexOf('[') + 1
          add(start.line, stateColumn, stateColumn + 1, TASK_KIND[task[1]]!)
        }
      }
      if (node.type === 'definition_term' || node.type === 'definition_description') {
        const match = lines[start.line]?.slice(start.column).match(/^:{1,2} +/)
        if (match) add(start.line, start.column, start.column + match[0].length, 'definitionMarker')
      }
      if ((node.type === 'strong' || node.type === 'emphasis') && start.line === end.line) {
        add(start.line, start.column, end.column, node.type)
      }
      if (node.type === 'div' || node.type === 'admonition') {
        const match = lines[start.line]?.slice(start.column).match(/^:{3,}/)
        if (match) add(start.line, start.column, start.column + match[0].length, 'containerMarker')
      }
    }
    for (const [child, childPath] of childNodes(node, path)) walk(child, childPath)
  }
  walk(document as unknown as TreeNode, '')
  return { markers, codeLines, tableLines }
}

/** Use the same TextMate rules as the editor, including fenced Carve blocks. */
export async function createTableMarkerScanner(
  extensionPath: string,
  parse: ParseWithLayout = parseWithLayout,
): Promise<(text: string, key?: string) => TableMarker[]> {
  const wasm = readFileSync(join(extensionPath, 'node_modules/vscode-oniguruma/release/onig.wasm'))
  await oniguruma.loadWASM(wasm.buffer)
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (source) => new oniguruma.OnigString(source),
    }),
    loadGrammar: async (scopeName) => scopeName === 'source.carve'
      ? vsctm.parseRawGrammar(
        readFileSync(join(extensionPath, 'syntaxes/carve.tmLanguage.json'), 'utf8'),
        'carve.tmLanguage.json',
      )
      : null,
  })
  const grammar = await registry.loadGrammar('source.carve')
  if (!grammar) throw new Error('Could not load the Carve TextMate grammar')

  type ScopeToken = { startIndex: number; endIndex: number; scopes: string[] }
  const cache = new Map<string, { text: string; lines: string[]; states: vsctm.StackElement[]; markers: TableMarker[][]; tokens: ScopeToken[][]; source: ReturnType<typeof sourceMarkers> | null }>()
  const reportedParserFailures = new Set<string>()
  return (text, key = '') => {
    const lines = text.split(/\r?\n/)
    const previous = cache.get(key)
    let firstChanged = 0
    if (previous) {
      while (firstChanged < lines.length && lines[firstChanged] === previous.lines[firstChanged]) {
        firstChanged++
      }
    }
    let source = previous?.text === text ? previous.source : null
    if (previous?.text !== text) {
      try {
        source = sourceMarkers(text, lines, parse)
        reportedParserFailures.delete(key)
      } catch (error) {
        if (!reportedParserFailures.has(key)) {
          console.error('Carve source highlighting failed', error)
          reportedParserFailures.add(key)
        }
      }
    }
    const states = previous?.states.slice(0, firstChanged) ?? []
    const markersByLine = previous?.markers.slice(0, firstChanged) ?? []
    const tokensByLine = previous?.tokens.slice(0, firstChanged) ?? []
    let state = firstChanged ? states[firstChanged - 1] : vsctm.INITIAL
    for (let line = firstChanged; line < lines.length; line++) {
      const sourceLine = lines[line]
      const result = grammar.tokenizeLine(sourceLine, state)
      state = result.ruleStack
      states[line] = state
      tokensByLine[line] = result.tokens
      const markers: TableMarker[] = []
      for (const token of result.tokens) {
        const scopes = token.scopes
        const kind = scopes.some((scope) => scope === 'punctuation.separator.table.carve')
          ? 'boundary'
          : scopes.some((scope) => scope.startsWith('keyword.operator.table.') || scope === 'punctuation.definition.table.separator.carve')
            ? 'operator'
            : undefined

        const has = (scope: string) => scopes.includes(scope)
        const role: TableMarker['kind'] | undefined = has('keyword.operator.table.header.carve') ? 'tableHeader'
          : has('keyword.operator.table.alignment.carve') ? 'tableAlignment'
            : has('keyword.operator.table.colspan.carve') || has('keyword.operator.table.rowspan.carve') ? 'tableSpan'
              : has('keyword.operator.table.continuation.carve') ? 'tableContinuation'
                : has('punctuation.definition.list.begin.carve')
                    && (has('markup.list.unnumbered.carve') || has('markup.list.numbered.carve')) ? 'listPunctuation'
                  : has('punctuation.definition.list.continuation.carve') || has('keyword.operator.continuation.carve') ? 'continuationMarker'
                    : has('punctuation.definition.quote.carve') ? 'quoteMarker'
                      : undefined
        if (role) markers.push({ line, start: token.startIndex, end: token.endIndex, kind: role })
        if (kind && !(kind === 'operator' && role?.startsWith('table'))) {
          markers.push({ line, start: token.startIndex, end: token.endIndex, kind })
        }
        if (has('constant.language.task-list.carve')) {
          const content = sourceLine.slice(token.startIndex, token.endIndex)
          for (const task of content.matchAll(/\[([ xX_\/>!?-])\]/g)) {
            const start = token.startIndex + task.index + 1
            markers.push({ line, start, end: start + 1, kind: TASK_KIND[task[1]]! })
          }

        }
      }
      markersByLine[line] = markers
    }
    cache.delete(key)
    cache.set(key, { text, lines, states, markers: markersByLine, tokens: tokensByLine, source })
    if (cache.size > 8) {
      const oldest = cache.keys().next().value!
      cache.delete(oldest)
      reportedParserFailures.delete(oldest)
    }
    const plainMarkers: TableMarker[] = []
    if (source) {
      for (let line = 0; line < lines.length; line++) {
        if (source.codeLines.has(line) || source.tableLines.has(line)) continue
        for (const token of tokensByLine[line] ?? []) {
          // vscode-textmate reports an empty line as one token ending at 1.
          const end = Math.min(token.endIndex, lines[line]!.length)
          if (end > token.startIndex && token.scopes.includes('markup.raw.block.fenced.code.carve')) {
            plainMarkers.push({ line, start: token.startIndex, end, kind: 'plain' })
          }
        }
      }
    }
    const parserMarkers = (source?.markers ?? []).filter((marker) => {
      if (marker.kind === 'tableBody') return true
      if (marker.kind.startsWith('task')) return !(markersByLine[marker.line] ?? []).some((candidate) =>
        candidate.start === marker.start && candidate.end === marker.end && candidate.kind === marker.kind)
      const token = tokensByLine[marker.line]?.find((candidate) => candidate.startIndex <= marker.start && candidate.endIndex > marker.start)
      const scopes = token?.scopes ?? []
      if (marker.kind === 'listMarker') return !scopes.some((scope) => scope.startsWith('markup.list.'))
      if (marker.kind === 'definitionMarker') return !scopes.some((scope) => scope.startsWith('markup.list.definition.'))
      if (marker.kind === 'containerMarker') return scopes.includes('markup.raw.block.fenced.code.carve')
      if (marker.kind === 'strong' || marker.kind === 'emphasis') {
        const expected = marker.kind === 'strong' ? 'markup.bold.carve' : 'markup.italic.carve'
        return !(tokensByLine[marker.line] ?? []).some((candidate) => candidate.startIndex < marker.end
          && candidate.endIndex > marker.start && candidate.scopes.includes(expected))
      }
      return true
    })
    return [...markersByLine.flat(), ...plainMarkers, ...parserMarkers]
  }
}
