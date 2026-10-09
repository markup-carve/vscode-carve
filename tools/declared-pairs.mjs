// Same census as the spec's scripts/lib/example-pair-census.mjs: one pair per
// `carve` fence inside a `::: compare` block, and nothing inside a fence is markup.
export const countDeclaredPairs = (lines) => {
  let declared = 0
  let marker = null
  let fence = null
  for (const line of lines) {
    if (fence !== null) {
      if (line.startsWith(fence) && line.slice(fence.length).trim() === '') fence = null
      continue
    }
    const ticks = /^`{3,}/.exec(line)
    if (ticks !== null) {
      fence = ticks[0]
      if (marker !== null && line.slice(fence.length).trim() === 'carve') declared++
      continue
    }
    const trimmed = line.trim()
    const colons = /^:{3,}/.exec(trimmed)
    if (colons === null) continue
    if (marker === null) {
      if (/^[ \t]+compare(?:[ \t]|$)/.test(trimmed.slice(colons[0].length))) marker = colons[0]
    } else if (trimmed === marker) {
      marker = null
    }
  }
  return declared
}
