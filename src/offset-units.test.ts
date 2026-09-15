/**
 * The engine counts codepoints; the editor counts UTF-16 units.
 *
 * `IncludeWarning.start` and `.end` are codepoint offsets. `Position`, `Range`,
 * `TextDocument.positionAt` and `String.slice` are all UTF-16. The two coincide
 * for every character below U+10000, so an ASCII fixture cannot see the
 * difference - which is exactly how #207 shipped feeding one straight into the
 * other. Every fixture here therefore carries an astral character (#212).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { expandForRender, utf16Offset, type Engine } from './include-expansion.js'

const EMOJI = '\u{1F600}'

test('an astral character is one codepoint and two UTF-16 units', () => {
  // The premise. If this ever stops holding, nothing below is testing anything.
  assert.equal([...EMOJI].length, 1)
  assert.equal(EMOJI.length, 2)
})

test('a codepoint offset past an astral character translates to a larger UTF-16 offset', () => {
  const source = `Emoji ${EMOJI} here.`
  const codepoints = [...source]
  const at = codepoints.indexOf('h')
  assert.equal(utf16Offset(source, at), source.indexOf('h'))
  assert.equal(utf16Offset(source, at), at + 1)
})

test('translation is the identity on a string with no astral character', () => {
  const source = 'Plain ASCII only.'
  for (let i = 0; i <= source.length; i++) assert.equal(utf16Offset(source, i), i)
})

test('an offset at or past the end clamps to the string length', () => {
  const source = `a${EMOJI}b`
  assert.equal(utf16Offset(source, 3), source.length)
  assert.equal(utf16Offset(source, 99), source.length)
  assert.equal(utf16Offset(source, 0), 0)
  assert.equal(utf16Offset(source, -1), 0)
})

test('a warning offset, translated, slices the directive it names', async () => {
  // The end-to-end statement: the range a diagnostic would cover is the range
  // the directive actually occupies. Untranslated, this slice starts on the
  // newline before the directive and stops before its closing brace.
  const dir = mkdtempSync(join(tmpdir(), 'carve-units-'))
  try {
    const source = `Emoji ${EMOJI} here.\n\n{{ missing.crv }}\n`
    const path = join(dir, 'book.crv')
    writeFileSync(path, source)
    const engine = (await import('@markup-carve/carve')) as unknown as Engine
    const result = expandForRender(engine, {
      source,
      sourcePath: path,
      resolve: () => ({ ok: false, id: 'missing.crv', denial: 'not-found' }),
    })
    const warning = result.warnings[0]!
    assert.equal(warning.rule, 'include-unresolved')
    const sliced = source.slice(utf16Offset(source, warning.start), utf16Offset(source, warning.end))
    assert.equal(sliced, '{{ missing.crv }}')
    // And the untranslated slice is wrong, so the assertion above is load-bearing.
    assert.notEqual(source.slice(warning.start, warning.end), '{{ missing.crv }}')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
