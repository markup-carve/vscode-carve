import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWithSourceLayout } from '@markup-carve/carve'
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

interface AstNode {
  type: string
  pos?: { startLine: number; endLine: number; startColumn: number; endColumn: number }
  sourceFormat?: string
  lang?: string
  content?: string
  attrs?: { classes?: string[] }
  children?: AstNode[]
  items?: AstNode[]
  rows?: AstNode[]
  cells?: AstNode[]
  caption?: AstNode[]
  title?: AstNode[]
  target?: AstNode
}

const TASK_KIND: Record<string, TableMarker['kind']> = {
  ' ': 'taskOpen', _: 'taskOpen', '/': 'taskProgress', '!': 'taskBlocked',
  x: 'taskDone', X: 'taskDone', '-': 'taskDropped', '>': 'taskDeferred', '?': 'taskUncertain',
}

function standaloneContinuationMarkers(lines: string[], ast: AstNode): TableMarker[] {
  const occupied: NonNullable<AstNode['pos']>[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    const value = node as AstNode
    if (value.type === 'link' && value.pos) occupied.push(value.pos)
    const children = Object.entries(value).filter(([key, child]) => key !== 'pos' && key !== 'attrs' && child && typeof child === 'object')
    if (children.length) children.forEach(([, child]) => visit(child))
    else if (value.pos) occupied.push(value.pos)
  }
  visit(ast)
  const markers: TableMarker[] = []
  lines.forEach((line, index) => {
    if (!/^(?:[ \t]*>[ \t]+)*[ \t]*\+[ \t]*$/.test(line)) return
    const start = line.indexOf('+')
    const column = [...line.slice(0, start)].length + 1
    const lineNumber = index + 1
    if (occupied.some((pos) => lineNumber >= pos.startLine && lineNumber <= pos.endLine
      && (lineNumber !== pos.startLine || column >= pos.startColumn)
      && (lineNumber !== pos.endLine || column < pos.endColumn))) return
    markers.push({ line: index, start, end: start + 1, kind: 'continuationMarker' })
  })
  return markers

}

function sourceMarkers(text: string, lines: string[], parse: typeof parseWithSourceLayout): { markers: TableMarker[]; codeLines: Set<number>; tableLines: Set<number> } {
  const { ast, layout } = parse(text)
  const boundaries = new Set<number>([0])
  for (const span of layout.nodes) {
    boundaries.add(span.startByte)
    boundaries.add(span.endByte)
  }
  const locations = new Map<number, { line: number; column: number }>([[0, { line: 0, column: 0 }]])
  let byte = 0
  let line = 0
  let column = 0
  for (const character of text) {
    byte += Buffer.byteLength(character)
    if (character === '\n') { line++; column = 0 } else { column += character.length }
    if (boundaries.has(byte)) locations.set(byte, { line, column })
  }
  const spans = new Map(layout.nodes.map((entry) => [entry.path, entry]))
  const markers: TableMarker[] = []
  const codeLines = new Set<number>()
  const tableLines = new Set<number>()
  const add = (lineNumber: number, start: number, end: number, kind: TableMarker['kind']) => {
    if (end > start) markers.push({ line: lineNumber, start, end, kind })
  }
  const walk = (node: AstNode, path: string, figureDiff = false): void => {
    const span = spans.get(path)
    const start = span && locations.get(span.startByte)
    const end = span && locations.get(span.endByte)
    if (start && end) {
      if (node.type === 'code_block' || node.type === 'raw_block') {
        for (let row = start.line; row <= end.line; row++) codeLines.add(row)
      }
      if (node.type === 'code_block' && (node.attrs?.classes?.includes('diff') || figureDiff) && node.content) {
        node.content.split('\n').forEach((contentLine, index) => {
          const marker = contentLine[0]
          if (marker !== '+' && marker !== '-') return
          const row = start.line + index + 1
          const sourceLine = lines[row]
          if (!sourceLine?.endsWith(contentLine)) return
          const column = sourceLine.length - contentLine.length
          add(row, column, column + 1, marker === '+' ? 'diffAdd' : 'diffRemove')
        })
      }
      const delimited = node.type === 'table' ? node.sourceFormat : node.type === 'code_block' ? node.lang : undefined
      if (delimited === 'csv' || delimited === 'tsv') {
        let opener = start.line
        let fence: RegExpMatchArray | null = null
        for (; opener <= end.line && !fence; opener++) fence = lines[opener]?.slice(start.column).match(/^(`{3,}|~{3,})/) ?? null
        if (fence) {
          const closer = new RegExp(`^${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}[ \\t]*\r?$`)
          const body: string[] = []
          for (let row = opener; row < lines.length && row <= end.line; row++) {
            const text = lines[row].slice(start.column)
            if (closer.test(text)) break
            body.push(text)
          }
          for (const range of delimitedColumnRanges(body, delimited === 'csv' ? ',' : '\t')) {
            markers.push({
              line: opener + range.line,
              start: start.column + range.start,
              end: start.column + range.end,
              kind: 'delimitedColumn',
              column: range.column,
            })
          }
        }
      }
      if (node.type === 'table' && (node.sourceFormat === 'csv' || node.sourceFormat === 'tsv')) {
        for (let row = start.line; row <= end.line; row++) tableLines.add(row)
        for (let row = start.line + 1; row < end.line; row++) {
          add(row, Math.min(start.column, lines[row]?.length ?? 0), lines[row]?.length ?? 0, 'tableBody')
        }
        node.rows?.forEach((row, rowIndex) => {
          for (let cell = 1; cell < (row.cells?.length ?? 0); cell++) {
            const left = spans.get(`${path}/rows/${rowIndex}/cells/${cell - 1}`)
            const right = spans.get(`${path}/rows/${rowIndex}/cells/${cell}`)
            const from = left && locations.get(left.endByte)
            const to = right && locations.get(right.startByte)
            if (!from || !to || from.line !== to.line) continue
            const separator = lines[from.line]?.slice(from.column, to.column)
            if (separator === (node.sourceFormat === 'csv' ? ',' : '\t')) {
              add(from.line, from.column, to.column, 'boundary')
            }
          }
        })
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
    if (node.target) walk(node.target, `${path}/target`, node.type === 'figure' && node.attrs?.classes?.includes('diff'))
    for (const key of ['children', 'items', 'rows', 'cells', 'caption', 'title'] as const) {
      node[key]?.forEach((child, index) => walk(child, `${path}/${key}/${index}`))
    }
  }
  walk(ast as AstNode, '')
  markers.push(...standaloneContinuationMarkers(lines, ast as AstNode))
  return { markers, codeLines, tableLines }
}

/** Use the same TextMate rules as the editor, including fenced Carve blocks. */
export async function createTableMarkerScanner(
  extensionPath: string,
  parse: typeof parseWithSourceLayout = parseWithSourceLayout,
): Promise<(text: string, key?: string) => TableMarker[]> {
  const wasm = readFileSync(join(extensionPath, 'node_modules/vscode-oniguruma/release/onig.wasm'))
  await oniguruma.loadWASM(wasm.buffer)
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (source) => new oniguruma.OnigString(source),
    }),
    loadGrammar: async (scopeName) => scopeName === 'text.carve'
      ? vsctm.parseRawGrammar(
        readFileSync(join(extensionPath, 'syntaxes/carve.tmLanguage.json'), 'utf8'),
        'carve.tmLanguage.json',
      )
      : null,
  })
  const grammar = await registry.loadGrammar('text.carve')
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
          if (token.endIndex > token.startIndex && token.scopes.includes('markup.raw.block.fenced.code.carve')) {
            plainMarkers.push({ line, start: token.startIndex, end: token.endIndex, kind: 'plain' })
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
