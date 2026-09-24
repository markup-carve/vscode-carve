import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import oniguruma from 'vscode-oniguruma'
import vsctm from 'vscode-textmate'

export interface TableMarker {
  line: number
  start: number
  end: number
  kind: 'boundary' | 'operator'
}

/** Use the same TextMate rules as the editor, including fenced Carve blocks. */
export async function createTableMarkerScanner(extensionPath: string): Promise<(text: string, key?: string) => TableMarker[]> {
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

  const cache = new Map<string, { lines: string[]; states: vsctm.StackElement[]; markers: TableMarker[][] }>()
  return (text, key = '') => {
    const lines = text.split(/\r?\n/)
    const previous = cache.get(key)
    let firstChanged = 0
    if (previous) {
      while (firstChanged < lines.length && lines[firstChanged] === previous.lines[firstChanged]) {
        firstChanged++
      }
    }
    const states = previous?.states.slice(0, firstChanged) ?? []
    const markersByLine = previous?.markers.slice(0, firstChanged) ?? []
    let state = firstChanged ? states[firstChanged - 1] : vsctm.INITIAL
    for (let line = firstChanged; line < lines.length; line++) {
      const source = lines[line]
      const result = grammar.tokenizeLine(source, state)
      state = result.ruleStack
      states[line] = state
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
    cache.set(key, { lines, states, markers: markersByLine })
    if (cache.size > 8) cache.delete(cache.keys().next().value!)
    return markersByLine.flat()
  }
}
