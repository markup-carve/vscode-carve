// Byte modifiers on a `::: compare` opener; `no-render` leaves the bytes alone.
const BYTE_MODIFIERS = new Set(['crlf', 'cr', 'bom', 'nul', 'no-final-newline'])

// Same census as the spec's scripts/lib/example-pair-census.mjs: one pair per
// `carve` fence inside a `::: compare` block, and nothing inside a fence is markup.
// Each pair is keyed by its input bytes, because the spec's generate-corpus.mjs
// writes one corpus document per distinct input.
export const declaredInputs = (lines) => {
  const inputs = []
  let marker = null
  let modifiers = ''
  let fence = null
  let body = null
  for (const line of lines) {
    if (fence !== null) {
      if (line.startsWith(fence) && line.slice(fence.length).trim() === '') {
        if (body !== null) inputs.push(`${modifiers}\n${body.join('\n')}`)
        fence = null
        body = null
      } else if (body !== null) {
        body.push(line)
      }
      continue
    }
    const ticks = /^`{3,}/.exec(line)
    if (ticks !== null) {
      fence = ticks[0]
      if (marker !== null && line.slice(fence.length).trim() === 'carve') body = []
      continue
    }
    const trimmed = line.trim()
    const colons = /^:{3,}/.exec(trimmed)
    if (colons === null) continue
    if (marker === null) {
      const rest = trimmed.slice(colons[0].length)
      if (/^[ \t]+compare(?:[ \t]|$)/.test(rest)) {
        marker = colons[0]
        modifiers = rest.trim().split(/[ \t]+/).slice(1).filter((m) => BYTE_MODIFIERS.has(m)).sort().join(' ')
      }
    } else if (trimmed === marker) {
      marker = null
    }
  }
  return inputs
}

export const countDeclaredPairs = (lines) => declaredInputs(lines).length
