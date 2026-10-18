import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseWithSourceLayout } from '@markup-carve/carve'
import oniguruma from 'vscode-oniguruma'
import vsctm from 'vscode-textmate'

export interface TableMarker {
  line: number
  start: number
  end: number
  kind: 'boundary' | 'operator' | 'plain' | 'tableBody' | 'listMarker' | 'definitionMarker' | 'containerMarker' | 'strong' | 'emphasis'
}

interface AstNode {
  type: string
  sourceFormat?: string
  children?: AstNode[]
  items?: AstNode[]
  rows?: AstNode[]
  cells?: AstNode[]
  caption?: AstNode[]
  title?: AstNode[]
  target?: AstNode
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
  const walk = (node: AstNode, path: string): void => {
    const span = spans.get(path)
    const start = span && locations.get(span.startByte)
    const end = span && locations.get(span.endByte)
    if (start && end) {
      if (node.type === 'code_block' || node.type === 'raw_block') {
        for (let row = start.line; row <= end.line; row++) codeLines.add(row)
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
        const match = lines[start.line]?.slice(start.column).match(/^(?:[-*]|\d+[.)]|[A-Za-z][.)]|\.) +(?:\[[ xX_>?-]\] +)?/)
        if (match) add(start.line, start.column, start.column + match[0].length, 'listMarker')
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
    if (node.target) walk(node.target, `${path}/target`)
    for (const key of ['children', 'items', 'rows', 'cells', 'caption', 'title'] as const) {
      node[key]?.forEach((child, index) => walk(child, `${path}/${key}/${index}`))
    }
  }
  walk(ast as AstNode, '')
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
        if (kind) markers.push({ line, start: token.startIndex, end: token.endIndex, kind })
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
