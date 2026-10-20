import { createEditorSession } from '@markup-carve/carve'

export interface CarveColor {
  start: number
  end: number
  red: number
  green: number
  blue: number
  alpha: number
}

function parseHex(value: string): Omit<CarveColor, 'start' | 'end'> | undefined {
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value)
  if (!match) return undefined
  const digits = match[1].length <= 4
    ? [...match[1]].map((digit) => digit + digit).join('')
    : match[1]
  const channels = [0, 2, 4, 6].map((index) =>
    index < digits.length ? parseInt(digits.slice(index, index + 2), 16) / 255 : 1)
  return { red: channels[0], green: channels[1], blue: channels[2], alpha: channels[3] }
}

export function carveColors(source: string): CarveColor[] {
  if (!source.includes(':color[')) return []
  const colors: CarveColor[] = []
  const nodes = createEditorSession(source).snapshot().nodes
  for (const node of nodes) {
    if (node.type !== 'inline_extension') continue
    const raw = source.slice(node.start, node.end)
    if (!raw.startsWith(':color[')) continue
    const close = raw.indexOf(']', 7)
    if (close < 0) continue
    const parsed = parseHex(raw.slice(7, close))
    if (parsed) colors.push({ start: node.start + 7, end: node.start + close, ...parsed })
  }
  return colors
}

export function colorHex(
  color: Pick<CarveColor, 'red' | 'green' | 'blue' | 'alpha'>,
  original: string,
): string {
  const bytes = [color.red, color.green, color.blue, color.alpha]
    .map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255))
  const alpha = original.length === 5 || original.length === 9 || bytes[3] !== 255
  const full = bytes.slice(0, alpha ? 4 : 3).map((byte) => byte.toString(16).padStart(2, '0'))
  const shorthand = (original.length === 4 || original.length === 5) &&
    full.every((pair) => pair[0] === pair[1])
  const digits = shorthand ? full.map((pair) => pair[0]).join('') : full.join('')
  const uppercase = /[A-F]/.test(original) && !/[a-f]/.test(original)
  return `#${uppercase ? digits.toUpperCase() : digits}`
}
