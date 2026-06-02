# vscode-carve

VS Code support for [Carve](https://github.com/markup-carve/carve), a post-Djot lightweight markup language.

## Features

- Language registration for `.crv` and `.carve` files, with a dedicated file icon in the Explorer.
- Syntax highlighting for headings, emphasis, strong, links, images, lists, tables, code, raw blocks, comments, attributes, footnotes, mentions, tags, math, and frontmatter.
- Language server integration via [`markup-carve/carve-lsp`](https://github.com/markup-carve/carve-lsp):
  - diagnostics for parser errors and Djot/Markdown migration warnings,
  - quick fixes for migration warnings where the rewrite is mechanical,
  - hover help for common Carve syntax,
  - document symbols generated from heading structure,
  - semantic tokens for parser-aware highlighting in themes that support LSP semantic colorization,
  - context-aware completion: admonition kinds after `:::`, heading ids after `</#`, footnote labels after `[^`, and link reference labels after `][`,
  - document formatting (and format-on-save) that trims trailing whitespace, collapses blank-line runs, and normalizes the final newline without touching code, raw, or comment blocks,
  - folding for headings/sections and multi-line blocks,
  - rename for footnote and link reference labels (definition and all references),
  - code lens showing the reference count above each footnote definition.
- Snippets for common constructs: headings, emphasis, links, images, tables, lists, code/raw blocks, footnotes, math, divs, attributes, and frontmatter (type `h2`, `link`, `table`, `codeblock`, etc.).
- Preview command: **Carve: Open Preview** renders the active document in a VS Code webview, reachable from the editor title bar button, the command palette, or `ctrl+shift+v` (`cmd+shift+v` on macOS). The preview:
  - renders [Mermaid](https://mermaid.js.org/) diagrams from ` ```mermaid ` code blocks,
  - typesets inline and display math with [KaTeX](https://katex.org/),
  - syntax-highlights fenced code blocks with highlight.js (light/dark aware),
  - follows the active Carve editor, syncs scrolling line-by-line in both directions, and highlights the block under the cursor,
  - links `@mentions` and `#tags` and renders `:emoji:` shortcodes when configured (see settings below).
- Export commands:
  - **Carve: Export to HTML** writes a self-contained HTML file (Mermaid, KaTeX, and highlight.js load from a CDN; theming follows the reader's color scheme).
  - **Carve: Print Preview / Export PDF** opens the system print dialog on the preview, so you can save to PDF.
- Editor rules for comments, brackets, autoclosing pairs, folding markers, and word patterns.
- An example document in the repository, `examples/demo.crv`, exercising every supported construct - open it and run **Carve: Open Preview** to see the rendering features in action.

The canonical structural grammar for Carve lives in [`markup-carve/tree-sitter-carve`](https://github.com/markup-carve/tree-sitter-carve). VS Code extensions currently use TextMate grammars for built-in syntax colorization, so this extension ships a TextMate grammar aligned with the Tree-sitter grammar and uses the LSP for semantic behavior.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `carve.lsp.enabled` | `true` | Enable the Carve language server. |
| `carve.trace.server` | `"off"` | Trace VS Code ↔ language-server communication (`off`/`messages`/`verbose`) in the output channel, for debugging. |
| `carve.preview.mentionUrl` | `""` | URL template for `@mention` links in the preview; `{name}` is replaced (e.g. `https://example.com/u/{name}`). Empty renders mentions as plain text. |
| `carve.preview.tagUrl` | `""` | URL template for `#tag` links in the preview; `{name}` is replaced. Empty renders tags as plain text. |
| `carve.preview.emoji` | `{}` | Map of emoji shortcodes to glyphs, e.g. `{ "smile": "😄" }` renders `:smile:` as the glyph. Unmapped shortcodes render literally. |

## Development

```bash
npm install
npm run build
npm test
npm run package
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

To install the local VSIX after packaging:

```bash
code --install-extension vscode-carve-0.1.0.vsix
```

## License

MIT
