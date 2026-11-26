// Snapshot every option-free render example in the pinned Carve 0.2 conformance
// corpus. The input copies and token streams are both committed, so a new
// example or a changed grammar has a reviewable diff.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const snapDir = join(here, 'snapshots-0.2')
const grammar = join(root, 'syntaxes', 'carve.tmLanguage.json')
const update = process.argv.includes('-u') || process.argv.includes('--updateSnapshot')
const conformance = JSON.parse(readFileSync(join(root, 'tools', 'conformance-0.2.json'), 'utf8'))
const examples = conformance.examples
if (!Array.isArray(examples) || examples.length === 0) throw new Error('0.2 conformance has no render examples')

mkdirSync(snapDir, { recursive: true })
const inputs = []
for (const example of examples) {
  if (!/^[a-z][a-z0-9-]*$/.test(example.id) || typeof example.input !== 'string') {
    throw new Error(`invalid conformance example: ${example.id}`)
  }
  const file = join(snapDir, `${example.id}.crv`)
  if (update) writeFileSync(file, example.input)
  else if (!existsSync(file) || readFileSync(file, 'utf8') !== example.input) {
    throw new Error(`${example.id}.crv does not match pinned 0.2 conformance; regenerate snapshots`)
  }
  inputs.push(file)
}
const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vscode-tmgrammar-snap.cmd' : 'vscode-tmgrammar-snap')
const args = ['-g', grammar, '-s', 'source.carve', ...(update ? ['-u'] : []), ...inputs]
const result = spawnSync(bin, args, { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
