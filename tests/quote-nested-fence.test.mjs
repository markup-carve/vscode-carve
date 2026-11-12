/**
 * A fence behind a quote marker closes at its own depth (markup-carve/vscode-carve#440).
 *
 * `> > ```` over `> > code` over `> > ```` used to stay open until the quote
 * ended: the nested `>` was taken by an inner quote region, so the fence knew
 * only one marker and its closer never matched. Expected readings are carve-js
 * 0.1.16 and the spec model at carve 51c5631: a code fence takes no lazy line
 * and continues only on lines with all of its markers (a bare `> >` included),
 * while a comment fence closes on a `%%%` behind at most its own markers.
 *
 * BOTH DIRECTIONS: every `in` word must be verbatim and every `out` word must
 * not, so a fence that runs to the end of the document fails as loudly as one
 * that never opens.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

await oniguruma.loadWASM(
  readFileSync(resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm')).buffer,
)

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (str) => new oniguruma.OnigString(str),
  }),
  loadGrammar: async (scope) =>
    scope === 'text.carve'
      ? vsctm.parseRawGrammar(
          readFileSync(resolve(root, 'syntaxes/carve.tmLanguage.json'), 'utf8'),
          'carve.tmLanguage.json',
        )
      : null,
})

const grammar = await registry.loadGrammar('text.carve')

/** @returns {Map<string, boolean>} each `wN` word mapped to whether it is verbatim. */
function verbatimWords(src) {
  let state = vsctm.INITIAL
  const words = new Map()
  for (const line of src.split('\n')) {
    const r = grammar.tokenizeLine(line, state)
    state = r.ruleStack
    for (const t of r.tokens) {
      const verbatim = t.scopes.some(
        (s) => s.startsWith('markup.raw.block') || s.startsWith('comment.block'),
      )
      for (const w of line.slice(t.startIndex, t.endIndex).match(/w\d+/g) ?? []) {
        words.set(w, verbatim)
      }
    }
  }
  return words
}

const pre = (depth) => '> '.repeat(depth)
const bare = (depth) => '> '.repeat(depth - 1) + '>'

const CASES = []
for (const depth of [1, 2, 3]) {
  const p = pre(depth)
  const up = pre(depth - 1)
  for (const fence of ['```', '~~~']) {
    CASES.push(
      [`a ${fence} fence at depth ${depth} closes`, `${p}${fence}\n${p}w0\n${p}${fence}\n${p}w1\n`, ['w0'], ['w1']],
      [`a ${fence} fence at depth ${depth} keeps a bare marker line`, `${p}${fence}\n${p}w0\n${bare(depth)}\n${p}w1\n${p}${fence}\nw2\n`, ['w0', 'w1'], ['w2']],
      [`a ${fence} fence at depth ${depth} takes no lazy line`, `${p}${fence}\n${p}w0\nw1\n${p}${fence}\n`, ['w0'], ['w1']],
      [`a ${fence} fence at depth ${depth} ends at a shallower prefix`, `${p}${fence}\n${p}w0\n${up}w1\n`, ['w0'], ['w1']],
      [`a ${fence} fence at depth ${depth} on a list marker line closes`, `- ${p}${fence}\n  ${p}w0\n  ${p}${fence}\n  ${p}w1\n`, ['w0'], ['w1']],
    )
  }
  CASES.push(
    [`a comment fence at depth ${depth} closes`, `${p}%%%\n${p}w0\n${p}%%%\n${p}w1\n`, ['w0'], ['w1']],
    [`a comment fence at depth ${depth} closes on an indented closer`, `${p}%%%\n${p}w0\n${p}   %%%\n${p}w1\n`, ['w0'], ['w1']],
    [`a comment fence at depth ${depth} closes on a lazy closer`, `${p}%%%\n${p}w0\n%%%\n${p}w1\n`, ['w0'], ['w1']],
    [`a comment fence at depth ${depth} does not close on a deeper closer`, `${p}%%%\n${p}w0\n${p}> %%%\n${p}w1\n${p}%%%\n${p}w2\n`, ['w0', 'w1'], ['w2']],
    [`a comment fence at depth ${depth} ends at a glued marker without closing on it`, `${p}%%%\n${p}w0\n${bare(depth)}%%%\n${p}w1\n`, ['w0'], ['w1']],
    [`a comment fence at depth ${depth} opens behind an indent`, `${p}  %%%\n${p}w0\n${p}%%%\n${p}w1\n`, ['w0'], ['w1']],
  )
}

for (const [label, src, inside, outside] of CASES) {
  test(label, () => {
    const words = verbatimWords(src)
    for (const w of inside) assert.equal(words.get(w), true, `${w} must be verbatim in ${JSON.stringify(src)}`)
    for (const w of outside) assert.equal(words.get(w), false, `${w} must not be verbatim in ${JSON.stringify(src)}`)
  })
}

test('a fence glued to a list marker is not a quoted fence', () => {
  const words = verbatimWords('- ```\n  w0\n  ```\n  w1\n')
  assert.equal(words.get('w0'), true)
  assert.equal(words.get('w1'), false)
})
