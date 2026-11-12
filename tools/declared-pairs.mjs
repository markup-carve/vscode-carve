// The byte transforms of the spec's generate-corpus.mjs, in its order, so two
// examples that produce the same bytes count once (`no-final-newline` with or
// without `crlf` on a one-line input).
const corpusBytes = (carve, modifiers) => {
  let out = carve
  if (modifiers.has('no-final-newline')) out = out.replace(/\n$/, '')
  if (modifiers.has('crlf')) out = out.replace(/\n/g, '\r\n')
  if (modifiers.has('cr')) out = out.replace(/\n/g, '\r')
  if (modifiers.has('bom')) out = '\ufeff' + out
  if (modifiers.has('nul')) out = out.replaceAll('\u2400', '\0')
  return out
}

// Same census as the spec's scripts/lib/example-pair-census.mjs: one pair per
// `carve` fence inside a `::: compare` block, and nothing inside a fence is markup.
// Each pair is keyed by its input bytes, because the spec's generate-corpus.mjs
// writes one corpus document per distinct input.
export const declaredInputs = (lines) => {
  const inputs = []
  let marker = null
  let modifiers = new Set()
  let fence = null
  let body = null
  for (const line of lines) {
    if (fence !== null) {
      if (line.startsWith(fence) && line.slice(fence.length).trim() === '') {
        if (body !== null) inputs.push(corpusBytes(body.join('\n') + '\n', modifiers))
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
        modifiers = new Set(rest.trim().split(/[ \t]+/).slice(1))
      }
    } else if (trimmed === marker) {
      marker = null
    }
  }
  return inputs
}

export const countDeclaredPairs = (lines) => declaredInputs(lines).length
