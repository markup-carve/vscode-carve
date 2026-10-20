import assert from 'node:assert/strict'
import test from 'node:test'
import { carveColors, colorHex } from './color-picker.js'

test('only authored color extensions receive a picker', () => {
  const source = [
    'JavaScript PRs #3307 and #3313.',
    '` :color[#fff] ` and :color[#3c8772].',
    '```carve',
    ':color[#123]',
    '```',
    '> In a quote: :color[#abc8]',
    '- In a list: :color[#11223344]',
    '\\:color[#abc] is escaped.',
    ':color[nope] is not a color.',
  ].join('\n')
  const found = carveColors(source)
  assert.deepEqual(found.map(({ start, end }) => source.slice(start, end)),
    ['#3c8772', '#abc8', '#11223344'])
})

test('ranges use UTF-16 positions after astral characters', () => {
  const source = '😀 :color[#0f8]\n'
  const [color] = carveColors(source)
  assert.equal(color.start, 10)
  assert.equal(source.slice(color.start, color.end), '#0f8')
  assert.equal(color.alpha, 1)
})

test('hex presentations keep shorthand and alpha when representable', () => {
  assert.equal(colorHex({ red: 1, green: 0, blue: 0, alpha: 1 }, '#abc'), '#f00')
  assert.equal(colorHex({ red: 1, green: 0, blue: 0, alpha: 0.5 }, '#abc'), '#ff000080')
  assert.equal(colorHex({ red: 1, green: 0, blue: 0, alpha: 1 }, '#AABBCCDD'), '#FF0000FF')
})
