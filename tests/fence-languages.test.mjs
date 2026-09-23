import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { LANGUAGES } from '../tools/generate-fence-languages.mjs'

const grammar = JSON.parse(readFileSync(new URL('../syntaxes/carve.tmLanguage.json', import.meta.url)))
const generator = new URL('../tools/generate-fence-languages.mjs', import.meta.url).pathname

test('generated fence language rules and embeddedLanguages are in sync', () => {
  const run = spawnSync(process.execPath, [generator, '--check'], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})

test('every fence rule variant tries the language rules before the generic one', () => {
  const heads = [
    ['code-blocks', 0, 'fenced-code-languages'],
    ['code-block-behind-a-container-prefix', 0, 'fenced-code-languages-on-a-marker-line'],
    ['code-block-behind-a-container-prefix', 2, 'fenced-code-languages-at-a-body-column'],
  ]
  for (const [entry, index, generated] of heads) {
    assert.equal(grammar.repository[entry].patterns[index].include, `#${generated}`)
    assert.equal(grammar.repository[generated].patterns.length, LANGUAGES.length)
  }
})
