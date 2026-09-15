// Which tokens does one grammar rule actually win?
//
// The obvious reading - find the construct by looking for the scopes the rule
// declares - measures the wrong thing. Two rules routinely declare the same
// scope: measured in markup-carve/intellij-carve#135, `heading-on-marker-line`
// declares `markup.list.unnumbered.carve`, which `lists` declares too, so that
// reading claimed 27 spans in a fixture holding no heading at all.
//
// Attribution here comes from loading the rule with every scope name inside it
// rewritten to a probe scope. A scope name never affects what a regex matches,
// so tokenization is identical and the probe marks exactly the tokens that rule
// won - in real competition with every other rule, which deleting the rule would
// not preserve.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const vsctm = require('vscode-textmate')
const oniguruma = require('vscode-oniguruma')
const toolsDir = dirname(fileURLToPath(import.meta.url))

export const PROBE_SCOPE = 'probe.declaration.carve'
// A `name` on a begin/end rule blankets the WHOLE region, body prose included.
// That is where the rule was open, not what it matched, so it is marked apart
// and only used when the rule attributes nothing else.
export const PROBE_REGION_SCOPE = 'probe.region.carve'

let onigLib
async function onig() {
  if (!onigLib) {
    const wasm = readFileSync(resolve(toolsDir, '../node_modules/vscode-oniguruma/release/onig.wasm'))
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
    onigLib = {
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (source) => new oniguruma.OnigString(source),
    }
  }
  return onigLib
}

/** Every token of `text`, with its row, half-open column range and scopes. */
export async function tokenize(grammar, text) {
  const registry = new vsctm.Registry({
    onigLib: onig(),
    // Embedded languages (source.json, source.yaml) resolve to nothing here.
    // A frontmatter body then stays unscoped, which is correct for this
    // measurement: no Carve rule owns it.
    loadGrammar: async (scope) =>
      scope === grammar.scopeName ? vsctm.parseRawGrammar(JSON.stringify(grammar), 'grammar.json') : null,
  })
  const loaded = await registry.loadGrammar(grammar.scopeName)
  if (!loaded) throw new Error(`grammar ${grammar.scopeName} did not load`)
  const tokens = []
  let stack = vsctm.INITIAL
  text.split('\n').forEach((line, row) => {
    const result = loaded.tokenizeLine(line, stack)
    stack = result.ruleStack
    for (const token of result.tokens) {
      tokens.push({
        row,
        start: token.startIndex,
        end: token.endIndex,
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      })
    }
  })
  return tokens
}

function withProbeScope(grammar, ruleName) {
  const copy = JSON.parse(JSON.stringify(grammar))
  if (!copy.repository?.[ruleName]) return null
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const blankets = typeof node.begin === 'string' || typeof node.while === 'string'
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'name' || key === 'contentName') && typeof value === 'string') {
        node[key] = blankets ? PROBE_REGION_SCOPE : PROBE_SCOPE
      } else walk(value)
    }
  }
  walk(copy.repository[ruleName])
  return copy
}

/**
 * The spans `ruleName` wins in `text`, and how they were attributed. Blank spans
 * are dropped: a newline inside a block is text no grammar needs a rule for.
 *
 * `granularity` is `token` when the rule attributes tokens of its own, through
 * captures or nested patterns, and `opener` for a begin/end rule whose only
 * scope is the region blanket - there the construct's own syntax is its opener,
 * and the prose between the markers is text no grammar owes a scope.
 */
export async function spansOwnedBy(grammar, ruleName, text) {
  const probed = withProbeScope(grammar, ruleName)
  if (!probed) return null
  const tokens = await tokenize(probed, text)
  const named = tokens.filter((token) => token.scopes.includes(PROBE_SCOPE) && token.text.trim() !== '')
  if (named.length > 0) return { spans: named, granularity: 'token' }

  const openers = []
  let open = false
  for (const token of tokens) {
    const inside = token.scopes.includes(PROBE_REGION_SCOPE)
    if (inside && !open && token.text.trim() !== '') openers.push(token)
    open = inside
  }
  return { spans: openers, granularity: openers.length > 0 ? 'opener' : 'token' }
}

/** Is column `start` of row `row` scoped by anything beyond the root scope? */
export function highlightedAt(tokens, rootScope, row, start) {
  const token = tokens.find((candidate) => candidate.row === row && candidate.start <= start && start < candidate.end)
  if (!token) return false
  return token.scopes.some((scope) => scope !== rootScope)
}
