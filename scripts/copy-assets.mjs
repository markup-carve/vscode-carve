// Copy the self-contained webview asset bundles into ./media so the packaged
// extension does not need to ship the full mermaid/katex/highlight.js
// dependency trees from node_modules. These libraries are devDependencies; only
// the prebuilt files copied here are bundled into the .vsix.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const media = join(root, 'media')

/** @type {Array<[string, string]>} source -> destination, relative to root. */
const files = [
  [join(nm, 'mermaid', 'dist', 'mermaid.min.js'), join(media, 'mermaid.min.js')],
  [join(nm, 'chart.js', 'dist', 'chart.umd.js'), join(media, 'chart.umd.js')],
  [join(nm, 'katex', 'dist', 'katex.min.js'), join(media, 'katex', 'katex.min.js')],
  [join(nm, 'katex', 'dist', 'katex.min.css'), join(media, 'katex', 'katex.min.css')],
  [join(nm, 'katex', 'dist', 'contrib', 'auto-render.min.js'), join(media, 'katex', 'auto-render.min.js')],
  [join(nm, '@highlightjs', 'cdn-assets', 'highlight.min.js'), join(media, 'hljs', 'highlight.min.js')],
  [join(nm, '@highlightjs', 'cdn-assets', 'styles', 'github.min.css'), join(media, 'hljs', 'github.min.css')],
  [join(nm, '@highlightjs', 'cdn-assets', 'styles', 'github-dark.min.css'), join(media, 'hljs', 'github-dark.min.css')],
  // @markup-carve/carve-css - the shared token layer and the rules built on it.
  // Linked as four separate files rather than through carve.css, because that
  // entry point pulls its layers in with relative `@import`s and the preview
  // controls the order itself: tokens first, then the VS Code bridge in the
  // scaffold's own <style> overrides those tokens with the editor's theme.
  // recipes.css is opt-in per its own header; the preview opts in so that the
  // container words it documents (`::: cards`, `::: steps`) render as styled
  // constructs rather than bare divs.
  [join(nm, '@markup-carve', 'carve-css', 'src', 'tokens.css'), join(media, 'carve-css', 'tokens.css')],
  [join(nm, '@markup-carve', 'carve-css', 'src', 'core.css'), join(media, 'carve-css', 'core.css')],
  [join(nm, '@markup-carve', 'carve-css', 'src', 'extensions.css'), join(media, 'carve-css', 'extensions.css')],
  [join(nm, '@markup-carve', 'carve-css', 'src', 'recipes.css'), join(media, 'carve-css', 'recipes.css')],
]

/** @type {Array<[string, string]>} directory copies (KaTeX fonts). */
const dirs = [
  [join(nm, 'katex', 'dist', 'fonts'), join(media, 'katex', 'fonts')],
]

// The webview runs on Chromium (Electron), which always picks woff2 from the
// KaTeX @font-face fallbacks, so the .ttf/.woff variants never load. Ship only
// woff2 to keep the file count and package size down.
const keepFont = (src) => !src.endsWith('.ttf') && !src.endsWith('.woff')

rmSync(media, { recursive: true, force: true })

for (const [src, dest] of files) {
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest)
}

for (const [src, dest] of dirs) {
  cpSync(src, dest, { recursive: true, filter: keepFont })
}

console.log(`Copied webview assets into ${media}`)
