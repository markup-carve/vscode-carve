import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveLightTheme, carveDarkTheme } from '@markup-carve/carve-grammars/shiki/themes'
import palette from '@markup-carve/carve-grammars/themes/palette.json' with { type: 'json' }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

for (const [mode, source] of [['light', carveLightTheme], ['dark', carveDarkTheme]]) {
  const colors = { ...source.colors }
  colors['editor.background'] = palette[mode].background
  colors['editor.foreground'] = palette[mode].foreground
  const theme = {
    name: `Carve ${mode === 'light' ? 'Light' : 'Dark'}`,
    type: mode,
    colors,
    tokenColors: source.tokenColors,
  }
  const file = resolve(root, `themes/carve-${mode}-color-theme.json`)
  const content = `${JSON.stringify(theme, null, 2)}\n`
  if (check) {
    if (readFileSync(file, 'utf8') !== content) throw new Error(`${file} differs from carve-grammars`)
  } else {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
}
