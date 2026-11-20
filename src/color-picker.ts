import { parse, stringOffsetOfByte } from '@markup-carve/carve'

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

interface TreeNode {
  type: string
  name?: string
  pos?: { startOffset: number; endOffset: number }
  [key: string]: unknown
}

function inlineExtensions(node: TreeNode, found: TreeNode[]): void {
  if (node.type === 'inline_extension') found.push(node)
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (typeof child === 'object' && child !== null && typeof (child as TreeNode).type === 'string') {
        inlineExtensions(child as TreeNode, found)
      }
    }
  }
}

export function carveColors(source: string): CarveColor[] {
  if (!source.includes(':color[')) return []
  const colors: CarveColor[] = []
  const nodes: TreeNode[] = []
  inlineExtensions(parse(source) as unknown as TreeNode, nodes)
  for (const node of nodes) {
    if (node.name !== 'color' || !node.pos) continue
    // Tree offsets are UTF-8 bytes; the picker works in UTF-16 code units.
    const start = stringOffsetOfByte(source, node.pos.startOffset)
    const raw = source.slice(start, stringOffsetOfByte(source, node.pos.endOffset))
    if (!raw.startsWith(':color[')) continue
    const close = raw.indexOf(']', 7)
    if (close < 0) continue
    const parsed = parseHex(raw.slice(7, close))
    if (parsed) colors.push({ start: start + 7, end: start + close, ...parsed })
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
