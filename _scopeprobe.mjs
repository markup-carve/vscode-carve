import { readFileSync, readdirSync } from 'node:fs'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'
const root = '/tmp/vsc'
await oniguruma.loadWASM(readFileSync(`${root}/node_modules/vscode-oniguruma/release/onig.wasm`).buffer)
const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: s => new oniguruma.OnigScanner(s),
    createOnigString: s => new oniguruma.OnigString(s),
  }),
  loadGrammar: async () => vsctm.parseRawGrammar(
    readFileSync(`${root}/syntaxes/carve.tmLanguage.json`,'utf8'), 'carve.tmLanguage.json'),
})
const grammar = await registry.loadGrammar('text.carve')
function scopes(src) {
  const out = new Set(); let rules = vsctm.INITIAL
  for (const line of src.split('\n')) {
    const r = grammar.tokenizeLine(line, rules)
    for (const t of r.tokens) for (const s of t.scopes) if (s !== 'text.carve') out.add(s)
    rules = r.ruleStack
  }
  return out
}
const dir = `${root}/spec/tests/corpus`
// baseline: every scope any COVERED fixture already produces
const cats = JSON.parse(readFileSync(`${root}/tests/categories.json`,'utf8'))
const files = readdirSync(dir)
const known = new Set()
for (const slug of Object.values(cats.covered)) {
  const f = files.find(x => x === slug) ?? files.find(x => x.endsWith(slug))
  if (f) for (const s of scopes(readFileSync(`${dir}/${f}`,'utf8'))) known.add(s)
}
console.log(`  scopes pinned by ${Object.keys(cats.covered).length} covered fixtures: ${known.size}`)
for (const slug of process.argv.slice(2)) {
  const fs_ = files.filter(f => f.includes(slug) && f.endsWith('.crv'))
  const got = new Set()
  for (const f of fs_) for (const s of scopes(readFileSync(`${dir}/${f}`,'utf8'))) got.add(s)
  const novel = [...got].filter(s => !known.has(s))
  console.log(`\n  ${slug}  (${fs_.length} file(s))`)
  console.log(`    scopes produced: ${got.size}   NOVEL: ${novel.length}${novel.length?' -> '+novel.join(', '):''}`)
}
